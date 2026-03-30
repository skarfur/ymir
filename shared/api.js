// YMIR - shared/api.js

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxDOdwZGy2gDt99PEENSk6D3xTC8KQHdOICRIDEFd0VDB1eCMmA1hJ3-iJJ1Q8PDuqh/exec";
const API_TOKEN  = "ymirsc2026";
const BASE_URL   = "https://skarfur.github.io/ymir";

async function apiGet(action, params) {
  params = params || {};
  // Cache getConfig in sessionStorage for 60s — called on every page load
  var _CACHEABLE = { getConfig: 120000, getMembers: 30000 };
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
      action === 'savePreferences' ||
      action === 'importMembers' || action === 'deactivateMembers' ||
      action === 'saveActivityType' || action === 'deleteActivityType' ||
      action === 'saveChecklistItem' || action === 'deleteChecklistItem' ||
      action === 'saveCertDef' || action === 'deleteCertDef') {
    try {
      sessionStorage.removeItem('ymir_getConfig_');
      sessionStorage.removeItem('ymir_getMembers_');
    } catch(e) {}
  }
  return _call(action, payload);
}

async function _call(action, payload) {
  payload = payload || {};
  var body = JSON.stringify(Object.assign({ action: action, token: API_TOKEN }, payload));
  var res  = await fetch(SCRIPT_URL, {
    method:   "POST",
    redirect: "follow",
    headers:  { "Content-Type": "text/plain" },
    body:     body,
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  var data = await res.json();
  if (!data.success) throw new Error(data.error || action + " failed");
  return data;
}

var AUTH_KEY = "ymirUser";
function getUser()   { try { return JSON.parse(sessionStorage.getItem(AUTH_KEY)); } catch(e) { return null; } }
function setUser(u)  { sessionStorage.setItem(AUTH_KEY, JSON.stringify(u)); }
function clearUser() { sessionStorage.removeItem(AUTH_KEY); }

function requireAuth(roleFn) {
  var u = getUser();
  if (!u) { window.location.href = BASE_URL + "/login/"; return null; }
  if (roleFn && !roleFn(u)) { window.location.href = BASE_URL + "/login/"; return null; }
  return u;
}

function isStaff(u) { return u && (u.role === "staff" || u.role === "admin"); }
function isAdmin(u) { return u && u.role === "admin"; }
function isCaptain(u) {
  if (!u || !u.certifications) return false;
  var certs = typeof u.certifications === 'string' ? parseJson(u.certifications, []) : (u.certifications || []);
  return Array.isArray(certs) && certs.some(function(c) { return c.sub === 'captain'; });
}

function signOut() {
  clearUser();
  window.location.href = BASE_URL + "/login/";
}

function getLang()  { return localStorage.getItem("ymirLang") || "EN"; }
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
  unit = unit || getPref('windUnit', 'bft');
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
  var next = getLang() === "EN" ? "IS" : "EN";
  setLang(next);
  var u = getUser();
  if (u && u.kennitala) {
    apiPost("setLang", { kennitala: u.kennitala, lang: next }).catch(function() {});
  }
  location.reload();
}

function fmtDate(iso) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }); }
  catch(e) { return String(iso).slice(0, 10); }
}

function fmtTime(iso) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" }); }
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
