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
      action === 'saveActivityType' || action === 'deleteActivityType' ||
      action === 'saveChecklistItem' || action === 'deleteChecklistItem') {
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

function signOut() {
  clearUser();
  window.location.href = BASE_URL + "/login/";
}

function getLang()  { return localStorage.getItem("ymirLang") || "EN"; }
function setLang(l) { localStorage.setItem("ymirLang", l); }

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
