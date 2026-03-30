// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR SAILING CLUB — Apps Script Backend   v6
// ═══════════════════════════════════════════════════════════════════════════════
//
// v6 changes:
//  • Boats and locations moved from dedicated sheets to config sheet JSON
//    (getConfig now returns boats + locations; saveConfig accepts them)
//  • Removed one-time setup functions (addLangColumnIfNeeded, addAlertColumnsIfNeeded,
//    createSheetStructure) — run these from v5 if needed
//  • Removed now-unused getBoats_, saveBoat_, deleteBoat_, getLocations_,
//    saveLocation_, deleteLocation_ sheet-based handlers
// ═══════════════════════════════════════════════════════════════════════════════

const SHEET_ID_ = 'REDACTED';
const API_TOKEN_ = 'REDACTED';

const TABS_ = {
  members: 'members',
  dailyLog: 'daily_log',
  maintenance: 'maintenance',
  checkouts: 'checkouts',
  actTypes: 'activity_types',
  dailyCL: 'daily_checklist',
  incidents: 'incidents',
  trips: 'trips',
  config: 'config',
  employees: 'employees',
  timeClock: 'time_clock',
  payroll: 'payroll',
  shareTokens: 'share_tokens',
  tripConfirmations: 'trip_confirmations',
};

const CLUB_LANG_ = 'IS';


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
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }
function bool_(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; }
function okJ(data) { return jsonR_({ success: true, ...data }); }
function failJ(msg, code) { return jsonR_({ success: false, error: msg, code: code || 400 }); }
function jsonR_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function htmlR_(html) { return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); }
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

// HTML-escape for server-rendered pages
function esc_(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }


// ─────────────────────────────────────────────────────────────────────────────
// SHEET HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getSheet_(tabKey) {
  const name = TABS_[tabKey] || tabKey;
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('Tab not found: ' + name);
  return s;
}

const TIME_COLS_ = new Set(['checkedOutAt', 'checkedInAt', 'expectedReturn', 'timeOut', 'timeIn', 'returnBy']);

function sanitizeCell_(col, val) {
  if (!(val instanceof Date)) return val;
  const iso = val.toISOString();
  if (iso.startsWith('1899-12-3') || iso.startsWith('1899-12-2')) {
    return String(val.getHours()).padStart(2, '0') + ':' + String(val.getMinutes()).padStart(2, '0');
  }
  return TIME_COLS_.has(col) ? iso.slice(11, 16) : iso.slice(0, 10);
}

function readAll_(tabKey) {
  const sheet = getSheet_(tabKey);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  return data.slice(1)
    .map(row => {
      const o = {};
      headers.forEach((h, i) => { o[h] = sanitizeCell_(h, row[i]); });
      return o;
    })
    .filter(r => r[headers[0]] !== '' && r[headers[0]] !== null);
}

function findOne_(tabKey, field, value) {
  return readAll_(tabKey).find(r => String(r[field]).trim() === String(value).trim()) || null;
}

function insertRow_(tabKey, obj) {
  const sheet = getSheet_(tabKey);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
}

function addColIfMissing_(tabKey, colName) {
  const sheet = getSheet_(tabKey);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  if (!headers.includes(colName)) {
    sheet.getRange(1, headers.length + 1).setValue(colName);
  }
}
function ensureGroupCols_() {
  ['isGroup','participants','staffNames','boatNames','boatIds','activityTypeId','activityTypeName'].forEach(c => addColIfMissing_('checkouts', c));
}
function ensureCheckoutContactCols_() {
  ['memberPhone','memberIsMinor','guardianName','guardianPhone'].forEach(c => addColIfMissing_('checkouts', c));
}

function updateRow_(tabKey, keyField, keyValue, updates) {
  const sheet = getSheet_(tabKey);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const keyCol = headers.indexOf(keyField);
  if (keyCol < 0) throw new Error('Field not found: ' + keyField);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyCol]).trim() === String(keyValue).trim()) {
      Object.entries(updates).forEach(([k, v]) => {
        const col = headers.indexOf(k);
        if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(v);
      });
      return true;
    }
  }
  return false;
}

function deleteRow_(tabKey, keyField, keyValue) {
  const sheet = getSheet_(tabKey);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const keyCol = headers.indexOf(keyField);
  if (keyCol < 0) throw new Error('Field not found: ' + keyField);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][keyCol]).trim() === String(keyValue).trim()) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}


// ─────────────────────────────────────────────────────────────────────────────
// CACHE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function cGet_(k) { try { const v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function cPut_(k, v) { try { CacheService.getScriptCache().put(k, JSON.stringify(v), 60); } catch (e) { } }
function cDel_(k) { try { CacheService.getScriptCache().remove(k); } catch (e) { } }


// ─────────────────────────────────────────────────────────────────────────────
// ROUTING
// ─────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const b = e.parameter?.p ? JSON.parse(e.parameter.p) : (e.parameter || {});
    if (b.action === 'resolveFromEmail') return resolveFromEmail_(b);
    // Public query endpoints — no token required (spec §5)
    if (b.action === 'lookup')  return publicLookup_(b);
    if (b.action === 'captain') return publicCaptainRecord_(b);
    if (b.action === 'boat')    return publicBoatRecord_(b);
    if (b.action === 'dashboard') return publicDashboard_();
    if (b.share)                return publicShareRecord_(b);
    if (!b.token || b.token !== API_TOKEN_) return failJ('Unauthorized', 401);
    if (!b.action) return okJ({ status: 'ok', ts: now_() });
    return route_(b.action, b);
  } catch (err) { return failJ('Server error: ' + err.message, 500); }
}

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    // Public POST endpoints — no token required
    if (b.action === 'dashboard') return publicDashboard_();
    if (!b.token || b.token !== API_TOKEN_) return failJ('Unauthorized', 401);
    return route_(b.action, b);
  } catch (err) { return failJ('Server error: ' + err.message, 500); }
}

