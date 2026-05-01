// YMIR - shared/api.js

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxDOdwZGy2gDt99PEENSk6D3xTC8KQHdOICRIDEFd0VDB1eCMmA1hJ3-iJJ1Q8PDuqh/exec";
const BASE_URL   = "https://skarfur.github.io/ymir";
// Google Identity Services OAuth 2.0 Client ID (public by design). Leave
// empty to disable one-tap sign-in client-side; backend also refuses to
// verify tokens unless the GOOGLE_CLIENT_ID script property is set.
const GOOGLE_CLIENT_ID = "231967339479-m1fqbqk134sjtt2o4nloljfle7l7hk7b.apps.googleusercontent.com";

// ── Service Worker Cleanup (one-shot per browser) ──────────────────────────
// The app used to register a SW; it was removed long ago. This block
// guarantees any stranded old SW + its caches get purged so users don't
// see stale static assets. Once it's run successfully in a browser we
// flip a localStorage flag and skip on every subsequent page load —
// there's no point re-querying navigator.serviceWorker on every view.
try {
  if (!localStorage.getItem('ymirSwCleanupDone') && 'serviceWorker' in navigator) {
    var _swCleanupDone = function () { try { localStorage.setItem('ymirSwCleanupDone', '1'); } catch (e) {} };
    navigator.serviceWorker.getRegistrations()
      .then(function (regs) { regs.forEach(function (r) { r.unregister(); }); })
      .catch(function () {})
      .finally(_swCleanupDone);
    if (typeof caches !== 'undefined') {
      caches.keys().then(function (names) {
        names.forEach(function (n) { caches.delete(n); });
      }).catch(function () {});
    }
  }
} catch (e) {}

async function apiGet(action, params) {
  params = params || {};
  // Cache key now includes a serialized params suffix so the same action with
  // different params (e.g. getSlots for adjacent weeks) doesn't clobber the
  // single-entry cache. apiPost invalidates by prefix scan so all entries
  // for an action drop together.
  var _CACHEABLE = { getConfig: 120000, getWeather: 300000, getMembers: 30000, getTrips: 30000, getMaintenance: 30000, getCrews: 30000, getCrewBoard: 30000, getCrewInvites: 30000, getNotifications: 30000, getConfirmations: 30000, getHandbook: 600000, getSlots: 60000 };
  if (_CACHEABLE[action] && !params._fresh) {
    try {
      var _ck = 'ymir_' + action + '_' + JSON.stringify(params);
      var _now = Date.now();
      // Memory tier: skip sessionStorage + JSON.parse on warm hits. Same
      // TTL as sessionStorage; populated on every miss-then-fetch and on
      // sessionStorage-hit promotions so subsequent reads in this tab go
      // straight to the parsed object.
      var _mc = apiGet._memCache[_ck];
      if (_mc && _now - _mc.ts < _CACHEABLE[action]) return _mc.data;
      var _cs = sessionStorage.getItem(_ck);
      if (_cs) {
        var _cp = JSON.parse(_cs);
        if (_now - _cp.ts < _CACHEABLE[action]) {
          apiGet._memCache[_ck] = _cp; // promote so the next hit skips parse
          return _cp.data;
        }
      }
      // In-flight dedup: if an identical request is already running (cache
      // miss during page init often fires several parallel apiGet calls for
      // the same action+params), reuse the pending promise instead of kicking
      // off a second network round-trip.
      if (apiGet._inflight[_ck]) return apiGet._inflight[_ck];
      var _p = (async function () {
        try {
          var data = await _call(action, params);
          var entry = { ts: Date.now(), data: data };
          apiGet._memCache[_ck] = entry;
          try { sessionStorage.setItem(_ck, JSON.stringify(entry)); } catch(e) {}
          return data;
        } finally {
          delete apiGet._inflight[_ck];
        }
      })();
      apiGet._inflight[_ck] = _p;
      return _p;
    } catch(e) { /* fall through */ }
  }
  return _call(action, params);
}
apiGet._inflight = {};
apiGet._memCache = {};

