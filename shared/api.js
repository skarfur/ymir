// YMIR - shared/api.js

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxDOdwZGy2gDt99PEENSk6D3xTC8KQHdOICRIDEFd0VDB1eCMmA1hJ3-iJJ1Q8PDuqh/exec";
// API_TOKEN is no longer required for authenticated calls — the session token
// issued by loginMember is the credential. It is still exposed as a global so
// hand-wired server-side callers (cron/trigger) can keep using it.
const API_TOKEN  = "ymirsc2026";
const BASE_URL   = "https://skarfur.github.io/ymir";

// ── Service Worker Cleanup ──────────────────────────────────────────────────
// Unregister any previously-installed service worker and purge its caches
// so users always get fresh static assets.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    regs.forEach(function(r) { r.unregister(); });
  }).catch(function() {});
  if (typeof caches !== 'undefined') {
    caches.keys().then(function(names) {
      names.forEach(function(n) { caches.delete(n); });
    }).catch(function() {});
  }
}

async function apiGet(action, params) {
  params = params || {};
  // Cache getConfig in sessionStorage for 60s — called on every page load
  var _CACHEABLE = { getConfig: 120000, getWeather: 300000, getMembers: 30000, getTrips: 30000, getMaintenance: 30000, getCrews: 30000, getCrewBoard: 30000, getCrewInvites: 30000, getNotifications: 30000 };
  if (_CACHEABLE[action] && !params._fresh) {
    try {
      var _ck = 'ymir_' + action + '_';
      var _cs = sessionStorage.getItem(_ck);
      if (_cs) { var _cp = JSON.parse(_cs); if (Date.now() - _cp.ts < _CACHEABLE[action]) return _cp.data; }
      var _cr = await _call(action, params);
      sessionStorage.setItem(_ck, JSON.stringify({ ts: Date.now(), data: _cr }));
      return _cr;
    } catch(e) { /* fall through */ }
  }
  return _call(action, params);
}
async function apiPost(action, payload) {
  payload = payload || {};
  // Invalidate config cache when config is saved
  if (action === 'saveConfig' || action === 'saveMembers' || action === 'saveMember' ||
      action === 'deleteMember' || action === 'saveMemberCert' ||
      action === 'savePreferences' || action === 'setPassword' ||
      action === 'importMembers' || action === 'deactivateMembers' ||
      action === 'saveActivityType' || action === 'deleteActivityType' ||
      action === 'saveChecklistItem' || action === 'deleteChecklistItem' ||
      action === 'saveCertDef' || action === 'deleteCertDef' ||
      action === 'saveCertCategories' ||
      action === 'saveBoatAccess' || action === 'saveBoatOos' || action === 'saveReservation' || action === 'removeReservation' ||
      action === 'saveVolunteerEvent' || action === 'deleteVolunteerEvent' ||
      action === 'volunteerSignup' || action === 'volunteerWithdraw' ||
      action === 'syncVolunteerEvents' ||
      action === 'saveRowingPassportDef' || action === 'importRowingPassportCsv') {
    try {
      sessionStorage.removeItem('ymir_getConfig_');
      sessionStorage.removeItem('ymir_getMembers_');
    } catch(e) {}
  }
  // Invalidate trips cache on trip mutations (respondConfirmation can create crew trips)
  if (action === 'saveTrip' || action === 'deleteTrip' || action === 'setHelm' || action === 'respondConfirmation') {
    try { sessionStorage.removeItem('ymir_getTrips_'); } catch(e) {}
  }
  // Invalidate maintenance cache on maintenance mutations
  if (action === 'saveMaintenance' || action === 'resolveMaintenance' ||
      action === 'deleteMaintenance' || action === 'addMaintenanceComment' ||
      action === 'adoptSaumaklubbur' || action === 'approveSaumaklubbur' ||
      action === 'holdSaumaklubbur' || action === 'toggleMaterial' ||
      action === 'addMaterial' || action === 'removeMaterial' ||
      action === 'followProject' || action === 'unfollowProject') {
    try { sessionStorage.removeItem('ymir_getMaintenance_'); } catch(e) {}
  }
  // Invalidate notification counts on state-changing actions
  if (action === 'respondConfirmation' || action === 'dismissConfirmation' || action === 'dismissAllConfirmations' ||
      action === 'respondCrewInvite' ||
      action === 'saveMaintenance' || action === 'resolveMaintenance' || action === 'addMaintenanceComment' ||
      action === 'followProject' || action === 'unfollowProject' || action === 'markProjectSeen' ||
      action === 'adoptSaumaklubbur' || action === 'approveSaumaklubbur' || action === 'holdSaumaklubbur' ||
      action === 'toggleMaterial' || action === 'addMaterial' || action === 'removeMaterial') {
    try { sessionStorage.removeItem('ymir_getNotifications_'); } catch(e) {}
  }
  // Invalidate sessions cache after session-state mutations so the settings
  // UI re-fetches the list instead of showing a freshly-revoked row.
  if (action === 'signOut' || action === 'signOutAll' || action === 'setPassword' ||
      action === 'adminResetMemberPassword') {
    try { sessionStorage.removeItem('ymir_listSessions_'); } catch(e) {}
  }
  // Invalidate crew caches on crew mutations
  if (action === 'createCrew' || action === 'disbandCrew' || action === 'inviteToCrew' ||
      action === 'respondCrewInvite' || action === 'bookSlot' || action === 'unbookSlot' || action === 'bulkBookSlots') {
    try {
      sessionStorage.removeItem('ymir_getCrews_');
      sessionStorage.removeItem('ymir_getCrewInvites_');
    } catch(e) {}
  }
  return _call(action, payload);
}

