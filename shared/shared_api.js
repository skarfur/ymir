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

// ── SHARED UTILITIES ──────────────────────────────────────────────────────────
// Canonical definitions — previously copy-pasted into every page.

/** HTML-escape a value for safe DOM insertion. */
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Coerce sheet boolean values (TRUE / "true" / 1 / true) → JS boolean. */
function boolVal(v) {
  return v === true || v === "true" || v === "TRUE" || v === 1 || v === "1";
}

/**
 * Safe JSON parse — returns fallback on any failure.
 * Also accepts already-parsed objects (pass-through).
 */
function parseJson(v, fallback) {
  if (!v) return fallback;
  try { return typeof v === "string" ? JSON.parse(v) : v; }
  catch(e) { return fallback; }
}

/**
 * Show a transient toast notification at the bottom of the screen.
 * type: "ok" | "err" | "warn"
 *
 * Aliases: toast(msg)          → type "ok"
 *          showMsg(msg, type)  → backward-compat with older pages
 */
function toast(msg, type) {
  type = type || "ok";
  const el = document.createElement("div");
  el.className = "msg msg-" + type;
  el.textContent = msg;
  el.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);"
                   + "min-width:220px;text-align:center;z-index:9999;font-size:12px;"
                   + "padding:10px 16px;border-radius:8px;pointer-events:none";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/** Backward-compatible alias used in several older pages. */
function showMsg(msg, type) { toast(msg, type); }

/**
 * Populate a <select> element from an array.
 * @param {string}   id         element id
 * @param {Array}    items      array of objects
 * @param {Function} labelFn    item → option label string
 * @param {Function} [valueFn]  item → option value (default: item.id)
 * @param {Function} [filterFn] optional predicate to skip items
 */
function populateSelect(id, items, labelFn, valueFn, filterFn) {
  const sel = document.getElementById(id);
  if (!sel) return;
  valueFn  = valueFn  || (item => item.id);
  filterFn = filterFn || (() => true);
  items.filter(filterFn).forEach(item => {
    const o = document.createElement("option");
    o.value       = valueFn(item);
    o.textContent = labelFn(item);
    sel.appendChild(o);
  });
}