// Drop every cached entry (memory + sessionStorage) for the given action.
// Called by apiPost after a write so the next read sees fresh data. Both
// tiers use the same `ymir_<action>_<paramsJSON>` key shape.
function _invalidateApiCache(action) {
  var prefix = 'ymir_' + action + '_';
  try {
    for (var i = sessionStorage.length - 1; i >= 0; i--) {
      var k = sessionStorage.key(i);
      if (k && k.indexOf(prefix) === 0) sessionStorage.removeItem(k);
    }
  } catch(e) {}
  if (apiGet._memCache) {
    var keys = Object.keys(apiGet._memCache);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].indexOf(prefix) === 0) delete apiGet._memCache[keys[j]];
    }
  }
}
// Which cache entries each write-action invalidates. Single source of truth.
// Keys are apiPost action names; values are the getXxx reads whose cached
// copy should be dropped after the POST so the next call picks up fresh
// data. An action absent from this table evicts nothing.
//
// Rule: only list a getXxx here if the write actually changes data the
// getXxx response embeds. Over-invalidation forces a needless re-fetch on
// the user's next action; under-invalidation shows stale data. Each entry
// below was checked against its backend handler (which sheets/keys it
// writes) and the corresponding read (which fields it returns).
//
// Reference notes for the audit trail:
//   getConfig — config sheet only (boats, locations, certDefs, certCats,
//     activity_types, dailyChecklist, flagConfig/Override, staffStatus,
//     rowingPassport, clubCalendars) PLUS scheduled_events projection
//     (volunteerEvents, cancelledActivityOccurrences). Independent of
//     the members sheet entirely.
//   getMembers — members sheet only.
var _INVALIDATES = {
  // Config writes — config-sheet only; member rows untouched.
  saveConfig:              ['getConfig'],
  saveActivityType:        ['getConfig', 'getSlots'],
  deleteActivityType:      ['getConfig', 'getSlots'],
  saveChecklistItem:       ['getConfig'],
  deleteChecklistItem:     ['getConfig'],
  saveCertDef:             ['getConfig'],
  deleteCertDef:           ['getConfig'],
  saveCertCategories:      ['getConfig'],
  saveBoatAccess:          ['getConfig'],
  saveBoatOos:             ['getConfig'],
  saveReservation:         ['getConfig'],
  removeReservation:       ['getConfig'],
  saveFlagOverride:        ['getConfig'],
  saveStaffStatus:         ['getConfig'],
  saveRowingPassportDef:   ['getConfig'],
  importRowingPassportCsv: ['getConfig'],
  // Class-occurrence writes touch scheduled_events (which feeds getConfig's
  // volunteerEvents + cancelledActivityOccurrences) and the activity-class
  // virtual-slot projection. getDailyLog isn't cached — listed only for
  // semantic intent (no-op today).
  cancelClassOccurrence:   ['getConfig', 'getSlots', 'getDailyLog'],
  overrideClassOccurrence: ['getConfig', 'getSlots', 'getDailyLog'],
  restoreClassOccurrence:  ['getConfig', 'getSlots', 'getDailyLog'],
  // Volunteer events live in scheduled_events (read by getConfig).
  saveVolunteerEvent:      ['getConfig'],
  deleteVolunteerEvent:    ['getConfig'],
  syncVolunteerEvents:     ['getConfig'],
  // Volunteer signups write to a separate sheet that no cached read embeds
  // (signups are fetched via apiPost('getVolunteerSignups'), uncached).
  // volunteerSignup_ keeps getConfig because the first signup against a
  // virtual recurring event materializes a scheduled_events row, which
  // feeds getConfig.volunteerEvents. volunteerWithdraw_ touches no cached
  // read at all and is intentionally absent.
  volunteerSignup:         ['getConfig'],

  // Member-row writes — members sheet only.
  saveMember:              ['getMembers'],
  deleteMember:            ['getMembers'],
  saveMemberCert:          ['getMembers'],
  savePreferences:         ['getMembers'],
  importMembers:           ['getMembers'],
  deactivateMembers:       ['getMembers'],
  // Password set / admin reset both flip the hashed-password fields that
  // feed getMembers' `hasPassword` flag, plus revoke sessions.
  setPassword:             ['getMembers', 'listSessions'],
  adminResetMemberPassword:['getMembers', 'listSessions'],
  // Google link state lives on the member record.
  linkGoogleAccount:       ['getMembers'],
  unlinkGoogleAccount:     ['getMembers'],

  // Trips.
  saveTrip:                ['getTrips'],
  deleteTrip:              ['getTrips'],
  setHelm:                 ['getTrips'],
  // respondConfirmation can mint a new crew-trip row AND clear a notification.
  respondConfirmation:     ['getTrips', 'getNotifications', 'getConfirmations'],
  createConfirmation:      ['getConfirmations', 'getNotifications'],
  requestVerification:     ['getConfirmations', 'getNotifications', 'getTrips'],
  requestValidation:       ['getConfirmations', 'getNotifications', 'getTrips'],
  // Maintenance — most also change notification counts (follower pings, etc.).
  saveMaintenance:         ['getMaintenance', 'getNotifications'],
  resolveMaintenance:      ['getMaintenance', 'getNotifications'],
  deleteMaintenance:       ['getMaintenance'],
  addMaintenanceComment:   ['getMaintenance', 'getNotifications'],
  adoptSaumaklubbur:       ['getMaintenance', 'getNotifications'],
  approveSaumaklubbur:     ['getMaintenance', 'getNotifications'],
  holdSaumaklubbur:        ['getMaintenance', 'getNotifications'],
  reassignMaintenance:     ['getMaintenance', 'getNotifications'],
  toggleMaterial:          ['getMaintenance', 'getNotifications'],
  addMaterial:             ['getMaintenance', 'getNotifications'],
  removeMaterial:          ['getMaintenance', 'getNotifications'],
  followProject:           ['getMaintenance', 'getNotifications'],
  unfollowProject:         ['getMaintenance', 'getNotifications'],
  // Notification-only.
  dismissConfirmation:     ['getNotifications', 'getConfirmations'],
  dismissAllConfirmations: ['getNotifications', 'getConfirmations'],
  markProjectSeen:         ['getNotifications'],
  // Session-state changes. Settings page re-fetches its "signed in on…" list.
  signOut:                 ['listSessions'],
  signOutAll:              ['listSessions'],
  // Handbook (admin-managed). Members + staff read via getHandbook.
  saveHandbookRole:    ['getHandbook'],
  deleteHandbookRole:  ['getHandbook'],
  reorderHandbookRoles:['getHandbook'],
  saveHandbookDoc:     ['getHandbook'],
  deleteHandbookDoc:   ['getHandbook'],
  syncHandbookDocs:    ['getHandbook'],
  saveHandbookInfo:     ['getHandbook'],
  deleteHandbookInfo:   ['getHandbook'],
  saveHandbookContact:  ['getHandbook'],
  deleteHandbookContact:['getHandbook'],
  // Crews + invites.
  createCrew:              ['getCrews', 'getCrewInvites'],
  disbandCrew:             ['getCrews', 'getCrewInvites'],
  inviteToCrew:            ['getCrews', 'getCrewInvites'],
  respondCrewInvite:       ['getCrews', 'getCrewInvites', 'getNotifications'],
  // Slot writes drop the per-week getSlots cache so navigation reflects
  // bookings immediately. bookSlot/unbookSlot also touch crew membership
  // (slot.bookedBy mirrors into the crew record), so getCrews / getCrewInvites
  // drop too.
  bookSlot:                ['getCrews', 'getCrewInvites', 'getSlots'],
  unbookSlot:              ['getCrews', 'getCrewInvites', 'getSlots'],
  bulkBookSlots:           ['getCrews', 'getCrewInvites', 'getSlots'],
  saveSlot:                ['getSlots'],
  deleteSlot:              ['getSlots'],
  saveRecurringSlots:      ['getSlots'],
  deleteRecurrenceGroup:   ['getSlots'],
};

