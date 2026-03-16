// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/api.js
// ═══════════════════════════════════════════════════════════════════════════════

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxDOdwZGy2gDt99PEENSk6D3xTC8KQHdOICRIDEFd0VDB1eCMmA1hJ3-iJJ1Q8PDuqh/exec";
const API_TOKEN  = "ymirsc2026";
const BASE_URL   = "https://skarfur.github.io/ymir";

// ── API CALLS ─────────────────────────────────────────────────────────────────

async function apiGet(action, params = {}) { return _call(action, params); }
async function apiPost(action, payload = {}) { return _call(action, payload); }

async function _call(action, payload = {}) {
  const body = JSON.stringify({ action, token: API_TOKEN, ...payload });
  const url  = SCRIPT_URL + "?p=" + encodeURIComponent(body);
  const res  = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || action + " failed");
  return data;
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

const AUTH_KEY = "ymirUser";

function getUser()   { try { return JSON.parse(sessionStorage.getItem(AUTH_KEY)); } catch(e) { return null; } }
function setUser(u)  { sessionStorage.setItem(AUTH_KEY, JSON.stringify(u)); }
function clearUser() { sessionStorage.removeItem(AUTH_KEY); }

function requireAuth(roleFn) {
  const u = getUser();
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

// ── LANGUAGE ──────────────────────────────────────────────────────────────────

function getLang()  { return localStorage.getItem("ymirLang") || "EN"; }
function setLang(l) { localStorage.setItem("ymirLang", l); }

/**
 * Toggle language, persist to backend (fire-and-forget), then reload.
 * If the user isn't logged in the backend call is skipped gracefully.
 */
function toggleLang() {
  const next = getLang() === "EN" ? "IS" : "EN";
  setLang(next);

  // Persist to backend so email alerts respect this preference.
  // Fire-and-forget — don't block the reload on it.
  const u = getUser();
  if (u?.kennitala) {
    apiPost("setLang", { kennitala: u.kennitala, lang: next }).catch(() => {});
  }

  location.reload();
}

// ── FORMATTING ────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }); }
  catch(e) { return String(iso).slice(0, 10); }
}

function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" }); }
  catch(e) { return ""; }
}

/** Current time as "HH:MM" string — used to pre-fill time fields. */
function fmtTimeNow() { return new Date().toTimeString().slice(0, 5); }

/** Today's date as "YYYY-MM-DD" string. */
function fmtDateNow() { return new Date().toISOString().slice(0, 10); }

// ── SHARED PRIMITIVES — single source of truth for all shared utilities ───────

/** Boolean coercion — mirrors bool_() in Code.gs. Required by boats.js and maintenance.js. */
window.boolVal = v => v === true || v === "TRUE" || v === "true" || v === 1 || v === "1";

/** Safe JSON parse with fallback. Required by maintenance.js and certs.js. */
window.parseJson = (v, fallback) => {
  try { return v ? (typeof v === "string" ? JSON.parse(v) : v) : fallback; }
  catch(e) { return fallback; }
};

/** Today as YYYY-MM-DD. Required by certs.js. */
window.todayISO = () => new Date().toISOString().slice(0, 10);

/** Split array into chunks of size n. */
window.chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i)
