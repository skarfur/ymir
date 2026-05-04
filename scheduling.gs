// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULING  —  single source of truth for activities (every concrete
// occurrence at the club: signup-tracked or plain).
// ═══════════════════════════════════════════════════════════════════════════════
// Every row in the activities sheet represents one concrete occurrence.
// The `signupRequired` boolean flags whether it's signup-tracked:
//
//   signupRequired=true  — has roles/leader, surfaced in the volunteer portal
//                          and admin volunteer view.
//   signupRequired=false — plain activity, surfaced by the daily-log renderer
//                          and the midnight materializer.
//
// (A legacy `kind` column — 'volunteer' | 'activity' — may still be present
// on rows written before the cleanup; new writes no longer populate it, and
// activity_parseRow_ falls back to it only if signupRequired is missing. It
// can be dropped manually from the sheet once you're confident the
// signupRequired backfill has run for every row.)
//
// An activity may be templated from an `activity_templates` row via
// `activityTypeId`, or authored ad-hoc with no template.
//
// Projections (bulk schedule, Google Calendar) still produce virtual rows at
// read time — see `projectActivitiesForDate_` in config.gs — but any row that's
// been materialized (admin saved, midnight freezer ran, signup persisted, etc.)
// lives here as a sheet row, so GCal sync + edits operate on stable IDs.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Row ↔ domain conversion ──────────────────────────────────────────────────
// activity_parseRow_ takes a sanitized row from readAll_('activities') and
// returns a shape where `roles` is parsed back into an array and booleans are
// unwrapped. Use this everywhere readers need the domain object.
//
// `signupRequired` is the canonical boolean. The migration backfilled it on
// every existing row before this commit, so a missing value just falls back
// to false (a plain activity).
function activity_parseRow_(row) {
  if (!row) return null;
  var roles = [];
  try { roles = row.roles ? JSON.parse(row.roles) : []; } catch (e) { roles = []; }
  var reservedBoatIds = [];
  try { reservedBoatIds = row.reservedBoatIds ? JSON.parse(row.reservedBoatIds) : []; } catch (e) { reservedBoatIds = []; }
  var linkedGroupCheckoutIds = [];
  try { linkedGroupCheckoutIds = row.linkedGroupCheckoutIds ? JSON.parse(row.linkedGroupCheckoutIds) : []; } catch (e) { linkedGroupCheckoutIds = []; }
  var sigRaw = row.signupRequired;
  var signupRequired;
  if (sigRaw === true || sigRaw === false) {
    signupRequired = sigRaw;
  } else if (sigRaw === 'TRUE' || sigRaw === 'true') {
    signupRequired = true;
  } else {
    signupRequired = false;
  }
  return {
    id:                    row.id || '',
    signupRequired:        signupRequired,
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
    runNotes:              row.runNotes || '',
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
    calendarId:            row.calendarId || '',
    calendarSyncActive:    row.calendarSyncActive === true || row.calendarSyncActive === 'true',
    dailyLogDate:          row.dailyLogDate || '',
    createdAt:             row.createdAt || '',
    updatedAt:             row.updatedAt || '',
    updatedBy:             row.updatedBy || '',
    ablerRegistered:        row.ablerRegistered === true || row.ablerRegistered === 'true',
    linkedGroupCheckoutIds: Array.isArray(linkedGroupCheckoutIds) ? linkedGroupCheckoutIds.map(String) : [],
    editedBy:               row.editedBy || '',
    editedAt:               row.editedAt || '',
  };
}