async function apiPost(action, payload) {
  payload = payload || {};
  var invalidates = _INVALIDATES[action];
  if (invalidates) invalidates.forEach(_invalidateApiCache);
  return _call(action, payload);
}

// ── Prefetch helper ───────────────────────────────────────────────────────────
// Fires a batch of API calls in parallel and stashes each promise on window._early<Name>
// so page init can race them with its first render. Pages consume them as:
//   const [checkouts, config] = await Promise.all([
//     window._earlyCheckouts || apiGet('getActiveCheckouts'),
//     window._earlyConfig    || apiGet('getConfig'),
//   ]);
// Call forms:
//   prefetch({ Config: ['getConfig'], Trips: ['getTrips', { limit: 500 }] })
//   prefetch({ VolSignups: { post: 'getVolunteerSignups' } })   // POST action
// Key names become the _early<Name> suffix (e.g. Config → window._earlyConfig).
function prefetch(calls) {
  if (!calls) return;
  Object.keys(calls).forEach(function (name) {
    var key = '_early' + name;
    if (window[key]) return; // don't re-fire if page navigates back
    var spec = calls[name];
    if (Array.isArray(spec)) {
      window[key] = apiGet(spec[0], spec[1] || {});
    } else if (spec && spec.post) {
      window[key] = apiPost(spec.post, spec.payload || {});
    } else if (typeof spec === 'string') {
      window[key] = apiGet(spec);
    }
  });
}

