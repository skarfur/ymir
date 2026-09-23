// YMIR - shared/api.js

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxDOdwZGy2gDt99PEENSk6D3xTC8KQHdOICRIDEFd0VDB1eCMmA1hJ3-iJJ1Q8PDuqh/exec";
const BASE_URL   = "https://skarfur.github.io/ymir";
// Google Identity Services OAuth 2.0 Client ID (public by design). Leave
// empty to disable one-tap sign-in client-side; backend also refuses to
// verify tokens unless the GOOGLE_CLIENT_ID script property is set.
const GOOGLE_CLIENT_ID = "231967339479-m1fqbqk134sjtt2o4nloljfle7l7hk7b.apps.googleusercontent.com";

// Supabase (ymir-staging) — migration in progress. All read actions are
// wired (see _SUPABASE_ACTIONS below); most writes now go straight to
// Postgres RPC / PostgREST at their call sites instead of an Edge Function.
// The anon key is safe to expose client-side by design
// (same as GOOGLE_CLIENT_ID above): RLS + revoked table grants are what
// actually gate access, not secrecy of this key. See CLAUDE.md once the
// Supabase side has its own documented section.
const SUPABASE_URL = "https://jilmxhonqhbvieyknyen.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppbG14aG9ucWhidmlleWtueWVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3NTU1MzIsImV4cCI6MjEwNTMzMTUzMn0.7zMcRKdZTAiNMbNukyq5-i5Ofqp_p_GhziYNmrt9fhQ";

async function callSupabaseFunction(name, payload) {
  const resp = await fetch(SUPABASE_URL + '/functions/v1/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify(payload || {}),
  });
  const data = await resp.json().catch(function () { return {}; });
  if (!resp.ok) {
    const err = new Error(data.error || ('Supabase function error ' + resp.status));
    err.status = resp.status;
    err.code = resp.status; // mirrors _callDirect's err.code convention (e.g. e.code === 429 checks)
    throw err;
  }
  return data;
}

// ── PostgREST direct access (RLS + RPC rearchitecture) ──────────────────────
// See /root/.claude/plans/glistening-soaring-fairy.md. Bypasses Edge
// Functions entirely: table reads/writes go straight to PostgREST, gated
// by RLS policies reading the caller's self-signed JWT (accessToken,
// minted by login/refresh-session — see _getAccessToken below). RPC calls
// hit Postgres functions (supabase.rpc equivalent) the same way, for
// anything transactional that can't be a safe plain RLS-gated table op.
//
// `accessToken` is an explicit override, not just a convenience: some
// callers (e.g. the login-page migration diagnostic) need to exercise a
// freshly-minted token without writing it into the shared session store,
// since the stored session is still what every Apps-Script-routed action
// reads — clobbering it here would break every other page's calls.
async function callPostgrestTable(table, opts) {
  opts = opts || {};
  const token = opts.accessToken || _getAccessToken();
  const headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  const resp = await fetch(SUPABASE_URL + '/rest/v1/' + table + (opts.query || ''), {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await resp.json().catch(function () { return null; });
  if (!resp.ok) {
    const err = new Error((data && (data.message || data.error)) || ('PostgREST error ' + resp.status));
    err.status = resp.status;
    err.code = resp.status;
    throw err;
  }
  return data;
}

async function callSupabaseRpc(fnName, payload, accessToken) {
  const token = accessToken || _getAccessToken();
  const headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload || {}),
  });
  const data = await resp.json().catch(function () { return null; });
  if (!resp.ok) {
    const err = new Error((data && (data.message || data.error)) || ('RPC error ' + resp.status));
    err.status = resp.status;
    err.code = resp.status;
    throw err;
  }
  return data;
}

// PostgREST returns raw snake_case column names; callers that used to get
// camelCase DTOs from an Edge Function (or Apps Script) need this at the
// call site. Shallow by design — nested jsonb columns (e.g. `categories`)
// keep their own shape rather than being recursively rewritten.
function _camelizeKeys(row) {
  if (!row || typeof row !== 'object') return row;
  var out = {};
  Object.keys(row).forEach(function (k) {
    var ck = k.replace(/_([a-z0-9])/g, function (_, c) { return c.toUpperCase(); });
    out[ck] = row[k];
  });
  return out;
}