// Inverse of activity_parseRow_ — takes a partial domain object and returns
// the row shape suitable for insertRow_/updateRow_. Undefined fields pass
// through so callers can do partial updates (updateRow_ ignores absent keys).
function activity_rowShape_(ev) {
  var out = {};
  if (ev.id !== undefined)                    out.id = ev.id;
  if (ev.signupRequired !== undefined) {
    out.signupRequired = !!ev.signupRequired;
  }
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
  if (ev.runNotes !== undefined)              out.runNotes = ev.runNotes;
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
  if (ev.calendarId !== undefined)            out.calendarId = ev.calendarId;
  if (ev.calendarSyncActive !== undefined)    out.calendarSyncActive = !!ev.calendarSyncActive;
  if (ev.dailyLogDate !== undefined)          out.dailyLogDate = ev.dailyLogDate;
  if (ev.createdAt !== undefined)             out.createdAt = ev.createdAt;
  if (ev.updatedAt !== undefined)             out.updatedAt = ev.updatedAt;
  if (ev.updatedBy !== undefined)             out.updatedBy = ev.updatedBy;
  if (ev.ablerRegistered !== undefined)       out.ablerRegistered = !!ev.ablerRegistered;
  if (ev.linkedGroupCheckoutIds !== undefined) out.linkedGroupCheckoutIds = JSON.stringify(Array.isArray(ev.linkedGroupCheckoutIds) ? ev.linkedGroupCheckoutIds.map(String).filter(Boolean) : []);
  if (ev.editedBy !== undefined)              out.editedBy = ev.editedBy;
  if (ev.editedAt !== undefined)              out.editedAt = ev.editedAt;
  return out;
}

// ── Reads ────────────────────────────────────────────────────────────────────

// Lazy tab creation — a fresh deployment that hasn't had `setupSpreadsheet`
// re-run yet still serves the pages that read scheduled events (they just
// return empty lists until the migration populates rows).
var ACTIVITIES_COLS_ = [
  'id','signupRequired','status','source',
  'date','endDate','startTime','endTime',
  'activityTypeId','subtypeId','subtypeName',
  'title','titleIS','notes','notesIS','runNotes',
  'participants',
  'leaderMemberId','leaderName','leaderPhone','showLeaderPhone',
  'roles',
  'reservedBoatIds',
  'sourceActivityTypeId','sourceSubtypeId',
  'gcalEventId',
  'calendarId','calendarSyncActive',
  'dailyLogDate',
  'createdAt','updatedAt','updatedBy',
  // Per-activity extras saved from the daily-log activity modal.
  'ablerRegistered','linkedGroupCheckoutIds','editedBy','editedAt',
];

function ensureActivitiesSheet_() {
  return ensureSheet_('activities', ACTIVITIES_COLS_);
}

function activity_getById_(id) {
  if (!id) return null;
  ensureActivitiesSheet_();
  var row = findOne_('activities', 'id', id);
  return row ? activity_parseRow_(row) : null;
}

function activity_listAll_() {
  ensureActivitiesSheet_();
  return (readAll_('activities') || []).map(activity_parseRow_);
}

// Activities surfaced by the volunteer portal — i.e. signup-tracked.
function activity_listVolunteerEvents_() {
  return activity_listAll_().filter(function (e) {
    if (!e || !e.signupRequired) return false;
    return e.status !== 'cancelled';
  });
}

// Plain (non-signup) activity rows for a specific date. Used by the daily-log
// read path; projections for not-yet-materialized days stay in
// projectActivitiesForDate_ (config.gs).
function activity_listForDate_(dateISO) {
  if (!dateISO) return [];
  return activity_listAll_().filter(function (e) {
    return e && !e.signupRequired && e.date === dateISO && e.status !== 'cancelled';
  });
}

// Filter activities to a date range. Optional `kind` filter accepts the legacy
// values 'volunteer' / 'activity' for backward compat, mapped to signupRequired.
function activity_listInRange_(fromIso, toIso, kind) {
  var wantSignup = null;
  if (kind === 'volunteer') wantSignup = true;
  else if (kind === 'activity') wantSignup = false;
  return activity_listAll_().filter(function (e) {
    if (!e || e.status === 'cancelled') return false;
    if (wantSignup !== null && e.signupRequired !== wantSignup) return false;
    if (fromIso && (e.date || '') < fromIso) return false;
    if (toIso   && (e.date || '') > toIso)   return false;
    return true;
  });
}

