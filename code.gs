// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR SAILING CLUB — Apps Script Backend
// ═══════════════════════════════════════════════════════════════════════════════
// Version history lives in /CHANGELOG.md at the repo root.
// ═══════════════════════════════════════════════════════════════════════════════

const SHEET_ID_ = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
const API_TOKEN_ = PropertiesService.getScriptProperties().getProperty('API_TOKEN');

const TABS_ = {
  members: 'members',
  dailyLog: 'daily_log',
  maintenance: 'maintenance',
  checkouts: 'checkouts',
  // actTypes removed — activity templates live in the config sheet under
  // key 'activity_templates' (legacy alias 'activity_types'), not a tab.
  // dailyCL removed — daily checklists now stored as JSON in config key 'dailyChecklist'
  incidents: 'incidents',
  trips: 'trips',
  config: 'config',
  employees: 'employees',
  timeClock: 'time_clock',
  payroll: 'payroll',
  shareTokens: 'share_tokens',
  tripConfirmations: 'trip_confirmations',
  reservationSlots: 'reservation_slots',
  crews: 'crews',
  crewInvites: 'crew_invites',
  passportSignoffs: 'passport_signoffs',
  volunteerSignups: 'volunteer_signups',
  activities: 'activities',
  sessions: 'sessions',
  loginAttempts: 'login_attempts',
  // All four handbook sections (roles/docs/contacts/info) now live as JSON
  // arrays under the config keys 'handbookRoles' / 'handbookDocs' /
  // 'handbookContacts' / 'handbookInfo'. No dedicated handbook tabs anymore.
};

const CLUB_LANG_ = 'IS';

// ─────────────────────────────────────────────────────────────────────────────
// SESSION & RATE LIMIT CONFIG
// ─────────────────────────────────────────────────────────────────────────────
// Short-lived sessions expire after 8h of activity; long sessions (the
// "stay logged in" checkbox) extend out to 60 days and their expiry slides
// on every authenticated call.
const SESSION_TTL_SHORT_MS_ = 8 * 60 * 60 * 1000;            // 8 hours
const SESSION_TTL_LONG_MS_  = 60 * 24 * 60 * 60 * 1000;       // 60 days
// Throttle lastSeenAt writes: only touch the sheet if the last write is
// older than 60s. Keeps the sessions sheet from becoming a write hotspot.
const SESSION_TOUCH_INTERVAL_MS_ = 60 * 1000;

// Rate limiting for loginMember: 5 failed attempts in 15 min → 15-min lockout.
const LOGIN_WINDOW_MS_    = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS_ = 5;
const LOGIN_LOCKOUT_MS_   = 15 * 60 * 1000;

// Per-session rate limiting for authenticated actions, bucketed by kennitala
// and minute. Normal actions share one bucket, bulk/heavy actions share a
// tighter bucket. Counters live in CacheService (ephemeral, no sheet writes
// per call). Adjust the caps if legitimate use ever trips them.
const MUTATION_RATE_NORMAL_ = 60;   // requests/minute/caller
const MUTATION_RATE_BULK_   = 10;   // requests/minute/caller for BULK_ACTIONS_
const BULK_ACTIONS_ = {
  importMembers:           true,
  deactivateMembers:       true,
  importRowingPassportCsv: true,
  syncVolunteerEvents:     true,
};

// Actions that can be called without a session token. Everything else
// requires a valid session (see authCaller_). GET-only public endpoints
// (lookup, captain, boat, resolveFromEmail, shared records) are gated
// separately inside doGet.
const PUBLIC_ACTIONS_ = {
  loginMember:     true,
  loginWithGoogle: true,
  dashboard:       true,
  lookup:          true,
  captain:         true,
  boat:            true,
};

// Admin-only actions. Enforced before route_ dispatches.
const ADMIN_ACTIONS_ = {
  // saveMember is NOT here — the member hub calls it to register guests.
  // Admin-only behaviour (editing arbitrary members, role changes, toggling
  // active) is enforced inside saveMember_.
  deleteMember:         true,
  importMembers:        true,
  deactivateMembers:    true,
  saveConfig:           true,
  saveCharterCalendars: true,
  saveClubCalendars:    true,
  saveActivityType:     true,
  deleteActivityType:   true,
  cancelClassOccurrence:   true,
  overrideClassOccurrence: true,
  restoreClassOccurrence:  true,
  saveChecklistItem:    true,
  deleteChecklistItem:  true,
  saveCertDef:          true,
  deleteCertDef:        true,
  saveCertCategories:   true,
  saveAlertConfig:      true,
  saveEmployee:         true,
  closePayPeriod:       true,
  adminEditTime:        true,
  adminAddTime:         true,
  adminDeleteTime:      true,
  saveRowingPassportDef:   true,
  importRowingPassportCsv: true,
  adminResetMemberPassword: true,
  // Handbook (admin-managed reference content).
  saveHandbookRole:    true,
  deleteHandbookRole:  true,
  reorderHandbookRoles:true,
  saveHandbookDoc:     true,
  deleteHandbookDoc:   true,
  uploadHandbookDoc:   true,
  syncHandbookDocs:    true,
  saveHandbookInfo:     true,
  deleteHandbookInfo:   true,
  saveHandbookContact:  true,
  deleteHandbookContact:true,
};

// Staff-or-admin actions. Intentionally narrow: many actions like
// saveCheckout / checkIn / createIncident are called from the member hub
// too (self-checkout, reporting a damage/incident), so we can't blanket
// gate them here. Only listing the flows that are strictly staff-only.
const STAFF_ACTIONS_ = {
  saveDailyLog:                true,   // daily club log sign-off
  saveGroupCheckout:           true,   // group check-outs (courses / events)
  groupCheckIn:                true,
  linkGroupCheckoutToActivity: true,
  deleteCheckout:              true,   // staff override; members check in instead
  silenceAlert:                true,
  snoozeAlert:                 true,
  resolveAlert:                true,
  getOverdueAlerts:            true,
  resolveIncident:             true,
  addIncidentNote:             true,
  getVerificationRequests:     true,
  saveFlagOverride:            true,   // staff-set weather flag override
  saveStaffStatus:             true,   // staff on-duty / support-boat toggle
  reassignMaintenance:         true,   // flip a request between maint and saumaklúbbur
  getActivityLog:              true,   // staff logbook-review activity-log section
};

// Actions that mutate a specific member's own data. The caller's kennitala
// (from the session) must match the target kennitala, unless the caller is
// an admin. The key names the request-body field that carries the target kt.
const SELF_OR_ADMIN_ACTIONS_ = {
  setPassword:      'kennitala',
  savePreferences:  'kennitala',
  // saveMemberCert takes memberId rather than kennitala; handled specially.
};


// ─────────────────────────────────────────────────────────────────────────────
// BILINGUAL STRING TABLE
// ─────────────────────────────────────────────────────────────────────────────