async function apiGet(action, params) {
  params = params || {};
  // Cache key now includes a serialized params suffix so the same action with
  // different params (e.g. getSlots for adjacent weeks) doesn't clobber the
  // single-entry cache. apiPost invalidates by prefix scan so all entries
  // for an action drop together.
  var _CACHEABLE = { getConfig: 120000, getWeather: 300000, getMembers: 30000, getTrips: 30000, getMaintenance: 30000, getCrews: 30000, getCrewBoard: 30000, getCrewInvites: 30000, getNotifications: 30000, getConfirmations: 30000, getHandbook: 600000, getSlots: 60000, getDailyLog: 60000 };
  if (_CACHEABLE[action] && !params._fresh) {
    try {
      var _ck = 'ymir_' + action + '_' + JSON.stringify(params);
      var _ttl = _CACHEABLE[action];
      var _hit = _readCacheEntry(_ck);
      if (_hit) {
        var _age = Date.now() - _hit.ts;
        // Fresh: serve cached, no network call.
        if (_age < _ttl) return _hit.data;
        // Stale-while-revalidate: serve cached up to one extra TTL window
        // (i.e. total servable age = 2*TTL) and kick off a background refresh.
        // Bounds staleness while letting the user paint instantly on most
        // navigations after a brief idle.
        if (_age < _ttl * 2) {
          _refreshInBackground(_ck, action, params);
          return _hit.data;
        }
      }
      // Hard miss (or beyond stale window): block on the fetch, dedup
      // concurrent identical requests via the inflight map.
      if (apiGet._inflight[_ck]) return apiGet._inflight[_ck];
      var _p = _fetchAndCache(_ck, action, params);
      apiGet._inflight[_ck] = _p;
      return _p;
    } catch(e) { /* fall through */ }
  }
  return _call(action, params);
}
apiGet._inflight = {};
apiGet._memCache = {};

// Look up a cache entry — memory tier first, then sessionStorage, then
// localStorage (for actions promoted via _PERSIST_TIER). Returns the raw
// `{ts, data}` envelope, or null. Callers decide what to do with the age.
// Reading both storages (rather than the action's "correct" tier) is cheap
// and forgiving: it tolerates pre-existing entries from before a tier flip
// and never serves a wrong-tier hit because the data shape is identical.
function _readCacheEntry(ck) {
  var mc = apiGet._memCache[ck];
  if (mc) return mc;
  try {
    var s = sessionStorage.getItem(ck) || localStorage.getItem(ck);
    if (!s) return null;
    var parsed = JSON.parse(s);
    apiGet._memCache[ck] = parsed; // promote so the next hit skips parse
    return parsed;
  } catch(e) { return null; }
}

// Reads that are global, large, and rarely changed get promoted from
// sessionStorage to localStorage so they survive tab closure + browser
// restart. Cross-tab invalidation flows through the `storage` listener at
// the bottom; same-tab invalidation flows through _invalidateApiCache,
// which drops both tiers regardless of where the entry actually lives.
//   getConfig:  ~150 KB uncompressed, admin-only writes, every portal needs it
//   getHandbook: similarly large, similarly stable
var _PERSIST_TIER = { getConfig: 'local', getHandbook: 'local' };

function _storageFor(action) {
  return _PERSIST_TIER[action] === 'local' ? localStorage : sessionStorage;
}

// Single source of truth for "stash this entry under both tiers correctly".
// Called by the fetch path, SWR background refresh, and seedApiCache.
function _writeCacheEntry(ck, action, entry) {
  apiGet._memCache[ck] = entry;
  try { _storageFor(action).setItem(ck, JSON.stringify(entry)); } catch(e) {}
}

// Single source of truth for "fetch, cache, clear inflight". Used by both
// the blocking miss path and the SWR background refresh. `opts` is passed
// straight through to `_call` — the SWR path uses it to mark its refresh
// silent (see _refreshInBackground below); the blocking miss path leaves
// it unset so a real 401 there still bounces to login as normal.
function _fetchAndCache(ck, action, params, opts) {
  return (async function () {
    try {
      var data = await _call(action, params, opts);
      _writeCacheEntry(ck, action, { ts: Date.now(), data: data });
      return data;
    } finally {
      delete apiGet._inflight[ck];
    }
  })();
}

// SWR helper — kicks off a refresh without blocking the caller. Dedup against
// the inflight map (a foreground miss already in flight covers us). Errors are
// swallowed: the user already has stale data; failing the refresh shouldn't
// surface as an unhandled rejection — and, same as warmContainer's background
// warm, it must never force a logout via _handleUnauthorized: the user never
// asked for this network call, so a transient/expired-session 401 here should
// just leave the stale cached data in place, not yank them back to /login/.
function _refreshInBackground(ck, action, params) {
  if (apiGet._inflight[ck]) return;
  var p = _fetchAndCache(ck, action, params, { silent: true });
  apiGet._inflight[ck] = p;
  p.catch(function () {});
}

