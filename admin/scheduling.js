// ═══════════════════════════════════════════════════════════════════════════════
// admin/scheduling.js — Consolidated Scheduling admin tab
// Hosts three col-sections:
//   1. Upcoming events — unified ScheduledEvent timeline (next 30 days),
//                        with "+ Add event" for one-offs
//   2. Activity types  — existing renderer (actTypesCard)
//   3. Calendars       — existing club-calendar form (clubCalList)
// The per-feature renderers live in their original files (act-types.js,
// volunteers.js, calendars.js) — this module only owns the new unified view
// and the `renderSchedulingTab` router hook called from admin.js:showTab.
// ═══════════════════════════════════════════════════════════════════════════════

function renderSchedulingTab() {
  try { renderUpcomingEvents(); }    catch (e) { console.warn('renderUpcomingEvents:', e && e.message); }
  try { renderActTypes(); }          catch (e) { console.warn('renderActTypes:', e && e.message); }
  // Volunteer events no longer have their own col-section — they appear in the
  // Upcoming events timeline. Still kick the materialization sync so virtual
  // events from bulk schedules get persisted before the timeline render.
  try { syncVolunteerEventsBackground(); } catch (e) { console.warn('syncVolunteerEventsBackground:', e && e.message); }
}

function renderUpcomingEvents() {
  var card = document.getElementById('schedUpcomingCard');
  if (!card) return;
  var fromIso = new Date().toISOString().slice(0, 10);
  var toIso   = _addDaysIso(fromIso, 30);
  var events = [];
  try {
    events = (typeof buildUpcomingEvents === 'function')
      ? buildUpcomingEvents({
          actTypes: actTypes || [],
          volunteerEvents: volunteerEvents || [],
          volunteerSignups: (typeof volunteerSignups !== 'undefined' ? volunteerSignups : []),
          cancelledActivityOccurrences: (typeof cancelledActivityOccurrences !== 'undefined' ? cancelledActivityOccurrences : []),
          fromIso: fromIso,
          toIso: toIso,
        })
      : [];
  } catch (e) { events = []; console.warn('buildUpcomingEvents:', e && e.message); }

  var calOnlyTypes = (typeof calendarSourcedActivityTypes === 'function')
    ? calendarSourcedActivityTypes(actTypes || [])
    : [];

  if (!events.length) {
    card.innerHTML = '<div class="empty-state">' + s('admin.schedNoUpcoming') + '</div>'
      + _calSourcedHintHtml(calOnlyTypes);
    return;
  }

  var L = getLang();
  var byDate = {};
  events.forEach(function (ev) {
    if (!byDate[ev.date]) byDate[ev.date] = [];
    byDate[ev.date].push(ev);
  });
  var html = Object.keys(byDate).sort().map(function (iso) {
    return '<div class="sched-day">'
      + '<div class="sched-day-hdr">' + esc(_formatDayLabel(iso)) + '</div>'
      + byDate[iso].map(function (ev) { return _upcomingRowHtml(ev, L); }).join('')
      + '</div>';
  }).join('');

  card.innerHTML = html + _calSourcedHintHtml(calOnlyTypes) + _cancelledSectionHtml();
}

// Render a small foldable list of cancelled activity-class occurrences with
// a restore button on each. Built from `cancelledActivityOccurrences` (list
// of `sched-{classId}-{date}` ids returned by getConfig).
function _cancelledSectionHtml() {
  var ids = (typeof cancelledActivityOccurrences !== 'undefined' ? cancelledActivityOccurrences : []) || [];
  if (!ids.length) return '';
  var L = getLang();
  // Parse ids; suppress past dates (no point restoring a date that's gone).
  var todayIso = new Date().toISOString().slice(0, 10);
  var rows = ids.map(function (id) {
    // id format: sched-{classId}-{YYYY-MM-DD} — date is the last 10 chars.
    var s = String(id);
    if (s.indexOf('sched-') !== 0) return null;
    var dateISO = s.slice(-10);
    var classId = s.slice('sched-'.length, s.length - 11);
    if (!classId || dateISO < todayIso) return null;
    var cls = (actTypes || []).find(function (a) { return a && a.id === classId; });
    var name = cls ? ((L === 'IS' && cls.nameIS) ? cls.nameIS : (cls.name || classId)) : classId;
    return { id: id, classId: classId, dateISO: dateISO, name: name };
  }).filter(Boolean).sort(function (a, b) { return a.dateISO.localeCompare(b.dateISO); });
  if (!rows.length) return '';
  return '<details class="sched-cancelled mt-12"><summary class="sched-cancelled-hdr">'
    + '<span>' + esc(s('admin.cancelledOccurrences')) + ' (' + rows.length + ')</span>'
    + '</summary>'
    + rows.map(function (r) {
        return '<div class="sched-row sched-row-cancelled">'
          + '<span class="sched-time">' + esc(_formatDayLabel(r.dateISO)) + '</span>'
          + ' <span class="sched-title">' + esc(r.name) + '</span>'
          + ' <button type="button" class="sched-restore"'
          + ' data-admin-click="restoreClassOccurrence"'
          + ' data-admin-arg="'  + esc(r.classId)  + '"'
          + ' data-admin-arg2="' + esc(r.dateISO) + '"'
          + ' data-s="admin.restoreOccurrence"></button>'
          + '</div>';
      }).join('')
    + '</details>';
}