// Activity-log read for staff Logbook Review. Returns concrete plain
// (non-signup) activity rows in a date range, enriched with classTag from the
// parent activity-template definition so the frontend can group/filter by tag
// without a second config lookup. Optional activityTypeId / classTag filters
// apply server-side; an empty filter passes through.
function activity_listLog_(fromIso, toIso, opts) {
  opts = opts || {};
  var rows = activity_listInRange_(fromIso, toIso, 'activity');
  // Build id -> { classTag, classTagIS } map from saved activity types so the
  // response carries the tag without forcing the client to read getConfig.
  var typeMap = {};
  try {
    var cfgMap = getConfigMap_();
    var types = JSON.parse(getConfigValue_('activity_templates', cfgMap) || '[]');
    (types || []).forEach(function (t) {
      if (t && t.id) typeMap[t.id] = { classTag: t.classTag || '', classTagIS: t.classTagIS || '' };
    });
  } catch (e) { typeMap = {}; }
  var wantType = String(opts.activityTypeId || '').trim();
  var wantTag  = String(opts.classTag || '').trim();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (wantType && r.activityTypeId !== wantType) continue;
    var meta = typeMap[r.activityTypeId] || {};
    if (wantTag && (meta.classTag || '') !== wantTag) continue;
    var runNotes = r.runNotes || '';
    out.push({
      id:              r.id,
      date:            r.date,
      startTime:       r.startTime,
      endTime:         r.endTime,
      activityTypeId:  r.activityTypeId,
      classTag:        meta.classTag   || '',
      classTagIS:      meta.classTagIS || '',
      subtypeId:       r.subtypeId,
      subtypeName:     r.subtypeName,
      title:           r.title,
      titleIS:         r.titleIS,
      participants:    r.participants,
      notes:           r.notes,
      runNotes:        runNotes,
      hasLog:          !!String(runNotes).trim(),
      leaderMemberId:  r.leaderMemberId,
      leaderName:      r.leaderName,
      status:          r.status,
      updatedBy:       r.updatedBy,
      updatedAt:       r.updatedAt,
    });
  }
  // Newest first — mirrors the trips list ordering on the same page.
  out.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (a.startTime || '') < (b.startTime || '') ? 1 : -1;
  });
  return out;
}