// Public: seed the cache for an action+params with a server-supplied payload
// so the next apiGet/apiPost is a hit. Used by the login response piggyback
// (loginMember bundles a getConfig snapshot to skip the post-redirect round
// trip), and available to any flow that already has fresh data in hand —
// websocket push, server-rendered hydration, etc. Same key shape as apiGet
// so _invalidateApiCache drops it on the next write.
function seedApiCache(action, params, data) {
  if (!action || data == null) return;
  try {
    var ck = 'ymir_' + action + '_' + JSON.stringify(params || {});
    _writeCacheEntry(ck, action, { ts: Date.now(), data: data });
  } catch (e) {}
}

// Drop every cached entry (memory + sessionStorage + localStorage) for the
// given action. Called by apiPost after a write so the next read sees fresh
// data. All three tiers share the `ymir_<action>_<paramsJSON>` key shape.
// localStorage removals fire `storage` events in sibling tabs, which the
// listener at the bottom of this file uses for cross-tab cache eviction.
function _invalidateApiCache(action) {
  var prefix = 'ymir_' + action + '_';
  var stores = [sessionStorage, localStorage];
  for (var s = 0; s < stores.length; s++) {
    try {
      var store = stores[s];
      for (var i = store.length - 1; i >= 0; i--) {
        var k = store.key(i);
        if (k && k.indexOf(prefix) === 0) store.removeItem(k);
      }
    } catch(e) {}
  }
  if (apiGet._memCache) {
    var keys = Object.keys(apiGet._memCache);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].indexOf(prefix) === 0) delete apiGet._memCache[keys[j]];
    }
  }
}

