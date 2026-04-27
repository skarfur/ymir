// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULING  —  single source of truth for scheduled events (volunteer + activity)
// ═══════════════════════════════════════════════════════════════════════════════
// Replaces the two legacy storage locations: the `activities` JSON column in
// daily_log, and the `volunteer_events` JSON value in config. Every row in
// scheduled_events carries a `kind` discriminator:
//
//   kind='volunteer' — signup-tracked events with roles/leader. The volunteer
//                      portal + admin volunteer view read these.
//   kind='activity'  — concrete daily-log activities (past + today). Daily-log
//                      renderer + midnight materializer read these.
//
// Projections (bulk schedule, Google Calendar) still produce virtual rows at
// read time — see `projectActivitiesForDate_` in config.gs — but any row that's
// been materialized (admin saved, midnight freezer ran, signup persisted, etc.)
// lives here as a sheet row, so GCal sync + edits operate on stable IDs.
//
// One-shot migration from the old locations lives in _setup.gs
// (`migrateToScheduledEvents`). Run it once per environment after deploying.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Row ↔ domain conversion ──────────────────────────────────────────────────
// sched_parseRow_ takes a sanitized row from readAll_('scheduledEvents') and
// returns a shape where `roles` is parsed back into an array and booleans are
// unwrapped. Use this everywhere readers need the domain object.
function sched_parseRow_(row) {
  if (!row) return null;
  var roles = [];
  try { roles = row.roles ? JSON.parse(row.roles) : []; } catch (e) { roles = []; }
  var reservedBoatIds = [];
  try { reservedBoatIds = row.reservedBoatIds ? JSON.parse(row.reservedBoatIds) : []; } catch (e) { reservedBoatIds = []; }
  return {
    id:                    row.id || '',
    kind:                  row.kind || '',
    status:                row.status || '',
    source:                row.source || '',
    date:                  row.date || '',
    endDate:               row.endDate || '',
    startTime:             row.startTime || '',
    endTime:               row.endTime || '',
    activityTypeId:        row.activityTypeId || '',
    subtypeId:             row.subtypeId || '',
    subtypeName:           row.subtypeName || '',
    title:                 row.title || '',
    titleIS:               row.titleIS || '',
    notes:                 row.notes || '',
    notesIS:               row.notesIS || '',
    participants:          row.participants || '',
    leaderMemberId:        row.leaderMemberId || '',
    leaderName:            row.leaderName || '',
    leaderPhone:           row.leaderPhone || '',
    showLeaderPhone:       row.showLeaderPhone === true || row.showLeaderPhone === 'true',
    roles:                 Array.isArray(roles) ? roles : [],
    reservedBoatIds:       Array.isArray(reservedBoatIds) ? reservedBoatIds.map(String) : [],
    sourceActivityTypeId:  row.sourceActivityTypeId || '',
    sourceSubtypeId:       row.sourceSubtypeId || '',
    gcalEventId:           row.gcalEventId || '',
    dailyLogDate:          row.dailyLogDate || '',
    createdAt:             row.createdAt || '',
    updatedAt:             row.updatedAt || '',
    updatedBy:             row.updatedBy || '',
  };
}

// Inverse of sched_parseRow_ — takes a partial domain object and returns the
// row shape suitable for insertRow_/updateRow_. Undefined fields pass through
// so callers can do partial updates (updateRow_ ignores absent keys).
function sched_rowShape_(ev) {
  var out = {};
  if (ev.id !== undefined)                    out.id = ev.id;
  if (ev.kind !== undefined)                  out.kind = ev.kind;
  if (ev.status !== undefined)                out.status = ev.status;
  if (ev.source !== undefined)                out.source = ev.source;
  if (ev.date !== undefined)                  out.date = ev.date;
  if (ev.endDate !== undefined)               out.endDate = ev.endDate;
  if (ev.startTime !== undefined)             out.startTime = ev.startTime;
  if (ev.endTime !== undefined)               out.endTime = ev.endTime;
  if (ev.activityTypeId !== undefined)        out.activityTypeId = ev.activityTypeId;
  if (ev.subtypeId !== undefined)             out.subtypeId = ev.subtypeId;
  if (ev.subtypeName !== undefined)           out.subtypeName = ev.subtypeName;
  if (ev.title !== undefined)                 out.title = ev.title;
  if (ev.titleIS !== undefined)               out.titleIS = ev.titleIS;
  if (ev.notes !== undefined)                 out.notes = ev.notes;
  if (ev.notesIS !== undefined)               out.notesIS = ev.notesIS;
  if (ev.participants !== undefined)          out.participants = ev.participants;
  if (ev.leaderMemberId !== undefined)        out.leaderMemberId = ev.leaderMemberId;
  if (ev.leaderName !== undefined)            out.leaderName = ev.leaderName;
  if (ev.leaderPhone !== undefined)           out.leaderPhone = ev.leaderPhone;
  if (ev.showLeaderPhone !== undefined)       out.showLeaderPhone = !!ev.showLeaderPhone;
  if (ev.roles !== undefined)                 out.roles = JSON.stringify(Array.isArray(ev.roles) ? ev.roles : []);
  if (ev.reservedBoatIds !== undefined)       out.reservedBoatIds = JSON.stringify(Array.isArray(ev.reservedBoatIds) ? ev.reservedBoatIds.map(String).filter(Boolean) : []);
  if (ev.sourceActivityTypeId !== undefined)  out.sourceActivityTypeId = ev.sourceActivityTypeId;
  if (ev.sourceSubtypeId !== undefined)       out.sourceSubtypeId = ev.sourceSubtypeId;
  if (ev.gcalEventId !== undefined)           out.gcalEventId = ev.gcalEventId;
  if (ev.dailyLogDate !== undefined)          out.dailyLogDate = ev.dailyLogDate;
  if (ev.createdAt !== undefined)             out.createdAt = ev.createdAt;
  if (ev.updatedAt !== undefined)             out.updatedAt = ev.updatedAt;
  if (ev.updatedBy !== undefined)             out.updatedBy = ev.updatedBy;
  return out;
}

