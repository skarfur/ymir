// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULING  —  single source of truth for activities (every concrete
// occurrence at the club: signup-tracked or plain).
// ═══════════════════════════════════════════════════════════════════════════════
// Every row in scheduled_events represents one concrete activity instance.
// The `signupRequired` boolean flags whether it's signup-tracked:
//
//   signupRequired=true  — has roles/leader, surfaced in the volunteer portal
//                          and admin volunteer view.
//   signupRequired=false — plain activity, surfaced by the daily-log renderer
//                          and the midnight materializer.
//
// (The legacy `kind` column — 'volunteer' | 'activity' — is still written
// alongside signupRequired during the transition. New code should consult
// signupRequired; both fields are kept in lock-step by sched_rowShape_.)
//
// An activity may be templated from an `activity_types` (a.k.a. activity
// template) row via `activityTypeId`, or authored ad-hoc with no template.
//
// Projections (bulk schedule, Google Calendar) still produce virtual rows at
// read time — see `projectActivitiesForDate_` in config.gs — but any row that's
// been materialized (admin saved, midnight freezer ran, signup persisted, etc.)
// lives here as a sheet row, so GCal sync + edits operate on stable IDs.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Row ↔ domain conversion ──────────────────────────────────────────────────
// sched_parseRow_ takes a sanitized row from readAll_('scheduledEvents') and
// returns a shape where `roles` is parsed back into an array and booleans are
// unwrapped. Use this everywhere readers need the domain object.
//
// `signupRequired` is the canonical boolean. If a row predates the migration
// (no signupRequired cell yet), we derive it from the legacy `kind` column.
// Both are emitted on the parsed object during the transition so frontend
// callers that still read `.kind === 'volunteer'` continue to work.
function sched_parseRow_(row) {
  if (!row) return null;
  var roles = [];
  try { roles = row.roles ? JSON.parse(row.roles) : []; } catch (e) { roles = []; }
  var reservedBoatIds = [];
  try { reservedBoatIds = row.reservedBoatIds ? JSON.parse(row.reservedBoatIds) : []; } catch (e) { reservedBoatIds = []; }
  var linkedGroupCheckoutIds = [];
  try { linkedGroupCheckoutIds = row.linkedGroupCheckoutIds ? JSON.parse(row.linkedGroupCheckoutIds) : []; } catch (e) { linkedGroupCheckoutIds = []; }
  // Coerce signupRequired to a real boolean. Sheets returns true/false for
  // new rows but the migration backfill writes the same; legacy rows have
  // it empty and we fall back to deriving from `kind`.
  var sigRaw = row.signupRequired;
  var signupRequired;
  if (sigRaw === true || sigRaw === false) {
    signupRequired = sigRaw;
  } else if (sigRaw === 'TRUE' || sigRaw === 'true') {
    signupRequired = true;
  } else if (sigRaw === 'FALSE' || sigRaw === 'false') {
    signupRequired = false;
  } else {
    signupRequired = (String(row.kind || '').toLowerCase() === 'volunteer');
  }
  return {
    id:                    row.id || '',
    kind:                  row.kind || (signupRequired ? 'volunteer' : 'activity'),
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

// Inverse of sched_parseRow_ — takes a partial domain object and returns the
// row shape suitable for insertRow_/updateRow_. Undefined fields pass through
// so callers can do partial updates (updateRow_ ignores absent keys).
//
// signupRequired ↔ kind are written in lockstep: if the caller specified
// either one, both are populated on the row so legacy and modern readers see
// consistent values until `kind` is removed in a follow-up.
function sched_rowShape_(ev) {
  var out = {};
  if (ev.id !== undefined)                    out.id = ev.id;
  // signupRequired is canonical; kind mirrors it for legacy compat.
  // If only one was supplied, derive the other.
  if (ev.signupRequired !== undefined) {
    out.signupRequired = !!ev.signupRequired;
    if (ev.kind === undefined) out.kind = ev.signupRequired ? 'volunteer' : 'activity';
    else                       out.kind = ev.kind;
  } else if (ev.kind !== undefined) {
    out.kind = ev.kind;
    out.signupRequired = (String(ev.kind).toLowerCase() === 'volunteer');
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
var SCHEDULED_EVENTS_COLS_ = [
  'id','kind','signupRequired','status','source',
  'date','endDate','startTime','endTime',
  'activityTypeId','subtypeId','subtypeName',
  'title','titleIS','notes','notesIS','runNotes',
  'participants',
  'leaderMemberId','leaderName','leaderPhone','showLeaderPhone',
  'roles',
  'reservedBoatIds',
  'sourceActivityTypeId','sourceSubtypeId',
  'gcalEventId',
  'dailyLogDate',
  'createdAt','updatedAt','updatedBy',
  // Per-activity extras saved from the daily-log activity modal.
  'ablerRegistered','linkedGroupCheckoutIds','editedBy','editedAt',
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

// Activities surfaced by the volunteer portal — i.e. signup-tracked.
function sched_listVolunteerEvents_() {
  return sched_listAll_().filter(function (e) {
    if (!e || !e.signupRequired) return false;
    return e.status !== 'cancelled';
  });
}

// Plain (non-signup) activity rows for a specific date. Used by the daily-log
// read path; projections for not-yet-materialized days stay in
// projectActivitiesForDate_ (config.gs).
function sched_listActivitiesForDate_(dateISO) {
  if (!dateISO) return [];
  return sched_listAll_().filter(function (e) {
    return e && !e.signupRequired && e.date === dateISO && e.status !== 'cancelled';
  });
}

// Filter activities to a date range. Optional `kind` filter accepts the legacy
// values 'volunteer' / 'activity' for backward compat, mapped to signupRequired.
function sched_listInRange_(fromIso, toIso, kind) {
  var wantSignup = null;
  if (kind === 'volunteer') wantSignup = true;
  else if (kind === 'activity') wantSignup = false;
  return sched_listAll_().filter(function (e) {
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
function sched_listActivityLog_(fromIso, toIso, opts) {
  opts = opts || {};
  var rows = sched_listInRange_(fromIso, toIso, 'activity');
  // Build id -> { classTag, classTagIS } map from saved activity types so the
  // response carries the tag without forcing the client to read getConfig.
  var typeMap = {};
  try {
    var cfgMap = getConfigMap_();
    var types = JSON.parse(getConfigValue_('activity_types', cfgMap) || '[]');
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
  var activities = sched_listActivityLog_(from, to, {
    activityTypeId: b.activityTypeId,
    classTag:       b.classTag,
  });
  return okJ({ activities: activities, from: from, to: to });
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
  cDel_('sched_events_for_config');
  // The outer 'config' cache embeds the volunteerEvents projection
  // (cancelled-activity tombstones too), so a scheduled-events write must
  // drop it too — otherwise getConfig_ short-circuits on its own cache
  // before ever consulting the freshly-cleared sub-cache.
  cDel_('config');
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
  cDel_('sched_events_for_config');
  cDel_('config');
  return true;
}

// Hard delete — preferred for rows that were never materialized by a user
// action (bulk-schedule reconciliation prune path). For rows with signups or
// daily-log ties, use sched_cancel_ instead.
function sched_hardDelete_(id) {
  if (!id) return false;
  var ok = deleteRow_('scheduledEvents', 'id', id);
  if (ok) {
    cDel_('sched_events_for_config');
    cDel_('config');
  }
  return ok;
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