function _upcomingRowHtml(ev, L) {
  // Kind badges are intentionally absent: every row is just an "event" now.
  // The signup chip (when present) signals volunteer-flavored rows; the
  // "Open daily log" link signals daily-log rows. Source ("Schedule" /
  // "Calendar" / etc.) is also suppressed — the data is still there for
  // future surfacing.
  var time = _formatTimeRange(ev);
  var title = (L === 'IS' && ev.titleIS) ? ev.titleIS : (ev.title || '');
  var subtitle = ev.subtypeName ? ' — ' + esc(ev.subtypeName) : '';
  var signups = '';
  if (ev.capacity) {
    // Consolidated activity rows carry the volunteer side via
    // linkedVolunteerEvent — make the chip the click target for the modal so
    // the row's daily-log link and reschedule/cancel buttons aren't shadowed
    // by a whole-row click.
    var volId = ev.linkedVolunteerEvent ? ev.linkedVolunteerEvent.id
              : (ev.kind === 'volunteer' ? ev.id : '');
    var chipClick = volId
      ? ' data-admin-click="openVolEventModal" data-admin-arg="' + esc(volId) + '" style="cursor:pointer"'
      : '';
    signups = ' <span class="sched-signup"' + chipClick + '>' + ev.signupCount + '/' + ev.capacity + '</span>';
  }
  // Standalone volunteer rows stay whole-row-clickable. Activity rows (paired
  // or not) leave the whole-row click off — they have multiple child actions.
  var editAction = (ev.kind === 'volunteer') ? 'openVolEventModal' : '';
  var openAttr = editAction
    ? (' data-admin-click="' + editAction + '" data-admin-arg="' + esc(ev.id) + '" style="cursor:pointer"')
    : '';
  var linkOut = ev.kind === 'activity'
    ? ' <a href="../dailylog/?date=' + esc(ev.date) + '" class="sched-link">' + s('admin.schedOpenDailyLog') + '</a>'
    : '';
  // Inline cancel/delete for any kind. Volunteer events delete the row
  // outright (deleteVolEvent → deleteVolunteerEvent). Activity occurrences
  // cancel just the one date (cancelClassOccurrence writes a tombstone +
  // PATCHes the master GCal event's instance) — the parent class survives.
  var deleteBtn = '';
  if (ev.kind === 'volunteer') {
    deleteBtn = ' <button type="button" class="sched-del" data-admin-click="deleteVolEvent" data-admin-arg="'
      + esc(ev.id) + '" data-s-aria="btn.delete" data-s-title="btn.delete" aria-label="Delete">×</button>';
  } else if (ev.kind === 'activity' && ev.activityTypeId && ev.date) {
    // Two inline actions on activity rows: ✎ to edit, × to cancel that
    // single occurrence (cancelClassOccurrence writes a status='cancelled'
    // tombstone + PATCHes the master GCal instance).
    //   - Consolidated rows (paired volunteer event) open the volunteer event
    //     modal (per-occurrence: edits the virtual or saved event for that
    //     date).
    //   - Activity-only rows open the activity-class modal (class-level: edits
    //     the recurring class itself). There is no per-occurrence editor for
    //     non-volunteer activities — `overrideClassOccurrence_` exists on the
    //     backend for times-only one-shot rescheduling, but we don't surface
    //     it here. If a "this only / this and following" picker is needed,
    //     it's a separate feature.
    var editBtn = ev.linkedVolunteerEvent
      ? ' <button type="button" class="sched-edit" data-admin-click="openVolEventModal"'
        + ' data-admin-arg="' + esc(ev.linkedVolunteerEvent.id) + '"'
        + ' data-s-aria="btn.edit" data-s-title="btn.edit" aria-label="Edit">✎</button>'
      : ' <button type="button" class="sched-edit" data-admin-click="openActTypeModal"'
        + ' data-admin-arg="' + esc(ev.activityTypeId) + '"'
        + ' data-s-aria="btn.edit" data-s-title="btn.edit" aria-label="Edit">✎</button>';
    deleteBtn = editBtn
      + ' <button type="button" class="sched-del" data-admin-click="cancelClassOccurrence"'
      + ' data-admin-arg="'  + esc(ev.activityTypeId) + '"'
      + ' data-admin-arg2="' + esc(ev.date) + '"'
      + ' data-s-aria="admin.cancelOccurrence" data-s-title="admin.cancelOccurrence" aria-label="Cancel">×</button>';
  }
  return '<div class="sched-row"' + openAttr + '>'
    + '<span class="sched-time">' + esc(time) + '</span>'
    + ' <span class="sched-title">' + esc(title) + subtitle + '</span>'
    + signups + linkOut + deleteBtn
    + '</div>';
}