// Cross-tab invalidation. The `storage` event fires in OTHER tabs whenever
// a localStorage key changes (writes and removes both); it never fires in
// the tab that made the change, so same-tab invalidation continues to flow
// through _invalidateApiCache directly. We just drop our matching in-memory
// entry — the next read falls through to localStorage and picks up the
// sibling tab's fresh value (or a network call if it was a removal).
try {
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', function (e) {
      if (!e || !e.key || e.key.indexOf('ymir_') !== 0) return;
      delete apiGet._memCache[e.key];
    });
  }
} catch (e) {}
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
//     rowingPassport, clubCalendars) PLUS activities projection
//     (volunteerEvents, cancelledActivityOccurrences). Independent of
//     the members sheet entirely.
//   getMembers — members sheet only.
var _INVALIDATES = {
  // Config writes — config-sheet only; member rows untouched.
  // saveConfig itself stays routed here — boats/locations writes still go
  // through it (see the config_rpcs.sql migration note on that gap).
  saveConfig:              ['getConfig'],
  // saveActivityType/deleteActivityType/saveChecklistItem/
  // deleteChecklistItem/saveCertDef/deleteCertDef/saveCertCategories/
  // saveFlagOverride/saveStaffStatus/saveBoatAccess/saveBoatOos/
  // saveReservation/removeReservation go straight to Postgres RPC now (see
  // admin/checklists.js, admin/certs.js, staff/staff.js, captain/captain.js,
  // admin/boats.js, shared/maintenance.js) and invalidate via
  // _invalidateApiCache directly.
  saveRowingPassportDef:   ['getConfig'],
  importRowingPassportCsv: ['getConfig'],
  signPassportItem:        ['getRowingPassport'],
  revokePassportSignoff:   ['getRowingPassport'],
  // cancelClassOccurrence/restoreClassOccurrence go straight to Postgres RPC
  // now (see admin/scheduling.js) and invalidate getConfig via
  // _invalidateApiCache directly, bypassing apiPost — no entry needed here.
  // overrideClassOccurrence (one-shot time reschedule) stays unrouted:
  // admin/scheduling.js's own comment says the frontend never surfaces it,
  // so there's no live caller to rewire.
  // Volunteer events live in the activities sheet (read by getConfig).
  // deleteVolunteerEvent cascades to volunteerSignups rows for the event,
  // so it also drops the cached signups.
  saveVolunteerEvent:      ['getConfig'],
  deleteVolunteerEvent:    ['getConfig', 'getVolunteerSignups'],
  syncVolunteerEvents:     ['getConfig'],
  // Volunteer signups: the volunteerSignups sheet itself is read via
  // apiPost('getVolunteerSignups'), now in _POST_CACHEABLE. Both writes
  // drop that cache. volunteerSignup_ also keeps getConfig because the
  // first signup against a virtual recurring event materializes a
  // the activities-sheet row that feeds getConfig.volunteerEvents.
  volunteerSignup:         ['getConfig', 'getVolunteerSignups'],
  volunteerWithdraw:       ['getVolunteerSignups'],

  // Member-row writes — members sheet only.
  // saveMemberCert/savePreferences/saveCertCategories/saveCaptainBio/
  // validateMember go straight to Postgres RPC now (see shared/mcm.js,
  // captain/captain.js, settings/settings.js, guardian/guardian.js) and
  // invalidate via _invalidateApiCache directly.
  // saveMember/deleteMember/importMembers/deactivateMembers go straight to
  // Postgres RPC / PostgREST (see admin/members.js, admin/import.js) and
  // invalidate via _invalidateApiCache directly, bypassing apiPost — no
  // entry needed here.
  // setPassword/adminResetMemberPassword go straight to Postgres RPC (see
  // settings/settings.js, admin/members.js) and invalidate via
  // _invalidateApiCache directly, bypassing apiPost — no entry needed here.
  // Google link state lives on the member record.
  linkGoogleAccount:       ['getMembers'],
  unlinkGoogleAccount:     ['getMembers'],

  // Daily log: writes activity rows into the activities sheet, which the staff
  // Logbook Review activity-log section reads via getActivityLog. Activities
  // can also carry linkedGroupCheckoutIds → trip group labels resolve through
  // those, so dropping getTrips keeps the trip-detail Activity row fresh.
  // getDailyLog is cached per-date so the just-saved day reads back fresh.
  saveDailyLog:            ['getDailyLog', 'getActivityLog', 'getTrips'],
  // saveTrip/deleteTrip/setHelm/saveCheckout/checkIn/deleteCheckout/
  // saveGroupCheckout/groupCheckIn go straight to Postgres RPC now (see
  // member/member.js, staff/staff.js, shared/logbook-*.js)
  // and invalidate via _invalidateApiCache directly where needed.
  // respondConfirmation can mint a new crew-trip row AND clear a notification.
  respondConfirmation:     ['getTrips', 'getNotifications', 'getConfirmations'],
  createConfirmation:      ['getConfirmations', 'getNotifications'],
  requestVerification:     ['getConfirmations', 'getNotifications', 'getTrips'],
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
  // createIncident/resolveIncident/addIncidentNote go straight to
  // Postgres RPC / PostgREST now (see incidents/incidents.js,
  // member/member.js) and invalidate via _invalidateApiCache directly.
  // Payroll — punch clock + employee records.
  clockIn:                 ['getTimeEntries'],
  clockOut:                ['getTimeEntries'],
  breakStart:              ['getTimeEntries'],
  breakEnd:                ['getTimeEntries'],
  adminEditTime:           ['getTimeEntries'],
  adminAddTime:            ['getTimeEntries'],
  // adminDeleteTime/saveEmployee go straight to PostgREST (see
  // admin/payroll/payroll.js) and invalidate via _invalidateApiCache
  // directly, bypassing apiPost — no entry needed here.
  // Notification-only.
  dismissConfirmation:     ['getNotifications', 'getConfirmations'],
  dismissAllConfirmations: ['getNotifications', 'getConfirmations'],
  markProjectSeen:         ['getNotifications'],
  // Session-state changes. signOut/signOutAll/listSessions/setPassword go
  // straight to Postgres RPC now (see shared/api.js's signOut(),
  // settings/settings.js, login/login.js) and invalidate/re-fetch directly.
  // Handbook (admin-managed). Members + staff read via getHandbook.
  // saveHandbookRole/deleteHandbookRole/reorderHandbookRoles/
  // saveHandbookDoc/deleteHandbookDoc/saveHandbookInfo/deleteHandbookInfo/
  // saveHandbookContact/deleteHandbookContact go straight to Postgres RPC
  // now (see admin/handbook.js's _hbSave/_hbDelete) and invalidate via
  // _invalidateApiCache directly. syncHandbookDocs/uploadHandbookDoc stay
  // Apps-Script-routed — genuine Drive-API needs.
  syncHandbookDocs:    ['getHandbook'],
  // Crews + invites + reservation slots (createCrew/updateCrew/disbandCrew/
  // joinCrew/leaveCrew/inviteToCrew/respondCrewInvite/saveSlot/
  // saveRecurringSlots/deleteSlot/deleteRecurrenceGroup/bookSlot/
  // unbookSlot/bulkBookSlots) go straight to Postgres RPC now (see
  // captain/captain.js, coxswain/coxswain.js, admin/calendars.js) and
  // invalidate via _invalidateApiCache directly.
};