async function _call(action, payload) {
  payload = payload || {};
  // Public actions are exempt from session auth; loginMember is where we
  // obtain the token in the first place. For everything else, attach the
  // caller's session token so the backend can identify them.
  var PUBLIC_ACTIONS = { loginMember: 1, loginWithGoogle: 1, dashboard: 1, lookup: 1, captain: 1, boat: 1 };
  var envelope = { action: action };
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
  // 60s client abort: most calls return in <2s, but PBKDF2-gated actions
  // (loginMember runs one, setPassword runs two) can each take ~5-8s on
  // Apps Script, and any further sheet I/O after the HMAC loop adds on
  // top. A shorter bound aborts the fetch while the server is still
  // persisting, which has the confusing effect of failing the UI even
  // though the write already landed.
  var timer = ctrl ? setTimeout(function() { ctrl.abort(); }, 60000) : null;
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
  if (typeof window === 'undefined' || !window.location ||
      window.location.pathname.indexOf('/login/') >= 0) return;
  // Show a toast so the user understands why they're about to bounce back
  // to login. Falls back to immediate redirect if ui.js hasn't loaded yet
  // (toast helper is in shared/ui.js; not every page includes it).
  var msg = (typeof s === 'function') ? s('toast.sessionExpired') : 'Your session expired.';
  if (typeof window.showToast === 'function') {
    try { window.showToast(msg, 'warn', 2000); } catch(e) {}
    setTimeout(function () { window.location.href = BASE_URL + '/login/'; }, 1500);
  } else {
    window.location.href = BASE_URL + '/login/';
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
  // Guardians have no member hub of their own. Bounce them to the guardian
  // landing page for any destination other than /guardian/ or /settings/,
  // except when they've already been switched into a ward's session (in
  // which case they're acting as a member and guardianSession is set).
  if (u.role === 'guardian' && !u.guardianSession) {
    var path = (typeof window !== 'undefined' && window.location &&
                window.location.pathname) || '';
    if (path.indexOf('/guardian/') < 0 && path.indexOf('/settings/') < 0) {
      window.location.href = BASE_URL + "/guardian/";
      return null;
    }
  }
  if (roleFn && !roleFn(u)) { window.location.href = BASE_URL + "/login/"; return null; }
  return u;
}

function isStaff(u) { return u && (u.role === "staff" || u.role === "admin"); }
function isAdmin(u) { return u && u.role === "admin"; }
function isGuardian(u) { return u && u.role === "guardian"; }
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
    // Non-member guardians land on the guardian page (they have no member
    // hub); member-guardians keep going to the member hub as before.
    window.location.href = BASE_URL +
      (data.member.role === 'guardian' ? "/guardian/" : "/member/");
  } catch(e) {
    // Fall back to a clean sign-out on any failure so the guardian can re-enter.
    signOut();
  }
}