// ── Reads ────────────────────────────────────────────────────────────────────

// Lazy tab creation — a fresh deployment that hasn't had `setupSpreadsheet`
// re-run yet still serves the pages that read scheduled events (they just
// return empty lists until the migration populates rows).
var SCHEDULED_EVENTS_COLS_ = [
  'id','kind','status','source',
  'date','endDate','startTime','endTime',
  'activityTypeId','subtypeId','subtypeName',
  'title','titleIS','notes','notesIS',
  'participants',
  'leaderMemberId','leaderName','leaderPhone','showLeaderPhone',
  'roles',
  'reservedBoatIds',
  'sourceActivityTypeId','sourceSubtypeId',
  'gcalEventId',
  'dailyLogDate',
  'createdAt','updatedAt','updatedBy',
];

function ensureScheduledEventsSheet_() {
  return ensureSheet_('scheduledEvents', SCHEDULED_EVENTS_COLS_);
}

function sched_getById_(id) {
  if (!id) return null;
  ensureScheduledEventsSheet_();
  var row = findOne_('scheduledEvents', 'id', id);
  return row ? sched_parseRow_(row) : null;
}

function sched_listAll_() {
  ensureScheduledEventsSheet_();
  return (readAll_('scheduledEvents') || []).map(sched_parseRow_);
}

function sched_listVolunteerEvents_() {
  return sched_listAll_().filter(function (e) {
    if (!e || e.kind !== 'volunteer') return false;
    return e.status !== 'cancelled';
  });
}

// Concrete activity rows for a specific date (kind='activity'). Used by the
// daily log read path; projections for not-yet-materialized days stay in
// projectActivitiesForDate_ (config.gs).
function sched_listActivitiesForDate_(dateISO) {
  if (!dateISO) return [];
  return sched_listAll_().filter(function (e) {
    return e && e.kind === 'activity' && e.date === dateISO && e.status !== 'cancelled';
  });
}

function sched_listInRange_(fromIso, toIso, kind) {
  return sched_listAll_().filter(function (e) {
    if (!e || e.status === 'cancelled') return false;
    if (kind && e.kind !== kind) return false;
    if (fromIso && (e.date || '') < fromIso) return false;
    if (toIso   && (e.date || '') > toIso)   return false;
    return true;
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────

// Upsert (insert or update) by id. If id is empty, a new uid is minted.
// Returns the persisted domain object.
function sched_upsert_(ev) {
  if (!ev || typeof ev !== 'object') throw new Error('sched_upsert_: event required');
  ensureScheduledEventsSheet_();
  var ts = now_();
  var id = ev.id || uid_();
  var payload = sched_rowShape_(ev);
  payload.id = id;
  payload.updatedAt = ts;
  var existing = findOne_('scheduledEvents', 'id', id);
  if (existing) {
    updateRow_('scheduledEvents', 'id', id, payload);
  } else {
    payload.createdAt = payload.createdAt || ts;
    // Fill required-but-missing fields with sane defaults so every row is
    // fully shaped, even when callers only passed the domain fields they care
    // about.
    if (payload.status === undefined) payload.status = 'upcoming';
    if (payload.roles  === undefined) payload.roles  = '[]';
    insertRow_('scheduledEvents', payload);
  }
  return sched_getById_(id);
}

// Mark a row cancelled (soft delete). Keeps history + preserves the id so
// volunteer_signups don't dangle. Returns true if the row existed.
function sched_cancel_(id, updatedBy) {
  if (!id) return false;
  var row = findOne_('scheduledEvents', 'id', id);
  if (!row) return false;
  updateRow_('scheduledEvents', 'id', id, {
    status: 'cancelled',
    updatedAt: now_(),
    updatedBy: updatedBy || '',
  });
  return true;
}

// Hard delete — preferred for rows that were never materialized by a user
// action (bulk-schedule reconciliation prune path). For rows with signups or
// daily-log ties, use sched_cancel_ instead.
function sched_hardDelete_(id) {
  if (!id) return false;
  return deleteRow_('scheduledEvents', 'id', id);
}

// ── Batch helpers used by signup flows ───────────────────────────────────────

function sched_signupCountsByEvent_() {
  var out = {};
  var sus = [];
  try { ensureVolunteerSignupsTab_(); sus = readAll_('volunteerSignups') || []; } catch (e) { sus = []; }
  sus.forEach(function (s) {
    if (!s || !s.eventId) return;
    out[s.eventId] = (out[s.eventId] || 0) + 1;
  });
  return out;
}