function route_(action, b) {
  switch (action) {
    case 'validateMember': return validateMember_(b.kennitala);
    case 'getMembers': return getMembers_();
    case 'saveMember': return saveMember_(b);
    case 'deleteMember': return deleteMember_(b.id);
    case 'importMembers': return importMembers_(b.rows);
    case 'deactivateMembers': return deactivateMembers_(b.ids);
    case 'setLang': return setLang_(b.kennitala, b.lang);
    case 'savePreferences': return savePreferences_(b);
    case 'getDailyLog': return getDailyLog_(b.date);
    case 'saveDailyLog': return saveDailyLog_(b);
    case 'getMaintenance': return getMaintenance_();
    case 'saveMaintenance': return saveMaintenance_(b);
    case 'resolveMaintenance': return resolveMaintenance_(b);
    case 'addMaintenanceComment': return addMaintenanceComment_(b);
    case 'deleteMaintenance':       return deleteMaintenance_(b);
    case 'uploadMaintenancePhoto':  return uploadMaintenancePhoto_(b);
    case 'adoptSaumaklubbur':       return adoptSaumaklubbur_(b);
    case 'approveSaumaklubbur':     return approveSaumaklubbur_(b);
    case 'toggleMaterial':          return toggleMaterial_(b);
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
    case 'saveActivityType': return saveActivityType_(b);
    case 'deleteActivityType': return deleteActivityType_(b.id);
    case 'saveChecklistItem': return saveChecklistItem_(b);
    case 'deleteChecklistItem': return deleteChecklistItem_(b.id);
    case 'saveCertDef': return saveCertDef_(b);
    case 'deleteCertDef': return deleteCertDef_(b.id);
    case 'saveMemberCert': return saveMemberCert_(b);
    case 'getIncidents': return getIncidents_(b);
    case 'createIncident': return createIncident_(b);
    case 'resolveIncident': return resolveIncident_(b);
    case 'addIncidentNote': return addIncidentNote_(b);
    case 'getActiveCheckouts': return getActiveCheckouts_();
    case 'saveCheckout': return saveCheckout_(b);
    case 'checkIn': return checkIn_(b);
    case 'deleteCheckout': return deleteCheckout_(b.id);
    case 'saveGroupCheckout': return saveGroupCheckout_(b);
    case 'groupCheckIn': return groupCheckIn_(b);
    case 'linkGroupCheckoutToActivity': return linkGroupCheckoutToActivity_(b);
    case 'saveCharter': return saveCharter_(b);
    case 'removeCharter': return removeCharter_(b);
    case 'getTrips': return getTrips_(b.kennitala, parseInt(b.limit) || 100, b);
    case 'saveTrip': return saveTrip_(b);
    case 'setHelm': return setHelm_(b);
    case 'deleteTrip': return deleteTrip_(b.id);
    case 'requestValidation': return requestValidation_(b);
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
    default: return failJ('Unknown action: ' + action, 404);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MEMBERS
// ═══════════════════════════════════════════════════════════════════════════════

function validateMember_(kennitala) {
  if (!kennitala) return failJ('kennitala required');
  const m = findOne_('members', 'kennitala', String(kennitala).trim());
  if (!m) return failJ('Not found', 404);
  if (!bool_(m.active)) return failJ('Inactive account', 403);
  return okJ({
    member: {
      id: m.id, kennitala: m.kennitala, name: m.name, role: m.role,
      email: m.email || '', phone: m.phone || '',
      birthYear: m.birthYear || '', isMinor: bool_(m.isMinor),
      guardianName: m.guardianName || '', guardianKennitala: m.guardianKennitala || '',
      guardianPhone: m.guardianPhone || '',
      certifications: m.certifications || '',
      initials: m.initials || extractInitials_(m.name),
      lang: m.lang || 'EN',
      preferences: m.preferences || '{}',
    }
  });
}

function getMembers_() {
  const c = cGet_('members'); if (c) return okJ({ members: c });
  const members = readAll_('members'); cPut_('members', members); return okJ({ members });
}

function getMemberMap_() {
  let members = cGet_('members');
  if (!members) { members = readAll_('members'); cPut_('members', members); }
  const map = {};
  members.forEach(m => { map[String(m.kennitala)] = m; });
  return map;
}

function getBoatMap_(cfgMap) {
  const raw = getConfigValue_('boats', cfgMap || getConfigMap_());
  let boats = [];
  try { boats = JSON.parse(raw || '[]'); } catch (e) {}
  const map = {};
  boats.forEach(function(b) { map[b.id] = b; });
  return map;
}

function saveMember_(b) {
  const ts = now_(), ex = b.id ? findOne_('members', 'id', b.id) : null;
  if (ex) {
    updateRow_('members', 'id', b.id, {
      name: b.name || ex.name, role: b.role || ex.role, email: b.email || '',
      phone: b.phone || '', birthYear: b.birthYear || '',
      isMinor: b.isMinor !== undefined ? bool_(b.isMinor) : ex.isMinor,
      guardianName: b.guardianName || '', guardianKennitala: b.guardianKennitala || '',
      guardianPhone: b.guardianPhone || '',
      initials: b.initials || ex.initials || extractInitials_(b.name || ex.name),
      active: b.active !== undefined ? bool_(b.active) : ex.active,
      updatedAt: ts,
    });
    cDel_('members'); return okJ({ id: b.id, updated: true });
  } else {
    const id = uid_();
    insertRow_('members', {
      id, kennitala: b.kennitala, name: b.name, role: b.role || 'member',
      email: b.email || '', phone: b.phone || '', birthYear: b.birthYear || '',
      isMinor: bool_(b.isMinor) || false,
      guardianName: b.guardianName || '', guardianKennitala: b.guardianKennitala || '',
      guardianPhone: b.guardianPhone || '', active: true,
      certifications: '', initials: extractInitials_(b.name),
      lang: b.lang || 'EN',
      createdAt: ts, updatedAt: ts,
    });
    cDel_('members'); return okJ({ id, created: true });
  }
}

function deleteMember_(id) {
  if (!id) return failJ('id required');
  updateRow_('members', 'id', id, { active: false, updatedAt: now_() });
  cDel_('members'); return okJ({ deleted: true });
}

function importMembers_(rows) {
  if (!Array.isArray(rows)) return failJ('rows array required');
  const ts = now_(); let created = 0, updated = 0;
  rows.forEach(r => {
    const ex = findOne_('members', 'kennitala', String(r.kennitala || '').trim());
    if (ex) {
      updateRow_('members', 'kennitala', ex.kennitala, {
        name: r.name || ex.name, email: r.email || ex.email || '',
        phone: r.phone || ex.phone || '', role: r.role || ex.role || 'member',
        birthYear: r.birthYear || ex.birthYear || '',
        isMinor: r.isMinor !== undefined ? bool_(r.isMinor) : ex.isMinor,
        guardianName: r.guardianName || ex.guardianName || '',
        guardianKennitala: r.guardianKennitala || ex.guardianKennitala || '',
        guardianPhone: r.guardianPhone || ex.guardianPhone || '',
        active: r.active !== undefined ? bool_(r.active) : ex.active,
        updatedAt: ts,
      });
      updated++;
    } else {
      insertRow_('members', {
        id: uid_(), kennitala: String(r.kennitala).trim(), name: r.name || '',
        role: r.role || 'member', email: r.email || '', phone: r.phone || '',
        birthYear: r.birthYear || '', isMinor: bool_(r.isMinor) || false,
        guardianName: r.guardianName || '', guardianKennitala: r.guardianKennitala || '',
        guardianPhone: r.guardianPhone || '', active: true,
        certifications: '', lang: 'EN',
        createdAt: ts, updatedAt: ts,
      });
      created++;
    }
  });
  cDel_('members'); return okJ({ created, updated });
}

function deactivateMembers_(ids) {
  if (!Array.isArray(ids) || !ids.length) return failJ('ids array required');
  const ts = now_(); let count = 0;
  ids.forEach(id => {
    const ok = updateRow_('members', 'id', String(id), { active: false, updatedAt: ts });
    if (ok) count++;
  });
  cDel_('members'); return okJ({ deactivated: count });
}

function setLang_(kennitala, lang) {
  if (!kennitala) return failJ('kennitala required');
  const l = String(lang || '').toUpperCase();
  if (!['EN', 'IS'].includes(l)) return failJ('lang must be EN or IS');
  const updated = updateRow_('members', 'kennitala', String(kennitala).trim(), { lang: l, updatedAt: now_() });
  if (!updated) return failJ('Member not found', 404);
  cDel_('members');
  return okJ({ lang: l });
}

function savePreferences_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  const kt = String(b.kennitala).trim();
  const ex = findOne_('members', 'kennitala', kt);
  if (!ex) return failJ('Member not found', 404);

  const updates = { updatedAt: now_() };

  // Initials override
  if (b.initials !== undefined) {
    updates.initials = String(b.initials || '').trim().toUpperCase() || extractInitials_(ex.name);
  }
  // Language
  if (b.lang !== undefined) {
    const l = String(b.lang || '').toUpperCase();
    if (['EN', 'IS'].includes(l)) updates.lang = l;
  }
  // Preferences JSON (windUnit, theme, statsVisibility)
  if (b.preferences !== undefined) {
    updates.preferences = typeof b.preferences === 'string' ? b.preferences : JSON.stringify(b.preferences);
  }

  updateRow_('members', 'kennitala', kt, updates);
  cDel_('members');
  return okJ({ saved: true });
}


// ═══════════════════════════════════════════════════════════════════════════════
// DAILY LOG
// ═══════════════════════════════════════════════════════════════════════════════

function getDailyLog_(date) {
  const d = date || now_().slice(0, 10);
  const log = findOne_('dailyLog', 'date', d);
  return okJ({ log: log || null, date: d });
}

function saveDailyLog_(b) {
  const ts = now_(), date = b.date || ts.slice(0, 10);
  const ex = findOne_('dailyLog', 'date', date);
  if (ex) {
    updateRow_('dailyLog', 'date', date, {
      openingChecks: b.openingChecks !== undefined ? JSON.stringify(b.openingChecks) : ex.openingChecks,
      closingChecks: b.closingChecks !== undefined ? JSON.stringify(b.closingChecks) : ex.closingChecks,
      activities: b.activities !== undefined ? JSON.stringify(b.activities) : ex.activities,
      weatherLog: b.weatherLog !== undefined ? b.weatherLog : ex.weatherLog,
      narrative: b.narrative !== undefined ? b.narrative : ex.narrative,
      tideData: b.tideData !== undefined ? JSON.stringify(b.tideData) : ex.tideData,
      signedOffBy: b.signedOffBy || ex.signedOffBy || '',
      signedOffAt: b.signedOffAt || ex.signedOffAt || '',
      updatedBy: b.updatedBy || '', updatedAt: ts,
    });
    return okJ({ date, updated: true });
  } else {
    insertRow_('dailyLog', {
      id: uid_(), date,
      openingChecks: JSON.stringify(b.openingChecks || []),
      closingChecks: JSON.stringify(b.closingChecks || []),
      activities: JSON.stringify(b.activities || []),
      weatherLog: b.weatherLog || '', narrative: b.narrative || '',
      tideData: JSON.stringify(b.tideData || {}),
      signedOffBy: b.signedOffBy || '', signedOffAt: b.signedOffAt || '',
      updatedBy: b.updatedBy || '', createdAt: ts, updatedAt: ts,
    });
    return okJ({ date, created: true });
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAINTENANCE
// ═══════════════════════════════════════════════════════════════════════════════

function getMaintenance_() {
  const c = cGet_('maintenance'); if (c) return okJ({ requests: c });
  let requests = [];
  try { requests = readAll_('maintenance'); } catch (e) { requests = []; }
  cPut_('maintenance', requests);
  return okJ({ requests });
}

function saveMaintenance_(b) {
  addColIfMissing_('maintenance', 'saumaklubbur');
  addColIfMissing_('maintenance', 'verkstjori');
  addColIfMissing_('maintenance', 'materials');
  addColIfMissing_('maintenance', 'approved');
  const ts = now_(), id = uid_();
  const photoUrl = b.photoUrl || '';
  const isSauma = bool_(b.saumaklubbur) || false;
  const isStaffSource = (b.source || 'staff') === 'staff';
  insertRow_('maintenance', {
    id, category: b.category || 'boat', boatId: b.boatId || '', boatName: b.boatName || '',
    itemName: b.itemName || '', part: b.part || '', severity: b.severity || 'medium',
    description: b.description || '', photoUrl,
    markOos: bool_(b.markOos) || false, reportedBy: b.reportedBy || '',
    source: b.source || 'staff', createdAt: ts,
    resolved: false, resolvedBy: '', resolvedAt: '', comments: '[]',
    saumaklubbur: isSauma, verkstjori: b.verkstjori || '',
    materials: b.materials || '[]',
    approved: isSauma && !isStaffSource ? false : true,
  });
  cDel_('maintenance');
  return okJ({ id, created: true });
}

function resolveMaintenance_(b) {
  if (!b.id) return failJ('id required');
  updateRow_('maintenance', 'id', b.id, { resolved: true, resolvedBy: b.resolvedBy || '', resolvedAt: now_() });
  cDel_('maintenance');
  return okJ({ resolved: true });
}
// ═══════════════════════════════════════════════════════════════════════════════
// PAYROLL  —  punch clock, employee records, pay calculation, launamiðar XML
// 2026 RSK constants; configurable via config.payroll
// ═══════════════════════════════════════════════════════════════════════════════

const TAX_2026_ = {
  bracketBase1: 498122, bracketBase2: 1398450,
  rate1: 0.3149, rate2: 0.3799, rate3: 0.4629,
  personalCredit: 72492, tryggingagjald: 0.0635,
  motframlag: 0.115, orlofsfe: 0.1017, lifeyrir: 0.04,
};

function seedEmployees_() {
  const sheet = getSheet_(TABS_.employees);
  if (sheet.getLastRow() > 1) return;
  const h = ['id','kt','name','title','bankAccount','orlofsreikningur',
    'baseRateKr','union','lifeyrir','sereignarsjodur','otherWithholdings',
    'active','startDate','memberId','payrollEnabled'];
  sheet.getRange(1,1,1,h.length).setValues([h]);
  const seed = [
    [uid_(),'2811062010','Stefania Agnes Benjaminsdottir','Fristundaleidbeinandi','0130-26-013131','0537-18-020866',3310,'VR',0.04,0.02,'[]',true,'2026-01-01','',true],
    [uid_(),'1504881209','Gunnar Thor Sigurdsson','Skipstjori','0101-26-045678','0101-18-045679',3800,'SGS',0.04,0.02,'[]',true,'2026-01-01','',true],
    [uid_(),'0703952479','Helga Run Magnusdottir','Leidbeinandi','0133-26-078901','0133-18-078902',3310,'VR',0.04,0.00,'[]',true,'2026-01-01','',true],
    [uid_(),'2209901539','Arni Mar Jonsson','Taeknimaður','0156-26-112233','0156-18-112234',3600,'VR',0.04,0.02,'[]',false,'2026-01-01','',false],
  ];
  seed.forEach(function(row,i){ sheet.getRange(i+2,1,1,row.length).setValues([row]); });
}

function initPayrollSheets_() {
  const ss = SpreadsheetApp.openById(SHEET_ID_);
  if (!ss.getSheetByName(TABS_.employees)) {
    const s = ss.insertSheet(TABS_.employees);
    s.getRange(1,1,1,15).setValues([['id','kt','name','title','bankAccount',
      'orlofsreikningur','baseRateKr','union','lifeyrir','sereignarsjodur',
      'otherWithholdings','active','startDate','memberId','payrollEnabled']]);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(TABS_.timeClock)) {
    const s = ss.insertSheet(TABS_.timeClock);
    s.getRange(1,1,1,9).setValues([['id','employeeId','type','timestamp',
      'source','originalTimestamp','note','periodKey','durationMinutes']]);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(TABS_.payroll)) {
    const s = ss.insertSheet(TABS_.payroll);
    s.getRange(1,1,1,18).setValues([['id','employeeId','period','hoursRegular',
      'hoursOT133','hoursOT155','grossWage','orlofsfe','grossTotal','lifeyrir',
      'sereignarsjodur','otherWithholdings','stadgreidslaSkattur','netPay',
      'tryggingagjald','motframlag','totalEmployerCost','generatedBy']]);
    s.setFrozenRows(1);
  }
  seedEmployees_();
  cDel_('employees'); cDel_('time_clock'); cDel_('payroll');
  return okJ({ initialised: true });
}

function payrollCfg_() {
  const raw = getConfig_();
  const p   = raw.payroll || {};
  return {
    baseRateKr:        p.baseRateKr        || 3310,
    ot133multiplier:   p.ot133multiplier   || 1.33,
    ot155multiplier:   p.ot155multiplier   || 1.55,
    otThreshold133:    p.otThreshold133    || 173,
    otThreshold155:    p.otThreshold155    || 200,
    payPeriodStartDay: p.payPeriodStartDay || 1,
    payPeriodEndDay:   p.payPeriodEndDay   || 31,
    employerKt:        p.employerKt        || '4705760659',
    employerName:      p.employerName      || 'Siglingafelagid Ymir',
    employerAddress:   p.employerAddress   || 'Reykjavik',
  };
}

function periodKey_(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

function clockIn_(b) {
  if (!b.employeeId) return failJ('employeeId required');
  const entries = readAll_(TABS_.timeClock).filter(function(r){ return r.employeeId === b.employeeId; });
  const ins  = entries.filter(function(r){ return r.type === 'in'; });
  const outs = entries.filter(function(r){ return r.type === 'out'; });
  const lastIn  = ins[ins.length-1];
  const lastOut = outs[outs.length-1];
  if (lastIn && (!lastOut || lastIn.timestamp > lastOut.timestamp))
    return failJ('Already clocked in since ' + lastIn.timestamp);
  const now = new Date().toISOString();
  insertRow_(TABS_.timeClock, { id:uid_(), employeeId:b.employeeId, type:'in',
    timestamp:now, source:b.source||'staff', originalTimestamp:'',
    note:b.note||'', periodKey:periodKey_(), durationMinutes:0 });
  cDel_('time_clock');
  return okJ({ clocked:'in', timestamp:now });
}

function clockOut_(b) {
  if (!b.employeeId) return failJ('employeeId required');
  const entries = readAll_(TABS_.timeClock).filter(function(r){ return r.employeeId === b.employeeId; });
  const ins  = entries.filter(function(r){ return r.type === 'in'; });
  const outs = entries.filter(function(r){ return r.type === 'out'; });
  const lastIn  = ins[ins.length-1];
  const lastOut = outs[outs.length-1];
  if (!lastIn || (lastOut && lastOut.timestamp > lastIn.timestamp))
    return failJ('Not clocked in');
  const now = new Date().toISOString();
  const dur = Math.round((new Date(now) - new Date(lastIn.timestamp)) / 60000);
  insertRow_(TABS_.timeClock, { id:uid_(), employeeId:b.employeeId, type:'out',
    timestamp:now, source:b.source||'staff', originalTimestamp:'',
    note:b.note||'', periodKey:periodKey_(), durationMinutes:dur });
  cDel_('time_clock');
  return okJ({ clocked:'out', timestamp:now, durationMinutes:dur });
}

function breakStart_(b) {
  if (!b.employeeId) return failJ('employeeId required');
  const entries = readAll_(TABS_.timeClock).filter(function(r){ return r.employeeId === b.employeeId; });
  const ins   = entries.filter(function(r){ return r.type === 'in'; });
  const outs  = entries.filter(function(r){ return r.type === 'out'; });
  const lastIn  = ins[ins.length-1];
  const lastOut = outs[outs.length-1];
  if (!lastIn || (lastOut && lastOut.timestamp > lastIn.timestamp))
    return failJ('Not clocked in');
  const brks  = entries.filter(function(r){ return r.type === 'break_start'; });
  const brkEs = entries.filter(function(r){ return r.type === 'break_end'; });
  const lastBrk  = brks[brks.length-1];
  const lastBrkE = brkEs[brkEs.length-1];
  if (lastBrk && (!lastBrkE || lastBrk.timestamp > lastBrkE.timestamp))
    return failJ('Already on break');
  const now = new Date().toISOString();
  insertRow_(TABS_.timeClock, { id:uid_(), employeeId:b.employeeId, type:'break_start',
    timestamp:now, source:'staff', originalTimestamp:'', note:b.note||'', periodKey:periodKey_(), durationMinutes:0 });
  cDel_('time_clock');
  return okJ({ type:'break_start', timestamp:now });
}

function breakEnd_(b) {
  if (!b.employeeId) return failJ('employeeId required');
  const entries = readAll_(TABS_.timeClock).filter(function(r){ return r.employeeId === b.employeeId; });
  const brks  = entries.filter(function(r){ return r.type === 'break_start'; });
  const brkEs = entries.filter(function(r){ return r.type === 'break_end'; });
  const lastBrk  = brks[brks.length-1];
  const lastBrkE = brkEs[brkEs.length-1];
  if (!lastBrk || (lastBrkE && lastBrkE.timestamp > lastBrk.timestamp))
    return failJ('Not on break');
  const now = new Date().toISOString();
  const dur = Math.round((new Date(now) - new Date(lastBrk.timestamp)) / 60000);
  insertRow_(TABS_.timeClock, { id:uid_(), employeeId:b.employeeId, type:'break_end',
    timestamp:now, source:'staff', originalTimestamp:'', note:b.note||'', periodKey:periodKey_(), durationMinutes:dur });
  cDel_('time_clock');
  return okJ({ type:'break_end', timestamp:now, durationMinutes:dur });
}

function getTimeEntries_(b) {
  var rows = readAll_(TABS_.timeClock);
  if (b.employeeId) rows = rows.filter(function(r){ return r.employeeId === b.employeeId; });
  if (b.period)     rows = rows.filter(function(r){ return r.periodKey  === b.period; });
  return okJ({ entries:rows });
}

function adminEditTime_(b) {
  if (!b.id || !b.timestamp) return failJ('id and timestamp required');
  const row = readAll_(TABS_.timeClock).find(function(r){ return r.id === b.id; });
  if (!row) return failJ('Entry not found');
  updateRow_(TABS_.timeClock,'id',b.id,{
    timestamp:b.timestamp, originalTimestamp:row.originalTimestamp||row.timestamp,
    note:b.note||row.note||'admin edit', source:'admin',
    durationMinutes:b.durationMinutes!==undefined?b.durationMinutes:row.durationMinutes,
  });
  cDel_('time_clock');
  return okJ({ updated:true });
}

function adminAddTime_(b) {
  try {
    var sh = SpreadsheetApp.openById(SHEET_ID_).getSheetByName(TABS_.timeClock);
    var id = 'entry_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    // Column order matches sheet: id, employeeId, type, timestamp(clockOut), source, originalTimestamp(clockIn), note, periodKey, durationMinutes
    var periodKey = b.clockIn ? b.clockIn.slice(0,7) + '-01' : new Date().toISOString().slice(0,7) + '-01';
    sh.appendRow([id, b.employeeId, '', b.timestamp, 'admin', b.clockIn, b.note || 'admin entry', periodKey, b.durationMinutes]);
    return okJ({ success: true, id: id });
  } catch(e) {
    return failJ(e.message);
  }
}

function adminDeleteTime_(b) {
  try {
    var sh = SpreadsheetApp.openById(SHEET_ID_).getSheetByName(TABS_.timeClock);
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === String(b.id)) {
        sh.deleteRow(i + 1);
        return okJ({ success: true });
      }
    }
    return failJ('Entry not found');
  } catch(e) {
    return failJ(e.message);
  }
}

function getEmployees_() {
  initPayrollSheets_();
  return okJ({ employees:readAll_(TABS_.employees) });
}

function saveEmployee_(b) {
  if (!b.id) return failJ('id required');
  const existing = readAll_(TABS_.employees).find(function(r){ return r.id === b.id; });
  if (existing) {
    const fields = ['kt','name','title','bankAccount','orlofsreikningur','baseRateKr',
      'union','lifeyrir','sereignarsjodur','otherWithholdings','active','startDate',
      'memberId','payrollEnabled'];
    const u = {};
    fields.forEach(function(f){ if (b[f]!==undefined) u[f]=b[f]; });
    updateRow_(TABS_.employees,'id',b.id,u);
  } else {
    insertRow_(TABS_.employees,b);
  }
  cDel_('employees');
  return okJ({ saved:true });
}

function calcTax_(gross, lif, ser) {
  const t = TAX_2026_;
  const base = Math.max(0, gross*(1-lif-ser));
  var tax = base<=t.bracketBase1 ? base*t.rate1
    : base<=t.bracketBase2 ? t.bracketBase1*t.rate1+(base-t.bracketBase1)*t.rate2
    : t.bracketBase1*t.rate1+(t.bracketBase2-t.bracketBase1)*t.rate2+(base-t.bracketBase2)*t.rate3;
  return Math.max(0, Math.round(tax - t.personalCredit));
}

function closePayPeriod_(b) {
  // Frontend sends pre-calculated rows — store them directly so the committed
  // payslip always reflects the config values that were in effect at approval time.
  const rows = b.rows;
  if (!rows || !rows.length) return failJ('rows array required');

  // Ensure newer columns exist in the payroll sheet
  ['periodFrom','periodTo','paymentDate','slipNumber','employeeName','kt',
   'bankAccount','orlofsreikningur','title','baseRateKr','regularMinutes',
   'otMinutes','manualLines','dagvinna','eftirvinna1','eftirvinna2','otLines',
   'orlofslaun','orlofsRate','manualTotal','employeePension','sereignarsjodur',
   'sereignRate','unionDues','taxBase','taxGross','personalCredit',
   'taxWithheld','taxAfterCredit','orlofIBanki','totalDeductions',
   'employerPension','endurhaefingarsjodur','regularHrs','ot1Hrs','ot2Hrs',
   'pensionRate','configSnapshot','approved','totalHours'
  ].forEach(function(c) { addColIfMissing_(TABS_.payroll, c); });

  // Generate slip numbers: YY0M0x based on payment date month
  var payDate = b.paymentDate || '';
  var yy = payDate.slice(2, 4) || '00';
  var mm = payDate.slice(5, 7) || '01';
  var prefix = yy + mm;
  // Find the highest existing counter for this prefix
  var existing = readAll_(TABS_.payroll);
  var maxCounter = 0;
  existing.forEach(function(r) {
    var sn = String(r.slipNumber || '');
    if (sn.indexOf(prefix) === 0) {
      var num = parseInt(sn.slice(prefix.length), 10);
      if (num > maxCounter) maxCounter = num;
    }
  });

  var results = [];
  rows.forEach(function(r, i) {
    var counter = String(maxCounter + i + 1).padStart(2, '0');
    var slipNumber = prefix + counter;
    var row = Object.assign({}, r, {
      id: uid_(),
      generatedBy: b.by || 'admin',
      slipNumber: slipNumber
    });
    insertRow_(TABS_.payroll, row);
    results.push(row);
  });
  cDel_('payroll');
  return okJ({ periodFrom: b.periodFrom, periodTo: b.periodTo, rows: results.length });
}

function getPayroll_(b) {
  var rows = readAll_(TABS_.payroll);
  if (b.period)     rows = rows.filter(function(r){ return r.period===b.period || r.periodFrom===b.period; });
  if (b.employeeId) rows = rows.filter(function(r){ return r.employeeId===b.employeeId; });
  const allRows = readAll_(TABS_.payroll);
  const fields  = ['grossWage','orlofsfe','grossTotal','lifeyrir','sereignarsjodur',
    'stadgreidslaSkattur','netPay','tryggingagjald','motframlag','totalEmployerCost',
    'hoursRegular','hoursOT133','hoursOT155'];
  rows.forEach(function(row) {
    const pKey = row.period || row.periodFrom || '';
    const yr  = pKey.slice(0,4);
    const ytd = allRows.filter(function(r){
      var rk = r.period || r.periodFrom || '';
      return r.employeeId===row.employeeId && rk.startsWith(yr) && rk<=pKey;
    });
    const tot = {};
    fields.forEach(function(f){ tot[f]=ytd.reduce(function(s,r){ return s+Number(r[f]||0); },0); });
    row._ytd = tot;
  });
  return okJ({ payroll:rows });
}

function generatePayslipData_(b) {
  if (!b.employeeId||!b.period) return failJ('employeeId and period required');
  const payRows = readAll_(TABS_.payroll).filter(function(r){ return r.employeeId===b.employeeId&&r.period===b.period; });
  if (!payRows.length) return failJ('No payroll record for this period');
  const emp = readAll_(TABS_.employees).find(function(r){ return r.id===b.employeeId; });
  if (!emp) return failJ('Employee not found');
  const yr  = b.period.slice(0,4);
  const all = readAll_(TABS_.payroll);
  const ytd = all.filter(function(r){ return r.employeeId===b.employeeId&&(r.period||'').startsWith(yr)&&r.period<=b.period; });
  const fields = ['grossWage','orlofsfe','grossTotal','lifeyrir','sereignarsjodur','stadgreidslaSkattur','netPay','hoursRegular','hoursOT133','hoursOT155'];
  const tot={};
  fields.forEach(function(f){ tot[f]=ytd.reduce(function(s,r){ return s+Number(r[f]||0); },0); });
  return okJ({ payslip:{ employee:emp, period:b.period, pay:payRows[0], ytd:tot, employer:payrollCfg_() } });
}

function generateLaunamidlar_(b) {
  var year = b.year || String(new Date().getFullYear());
  var cfg  = payrollCfg_();
  var emps = readAll_(TABS_.employees).filter(function(e){ return e.payrollEnabled===true||e.payrollEnabled==='true'; });
  var rows = readAll_(TABS_.payroll).filter(function(r){ return (r.period||'').indexOf(year)===0; });

  var byEmp = {};
  rows.forEach(function(r){
    if (!byEmp[r.employeeId]) byEmp[r.employeeId]={grossTotal:0,lifeyrir:0,sereignarsjodur:0,orlofsfe:0,stadgreidslaSkattur:0,tryggingagjald:0,motframlag:0};
    var e=byEmp[r.employeeId];
    ['grossTotal','lifeyrir','sereignarsjodur','orlofsfe','stadgreidslaSkattur','tryggingagjald','motframlag'].forEach(function(f){
      e[f]+=Number(r[f]||0);
    });
  });

  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<LS year="'+year+'" kt="'+xmlEsc_(cfg.employerKt)+'" name="'+xmlEsc_(cfg.employerName)+'">\n';

  emps.forEach(function(emp){
    var agg = byEmp[emp.id];
    if (!agg) return;
    var r02 = Math.round(agg.grossTotal);
    var r03 = Math.round(agg.lifeyrir+agg.sereignarsjodur);
    var r07 = Math.round(agg.orlofsfe);
    var r71 = Math.round(agg.stadgreidslaSkattur);
    xml += '  <launamidi>\n';
    xml += '    <kt>'+xmlEsc_(emp.kt)+'</kt>\n';
    xml += '    <n>'+xmlEsc_(emp.name)+'</n>\n';
    xml += '    <title>'+xmlEsc_(emp.title||'')+'</title>\n';
    xml += '    <r02>'+r02+'</r02>\n';
    xml += '    <r03>'+r03+'</r03>\n';
    xml += '    <r07>'+r07+'</r07>\n';
    xml += '    <r08>'+xmlEsc_(emp.union||'')+'</r08>\n';
    xml += '    <r70>'+r02+'</r70>\n';
    xml += '    <r71>'+r71+'</r71>\n';
    xml += '    <motframlag>'+Math.round(agg.motframlag)+'</motframlag>\n';
    xml += '    <tryggingagjald>'+Math.round(agg.tryggingagjald)+'</tryggingagjald>\n';
    xml += '  </launamidi>\n';
  });

  xml += '</LS>';
  return okJ({ xml:xml, year:year, employerKt:cfg.employerKt });
}
function xmlEsc_(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


function addMaintenanceComment_(b) {
  if (!b.id) return failJ('id required');
  if (!b.text) return failJ('text required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  let comments = [];
  try { comments = JSON.parse(ex.comments || '[]'); } catch (e) { comments = []; }
  const entry = { by: b.by || '', at: now_(), text: b.text };
  if (b.photoUrl) entry.photoUrl = b.photoUrl;
  comments.push(entry);
  updateRow_('maintenance', 'id', b.id, { comments: JSON.stringify(comments) });
  cDel_('maintenance');
  return okJ({ commented: true });
}

function toggleMaterial_(b) {
  if (!b.id) return failJ('id required');
  if (b.index === undefined) return failJ('index required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  let materials = [];
  try { materials = JSON.parse(ex.materials || '[]'); } catch(e) { materials = []; }
  const idx = parseInt(b.index);
  if (idx < 0 || idx >= materials.length) return failJ('Invalid index');
  materials[idx].purchased = !materials[idx].purchased;
  addColIfMissing_('maintenance', 'materials');
  updateRow_('maintenance', 'id', b.id, { materials: JSON.stringify(materials) });
  cDel_('maintenance');
  return okJ({ toggled: true, materials });
}

function approveSaumaklubbur_(b) {
  if (!b.id) return failJ('id required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  if (!bool_(ex.saumaklubbur)) return failJ('Not a saumaklúbbur project');
  addColIfMissing_('maintenance', 'approved');
  updateRow_('maintenance', 'id', b.id, { approved: true });
  cDel_('maintenance');
  return okJ({ approved: true });
}

function adoptSaumaklubbur_(b) {
  if (!b.id) return failJ('id required');
  if (!b.name) return failJ('name required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  if (!bool_(ex.saumaklubbur)) return failJ('Not a saumaklúbbur project');
  if (ex.verkstjori) return failJ('Already has a verkstjóri');
  addColIfMissing_('maintenance', 'verkstjori');
  updateRow_('maintenance', 'id', b.id, { verkstjori: b.name });
  cDel_('maintenance');
  return okJ({ adopted: true, verkstjori: b.name });
}

function deleteMaintenance_(b) {
  if (!b.id) return failJ('id required');
  const deleted = deleteRow_('maintenance', 'id', b.id);
  cDel_('maintenance');
  return okJ({ deleted: deleted });
}

// Script Property required: DRIVE_FOLDER_ID_MAINT_PHOTOS
function uploadMaintenancePhoto_(b) {
  if (!b.fileData) return failJ('fileData required');
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('DRIVE_FOLDER_ID_MAINT_PHOTOS');
  if (!folderId) return okJ({ ok: false, error: 'Drive folder not configured' });

  try {
    const ext      = (b.fileName || 'photo.jpg').split('.').pop().toLowerCase();
    const ts       = now_().replace(/[: ]/g, '-');
    const safeName = 'maint_' + ts + '_' + (b.fileName || 'photo.' + ext);
    const base64   = b.fileData.replace(/^data:[^;]+;base64,/, '');
    const bytes    = Utilities.base64Decode(base64);
    const mimeMap  = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', heic:'image/heic' };
    const mime     = b.mimeType || mimeMap[ext] || 'image/jpeg';
    const blob     = Utilities.newBlob(bytes, mime, safeName);
    const folder   = DriveApp.getFolderById(folderId);
    const file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return okJ({ ok: true, photoUrl: file.getUrl() });
  } catch (e) {
    return failJ('Photo upload error: ' + e.message);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG  —  getConfig bundles everything; boats + locations stored as JSON rows
// ═══════════════════════════════════════════════════════════════════════════════

function getConfig_() {
  const c = cGet_('config'); if (c) return okJ(c);
  // Read the config sheet ONCE and look up all keys from the in-memory map
  const cfgMap = getConfigMap_();
  let activityTypes = [], dailyChecklist = { am: [], pm: [] };
  try {
    activityTypes = JSON.parse(getConfigValue_('activity_types', cfgMap) || '[]');
    // Ensure each type has a subtypes array (for backwards compat)
    activityTypes = activityTypes.map(function(t) {
      if (!t.subtypes) t.subtypes = [];
      else if (typeof t.subtypes === 'string') { try { t.subtypes = JSON.parse(t.subtypes); } catch(e) { t.subtypes = []; } }
      return t;
    });
  } catch (e) { }
  try {
    readAll_('dailyCL').filter(r => bool_(r.active)).forEach(r => {
      const phase = String(r.phase).toLowerCase();
      if (dailyChecklist[phase]) dailyChecklist[phase].push(r);
    });
  } catch (e) { }
  const overdueAlerts = getAlertConfigFromMap_(cfgMap);
  const flagConfig = getFlagConfigFromMap_(cfgMap);
  const staffStatus   = jsonR_(getConfigValue_('staffStatus', cfgMap));
  const certDefs = getCertDefsFromMap_(cfgMap);
  let boats = [], locations = [];
  try { var bRaw = getConfigValue_('boats', cfgMap); if (bRaw) boats = JSON.parse(bRaw); } catch (e) { }
  try { var lRaw = getConfigValue_('locations', cfgMap); if (lRaw) locations = JSON.parse(lRaw); } catch (e) { }
  let launchChecklists = {};
  try { var lRaw = getConfigValue_('launchChecklists', cfgMap); if (lRaw) launchChecklists = JSON.parse(lRaw); } catch (e) { }
  let boatCategories = [];
  try { var bcRaw = getConfigValue_('boatCategories', cfgMap); if (bcRaw) boatCategories = JSON.parse(bcRaw); } catch (e) { }
  const allowBreaks = getConfigValue_('allowBreaks', cfgMap) === 'true';
  const config = { activityTypes, dailyChecklist, overdueAlerts, flagConfig, certDefs, boats, locations, launchChecklists, boatCategories, staffStatus, allowBreaks };
  cPut_('config', config);
  return okJ(config);
}

function saveConfig_(b) {
  let saved = {};

  if (b.overdueAlerts !== undefined) {
    const cur = getAlertConfig_();
    const oa = b.overdueAlerts;
    const updated = {
      enabled: oa.enabled !== undefined ? !!oa.enabled : cur.enabled,
      firstAlertMins: oa.firstAlertMins !== undefined ? Number(oa.firstAlertMins) : cur.firstAlertMins,
      repeatMins: oa.repeatMins !== undefined ? Number(oa.repeatMins) : cur.repeatMins,
      snoozeMins: oa.snoozeMins !== undefined ? Number(oa.snoozeMins) : cur.snoozeMins,
      channels: {
        web: oa.channels?.web !== undefined ? !!oa.channels.web : cur.channels.web,
        email: oa.channels?.email !== undefined ? !!oa.channels.email : cur.channels.email,
        sms: oa.channels?.sms !== undefined ? !!oa.channels.sms : cur.channels.sms,
      },
      staffEmailList: Array.isArray(oa.staffEmailList) ? oa.staffEmailList.filter(e => String(e).includes('@')) : cur.staffEmailList,
      staffSmsList: Array.isArray(oa.staffSmsList) ? oa.staffSmsList : cur.staffSmsList,
    };
    setConfigSheetValue_('overdueAlerts', JSON.stringify(updated));
    saved.overdueAlerts = true;
  }

  if (b.flagConfig !== undefined) {
    // Accept full SCORE_CONFIG shape (points-based) — no validation on the backend,
    // client already validates before saving.
    setConfigSheetValue_('flagConfig', JSON.stringify(b.flagConfig));
    saved.flagConfig = true;
  }
  if (b.staffStatus !== undefined) {
    setConfigSheetValue_('staffStatus', JSON.stringify(b.staffStatus));
    saved.staffStatus = true;
  }

  if (b.boats !== undefined) {
    setConfigSheetValue_('boats', JSON.stringify(b.boats));
    saved.boats = true;
  }

  if (b.locations !== undefined) {
    setConfigSheetValue_('locations', JSON.stringify(b.locations));
  if (b.launchChecklists)  { setConfigSheetValue_('launchChecklists',  JSON.stringify(b.launchChecklists));  }
    saved.locations = true;
  }
  if (b.boatCategories)    { setConfigSheetValue_('boatCategories',    JSON.stringify(b.boatCategories));    }

  if (b.activityTypes) { setConfigSheetValue_('activity_types', JSON.stringify(b.activityTypes)); saved.activityTypes = true; }
  if (b.allowBreaks !== undefined) { setConfigSheetValue_('allowBreaks', b.allowBreaks ? 'true' : 'false'); saved.allowBreaks = true; }
  cDel_('config');
  return okJ({ saved });
}

function getFlagConfig_() {
  const raw = getConfigSheetValue_('flagConfig');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function saveActivityType_(b) {
  try {
    let arr = JSON.parse(getConfigSheetValue_('activity_types') || '[]');
    const ts  = now_();
    const idx = b.id ? arr.findIndex(a => a.id === b.id) : -1;
    // Parse subtypes safely — frontend sends as JSON string
    let subtypes = [];
    try { subtypes = b.subtypes ? (Array.isArray(b.subtypes) ? b.subtypes : JSON.parse(b.subtypes)) : []; } catch(e) { subtypes = []; }
    const item = { id: b.id || uid_(), name: b.name, nameIS: b.nameIS || '', active: b.active !== false, subtypes, updatedAt: ts };
    if (idx >= 0) arr[idx] = Object.assign(arr[idx], item);
    else arr.push(Object.assign(item, { createdAt: ts }));
    setConfigSheetValue_('activity_types', JSON.stringify(arr));
    cDel_('config');
    return okJ({ id: item.id, item });
  } catch(e) { return failJ('saveActivityType failed: ' + e.message); }
}

function deleteActivityType_(b) {
  try {
    let arr = JSON.parse(getConfigSheetValue_('activity_types') || '[]');
    arr = arr.filter(a => a.id !== b.id);
    setConfigSheetValue_('activity_types', JSON.stringify(arr));
    cDel_('config');
    return okJ({ deleted: true });
  } catch(e) { return failJ('deleteActivityType failed: ' + e.message); }
}

function saveChecklistItem_(b) {
  const ts = now_(), ex = b.id ? findOne_('dailyCL', 'id', b.id) : null;
  if (ex) {
    updateRow_('dailyCL', 'id', b.id, {
      phase: b.phase || ex.phase, textEN: b.textEN || ex.textEN, textIS: b.textIS || ex.textIS,
      active: b.active !== undefined ? b.active : ex.active,
      sortOrder: b.sortOrder || ex.sortOrder,
    });
    cDel_('config'); return okJ({ id: b.id, updated: true });
  } else {
    const id = uid_();
    insertRow_('dailyCL', {
      id, phase: b.phase || 'am', textEN: b.textEN, textIS: b.textIS || '',
      active: true, sortOrder: b.sortOrder || 99, createdAt: ts,
    });
    cDel_('config'); return okJ({ id, created: true });
  }
}

function deleteChecklistItem_(id) {
  if (!id) return failJ('id required');
  updateRow_('dailyCL', 'id', id, { active: false });
  cDel_('config'); return okJ({ deleted: true });
}

function saveAlertConfig_(b) {
  if (!b._serverSide && (!b || b.token !== API_TOKEN_)) throw new Error('Unauthorized');
  const cur = getAlertConfig_();
  const updated = {
    enabled: b.enabled !== undefined ? !!b.enabled : cur.enabled,
    firstAlertMins: b.firstAlertMins !== undefined ? Number(b.firstAlertMins) : cur.firstAlertMins,
    repeatMins: b.repeatMins !== undefined ? Number(b.repeatMins) : cur.repeatMins,
    snoozeMins: b.snoozeMins !== undefined ? Number(b.snoozeMins) : cur.snoozeMins,
    channels: {
      web: b.channels?.web !== undefined ? !!b.channels.web : cur.channels.web,
      email: b.channels?.email !== undefined ? !!b.channels.email : cur.channels.email,
      sms: b.channels?.sms !== undefined ? !!b.channels.sms : cur.channels.sms,
    },
    staffEmailList: Array.isArray(b.staffEmailList) ? b.staffEmailList.filter(e => e.includes('@')) : cur.staffEmailList,
    staffSmsList: Array.isArray(b.staffSmsList) ? b.staffSmsList : cur.staffSmsList,
  };
  setConfigSheetValue_('overdueAlerts', JSON.stringify(updated));
  cDel_('config');
  return okJ({ success: true, config: updated });
}


// ═══════════════════════════════════════════════════════════════════════════════
// CERTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getCertDefs_() {
  const raw = getConfigSheetValue_('certDefs');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function saveCertDef_(b) {
  if (!b.name) return failJ('name required');
  const defs = getCertDefs_();
  const payload = {
    id: b.id || ('cert_' + uid_()),
    name: String(b.name).trim(),
    description: String(b.description || '').trim(),
    renewalDays: Number(b.renewalDays) || 0,
    hasIdNumber: !!b.hasIdNumber,
    clubEndorsement: !!b.clubEndorsement,
    subcats: Array.isArray(b.subcats) ? b.subcats.map(s => ({
      key: String(s.key || s.label || '').toLowerCase().replace(/\s+/g, '_'),
      label: String(s.label || '').trim(),
      description: String(s.description || '').trim(),
      rank: s.rank != null ? Number(s.rank) : null,
    })).filter(s => s.label) : [],
  };
  const idx = defs.findIndex(d => d.id === payload.id);
  if (idx >= 0) defs[idx] = payload; else defs.push(payload);
  setConfigSheetValue_('certDefs', JSON.stringify(defs));
  cDel_('config');
  return okJ({ id: payload.id, saved: true });
}

function deleteCertDef_(id) {
  if (!id) return failJ('id required');
  const defs = getCertDefs_();
  const updated = defs.filter(d => d.id !== id);
  if (updated.length === defs.length) return failJ('Cert def not found', 404);
  setConfigSheetValue_('certDefs', JSON.stringify(updated));
  cDel_('config');
  return okJ({ deleted: true });
}

function saveMemberCert_(b) {
  if (!b.memberId) return failJ('memberId required');
  if (!Array.isArray(b.certifications)) return failJ('certifications array required');
  const defs = getCertDefs_();
  const byDef = {};
  b.certifications.forEach(c => {
    if (!byDef[c.certId]) byDef[c.certId] = [];
    byDef[c.certId].push(c);
  });
  const cleaned = [];
  Object.entries(byDef).forEach(([certId, entries]) => {
    const def = defs.find(d => d.id === certId);
    const hasRanks = def?.subcats?.some(s => s.rank != null);
    if (!hasRanks) { cleaned.push(...entries); return; }
    let best = null, bestRank = -1;
    entries.forEach(c => {
      const sub = def.subcats.find(s => s.key === c.sub);
      const rank = sub?.rank ?? 0;
      if (rank > bestRank) { best = c; bestRank = rank; }
    });
    if (best) cleaned.push(best);
  });
  const written = updateRow_('members', 'id', b.memberId, { certifications: JSON.stringify(cleaned), updatedAt: now_() });
  if (!written) return failJ('Member not found', 404);
  cDel_('members');
  return okJ({ saved: true, count: cleaned.length });
}


// ═══════════════════════════════════════════════════════════════════════════════
// INCIDENTS
// ═══════════════════════════════════════════════════════════════════════════════

function getIncidents_(b) {
  b = b || {};
  const c = cGet_('incidents');
  const all = c || readAll_('incidents');
  if (!c) cPut_('incidents', all);
  if (b.date) {
    const incidents = all.filter(function(i) { return (i.filedAt || i.createdAt || '').slice(0, 10) === b.date; });
    return okJ({ incidents });
  }
  return okJ({ incidents: all });
}

function createIncident_(b) {
  const ts = now_(), id = uid_();
  insertRow_('incidents', {
    id, types: JSON.stringify(b.types || []), severity: b.severity || 'minor',
    date: b.date || ts.slice(0, 10), time: b.time || ts.slice(11, 16),
    locationId: b.locationId || '', locationName: b.locationName || '',
    boatId: b.boatId || '', boatName: b.boatName || '',
    description: b.description || '', involved: b.involved || '',
    witnesses: b.witnesses || '', immediateAction: b.immediateAction || '',
    followUp: b.followUp || '', handOffTo: b.handOffTo || '',
    handOffName: b.handOffName || '', handOffNotes: b.handOffNotes || '',
    photoUrls: '', filedBy: b.filedBy || '', filedAt: ts,
    resolved: false, resolvedAt: '', staffNotes: '',
  });
  cDel_('incidents'); return okJ({ id, created: true });
}

function resolveIncident_(b) {
  if (!b.id) return failJ('id required');
  updateRow_('incidents', 'id', b.id, { resolved: b.resolved, resolvedAt: b.resolvedAt || '' });
  cDel_('incidents'); return okJ({ updated: true });
}

function addIncidentNote_(b) {
  if (!b.id) return failJ('id required');
  const ex = findOne_('incidents', 'id', b.id);
  const notes = ex ? JSON.parse(ex.staffNotes || '[]') : [];
  notes.push({ by: b.by || '', at: now_(), text: b.text || '' });
  updateRow_('incidents', 'id', b.id, { staffNotes: JSON.stringify(notes) });
  cDel_('incidents'); return okJ({ updated: true });
}


// ═══════════════════════════════════════════════════════════════════════════════
// CHECKOUTS
// ═══════════════════════════════════════════════════════════════════════════════

function getActiveCheckouts_() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const all = readAll_('checkouts');
  const result = all.filter(c => c.status === 'out' || (c.status === 'in' && (c.createdAt || '') > cutoff));
  let memberMap = {};
  try { memberMap = getMemberMap_(); } catch (e) { }
  const enriched = result.map(c => {
    const m = memberMap[String(c.memberKennitala || '')] || {};
    return {
      ...c,
      memberPhone: c.memberPhone || m.phone || '',
      memberIsMinor: c.memberIsMinor !== undefined && c.memberIsMinor !== '' ? bool_(c.memberIsMinor) : bool_(m.isMinor),
      guardianName: c.guardianName || m.guardianName || '',
      guardianPhone: c.guardianPhone || m.guardianPhone || '',
    };
  });
  cDel_('checkouts');
  return okJ({ checkouts: enriched });
}

function saveCheckout_(b) {
  ensureCheckoutContactCols_();
  const ts = now_(), id = uid_();
  const kt = String(b.memberKennitala || b.memberKt || b.kennitala || '');
  let memberPhone = '', memberIsMinor = false, guardianName = '', guardianPhone = '';
  if (kt) {
    try {
      const m = getMemberMap_()[kt] || {};
      memberPhone = m.phone || '';
      memberIsMinor = bool_(m.isMinor);
      guardianName = m.guardianName || '';
      guardianPhone = m.guardianPhone || '';
    } catch (e) {}
  }
  let wxSnap = '';
  if (b.wxSnapshot) {
    try {
      const w = typeof b.wxSnapshot === 'string' ? JSON.parse(b.wxSnapshot) : b.wxSnapshot;
      wxSnap = JSON.stringify({
        bft: Math.round(w.bft || 0), ws: Math.round(w.ws || 0), wg: Math.round(w.wg || 0),
        dir: w.dir || w.wDir || '',
        wv: w.wv != null ? parseFloat(w.wv.toFixed ? w.wv.toFixed(1) : w.wv) : (w.waveH != null ? parseFloat(parseFloat(w.waveH).toFixed(1)) : null),
        flag: w.flag || w.flagKey || '',
        tc: w.tc != null ? Math.round(w.tc) : (w.airT != null ? Math.round(w.airT) : null),
        ts: w.ts || ts.slice(0, 16),
      });
    } catch (e) { wxSnap = ''; }
  }
  insertRow_('checkouts', {
    id, boatId: b.boatId || '', boatName: b.boatName || '', boatCategory: b.boatCategory || '',
    memberKennitala: kt,
    memberName: b.memberName || '', crew: b.crew || 1,
    locationId: b.locationId || '', locationName: b.locationName || '',
    checkedOutAt: b.checkedOutAt || b.timeOut || ts.slice(11, 16),
    expectedReturn: b.expectedReturn || b.returnBy || '',
    checkedInAt: '', wxSnapshot: wxSnap,
    preLaunchChecklist: b.preLaunchChecklist || '', notes: b.notes || '',
    status: 'out', createdAt: ts, departurePort: b.departurePort || '',
    crewNames: b.crewNames || '',
    memberPhone, memberIsMinor, guardianName, guardianPhone,
  });
  cDel_('checkouts'); return okJ({ id, created: true });
}

function saveGroupCheckout_(b) {
  ensureGroupCols_();
  const ts = now_(), id = uid_();
  let wxSnap = '';
  if (b.wxSnapshot) {
    try {
      const w = typeof b.wxSnapshot === 'string' ? JSON.parse(b.wxSnapshot) : b.wxSnapshot;
      wxSnap = JSON.stringify({
        bft: Math.round(w.bft||0), ws: Math.round(w.ws||0), wg: Math.round(w.wg||0),
        dir: w.dir||w.wDir||'',
        wv: w.wv != null ? parseFloat(parseFloat(w.wv).toFixed(1)) : null,
        flag: w.flag||'', tc: w.tc != null ? Math.round(w.tc) : null, ts: w.ts||ts.slice(0,16),
      });
    } catch(e) { wxSnap = ''; }
  }
  // Normalise arrays (frontend may send as JSON strings)
  const boatIds   = Array.isArray(b.boatIds)   ? b.boatIds   : tryParseArr_(b.boatIds);
  const boatNames = Array.isArray(b.boatNames)  ? b.boatNames : tryParseArr_(b.boatNames);
  const staffNames= Array.isArray(b.staffNames) ? b.staffNames: tryParseArr_(b.staffNames);
  insertRow_('checkouts', {
    id,
    boatId:          boatIds.join(','),
    boatName:        boatNames.join(','),
    boatCategory:    b.boatCategory || '',
    memberKennitala: '',
    memberName:      staffNames.length ? staffNames.join(', ') : 'Group',
    crew:            parseInt(b.crew) || (parseInt(b.participants)||0) + staffNames.length,
    locationId:      b.locationId || '',
    locationName:    b.locationName || '',
    checkedOutAt:    b.checkedOutAt || ts.slice(11,16),
    expectedReturn:  b.expectedReturn || '',
    checkedInAt:     '',
    wxSnapshot:      wxSnap,
    notes:           b.activityTypeName ? 'Activity: ' + b.activityTypeName : '',
    status:          'out',
    createdAt:       ts,
    isGroup:         true,
    participants:    parseInt(b.participants) || 0,
    staffNames:      JSON.stringify(staffNames),
    boatNames:       JSON.stringify(boatNames),
    boatIds:         JSON.stringify(boatIds),
    activityTypeId:  b.activityTypeId || '',
    activityTypeName:b.activityTypeName || '',
  });
  cDel_('checkouts');
  return okJ({ id, created: true });
}

function groupCheckIn_(b) {
  if (!b.id) return failJ('id required');
  const checkedInAt = b.timeIn || now_().slice(11, 16);
  updateRow_('checkouts', 'id', b.id, { status: 'in', checkedInAt });
  cDel_('checkouts');
  return okJ({ updated: true, checkedInAt });
}

function linkGroupCheckoutToActivity_(b) {
  if (!b.checkoutId || !b.activityId) return failJ('checkoutId and activityId required');
  // Mark the checkout with the linked activity id
  addColIfMissing_('checkouts', 'linkedActivityId');
  updateRow_('checkouts', 'id', b.checkoutId, { linkedActivityId: b.activityId });
  cDel_('checkouts');
  return okJ({ linked: true });
}

function tryParseArr_(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : [String(v)]; } catch(e) { return String(v).split(',').map(x=>x.trim()).filter(Boolean); }
}

function checkIn_(b) {
  if (!b.id) return failJ('id required');
  const checkedInAt = b.timeIn || now_().slice(11, 16);
  const updates = { status: 'in', checkedInAt };
  if (b.afterSailChecklist) updates.afterSailChecklist = b.afterSailChecklist;
  updateRow_('checkouts', 'id', b.id, updates);
  cDel_('checkouts'); return okJ({ updated: true, checkedInAt });
}

function deleteCheckout_(id) {
  if (!id) return failJ('id required');
  const deleted = deleteRow_('checkouts', 'id', id);
  cDel_('checkouts'); return okJ({ deleted });
}

// ── Charter management ───────────────────────────────────────────────────────

function saveCharter_(b) {
  if (!b.boatId) return failJ('boatId required');
  if (!b.memberKennitala || !b.memberName) return failJ('member required');
  if (!b.startDate || !b.endDate) return failJ('startDate and endDate required');
  const cfgMap = getConfigMap_();
  let boats = [];
  try { boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]'); } catch (e) { return failJ('Failed to parse boats'); }
  const idx = boats.findIndex(x => x.id === b.boatId);
  if (idx < 0) return failJ('Boat not found');
  boats[idx].charter = {
    memberKennitala: b.memberKennitala,
    memberName: b.memberName,
    startDate: b.startDate,
    endDate: b.endDate,
  };
  setConfigSheetValue_('boats', JSON.stringify(boats));
  cDel_('config');
  return okJ({ updated: true, boat: boats[idx] });
}

function removeCharter_(b) {
  if (!b.boatId) return failJ('boatId required');
  const cfgMap = getConfigMap_();
  let boats = [];
  try { boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]'); } catch (e) { return failJ('Failed to parse boats'); }
  const idx = boats.findIndex(x => x.id === b.boatId);
  if (idx < 0) return failJ('Boat not found');
  delete boats[idx].charter;
  setConfigSheetValue_('boats', JSON.stringify(boats));
  cDel_('config');
  return okJ({ updated: true, boat: boats[idx] });
}


// ═══════════════════════════════════════════════════════════════════════════════
// TRIPS
// ═══════════════════════════════════════════════════════════════════════════════

function getTrips_(kennitala, limit, p) {
  p = p || {};
  const all = readAll_('trips');
  const filtered = all.filter(t => (!kennitala || String(t.kennitala) === String(kennitala)) && (!p.date || (t.timeIn || t.date || '').slice(0, 10) === p.date) && (!p.linkedCheckoutId || String(t.linkedCheckoutId) === String(p.linkedCheckoutId)));
  const sorted = filtered.sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);
  return okJ({ trips: sorted.slice(0, limit || 100) });
}

function saveTrip_(b) {
  const ts = now_();

  // UPDATE path — patch only supplied fields, never ghost-insert on verify/unverify
  if (b.id && findOne_('trips', 'id', b.id)) {
    const updates = { updatedAt: ts };
    const UPDATABLE = [
      'kennitala','memberName','date','timeOut','timeIn','hoursDecimal',
      'boatId','boatName','boatCategory','locationId','locationName',
      'crew','role','beaufort','windDir','wxSnapshot','notes',
      'isLinked','linkedCheckoutId','linkedTripId',
      'verified','verifiedBy','verifiedAt','staffComment',
      'validationRequested','helm','skipperNote',
      'distanceNm','departurePort','arrivalPort',
      'trackFileUrl','trackSimplified','trackSource',
      'photoUrls','photoMeta',
    ];
    UPDATABLE.forEach(k => { if (b[k] !== undefined) updates[k] = b[k]; });
    updateRow_('trips', 'id', b.id, updates);
    return okJ({ id: b.id, updated: true });
  }

  // INSERT path
  const id = uid_();
  let boatCategory = b.boatCategory || '';
  if (!boatCategory && b.boatId) {
    try {
      const boat = getBoatMap_()[b.boatId];
      if (boat) boatCategory = boat.category || '';
    } catch (e) {}
  }
  insertRow_('trips', {
    id, kennitala: b.kennitala || '', memberName: b.memberName || '',
    date: b.date || ts.slice(0, 10), timeOut: b.timeOut || '', timeIn: b.timeIn || '',
    hoursDecimal: b.hoursDecimal || 0,
    boatId: b.boatId || '', boatName: b.boatName || '', boatCategory: boatCategory,
    locationId: b.locationId || '', locationName: b.locationName || '',
    crew: b.crew || 1, role: b.role || 'skipper',
    beaufort: b.beaufort || '', windDir: b.windDir || '', wxSnapshot: b.wxSnapshot || '',
    notes: b.notes || '', isLinked: b.isLinked || false,
    linkedCheckoutId: b.linkedCheckoutId || '', linkedTripId: b.linkedTripId || '',
    verified: false, verifiedBy: '', verifiedAt: '', staffComment: '',
    validationRequested: b.validationRequested || false, helm: b.helm || false,
    skipperNote: b.skipperNote || '',
    distanceNm: b.distanceNm || '', departurePort: b.departurePort || '', arrivalPort: b.arrivalPort || '',
    trackFileUrl: b.trackFileUrl || '', trackSimplified: b.trackSimplified || '', trackSource: b.trackSource || '',
    photoUrls: b.photoUrls || '', photoMeta: b.photoMeta || '',
    createdAt: ts,
  });
  return okJ({ id, created: true });
}

function setHelm_(b) {
  if (!b.tripId) return failJ('tripId required');
  updateRow_('trips', 'id', b.tripId, { helm: !!b.helm, updatedAt: now_() });
  return okJ({ updated: true });
}

function deleteTrip_(id) {
  if (!id) return failJ('id required');
  return okJ({ deleted: deleteRow_('trips', 'id', id) });
}

function requestValidation_(b) {
  if (!b.tripId) return failJ('tripId required');
  updateRow_('trips', 'id', b.tripId, { validationRequested: true });
  return okJ({ requested: true });
}


// ═══════════════════════════════════════════════════════════════════════════════
// TRIP CONFIRMATIONS (handshake protocol)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Types:
//   'crew_assigned'  — skipper assigned a crew member → crew must confirm
//   'crew_join'      — member wants to join a trip    → skipper must confirm
//   'helm'           — helm toggle requested          → other party confirms
//   'student'        — skipper marks crew as student  → crew must confirm
//
// Status: 'pending' | 'confirmed' | 'rejected'
// ═══════════════════════════════════════════════════════════════════════════════

function ensureConfirmationCols_() {
  var cols = [
    'id','type','status',
    'fromKennitala','fromName',
    'toKennitala','toName',
    'tripId','linkedCheckoutId',
    'boatId','boatName','boatCategory',
    'locationId','locationName',
    'date','timeOut','timeIn','hoursDecimal',
    'role','helm','crew','skipperNote',
    'beaufort','windDir','wxSnapshot',
    'rejectComment',
    'createdAt','respondedAt',
  ];
  cols.forEach(function(c) { addColIfMissing_('tripConfirmations', c); });
}

function getConfirmations_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  var kt = String(b.kennitala);
  var all;
  try { all = readAll_('tripConfirmations'); } catch(e) { all = []; }
  var incoming = all.filter(function(r) { return String(r.toKennitala) === kt && !r.dismissed; });
  var outgoing = all.filter(function(r) { return String(r.fromKennitala) === kt && !r.dismissed; });
  return okJ({ incoming: incoming, outgoing: outgoing });
}

function createConfirmation_(b) {
  ensureConfirmationCols_();
  if (!b.type) return failJ('type required');
  if (!b.toKennitala) return failJ('toKennitala required');
  var ts = now_(), id = uid_();
  insertRow_('tripConfirmations', {
    id: id, type: b.type || '', status: 'pending',
    fromKennitala: b.fromKennitala || '', fromName: b.fromName || '',
    toKennitala: b.toKennitala || '', toName: b.toName || '',
    tripId: b.tripId || '', linkedCheckoutId: b.linkedCheckoutId || '',
    boatId: b.boatId || '', boatName: b.boatName || '', boatCategory: b.boatCategory || '',
    locationId: b.locationId || '', locationName: b.locationName || '',
    date: b.date || '', timeOut: b.timeOut || '', timeIn: b.timeIn || '',
    hoursDecimal: b.hoursDecimal || '',
    role: b.role || '', helm: b.helm || false,
    crew: b.crew || 1, skipperNote: b.skipperNote || '',
    beaufort: b.beaufort || '', windDir: b.windDir || '', wxSnapshot: b.wxSnapshot || '',
    rejectComment: '',
    createdAt: ts, respondedAt: '',
  });
  return okJ({ id: id, created: true });
}

function respondConfirmation_(b) {
  if (!b.id) return failJ('id required');
  if (!b.response || (b.response !== 'confirmed' && b.response !== 'rejected'))
    return failJ('response must be confirmed or rejected');
  var row = findOne_('tripConfirmations', 'id', b.id);
  if (!row) return failJ('Confirmation not found', 404);
  if (row.status !== 'pending') return failJ('Already responded');

  var ts = now_();
  var updates = { status: b.response, respondedAt: ts };
  if (b.response === 'rejected' && b.rejectComment) updates.rejectComment = b.rejectComment;
  updateRow_('tripConfirmations', 'id', b.id, updates);

  // On confirm — create the trip record
  if (b.response === 'confirmed') {
    var type = row.type;
    if (type === 'crew_assigned' || type === 'crew_join') {
      // Determine who the crew member is
      var crewKt, crewName, role;
      if (type === 'crew_assigned') {
        // Skipper assigned crew → the "to" person is the crew member
        crewKt = row.toKennitala; crewName = row.toName; role = 'crew';
      } else {
        // Member asked to join → the "from" person is the crew member
        crewKt = row.fromKennitala; crewName = row.fromName; role = 'crew';
      }
      // Check if trip already exists for this member + checkout
      var existing = readAll_('trips').filter(function(t) {
        return String(t.kennitala) === String(crewKt) &&
          (row.linkedCheckoutId ? String(t.linkedCheckoutId) === String(row.linkedCheckoutId) :
           String(t.linkedTripId) === String(row.tripId));
      });
      if (!existing.length) {
        // Get crew count and skipper note — prefer denormalized values, fall back to trip lookup for old rows
        var origCrew = row.crew || 1, origSkipperNote = row.skipperNote || '';
        if (origCrew <= 1 && !origSkipperNote && row.tripId) {
          var origTrip = findOne_('trips', 'id', row.tripId);
          if (origTrip) { origCrew = origTrip.crew || 1; origSkipperNote = origTrip.skipperNote || ''; }
        }
        var tripId = uid_();
        insertRow_('trips', {
          id: tripId, kennitala: crewKt, memberName: crewName,
          date: row.date || '', timeOut: row.timeOut || '', timeIn: row.timeIn || '',
          hoursDecimal: row.hoursDecimal || 0,
          boatId: row.boatId || '', boatName: row.boatName || '', boatCategory: row.boatCategory || '',
          locationId: row.locationId || '', locationName: row.locationName || '',
          crew: origCrew, role: role,
          beaufort: row.beaufort || '', windDir: row.windDir || '', wxSnapshot: row.wxSnapshot || '',
          notes: '', skipperNote: origSkipperNote, isLinked: true,
          linkedCheckoutId: row.linkedCheckoutId || '', linkedTripId: row.tripId || '',
          verified: false, verifiedBy: '', verifiedAt: '', staffComment: '',
          validationRequested: false, helm: false,
          distanceNm: '', departurePort: '', arrivalPort: '',
          trackFileUrl: '', trackSimplified: '', trackSource: '', photoUrls: '',
          createdAt: ts,
        });
      }
    }
    if (type === 'helm') {
      // Set helm on the specified trip
      if (row.tripId) {
        updateRow_('trips', 'id', row.tripId, { helm: true, updatedAt: ts });
      }
    }
    if (type === 'student') {
      // Set student flag on the crew member's trip for this checkout
      var stuKt = row.toKennitala;
      var coId = row.linkedCheckoutId;
      if (stuKt && coId) {
        addColIfMissing_('trips', 'student');
        var stuTrips = readAll_('trips').filter(function(t) {
          return String(t.kennitala) === String(stuKt) && String(t.linkedCheckoutId) === String(coId);
        });
        stuTrips.forEach(function(t) {
          updateRow_('trips', 'id', t.id, { student: true, updatedAt: ts });
        });
      }
    }
  }
  return okJ({ updated: true, status: b.response });
}

function dismissConfirmation_(b) {
  if (!b.id) return failJ('id required');
  var row = findOne_('tripConfirmations', 'id', b.id);
  if (!row) return failJ('Confirmation not found', 404);
  if (row.status === 'pending') return failJ('Cannot dismiss pending confirmations');
  updateRow_('tripConfirmations', 'id', b.id, { dismissed: true, dismissedAt: now_() });
  return okJ({ dismissed: true });
}

function dismissAllConfirmations_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  var kt = String(b.kennitala);
  var all;
  try { all = readAll_('tripConfirmations'); } catch(e) { all = []; }
  var toDismiss = all.filter(function(r) {
    return (String(r.toKennitala) === kt || String(r.fromKennitala) === kt)
      && r.status !== 'pending' && !r.dismissed;
  });
  toDismiss.forEach(function(r) {
    updateRow_('tripConfirmations', 'id', r.id, { dismissed: true, dismissedAt: now_() });
  });
  return okJ({ dismissed: toDismiss.length });
}


// ═══════════════════════════════════════════════════════════════════════════════
// TRIP FILE UPLOADS  (GPS tracks + photos → Google Drive)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Script Properties required:
//   DRIVE_FOLDER_ID_TRACKS — folder ID for raw GPX/KML/KMZ files
//   DRIVE_FOLDER_ID_PHOTOS — folder ID for trip photos
//
// If a property is not set the function returns ok:false so the frontend
// can warn the user and save the trip without the attachment.
// ═══════════════════════════════════════════════════════════════════════════════

function uploadTripFile_(b) {
  if (!b.fileType) return failJ('fileType required');
  if (b.fileType === 'track') return saveTripTrack_(b);
  if (b.fileType === 'photo') return saveTripPhoto_(b);
  return failJ('Unknown fileType: ' + b.fileType);
}

function saveTripTrack_(b) {
  if (!b.fileData) return failJ('fileData required');
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('DRIVE_FOLDER_ID_TRACKS');
  if (!folderId) return okJ({ ok: false, error: 'Drive folder not configured' });

  try {
    const ext = (b.fileName || 'track.gpx').split('.').pop().toLowerCase();
    const ts  = now_().replace(/[: ]/g, '-');
    const safeName = ts + '_' + (b.fileName || 'track.' + ext);

    let contentBytes = Utilities.base64Decode(b.fileData.replace(/^data:[^;]+;base64,/, ''));
    let parseFormat  = ext;

    // KMZ = zipped KML — decompress and extract .kml entry
    if (ext === 'kmz') {
      const blobs = Utilities.unzip(Utilities.newBlob(contentBytes, 'application/zip', safeName));
      const kmlBlob = blobs.find(bl => bl.getName().toLowerCase().endsWith('.kml'));
      if (!kmlBlob) return failJ('No .kml found inside KMZ');
      contentBytes = kmlBlob.getBytes();
      parseFormat  = 'kml';
    }

    // Save raw file to Drive
    const folder  = DriveApp.getFolderById(folderId);
    const mimeMap = { gpx:'application/gpx+xml', kml:'application/vnd.google-earth.kml+xml', kmz:'application/vnd.google-earth.kmz' };
    const blob    = Utilities.newBlob(contentBytes, mimeMap[ext] || 'application/octet-stream', safeName);
    const file    = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const trackFileUrl = file.getUrl();

    // Parse GPS content
    const contentStr = Utilities.newBlob(contentBytes).getDataAsString('UTF-8');
    const parsed = parseGpsTrack_(contentStr, parseFormat);

    return okJ({
      ok: true,
      trackFileUrl,
      trackSource: ext.toUpperCase(),
      distanceNm:      parsed.distanceNm,
      departureTime:   parsed.departureTime,
      arrivalTime:     parsed.arrivalTime,
      trackSimplified: JSON.stringify(parsed.simplifiedTrack),
      pointCount:      parsed.pointCount,
    });
  } catch (e) {
    return failJ('Track upload error: ' + e.message);
  }
}

function saveTripPhoto_(b) {
  if (!b.fileData) return failJ('fileData required');
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('DRIVE_FOLDER_ID_PHOTOS');
  if (!folderId) return okJ({ ok: false, error: 'Drive folder not configured' });

  try {
    const ext      = (b.fileName || 'photo.jpg').split('.').pop().toLowerCase();
    const ts       = now_().replace(/[: ]/g, '-');
    const safeName = ts + '_' + (b.fileName || 'photo.' + ext);
    const base64   = b.fileData.replace(/^data:[^;]+;base64,/, '');
    const bytes    = Utilities.base64Decode(base64);
    const mimeMap  = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', heic:'image/heic' };
    const mime     = b.mimeType || mimeMap[ext] || 'image/jpeg';
    const blob     = Utilities.newBlob(bytes, mime, safeName);
    const folder   = DriveApp.getFolderById(folderId);
    const file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return okJ({ ok: true, photoUrl: file.getUrl() });
  } catch (e) {
    return failJ('Photo upload error: ' + e.message);
  }
}

// ── Delete trip file (track or individual photo) ─────────────────────────

function deleteTripFile_(b) {
  if (!b.tripId) return failJ('tripId required');
  if (!b.fileType) return failJ('fileType required (track or photo)');

  const trip = findOne_('trips', 'id', b.tripId);
  if (!trip) return failJ('Trip not found');

  // Only the trip owner may delete uploads
  if (String(trip.kennitala) !== String(b.kennitala)) return failJ('Not authorised');

  if (b.fileType === 'track') {
    // Try to trash the Drive file
    tryTrashDriveUrl_(trip.trackFileUrl);
    updateRow_('trips', 'id', b.tripId, {
      trackFileUrl: '', trackSimplified: '', trackSource: '',
      updatedAt: now_(),
    });
    return okJ({ ok: true, deleted: 'track' });
  }

  if (b.fileType === 'photo') {
    if (!b.photoUrl) return failJ('photoUrl required');
    tryTrashDriveUrl_(b.photoUrl);
    let urls = [];
    try { urls = JSON.parse(trip.photoUrls || '[]'); } catch(e) {}
    urls = urls.filter(function(u) { return u !== b.photoUrl; });
    updateRow_('trips', 'id', b.tripId, {
      photoUrls: urls.length ? JSON.stringify(urls) : '',
      updatedAt: now_(),
    });
    return okJ({ ok: true, deleted: 'photo', remaining: urls.length });
  }

  return failJ('Unknown fileType: ' + b.fileType);
}

function tryTrashDriveUrl_(url) {
  if (!url) return;
  try {
    const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) DriveApp.getFileById(m[1]).setTrashed(true);
  } catch(e) { /* file may already be gone */ }
}

// ── GPS track parser ──────────────────────────────────────────────────────────

function parseGpsTrack_(content, format) {
  const doc = XmlService.parse(content);
  const root = doc.getRootElement();
  let points = [];   // [{lat, lng, time}]

  if (format === 'gpx') {
    // Support GPX 1.0 and 1.1 namespaces
    const ns0 = XmlService.getNamespace('http://www.topografix.com/GPX/1/0');
    const ns1 = XmlService.getNamespace('http://www.topografix.com/GPX/1/1');
    [ns0, ns1].forEach(function(ns) {
      try {
        root.getChildren('trk', ns).forEach(function(trk) {
          trk.getChildren('trkseg', ns).forEach(function(seg) {
            seg.getChildren('trkpt', ns).forEach(function(pt) {
              const lat  = parseFloat(pt.getAttribute('lat').getValue());
              const lng  = parseFloat(pt.getAttribute('lon').getValue());
              const timeEl = pt.getChild('time', ns);
              const time = timeEl ? timeEl.getText() : null;
              if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, time });
            });
          });
        });
      } catch(e) {}
    });
    // Fallback: try without namespace
    if (!points.length) {
      root.getDescendants().forEach(function(cNode) {
        try {
          const el = cNode.asElement();
          if (el && el.getName() === 'trkpt') {
            const lat = parseFloat(el.getAttribute('lat').getValue());
            const lng = parseFloat(el.getAttribute('lon').getValue());
            const timeEl = el.getChildren().find(function(c){ return c.getName()==='time'; });
            const time = timeEl ? timeEl.getText() : null;
            if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, time });
          }
        } catch(e) {}
      });
    }
  } else {
    // KML: look for LineString coordinates or gx:Track when/coord pairs
    const kmlNs  = XmlService.getNamespace('http://www.opengis.net/kml/2.2');
    const gxNs   = XmlService.getNamespace('http://www.google.com/kml/ext/2.2');

    // Try gx:Track first (has timestamps)
    const allEls = root.getDescendants();
    let gxTrackFound = false;
    for (let i = 0; i < allEls.length; i++) {
      let el; try { el = allEls[i].asElement(); } catch(e) { continue; }
      if (!el || el.getName() !== 'Track') continue;
      gxTrackFound = true;
      const whens  = el.getChildren('when', gxNs);
      const coords = el.getChildren('coord', gxNs);
      const len    = Math.min(whens.length, coords.length);
      for (let j = 0; j < len; j++) {
        const parts = coords[j].getText().trim().split(/\s+/);
        const lng = parseFloat(parts[0]), lat = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, time: whens[j].getText() });
      }
      break;
    }

    // Fall back to LineString coordinates (no timestamps)
    if (!gxTrackFound || !points.length) {
      for (let i = 0; i < allEls.length; i++) {
        let el; try { el = allEls[i].asElement(); } catch(e) { continue; }
        if (!el || el.getName() !== 'coordinates') continue;
        const raw = el.getText().trim();
        raw.split(/\s+/).forEach(function(token) {
          const parts = token.split(',');
          const lng = parseFloat(parts[0]), lat = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, time: null });
        });
      }
    }
  }

  if (!points.length) return { distanceNm: 0, departureTime: null, arrivalTime: null, simplifiedTrack: [], pointCount: 0 };

  // Sort by timestamp where available
  points.sort(function(a, b) { return a.time && b.time ? a.time < b.time ? -1 : 1 : 0; });

  // Compute total distance (Haversine)
  let totalM = 0;
  for (let i = 1; i < points.length; i++) {
    totalM += haversineM_(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
  }
  const distanceNm = Math.round((totalM / 1852) * 10) / 10;

  // RDP simplification → target ~50-100 representative points
  const simplified = rdpSimplify_(points.map(function(p){ return {lat:p.lat,lng:p.lng}; }), 0.0005);

  return {
    distanceNm,
    departureTime: points[0].time || null,
    arrivalTime:   points[points.length - 1].time || null,
    simplifiedTrack: simplified,
    pointCount: points.length,
  };
}