async function _call(action, payload) {
  payload = payload || {};
  // Public actions are exempt from session auth; loginMember is where we
  // obtain the token in the first place. For everything else, attach the
  // caller's session token so the backend can identify them.
  var PUBLIC_ACTIONS = { loginMember: 1, dashboard: 1, lookup: 1, captain: 1, boat: 1 };
  var envelope = { action: action, token: API_TOKEN };
  if (!PUBLIC_ACTIONS[action]) {
    var t = _getSessionToken();
    if (t) envelope.sessionToken = t;
  }
  // Loose metadata so listSessions can render a "Chrome on iPhone" label.
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    envelope.userAgent = String(navigator.userAgent).slice(0, 200);
  }
  var body = JSON.stringify(Object.assign(envelope, payload));
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function() { ctrl.abort(); }, 20000) : null;
  try {
    var res = await fetch(SCRIPT_URL, {
      method:   "POST",
      redirect: "follow",
      headers:  { "Content-Type": "text/plain" },
      body:     body,
      signal:   ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var data = await res.json();
    if (!data.success) {
      // A 401 means our session is gone — wipe local state and bounce the
      // user back to the login screen instead of leaving them staring at a
      // broken page. Public actions (login itself) are exempt so login
      // errors surface their real message. The login page itself also
      // swallows 401s because it hasn't authenticated yet (a pre-warm call
      // landing here shouldn't trigger an auth-redirect dance).
      var onLoginPage = (typeof window !== 'undefined' && window.location &&
        window.location.pathname.indexOf('/login/') >= 0);
      if (data.code === 401 && !PUBLIC_ACTIONS[action] && !onLoginPage) {
        _handleUnauthorized();
      }
      var err = new Error(data.error || action + " failed");
      err.code = data.code;
      throw err;
    }
    return data;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(action + " timed out");
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

var AUTH_KEY    = "ymirUser";
var PERSIST_KEY = "ymirStayLoggedIn";
var SESSION_KEY = "ymirSession";   // { token, expiresAt, id }
var PARENT_KEY  = "ymirParentSession"; // guardian's session preserved during ward switch

// ── Session token helpers ────────────────────────────────────────────────────
// The session token lives in sessionStorage (always) and additionally in
// localStorage when "stay logged in" is on. Expiry is checked on every read
// so a stale tab doesn't keep firing requests after a long idle.
function _readSession() {
  try {
    var s = sessionStorage.getItem(SESSION_KEY);
    if (s) return JSON.parse(s);
  } catch(e) {}
  try {
    var l = localStorage.getItem(SESSION_KEY);
    if (l) {
      try { sessionStorage.setItem(SESSION_KEY, l); } catch(e) {}
      return JSON.parse(l);
    }
  } catch(e) {}
  return null;
}
function _writeSession(sess) {
  var json = JSON.stringify(sess);
  try { sessionStorage.setItem(SESSION_KEY, json); } catch(e) {}
  try {
    if (getStayLoggedIn()) localStorage.setItem(SESSION_KEY, json);
    else                   localStorage.removeItem(SESSION_KEY);
  } catch(e) {}
}
function _clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch(e) {}
  try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
}
function _getSessionToken() {
  var s = _readSession();
  if (!s || !s.token) return null;
  if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) {
    _clearSession();
    return null;
  }
  return s.token;
}
function setSession(token, expiresAt, id) {
  if (!token) { _clearSession(); return; }
  _writeSession({ token: token, expiresAt: expiresAt || null, id: id || null });
}
function getSessionInfo() { return _readSession(); }

// Preserve the guardian's session token when switching into a ward's session
// so "back to guardian" can restore it without a re-login.
function setParentSession(info) {
  if (!info) {
    try { sessionStorage.removeItem(PARENT_KEY); } catch(e) {}
    try { localStorage.removeItem(PARENT_KEY); } catch(e) {}
    return;
  }
  var json = JSON.stringify(info);
  try { sessionStorage.setItem(PARENT_KEY, json); } catch(e) {}
  try {
    if (getStayLoggedIn()) localStorage.setItem(PARENT_KEY, json);
    else                   localStorage.removeItem(PARENT_KEY);
  } catch(e) {}
}
function getParentSession() {
  try {
    var s = sessionStorage.getItem(PARENT_KEY);
    if (s) return JSON.parse(s);
  } catch(e) {}
  try {
    var l = localStorage.getItem(PARENT_KEY);
    if (l) return JSON.parse(l);
  } catch(e) {}
  return null;
}

// Called when a request returns 401: drop local state and send the user
// back to the login screen. Guarded so we only redirect once — a burst of
// 401s shouldn't hijack the navigation mid-redirect.
var _unauthHandled = false;
function _handleUnauthorized() {
  if (_unauthHandled) return;
  _unauthHandled = true;
  clearUser();
  _clearSession();
  setParentSession(null);
  // Only redirect pages that actually depend on auth; the login page handles
  // its own 401s (bad credentials, etc.) locally.
  if (typeof window !== 'undefined' && window.location &&
      window.location.pathname.indexOf('/login/') < 0) {
    window.location.href = BASE_URL + "/login/";
  }
}

// When "stay logged in" is on (set in settings), the user record is mirrored
// to localStorage so it survives closing the tab — useful on mobile where the
// site is pinned as an app. Otherwise it lives only in sessionStorage.
function getStayLoggedIn() {
  try { return localStorage.getItem(PERSIST_KEY) === '1'; } catch(e) { return false; }
}
function setStayLoggedIn(v) {
  try {
    if (v) localStorage.setItem(PERSIST_KEY, '1');
    else   localStorage.removeItem(PERSIST_KEY);
  } catch(e) {}
  // Sync the current user record so the new preference takes effect immediately.
  var u = getUser();
  if (u) setUser(u);
}

function getUser() {
  try {
    var s = sessionStorage.getItem(AUTH_KEY);
    if (s) return JSON.parse(s);
  } catch(e) {}
  try {
    var l = localStorage.getItem(AUTH_KEY);
    if (l) {
      var parsed = JSON.parse(l);
      // Rehydrate into sessionStorage so this tab has a fast local copy.
      try { sessionStorage.setItem(AUTH_KEY, l); } catch(e) {}
      return parsed;
    }
  } catch(e) {}
  return null;
}
function setUser(u) {
  var json = JSON.stringify(u);
  try { sessionStorage.setItem(AUTH_KEY, json); } catch(e) {}
  try {
    if (getStayLoggedIn()) localStorage.setItem(AUTH_KEY, json);
    else                   localStorage.removeItem(AUTH_KEY);
  } catch(e) {}
}
function clearUser() {
  try { sessionStorage.removeItem(AUTH_KEY); } catch(e) {}
  try { localStorage.removeItem(AUTH_KEY); } catch(e) {}
}

function requireAuth(roleFn) {
  var u = getUser();
  var token = _getSessionToken();
  if (!u || !token) {
    // Clear stale user state if the session has expired out from under us.
    if (u && !token) clearUser();
    window.location.href = BASE_URL + "/login/";
    return null;
  }
  if (roleFn && !roleFn(u)) { window.location.href = BASE_URL + "/login/"; return null; }
  return u;
}

function isStaff(u) { return u && (u.role === "staff" || u.role === "admin"); }
function isAdmin(u) { return u && u.role === "admin"; }
function _certNotExpired(c) {
  return !c.expiresAt || c.expiresAt >= todayISO();
}
function isCaptain(u) {
  if (!u || !u.certifications) return false;
  var certs = typeof u.certifications === 'string' ? parseJson(u.certifications, []) : (u.certifications || []);
  return Array.isArray(certs) && certs.some(function(c) { return c.sub === 'captain' && _certNotExpired(c); });
}
// Internal: walk a user's certifications once and return { hasAny, sub },
// where hasAny means "has some rowing cert of any shape, regardless of
// expiry" and sub is the highest-rank non-expired canonical subcat
// ('restricted' | 'released' | 'coxswain') or null.
//
// Handles three data shapes:
//  1. Default cert defs: certId 'rowing_division', subs 'restricted'/'released'/'coxswain'
//  2. Custom cert defs:  certId is an auto-ID like 'cert_xxxx', subs 'restricted_rower'/'released_rower'/'coxswain'
//  3. Legacy:            certId 'released_rower'
function _rowingCertInfo(u) {
  var out = { hasAny: false, sub: null };
  if (!u || !u.certifications) return out;
  var certs = typeof u.certifications === 'string' ? parseJson(u.certifications, []) : (u.certifications || []);
  if (!Array.isArray(certs)) return out;
  var rank = { restricted: 1, released: 2, coxswain: 3 };
  var bestRank = -1;
  for (var i = 0; i < certs.length; i++) {
    var c = certs[i];
    if (!c) continue;
    var id  = String(c.certId || c.id || '').toLowerCase();
    var sub = String(c.sub || '').toLowerCase();
    var isRowing = false;
    var resolvedSub = null;
    // Shape 1: default certId 'rowing_division'
    if (id === 'rowing_division') {
      isRowing = true;
      if (rank[sub]) resolvedSub = sub;                      // restricted | released | coxswain
      else if (sub === 'restricted_rower') resolvedSub = 'restricted';
      else if (sub === 'released_rower')   resolvedSub = 'released';
    }
    // Shape 3: legacy certId
    else if (id === 'released_rower') {
      isRowing = true;
      resolvedSub = 'released';
    }
    // Shape 2: custom cert def with a rowing sub value — regardless of certId
    if (!isRowing) {
      if (sub === 'restricted_rower' || sub === 'restricted') { isRowing = true; resolvedSub = 'restricted'; }
      else if (sub === 'released_rower' || sub === 'released') { isRowing = true; resolvedSub = 'released'; }
      else if (sub === 'coxswain')                             { isRowing = true; resolvedSub = 'coxswain'; }
    }
    if (!isRowing) continue;
    // Membership is permanent — any rowing cert, expired or not, gates access.
    out.hasAny = true;
    // Feature gating (released vs restricted) uses only non-expired certs.
    if (resolvedSub && _certNotExpired(c) && rank[resolvedSub] > bestRank) {
      out.sub = resolvedSub;
      bestRank = rank[resolvedSub];
    }
  }
  return out;
}

// Returns the highest-rank rowing subcat key the user holds.
// One of: 'restricted' | 'released' | 'coxswain' | null.
// Any rowing_division cert without a recognised sub is treated as 'restricted'
// so pre-migration data and unusual shapes still map to a usable rank.
function getRowingSub(u) {
  var info = _rowingCertInfo(u);
  if (info.sub) return info.sub;
  if (info.hasAny) return 'restricted';
  return null;
}
function isReleasedRower(u) {
  var sub = getRowingSub(u);
  return sub === 'released' || sub === 'coxswain';
}
function isCoxswain(u) { return getRowingSub(u) === 'coxswain'; }
// True if the user has any rowing-division cert at all, regardless of sub or
// expiry. Used as the gate for "can access the rowing division page" — the
// page itself then uses getRowingSub to decide what to show inside.
function hasRowingEndorsement(u) { return _rowingCertInfo(u).hasAny; }

// Best-effort server sign-out: revoke the session on the backend so another
// device's listSessions stops showing it, then wipe local state. Network
// errors don't block the redirect — leaving the user stranded on a failed
// sign-out is worse than a stale row in the sessions sheet.
async function signOut() {
  try {
    if (_getSessionToken()) {
      await _call('signOut', {});
    }
  } catch (e) { /* ignore; fall through to local cleanup */ }
  clearUser();
  _clearSession();
  setParentSession(null);
  window.location.href = BASE_URL + "/login/";
}

// When a guardian has signed into their ward's account, `user.guardianSession`
// holds a trimmed snapshot of the guardian's own member record and the
// guardian's original session token is stashed under PARENT_KEY. This helper
// restores the guardian's session, re-fetches their member record, and sends
// them back to the member hub (their own hub-switch buttons can take it from
// there if they're also staff/admin).
async function switchBackToGuardian() {
  var cur = getUser();
  if (!cur || !cur.guardianSession || !cur.guardianSession.kennitala) return;
  var parent = getParentSession();
  try {
    // Revoke the ward session on the way out so it doesn't linger in the
    // backend's sessions sheet. Best-effort.
    try { await _call('signOut', {}); } catch(e) {}
    if (!parent || !parent.token) throw new Error('parent session missing');
    // Restore the guardian's token before the next API call so
    // validateMember auth's as them.
    setSession(parent.token, parent.expiresAt || null, parent.id || null);
    setParentSession(null);
    var data = await apiGet('validateMember', { kennitala: cur.guardianSession.kennitala, _fresh: 1 });
    if (!data || !data.member) throw new Error('guardian not found');
    setUser(data.member);
    // Purge any cached per-user data so the guardian's view is not stale.
    try {
      sessionStorage.removeItem('ymir_getTrips_');
      sessionStorage.removeItem('ymir_getCrews_');
      sessionStorage.removeItem('ymir_getCrewBoard_');
      sessionStorage.removeItem('ymir_getCrewInvites_');
    } catch(e) {}
    window.location.href = BASE_URL + "/member/";
  } catch(e) {
    // Fall back to a clean sign-out on any failure so the guardian can re-enter.
    signOut();
  }
}

function getLang()  { return localStorage.getItem("ymirLang") || "IS"; }
function setLang(l) { localStorage.setItem("ymirLang", l); }

// ── Theme ─────────────────────────────────────────────────────────────────────
function getTheme()  { return localStorage.getItem("ymirTheme") || "dark"; }
function setTheme(t) {
  localStorage.setItem("ymirTheme", t);
  document.documentElement.setAttribute("data-theme", t);
}
function applyTheme() {
  document.documentElement.setAttribute("data-theme", getTheme());
}

// ── Preferences ───────────────────────────────────────────────────────────────
function getPrefs() {
  try { return JSON.parse(localStorage.getItem("ymirPrefs") || "{}"); } catch(e) { return {}; }
}
function setPrefs(p) { localStorage.setItem("ymirPrefs", JSON.stringify(p)); }
function getPref(key, fallback) { var p = getPrefs(); return p[key] !== undefined ? p[key] : fallback; }

// Default stats visibility for new members: only the four headline metrics are on.
// Existing saved prefs take precedence — a saved `true` or `false` always wins
// over these defaults; these only fill in keys the user has never touched.
var STATS_VIS_DEFAULTS = {
  career:      false,
  hours:       true,
  ytd:         true,
  skipper:     false,
  byCategory:  true,
  distance:    true,
  longest:     false,
  avgWind:     false,
  streak:      false,
  boats:       false,
  crew:        false,
  heavy:       false,
  avgDuration: false,
  locations:   false,
  verified:    false,
  helmHours:   false,
  student:     false,
  favBoat:     false,
  favLocation: false,
  peakWind:    false,
};
function isStatVisible(key, sv) {
  sv = sv || {};
  if (sv[key] === undefined) return !!STATS_VIS_DEFAULTS[key];
  return sv[key] !== false;
}

// Wind unit conversion — base unit is m/s
function convertWind(ms, unit) {
  if (ms == null || isNaN(ms)) return '';
  switch (unit) {
    case 'kts': return (ms * 1.94384).toFixed(1);
    case 'kmh': return (ms * 3.6).toFixed(1);
    case 'mph': return (ms * 2.23694).toFixed(1);
    case 'ms':  return Math.round(ms);
    default:    return Math.round(ms);
  }
}
function windUnitLabel(unit) {
  switch (unit) {
    case 'kts': return 'kts';
    case 'kmh': return 'km/h';
    case 'mph': return 'mph';
    case 'ms':  return 'm/s';
    default:    return 'm/s';
  }
}
function bftFromMs(ms) {
  if (ms == null) return null;
  var m = parseFloat(ms);
  if (m < 0.3) return 0; if (m < 1.6) return 1; if (m < 3.4) return 2;
  if (m < 5.5) return 3; if (m < 8.0) return 4; if (m < 10.8) return 5;
  if (m < 13.9) return 6; if (m < 17.2) return 7; if (m < 20.8) return 8;
  if (m < 24.5) return 9; if (m < 28.5) return 10; if (m < 32.7) return 11;
  return 12;
}
// Convert from any supported unit back to m/s
function convertToMs(val, unit) {
  if (val == null || isNaN(val)) return NaN;
  var v = parseFloat(val);
  switch (unit) {
    case 'kts': return v / 1.94384;
    case 'kmh': return v / 3.6;
    case 'mph': return v / 2.23694;
    case 'ms':  return v;
    default:    return v;
  }
}

// Beaufort scale boundaries in m/s (index = Beaufort number)
var BFT_BOUNDARIES = [0, 0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];

// Return [min, max] m/s range for a Beaufort number.
// For Force 12 the upper bound is null (open-ended), stored as 99.
function bftToMsRange(bft) {
  var b = parseInt(bft);
  if (isNaN(b) || b < 0 || b > 12) return null;
  var lo = BFT_BOUNDARIES[b];
  var hi = b < 12 ? BFT_BOUNDARIES[b + 1] : 99;
  return [lo, hi];
}

// Midpoint of Beaufort range in m/s (useful for auto-filling from Beaufort)
function bftToMsMid(bft) {
  var r = bftToMsRange(bft);
  if (!r) return null;
  if (r[1] === 99) return r[0]; // Force 12: just use lower bound
  return +((r[0] + r[1]) / 2).toFixed(1);
}

// Parse a ws value that may be a number or a range string like "5.5-8.0".
// Returns the midpoint as a number, or null if invalid.
function parseWsValue(ws) {
  if (ws == null) return null;
  if (typeof ws === 'number') return ws;
  var s = String(ws);
  if (s.indexOf('-') !== -1) {
    var parts = s.split('-').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return (parts[0] + parts[1]) / 2;
    }
  }
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function formatWindValue(ms, beaufort, unit) {
  unit = unit || getPref('windUnit', 'ms');
  // Handle range values like "5.5-8.0" (from Beaufort-only entry)
  if (typeof ms === 'string' && ms.indexOf('-') !== -1) {
    var parts = ms.split('-').map(Number);
    if (unit === 'bft') {
      var b = beaufort != null ? beaufort : bftFromMs(parts[0]);
      return b != null ? 'Force ' + b : '';
    }
    return convertWind(parts[0], unit) + '–' + convertWind(parts[1], unit) + ' ' + windUnitLabel(unit);
  }
  if (unit === 'bft') {
    var b = beaufort != null ? beaufort : (ms != null ? bftFromMs(ms) : null);
    return b != null ? 'Force ' + b : '';
  }
  if (ms != null) return convertWind(ms, unit) + ' ' + windUnitLabel(unit);
  return beaufort != null ? 'Force ' + beaufort : '';
}

function toggleLang() {
  // The IS/EN toggle is a temporary UI state and intentionally does not
  // persist to the server. The user's default language lives in their
  // saved preferences (see the settings page).
  var next = getLang() === "EN" ? "IS" : "EN";
  setLang(next);
  location.reload();
}

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    var d = new Date(iso);
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '-' + mm + '-' + d.getFullYear();
  } catch(e) { return String(iso).slice(0, 10); }
}
function fmtDateShort(iso) {
  if (!iso) return "-";
  try {
    var d = new Date(iso);
    return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0');
  } catch(e) { return String(iso).slice(0, 10); }
}