// Read-shaped POSTs: actions that go through apiPost (typically because
// they take a payload-bound caller identity like kennitala) but are pure
// reads with no side effects. Opt in here to share the same memory +
// sessionStorage cache as apiGet — keys use the same
// `ymir_<action>_<paramsJSON>` shape so _invalidateApiCache drops both
// kinds in one prefix scan, and the prefetch helper's `{ post: ... }`
// form populates the cache transparently.
var _POST_CACHEABLE = {
  getVolunteerSignups: 30000,
  // Staff Logbook Review activity-log section. Read-shaped POST that takes a
  // date range; cached per-range thanks to the params-suffixed cache key.
  getActivityLog:      30000,
};

async function apiPost(action, payload) {
  payload = payload || {};
  if (_POST_CACHEABLE[action] && !payload._fresh) {
    try {
      var _ck = 'ymir_' + action + '_' + JSON.stringify(payload);
      var _ttl = _POST_CACHEABLE[action];
      var _hit = _readCacheEntry(_ck);
      if (_hit) {
        var _age = Date.now() - _hit.ts;
        if (_age < _ttl) return _hit.data;
        if (_age < _ttl * 2) {
          _refreshInBackground(_ck, action, payload);
          return _hit.data;
        }
      }
      if (apiGet._inflight[_ck]) return apiGet._inflight[_ck];
      var _p = _fetchAndCache(_ck, action, payload);
      apiGet._inflight[_ck] = _p;
      return _p;
    } catch(e) { /* fall through to plain _call */ }
  }
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

// Public actions are exempt from session auth; loginMember is where we
// obtain the token in the first place. For everything else, attach the
// caller's session token so the backend can identify them.
var _PUBLIC_ACTIONS = { loginMember: 1, loginWithGoogle: 1, dashboard: 1, lookup: 1, captain: 1, boat: 1 };

// Side-effect-free actions that are safe to retry when the Apps Script
// content host (script.googleusercontent.com/macros/echo) intermittently
// 404s on the redirect hop — the server-side handler has already run by
// that point, so a blind retry of a write would double-execute. `batch`
// is retried only when every sub-request is itself idempotent.
function _isIdempotent(action, payload) {
  if (!action) return false;
  if (action === 'batch') {
    var reqs = payload && payload.requests;
    if (!Array.isArray(reqs) || reqs.length === 0) return false;
    return reqs.every(function (r) { return r && _isIdempotent(r.action); });
  }
  if (/^get/i.test(action)) return true;
  return action === 'validateMember' || action === 'listSessions' ||
         action === 'lookup' || action === 'dashboard' ||
         action === 'captain' || action === 'boat';
}

// ── Request batching ─────────────────────────────────────────────────────────
// Apps Script web-app calls have a fat fixed cost per request (HTTPS handshake,
// 302 redirect to the user-content host, V8 spin-up, sheet warmup) that
// dominates handler runtime. When a page fires N apiGet/apiPost calls in the
// same tick (member init = 4, captain = 6, coxswain = 6), we coalesce them
// into one HTTP round-trip via the backend `batch` action.
//
// Bypass list — these go straight to _callDirect:
//   * PUBLIC_ACTIONS — login, public dashboard, etc. The backend `batch`
//     handler refuses these (they have no session caller).
//   * 'batch' itself — would recurse.
//
// Flush timing: a microtask runs at end of the current sync tick, so
// Promise.all([apiGet(a), apiGet(b)]) enqueues both before the flush. A
// solo call falls through to _callDirect with no extra hop.
var _batchQueue = [];
var _batchScheduled = false;

// ── Supabase migration routing ───────────────────────────────────────────────
// Actions ported to Edge Functions get routed here instead of through Apps
// Script's batch/direct dispatch. Everything NOT listed here falls straight
// through to the existing Apps Script path below, untouched — callers
// (doLogin, proceedWithUser, etc.) don't need to know or care which backend
// actually served a given action. Keys are the Apps Script action names
// already used throughout the app; values are the Supabase function slug.
var _SUPABASE_ACTIONS = {
  loginMember:        'login',
  validateWard:       'validate-ward',
  getConfig:          'get-config',
  getHandbook:        'handbook',
  getWeather:         'weather',
  getActiveCheckouts: 'get-active-checkouts',
  getSlots:           'get-slots',
  getCrews:           'get-crews',
  getNotifications:   'get-notifications',
  getMaintenance:     'get-maintenance',
  getVolunteerSignups: 'get-volunteer-signups',
  getMembers:         'get-members',
  getRowingPassport:  'get-rowing-passport',
  getEmployees:       'get-employees',
  getTrips:           'get-trips',
  getConfirmations:   'get-confirmations',
  getVerificationRequests: 'get-verification-requests',
  // captain/captain.js's init-load bundle: one call standing in for
  // getConfig+getMaintenance+getTrips+getConfirmations+
  // getVerificationRequests+getMembers (see get-captain-bundle's header).
  // Not cached itself — captain.js seeds each of those six actions'
  // individual cache slots from the response instead.
  getCaptainBundle:   'get-captain-bundle',
  getIncidents:       'get-incidents',
  getActivityLog:     'get-activity-log',
  getCrewBoard:       'get-crew-board',
  getCrewInvites:     'get-crew-invites',
  getDailyLog:        'get-daily-log',
  // saveCheckout/checkIn/deleteCheckout/saveGroupCheckout/groupCheckIn/
  // saveBoatOos/saveBoatAccess/saveReservation/removeReservation: admin-or-
  // self / staff-or-admin RLS gate + Postgres RPC (see member/member.js,
  // staff/staff.js, captain/captain.js, admin/boats.js,
  // shared/maintenance.js) — no Edge Function.
  // saveTrip/deleteTrip/setHelm: session-only RLS gate + Postgres RPC (see
  // member/member.js, staff/staff.js, shared/logbook-*.js) — no Edge
  // Function.
  createConfirmation:      'create-confirmation',
  respondConfirmation:     'respond-confirmation',
  requestVerification:     'request-verification',
  dismissConfirmation:     'dismiss-confirmation',
  dismissAllConfirmations: 'dismiss-all-confirmations',
  // createCrew/updateCrew/disbandCrew/joinCrew/leaveCrew/inviteToCrew/
  // respondCrewInvite/saveSlot/saveRecurringSlots/deleteSlot/
  // deleteRecurrenceGroup/bookSlot/unbookSlot/bulkBookSlots: session-only
  // RLS gate + Postgres RPC (see captain/captain.js, coxswain/coxswain.js,
  // admin/calendars.js) — no Edge Function.
  saveMaintenance:       'save-maintenance',
  resolveMaintenance:    'resolve-maintenance',
  deleteMaintenance:     'delete-maintenance',
  addMaintenanceComment: 'add-maintenance-comment',
  toggleMaterial:        'toggle-material',
  addMaterial:           'add-material',
  removeMaterial:        'remove-material',
  approveSaumaklubbur:   'approve-saumaklubbur',
  adoptSaumaklubbur:     'adopt-saumaklubbur',
  holdSaumaklubbur:      'hold-saumaklubbur',
  reassignMaintenance:   'reassign-maintenance',
  followProject:         'follow-project',
  unfollowProject:       'unfollow-project',
  markProjectSeen:       'mark-project-seen',
  saveDailyLog:          'save-daily-log',
  // createIncident/addIncidentNote: RPC. resolveIncident: staff-only RLS
  // + direct PostgREST (see incidents/incidents.js) — no Edge Function.
  saveVolunteerEvent:    'save-volunteer-event',
  deleteVolunteerEvent:  'delete-volunteer-event',
  volunteerSignup:       'volunteer-signup',
  volunteerWithdraw:     'volunteer-withdraw',
  syncVolunteerEvents:   'sync-volunteer-events',
  // saveHandbookRole/deleteHandbookRole/reorderHandbookRoles/
  // saveHandbookContact/deleteHandbookContact/saveHandbookDoc/
  // deleteHandbookDoc/saveHandbookInfo/deleteHandbookInfo: admin-only RLS
  // + Postgres RPC (see admin/handbook.js) — no Edge Function.
  signPassportItem:      'sign-passport-item',
  revokePassportSignoff: 'revoke-passport-signoff',
  saveRowingPassportDef: 'save-rowing-passport-def',
  importRowingPassportCsv: 'import-rowing-passport-csv',
  clockIn:               'clock-in',
  clockOut:               'clock-out',
  breakStart:             'break-start',
  breakEnd:               'break-end',
  getTimeEntries:         'get-time-entries',
  adminEditTime:          'admin-edit-time',
  adminAddTime:            'admin-add-time',
  // adminDeleteTime/saveEmployee: admin-only RLS + direct PostgREST (see
  // admin/payroll/payroll.js) — no Edge Function.
  // save_activity_type/delete_activity_type stay direct RPC calls (so
  // is_admin() sees the real caller via the request's own JWT) — this is
  // the Google Calendar push those Postgres RPCs can't do themselves.
  // admin/act-types.js calls it as an independent best-effort step after
  // the RPC write succeeds.
  syncActivityTypeCalendar: 'sync-activity-type-calendar',
  // Google sign-in — login-with-google is public (verify_jwt disabled,
  // listed in _PUBLIC_ACTIONS above); link/unlink require an existing
  // session, same auth pattern as every other write below.
  loginWithGoogle:    'login-with-google',
  linkGoogleAccount:  'link-google-account',
  unlinkGoogleAccount: 'unlink-google-account',
};

async function _callSupabase(action, payload, opts) {
  var body = Object.assign({}, payload);
  if (action !== 'loginMember') {
    var t = _getSessionToken();
    if (t) body.sessionToken = t;
  }
  try {
    return await callSupabaseFunction(_SUPABASE_ACTIONS[action], body);
  } catch (e) {
    // Mirrors _callDirect's 401 -> bounce-to-login behavior so an expired
    // Supabase session doesn't leave the user stuck on a broken page.
    // Skipped for opts.silent callers (e.g. warmContainer's background
    // cache warm) — a best-effort prefetch that's explicitly written to
    // fail silently (its own .catch is a no-op) should never be able to
    // force a disruptive logout on the user's behalf.
    var onLoginPage = (typeof window !== 'undefined' && window.location &&
      window.location.pathname.indexOf('/login/') >= 0);
    if (e && e.code === 401 && action !== 'loginMember' && !onLoginPage && !(opts && opts.silent)) {
      _handleUnauthorized();
    }
    throw e;
  }
}

function _call(action, payload, opts) {
  if (_SUPABASE_ACTIONS[action]) {
    return _callSupabase(action, payload, opts);
  }
  if (_PUBLIC_ACTIONS[action] || action === 'batch') {
    return _callDirect(action, payload);
  }
  return new Promise(function (resolve, reject) {
    _batchQueue.push({ action: action, payload: payload || {}, resolve: resolve, reject: reject });
    if (!_batchScheduled) {
      _batchScheduled = true;
      Promise.resolve().then(_flushBatch);
    }
  });
}

function _flushBatch() {
  _batchScheduled = false;
  var queue = _batchQueue;
  _batchQueue = [];
  if (queue.length === 0) return;
  // Solo call: skip the batch wrapper entirely so single-shot apiPosts pay
  // no overhead.
  if (queue.length === 1) {
    var one = queue[0];
    _callDirect(one.action, one.payload).then(one.resolve, one.reject);
    return;
  }
  // Backend caps at 25; chunk anything larger into separate batch calls.
  var BATCH_LIMIT = 25;
  if (queue.length > BATCH_LIMIT) {
    for (var i = 0; i < queue.length; i += BATCH_LIMIT) {
      _dispatchBatch(queue.slice(i, i + BATCH_LIMIT));
    }
    return;
  }
  _dispatchBatch(queue);
}

function _dispatchBatch(queue) {
  var requests = queue.map(function (e) { return { action: e.action, params: e.payload }; });
  _callDirect('batch', { requests: requests }).then(function (data) {
    var results = (data && data.results) || [];
    queue.forEach(function (e, i) {
      var r = results[i];
      if (!r) {
        e.reject(new Error(e.action + ': missing batch result'));
        return;
      }
      if (r.success === false) {
        var err = new Error(r.error || (e.action + ' failed'));
        err.code = r.code;
        e.reject(err);
        return;
      }
      e.resolve(r);
    });
  }, function (err) {
    // Whole-batch failure (network, 401, server error): reject every queued
    // caller so awaits don't hang forever.
    queue.forEach(function (e) { e.reject(err); });
  });
}

async function _callDirect(action, payload) {
  payload = payload || {};
  var envelope = { action: action };
  if (!_PUBLIC_ACTIONS[action]) {
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
    var attempt = 0;
    for (;;) {
      var res = await fetch(SCRIPT_URL, {
        method:   "POST",
        redirect: "follow",
        headers:  { "Content-Type": "text/plain" },
        body:     body,
        signal:   ctrl ? ctrl.signal : undefined,
      });
      // Apps Script's content host (script.googleusercontent.com/macros/echo)
      // intermittently 404s the second hop of a successful POST: doPost has
      // already run, but the rendered output briefly isn't servable. One
      // short-backoff retry clears it for reads. Writes are NOT retried —
      // the server-side mutation has already landed.
      if (res.status === 404 && attempt === 0 && _isIdempotent(action, payload)) {
        attempt++;
        await new Promise(function (r) { setTimeout(r, 400); });
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      if (!data.success) {
        // NOTE: a 401 here does NOT mean the user's real session is invalid.
        // loginMember is fully Supabase-routed now (see _SUPABASE_ACTIONS) —
        // no login flow writes a row into the Apps Script sessions sheet
        // anymore, so authCaller_ in code.gs can never resolve a caller and
        // every remaining GAS-routed action 401s unconditionally, regardless
        // of how valid the caller's actual (Supabase) session is. Treating
        // that as "log the user out" was bouncing people to /login/ just for
        // clicking a button whose action hasn't been ported to Supabase yet
        // — a real, reported bug. Only _callSupabase's 401 (tied to the
        // live Supabase session via the JWT/opaque token) should trigger
        // _handleUnauthorized; a GAS 401 just surfaces as a normal error for
        // that one action. Revisit once every action is off SCRIPT_URL.
        var err = new Error(data.error || action + " failed");
        err.code = data.code;
        throw err;
      }
      return data;
    }
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
// The self-signed JWT (see login/refresh-session's accessToken) that
// PostgREST/RPC calls send as Authorization: Bearer — a separate token
// from the opaque sessionToken above, same expiry semantics.
function _getAccessToken() {
  var s = _readSession();
  if (!s || !s.accessToken) return null;
  if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) {
    _clearSession();
    return null;
  }
  return s.accessToken;
}
function setSession(token, expiresAt, id, accessToken) {
  if (!token) { _clearSession(); return; }
  _writeSession({ token: token, expiresAt: expiresAt || null, id: id || null, accessToken: accessToken || null });
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
      await callSupabaseRpc('sign_out', {});
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
    try { await callSupabaseRpc('sign_out', {}); } catch(e) {}
    if (!parent || !parent.token) throw new Error('parent session missing');
    // Restore the guardian's token before the next API call so
    // validate_member auth's as them.
    setSession(parent.token, parent.expiresAt || null, parent.id || null, parent.accessToken || null);
    setParentSession(null);
    var data = await callSupabaseRpc('validate_member', { p_kennitala: cur.guardianSession.kennitala });
    if (!data || !data.member) throw new Error('guardian not found');
    setUser(data.member);
    // Purge any cached per-user data so the guardian's view is not stale.
    // Direct removeItem calls miss apiGet's params-suffixed keys; route
    // through the canonical helper so prefix-scan picks up every variant.
    _invalidateApiCache('getTrips');
    _invalidateApiCache('getCrews');
    _invalidateApiCache('getCrewBoard');
    _invalidateApiCache('getCrewInvites');
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
    // Route through seedApiCache so the warmed result lands under the
    // canonical params-suffixed key (`ymir_getConfig_{}`) and in the right
    // storage tier (localStorage for getConfig). The bare-prefix
    // `ymir_getConfig_` write this used to do never matched apiGet's lookup
    // shape, so the warm only primed the server-side CacheService — never
    // the client cache.
    _call('getConfig', {}, { silent: true }).then(function(r) {
      seedApiCache('getConfig', {}, r);
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

// ── Supabase Storage direct upload/delete ────────────────────────────────
// Same trust model as callPostgrestTable/callSupabaseRpc above: the
// caller's own self-signed JWT, gated by RLS on storage.objects (see
// supabase/migrations/20260923100000_trip_files_storage.sql) — no Edge
// Function needed for the file bytes themselves. Used by
// shared/logbook-upload.js for trip GPS tracks + photos.
async function uploadToStorage(bucket, path, blob, contentType) {
  const token = _getAccessToken();
  const headers = {
    'Content-Type': contentType || blob.type || 'application/octet-stream',
    'apikey': SUPABASE_ANON_KEY,
    'x-upsert': 'true',
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + path, {
    method: 'POST',
    headers: headers,
    body: blob,
  });
  if (!resp.ok) {
    const data = await resp.json().catch(function () { return null; });
    const err = new Error((data && (data.message || data.error)) || ('Storage upload error ' + resp.status));
    err.status = resp.status; err.code = resp.status;
    throw err;
  }
  return SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + path;
}

// Takes either a full public storage URL (as stored in trackFileUrl/
// photoUrls) or a bare "bucket/path" and deletes the underlying object.
// 404 is treated as success (file already gone), matching the old
// tryTrashDriveUrl_'s "best-effort, never block on this" contract.
async function deleteFromStorage(urlOrPath) {
  const m = String(urlOrPath || '').match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  let bucket, path;
  if (m) { bucket = m[1]; path = m[2]; }
  else {
    const parts = String(urlOrPath || '').split('/');
    bucket = parts.shift(); path = parts.join('/');
  }
  if (!bucket || !path) return;
  const token = _getAccessToken();
  const headers = { 'apikey': SUPABASE_ANON_KEY };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + path, {
    method: 'DELETE',
    headers: headers,
  });
  if (!resp.ok && resp.status !== 404) {
    const data = await resp.json().catch(function () { return null; });
    const err = new Error((data && (data.message || data.error)) || ('Storage delete error ' + resp.status));
    err.status = resp.status; err.code = resp.status;
    throw err;
  }
}
