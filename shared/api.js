// YMIR - shared/api.js

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxDOdwZGy2gDt99PEENSk6D3xTC8KQHdOICRIDEFd0VDB1eCMmA1hJ3-iJJ1Q8PDuqh/exec";
const API_TOKEN  = "ymirsc2026";
const BASE_URL   = "https://skarfur.github.io/ymir";

async function apiGet(action, params) { params = params || {}; return _call(action, params); }
async function apiPost(action, payload) { payload = payload || {}; return _call(action, payload); }

async function _call(action, payload) {
  payload = payload || {};
  var body = JSON.stringify(Object.assign({ action: action, token: API_TOKEN }, payload));
  var url  = SCRIPT_URL + "?p=" + encodeURIComponent(body);
  var res  = await fetch(url, { redirect: "follow" });
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