function getLang()  { return localStorage.getItem("ymirLang") || "IS"; }
function setLang(l) { localStorage.setItem("ymirLang", l); }

// ── Theme ─────────────────────────────────────────────────────────────────────
function getTheme()  { return localStorage.getItem("ymirTheme") || "light"; }
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
  var forceLbl = (typeof s === 'function') ? s('wx.force') : 'Force';
  // Handle range values like "5.5-8.0" (from Beaufort-only entry)
  if (typeof ms === 'string' && ms.indexOf('-') !== -1) {
    var parts = ms.split('-').map(Number);
    if (unit === 'bft') {
      var b = beaufort != null ? beaufort : bftFromMs(parts[0]);
      return b != null ? forceLbl + ' ' + b : '';
    }
    return convertWind(parts[0], unit) + '–' + convertWind(parts[1], unit) + ' ' + windUnitLabel(unit);
  }
  if (unit === 'bft') {
    var b = beaufort != null ? beaufort : (ms != null ? bftFromMs(ms) : null);
    return b != null ? forceLbl + ' ' + b : '';
  }
  if (ms != null) return convertWind(ms, unit) + ' ' + windUnitLabel(unit);
  return beaufort != null ? forceLbl + ' ' + beaufort : '';
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

// Local-date YYYY-MM-DD (vs. toISOString which is UTC and drifts across
// midnight for non-UTC timezones). Use this for anything the user perceives
// as "today" in their own timezone — trip dates, checkout dates, filenames.
window.toLocalISODate = function(d) {
  d = d || new Date();
  return d.getFullYear() + '-'
       + String(d.getMonth() + 1).padStart(2, '0') + '-'
       + String(d.getDate()).padStart(2, '0');
};

function fmtTimeNow() {
  var d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fmtDateNow() { return window.toLocalISODate(); }

// Overdue check that handles overnight checkouts (e.g. out 21:00, return 03:00):
// when retBy is earlier than tout, return is the next day — only overdue once the wall
// clock has rolled past midnight (now < tout) and past retBy. All args are "HH:MM" strings.
function isCheckoutOverdue(retBy, tout, nowStr) {
  if (!retBy) return false;
  nowStr = nowStr || fmtTimeNow();
  if (!tout) return retBy < nowStr;
  if (retBy < tout) return nowStr < tout && nowStr > retBy;
  return nowStr > retBy;
}

// Coerce legacy time values into canonical HH:MM so <input type="time"> accepts
// them on load. Handles "1700" / "0900" / "9:00" / "17.00" plus Sheets serial
// fractions (0.7083 → 17:00). Returns '' for unrecognized input so the field
// stays empty rather than showing junk. Used everywhere a stored time value
// might predate the type="time" rollout.
function coerceHHMM(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    var frac = v - Math.floor(v);
    if (frac < 0) frac += 1;
    var totalMin = Math.round(frac * 1440);
    if (totalMin === 1440) totalMin = 0;
    var h = Math.floor(totalMin / 60), m = totalMin % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  var s = String(v).trim().replace(/\./g, ':');
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    var p = s.split(':');
    return (p[0].length === 1 ? '0' + p[0] : p[0]) + ':' + p[1];
  }
  if (/^\d{4}$/.test(s)) return s.slice(0, 2) + ':' + s.slice(2);
  if (/^\d{3}$/.test(s)) return '0' + s.charAt(0) + ':' + s.slice(1);
  return '';
}

// Shared primitives - single source of truth
window.boolVal = function(v) {
  return v === true || v === "TRUE" || v === "true" || v === 1 || v === "1";
};

window.parseJson = function(v, fallback) {
  try { return v ? (typeof v === "string" ? JSON.parse(v) : v) : fallback; }
  catch(e) { return fallback; }
};

window.todayISO = function() {
  return window.toLocalISODate();
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