// Public handler for the staff Logbook Review activity-log section.
// Defaults to the last 90 days; hard-caps the range at 366 days so a
// runaway client can't pull every row in the sheet.
function getActivityLog_(b) {
  b = b || {};
  var to   = String(b.to   || '').trim() || nowLocalDate_();
  var from = String(b.from || '').trim();
  if (!from) {
    var d = new Date(to + 'T00:00:00');
    d.setDate(d.getDate() - 90);
    from = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  // Cap span to keep the response bounded.
  try {
    var dFrom = new Date(from + 'T00:00:00');
    var dTo   = new Date(to   + 'T00:00:00');
    var spanDays = Math.round((dTo - dFrom) / 86400000);
    if (spanDays > 366) {
      var capped = new Date(dTo);
      capped.setDate(capped.getDate() - 366);
      from = Utilities.formatDate(capped, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
  } catch (e) {}
  var activities = activity_listLog_(from, to, {
    activityTypeId: b.activityTypeId,
    classTag:       b.classTag,
  });
  return okJ({ activities: activities, from: from, to: to });
}

// ── Writes ───────────────────────────────────────────────────────────────────

// Upsert (insert or update) by id. If id is empty, a new uid is minted.
// Returns the persisted domain object.
function activity_upsert_(ev) {
  if (!ev || typeof ev !== 'object') throw new Error('activity_upsert_: event required');
  ensureActivitiesSheet_();
  var ts = now_();
  var id = ev.id || uid_();
  var payload = activity_rowShape_(ev);
  payload.id = id;
  payload.updatedAt = ts;
  var existing = findOne_('activities', 'id', id);
  if (existing) {
    updateRow_('activities', 'id', id, payload);
  } else {
    payload.createdAt = payload.createdAt || ts;
    // Fill required-but-missing fields with sane defaults so every row is
    // fully shaped, even when callers only passed the domain fields they care
    // about.
    if (payload.status === undefined) payload.status = 'upcoming';
    if (payload.roles  === undefined) payload.roles  = '[]';
    insertRow_('activities', payload);
  }
  cDel_('activities_for_config');
  // The outer 'config' cache embeds the volunteerEvents projection
  // (cancelled-activity tombstones too), so a scheduled-events write must
  // drop it too — otherwise getConfig_ short-circuits on its own cache
  // before ever consulting the freshly-cleared sub-cache.
  cDel_('config');
  return activity_getById_(id);
}

// Mark a row cancelled (soft delete). Keeps history + preserves the id so
// volunteer_signups don't dangle. Returns true if the row existed.
function activity_cancel_(id, updatedBy) {
  if (!id) return false;
  var row = findOne_('activities', 'id', id);
  if (!row) return false;
  updateRow_('activities', 'id', id, {
    status: 'cancelled',
    updatedAt: now_(),
    updatedBy: updatedBy || '',
  });
  cDel_('activities_for_config');
  cDel_('config');
  return true;
}

// Hard delete — preferred for rows that were never materialized by a user
// action (bulk-schedule reconciliation prune path). For rows with signups or
// daily-log ties, use activity_cancel_ instead.
function activity_hardDelete_(id) {
  if (!id) return false;
  var ok = deleteRow_('activities', 'id', id);
  if (ok) {
    cDel_('activities_for_config');
    cDel_('config');
  }
  return ok;
}

// ── Batch helpers used by signup flows ───────────────────────────────────────

function activity_signupCountsById_() {
  var out = {};
  var sus = [];
  try { ensureVolunteerSignupsTab_(); sus = readAll_('volunteerSignups') || []; } catch (e) { sus = []; }
  sus.forEach(function (s) {
    if (!s || !s.eventId) return;
    out[s.eventId] = (out[s.eventId] || 0) + 1;
  });
  return out;
}

// ── Transitional shims for the sched_* → activity_* rename (b108509) ─────────
// Apps Script projects can hold partially-stale .gs files between pushes — if
// scheduling.gs lands but a caller (e.g. members.gs) is still pre-rename, the
// caller throws "sched_X is not defined" until the next push lands. These
// aliases keep the old names callable so a partial sync degrades gracefully.
// Drop once you're confident every deployment has caught up.
function sched_parseRow_(row)                   { return activity_parseRow_(row); }
function sched_rowShape_(ev)                    { return activity_rowShape_(ev); }
function sched_getById_(id)                     { return activity_getById_(id); }
function sched_listAll_()                       { return activity_listAll_(); }
function sched_listVolunteerEvents_()           { return activity_listVolunteerEvents_(); }
function sched_listActivitiesForDate_(dateISO)  { return activity_listForDate_(dateISO); }
function sched_listInRange_(fromIso, toIso, kind) { return activity_listInRange_(fromIso, toIso, kind); }
function sched_listActivityLog_(fromIso, toIso, opts) { return activity_listLog_(fromIso, toIso, opts); }
function sched_upsert_(ev)                      { return activity_upsert_(ev); }
function sched_cancel_(id, updatedBy)           { return activity_cancel_(id, updatedBy); }
function sched_hardDelete_(id)                  { return activity_hardDelete_(id); }
function sched_signupCountsByEvent_()           { return activity_signupCountsById_(); }
function ensureScheduledEventsSheet_()          { return ensureActivitiesSheet_(); }