const GS_STRINGS_ = {
  'alert.subject': { EN: '⚠️ OVERDUE{minor}: {boat} — {overdue}', IS: '⚠️ YFIRTÍMA{minor}: {boat} — {overdue}' },
  'alert.minor': { EN: ' MINOR', IS: ' BARN' },
  'alert.overdueMins': { EN: '{n} min overdue', IS: '{n} mín yfirtíma' },
  'alert.overdueHrs': { EN: '{h}h {m}min overdue', IS: '{h}klst {m}mín yfirtíma' },
  'alert.header': { EN: '⚠️ OVERDUE BOAT ALERT', IS: '⚠️ YFIRTÍMA BÁTARVIÐVÖRUN' },
  'alert.headerMinor': { EN: '⚠️ OVERDUE BOAT ALERT — MINOR SAILOR', IS: '⚠️ YFIRTÍMA BÁTARVIÐVÖRUN — BARN' },
  'alert.boat': { EN: 'Boat', IS: 'Bátur' },
  'alert.sailor': { EN: 'Sailor', IS: 'Siglingamaður' },
  'alert.phone': { EN: 'Phone', IS: 'Sími' },
  'alert.noPhone': { EN: 'no phone on record', IS: 'ekkert símanúmer skráð' },
  'alert.guardian': { EN: 'Guardian', IS: 'Forráðamaður' },
  'alert.location': { EN: 'Location', IS: 'Staðsetning' },
  'alert.expectedReturn': { EN: 'Expected return', IS: 'Áætlaður skilatími' },
  'alert.checkedOut': { EN: 'Checked out', IS: 'Skráð út' },
  'alert.overdue': { EN: 'Overdue by', IS: 'Yfirtíma um' },
  'alert.silence': { EN: '✓ Silence alert', IS: '✓ Þagga viðvörun' },
  'alert.snooze': { EN: '⏱ Snooze {n}m', IS: '⏱ Fresta {n}mín' },
  'alert.openPortal': { EN: 'Open staff portal →', IS: 'Opna starfsmannasvæðið →' },
  'alert.footNote': {
    EN: 'Silence permanently removes this alert. Snooze hides it for {n} minutes.\nThe alert is automatically cleared when the sailor checks in.',
    IS: 'Þagging fjarlægir viðvörunina varanlega. Frestun felur hana í {n} mínútur.\nViðvörunin hverfur sjálfkrafa þegar siglingamaðurinn skráir sig inn.'
  },
  'alert.txt.title': { EN: 'OVERDUE BOAT ALERT — ÝMIR SAILING CLUB', IS: 'YFIRTÍMA BÁTARVIÐVÖRUN — ÝMIR SIGLINGAFÉLAG' },
  'alert.txt.silence': { EN: 'Silence alert:', IS: 'Þagga viðvörun:' },
  'alert.txt.snooze': { EN: 'Snooze alert:', IS: 'Fresta viðvörun:' },
  'alert.txt.portal': { EN: 'Staff portal:', IS: 'Starfsmannasvæði:' },
  'alert.sms': {
    EN: 'ÝMIR ALERT: {boat} ({name}{minor}) overdue {overdue}. Expected {ret} at {loc}. Phone: {phone}. {guardian}Portal: {url}',
    IS: 'ÝMIR VIÐVÖRUN: {boat} ({name}{minor}) yfirtíma {overdue}. Áætlaður skilatími {ret} við {loc}. Sími: {phone}. {guardian}Starfsmannasvæði: {url}'
  },
  'alert.sms.minor': { EN: ', MINOR', IS: ', BARN' },
  'alert.sms.guardian': { EN: 'Guardian: {p}. ', IS: 'Forráðamaður: {p}. ' },
  'resolve.silenced': {
    EN: 'Alert silenced. It will clear automatically when the sailor checks in.',
    IS: 'Viðvörun þögguð. Hún hverfur sjálfkrafa þegar siglingamaðurinn skráir sig inn.'
  },
  'resolve.snoozed': {
    EN: 'Alert snoozed for {n} minutes. You will receive another alert if the sailor has not returned.',
    IS: 'Viðvörun frestað um {n} mínútur. Þú færð aðra viðvörun ef siglingamaðurinn hefur ekki komið til baka.'
  },
  'resolve.invalid': { EN: 'Invalid or expired link.', IS: 'Ógildur eða útrunninn hlekkur.' },
  'resolve.unknown': { EN: 'Unknown operation.', IS: 'Óþekkt aðgerð.' },
  'resolve.error': { EN: 'Error: {msg}', IS: 'Villa: {msg}' },
  'resolve.portal': { EN: '→ Open staff portal', IS: '→ Opna starfsmannasvæðið' },
  // ── Public record pages ──────────────────────────────────────────────────
  'pub.title.lookup':  { EN: 'Sailing Record Lookup', IS: 'Uppfletting siglingaskrár' },
  'pub.title.record':  { EN: 'Sailing Record', IS: 'Siglingaskrá' },
  'pub.title.captain': { EN: 'Captain Record', IS: 'Skipstjórnaskrá' },
  'pub.title.boat':    { EN: 'Boat Record', IS: 'Bátaskrá' },
  'pub.title.share':   { EN: 'Shared Sailing Record', IS: 'Deild siglingaskrá' },
  'pub.lbl.licenceNo': { EN: 'Licence / Certificate Number', IS: 'Skírteinisnúmer' },
  'pub.lbl.initials':  { EN: 'Initials', IS: 'Upphafsstafir' },
  'pub.btn.lookup':    { EN: 'Look up', IS: 'Fletta upp' },
  'pub.err.notFound':  { EN: 'We could not verify those details.', IS: 'Ekki tókst að staðfesta þessar upplýsingar.' },
  'pub.err.missing':   { EN: 'Please enter both licence number and initials.', IS: 'Vinsamlegast sláðu inn bæði skírteinisnúmer og upphafsstafi.' },
  'pub.lbl.sailor':    { EN: 'Sailor', IS: 'Siglingamaður' },
  'pub.lbl.licence':   { EN: 'Licence', IS: 'Skírteini' },
  'pub.lbl.certs':     { EN: 'Credentials', IS: 'Skírteini og réttindi' },
  'pub.lbl.sessions':  { EN: 'Sailing Sessions', IS: 'Siglingalotur' },
  'pub.lbl.date':      { EN: 'Date', IS: 'Dagsetning' },
  'pub.lbl.duration':  { EN: 'Duration', IS: 'Tímalengd' },
  'pub.lbl.distance':  { EN: 'Distance (nm)', IS: 'Vegalengd (nm)' },
  'pub.lbl.boat':      { EN: 'Boat', IS: 'Bátur' },
  'pub.lbl.crew':      { EN: 'Crew', IS: 'Áhöfn' },
  'pub.lbl.captain':   { EN: 'Captain', IS: 'Skipstjóri' },
  'pub.lbl.role':      { EN: 'Role', IS: 'Hlutverk' },
  'pub.lbl.noSessions':{ EN: 'No sailing sessions on record.', IS: 'Engar siglingalotur skráðar.' },
  'pub.lbl.noCerts':   { EN: 'No credentials on record.', IS: 'Engin skírteini skráð.' },
  'pub.lbl.captainSince': { EN: 'Ýmir-approved captain since {date}', IS: 'Viðurkenndur skipstjóri hjá Ými síðan {date}' },
  'pub.lbl.totalSessions':{ EN: 'Total sessions', IS: 'Heildarlotur' },
  'pub.lbl.totalDistance': { EN: 'Total distance', IS: 'Heildarvegalengd' },
  'pub.lbl.totalHours':   { EN: 'Total hours', IS: 'Heildartímar' },
  'pub.lbl.shareTokens':  { EN: 'Access Tokens', IS: 'Aðgangstóknar' },
  'pub.lbl.noTokens':     { EN: 'No access tokens generated.', IS: 'Engir aðgangstóknar búnir til.' },
  'pub.btn.generate':     { EN: 'Generate share link', IS: 'Búa til deilingarhlekk' },
  'pub.btn.revoke':       { EN: 'Revoke', IS: 'Afturkalla' },
  'pub.btn.delete':       { EN: 'Delete', IS: 'Eyða' },
  'pub.lbl.created':      { EN: 'Created', IS: 'Búið til' },
  'pub.lbl.cutOff':       { EN: 'Records up to', IS: 'Skráningar til' },
  'pub.lbl.accesses':     { EN: 'Views', IS: 'Skoðanir' },
  'pub.lbl.revoked':      { EN: 'Revoked', IS: 'Afturkallað' },
  'pub.lbl.active':       { EN: 'Active', IS: 'Virkt' },
  'pub.share.revoked':    { EN: 'This link has been revoked by the holder.', IS: 'Þessi hlekkur hefur verið afturkallaður af eiganda.' },
  'pub.share.asOf':       { EN: 'Sailing record as of {date}. Sessions after this date are not included.', IS: 'Siglingaskrá frá {date}. Lotur eftir þessa dagsetningu eru ekki innifaldar.' },
  'pub.footer':           { EN: 'Record generated {date} by Ýmir Sailing Club · ymir.is', IS: 'Skrá mynduð {date} af Ými Siglingafélagi · ymir.is' },
  'pub.cert.verified':    { EN: 'Verified', IS: 'Staðfest' },
  'pub.cert.pending':     { EN: 'Pending', IS: 'Í bið' },
  'pub.cert.unverified':  { EN: 'Unverified', IS: 'Óstaðfest' },
  'pub.cert.expired':     { EN: 'Expired', IS: 'Útrunnið' },
  'pub.lbl.hours':        { EN: '{h}h', IS: '{h}klst' },
  'pub.lbl.makeModel':    { EN: 'Make / Model', IS: 'Tegund / gerð' },
  'pub.lbl.loa':          { EN: 'LOA', IS: 'Heildarlengd' },
  'pub.lbl.location':     { EN: 'Sailing area', IS: 'Siglingasvæði' },
  'pub.lbl.departed':     { EN: 'Departed', IS: 'Brottfarartími' },
  'pub.lbl.returned':     { EN: 'Returned', IS: 'Komutími' },
  'pub.lbl.crewAboard':   { EN: 'Crew aboard', IS: 'Áhöfn um borð' },
  'pub.lbl.wind':         { EN: 'Wind', IS: 'Vindur' },
  'pub.lbl.notes':        { EN: 'Notes', IS: 'Athugasemdir' },
  'pub.lbl.photos':       { EN: 'Photos', IS: 'Myndir' },
  'pub.lbl.gpsTrack':     { EN: 'GPS Track', IS: 'GPS-leið' },
  'pub.lbl.boatDetails':  { EN: 'Boat Details', IS: 'Upplýsingar um bát' },
  'pub.lbl.tripDetails':  { EN: 'Trip Details', IS: 'Upplýsingar um ferð' },
  'pub.lbl.weather':      { EN: 'Weather', IS: 'Veður' },
  'pub.lbl.ports':        { EN: 'Ports', IS: 'Höfnar' },
  'pub.lbl.direction':    { EN: 'Direction', IS: 'Átt' },
  'pub.lbl.gusts':        { EN: 'Gusts', IS: 'Hvassviðri' },
  'pub.lbl.airTemp':      { EN: 'Air temp', IS: 'Hitastig' },
  'pub.lbl.seaTemp':      { EN: 'Sea temp', IS: 'Sjávarhiti' },
  'pub.lbl.waveHeight':   { EN: 'Wave height', IS: 'Bylgjuhæð' },
  'pub.lbl.pressure':     { EN: 'Pressure', IS: 'Loftþrýstingur' },
  'pub.lbl.conditions':   { EN: 'Conditions', IS: 'Aðstæður' },
};

function gs_(key, vars, lang) {
  const L = lang || CLUB_LANG_;
  const entry = GS_STRINGS_[key];
  if (!entry) return key;
  let str = entry[L] || entry['EN'] || key;
  if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
  return str;
}


// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function ss_() { return SpreadsheetApp.openById(SHEET_ID_); }
function now_() { return new Date().toISOString(); }
// Script-timezone formatters — use these for defaults that go into sheet
// columns whose values round-trip as local (trip `date`, `timeOut`, `timeIn`,
// `checkedOutAt`, `checkedInAt`, `expectedReturn`). Slicing `now_()` instead
// silently stores UTC, which drifts from what the user sees whenever the
// script timezone isn't UTC.
function nowLocalDate_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function nowLocalTime_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm'); }
function nowLocalDateTime_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm"); }
// Required-column lookup. Use this when you INDEX into a row with the result
// (e.g. values[i][col]) — a plain headers.indexOf() silently returns -1 and
// miswrites to/reads from column "−1" if the sheet drifts from the code.
// requiredCol_ throws loudly instead, turning a silent bug into a stack trace.
// For existence checks (e.g. addColIfMissing_) keep using headers.indexOf().
function requiredCol_(headers, name) {
  var i = headers.indexOf(name);
  if (i < 0) throw new Error('Missing column "' + name + '" in sheet');
  return i;
}
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }
function bool_(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; }
// Prefix a literal apostrophe onto any string whose first character Sheets
// would interpret as a formula (=, +, -, @) or a line-breaking control
// (CR/LF/TAB). The apostrophe itself is not rendered to the user; it just
// forces Sheets to treat the cell as text. Non-strings pass through.
//
// Also applies to HH:MM time-literal strings ("09:00", "23:45") and ISO
// date strings ("2026-04-23"). Sheets would otherwise auto-parse those into
// Date values anchored to the 1899-12-30 epoch, and a round-trip through
// `sanitizeCell_` may then drift by the delta between the sheet's timezone
// and the script's timezone for that historical date (Atlantic/Reykjavik's
// pre-1908 LMT offset has bitten us here — observed as 16-minute drift per
// round-trip). Forcing text storage sidesteps the auto-conversion entirely.
//
// Named distinctly from the read-side `sanitizeCell_(col, val)` normalizer.
var TIME_LITERAL_RE_ = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
var DATE_LITERAL_RE_ = /^\d{4}-\d{2}-\d{2}$/;
function literalWrite_(v) {
  if (typeof v !== 'string' || v === '') return v;
  var c = v.charCodeAt(0);
  if (c === 0x3D || c === 0x2B || c === 0x2D || c === 0x40 ||
      c === 0x0D || c === 0x0A || c === 0x09) return "'" + v;
  if (TIME_LITERAL_RE_.test(v) || DATE_LITERAL_RE_.test(v)) return "'" + v;
  return v;
}
function okJ(data) { return jsonR_({ success: true, ...data }); }
function failJ(msg, code) { return jsonR_({ success: false, error: msg, code: code || 400 }); }
function jsonR_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function htmlR_(html) { return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT); }

// ── Public-endpoint rate limiter ────────────────────────────────────────────
// Apps Script doesn't expose client IP, so limits are global per-bucket (or
// per bucket+input, e.g. per licence_number). Backed by CacheService which
// auto-expires entries. Not a defence against distributed scans, but a
// meaningful speed-bump against a single attacker hitting the public routes.
function publicRateLimit_(bucket, limit, windowSec) {
  var cache = CacheService.getScriptCache();
  var key = 'rl_' + bucket;
  var count = parseInt(cache.get(key) || '0', 10);
  if (count >= limit) return false;
  // CacheService.put doesn't extend the window on re-puts, so on first hit
  // we seed with ttl=windowSec and subsequent hits keep that window. Side
  // effect: a flood of requests in a single window gets bucketed together,
  // which is the intended behaviour.
  cache.put(key, String(count + 1), windowSec);
  return true;
}

function rateLimitedPage_(msg) {
  return htmlR_(pubPageShell_('Too many requests',
    '<div class="err-msg">' + (msg || 'Too many requests. Please wait a minute and try again.') + '</div>'));
}
function shareUid_() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var hex = Utilities.getUuid().replace(/-/g, '');
  var id = '';
  for (var i = 0; i < 8; i++) id += chars[parseInt(hex.substr(i * 2, 2), 16) % 62];
  return id;
} // 8 base62 chars, ~47-bit entropy

// Spec §7.1 — extract initials from a name
// Split on spaces, drop all-lowercase tokens (connectors like 'van','de','af'),
// strip hyphens, take first char of each remaining token, uppercase.
function extractInitials_(name) {
  if (!name) return '';
  return String(name).trim().split(/\s+/)
    .filter(function(t) { return t && t !== t.toLowerCase(); })
    .map(function(t) { return t.replace(/-/g, '').charAt(0); })
    .join('').toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD HASHING
// Passwords are stretched with PBKDF2-HMAC-SHA256 using a random 16-byte salt
// per password. The stored value is self-describing so iteration counts can
// be tuned later without a schema change:
//   pbkdf2-sha256$<iterations>$<base64 salt>$<base64 hash>
// There is no shared default password; admin-issued temp passwords are
// generated per-member by genTempPassword_() and flagged via the members
// sheet column `passwordIsTemp` so the login flow can force a change.
// ─────────────────────────────────────────────────────────────────────────────
// Iteration count is limited by Apps Script's per-HMAC-call overhead
// (roughly single-digit ms in practice, so 100k would stall login).
// 10k is the highest we can run while keeping login comfortably under
// a few seconds; the self-describing hash format above lets us bump it
// later without a schema change.
const PBKDF2_ITERATIONS_ = 10000;

// 10-character random password using an unambiguous alphabet (no O/0/I/1/l).
// Used for admin-issued temp passwords — communicated to the member once and
// replaced by a user-chosen password on first login.
function genTempPassword_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Date.now(),
    Utilities.Charset.UTF_8);
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[(bytes[i] & 0xff) % chars.length];
  return out;
}

function genSalt16_() {
  // UUID v4 gives ~122 bits of randomness; two of them hashed to SHA-256 and
  // truncated to 16 bytes yields a uniform salt well above the birthday bound
  // for any realistic user population.
  const seed = Utilities.getUuid() + Utilities.getUuid();
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  return bytes.slice(0, 16);
}

// PBKDF2-HMAC-SHA256, one output block (32 bytes). Apps Script's HMAC
// primitive is slow-ish, so 100k iterations is the target; adjust via
// PBKDF2_ITERATIONS_ if login latency becomes a problem.
function pbkdf2_(password, saltBytes, iterations) {
  const passBytes = Utilities.newBlob(String(password)).getBytes();
  // Salt || INT(1) — block index is always 1 since we only need 32 bytes.
  const block = saltBytes.concat([0, 0, 0, 1]);
  let u = Utilities.computeHmacSha256Signature(block, passBytes);
  const t = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, passBytes);
    for (let j = 0; j < t.length; j++) t[j] = (t[j] ^ u[j]);
  }
  return t;
}

function hashPassword_(password) {
  if (!password) return '';
  const salt = genSalt16_();
  const hash = pbkdf2_(password, salt, PBKDF2_ITERATIONS_);
  return 'pbkdf2-sha256$' + PBKDF2_ITERATIONS_ + '$' +
         Utilities.base64Encode(salt) + '$' + Utilities.base64Encode(hash);
}

function verifyPassword_(member, password) {
  if (!member || !password) return false;
  const stored = String(member.passwordHash || '').trim();
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iter = parseInt(parts[1], 10);
  if (!iter || iter < 1000 || iter > 10000000) return false;
  const salt = Utilities.base64Decode(parts[2]);
  const expected = Utilities.base64Decode(parts[3]);
  const actual = pbkdf2_(password, salt, iter);
  if (actual.length !== expected.length) return false;
  // Constant-time compare to avoid leaking the matching prefix via timing.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= (actual[i] ^ expected[i]);
  return diff === 0;
}

// One-shot helper for the Apps Script editor. Issue a temporary password
// for an existing admin so someone can log in and use the admin UI to
// reset the rest. Logs the plaintext to the execution log — no
// persistence, no sheet write beyond the hash.
//
// Usage:
//   1. Project Settings → Script Properties → set `BOOTSTRAP_KENNITALA`
//      to the admin's 10-digit kennitala.
//   2. Optionally set `BOOTSTRAP_PRESET_PASSWORD` to a password of your
//      choosing (skip to let the helper generate a random one).
//   3. Select `bootstrapAdminPassword` → Run.
//   4. Copy the password from the execution log.
//   5. Delete both Script Properties once you're signed in.
function bootstrapAdminPassword() {
  const props = PropertiesService.getScriptProperties();
  const kt = String(props.getProperty('BOOTSTRAP_KENNITALA') || '').trim();
  if (!kt) {
    Logger.log('Set Script Property BOOTSTRAP_KENNITALA to the admin kennitala, then run again.');
    return;
  }
  const preset = String(props.getProperty('BOOTSTRAP_PRESET_PASSWORD') || '').trim();
  // Go directly to the sheet instead of through the usual helpers so stale
  // caches or missing-header edge cases can't swallow the write silently.
  const sheet = ss_().getSheetByName(TABS_.members);
  if (!sheet) { Logger.log('members sheet not found'); return; }
  const lastCol = sheet.getLastColumn();
  let headers  = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  function ensureCol(name) {
    if (headers.indexOf(name) >= 0) return;
    sheet.getRange(1, headers.length + 1).setValue(name);
    SpreadsheetApp.flush();
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }
  ensureCol('passwordHash');
  ensureCol('passwordIsTemp');

  const ktCol   = headers.indexOf('kennitala');
  const hashCol = headers.indexOf('passwordHash');
  const tempCol = headers.indexOf('passwordIsTemp');
  const updCol  = headers.indexOf('updatedAt');
  if (ktCol < 0 || hashCol < 0 || tempCol < 0) {
    Logger.log('Expected columns missing: kennitala=' + ktCol + ', passwordHash=' + hashCol + ', passwordIsTemp=' + tempCol);
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('members sheet is empty'); return; }
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  let rowIdx = -1;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][ktCol]).trim() === kt) { rowIdx = i; break; }
  }
  if (rowIdx < 0) { Logger.log('No member with kennitala ' + kt); return; }

  const temp = preset || genTempPassword_();
  const hash = hashPassword_(temp);
  Logger.log('Writing hash of length ' + hash.length + ' to row ' + (rowIdx + 2));
  if (preset) Logger.log('Using preset password from BOOTSTRAP_PRESET_PASSWORD.');
  sheet.getRange(rowIdx + 2, hashCol + 1).setValue(hash);
  sheet.getRange(rowIdx + 2, tempCol + 1).setValue(true);
  if (updCol >= 0) sheet.getRange(rowIdx + 2, updCol + 1).setValue(now_());
  SpreadsheetApp.flush();
  try { cDel_('members'); } catch (e) {}
  try { invalidateSheetCache_('members'); } catch (e) {}

  const name = String(data[rowIdx][headers.indexOf('name')] || kt);
  Logger.log('Temporary password for ' + name + ': ' + temp);
  Logger.log('Sign in, then use the admin UI to issue temp passwords for everyone else.');
  Logger.log('Remember to delete the BOOTSTRAP_KENNITALA Script Property afterwards.');
}