var _monthKeys = ['month.jan','month.feb','month.mar','month.apr','month.may','month.jun','month.jul','month.aug','month.sep','month.oct','month.nov','month.dec'];
function fmtWeekRange(startISO, endISO) {
  try {
    var a = new Date(startISO), b = new Date(endISO);
    var aMonth = s(_monthKeys[a.getMonth()]);
    var bMonth = s(_monthKeys[b.getMonth()]);
    if (a.getMonth() === b.getMonth()) {
      return a.getDate() + ' – ' + b.getDate() + ' ' + aMonth;
    }
    return a.getDate() + ' ' + aMonth + ' – ' + b.getDate() + ' ' + bMonth;
  } catch(e) { return fmtDateShort(startISO) + ' – ' + fmtDateShort(endISO); }
}

// Safe-string: coerce any value to a string.  Handles the common case where
// Google Sheets returns numeric kennitalas, IDs, or timestamps as JS numbers.
// Use before .slice(), .trim(), .startsWith() etc. on API-sourced values.
window.sstr = function(v) { return v == null ? '' : String(v); };

function fmtTime(iso) {
  if (!iso) return "-";
  try { var d = new Date(iso); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
  catch(e) { return ""; }
}

function fmtTimeNow() { return new Date().toTimeString().slice(0, 5); }
function fmtDateNow() { return new Date().toISOString().slice(0, 10); }

// Shared primitives - single source of truth
window.boolVal = function(v) {
  return v === true || v === "TRUE" || v === "true" || v === 1 || v === "1";
};

window.parseJson = function(v, fallback) {
  try { return v ? (typeof v === "string" ? JSON.parse(v) : v) : fallback; }
  catch(e) { return fallback; }
};

window.todayISO = function() {
  return new Date().toISOString().slice(0, 10);
};

window.chunk = function(arr, n) {
  var out = [];
  for (var i = 0; i < arr.length; i += n) {
    out.push(arr.slice(i, i + n));
  }
  return out;
};

// ── Container warming ────────────────────────────────────────────────────────
// Call warmContainer() from each page after initial load completes.
// On visibilitychange (user returns to tab), fires a background ping so the
// Apps Script container is warm before the next user action.
function warmContainer() {
  var lastWarm = 0;
  var idleTimer = null;
  var IDLE_MS = 5 * 60 * 1000; // re-warm after 5 min of in-tab inactivity

  function doWarm() {
    var now = Date.now();
    if (now - lastWarm < 60000) return;
    lastWarm = now;
    _call('getConfig', {}).then(function(r) {
      try {
        sessionStorage.setItem('ymir_getConfig_', JSON.stringify({ ts: Date.now(), data: r }));
      } catch(e) {}
    }).catch(function() {});
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(doWarm, IDLE_MS);
  }

  // Warm on tab return
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState !== 'visible') return;
    doWarm();
    resetIdleTimer();
  });

  // Warm after idle period within the tab
  ['mousemove', 'keydown', 'pointerdown', 'scroll'].forEach(function(ev) {
    document.addEventListener(ev, resetIdleTimer, { passive: true });
  });

  resetIdleTimer();
}