// Cancel one occurrence of a recurring activity class on a given date.
// Confirms first (irreversible from the user's POV — they'd have to re-add
// the date back if they change their mind), then POSTs to the backend which
// writes a scheduled_events tombstone AND PATCHes the GCal master event's
// instance to status='cancelled'. The Scheduling timeline refreshes so the
// row drops out without a full page reload.
async function cancelClassOccurrence(classId, dateISO) {
  if (!classId || !dateISO) return;
  // Find the class for the confirm message — fall back to the id if the
  // local actTypes array hasn't loaded yet.
  var cls = (actTypes || []).find(function(a) { return a && a.id === classId; });
  var L = getLang();
  var name = cls
    ? (L === 'IS' && cls.nameIS ? cls.nameIS : (cls.name || classId))
    : classId;
  var msg = s('admin.confirmCancelOccurrence')
    .replace('{name}', name)
    .replace('{date}', dateISO);
  if (!await ymConfirm(msg)) return;
  try {
    await apiPost('cancelClassOccurrence', { classId: classId, date: dateISO });
    // Locally append the tombstone id so the next render skips this date —
    // saves a getConfig round-trip. The next page load will pick it up from
    // cfgRes.cancelledActivityOccurrences anyway.
    var tombstoneId = 'sched-' + classId + '-' + dateISO;
    if (cancelledActivityOccurrences.indexOf(tombstoneId) === -1) {
      cancelledActivityOccurrences.push(tombstoneId);
    }
    toast(s('toast.saved'), 'ok');
    if (typeof renderUpcomingEvents === 'function') {
      try { renderUpcomingEvents(); } catch (e) {}
    }
  } catch (e) {
    toast(s('toast.error') + ': ' + (e.message || e), 'err');
  }
}

// Restore a cancelled occurrence: drop the local tombstone + PATCH the GCal
// instance back to status='confirmed'. Confirms first since restoring a
// cancellation is a deliberate action.
async function restoreClassOccurrence(classId, dateISO) {
  if (!classId || !dateISO) return;
  var cls = (actTypes || []).find(function (a) { return a && a.id === classId; });
  var L = getLang();
  var name = cls ? (L === 'IS' && cls.nameIS ? cls.nameIS : (cls.name || classId)) : classId;
  var msg = s('admin.confirmRestoreOccurrence')
    .replace('{name}', name).replace('{date}', dateISO);
  if (!await ymConfirm(msg)) return;
  try {
    await apiPost('restoreClassOccurrence', { classId: classId, date: dateISO });
    var tombstoneId = 'sched-' + classId + '-' + dateISO;
    cancelledActivityOccurrences = cancelledActivityOccurrences.filter(function (id) {
      return id !== tombstoneId;
    });
    toast(s('toast.saved'), 'ok');
    if (typeof renderUpcomingEvents === 'function') renderUpcomingEvents();
  } catch (e) {
    toast(s('toast.error') + ': ' + (e.message || e), 'err');
  }
}

function _calSourcedHintHtml(types) {
  if (!types || !types.length) return '';
  var names = types.map(function (at) {
    return (getLang() === 'IS' && at.nameIS) ? at.nameIS : at.name;
  }).join(', ');
  return '<div class="sched-hint">'
    + s('admin.schedCalSourcedHint').replace('{names}', esc(names))
    + '</div>';
}

function _addDaysIso(iso, n) {
  var d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function _formatDayLabel(iso) {
  if (!iso) return '';
  var d = new Date(iso + 'T00:00:00');
  var dows = ['day.sun','day.mon','day.tue','day.wed','day.thu','day.fri','day.sat'];
  var months = ['month.jan','month.feb','month.mar','month.apr','month.may','month.jun',
                'month.jul','month.aug','month.sep','month.oct','month.nov','month.dec'];
  return s(dows[d.getDay()]) + ', ' + d.getDate() + ' ' + s(months[d.getMonth()]);
}

function _formatTimeRange(ev) {
  var a = (ev && ev.startTime || '').slice(0, 5);
  var b = (ev && ev.endTime   || '').slice(0, 5);
  if (a && b) return a + '–' + b;
  if (a) return a;
  return '';
}