// Editor-run diagnostic: round-trip a generated password through
// hashPassword_ / verifyPassword_ and log whether it verifies. If this
// prints "verify ok" but real logins still fail, the bug is in the
// storage/login path, not the crypto.
function testPasswordRoundTrip() {
  const pw = genTempPassword_();
  const hash = hashPassword_(pw);
  Logger.log('password: ' + pw);
  Logger.log('hash:     ' + hash);
  Logger.log('hash len: ' + hash.length);
  const okGood = verifyPassword_({ passwordHash: hash }, pw);
  const okBad  = verifyPassword_({ passwordHash: hash }, pw + 'x');
  Logger.log('verify correct password: ' + okGood + '  (expected true)');
  Logger.log('verify wrong password:   ' + okBad  + '  (expected false)');
}

// Editor-run diagnostic: replays the login read-path against an actual
// stored member and verifies a password. Reads the kennitala from
// BOOTSTRAP_KENNITALA and the password from BOOTSTRAP_TEST_PASSWORD,
// falling back to BOOTSTRAP_PRESET_PASSWORD if the test prop is unset
// (so the same value used to seed the bootstrap works for the test).
function testVerifyStoredHash() {
  const props = PropertiesService.getScriptProperties();
  const kt = String(props.getProperty('BOOTSTRAP_KENNITALA') || '').trim();
  const pw = String(
    props.getProperty('BOOTSTRAP_TEST_PASSWORD') ||
    props.getProperty('BOOTSTRAP_PRESET_PASSWORD') ||
    ''
  ).trim();
  if (!kt || !pw) {
    Logger.log('Set BOOTSTRAP_KENNITALA and either BOOTSTRAP_PRESET_PASSWORD or BOOTSTRAP_TEST_PASSWORD.');
    return;
  }
  clearSheetCache_();
  const m = findOne_('members', 'kennitala', kt);
  if (!m) { Logger.log('no member with kennitala ' + kt); return; }
  const stored = String(m.passwordHash || '');
  Logger.log('kennitala:         ' + kt);
  Logger.log('password entered:  "' + pw + '" (length ' + pw.length + ')');
  Logger.log('stored hash:       "' + stored + '"');
  Logger.log('stored type:       ' + typeof m.passwordHash);
  Logger.log('stored length:     ' + stored.length);
  Logger.log('stored starts:     ' + stored.substring(0, 22));
  const parts = stored.split('$');
  Logger.log('parts count:       ' + parts.length);
  if (parts.length === 4) {
    Logger.log('algo:              ' + parts[0]);
    Logger.log('iterations:        ' + parts[1]);
    Logger.log('salt b64 length:   ' + parts[2].length);
    Logger.log('hash b64 length:   ' + parts[3].length);
  }
  const ok = verifyPassword_(m, pw);
  Logger.log('verifyPassword_ result: ' + ok);
  if (ok) return;
  // Mismatch — dump the raw byte arrays so we can see where the divergence
  // is. `expected` comes from the stored hash, `actual` is what we just
  // computed from the entered password + same salt + same iterations.
  if (parts.length !== 4) return;
  const salt     = Utilities.base64Decode(parts[2]);
  const expected = Utilities.base64Decode(parts[3]);
  const iter     = parseInt(parts[1], 10);
  const actual   = pbkdf2_(pw, salt, iter);
  Logger.log('salt bytes:     [' + Array.prototype.slice.call(salt).join(',') + ']');
  Logger.log('expected bytes: [' + Array.prototype.slice.call(expected).join(',') + ']');
  Logger.log('actual bytes:   [' + Array.prototype.slice.call(actual).join(',') + ']');
  Logger.log('expected type ctor: ' + (expected.constructor && expected.constructor.name));
  Logger.log('actual type ctor:   ' + (actual.constructor && actual.constructor.name));
  // Also re-hash with the same password from scratch and log that hash;
  // if the resulting string differs from `stored`, the bug is in
  // determinism (salt generation, byte-type coercion in concat, etc.).
  // If it matches, the bug is in verify-side parsing.
  const freshHash = hashPassword_(pw);
  Logger.log('fresh hashPassword_ result: ' + freshHash);
  Logger.log('matches stored (whole): ' + (freshHash === stored));
}

// Editor-run helper: clear the login rate-limit lockout for
// BOOTSTRAP_KENNITALA so the next login attempt isn't rejected by
// `checkLoginRate_`. Use after a debugging session where repeated
// failed attempts have tripped the 5-in-15-min lockout.
function clearLoginLockout() {
  const kt = String(
    PropertiesService.getScriptProperties().getProperty('BOOTSTRAP_KENNITALA') || ''
  ).trim();
  if (!kt) { Logger.log('Set BOOTSTRAP_KENNITALA first.'); return; }
  clearLoginAttempts_(kt);
  Logger.log('Cleared login_attempts row for ' + kt + '. You can try signing in again.');
}

// Find a member for login by either kennitala (10 digits) or initials
// (case-insensitive). Returns { member, ambiguous, notFound } so the caller
// can surface a specific error when initials collide between members.
function findMemberForLogin_(username) {
  if (!username) return { notFound: true };
  const u = String(username).trim();
  if (!u) return { notFound: true };
  const digits = u.replace(/\D/g, '');
  if (digits.length === 10) {
    const m = findOne_('members', 'kennitala', digits);
    if (m) return { member: m };
    return { notFound: true };
  }
  const up = u.toUpperCase();
  const matches = readAll_('members').filter(function(m) {
    if (!bool_(m.active)) return false;
    const init = String(m.initials || extractInitials_(m.name) || '').toUpperCase();
    return init && init === up;
  });
  if (matches.length === 0) return { notFound: true };
  if (matches.length > 1)  return { ambiguous: true };
  return { member: matches[0] };
}

// HTML-escape for server-rendered pages
function esc_(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }


// ─────────────────────────────────────────────────────────────────────────────
// SESSION TOKENS
// Every authenticated API call carries `sessionToken` in its JSON body. The
// server never stores the raw token — it stores SHA-256(token) in the
// `sessions` sheet. A stolen sheet cannot be used to hijack live sessions.
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_COLS_ = [
  'id', 'kennitala', 'tokenHash', 'role', 'createdAt',
  'lastSeenAt', 'expiresAt', 'stayLoggedIn', 'userAgent',
];
const LOGIN_ATTEMPT_COLS_ = ['kennitala', 'firstAt', 'count', 'blockedUntil'];

// Create the sheet lazily if it's missing. Called from every session/rate-
// limit helper so a fresh deployment doesn't need a manual setup step.
function ensureSheet_(tabKey, columns) {
  const name = TABS_[tabKey] || tabKey;
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = _reconcileLegacyTab_(ss, name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, columns.length).setValues([columns]);
    sh.setFrozenRows(1);
    invalidateSheetCache_(tabKey);
    return sh;
  }
  // Ensure all expected headers exist (additive migrations only).
  columns.forEach(function(c) { addColIfMissing_(tabKey, c); });
  return sh;
}

