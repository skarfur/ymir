// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/api.js
// ═══════════════════════════════════════════════════════════════════════════════

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxDOdwZGy2gDt99PEENSk6D3xTC8KQHdOICRIDEFd0VDB1eCMmA1hJ3-iJJ1Q8PDuqh/exec";
const API_TOKEN  = "ymirsc2026";
const BASE_URL   = "https://skarfur.github.io/ymir";

// ── API CALLS ─────────────────────────────────────────────────────────────────
// All requests use GET. The entire payload is JSON-encoded into a single
// "p" query param to avoid the Apps Script POST redirect problem.

async function apiGet(action, params = {}) {
  return _call(action, params);
}

async function apiPost(action, payload = {}) {
  return _call(action, payload);
}

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

function getLang()    { return localStorage.getItem("ymirLang") || "EN"; }
function setLang(l)   { localStorage.setItem("ymirLang", l); }
function toggleLang() { setLang(getLang() === "EN" ? "IS" : "EN"); location.reload(); }

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

function todayISO() { return new Date().toISOString().slice(0, 10); }
