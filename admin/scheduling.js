// ═══════════════════════════════════════════════════════════════════════════════
// admin/scheduling.js — Consolidated Scheduling admin tab
// Hosts four col-sections:
//   1. Upcoming events — unified ScheduledEvent timeline (next 30 days)
//   2. Activity types  — existing renderer (actTypesCard)
//   3. Volunteer events — existing renderer (volEventsCard)
//   4. Calendars       — existing club-calendar form (clubCalList)
// The per-feature renderers live in their original files (act-types.js,
// volunteers.js, calendars.js) — this module only owns the new unified view
// and the `renderSchedulingTab` router hook called from admin.js:showTab.
// ═══════════════════════════════════════════════════════════════════════════════

function renderSchedulingTab() {
  try { renderUpcomingEvents(); }    catch (e) { console.warn('renderUpcomingEvents:', e && e.message); }
  try { renderActTypes(); }          catch (e) { console.warn('renderActTypes:', e && e.message); }
  try { renderVolunteerEvents(); }   catch (e) { console.warn('renderVolunteerEvents:', e && e.message); }
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

  card.innerHTML = html + _calSourcedHintHtml(calOnlyTypes);
}

function _upcomingRowHtml(ev, L) {
  var kindBadge = ev.kind === 'volunteer'
    ? '<span class="sched-badge sched-kind-vol">' + s('admin.schedKindVolunteer') + '</span>'
    : '<span class="sched-badge sched-kind-act">' + s('admin.schedKindActivity') + '</span>';
  // Source badge ("Schedule"/"Calendar"/"Manual"/"Daily log") is intentionally
  // suppressed for now — duplicates the kind cue and reads as noise. The
  // ev.source field is still set in the data, just not surfaced.
  var time = _formatTimeRange(ev);
  var title = (L === 'IS' && ev.titleIS) ? ev.titleIS : (ev.title || '');
  var subtitle = ev.subtypeName ? ' — ' + esc(ev.subtypeName) : '';
  var signups = '';
  if (ev.kind === 'volunteer' && ev.capacity) {
    signups = ' <span class="sched-signup">' + ev.signupCount + '/' + ev.capacity + '</span>';
  }
  var editAction = ev.kind === 'volunteer' ? 'openVolEventModal' : '';
  // Activities are authored in the daily log, not in a modal — link to it
  // with a date-carrying href rather than a JS action.
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
    deleteBtn = ' <button type="button" class="sched-del" data-admin-click="cancelClassOccurrence"'
      + ' data-admin-arg="'  + esc(ev.activityTypeId) + '"'
      + ' data-admin-arg2="' + esc(ev.date) + '"'
      + ' data-s-aria="admin.cancelOccurrence" data-s-title="admin.cancelOccurrence" aria-label="Cancel">×</button>';
  }
  return '<div class="sched-row"' + openAttr + '>'
    + '<span class="sched-time">' + esc(time) + '</span>'
    + ' ' + kindBadge
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