// 256-bit random token, base64url-encoded (no padding). Two UUIDs give 256
// bits of entropy; Apps Script has no direct access to a CSPRNG byte API but
// getUuid() is cryptographically random per the V8 runtime docs.
function randomToken_() {
  const hex = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function hashToken_(token) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(token || ''), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

// Truncate the User-Agent string so a malicious client cannot blow up a row
// with megabytes of junk, while still preserving enough to identify a device.
function trimUA_(ua) {
  ua = String(ua == null ? '' : ua);
  return ua.length > 200 ? ua.slice(0, 200) : ua;
}

function createSession_(kennitala, role, stayLoggedIn, userAgent) {
  ensureSheet_('sessions', SESSION_COLS_);
  const raw = randomToken_();
  const hash = hashToken_(raw);
  const ttl  = stayLoggedIn ? SESSION_TTL_LONG_MS_ : SESSION_TTL_SHORT_MS_;
  const now = Date.now();
  const session = {
    id:            uid_(),
    kennitala:     String(kennitala || ''),
    tokenHash:     hash,
    role:          String(role || 'member'),
    createdAt:     new Date(now).toISOString(),
    lastSeenAt:    new Date(now).toISOString(),
    expiresAt:     new Date(now + ttl).toISOString(),
    stayLoggedIn:  !!stayLoggedIn,
    userAgent:     trimUA_(userAgent),
  };
  insertRow_('sessions', session);
  return { token: raw, expiresAt: session.expiresAt, id: session.id };
}

function findSessionByHash_(hash) {
  ensureSheet_('sessions', SESSION_COLS_);
  return findOne_('sessions', 'tokenHash', hash);
}

function deleteSessionByHash_(hash) {
  try { deleteRow_('sessions', 'tokenHash', hash); } catch (e) {}
}

function deleteSessionById_(id) {
  try { return deleteRow_('sessions', 'id', id); } catch (e) { return false; }
}

// Revoke every session belonging to a member, optionally keeping one token's
// session alive (so "changed my password" can sign out every *other* device).
// Returns the count of sessions that were removed.
function revokeSessionsForMember_(kennitala, exceptHash) {
  ensureSheet_('sessions', SESSION_COLS_);
  const kt = String(kennitala || '').trim();
  if (!kt) return 0;
  const rows = readAll_('sessions').filter(function(r) {
    return String(r.kennitala || '').trim() === kt && r.tokenHash !== exceptHash;
  });
  let n = 0;
  rows.forEach(function(r) {
    if (deleteRow_('sessions', 'id', r.id)) n++;
  });
  return n;
}

// Slide expiry for long-lived ("stay logged in") sessions whenever they're
// touched. Short sessions keep their original expiry. lastSeenAt is throttled
// so the sheet isn't written on every request; 60s resolution is good enough
// for "recent activity" displays.
function touchSession_(session) {
  const now = Date.now();
  const last = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
  const updates = {};
  if (now - last >= SESSION_TOUCH_INTERVAL_MS_) {
    updates.lastSeenAt = new Date(now).toISOString();
  }
  if (bool_(session.stayLoggedIn)) {
    const newExpiry = now + SESSION_TTL_LONG_MS_;
    const curExpiry = session.expiresAt ? new Date(session.expiresAt).getTime() : 0;
    // Only write when the slide is meaningful (more than a day past current).
    if (newExpiry - curExpiry > 24 * 60 * 60 * 1000) {
      updates.expiresAt = new Date(newExpiry).toISOString();
    }
  }
  if (Object.keys(updates).length) {
    updateRow_('sessions', 'id', session.id, updates);
  }
}

// Resolve the caller from a request body. Returns { kennitala, role, session }
// on success, or null if the session is missing/expired/invalid. Expired
// sessions are deleted on encounter so the sheet self-cleans.
function authCaller_(b) {
  const raw = String((b && b.sessionToken) || '').trim();
  if (!raw) return null;
  const hash = hashToken_(raw);
  const session = findSessionByHash_(hash);
  if (!session) return null;
  const now = Date.now();
  const expiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : 0;
  if (!expiresAt || expiresAt < now) {
    deleteSessionByHash_(hash);
    return null;
  }
  // Member role/active state can change after login; always re-check.
  const m = findOne_('members', 'kennitala', String(session.kennitala || '').trim());
  if (!m || !bool_(m.active)) {
    deleteSessionByHash_(hash);
    return null;
  }
  touchSession_(session);
  return {
    kennitala: String(m.kennitala),
    role:      String(m.role || session.role || 'member'),
    member:    m,
    session:   session,
    tokenHash: hash,
  };
}

function isAdmin_(caller) { return caller && caller.role === 'admin'; }
function isStaff_(caller) { return caller && (caller.role === 'staff' || caller.role === 'admin'); }

// Authoritative actor identity for audit columns. Use these instead of
// trusting any client-supplied display string (e.g. b.updatedBy, user.name) —
// caller comes from authCaller_ which re-reads the members row each call.
function actorKt_(caller)   { return caller && caller.kennitala ? String(caller.kennitala) : ''; }
function actorName_(caller) { return caller && caller.member && caller.member.name ? String(caller.member.name) : ''; }

// Decide whether `caller` is permitted to run `action` with body `b`.
// Returns null on allow or a failJ response on deny. Centralises all
// role/self-or-admin gating so route_ stays a plain dispatch table.
function authorize_(action, caller, b) {
  if (!caller) return failJ('Unauthorized', 401);
  if (ADMIN_ACTIONS_[action] && !isAdmin_(caller)) {
    return failJ('Admin only', 403);
  }
  if (STAFF_ACTIONS_[action] && !isStaff_(caller)) {
    return failJ('Staff only', 403);
  }
  // Self-or-admin: caller.kennitala must equal the body's target kennitala,
  // or the caller is an admin (useful for password resets, etc.).
  const ktField = SELF_OR_ADMIN_ACTIONS_[action];
  if (ktField) {
    const target = String((b && b[ktField]) || '').trim();
    if (!target) return failJ('kennitala required');
    if (target !== caller.kennitala && !isAdmin_(caller)) {
      return failJ('Forbidden', 403);
    }
  }
  // saveMemberCert is targeted by memberId, not kennitala.
  if (action === 'saveMemberCert') {
    const mid = String((b && b.memberId) || '').trim();
    if (!mid) return failJ('memberId required');
    if (!isAdmin_(caller)) {
      const m = findOne_('members', 'id', mid);
      if (!m || String(m.kennitala) !== caller.kennitala) {
        return failJ('Forbidden', 403);
      }
    }
  }
  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// LOGIN RATE LIMITING
// Keyed by kennitala only — Apps Script does not reliably expose the caller's
// IP. 5 failures in a 15-min window trip a 15-min lockout. A successful login
// clears the counter. Admin "reset password" also clears.
// ─────────────────────────────────────────────────────────────────────────────
function checkLoginRate_(kennitala) {
  ensureSheet_('loginAttempts', LOGIN_ATTEMPT_COLS_);
  const row = findOne_('loginAttempts', 'kennitala', String(kennitala).trim());
  if (!row) return { ok: true };
  const now = Date.now();
  const blockedUntil = row.blockedUntil ? new Date(row.blockedUntil).getTime() : 0;
  if (blockedUntil && blockedUntil > now) {
    return { ok: false, retryAt: new Date(blockedUntil).toISOString() };
  }
  return { ok: true };
}

function bumpLoginAttempts_(kennitala) {
  ensureSheet_('loginAttempts', LOGIN_ATTEMPT_COLS_);
  const kt = String(kennitala).trim();
  if (!kt) return;
  const row = findOne_('loginAttempts', 'kennitala', kt);
  const now = Date.now();
  if (!row) {
    insertRow_('loginAttempts', {
      kennitala: kt, firstAt: new Date(now).toISOString(), count: 1, blockedUntil: '',
    });
    return;
  }
  const firstAtMs = row.firstAt ? new Date(row.firstAt).getTime() : now;
  if (now - firstAtMs > LOGIN_WINDOW_MS_) {
    updateRow_('loginAttempts', 'kennitala', kt, {
      firstAt: new Date(now).toISOString(), count: 1, blockedUntil: '',
    });
    return;
  }
  const newCount = (parseInt(row.count) || 0) + 1;
  const updates = { count: newCount };
  if (newCount >= LOGIN_MAX_ATTEMPTS_) {
    updates.blockedUntil = new Date(now + LOGIN_LOCKOUT_MS_).toISOString();
  }
  updateRow_('loginAttempts', 'kennitala', kt, updates);
}

function clearLoginAttempts_(kennitala) {
  const kt = String(kennitala || '').trim();
  if (!kt) return;
  try { deleteRow_('loginAttempts', 'kennitala', kt); } catch (e) {}
}

// Fixed-window rate limit on authenticated actions. Keyed by caller kennitala
// + bucket + current minute, so a new window opens every 60s automatically.
// Internal `__system` callers (time triggers invoking route_ directly) are
// exempt because they aren't subject to the user-facing fairness contract.
function checkMutationRate_(caller, action) {
  if (!caller || caller.__system) return { ok: true };
  const bucket = BULK_ACTIONS_[action] ? 'bulk' : 'normal';
  const limit  = BULK_ACTIONS_[action] ? MUTATION_RATE_BULK_ : MUTATION_RATE_NORMAL_;
  const minute = Math.floor(Date.now() / 60000);
  const key    = 'rate_' + bucket + '_' + caller.kennitala + '_' + minute;
  const cache  = CacheService.getScriptCache();
  const cur    = parseInt(cache.get(key) || '0', 10);
  if (cur >= limit) return { ok: false };
  // TTL of 120s covers the current window plus enough slack that read-modify-
  // write races on the boundary don't lose the counter entirely.
  cache.put(key, String(cur + 1), 120);
  return { ok: true };
}

// Time-driven trigger: wipe expired session rows. Safe to run infrequently
// because authCaller_ also removes expired rows on encounter.
function sweepExpiredSessions() {
  try { clearSheetCache_(); } catch (e) {}
  ensureSheet_('sessions', SESSION_COLS_);
  const now = Date.now();
  const rows = readAll_('sessions');
  let n = 0;
  rows.forEach(function(r) {
    const exp = r.expiresAt ? new Date(r.expiresAt).getTime() : 0;
    if (!exp || exp < now) {
      if (deleteRow_('sessions', 'id', r.id)) n++;
    }
  });
  return n;
}


// ─────────────────────────────────────────────────────────────────────────────
// SHEET HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Self-healing tab renames. Key = canonical sheet tab name; value = list of
// legacy names to fall back to. If the canonical tab is missing but a legacy
// name is present, _reconcileLegacyTab_ renames it via setName so existing
// data is preserved and subsequent calls find it normally. Idempotent — a
// no-op once the rename has happened.
const LEGACY_TAB_ALIASES_ = {
  'activities': ['scheduled_events'],
};

function _reconcileLegacyTab_(ss, canonicalName) {
  var aliases = LEGACY_TAB_ALIASES_[canonicalName];
  if (!aliases || !aliases.length) return null;
  for (var i = 0; i < aliases.length; i++) {
    var legacyName = aliases[i];
    if (legacyName === canonicalName) continue;
    var legacy = ss.getSheetByName(legacyName);
    if (legacy) {
      legacy.setName(canonicalName);
      Logger.log('Renamed legacy sheet tab: "' + legacyName + '" → "' + canonicalName + '"');
      return legacy;
    }
  }
  return null;
}

function getSheet_(tabKey) {
  const name = TABS_[tabKey] || tabKey;
  const ss = ss_();
  let s = ss.getSheetByName(name);
  if (!s) s = _reconcileLegacyTab_(ss, name);
  if (!s) throw new Error('Tab not found: ' + name);
  return s;
}

const TIME_COLS_ = new Set(['checkedOutAt', 'checkedInAt', 'expectedReturn', 'timeOut', 'timeIn', 'returnBy', 'startTime', 'endTime']);

// Columns that must always be strings even when Sheets auto-parses them as
// numbers (e.g. 10-digit kennitalas, numeric IDs, phone numbers).
// Matched by regex against the column header name so new columns inherit
// the protection automatically.
const STRING_COL_RE_ = /kennitala|phone|[Ii]d$|^id$|description|notes|name|title|involved|witnesses|immediateAction|followUp|handOff|filedAt|time$/i;

function sanitizeCell_(col, val) {
  if (val instanceof Date) {
    // Format in the script timezone rather than slicing an ISO (UTC)
    // string. Sheets stores cell values as local-time Date objects, so
    // UTC slicing drifts by the zone offset — including historical
    // sub-hour offsets (e.g. Atlantic/Reykjavik LMT for 1899-dated
    // time-only cells), which surfaces as mis-displayed HH:MM values.
    //
    // For 1899-epoch time-only cells we format using the *sheet's*
    // timezone (not the script's). Sheets anchored the value at
    // 1899-12-30 using whatever its own timezone was, and any TZ-data
    // disagreement with the script's TZ at that historical instant (the
    // classic 2×16-minute Reykjavik LMT drift bug) shows up if we mix
    // the two. Use the same TZ that wrote the value to read it back.
    const iso = val.toISOString();
    if (iso.startsWith('1899-12-3') || iso.startsWith('1899-12-2')) {
      return Utilities.formatDate(val, getSheetTz_(), 'HH:mm');
    }
    const tz = Session.getScriptTimeZone();
    return TIME_COLS_.has(col)
      ? Utilities.formatDate(val, tz, 'HH:mm')
      : Utilities.formatDate(val, tz, 'yyyy-MM-dd');
  }
  // Sheets occasionally hands a TIME_COL back as a number (serial fraction
  // of day) instead of a Date — happens when the cell was written without
  // literalWrite_'s leading apostrophe and Sheets auto-converted "16:00"
  // into a numeric time. Without this branch the next clause stringifies
  // the float ("0.6666666666666666") and the frontend sees a number-shaped
  // string in a time field. Convert the fraction back to HH:mm.
  if (val != null && typeof val === 'number' && TIME_COLS_.has(col)) {
    var frac = val - Math.floor(val);
    if (frac < 0) frac += 1;
    var totalMin = Math.round(frac * 1440);
    if (totalMin === 1440) totalMin = 0;
    var h = Math.floor(totalMin / 60), m = totalMin % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  if (val != null && typeof val === 'number' && STRING_COL_RE_.test(col)) {
    return String(val);
  }
  return val;
}

// Per-request cached lookup of the spreadsheet's timezone. Cleared by
// clearSheetCache_ at entry points (doGet/doPost/triggers). Called from
// sanitizeCell_ on every 1899-epoch cell read; caching avoids hammering
// SpreadsheetApp.openById on a hot path.
var _sheetTz_ = null;
function getSheetTz_() {
  if (_sheetTz_) return _sheetTz_;
  try { _sheetTz_ = ss_().getSpreadsheetTimeZone(); }
  catch (e) { _sheetTz_ = Session.getScriptTimeZone(); }
  return _sheetTz_;
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST-SCOPED SHEET CACHE
// Each Google Sheets read (sheet.getDataRange().getValues()) is the dominant
// latency cost in Apps Script.  Memoize raw sheet data per tab inside one
// doGet/doPost/trigger invocation so reads after the first hit memory only.
// Cleared at every entry point — see doGet/doPost/checkAndSendOverdueAlerts.
// ─────────────────────────────────────────────────────────────────────────────
var _sheetCache_ = {}; // tabKey -> { sheet, headers, values, sanitized }

function clearSheetCache_() { _sheetCache_ = {}; _sheetTz_ = null; }
function invalidateSheetCache_(tabKey) { delete _sheetCache_[tabKey]; }

function getSheetData_(tabKey) {
  if (_sheetCache_[tabKey]) return _sheetCache_[tabKey];
  const sheet = getSheet_(tabKey);
  const data = sheet.getDataRange().getValues();
  // Trim header strings — a stray trailing space on a manually edited cell
  // would otherwise break headers.indexOf() / .includes() and trick
  // addColIfMissing_ into appending a duplicate column with the same
  // logical name. Trim happens once here so every downstream caller sees
  // clean keys.
  const headers = (data[0] || []).map(function (h) { return String(h).trim(); });
  // Loudly flag duplicate headers — they cause silent write/read divergence:
  // updateRow_ / findOne_ / addColIfMissing_ key off the first match
  // (indexOf), but readAll_'s `headers.forEach((h,i) => o[h] = …)` lets the
  // last occurrence overwrite the first into the same JS key. So writes hit
  // one column and reads return the other. Surface once per cache load
  // (cached by getSheetData_ itself) so the warning fires when the data is
  // actually read but doesn't spam every individual call.
  var _seen = {}, _dupes = [];
  for (var _i = 0; _i < headers.length; _i++) {
    var _h = headers[_i];
    if (!_h) continue;
    if (_seen[_h]) { if (_dupes.indexOf(_h) === -1) _dupes.push(_h); }
    else _seen[_h] = true;
  }
  if (_dupes.length) {
    Logger.log('⚠ Duplicate headers in tab "' + (TABS_[tabKey] || tabKey) + '": '
      + _dupes.join(', ')
      + ' — writes hit indexOf(first), reads keep the last; clean the sheet.');
  }
  // Raw, unfiltered — updateRow_'s (i + 2) arithmetic depends on this array
  // matching the actual sheet row positions. readAll_ applies the
  // trailing-blank filter in its mapping step.
  const values = data.length >= 1 ? data.slice(1) : [];
  _sheetCache_[tabKey] = { sheet: sheet, headers: headers, values: values, sanitized: null };
  return _sheetCache_[tabKey];
}

function readAll_(tabKey) {
  const c = getSheetData_(tabKey);
  if (c.sanitized) return c.sanitized;
  const headers = c.headers;
  if (!headers.length) { c.sanitized = []; return c.sanitized; }
  c.sanitized = c.values
    .map(row => {
      const o = {};
      headers.forEach((h, i) => { o[h] = sanitizeCell_(h, row[i]); });
      return o;
    })
    .filter(r => r[headers[0]] !== '' && r[headers[0]] !== null);
  return c.sanitized;
}

function findOne_(tabKey, field, value) {
  return readAll_(tabKey).find(r => String(r[field]).trim() === String(value).trim()) || null;
}

// Google Sheets cell cap is 50,000 chars; leave a safety margin so writes
// don't silently truncate or hit API errors on edge cases.
const VALIDATE_MAX_FIELD_LEN_ = 45000;

// Guards insertRow_ / updateRow_ against bad input. Doesn't enforce per-tab
// schemas (business logic owns required-field checks at the endpoint level)
// — it only catches unknown tabs, non-object payloads, and oversized strings
// before they reach the sheet.
function validateRow_(tabKey, obj) {
  if (!TABS_[tabKey]) throw new Error('validateRow_: unknown tabKey ' + tabKey);
  if (!obj || typeof obj !== 'object') throw new Error('validateRow_: row must be an object');
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    var v = obj[k];
    if (typeof v === 'string' && v.length > VALIDATE_MAX_FIELD_LEN_) {
      throw new Error('validateRow_: field "' + k + '" length ' + v.length
                      + ' exceeds max ' + VALIDATE_MAX_FIELD_LEN_);
    }
  }
  return true;
}

function insertRow_(tabKey, obj) {
  validateRow_(tabKey, obj);
  const c = getSheetData_(tabKey);
  const row = c.headers.map(h => literalWrite_(obj[h] !== undefined ? obj[h] : ''));
  c.sheet.appendRow(row);
  // appendRow lands at the first blank row, which may not equal
  // values.length + 2 if the sheet has trailing blanks. Invalidate to keep
  // the index invariant trivially correct.
  invalidateSheetCache_(tabKey);
}

function addColIfMissing_(tabKey, colName) {
  // Trim defensively — every sheet read trims headers (see getSheetData_),
  // so the comparison would mismatch if the caller passed a name with stray
  // whitespace; same for the value we'd write into the new cell.
  var col = String(colName == null ? '' : colName).trim();
  if (!col) return;
  const c = getSheetData_(tabKey);
  if (!c.headers.includes(col)) {
    c.sheet.getRange(1, c.headers.length + 1).setValue(col);
    // Force the pending write to be committed before we re-read the sheet,
    // otherwise getDataRange().getValues() in the next getSheetData_ call
    // may return stale data that doesn't include the new column header.
    SpreadsheetApp.flush();
    // Header shape changed — drop the cache so the new column is picked up.
    invalidateSheetCache_(tabKey);
  }
}
function ensureGroupCols_() {
  ['isGroup','participants','staffNames','staffKennitalar','boatNames','boatIds','activityTypeId','activityTypeName'].forEach(c => addColIfMissing_('checkouts', c));
}
function ensureActorCols_(tabKey) {
  ['actorKennitala','actorName'].forEach(c => addColIfMissing_(tabKey, c));
}
function ensureCheckoutContactCols_() {
  ['memberPhone','memberIsMinor','guardianName','guardianPhone'].forEach(c => addColIfMissing_('checkouts', c));
}

function updateRow_(tabKey, keyField, keyValue, updates) {
  validateRow_(tabKey, updates);
  const c = getSheetData_(tabKey);
  const sheet = c.sheet, headers = c.headers, values = c.values;
  const keyCol = headers.indexOf(keyField);
  if (keyCol < 0) throw new Error('Field not found: ' + keyField);
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][keyCol]).trim() === String(keyValue).trim()) {
      let wrote = false;
      Object.entries(updates).forEach(([k, v]) => {
        const col = headers.indexOf(k);
        if (col >= 0) {
          // Per-column setValue preserves existing concurrency semantics:
          // two executions touching disjoint columns on the same row don't
          // clobber each other.  Keep cache coherent with the write.
          sheet.getRange(i + 2, col + 1).setValue(literalWrite_(v));
          values[i][col] = v;
          wrote = true;
        }
      });
      if (wrote) c.sanitized = null; // lazy view is stale
      return true;
    }
  }
  return false;
}