function haversineM_(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
  const df = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(df/2)*Math.sin(df/2) + Math.cos(f1)*Math.cos(f2)*Math.sin(dl/2)*Math.sin(dl/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function rdpSimplify_(points, epsilon) {
  if (points.length < 3) return points;
  // Find point farthest from the line between first and last
  const first = points[0], last = points[points.length - 1];
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist_(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left  = rdpSimplify_(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify_(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function perpendicularDist_(p, a, b) {
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) {
    return Math.sqrt(Math.pow(p.lng - a.lng, 2) + Math.pow(p.lat - a.lat, 2));
  }
  const t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx*dx + dy*dy);
  return Math.sqrt(Math.pow(p.lng - (a.lng + t*dx), 2) + Math.pow(p.lat - (a.lat + t*dy), 2));
}


// ═══════════════════════════════════════════════════════════════════════════════
// WEATHER
// ═══════════════════════════════════════════════════════════════════════════════

function getWeather_() {
  try {
    const res = UrlFetchApp.fetch('https://aviationweather.gov/api/data/metar?ids=BIRK&format=json', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return failJ('BIRK fetch failed: HTTP ' + res.getResponseCode());
    const data = JSON.parse(res.getContentText());
    const obs = Array.isArray(data) ? data[0] : null;
    if (!obs) return failJ('No BIRK METAR returned');
    return okJ({ obs });
  } catch (e) { return failJ('getWeather error: ' + e.message); }
}


// ═══════════════════════════════════════════════════════════════════════════════
// OVERDUE ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

function getAlertConfig_() {
  const raw = getConfigSheetValue_('overdueAlerts');
  const defaults = {
    enabled: true, firstAlertMins: 15, repeatMins: 30, snoozeMins: 30,
    channels: { web: true, email: false, sms: false },
    staffEmailList: [], staffSmsList: [],
  };
  if (!raw) return defaults;
  try {
    const p = JSON.parse(raw);
    return { ...defaults, ...p, channels: { ...defaults.channels, ...(p.channels || {}) } };
  } catch (e) { return defaults; }
}

// Read the entire config sheet once and return a key→value map
function getConfigMap_() {
  let sheet;
  try { sheet = getSheet_('config'); } catch (e) { return {}; }
  if (sheet.getLastRow() < 2) return {};
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const map = {};
  data.forEach(r => { map[String(r[0]).trim()] = String(r[1]).trim(); });
  return map;
}

function getConfigValue_(key, map) {
  const v = map[key];
  return v !== undefined ? v : null;
}

function getAlertConfigFromMap_(cfgMap) {
  const raw = getConfigValue_('overdueAlerts', cfgMap);
  const defaults = {
    enabled: true, firstAlertMins: 15, repeatMins: 30, snoozeMins: 30,
    channels: { web: true, email: false, sms: false },
    staffEmailList: [], staffSmsList: [],
  };
  if (!raw) return defaults;
  try {
    const p = JSON.parse(raw);
    return { ...defaults, ...p, channels: { ...defaults.channels, ...(p.channels || {}) } };
  } catch (e) { return defaults; }
}

function getFlagConfigFromMap_(cfgMap) {
  const raw = getConfigValue_('flagConfig', cfgMap);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function getCertDefsFromMap_(cfgMap) {
  const raw = getConfigValue_('certDefs', cfgMap);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function getConfigSheetValue_(key) {
  let sheet;
  try { sheet = getSheet_('config'); } catch (e) { return null; }
  if (sheet.getLastRow() < 2) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const row = data.find(r => String(r[0]).trim() === key);
  return row ? String(row[1]).trim() : null;
}

function setConfigSheetValue_(key, value) {
  let sheet;
  try { sheet = getSheet_('config'); } catch (e) {
    sheet = ss_().insertSheet('config');
    sheet.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => String(r[0]).trim());
    const idx = keys.indexOf(key);
    if (idx !== -1) { sheet.getRange(idx + 2, 2).setValue(value); return; }
  }
  sheet.appendRow([key, value]);
}

function getOverdueAlerts_(b) {
  if (!b._serverSide && (!b || b.token !== API_TOKEN_)) throw new Error('Unauthorized');
  const cfg = getAlertConfig_();
  if (!cfg.enabled) { const ep = { success: true, alerts: [], snoozeMins: cfg.snoozeMins }; return b && b._serverSide ? ep : okJ(ep); }
  const sheet = getSheet_('checkouts');
  if (sheet.getLastRow() < 2) return okJ({ alerts: [], snoozeMins: cfg.snoozeMins });
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = name => headers.indexOf(name);
  const now_ms = Date.now();
  const now_dt = new Date();
  const todayStr = Utilities.formatDate(now_dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const nowMins = now_dt.getHours() * 60 + now_dt.getMinutes();
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  let memberMap = {};
  try { memberMap = getMemberMap_(); } catch (e) { }
  const alerts = [];
  data.forEach(row => {
    const status = String(row[col('status')] || '').trim();
    // date column doesn't exist — derive from checkedOutAt (may be a Date object or string)
    const coAtRaw  = row[col('checkedOutAt')];
    const date     = coAtRaw instanceof Date ? Utilities.formatDate(coAtRaw, Session.getScriptTimeZone(), 'yyyy-MM-dd')
                   : String(coAtRaw || '').slice(0, 10);
    // expectedReturn may be a Sheets Date object (1899 epoch for time values)
    const retByRaw  = row[col('expectedReturn')] || row[col('returnBy')];
    let   retBy     = '';
    if (retByRaw instanceof Date) {
      retBy = String(retByRaw.getHours()).padStart(2,'0') + ':' + String(retByRaw.getMinutes()).padStart(2,'0');
    } else {
      retBy = String(retByRaw || '').trim();
    }
    const silenced = row[col('alertSilenced')];
    if (status !== 'out') return;
    if (!retBy) return;
    // Parse retBy (HH:MM or 4-digit HHMM number)
    let retByStr = String(retBy).trim().replace(/[^0-9:]/g, '');
    if (retByStr.length === 4 && !retByStr.includes(':')) retByStr = retByStr.slice(0,2) + ':' + retByStr.slice(2);
    const [retH, retM] = retByStr.split(':').map(Number);
    if (isNaN(retH) || isNaN(retM)) return;
    // Build expected return as a full Date using today as base
    // (no reliable date stored in sheet for active checkouts)
    const retDt = new Date(todayStr + 'T' + String(retH).padStart(2,'0') + ':' + String(retM).padStart(2,'0') + ':00');
    // If retBy < checkedOutAt time (overnight), return is the following day
    const coAtVal  = row[col('checkedOutAt')];
    const coH      = coAtVal instanceof Date ? coAtVal.getHours() : parseInt((String(coAtVal||'').split(':')[0]||'0'), 10);
    if (!isNaN(coH) && retH < coH) retDt.setDate(retDt.getDate() + 1);
    const overdueMin = Math.round((now_ms - retDt.getTime()) / 60000);
    if (overdueMin < cfg.firstAlertMins) return;
    let snoozedUntil = null;
    const snoozeRaw = row[col('alertSnoozedUntil')];
    if (snoozeRaw) {
      const snoozeDate = new Date(snoozeRaw);
      if (!isNaN(snoozeDate) && snoozeDate.getTime() > now_ms) snoozedUntil = snoozeDate.toISOString();
    }
    const kt = String(row[col('memberKennitala')] || row[col('kennitala')] || '');
    const m = memberMap[kt] || {};
    const phone = String(row[col('memberPhone')] || m.phone || '');
    const isMinor = row[col('memberIsMinor')] !== undefined && row[col('memberIsMinor')] !== ''
      ? bool_(row[col('memberIsMinor')])
      : !!(m.isMinor === true || m.isMinor === 'true' || m.isMinor === 'TRUE');
    const guardianName = String(row[col('guardianName')] || m.guardianName || '');
    const guardianPhone = String(row[col('guardianPhone')] || m.guardianPhone || '');
    alerts.push({
      checkoutId: String(row[col('id')] || ''),
      boatName: String(row[col('boatName')] || '—'),
      memberName: String(row[col('memberName')] || '—'),
      memberPhone: phone, isMinor, guardianName, guardianPhone,
      locationName: String(row[col('locationName')] || '—'),
      expectedReturn: retBy, minutesOverdue: overdueMin,  checkoutDate: todayStr, launchTime: (function(){ var v=row[col('checkedOutAt')]; return v instanceof Date ? (String(v.getHours()).padStart(2,'0')+':'+String(v.getMinutes()).padStart(2,'0')) : String(v||''); })(),
      firstAlertSent: !!row[col('alertFirstSent')],
      snoozedUntil,
    });
  });
  alerts.sort((a, b) => b.minutesOverdue - a.minutesOverdue);
  const payload = { success: true, alerts, snoozeMins: cfg.snoozeMins };
  return b && b._serverSide ? payload : okJ(payload);
}

function silenceAlert_(b) {
  if (!b._serverSide && (!b || b.token !== API_TOKEN_)) throw new Error('Unauthorized');
  if (!b.id) throw new Error('id required');
  const row = getCheckoutRow_(b.id);
  if (!row) throw new Error('Checkout not found: ' + b.id);
  row._sheet.getRange(row._sheetRow, row._col1('alertSilenced')).setValue(true);
  row._sheet.getRange(row._sheetRow, row._col1('alertSilencedBy')).setValue(b.silencedBy || '');
  row._sheet.getRange(row._sheetRow, row._col1('alertSilencedAt')).setValue(now_());
  return okJ({ id: b.id });
}

function snoozeAlert_(b) {
  if (!b._serverSide && (!b || b.token !== API_TOKEN_)) throw new Error('Unauthorized');
  if (!b.id) throw new Error('id required');
  const cfg = getAlertConfig_();
  const mins = Number(b.snoozeMins) || cfg.snoozeMins || 30;
  const until = new Date(Date.now() + mins * 60000).toISOString();
  const row = getCheckoutRow_(b.id);
  if (!row) throw new Error('Checkout not found: ' + b.id);
  row._sheet.getRange(row._sheetRow, row._col1('alertSnoozedUntil')).setValue(until);
  return okJ({ id: b.id, snoozedUntil: until });
}

function getCheckoutRow_(id) {
  const sheet = getSheet_('checkouts');
  if (sheet.getLastRow() < 2) return null;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const col1 = name => headers.indexOf(name) + 1;
  const ids = sheet.getRange(2, col1('id'), sheet.getLastRow() - 1, 1).getValues().map(r => String(r[0]));
  const rowIdx = ids.indexOf(String(id));
  if (rowIdx === -1) return null;
  const sheetRow = rowIdx + 2;
  const values = sheet.getRange(sheetRow, 1, 1, lastCol).getValues()[0];
  const row = {};
  headers.forEach((h, i) => { row[h] = values[i]; });
  row._sheetRow = sheetRow; row._col1 = col1; row._sheet = sheet;
  return row;
}

function checkAndSendOverdueAlerts() {
  const cfg = getAlertConfig_();
  const result = getOverdueAlerts_({ _serverSide: true });
  const alerts = (result.success ? (result.alerts || []) : []);
  const props = PropertiesService.getScriptProperties();
  const now_ms = Date.now();
  const repeatMs = (cfg.repeatMins || 30) * 60000;
  alerts.forEach(alert => {
    if (alert.snoozedUntil && new Date(alert.snoozedUntil).getTime() > now_ms) return;
    const propKey = 'lastAlert_' + alert.checkoutId;
    const lastAlert = parseInt(props.getProperty(propKey) || '0', 10);
    const shouldSend = (lastAlert === 0) || (cfg.repeatMins > 0 && (now_ms - lastAlert) >= repeatMs);
    if (!shouldSend) return;
    let sent = false;
    if (cfg.channels.email && cfg.staffEmailList.length) {
      try { sendEmailAlert_(alert, cfg); sent = true; } catch (e) { Logger.log('Email failed: ' + e.message); }
    }
    if (cfg.channels.sms && cfg.staffSmsList.length) {
      try { sendSmsAlert_(alert, cfg); sent = true; } catch (e) { Logger.log('SMS failed: ' + e.message); }
    }
    if (sent || (!cfg.channels.email && !cfg.channels.sms)) props.setProperty(propKey, String(now_ms));
    if (!alert.firstAlertSent) {
      try {
        const row = getCheckoutRow_(alert.checkoutId);
        if (row) row._sheet.getRange(row._sheetRow, row._col1('alertFirstSent')).setValue(new Date().toISOString());
      } catch (e) { }
    }
  });
  const activeKeys = new Set(alerts.map(a => 'lastAlert_' + a.checkoutId));
  Object.keys(props.getProperties()).forEach(k => {
    if (k.startsWith('lastAlert_') && !activeKeys.has(k)) props.deleteProperty(k);
  });
}

function resolveFromEmail_(b) {
  try {
    const id = b.id || b.checkoutId;
    const action = b.op || b.action || 'silence';
    if (!b.token || b.token !== API_TOKEN_) return HtmlService.createHtmlOutput('<h2>Unauthorized.</h2>');
    // Find the checkout row
    const sheet = getSheet_('checkouts');
    const data  = sheet.getDataRange().getValues();
    const headers = data[0];
    const col = h => headers.indexOf(h);
    const rowIdx = data.findIndex((r, i) => i > 0 && String(r[col('id')]) === String(id));
    if (rowIdx > 0) {
      // Silence the alert
      sheet.getRange(rowIdx+1, col('alertSilenced')+1).setValue(true);
      if (action === 'checkInAndClose') {
        const L = CLUB_LANG_;
        const now = now_();
        const note = L === 'IS' ? 'Skráð inn sjálfvirkt í gegnum tölvupóstviðvörun.' : 'Checked in automatically via email alert.';
        sheet.getRange(rowIdx+1, col('status')+1).setValue('in');
        sheet.getRange(rowIdx+1, col('checkedInAt')+1).setValue(now);
        sheet.getRange(rowIdx+1, col('notes')+1).setValue(note);
        cDel_('checkouts');
        const L2 = CLUB_LANG_;
        return HtmlService.createHtmlOutput(`<h2 style="font-family:sans-serif;color:#27ae60">${L2==='IS'?'Bát skráður inn.':'Boat checked in.'}</h2><p>${note}</p>`);
      } else if (action === 'snooze') {
        const cfg = getAlertConfig_();
        const snoozeUntil = new Date(Date.now() + (cfg.snoozeMins||30)*60000).toISOString();
        sheet.getRange(rowIdx+1, col('snoozedUntil')+1).setValue(snoozeUntil);
        cDel_('checkouts');
        const L2 = CLUB_LANG_;
        return HtmlService.createHtmlOutput(`<h2 style="font-family:sans-serif;color:#e67e22">${L2==='IS'?'Viðvörun frestað.':'Alert snoozed.'}</h2>`);
      }
    }
    const L = CLUB_LANG_;
    return HtmlService.createHtmlOutput(`<h2 style="font-family:sans-serif">${L==='IS'?'Lokið.':'Done.'}</h2>`);
  } catch(e) {
    return HtmlService.createHtmlOutput('<h2>Error: ' + e.message + '</h2>');
  }
}

function handleAlertAction_(b) {
  // Web-based alert action — token-authenticated, no HMAC needed
  try {
    const id = b.id, action = b.action || 'silence';
    if (!id) return failJ('Missing id');
    const sheet   = getSheet_('checkouts');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const col     = h => headers.indexOf(h);
    const rowIdx  = data.findIndex((r, i) => i > 0 && String(r[col('id')]) === String(id));
    if (rowIdx < 1) return failJ('Checkout not found');
    const L = CLUB_LANG_;
    sheet.getRange(rowIdx+1, col('alertSilenced')+1).setValue(true);
    if (action === 'checkInAndClose') {
      const now = now_();
      const note = L === 'IS' ? 'Skráð inn af starfsmanni í gegnum vefalert.' : 'Checked in by staff via web alert.';
      sheet.getRange(rowIdx+1, col('status')+1).setValue('in');
      sheet.getRange(rowIdx+1, col('checkedInAt')+1).setValue(now);
      sheet.getRange(rowIdx+1, col('notes')+1).setValue(note);
      cDel_('checkouts');
      return okJ({ action, done: true, note });
    } else if (action === 'snooze') {
      const cfg = getAlertConfig_();
      const snoozeUntil = new Date(Date.now() + (cfg.snoozeMins||30)*60000).toISOString();
      sheet.getRange(rowIdx+1, col('alertSnoozedUntil')+1).setValue(snoozeUntil);
      cDel_('checkouts');
      return okJ({ action, done: true, snoozedUntil: snoozeUntil });
    }
    cDel_('checkouts');
    return okJ({ action, done: true });
  } catch(e) { return failJ('handleAlertAction failed: ' + e.message); }
}

function emailResponseHtml_(message, ok, lang) {
  const L = lang || CLUB_LANG_;
  const color = ok ? '#27ae60' : '#e74c3c';
  const icon = ok ? '✓' : '⚠️';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ÝMIR</title>
<style>body{font-family:monospace;background:#071526;color:#d6e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#0b1f38;border:1px solid #1e3a5a;border-radius:12px;padding:36px 40px;max-width:420px;text-align:center}
.icon{font-size:32px;color:${color};margin-bottom:16px}.msg{font-size:14px;line-height:1.6}
.sub{font-size:11px;color:#6b92b8;margin-top:16px}a{color:#d4af37}</style></head>
<body><div class="card"><div class="icon">${icon}</div><div class="msg">${message}</div>
<div class="sub"><a href="https://skarfur.github.io/ymir/staff/">${htmlEsc_(gs_('resolve.portal', null, L))}</a></div>
</div></body></html>`;
}

function htmlEsc_(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sendEmailAlert_(alert, cfg) {
  const L = CLUB_LANG_;
  const secret   = API_TOKEN_;  // used as tok param in action URLs
  const staffUrl = 'https://skarfur.github.io/ymir/staff/';
  function actionUrl(op) {
    return staffUrl + '?alertAction=' + op + '&id=' + encodeURIComponent(alert.checkoutId) + '&tok=' + encodeURIComponent(secret);
  }
  const hrs = Math.floor(alert.minutesOverdue / 60);
  const min = alert.minutesOverdue % 60;
  const overdueDisplay = hrs > 0
    ? gs_('alert.overdueHrs', { h: hrs, m: min }, L)
    : gs_('alert.overdueHrs', { h: 0, m: min }, L).replace(L === 'IS' ? /^0klst\s/ : /^0h\s/, '');
  const minorSuffix = alert.isMinor ? gs_('alert.minor', null, L) : '';
  const subject = gs_('alert.subject', {
    minor: minorSuffix, boat: alert.boatName,
    overdue: hrs > 0 ? gs_('alert.overdueHrs', { h: hrs, m: min }, L) : gs_('alert.overdueMins', { n: min }, L)
  }, L);
  const guardianHtml = alert.isMinor && (alert.guardianName || alert.guardianPhone)
    ? `<tr><td style="color:#6b92b8;padding:5px 0;vertical-align:top;width:160px">${gs_('alert.guardian', null, L)}</td>
       <td style="color:#f5d76e">${htmlEsc_(alert.guardianName || '—')}${alert.guardianPhone ? '<br><a href="tel:' + htmlEsc_(alert.guardianPhone) + '" style="color:#d4af37">' + htmlEsc_(alert.guardianPhone) + '</a>' : ''}</td></tr>` : '';
  const guardianText = alert.isMinor && (alert.guardianName || alert.guardianPhone)
    ? '\n' + gs_('alert.guardian', null, L) + ':  ' + (alert.guardianName || '—') + (alert.guardianPhone ? ' · ' + alert.guardianPhone : '') : '';
  const body = [
    gs_('alert.txt.title', null, L), '',
    gs_('alert.boat', null, L) + ':  ' + alert.boatName,
    gs_('alert.sailor', null, L) + ':  ' + alert.memberName + (alert.isMinor ? gs_('alert.minor', null, L) : ''),
    gs_('alert.phone', null, L) + ':  ' + (alert.memberPhone || gs_('alert.noPhone', null, L)),
    guardianText,
    gs_('alert.location', null, L) + ':  ' + alert.locationName,
    gs_('alert.expectedReturn', null, L) + ':  ' + alert.expectedReturn,
    gs_('alert.overdue', null, L) + ':  ' + overdueDisplay, '',
    gs_('alert.txt.silence', null, L) + '  ' + actionUrl('silence'),
    gs_('alert.txt.snooze', null, L) + '  ' + actionUrl('snooze'), '',
    gs_('alert.txt.portal', null, L) + '  https://skarfur.github.io/ymir/staff/', '',
    '— ÝMIR',
  ].filter(l => l !== null).join('\n');
  const footNote = gs_('alert.footNote', { n: cfg.snoozeMins }, L);
  const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#071526;font-family:'Courier New',monospace">
<div style="max-width:560px;margin:0 auto">
  <div style="background:#e74c3c;color:#fff;padding:14px 20px;border-radius:6px 6px 0 0;font-size:16px;font-weight:bold">
    ${L==='IS'?'⚠️ Bátur er tímaseinaður':'⚠️ Boat Overdue'}
  </div>
  <div style="background:#0b1f38;border:1px solid #1e3a5a;border-top:none;padding:20px 24px">
    <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="color:#7a9cbe;padding:5px 0;width:40%">${L==='IS'?'Félagi':'Member'}</td><td style="color:#fff;padding:5px 0">${alert.memberName}${minorSuffix}</td></tr>
      <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Bátur':'Boat'}</td><td style="color:#fff;padding:5px 0">${alert.boatName}</td></tr>
      <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Siglingasvæði':'Sailing area'}</td><td style="color:#fff;padding:5px 0">${alert.locationName}</td></tr>
      <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Lagði af stað':'Launched'}</td><td style="color:#fff;padding:5px 0">${alert.launchTime||'—'}</td></tr>
      <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Áætlaður skilatími':'Expected return'}</td><td style="color:#fff;padding:5px 0">${alert.expectedReturn}</td></tr>
      <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Seinkun':'Overdue by'}</td><td style="color:#e74c3c;padding:5px 0;font-weight:bold">${overdueDisplay}</td></tr>
      ${alert.isMinor
        ? `<tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Forráðamaður':'Guardian'}</td><td style="color:#fff;padding:5px 0">${alert.guardianName||'—'}</td></tr>
           <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Sími forráðamanns':'Guardian phone'}</td><td style="color:#fff;padding:5px 0">${alert.guardianPhone||'—'}</td></tr>`
        : `<tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Sími':'Phone'}</td><td style="color:#fff;padding:5px 0">${alert.memberPhone||'—'}</td></tr>`
      }
    </table>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <a href="${actionUrl('checkInAndClose')}" style="flex:1;min-width:160px;display:block;background:#27ae60;color:#fff;text-align:center;padding:12px 16px;border-radius:5px;text-decoration:none;font-weight:bold;font-size:13px">
        ${L==='IS'?'✓ Skrá inn &amp; loka viðvörun':'✓ Check in &amp; close alert'}
      </a>
      <a href="${actionUrl('snooze')}" style="flex:1;min-width:120px;display:block;background:#e67e22;color:#fff;text-align:center;padding:12px 16px;border-radius:5px;text-decoration:none;font-weight:bold;font-size:13px">
        ${L==='IS'?'⏱ Fresta ('+cfg.snoozeMins+' mín)':'⏱ Snooze ('+cfg.snoozeMins+' min)'}
      </a>
    </div>
  </div>
</div>
</body></html>` ;
  MailApp.sendEmail({
    to: cfg.staffEmailList.join(','), subject, body, htmlBody,
    name: 'ÝMIR Siglingafélag — Öryggisviðvörun', replyTo: cfg.staffEmailList[0] || ''
  });
  Logger.log('Alert email sent for ' + alert.checkoutId + ' (' + alert.boatName + ')');
}

function sendSmsAlert_(alert, cfg) {
  const L = CLUB_LANG_;
  const hrs = Math.floor(alert.minutesOverdue / 60);
  const min = alert.minutesOverdue % 60;
  const overdueStr = hrs > 0
    ? gs_('alert.overdueHrs', { h: hrs, m: min }, L)
    : gs_('alert.overdueHrs', { h: 0, m: min }, L).replace(L === 'IS' ? /^0klst\s/ : /^0h\s/, '');
  const message = gs_('alert.sms', {
    boat: alert.boatName, name: alert.memberName,
    minor: alert.isMinor ? gs_('alert.sms.minor', null, L) : '',
    overdue: overdueStr, ret: alert.expectedReturn, loc: alert.locationName,
    phone: alert.memberPhone || gs_('alert.noPhone', null, L),
    guardian: (alert.isMinor && alert.guardianPhone) ? gs_('alert.sms.guardian', { p: alert.guardianPhone }, L) : '',
    url: 'https://skarfur.github.io/ymir/staff/',
  }, L);
  cfg.staffSmsList.forEach(to => {
    Logger.log('[SMS] to=' + to + ' | ' + message);
  });
}

// ── One-time migration — run from Apps Script editor ───────────────────────
function migrateTripColumns() {
  var ss    = SpreadsheetApp.openById(SHEET_ID_);
  var sheet = ss.getSheetByName("trips");
  if (!sheet) { Logger.log("trips sheet not found"); return; }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log("Current headers: " + headers.join(", "));

  // Columns to remove
  var toRemove = ["windMs","seaState","precip","waveHeight","launchBeaufort","launchWindDir","launchWaveHeight"];

  // Add wxSnapshot if missing
  if (headers.indexOf("wxSnapshot") === -1) {
    sheet.getRange(1, headers.length + 1).setValue("wxSnapshot");
    headers.push("wxSnapshot");
    Logger.log("Added wxSnapshot column");
  }

  // Remove redundant columns (work right-to-left so indices stay valid)
  var removeIndices = [];
  toRemove.forEach(function(name) {
    var idx = headers.indexOf(name);
    if (idx !== -1) removeIndices.push(idx + 1);  // 1-based
  });
  removeIndices.sort(function(a,b){return b-a;});
  removeIndices.forEach(function(col) {
    sheet.deleteColumn(col);
    Logger.log("Deleted column " + col);
  });

  Logger.log("Migration complete. New headers: " + 
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].join(", "));
}

// ── resolveAlert: called by the email relay page ────────────────────────────
function resolveAlert_(b) {
  try {
    if (!b.token || b.token !== API_TOKEN_) return failJ('Unauthorized', 401);
    const id  = b.checkoutId || b.id;
    const op  = b.op || 'silence';
    if (!id) return failJ('Missing id');
    const sheet  = getSheet_('checkouts');
    const data   = sheet.getDataRange().getValues();
    const headers = data[0];
    const col    = h => headers.indexOf(h);
    const rowIdx = data.findIndex((r, i) => i > 0 && String(r[col('id')]) === String(id));
    if (rowIdx < 1) return failJ('Checkout not found');
    // Silence the alert in all cases
    sheet.getRange(rowIdx+1, col('alertSilenced')+1).setValue(true);
    if (op === 'checkInAndClose') {
      const L            = CLUB_LANG_;
      const checkedInAt  = now_().slice(11, 16);
      const note         = L === 'IS' ? 'Skráð inn í gegnum viðvörun á vef.' : 'Checked in via web alert.';
      sheet.getRange(rowIdx+1, col('status')+1).setValue('in');
      sheet.getRange(rowIdx+1, col('checkedInAt')+1).setValue(checkedInAt);
      sheet.getRange(rowIdx+1, col('notes')+1).setValue(note);
    } else if (op === 'snooze') {
      const cfg = getAlertConfig_();
      const until = new Date(Date.now() + (cfg.snoozeMins||30)*60000).toISOString();
      sheet.getRange(rowIdx+1, col('alertSnoozedUntil')+1).setValue(until);
      // Un-silence so repeat alerts fire after snooze
      sheet.getRange(rowIdx+1, col('alertSilenced')+1).setValue(false);
    }
    cDel_('checkouts');
    return okJ({ ok: true, op });
  } catch(e) { return failJ('resolveAlert failed: ' + e.message); }
}

// ── Overdue alert trigger setup ─────────────────────────────────────────────
// Run setupOverdueTrigger() once from the Apps Script editor to register
// the 10-minute time-based trigger for checkAndSendOverdueAlerts.
function setupOverdueTrigger() {
  // Delete any existing triggers for this function to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'checkAndSendOverdueAlerts') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('checkAndSendOverdueAlerts')
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log('Overdue alert trigger registered: every 10 minutes');
}

// ── Diagnostic: show current alert state ────────────────────────────────────
function diagOverdueState() {
  const props  = PropertiesService.getScriptProperties().getProperties();
  const alerts = Object.keys(props).filter(k => k.startsWith('lastAlert_'));
  alerts.forEach(k => Logger.log(k + ' = ' + props[k] + ' (' + Math.round((Date.now()-parseInt(props[k]))/60000) + 'min ago)'));
  const result = getOverdueAlerts_({ _serverSide: true });
  Logger.log('alerts found: ' + (result.alerts||[]).length);
  (result.alerts||[]).forEach(a => Logger.log('  ' + a.memberName + ' ' + a.boatName + ' overdue=' + a.minutesOverdue + 'min silenced=' + a.silenced));
}


// ═══════════════════════════════════════════════════════════════════════════════
// SHARE TOKEN CRUD  (authenticated — requires API_TOKEN_)
// ═══════════════════════════════════════════════════════════════════════════════

function getShareTokens_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  const all = readAll_('shareTokens');
  const tokens = all.filter(t => String(t.memberKennitala) === String(b.kennitala));
  return okJ({ tokens });
}

function createShareToken_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  const member = findOne_('members', 'kennitala', String(b.kennitala).trim());
  if (!member) return failJ('Member not found', 404);
  const id = shareUid_();
  const ts = now_();
  insertRow_('shareTokens', {
    id,
    memberId: member.id,
    memberKennitala: member.kennitala,
    cutOffDate: ts.slice(0, 10),
    createdAt: ts,
    revokedAt: '',
    accessCount: 0,
    lastAccessedAt: '',
    includePhotos: b.includePhotos !== false && b.includePhotos !== 'false',
    includeTracks: b.includeTracks !== false && b.includeTracks !== 'false',
    categories: b.categories || '',
  });
  return okJ({ id, created: true });
}

function revokeShareToken_(b) {
  if (!b.tokenId) return failJ('tokenId required');
  if (!b.kennitala) return failJ('kennitala required');
  const token = findOne_('shareTokens', 'id', b.tokenId);
  if (!token) return failJ('Token not found', 404);
  if (String(token.memberKennitala) !== String(b.kennitala)) return failJ('Not authorised', 403);
  updateRow_('shareTokens', 'id', b.tokenId, { revokedAt: now_() });
  return okJ({ revoked: true });
}

function deleteShareToken_(b) {
  if (!b.tokenId) return failJ('tokenId required');
  if (!b.kennitala) return failJ('kennitala required');
  const token = findOne_('shareTokens', 'id', b.tokenId);
  if (!token) return failJ('Token not found', 404);
  if (String(token.memberKennitala) !== String(b.kennitala)) return failJ('Not authorised', 403);
  deleteRow_('shareTokens', 'id', b.tokenId);
  return okJ({ deleted: true });
}


// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC QUERY ENDPOINTS  (spec §5 — no token required)
//
// All functions return HtmlService output (server-rendered HTML).
// These are dispatched from doGet() before the API_TOKEN_ check.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Shared HTML helpers ──────────────────────────────────────────────────────

// Dual-language helper: emits both EN and IS text in spans, JS toggles visibility
function dl_(key, vars) {
  var en = gs_(key, vars, 'EN'), is = gs_(key, vars, 'IS');
  return '<span class="lang-en">' + esc_(en) + '</span><span class="lang-is" style="display:none">' + esc_(is) + '</span>';
}

// Boat category colour map (mirrors shared/boats.js BOAT_CAT_COLORS)
var PUB_CAT_COLORS_ = {
  dinghy:        { color:'#5b9bd5', border:'#5b9bd544', bg:'#1a4a8a22' },
  keelboat:      { color:'#d4af37', border:'#d4af3744', bg:'#d4af3718' },
  kayak:         { color:'#9b59b6', border:'#9b59b644', bg:'#8e44ad18' },
  'rowing shell':{ color:'#3498db', border:'#3498db44', bg:'#0e6b9a18' },
  rowboat:       { color:'#1abc9c', border:'#1abc9c44', bg:'#16a08518' },
  sup:           { color:'#e67e22', border:'#e67e2244', bg:'#e67e2218' },
  wingfoil:      { color:'#e74c3c', border:'#e74c3c44', bg:'#c0392b18' },
  other:         { color:'#6b92b8', border:'#2a5490',   bg:'#1e3f6e'   },
};
function pubCatColor_(cat) { return PUB_CAT_COLORS_[(cat||'').toLowerCase()] || PUB_CAT_COLORS_.other; }

function pubPageShell_(title, bodyHtml) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc_(title) + ' — Ýmir Sailing Club</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">'
    + '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">'
    + '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>'
    + '<style>'
    + ':root{--bg:#0b1f38;--card:#132d50;--surface:#0f2847;--border:#1e3f6e;--border-l:#2a5490;'
    + '--text:#d6e4f0;--muted:#6b92b8;--faint:#2a4a6e;--brass:#d4af37;--brass-l:#e8c84a;'
    + '--green:#27ae60;--yellow:#f1c40f;--orange:#e67e22;--red:#e74c3c;--blue:#2980b9}'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{background:var(--bg);color:var(--text);font-family:"DM Mono","Courier New",monospace;'
    + 'font-size:14px;line-height:1.6;padding:24px 20px;max-width:820px;margin:0 auto;-webkit-font-smoothing:antialiased}'
    + 'h1{font-size:20px;margin-bottom:4px;color:var(--text);font-weight:500}'
    + 'h2{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);'
    + 'margin:24px 0 10px;display:flex;align-items:center;gap:10px}'
    + 'h2::after{content:"";flex:1;height:1px;background:var(--border)}'
    + '.subtitle{font-size:12px;color:var(--muted);margin-bottom:20px}'
    + '.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:12px}'
    // Header bar
    + '.pub-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border)}'
    + '.pub-logo{color:var(--brass);font-size:18px;font-weight:700;letter-spacing:1px}'
    + '.pub-lang-btn{background:none;border:1px solid var(--border);color:var(--muted);border-radius:5px;'
    + 'padding:4px 12px;font-size:12px;font-family:inherit;cursor:pointer;transition:color .15s,border-color .15s}'
    + '.pub-lang-btn:hover{color:var(--brass);border-color:var(--brass)}'
    // Table
    + 'table{width:100%;border-collapse:collapse;font-size:12px}'
    + 'th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.8px;'
    + 'color:var(--muted);padding:8px 8px;border-bottom:1px solid var(--border);background:var(--surface)}'
    + 'td{padding:8px 8px;border-bottom:1px solid var(--faint);vertical-align:middle}'
    + 'tr:last-child td{border-bottom:none}'
    + 'tr.trip-row{cursor:pointer;transition:background .1s}'
    + 'tr.trip-row:hover td{background:rgba(255,255,255,.03)}'
    + '.trip-detail{display:none;background:var(--surface);animation:fadeIn .15s}'
    + '.trip-detail td{padding:12px 16px;border-bottom:1px solid var(--border)}'
    + '.trip-detail.open{display:table-row}'
    + '@keyframes fadeIn{from{opacity:0}to{opacity:1}}'
    + '.detail-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 14px;font-size:11px}'
    + '.detail-row{display:flex;flex-direction:column;gap:1px;padding:4px 0}'
    + '.detail-lbl{font-size:9px;color:var(--muted);letter-spacing:.6px;text-transform:uppercase}'
    + '.detail-val{color:var(--text)}'
    + '.detail-section{margin-bottom:10px}'
    + '.detail-section-hdr{font-size:9px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;font-weight:500}'
    + 'a{color:var(--blue);text-decoration:none}'
    + 'a:hover{text-decoration:underline}'
    // Badges
    + '.badge{display:inline-block;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;'
    + 'padding:2px 8px;border-radius:20px;border:1px solid}'
    + '.badge-green{color:var(--green);border-color:#27ae6050;background:#27ae6012}'
    + '.badge-yellow{color:var(--yellow);border-color:#f1c40f50;background:#f1c40f12}'
    + '.badge-red{color:var(--red);border-color:#e74c3c50;background:#e74c3c12}'
    + '.badge-muted{color:var(--muted);border-color:var(--border);background:var(--faint)}'
    + '.badge-brass{color:var(--brass);border-color:#d4af3750;background:#d4af3712}'
    // Cert cards
    + '.cert-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;'
    + 'margin-bottom:6px;cursor:pointer;transition:border-color .15s}'
    + '.cert-card:hover{border-color:var(--brass)}'
    + '.cert-summary{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    + '.cert-name{font-size:13px;font-weight:500}'
    + '.cert-detail{display:none;padding-top:10px;margin-top:8px;border-top:1px solid var(--border);font-size:11px}'
    + '.cert-card.open .cert-detail{display:block}'
    + '.cert-arrow{color:var(--muted);font-size:11px;transition:transform .2s;flex-shrink:0}'
    + '.cert-card.open .cert-arrow{transform:rotate(180deg)}'
    // Stats
    + '.stat{text-align:center;padding:12px}'
    + '.stat-val{font-size:22px;font-weight:500;color:var(--text);line-height:1}'
    + '.stat-lbl{font-size:9px;color:var(--muted);letter-spacing:.8px;text-transform:uppercase;margin-top:4px}'
    // Cat legend
    + '.cat-legend{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}'
    + '.cat-pill{font-size:10px;font-weight:600;letter-spacing:.5px;padding:2px 7px;border-radius:10px;border:1px solid;display:inline-block}'
    // Photos
    + '.pub-photos{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}'
    + '.pub-photo{width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border)}'
    // Track maps
    + '.pub-track-map{width:100%;height:140px;border-radius:6px;border:1px solid var(--border);overflow:hidden;cursor:pointer;margin-top:4px;position:relative}'
    + '.pub-track-map .leaflet-control-zoom,.pub-track-map .leaflet-control-attribution{display:none}'
    + '.pub-map-hint{position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.6);color:#fff;font-size:9px;padding:3px 8px;border-radius:4px;z-index:500;pointer-events:none;letter-spacing:.4px}'
    // Map modal
    + '.pub-map-modal{position:fixed;inset:0;background:#000e;z-index:600;display:flex;flex-direction:column}'
    + '.pub-map-modal.hidden{display:none}'
    + '.pub-map-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--bg);border-bottom:1px solid var(--border);flex-shrink:0}'
    + '.pub-map-bar span{font-size:12px;color:var(--text)}'
    + '.pub-map-close{background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;padding:0}'
    + '.pub-map-body{flex:1;position:relative}'
    // Topline / detailed toggle
    + '.detail-extra{display:none}'
    + '.detail-extra.open{display:block}'
    + '.detail-more-btn{background:none;border:1px solid var(--border);color:var(--muted);border-radius:5px;padding:3px 10px;'
    + 'font-size:10px;font-family:inherit;cursor:pointer;margin-top:6px;transition:color .15s,border-color .15s}'
    + '.detail-more-btn:hover{color:var(--brass);border-color:var(--brass)}'
    // Form
    + '.form-group{margin-bottom:14px}'
    + '.form-group label{display:block;font-size:11px;color:var(--muted);margin-bottom:4px;letter-spacing:.5px}'
    + '.form-group input{width:100%;padding:8px 12px;font-size:14px;background:var(--surface);border:1px solid var(--border);'
    + 'border-radius:6px;color:var(--text);font-family:inherit;outline:none}'
    + '.form-group input:focus{border-color:var(--brass)}'
    + '.btn-primary{background:var(--brass);color:#0b1f38;border:none;padding:10px 20px;border-radius:6px;font-size:14px;'
    + 'font-weight:600;cursor:pointer;width:100%;font-family:inherit}'
    + '.btn-primary:hover{opacity:.9}'
    + '.err-msg{background:var(--surface);border:1px solid var(--red);color:var(--red);padding:10px;border-radius:6px;'
    + 'font-size:12px;margin-bottom:14px}'
    + '.info-msg{background:var(--surface);border:1px solid var(--blue);color:var(--blue);padding:10px;border-radius:6px;'
    + 'font-size:12px;margin-bottom:14px}'
    + '.revoked-msg{background:var(--surface);border:1px solid var(--red);color:var(--red);padding:24px;border-radius:8px;'
    + 'font-size:16px;text-align:center;margin:40px 0}'
    + '.footer{margin-top:32px;padding-top:12px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);text-align:center}'
    + '@media(max-width:600px){body{padding:12px}table{font-size:11px}th,td{padding:4px 6px}'
    + '.detail-grid{grid-template-columns:1fr 1fr}}'
    + '</style></head><body>'
    + '<div class="pub-header"><span class="pub-logo">ÝMIR SAILING CLUB</span>'
    + '<button class="pub-lang-btn" onclick="togglePubLang()" id="pubLangBtn">IS</button></div>'
    + bodyHtml
    + '<div class="footer">'
    + '<span class="lang-en">' + gs_('pub.footer', { date: new Date().toISOString().slice(0, 10) }, 'EN') + '</span>'
    + '<span class="lang-is" style="display:none">' + gs_('pub.footer', { date: new Date().toISOString().slice(0, 10) }, 'IS') + '</span>'
    + '</div>'
    + '<div class="pub-map-modal hidden" id="pubMapModal">'
    + '<div class="pub-map-bar"><span id="pubMapTitle"></span>'
    + '<button class="pub-map-close" onclick="closePubMapModal()">&times;</button></div>'
    + '<div class="pub-map-body" id="pubMapBody"></div></div>'
    + '<script>'
    // Language toggle
    + 'function togglePubLang(){'
    + 'var en=document.querySelectorAll(".lang-en"),is=document.querySelectorAll(".lang-is");'
    + 'var btn=document.getElementById("pubLangBtn");'
    + 'var showIS=en[0]&&en[0].style.display!=="none";'
    + 'en.forEach(function(e){e.style.display=showIS?"none":"";});'
    + 'is.forEach(function(e){e.style.display=showIS?"":"none";});'
    + 'btn.textContent=showIS?"EN":"IS";'
    + '}'
    // Click handlers: cert cards, trip rows, more buttons
    + 'document.addEventListener("click",function(e){'
    + 'var c=e.target.closest(".cert-card");if(c){c.classList.toggle("open");return;}'
    + 'var mb=e.target.closest(".detail-more-btn");if(mb){var ex=mb.parentElement.querySelector(".detail-extra");if(ex)ex.classList.toggle("open");mb.innerHTML=ex&&ex.classList.contains("open")?(mb.dataset.less||"Less"):(mb.dataset.more||"More");return;}'
    + 'var r=e.target.closest("tr.trip-row");'
    + 'if(r){var id=r.dataset.id;var d=document.getElementById("td-"+id);if(d){d.classList.toggle("open");'
    + 'if(d.classList.contains("open")){requestAnimationFrame(function(){var maps=d.querySelectorAll(".pub-track-map");maps.forEach(initPubThumbMap);});}'
    + '}}});'
    // Leaflet map helpers
    + 'var _pubThumbMaps={};var _pubFullMap=null;'
    + 'function pubAddLayers(map){'
    + 'L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png",{maxZoom:19}).addTo(map);'
    + 'L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",{maxNativeZoom:17,maxZoom:19,opacity:0.9}).addTo(map);'
    + '}'
    + 'function initPubThumbMap(el){'
    + 'if(_pubThumbMaps[el.id])return;var pts;try{pts=JSON.parse(el.dataset.track);}catch(e){return;}'
    + 'if(!pts||pts.length<2)return;'
    + 'var map=L.map(el,{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false,boxZoom:false,keyboard:false});'
    + 'pubAddLayers(map);var ll=pts.map(function(p){return[p.lat,p.lng];});'
    + 'L.polyline(ll,{color:"#d4af37",weight:2.5,opacity:.9}).addTo(map);'
    + 'L.circleMarker(ll[0],{radius:4,color:"#27ae60",fillColor:"#27ae60",fillOpacity:1,weight:0}).addTo(map);'
    + 'L.circleMarker(ll[ll.length-1],{radius:4,color:"#e74c3c",fillColor:"#e74c3c",fillOpacity:1,weight:0}).addTo(map);'
    + 'map.fitBounds(L.latLngBounds(ll).pad(0.15));_pubThumbMaps[el.id]=map;'
    + '}'
    + 'function openPubMapModal(idx){'
    + 'var el=document.getElementById("pubMapModal");el.classList.remove("hidden");document.body.style.overflow="hidden";'
    + 'var src=document.getElementById("tmap-"+idx);if(!src)return;var pts;try{pts=JSON.parse(src.dataset.track);}catch(e){return;}'
    + 'if(!pts||pts.length<2)return;'
    + 'document.getElementById("pubMapTitle").textContent=src.dataset.title||"GPS Track";'
    + 'if(_pubFullMap){_pubFullMap.remove();_pubFullMap=null;}'
    + 'var body=document.getElementById("pubMapBody");body.innerHTML="";var d=document.createElement("div");d.style.cssText="position:absolute;inset:0";body.appendChild(d);'
    + '_pubFullMap=L.map(d,{zoomControl:true});pubAddLayers(_pubFullMap);'
    + 'var ll=pts.map(function(p){return[p.lat,p.lng];});'
    + 'L.polyline(ll,{color:"#d4af37",weight:3,opacity:.9}).addTo(_pubFullMap);'
    + 'L.circleMarker(ll[0],{radius:6,color:"#27ae60",fillColor:"#27ae60",fillOpacity:1,weight:0}).bindPopup("Departure").addTo(_pubFullMap);'
    + 'L.circleMarker(ll[ll.length-1],{radius:6,color:"#e74c3c",fillColor:"#e74c3c",fillOpacity:1,weight:0}).bindPopup("Arrival").addTo(_pubFullMap);'
    + '_pubFullMap.fitBounds(L.latLngBounds(ll).pad(0.1));'
    + '}'
    + 'function closePubMapModal(){document.getElementById("pubMapModal").classList.add("hidden");document.body.style.overflow="";if(_pubFullMap){_pubFullMap.remove();_pubFullMap=null;}}'
    + 'document.addEventListener("keydown",function(e){if(e.key==="Escape")closePubMapModal();});'
    + '</script>'
    + '</body></html>';
}

function pubCertBadgesHtml_(certs, certDefs) {
  if (!certs || !certs.length) {
    return '<div style="color:var(--muted);font-size:12px;font-style:italic">'
      + dl_('pub.lbl.noCerts') + '</div>';
  }
  var today = new Date().toISOString().slice(0, 10);
  return certs.map(function(c) {
    var def = certDefs.find(function(d) { return d.id === c.certId; });
    var subcat = def && def.subcats ? def.subcats.find(function(s) { return s.key === c.sub; }) : null;
    var label = subcat ? (def.name + ' — ' + subcat.label) : (def ? def.name : c.certId);
    var expired = c.expiresAt && c.expiresAt < today;
    var badgeClass = expired ? 'badge badge-red' : (c.assignedBy ? 'badge badge-green' : 'badge badge-yellow');
    var statusEN = expired ? gs_('pub.cert.expired',null,'EN') : (c.assignedBy ? gs_('pub.cert.verified',null,'EN') : gs_('pub.cert.unverified',null,'EN'));
    var statusIS = expired ? gs_('pub.cert.expired',null,'IS') : (c.assignedBy ? gs_('pub.cert.verified',null,'IS') : gs_('pub.cert.unverified',null,'IS'));

    // Expiry line
    var expiryEN = c.expiresAt ? (expired ? 'Expired ' : 'Expires ') + esc_(c.expiresAt) : 'Does not expire';
    var expiryIS = c.expiresAt ? (expired ? 'Útrunnið ' : 'Rennur út ') + esc_(c.expiresAt) : 'Varanlegt';

    // Description
    var desc = subcat && subcat.description ? subcat.description : (def && def.description ? def.description : '');

    var html = '<div class="cert-card">'
      + '<div class="cert-summary">'
      + '<div><span class="cert-name">' + esc_(label) + '</span> '
      + '<span class="' + badgeClass + '">'
      + '<span class="lang-en">' + esc_(statusEN) + '</span>'
      + '<span class="lang-is" style="display:none">' + esc_(statusIS) + '</span>'
      + '</span></div>'
      + '<span class="cert-arrow">▾</span>'
      + '</div>'
      + '<div class="cert-detail">'
      + '<div class="detail-grid">';
    if (subcat) {
      html += '<div class="detail-row"><span class="detail-lbl">'
        + '<span class="lang-en">Level</span><span class="lang-is" style="display:none">Stig</span>'
        + '</span><span class="detail-val">' + esc_(subcat.label) + '</span></div>';
    }
    html += '<div class="detail-row"><span class="detail-lbl">'
      + '<span class="lang-en">Validity</span><span class="lang-is" style="display:none">Gildistími</span>'
      + '</span><span class="detail-val">'
      + '<span class="lang-en">' + expiryEN + '</span>'
      + '<span class="lang-is" style="display:none">' + expiryIS + '</span>'
      + '</span></div>';
    if (c.assignedBy) {
      html += '<div class="detail-row"><span class="detail-lbl">'
        + '<span class="lang-en">Assigned by</span><span class="lang-is" style="display:none">Úthlutað af</span>'
        + '</span><span class="detail-val">' + esc_(c.assignedBy) + '</span></div>';
    }
    if (c.assignedAt) {
      html += '<div class="detail-row"><span class="detail-lbl">'
        + '<span class="lang-en">Assigned</span><span class="lang-is" style="display:none">Úthlutað</span>'
        + '</span><span class="detail-val">' + esc_(String(c.assignedAt).slice(0,10)) + '</span></div>';
    }
    if (desc) {
      html += '<div class="detail-row" style="grid-column:1/-1"><span class="detail-lbl">'
        + '<span class="lang-en">Description</span><span class="lang-is" style="display:none">Lýsing</span>'
        + '</span><span class="detail-val">' + esc_(desc) + '</span></div>';
    }
    html += '</div></div></div>';
    return html;
  }).join('');
}

function pubTripTableHtml_(trips, allTrips, boats, opts) {
  opts = opts || {};
  if (!trips.length) return '<div style="color:var(--muted);font-size:12px;font-style:italic;padding:8px 0">'
    + dl_('pub.lbl.noSessions') + '</div>';

  // Build boat map for O(1) lookups
  var boatMap = {};
  if (boats) { boats.forEach(function(b) { boatMap[b.id] = b; }); }

  // Build captain lookup: linkedCheckoutId → skipper memberName
  var captainMap = {};
  if (allTrips) {
    allTrips.forEach(function(t) {
      if (t.linkedCheckoutId && (t.role === 'skipper' || !t.role)) {
        captainMap[t.linkedCheckoutId] = t.memberName || '';
      }
    });
  }

  // Determine if captain column needed (any trip where role is crew)
  var hasCrew = trips.some(function(t) { return t.role === 'crew'; });

  var html = '<div style="overflow-x:auto"><table><tr>'
    + '<th>' + dl_('pub.lbl.date') + '</th>'
    + '<th>' + dl_('pub.lbl.boat') + '</th>'
    + '<th>' + dl_('pub.lbl.makeModel') + '</th>'
    + '<th>' + dl_('pub.lbl.loa') + '</th>'
    + '<th>' + dl_('pub.lbl.role') + '</th>';
  if (hasCrew) html += '<th>' + dl_('pub.lbl.captain') + '</th>';
  html += '</tr>';

  trips.forEach(function(t, idx) {
    var boat = boatMap[t.boatId] || null;
    var makeModel = boat && boat.typeModel ? esc_(boat.typeModel) : '';
    var loa = boat && boat.loa ? esc_(boat.loa) + ' ft' : '';
    var isSki = !t.role || t.role === 'skipper';
    var roleEN = isSki ? 'Skipper' : 'Crew';
    var roleIS = isSki ? 'Skipari' : 'Áhöfn';
    var isHelm = t.helm && t.helm !== 'false' && t.helm !== false && parseInt(t.crew || 1) > 1;
    if (isHelm) { roleEN += ' · Helm'; roleIS += ' · Stýri'; }
    var catCol = pubCatColor_(t.boatCategory || (boat ? boat.category : ''));

    // Captain name for crew trips
    var captainName = '';
    if (!isSki && t.linkedCheckoutId && captainMap[t.linkedCheckoutId]) {
      captainName = esc_(captainMap[t.linkedCheckoutId]);
    }

    html += '<tr class="trip-row" data-id="' + idx + '" style="border-left:3px solid ' + catCol.color + '">'
      + '<td>' + esc_(t.date || '') + '</td>'
      + '<td>' + esc_(t.boatName || '') + '</td>'
      + '<td>' + makeModel + '</td>'
      + '<td>' + loa + '</td>'
      + '<td><span class="lang-en">' + roleEN + '</span><span class="lang-is" style="display:none">' + roleIS + '</span></td>';
    if (hasCrew) html += '<td>' + captainName + '</td>';
    html += '</tr>';

    // Expandable detail row
    html += '<tr class="trip-detail" id="td-' + idx + '"><td colspan="' + (hasCrew ? 6 : 5) + '">';

    // ── TOPLINE (always visible on expand) ──

    // Boat details (keelboat topline: reg, make/model, LOA)
    var hasBoatDetail = (boat && (boat.registrationNo || boat.typeModel || boat.loa));
    if (hasBoatDetail) {
      html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.boatDetails') + '</div>'
        + '<div class="detail-grid">';
      if (boat.registrationNo) {
        var regLblEN = (t.boatCategory || '').toLowerCase() === 'keelboat' ? 'Registration no.' : 'Sail no.';
        var regLblIS = (t.boatCategory || '').toLowerCase() === 'keelboat' ? 'Skráningarnúmer' : 'Seglnúmer';
        html += '<div class="detail-row"><span class="detail-lbl"><span class="lang-en">' + regLblEN + '</span><span class="lang-is" style="display:none">' + regLblIS + '</span></span>'
          + '<span class="detail-val">' + esc_(boat.registrationNo) + '</span></div>';
      }
      if (boat.typeModel) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.makeModel') + '</span><span class="detail-val">' + esc_(boat.typeModel) + '</span></div>';
      if (boat.loa) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.loa') + '</span><span class="detail-val">' + esc_(boat.loa) + ' ft</span></div>';
      html += '</div></div>';
    }

    // Trip topline: ports, departed, returned
    var dep = t.departurePort || '', arr = t.arrivalPort || '';
    var hasTopTrip = dep || arr || t.timeOut || t.timeIn;
    if (hasTopTrip) {
      html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.tripDetails') + '</div><div class="detail-grid">';
      if (dep || arr) {
        var portVal = dep && arr && dep !== arr ? esc_(dep) + ' → ' + esc_(arr) : esc_(dep || arr);
        html += '<div class="detail-row" style="grid-column:1/-1"><span class="detail-lbl">' + dl_('pub.lbl.ports') + '</span><span class="detail-val">⚓️ ' + portVal + '</span></div>';
      }
      if (t.timeOut) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.departed') + '</span><span class="detail-val">' + esc_(t.timeOut) + '</span></div>';
      if (t.timeIn) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.returned') + '</span><span class="detail-val">' + esc_(t.timeIn) + '</span></div>';
      html += '</div></div>';
    }

    // Weather topline: wind speed, wave height, conditions
    var wx = null;
    try { wx = t.wxSnapshot ? (typeof t.wxSnapshot === 'string' ? JSON.parse(t.wxSnapshot) : t.wxSnapshot) : null; } catch(e) {}
    var hasTopWx = (wx && wx.ws != null) || t.beaufort || (wx && wx.wv != null) || (wx && wx.cond && wx.cond.desc);
    if (hasTopWx) {
      html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.weather') + '</div><div class="detail-grid">';
      if (wx && wx.ws != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.wind') + '</span><span class="detail-val">' + Math.round(wx.ws) + ' m/s' + (wx.bft != null ? ' · Force ' + wx.bft : '') + '</span></div>';
      else if (t.beaufort) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.wind') + '</span><span class="detail-val">Force ' + esc_(t.beaufort) + '</span></div>';
      if (wx && wx.wv != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.waveHeight') + '</span><span class="detail-val">' + Number(wx.wv).toFixed(1) + ' m</span></div>';
      if (wx && wx.cond && wx.cond.desc) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.conditions') + '</span><span class="detail-val">' + (wx.cond.icon || '') + ' ' + esc_(wx.cond.desc) + '</span></div>';
      html += '</div></div>';
    }

    // Notes (always topline when present)
    if (t.notes) {
      html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.notes') + '</div>'
        + '<div style="font-size:12px">' + esc_(t.notes) + '</div></div>';
    }

    // GPS Track (topline, above photos — if opted in)
    if (opts.includeTracks) {
      var trackPts = [];
      try { if (t.trackSimplified) trackPts = typeof t.trackSimplified === 'string' ? JSON.parse(t.trackSimplified) : t.trackSimplified; } catch(e) {}
      if (trackPts.length >= 2) {
        var trackJson = JSON.stringify(trackPts).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
        var mapTitle = esc_((t.boatName||'') + ' — ' + (t.date||'') + (t.distanceNm ? ' · ' + t.distanceNm + ' nm' : ''));
        html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.gpsTrack') + '</div>'
          + '<div class="pub-track-map" id="tmap-' + idx + '" data-track="' + trackJson + '" data-title="' + mapTitle + '" onclick="openPubMapModal(' + idx + ')">'
          + '<div class="pub-map-hint"><span class="lang-en">Click to expand</span><span class="lang-is" style="display:none">Smelltu til að stækka</span></div></div>';
        if (t.trackFileUrl) {
          html += '<a href="' + esc_(t.trackFileUrl) + '" target="_blank" style="color:var(--brass);font-size:10px;margin-top:4px;display:inline-block">⬇ '
            + '<span class="lang-en">Download file</span><span class="lang-is" style="display:none">Sækja skrá</span></a>';
        }
        html += '</div>';
      } else if (t.trackFileUrl) {
        html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.gpsTrack') + '</div>'
          + '<a href="' + esc_(t.trackFileUrl) + '" target="_blank" style="font-size:11px">📍 '
          + '<span class="lang-en">Download track</span><span class="lang-is" style="display:none">Sækja leið</span>'
          + '</a>' + (t.trackSource ? ' · ' + esc_(t.trackSource) : '') + '</div>';
      }
    }

    // Photos (topline, below GPS — if opted in)
    if (opts.includePhotos) {
      var photos = [];
      try { if (t.photoUrls) photos = typeof t.photoUrls === 'string' ? JSON.parse(t.photoUrls) : t.photoUrls; } catch(e) {}
      if (photos.length) {
        html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.photos') + '</div>'
          + '<div class="pub-photos">';
        photos.forEach(function(u) {
          html += '<img src="' + esc_(u) + '" class="pub-photo" loading="lazy" onerror="this.style.display=\'none\'">';
        });
        html += '</div></div>';
      }
    }

    // ── DETAILED (hidden behind "Show more") ──
    var hasDetailTrip = t.locationName || t.hoursDecimal || t.distanceNm || t.crew;
    var hasDetailWx = (wx && (wx.dir || wx.wg != null || wx.tc != null || wx.sst != null || wx.pres != null)) || t.windDir;
    if (hasDetailTrip || hasDetailWx) {
      html += '<button class="detail-more-btn" data-more="'
        + '<span class=&quot;lang-en&quot;>Show more</span><span class=&quot;lang-is&quot; style=&quot;display:none&quot;>Sýna meira</span>'
        + '" data-less="'
        + '<span class=&quot;lang-en&quot;>Show less</span><span class=&quot;lang-is&quot; style=&quot;display:none&quot;>Sýna minna</span>'
        + '"><span class="lang-en">Show more</span><span class="lang-is" style="display:none">Sýna meira</span></button>'
        + '<div class="detail-extra">';
      if (hasDetailTrip) {
        html += '<div class="detail-section" style="margin-top:8px"><div class="detail-grid">';
        if (t.locationName) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.location') + '</span><span class="detail-val">' + esc_(t.locationName) + '</span></div>';
        if (t.hoursDecimal) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.duration') + '</span><span class="detail-val">' + Number(t.hoursDecimal).toFixed(1) + 'h</span></div>';
        if (t.distanceNm) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.distance') + '</span><span class="detail-val">' + Number(t.distanceNm).toFixed(1) + ' nm</span></div>';
        if (t.crew) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.crewAboard') + '</span><span class="detail-val">' + esc_(t.crew) + '</span></div>';
        html += '</div></div>';
      }
      if (hasDetailWx) {
        html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.weather') + '</div><div class="detail-grid">';
        if (wx && wx.dir || t.windDir) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.direction') + '</span><span class="detail-val">' + esc_(wx && wx.dir || t.windDir) + '</span></div>';
        if (wx && wx.wg != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.gusts') + '</span><span class="detail-val">' + Math.round(wx.wg) + ' m/s</span></div>';
        if (wx && wx.tc != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.airTemp') + '</span><span class="detail-val">' + Math.round(wx.tc) + '°C</span></div>';
        if (wx && wx.sst != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.seaTemp') + '</span><span class="detail-val">' + Number(wx.sst).toFixed(1) + '°C</span></div>';
        if (wx && wx.pres != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.pressure') + '</span><span class="detail-val">' + Math.round(wx.pres) + ' hPa</span></div>';
        html += '</div></div>';
      }
      html += '</div>';  // close detail-extra
    }

    html += '</td></tr>';
  });

  html += '</table></div>';
  return html;
}


// ── 5.0 Public dashboard ────────────────────────────────────────────────────

function publicDashboard_() {
  var cfgMap = getConfigMap_();
  var boatCategories = [];
  try { boatCategories = JSON.parse(getConfigValue_('boatCategories', cfgMap) || '[]'); } catch(e) {}
  var boats = [];
  try { boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]'); } catch(e) {}
  var locations = [];
  try { locations = JSON.parse(getConfigValue_('locations', cfgMap) || '[]'); } catch(e) {}
  var certDefs = getCertDefsFromMap_(cfgMap);

  // Build lookup maps
  var catMap = {};
  boatCategories.forEach(function(c) { catMap[c.key] = c; });
  var locMap = {};
  locations.forEach(function(l) { locMap[l.id] = l; });
  var boatMap = {};
  boats.forEach(function(b) { boatMap[b.id] = b; });

  // ── YTD trips ──
  var yearStart = new Date().getFullYear() + '-01-01';
  var allTrips = readAll_('trips');
  var ytdTrips = allTrips.filter(function(t) { return (t.date || '') >= yearStart; });

  var totalTrips = ytdTrips.length;
  var totalHours = 0;
  var catStats = {};   // key → { count, hours }
  var locStats = {};   // locationId → { count, hours }

  ytdTrips.forEach(function(t) {
    var hrs = Number(t.hoursDecimal) || 0;
    totalHours += hrs;

    var cat = t.boatCategory || '';
    if (!cat) { var b = boatMap[t.boatId]; if (b) cat = b.category || ''; }
    if (cat) {
      if (!catStats[cat]) catStats[cat] = { count: 0, hours: 0 };
      catStats[cat].count++;
      catStats[cat].hours += hrs;
    }

    var lid = t.locationId || '';
    if (lid) {
      if (!locStats[lid]) locStats[lid] = { count: 0, hours: 0 };
      locStats[lid].count++;
      locStats[lid].hours += hrs;
    }
  });

  var byCategory = boatCategories.map(function(c) {
    var st = catStats[c.key] || { count: 0, hours: 0 };
    return { key: c.key, labelEN: c.labelEN || c.key, labelIS: c.labelIS || c.labelEN || c.key, emoji: c.emoji || '', count: st.count, hours: Math.round(st.hours * 10) / 10 };
  }).filter(function(c) { return c.count > 0; });

  var locData = [];
  Object.keys(locStats).forEach(function(lid) {
    var loc = locMap[lid];
    if (!loc) return;
    var coords = loc.coordinates || '';
    if (!coords) return;
    var parts = String(coords).split(',');
    if (parts.length < 2) return;
    var lat = parseFloat(parts[0]);
    var lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return;
    locData.push({ id: lid, name: loc.name || lid, lat: lat, lng: lng, tripCount: locStats[lid].count, totalHours: Math.round(locStats[lid].hours * 10) / 10 });
  });

  // ── On the water ──
  var checkouts = readAll_('checkouts').filter(function(c) { return c.status === 'out'; });
  var boatCount = 0;
  var peopleCount = 0;
  var onWaterBoats = [];

  checkouts.forEach(function(c) {
    var isGroup = c.isGroup === true || c.isGroup === 'TRUE' || c.isGroup === 'true';
    if (isGroup) {
      var bNames = []; try { bNames = JSON.parse(c.boatNames || '[]'); } catch(e) { bNames = String(c.boatName || '').split(','); }
      boatCount += bNames.length || 1;
      peopleCount += (parseInt(c.participants) || 0) + (function() { try { return JSON.parse(c.staffNames || '[]').length; } catch(e) { return 0; } })();
      bNames.forEach(function(bn) {
        onWaterBoats.push({ boatName: bn.trim(), boatCategory: c.boatCategory || '', locationName: c.locationName || '' });
      });
    } else {
      boatCount += 1;
      peopleCount += (parseInt(c.crew) || 1);
      onWaterBoats.push({ boatName: c.boatName || '', boatCategory: c.boatCategory || '', locationName: c.locationName || '' });
    }
  });

  // Enrich with emoji
  onWaterBoats.forEach(function(b) {
    var cat = catMap[b.boatCategory];
    b.emoji = cat ? (cat.emoji || '') : '';
  });

  // ── Captains ──
  var members = readAll_('members').filter(function(m) { return m.active === true || m.active === 'TRUE' || m.active === 'true'; });
  var captains = [];
  var scriptUrl = ScriptApp.getService().getUrl();

  members.forEach(function(m) {
    var certs = [];
    try { certs = typeof m.certifications === 'string' ? JSON.parse(m.certifications) : (m.certifications || []); } catch(e) { return; }
    if (!Array.isArray(certs)) return;
    var isCaptain = certs.some(function(c) { return c.certId === 'keelboat_crew' && c.sub === 'captain'; });
    if (!isCaptain) return;

    // Build cert labels
    var certLabels = certs.map(function(c) {
      var def = certDefs.find(function(d) { return d.id === c.certId; });
      var subcat = def && def.subcats ? def.subcats.find(function(s) { return s.key === c.sub; }) : null;
      var label = subcat ? ((def.name || c.certId) + ' — ' + subcat.label) : (def ? def.name : c.certId);
      return { certId: c.certId, sub: c.sub || '', label: label };
    });

    // Captain trip stats
    var captTrips = allTrips.filter(function(t) {
      return String(t.kennitala) === String(m.kennitala) && (t.role === 'skipper' || t.role === 'captain');
    });
    var captHours = 0;
    captTrips.forEach(function(t) { captHours += Number(t.hoursDecimal) || 0; });

    captains.push({
      id: m.id,
      name: m.name || '',
      certs: certLabels,
      tripCount: captTrips.length,
      totalHours: Math.round(captHours * 10) / 10,
      captainRecordUrl: scriptUrl + '?action=captain&id=' + m.id,
    });
  });

  return okJ({
    ytd: { totalTrips: totalTrips, totalHours: Math.round(totalHours * 10) / 10, byCategory: byCategory },
    locations: locData,
    onWater: { boatCount: boatCount, peopleCount: peopleCount, boats: onWaterBoats },
    captains: captains,
    boatCategories: boatCategories.map(function(c) { return { key: c.key, labelEN: c.labelEN || c.key, labelIS: c.labelIS || '', emoji: c.emoji || '' }; }),
  });
}


// ── 5.1 Licence lookup ───────────────────────────────────────────────────────

function publicLookup_(b) {
  var licenceNo = b.licence_number || b.licenceNumber || '';
  var initials  = b.initials || '';

  // Form phase — show lookup form
  if (!licenceNo) {
    var errHtml = '';
    if (b.err === '1') errHtml = '<div class="err-msg">' + gs_('pub.err.notFound') + '</div>';
    var formBody = '<h1>' + gs_('pub.title.lookup') + '</h1>'
      + '<div class="subtitle">Enter your licence number and initials to view your sailing record.</div>'
      + '<div class="card">'
      + errHtml
      + '<form method="get" action="' + ScriptApp.getService().getUrl() + '">'
      + '<input type="hidden" name="action" value="lookup">'
      + '<div class="form-group"><label>' + gs_('pub.lbl.licenceNo') + '</label>'
      + '<input type="text" name="licence_number" required autocomplete="off"></div>'
      + '<div class="form-group"><label>' + gs_('pub.lbl.initials') + '</label>'
      + '<input type="text" name="initials" required autocomplete="off" style="text-transform:uppercase"></div>'
      + '<button type="submit" class="btn-primary">' + gs_('pub.btn.lookup') + '</button>'
      + '</form></div>';
    return htmlR_(pubPageShell_(gs_('pub.title.lookup'), formBody));
  }

  // Result phase — find member by licence number in certifications
  licenceNo = String(licenceNo).trim();
  initials  = String(initials).trim().toUpperCase().replace(/\s/g, '');

  if (!licenceNo || !initials) {
    return htmlR_(pubPageShell_(gs_('pub.title.lookup'),
      '<div class="err-msg">' + gs_('pub.err.missing') + '</div>'));
  }

  var members = readAll_('members');
  var certDefs = getCertDefs_();
  var found = null;

  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    if (!m.certifications) continue;
    var certs;
    try { certs = typeof m.certifications === 'string' ? JSON.parse(m.certifications) : m.certifications; } catch(e) { continue; }
    if (!Array.isArray(certs)) continue;
    for (var j = 0; j < certs.length; j++) {
      if (certs[j].licenceNumber && String(certs[j].licenceNumber).trim() === licenceNo) {
        found = { member: m, certs: certs };
        break;
      }
    }
    if (found) break;
  }

  // Check initials match
  if (found) {
    var memberInitials = (found.member.initials || extractInitials_(found.member.name) || '').toUpperCase().replace(/\s/g, '');
    if (memberInitials !== initials) found = null;
  }

  // Generic error — identical whether licence not found or initials wrong (spec §6.4)
  if (!found) {
    var scriptUrl = ScriptApp.getService().getUrl();
    return htmlR_(pubPageShell_(gs_('pub.title.lookup'),
      '<script>window.location.href="' + scriptUrl + '?action=lookup&err=1";</script>'));
  }

  // Success — render record page
  return htmlR_(pubPageShell_(gs_('pub.title.record'),
    pubRecordPageHtml_(found.member, found.certs, certDefs, { showTokens: true, queriedLicence: licenceNo })));
}

// Shared record page renderer — used by lookup and share link endpoints
function pubRecordPageHtml_(member, certs, certDefs, opts) {
  opts = opts || {};
  var today = new Date().toISOString().slice(0, 10);
  var cutOff = opts.cutOffDate || today;
  var scriptUrl = ScriptApp.getService().getUrl();

  var html = '<h1>' + esc_(member.name) + '</h1>';
  if (opts.queriedLicence) {
    html += '<div class="subtitle">' + dl_('pub.lbl.licence') + ': ' + esc_(opts.queriedLicence) + '</div>';
  }
  if (opts.cutOffDate) {
    html += '<div class="info-msg">'
      + '<span class="lang-en">' + gs_('pub.share.asOf', { date: opts.cutOffDate }, 'EN') + '</span>'
      + '<span class="lang-is" style="display:none">' + gs_('pub.share.asOf', { date: opts.cutOffDate }, 'IS') + '</span>'
      + '</div>';
  }

  // Credentials
  html += '<h2>' + dl_('pub.lbl.certs') + '</h2><div class="card">' + pubCertBadgesHtml_(certs, certDefs) + '</div>';

  // Load boats for make/model/LOA
  var boatsJson = getConfigSheetValue_('boats');
  var boats = [];
  try { boats = JSON.parse(boatsJson || '[]'); } catch(e) {}
  var boatMap = {};
  boats.forEach(function(b) { boatMap[b.id] = b; });

  // Load boat categories for label resolution
  var boatCats = [];
  try { var bcRaw2 = getConfigSheetValue_('boatCategories'); if (bcRaw2) boatCats = JSON.parse(bcRaw2); } catch(e) {}
  function pubCatLabel_(key) {
    var c = boatCats.find(function(x) { return x.key === key; });
    if (!c) return key;
    return c.labelEN || key;
  }

  // Trips
  var allTrips = readAll_('trips');
  var memberTrips = allTrips.filter(function(t) {
    return String(t.kennitala) === String(member.kennitala) && (t.date || '') <= cutOff;
  }).sort(function(a, b) { return (b.date || '') > (a.date || '') ? 1 : -1; });

  // Filter by categories if specified
  var categories = opts.categories && opts.categories.length ? opts.categories : null;
  if (categories) {
    var catSet = {};
    categories.forEach(function(c) { catSet[c.toLowerCase()] = true; });
    memberTrips = memberTrips.filter(function(t) {
      var cat = t.boatCategory || '';
      if (!cat) { var b = boatMap[t.boatId]; if (b) cat = b.category || ''; }
      return catSet[cat.toLowerCase()];
    });
  }

  // Category legend
  var tripCats = {};
  memberTrips.forEach(function(t) {
    var cat = t.boatCategory || '';
    if (!cat) { var b = boatMap[t.boatId]; if (b) cat = b.category || ''; }
    if (cat) tripCats[cat] = true;
  });
  var catKeys = Object.keys(tripCats).sort();

  html += '<h2>' + dl_('pub.lbl.sessions') + ' (' + memberTrips.length + ')</h2>';
  if (catKeys.length > 1) {
    html += '<div class="cat-legend">';
    catKeys.forEach(function(c) {
      var col = pubCatColor_(c);
      html += '<span class="cat-pill" style="color:' + col.color + ';border-color:' + col.border + ';background:' + col.bg + '">' + esc_(pubCatLabel_(c)) + '</span>';
    });
    html += '</div>';
  }
  html += '<div class="card">'
    + pubTripTableHtml_(memberTrips, allTrips, boats, {
        includePhotos: opts.includePhotos,
        includeTracks: opts.includeTracks,
      })
    + '</div>';

  // Share tokens section (only shown on direct lookup, not on share links)
  if (opts.showTokens) {
    var tokens = readAll_('shareTokens').filter(function(t) {
      return String(t.memberKennitala) === String(member.kennitala);
    });
    html += '<h2>' + dl_('pub.lbl.shareTokens') + '</h2><div class="card">';
    if (tokens.length) {
      html += '<table><tr>'
        + '<th>' + dl_('pub.lbl.created') + '</th>'
        + '<th>' + dl_('pub.lbl.cutOff') + '</th>'
        + '<th>' + dl_('pub.lbl.accesses') + '</th>'
        + '<th>Status</th>'
        + '<th>Link</th></tr>';
      tokens.forEach(function(tk) {
        var revoked = tk.revokedAt && String(tk.revokedAt).trim() !== '';
        var statusBadge = revoked
          ? '<span class="badge badge-red">' + dl_('pub.lbl.revoked') + '</span>'
          : '<span class="badge badge-green">' + dl_('pub.lbl.active') + '</span>';
        var shareUrl = scriptUrl + '?share=' + esc_(tk.id);
        html += '<tr>'
          + '<td>' + esc_((tk.createdAt || '').slice(0, 10)) + '</td>'
          + '<td>' + esc_(tk.cutOffDate || '') + '</td>'
          + '<td>' + (tk.accessCount || 0) + '</td>'
          + '<td>' + statusBadge + '</td>'
          + '<td><a href="' + shareUrl + '" target="_blank">Link</a></td>'
          + '</tr>';
      });
      html += '</table>';
    } else {
      html += '<div style="color:var(--muted);font-size:12px;font-style:italic">' + dl_('pub.lbl.noTokens') + '</div>';
    }
    html += '</div>';
  }

  return html;
}


// ── 5.2 Captain record ──────────────────────────────────────────────────────

function publicCaptainRecord_(b) {
  if (!b.id) return htmlR_(pubPageShell_(gs_('pub.title.captain'), '<div class="err-msg">Missing captain ID.</div>'));
  var member = findOne_('members', 'id', b.id);
  if (!member) return htmlR_(pubPageShell_(gs_('pub.title.captain'), '<div class="err-msg">Captain not found.</div>'));

  var allTrips = readAll_('trips');
  var captainTrips = allTrips.filter(function(t) {
    return String(t.kennitala) === String(member.kennitala)
      && (t.role === 'skipper' || t.role === 'captain');
  }).sort(function(a, b) { return (b.date || '') > (a.date || '') ? 1 : -1; });

  var totalDist = 0, totalHrs = 0;
  captainTrips.forEach(function(t) {
    totalDist += Number(t.distanceNm) || 0;
    totalHrs  += Number(t.hoursDecimal) || 0;
  });

  var html = '<h1>' + esc_(member.name) + '</h1>'
    + '<div class="subtitle">' + gs_('pub.lbl.captainSince', { date: esc_(member.createdAt ? member.createdAt.slice(0, 10) : '—') }) + '</div>';

  // Stats
  html += '<div class="card" style="display:flex;justify-content:space-around;flex-wrap:wrap">'
    + '<div class="stat"><div class="stat-val">' + captainTrips.length + '</div><div class="stat-lbl">' + gs_('pub.lbl.totalSessions') + '</div></div>'
    + '<div class="stat"><div class="stat-val">' + totalDist.toFixed(1) + ' nm</div><div class="stat-lbl">' + gs_('pub.lbl.totalDistance') + '</div></div>'
    + '<div class="stat"><div class="stat-val">' + totalHrs.toFixed(1) + 'h</div><div class="stat-lbl">' + gs_('pub.lbl.totalHours') + '</div></div>'
    + '</div>';

  var boatsJson = getConfigSheetValue_('boats');
  var boats = [];
  try { boats = JSON.parse(boatsJson || '[]'); } catch(e) {}

  html += '<h2>' + gs_('pub.lbl.sessions') + '</h2><div class="card">'
    + pubTripTableHtml_(captainTrips, allTrips, boats, {})
    + '</div>';

  return htmlR_(pubPageShell_(gs_('pub.title.captain'), html));
}


// ── 5.3 Boat record ─────────────────────────────────────────────────────────

function publicBoatRecord_(b) {
  if (!b.id) return htmlR_(pubPageShell_(gs_('pub.title.boat'), '<div class="err-msg">Missing boat ID.</div>'));

  // Look up boat from config
  var boatsJson = getConfigSheetValue_('boats');
  var boats = [];
  try { boats = JSON.parse(boatsJson || '[]'); } catch(e) {}
  var boatMap = {};
  boats.forEach(function(bt) { boatMap[bt.id] = bt; });
  var boat = boatMap[b.id];
  if (!boat) return htmlR_(pubPageShell_(gs_('pub.title.boat'), '<div class="err-msg">Boat not found.</div>'));

  var allTrips = readAll_('trips');
  var boatTrips = allTrips.filter(function(t) {
    return String(t.boatId) === String(b.id);
  }).sort(function(a, bx) { return (bx.date || '') > (a.date || '') ? 1 : -1; });

  var totalDist = 0, totalHrs = 0;
  boatTrips.forEach(function(t) {
    totalDist += Number(t.distanceNm) || 0;
    totalHrs  += Number(t.hoursDecimal) || 0;
  });

  // Find member IDs for captain links
  var members = readAll_('members');
  var memberByKt = {};
  members.forEach(function(m) { memberByKt[m.kennitala] = m; });

  var html = '<h1>' + esc_(boat.name || '') + '</h1>'
    + '<div class="subtitle">'
    + (boat.registrationNo ? 'Reg: ' + esc_(boat.registrationNo) + ' · ' : '')
    + (boat.length ? esc_(boat.length) + 'm · ' : '')
    + (boat.type || boat.category || '')
    + '</div>';

  // Stats
  html += '<div class="card" style="display:flex;justify-content:space-around;flex-wrap:wrap">'
    + '<div class="stat"><div class="stat-val">' + boatTrips.length + '</div><div class="stat-lbl">' + gs_('pub.lbl.totalSessions') + '</div></div>'
    + '<div class="stat"><div class="stat-val">' + totalDist.toFixed(1) + ' nm</div><div class="stat-lbl">' + gs_('pub.lbl.totalDistance') + '</div></div>'
    + '<div class="stat"><div class="stat-val">' + totalHrs.toFixed(1) + 'h</div><div class="stat-lbl">' + gs_('pub.lbl.totalHours') + '</div></div>'
    + '</div>';

  // Trip table with captain links
  var scriptUrl = ScriptApp.getService().getUrl();
  html += '<h2>' + gs_('pub.lbl.sessions') + '</h2><div class="card">';
  if (!boatTrips.length) {
    html += '<div style="color:var(--muted);font-size:12px;font-style:italic">' + gs_('pub.lbl.noSessions') + '</div>';
  } else {
    html += '<div style="overflow-x:auto"><table><tr>'
      + '<th>' + gs_('pub.lbl.date') + '</th>'
      + '<th>' + gs_('pub.lbl.duration') + '</th>'
      + '<th>' + gs_('pub.lbl.distance') + '</th>'
      + '<th>' + gs_('pub.lbl.captain') + '</th>'
      + '<th>' + gs_('pub.lbl.crew') + '</th></tr>';
    boatTrips.forEach(function(t) {
      var dur = t.hoursDecimal ? (Number(t.hoursDecimal).toFixed(1) + 'h') : '';
      var dist = t.distanceNm ? (Number(t.distanceNm).toFixed(1) + ' nm') : '';
      var captMember = memberByKt[t.kennitala];
      var captainHtml = captMember
        ? '<a href="' + scriptUrl + '?action=captain&id=' + esc_(captMember.id) + '">' + esc_(t.memberName || '') + '</a>'
        : esc_(t.memberName || '');
      html += '<tr>'
        + '<td>' + esc_(t.date || '') + '</td>'
        + '<td>' + dur + '</td>'
        + '<td>' + dist + '</td>'
        + '<td>' + captainHtml + '</td>'
        + '<td>' + (t.crew || 1) + '</td></tr>';
    });
    html += '</table></div>';
  }
  html += '</div>';

  return htmlR_(pubPageShell_(gs_('pub.title.boat'), html));
}


// ── 5.4 Share link record ────────────────────────────────────────────────────

function publicShareRecord_(b) {
  var tokenId = b.share;
  if (!tokenId) return htmlR_(pubPageShell_(gs_('pub.title.share'), '<div class="err-msg">Missing token.</div>'));

  var token = findOne_('shareTokens', 'id', String(tokenId).trim());
  if (!token) return htmlR_(pubPageShell_(gs_('pub.title.share'), '<div class="err-msg">Token not found.</div>'));

  // Check if revoked
  if (token.revokedAt && String(token.revokedAt).trim() !== '') {
    return htmlR_(pubPageShell_(gs_('pub.title.share'),
      '<div class="revoked-msg">' + gs_('pub.share.revoked') + '</div>'));
  }

  // Update access stats
  updateRow_('shareTokens', 'id', tokenId, {
    accessCount: (Number(token.accessCount) || 0) + 1,
    lastAccessedAt: now_(),
  });

  // Find member
  var member = findOne_('members', 'id', token.memberId);
  if (!member) return htmlR_(pubPageShell_(gs_('pub.title.share'), '<div class="err-msg">Record not found.</div>'));

  var certs = [];
  try { certs = typeof member.certifications === 'string' ? JSON.parse(member.certifications) : (member.certifications || []); } catch(e) {}
  var certDefs = getCertDefs_();

  var cats = [];
  try { if (token.categories) cats = JSON.parse(token.categories); } catch(e) {}

  return htmlR_(pubPageShell_(gs_('pub.title.share'),
    pubRecordPageHtml_(member, certs, certDefs, {
      showTokens: false,
      cutOffDate: token.cutOffDate,
      includePhotos: token.includePhotos !== 'false' && token.includePhotos !== false,
      includeTracks: token.includeTracks !== 'false' && token.includeTracks !== false,
      categories: cats.length ? cats : null,
    })));
}


// ═══════════════════════════════════════════════════════════════════════════════
// SPREADSHEET SETUP  — run setupSpreadsheet() from the Apps Script editor
//
// Creates any missing tabs and adds any missing columns to existing tabs.
// Safe to run multiple times (fully idempotent).
//
// Run the focused helper addRecentTripColumns() if you only want to add
// the columns introduced in the keelboat Phase-1 update (v6):
//   distanceNm, departurePort, arrivalPort, trackFileUrl,
//   trackSimplified, trackSource, photoUrls
// ═══════════════════════════════════════════════════════════════════════════════

// ── Schema definition ────────────────────────────────────────────────────────

var SCHEMA_ = {
  members: [
    'id','kennitala','name','role','email','phone','birthYear',
    'isMinor','guardianName','guardianKennitala','guardianPhone',
    'active','certifications','initials','lang','createdAt','updatedAt',
  ],
  daily_log: [
    'id','date','openingChecks','closingChecks','activities',
    'weatherLog','narrative','tideData',
    'signedOffBy','signedOffAt','updatedBy','createdAt','updatedAt',
  ],
  maintenance: [
    'id','category','boatId','boatName','itemName','part','severity',
    'description','photoUrl','markOos','reportedBy','source','createdAt',
    'resolved','resolvedBy','resolvedAt','comments',
  ],
  checkouts: [
    // core
    'id','boatId','boatName','boatCategory',
    'memberKennitala','memberName','crew',
    'locationId','locationName',
    'checkedOutAt','expectedReturn','checkedInAt',
    'wxSnapshot','preLaunchChecklist','afterSailChecklist','notes',
    'status','createdAt','departurePort','crewNames',
    // group checkouts
    'isGroup','participants','staffNames','boatNames','boatIds',
    'activityTypeId','activityTypeName','linkedActivityId',
    // overdue alerts
    'alertSilenced','alertSilencedBy','alertSilencedAt',
    'alertSnoozedUntil','alertFirstSent',
  ],
  daily_checklist: [
    'id','phase','textEN','textIS','active','sortOrder','createdAt',
  ],
  incidents: [
    'id','types','severity','date','time',
    'locationId','locationName','boatId','boatName',
    'description','involved','witnesses',
    'immediateAction','followUp',
    'handOffTo','handOffName','handOffNotes',
    'photoUrls','filedBy','filedAt',
    'resolved','resolvedAt','staffNotes',
  ],
  trips: [
    'id','kennitala','memberName',
    'date','timeOut','timeIn','hoursDecimal',
    'boatId','boatName','boatCategory',
    'locationId','locationName',
    'crew','role','beaufort','windDir','wxSnapshot','notes',
    'isLinked','linkedCheckoutId','linkedTripId',
    'verified','verifiedBy','verifiedAt','staffComment',
    'validationRequested','helm','skipperNote',
    // keelboat Phase-1 (v6)
    'distanceNm','departurePort','arrivalPort',
    'trackFileUrl','trackSimplified','trackSource',
    'photoUrls','photoMeta',
    'createdAt','updatedAt',
  ],
  trip_confirmations: [
    'id','type','status',
    'fromKennitala','fromName',
    'toKennitala','toName',
    'tripId','linkedCheckoutId',
    'boatId','boatName','boatCategory',
    'locationId','locationName',
    'date','timeOut','timeIn','hoursDecimal',
    'role','helm',
    'beaufort','windDir','wxSnapshot',
    'rejectComment',
    'createdAt','respondedAt',
  ],
  config: ['key','value'],
  employees: [
    'id','kt','name','title','bankAccount','orlofsreikningur',
    'baseRateKr','union','lifeyrir','sereignarsjodur',
    'otherWithholdings','active','startDate','memberId','payrollEnabled',
  ],
  time_clock: [
    'id','employeeId','type','timestamp','source',
    'originalTimestamp','note','periodKey','durationMinutes',
  ],
  share_tokens: [
    'id','memberId','memberKennitala','cutOffDate',
    'createdAt','revokedAt','accessCount','lastAccessedAt',
    'includePhotos','includeTracks','categories',
  ],
  payroll: [
    'id','employeeId','period',
    'hoursRegular','hoursOT133','hoursOT155',
    'grossWage','orlofsfe','grossTotal',
    'lifeyrir','sereignarsjodur','otherWithholdings',
    'stadgreidslaSkattur','netPay',
    'tryggingagjald','motframlag','totalEmployerCost',
    'generatedBy',
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureTab_(ss, tabName, cols) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    sheet.setFrozenRows(1);
    Logger.log('Created tab: ' + tabName + ' (' + cols.length + ' columns)');
    return sheet;
  }
  // Tab exists — add any missing columns
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  cols.forEach(function(col) {
    if (!existing.includes(col)) {
      var nextCol = existing.length + 1;
      sheet.getRange(1, nextCol).setValue(col);
      existing.push(col);
      Logger.log('Added column "' + col + '" to tab "' + tabName + '"');
    }
  });
  return sheet;
}

// ── Main entry point ─────────────────────────────────────────────────────────

function setupSpreadsheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var results = [];

  Object.keys(SCHEMA_).forEach(function(tabName) {
    ensureTab_(ss, tabName, SCHEMA_[tabName]);
    results.push(tabName);
  });

  // Seed the config tab with default key rows if completely empty
  var cfgSheet = ss.getSheetByName('config');
  var cfgKeys = cfgSheet.getLastRow() >= 2
    ? cfgSheet.getRange(2, 1, cfgSheet.getLastRow()-1, 1).getValues().map(function(r){ return String(r[0]).trim(); })
    : [];
  var defaultCfgKeys = ['activity_types','overdueAlerts','flagConfig','staffStatus','boats','locations','launchChecklists','boatCategories','certDefs'];
  defaultCfgKeys.forEach(function(k) {
    if (!cfgKeys.includes(k)) {
      cfgSheet.appendRow([k, '']);
      Logger.log('Seeded config key: ' + k);
    }
  });

  Logger.log('setupSpreadsheet complete. Tabs processed: ' + results.join(', '));
  return 'Done — tabs processed: ' + results.join(', ');
}

// ── Focused helper: only the new keelboat Phase-1 trip columns ───────────────

function addRecentTripColumns() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var sheet = ss.getSheetByName('trips');
  if (!sheet) {
    Logger.log('trips tab not found — run setupSpreadsheet() first');
    return;
  }
  var newCols = ['distanceNm','departurePort','arrivalPort','trackFileUrl','trackSimplified','trackSource','photoUrls'];
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var added = [];
  newCols.forEach(function(col) {
    if (!existing.includes(col)) {
      sheet.getRange(1, existing.length + 1).setValue(col);
      existing.push(col);
      added.push(col);
    }
  });
  if (added.length) {
    Logger.log('Added to trips: ' + added.join(', '));
  } else {
    Logger.log('trips already has all keelboat Phase-1 columns — nothing to add');
  }
}

// ── Focused helper: add photoMeta column to trips ───────────────────────
function addPhotoMetaColumn() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var sheet = ss.getSheetByName('trips');
  if (!sheet) { Logger.log('trips tab not found'); return; }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  if (!existing.includes('photoMeta')) {
    sheet.getRange(1, existing.length + 1).setValue('photoMeta');
    Logger.log('Added photoMeta column to trips');
  } else {
    Logger.log('photoMeta column already exists');
  }
}

// ── Focused helper: add crewNames to checkouts + skipperNote to trips +
//    create trip_confirmations tab ────────────────────────────────────────
function addHandshakeColumns() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);

  // 1) checkouts → crewNames
  var coSheet = ss.getSheetByName('checkouts');
  if (coSheet) {
    var coHdr = coSheet.getRange(1, 1, 1, coSheet.getLastColumn()).getValues()[0].map(String);
    if (!coHdr.includes('crewNames')) {
      coSheet.getRange(1, coHdr.length + 1).setValue('crewNames');
      Logger.log('Added "crewNames" to checkouts');
    } else { Logger.log('checkouts already has crewNames'); }
  } else { Logger.log('checkouts tab not found — run setupSpreadsheet() first'); }

  // 2) trips → skipperNote
  var trSheet = ss.getSheetByName('trips');
  if (trSheet) {
    var trHdr = trSheet.getRange(1, 1, 1, trSheet.getLastColumn()).getValues()[0].map(String);
    if (!trHdr.includes('skipperNote')) {
      trSheet.getRange(1, trHdr.length + 1).setValue('skipperNote');
      Logger.log('Added "skipperNote" to trips');
    } else { Logger.log('trips already has skipperNote'); }
  } else { Logger.log('trips tab not found — run setupSpreadsheet() first'); }

  // 3) trip_confirmations tab (create if missing)
  var confCols = SCHEMA_.trip_confirmations;
  ensureTab_(ss, 'trip_confirmations', confCols);
  Logger.log('trip_confirmations tab ready');
}

function addPreferencesColumn() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var sheet = ss.getSheetByName('members');
  if (!sheet) { Logger.log('members tab not found'); return; }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('preferences') === -1) {
    var col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue('preferences');
    Logger.log('Added preferences column at col ' + col);
  } else {
    Logger.log('preferences column already exists');
  }
}