function deleteRow_(tabKey, keyField, keyValue) {
  const c = getSheetData_(tabKey);
  const sheet = c.sheet, headers = c.headers, values = c.values;
  const keyCol = headers.indexOf(keyField);
  if (keyCol < 0) throw new Error('Field not found: ' + keyField);
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][keyCol]).trim() === String(keyValue).trim()) {
      sheet.deleteRow(i + 2);
      values.splice(i, 1);
      c.sanitized = null;
      return true;
    }
  }
  return false;
}


// ─────────────────────────────────────────────────────────────────────────────
// CACHE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function cGet_(k) { try { const v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function cPut_(k, v, ttlSec) { try { CacheService.getScriptCache().put(k, JSON.stringify(v), ttlSec || 60); } catch (e) { } }
function cDel_(k) { try { CacheService.getScriptCache().remove(k); } catch (e) { } }


// ─────────────────────────────────────────────────────────────────────────────
// ROUTING
// ─────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    clearSheetCache_();
    const b = e.parameter?.p ? JSON.parse(e.parameter.p) : (e.parameter || {});
    // Public query endpoints — no auth required.
    if (b.action === 'resolveFromEmail') return resolveFromEmail_(b);
    // Public routes: rate-limited so a single attacker can't enumerate
    // licence numbers / member or boat IDs by hammering these endpoints.
    if (b.action === 'lookup') {
      // Per-licence throttle blocks guessing initials against a known licence.
      var lic = String(b.licence_number || b.licenceNumber || '');
      if (lic) {
        var licKey = 'lookup_' + lic.replace(/[^\w-]/g, '_');
        if (!publicRateLimit_(licKey, 10, 900)) return rateLimitedPage_();
      }
      return publicLookup_(b);
    }
    if (b.action === 'captain') {
      if (!publicRateLimit_('captain', 120, 60)) return rateLimitedPage_();
      return publicCaptainRecord_(b);
    }
    if (b.action === 'boat') {
      if (!publicRateLimit_('boat', 120, 60)) return rateLimitedPage_();
      return publicBoatRecord_(b);
    }
    if (b.action === 'dashboard') {
      // Dashboard does heavy work (reads trips + config). Global throttle.
      if (!publicRateLimit_('dashboard', 60, 60)) return rateLimitedPage_();
      return publicDashboard_();
    }
    if (b.share)                return publicShareRecord_(b);
    // Session-authenticated GETs, if any.
    const callerGet = authCaller_(b);
    if (callerGet) {
      if (!b.action) return okJ({ status: 'ok', ts: now_() });
      const deniedGet = authorize_(b.action, callerGet, b);
      if (deniedGet) return deniedGet;
      const throttledGet = checkMutationRate_(callerGet, b.action);
      if (!throttledGet.ok) return failJ('Too many requests', 429);
      return route_(b.action, b, callerGet);
    }
    return failJ('Unauthorized', 401);
  } catch (err) {
    Logger.log(['doGet error:', err && err.stack || err].join(" "));
    return failJ('Server error: ' + ((err && err.message) || 'unknown'), 500);
  }
}

function doPost(e) {
  try {
    clearSheetCache_();
    const b = JSON.parse(e.postData.contents);
    const action = b.action;
    // Public POST endpoints — no auth required.
    if (action && PUBLIC_ACTIONS_[action]) return route_(action, b, null);
    // Everything else requires a valid per-user session token.
    const caller = authCaller_(b);
    if (!caller) return failJ('Unauthorized', 401);
    const denied = authorize_(action, caller, b);
    if (denied) return denied;
    const throttled = checkMutationRate_(caller, action);
    if (!throttled.ok) return failJ('Too many requests', 429);
    return route_(action, b, caller);
  } catch (err) {
    Logger.log(['doPost error:', err && err.stack || err].join(" "));
    return failJ('Server error: ' + ((err && err.message) || 'unknown'), 500);
  }
}

function route_(action, b, caller) {
  switch (action) {
    case 'loginMember': return loginMember_(b);
    case 'loginWithGoogle': return loginWithGoogle_(b);
    case 'linkGoogleAccount': return linkGoogleAccount_(b, caller);
    case 'unlinkGoogleAccount': return unlinkGoogleAccount_(b, caller);
    // Session management
    case 'signOut':     return signOut_(b, caller);
    case 'signOutAll':  return signOutAll_(b, caller);
    case 'listSessions': return listSessions_(b, caller);
    case 'adminResetMemberPassword': return adminResetMemberPassword_(b, caller);
    case 'validateMember': return validateMember_(b.kennitala, caller);
    case 'validateWard': return validateWard_(b, caller);
    case 'setPassword': return setPassword_(b, caller);
    case 'getMembers': return getMembers_(b);
    case 'saveMember': return saveMember_(b, caller);
    case 'deleteMember': return deleteMember_(b.id);
    case 'importMembers': return importMembers_(b.rows);
    case 'deactivateMembers': return deactivateMembers_(b.ids);
    case 'savePreferences': return savePreferences_(b);
    case 'getDailyLog': return getDailyLog_(b.date);
    case 'saveDailyLog': return saveDailyLog_(b);
    case 'getActivityLog': return getActivityLog_(b);
    case 'saveDailyLog': return saveDailyLog_(b, caller);
    case 'getMaintenance': return getMaintenance_();
    case 'saveMaintenance': return saveMaintenance_(b);
    case 'resolveMaintenance': return resolveMaintenance_(b);
    case 'addMaintenanceComment': return addMaintenanceComment_(b);
    case 'deleteMaintenance':       return deleteMaintenance_(b);
    case 'uploadMaintenancePhoto':  return uploadMaintenancePhoto_(b);
    case 'adoptSaumaklubbur':       return adoptSaumaklubbur_(b);
    case 'approveSaumaklubbur':     return approveSaumaklubbur_(b);
    case 'holdSaumaklubbur':        return holdSaumaklubbur_(b);
    case 'reassignMaintenance':     return reassignMaintenance_(b);
    case 'toggleMaterial':          return toggleMaterial_(b);
    case 'addMaterial':             return addMaterial_(b);
    case 'removeMaterial':          return removeMaterial_(b);
    case 'followProject':           return followProject_(b);
    case 'unfollowProject':         return unfollowProject_(b);
    case 'markProjectSeen':         return markProjectSeen_(b);
    case 'getNotifications':        return getNotifications_(b);
    // ── PAYROLL ────────────────────────────────────────────────────────────────────
    case 'clockIn':             return clockIn_(b);
    case 'clockOut':            return clockOut_(b);
    case 'breakStart':          return breakStart_(b);
    case 'breakEnd':            return breakEnd_(b);
    case 'getTimeEntries':      return getTimeEntries_(b);
    case 'adminEditTime':       return adminEditTime_(b);
    case 'adminAddTime':    return adminAddTime_(b);
    case 'adminDeleteTime': return adminDeleteTime_(b);
    case 'getEmployees':        return getEmployees_();
    case 'saveEmployee':        return saveEmployee_(b);
    case 'closePayPeriod':      return closePayPeriod_(b);
    case 'getPayroll':          return getPayroll_(b);
    case 'generatePayslipData': return generatePayslipData_(b);
    case 'generateLaunamidlar': return generateLaunamidlar_(b);
    case 'getConfig': return getConfig_();
    case 'saveConfig': return saveConfig_(b);
    case 'saveFlagOverride': return saveFlagOverride_(b);
    case 'saveStaffStatus': return saveStaffStatus_(b);
    case 'saveCharterCalendars': return saveCharterCalendars_(b);
    case 'saveClubCalendars': return saveClubCalendars_(b);
    case 'saveActivityType': return saveActivityType_(b);
    case 'deleteActivityType': return deleteActivityType_(b.id);
    case 'cancelClassOccurrence':   return cancelClassOccurrence_(b);
    case 'overrideClassOccurrence': return overrideClassOccurrence_(b);
    case 'restoreClassOccurrence':  return restoreClassOccurrence_(b);
    case 'saveChecklistItem': return saveChecklistItem_(b);
    case 'deleteChecklistItem': return deleteChecklistItem_(b.id);
    case 'saveCertDef': return saveCertDef_(b);
    case 'deleteCertDef': return deleteCertDef_(b.id);
    case 'saveMemberCert': return saveMemberCert_(b);
    case 'saveCertCategories': return saveCertCategories_(b);
    case 'getIncidents': return getIncidents_(b);
    case 'createIncident': return createIncident_(b);
    case 'resolveIncident': return resolveIncident_(b);
    case 'addIncidentNote': return addIncidentNote_(b);
    case 'getActiveCheckouts': return getActiveCheckouts_(b);
    case 'saveCheckout': return saveCheckout_(b, caller);
    case 'checkIn': return checkIn_(b, caller);
    case 'deleteCheckout': return deleteCheckout_(b.id);
    case 'saveGroupCheckout': return saveGroupCheckout_(b, caller);
    case 'groupCheckIn': return groupCheckIn_(b, caller);
    case 'linkGroupCheckoutToActivity': return linkGroupCheckoutToActivity_(b, caller);
    // charter endpoints removed — use saveReservation / removeReservation
    case 'saveBoatAccess': return saveBoatAccess_(b);
    case 'saveBoatOos': return saveBoatOos_(b);
    case 'saveReservation': return saveReservation_(b);
    case 'removeReservation': return removeReservation_(b);
    // ── RESERVATION SLOTS ─────────────────────────────────────────────────────
    case 'getSlots':              return getSlots_(b);
    case 'saveSlot':              return saveSlot_(b);
    case 'saveRecurringSlots':    return saveRecurringSlots_(b);
    case 'deleteSlot':            return deleteSlot_(b);
    case 'deleteRecurrenceGroup': return deleteRecurrenceGroup_(b);
    case 'bookSlot':              return bookSlot_(b);
    case 'bulkBookSlots':         return bulkBookSlots_(b);
    case 'unbookSlot':            return unbookSlot_(b);
    // ── VOLUNTEERS ──────────────────────────────────────────────────────────
    case 'saveVolunteerEvent':    return saveVolunteerEvent_(b);
    case 'deleteVolunteerEvent':  return deleteVolunteerEvent_(b);
    case 'getVolunteerSignups':   return getVolunteerSignups_(b);
    case 'volunteerSignup':       return volunteerSignup_(b);
    case 'volunteerWithdraw':     return volunteerWithdraw_(b);
    case 'syncVolunteerEvents':   return syncVolunteerEvents_(b);
    // ── CREWS ─────────────────────────────────────────────────────────────────
    case 'getCrews':              return getCrews_(b);
    case 'getCrewBoard':          return getCrewBoard_(b);
    case 'createCrew':            return createCrew_(b);
    case 'updateCrew':            return updateCrew_(b);
    case 'disbandCrew':           return disbandCrew_(b);
    case 'joinCrew':              return joinCrew_(b);
    case 'leaveCrew':             return leaveCrew_(b);
    case 'inviteToCrew':          return inviteToCrew_(b);
    case 'respondCrewInvite':     return respondCrewInvite_(b);
    case 'getCrewInvites':        return getCrewInvites_(b);
    // ── ROWING PASSPORT ───────────────────────────────────────────────────────
    case 'getRowingPassport':       return getRowingPassport_(b);
    case 'saveRowingPassportDef':   return saveRowingPassportDef_(b);
    case 'signPassportItem':        return signPassportItem_(b);
    case 'revokePassportSignoff':   return revokePassportSignoff_(b);
    case 'importRowingPassportCsv': return importRowingPassportCsv_(b);
    case 'saveCaptainBio': return saveCaptainBio_(b);
    case 'uploadHeadshot': return uploadHeadshot_(b);
    // ── HANDBOOK ──────────────────────────────────────────────────────────────
    case 'getHandbook':         return getHandbook_();
    case 'saveHandbookRole':    return saveHandbookRole_(b);
    case 'deleteHandbookRole':  return deleteHandbookRole_(b);
    case 'reorderHandbookRoles':return reorderHandbookRoles_(b);
    case 'saveHandbookDoc':     return saveHandbookDoc_(b);
    case 'deleteHandbookDoc':   return deleteHandbookDoc_(b);
    case 'uploadHandbookDoc':   return uploadHandbookDoc_(b);
    case 'syncHandbookDocs':    return syncHandbookDocs_();
    case 'saveHandbookInfo':     return saveHandbookInfo_(b);
    case 'deleteHandbookInfo':   return deleteHandbookInfo_(b);
    case 'saveHandbookContact':  return saveHandbookContact_(b);
    case 'deleteHandbookContact':return deleteHandbookContact_(b);
    case 'getTrips': return getTrips_(b.kennitala, parseInt(b.limit) || 100, b);
    case 'saveTrip': return saveTrip_(b);
    case 'setHelm': return setHelm_(b);
    case 'deleteTrip': return deleteTrip_(b.id);
    case 'requestValidation': return requestVerification_(b);
    case 'requestVerification': return requestVerification_(b);
    case 'getVerificationRequests': return getVerificationRequests_();
    case 'getConfirmations': return getConfirmations_(b);
    case 'createConfirmation': return createConfirmation_(b);
    case 'respondConfirmation': return respondConfirmation_(b);
    case 'dismissConfirmation': return dismissConfirmation_(b);
    case 'dismissAllConfirmations': return dismissAllConfirmations_(b);
    case 'uploadTripFile': return uploadTripFile_(b);
    case 'deleteTripFile': return deleteTripFile_(b);
    case 'getWeather': return getWeather_();
    case 'getOverdueAlerts': return getOverdueAlerts_(b);
    case 'silenceAlert': return silenceAlert_(b);
    case 'handleAlertAction': return handleAlertAction_(b);
    case 'snoozeAlert': return snoozeAlert_(b);
    case 'resolveAlert':  return resolveAlert_(b);
    case 'saveAlertConfig': return saveAlertConfig_(b);
    // ── PUBLIC DASHBOARD ───────────────────────────────────────────────────────
    case 'dashboard':         return publicDashboard_();
    // ── SHARE TOKENS ──────────────────────────────────────────────────────────
    case 'getShareTokens':    return getShareTokens_(b);
    case 'createShareToken':  return createShareToken_(b);
    case 'revokeShareToken':  return revokeShareToken_(b);
    case 'deleteShareToken':  return deleteShareToken_(b);
    // ── BATCH ─────────────────────────────────────────────────────────────────
    case 'batch':             return batch_(b, caller);
    default: return failJ('Unknown action: ' + action, 404);
  }
}

// Multiplex N sub-requests into one HTTP round-trip. Each sub-request runs
// through the same gating doPost applies (authorize_ + checkMutationRate_) so
// a batched call has identical permissions to N separate calls. Sub-requests
// share the per-request sheet cache (clearSheetCache_ ran once at the top of
// doPost), so multiple reads against the same sheet collapse to one read.
//
// Wire shape:
//   request:  { action: 'batch', requests: [{action, params}, ...] }
//   response: { success: true, results: [<sub-response>, ...] }
// Each <sub-response> is the exact JSON the action would have returned on its
// own (success:true with data, or success:false with error+code). Errors in
// one sub-request never short-circuit the rest.
function batch_(b, caller) {
  var requests = b && b.requests;
  if (!Array.isArray(requests)) return failJ('requests must be an array', 400);
  if (requests.length === 0) return okJ({ results: [] });
  if (requests.length > 25) return failJ('Too many batched requests (max 25)', 400);
  var results = [];
  for (var i = 0; i < requests.length; i++) {
    var req = requests[i] || {};
    var subAction = req.action;
    var subParams = req.params || {};
    if (!subAction) {
      results.push({ success: false, error: 'Missing action', code: 400 });
      continue;
    }
    if (subAction === 'batch') {
      results.push({ success: false, error: 'Nested batch not allowed', code: 400 });
      continue;
    }
    // PUBLIC_ACTIONS (login, dashboard) explicitly run without a session;
    // batching them here would either grant unintended auth or strip the
    // outer caller's identity. Keep them on the direct path.
    if (PUBLIC_ACTIONS_[subAction]) {
      results.push({ success: false, error: 'Public action not batchable: ' + subAction, code: 400 });
      continue;
    }
    var subB = {};
    Object.keys(subParams).forEach(function (k) { subB[k] = subParams[k]; });
    subB.action = subAction;
    var denied = authorize_(subAction, caller, subB);
    if (denied) {
      try { results.push(JSON.parse(denied.getContent())); }
      catch (e) { results.push({ success: false, error: 'Forbidden', code: 403 }); }
      continue;
    }
    var throttled = checkMutationRate_(caller, subAction);
    if (!throttled.ok) {
      results.push({ success: false, error: 'Too many requests', code: 429 });
      continue;
    }
    try {
      var out = route_(subAction, subB, caller);
      results.push(JSON.parse(out.getContent()));
    } catch (err) {
      results.push({ success: false, error: 'Server error: ' + ((err && err.message) || 'unknown'), code: 500 });
    }
  }
  return okJ({ results: results });
}


