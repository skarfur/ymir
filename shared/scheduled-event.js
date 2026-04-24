// ══ SCHEDULED EVENT — CLIENT NORMALIZER ══════════════════════════════════════
// Backend storage lives in the `scheduled_events` sheet with a `kind`
// discriminator ('volunteer' | 'activity') and a `status` field — see
// scheduling.gs. On the client, we keep the two existing API surfaces
// (getConfig().volunteerEvents and getDailyLog().log.activities) and project
// them through a single shape for views that want a unified timeline:
//
//   { id, kind, source, status,
//     date, endDate, startTime, endTime,
//     activityTypeId, subtypeId, subtypeName,
//     title, titleIS, notes, notesIS,
//     participants,
//     leaderMemberId, leaderName, leaderPhone, showLeaderPhone,
//     roles, signupCount, capacity,
//     gcalEventId,
//     raw }
//
//   kind   ∈ { 'volunteer', 'activity' }
//   source ∈ { 'bulk' | 'calendar' | 'manual' | 'daily-log' }

(function (global) {
  'use strict';

  function _parse(v, fallback) {
    if (Array.isArray(v)) return v;
    if (!v) return fallback;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  }

  // Normalize a single raw row (volunteer event DTO from getConfig, or a
  // daily-log activity from getDailyLog) into the ScheduledEvent shape.
  // `opts.kind` is required; `opts.source` defaults to a sensible guess.
  function toScheduledEvent(raw, opts) {
    if (!raw) return null;
    opts = opts || {};
    var kind = opts.kind || (raw.roles || raw.leaderName ? 'volunteer' : 'activity');
    var source = opts.source || _guessSource(raw, kind);
    var roles = _parse(raw.roles, []);
    var capacity = roles.reduce(function (acc, r) { return acc + (Number(r && r.slots) || 0); }, 0);
    var status = raw.status
      || (raw.active === false || raw.orphaned ? 'orphaned' : null)
      || (_isPastDate(raw.date) ? 'completed' : 'upcoming');
    return {
      id:                raw.id || '',
      kind:              kind,
      source:            source,
      status:            status,
      date:              raw.date || '',
      endDate:           raw.endDate || '',
      startTime:         raw.startTime || raw.start || '',
      endTime:           raw.endTime   || raw.end   || '',
      activityTypeId:    raw.activityTypeId || raw.sourceActivityTypeId || '',
      subtypeId:         raw.subtypeId || raw.sourceSubtypeId || '',
      subtypeName:       raw.subtypeName || raw.subtitle || '',
      title:             raw.title || raw.name || raw.type || '',
      titleIS:           raw.titleIS || raw.subtitleIS || '',
      notes:             raw.notes || '',
      notesIS:           raw.notesIS || '',
      participants:      raw.participants || '',
      leaderMemberId:    raw.leaderMemberId || '',
      leaderName:        raw.leaderName || '',
      leaderPhone:       raw.leaderPhone || '',
      showLeaderPhone:   raw.showLeaderPhone === true || raw.showLeaderPhone === 'true',
      roles:             roles,
      signupCount:       Number(opts.signupCount) || 0,
      capacity:          capacity,
      gcalEventId:       raw.gcalEventId || '',
      raw:               raw,
    };
  }

  function _guessSource(raw, kind) {
    if (kind === 'activity') {
      if (String(raw.id || '').indexOf('gcal-')  === 0) return 'calendar';
      if (String(raw.id || '').indexOf('sched-') === 0) return 'bulk';
      return 'daily-log';
    }
    if (raw.virtual) return 'bulk';
    if (raw.sourceActivityTypeId) return 'bulk';
    return 'manual';
  }

  function _isPastDate(iso) {
    if (!iso) return false;
    var today = new Date().toISOString().slice(0, 10);
    return iso < today;
  }

  function _countSignups(signups) {
    var m = {};
    (Array.isArray(signups) ? signups : []).forEach(function (s) {
      if (!s || !s.eventId) return;
      m[s.eventId] = (m[s.eventId] || 0) + 1;
    });
    return m;
  }

  // Build a merged, sorted ScheduledEvent timeline from the data the admin
  // page already has loaded:
  //   - `volunteerEvents` from getConfig
  //   - bulk-schedule projections expanded client-side from activityTypes
  //   - volunteer virtual-event expansion (via shared/volunteer.js globals)
  //
  // Calendar-sourced activity types don't appear here — their projection
  // requires a per-date backend round-trip to Google Calendar. Callers that
  // care should surface a hint via `calendarSourcedActivityTypes`.
  function buildUpcomingEvents(opts) {
    opts = opts || {};
    var actTypes        = Array.isArray(opts.actTypes) ? opts.actTypes : [];
    var volunteerEvents = Array.isArray(opts.volunteerEvents) ? opts.volunteerEvents : [];
    var signupCounts    = _countSignups(opts.volunteerSignups);
    var fromIso         = opts.fromIso || new Date().toISOString().slice(0, 10);
    var toIso           = opts.toIso   || _addDaysIso(fromIso, 30);
    var out = [];

    // 1) Bulk-scheduled activity projections (per day × per active, bulk-sourced type × subtype).
    _eachDay(fromIso, toIso, function (iso, dow) {
      actTypes.forEach(function (at) {
        if (!at || at.active === false || at.active === 'false') return;
        if (String(at.scheduleSource || 'bulk') !== 'bulk') return;
        var subs = _parse(at.subtypes, []);
        subs.forEach(function (st) {
          if (!st || !st.bulkSchedule) return;
          var bs = st.bulkSchedule;
          if (bs.fromDate && iso < bs.fromDate) return;
          if (bs.toDate   && iso > bs.toDate)   return;
          var days = Array.isArray(bs.daysOfWeek) ? bs.daysOfWeek.map(Number) : [];
          if (!days.length || days.indexOf(dow) === -1) return;
          var raw = {
            id:             'sched-' + at.id + '-' + (st.id || 'st') + '-' + iso,
            activityTypeId: at.id,
            subtypeId:      st.id || '',
            subtypeName:    st.name || '',
            date:           iso,
            startTime:      bs.startTime || st.defaultStart || '',
            endTime:        bs.endTime   || st.defaultEnd   || '',
            name:           st.name || at.name || '',
            title:          st.name || at.name || '',
            titleIS:        st.nameIS || at.nameIS || '',
          };
          out.push(toScheduledEvent(raw, { kind: 'activity', source: 'bulk' }));
        });
      });
    });

    // 2) Volunteer events in range (saved DTOs + virtual expansions deduped).
    var virt = [];
    if (typeof global.expandVolunteerActivityTypes === 'function') {
      virt = global.expandVolunteerActivityTypes(actTypes, fromIso, toIso);
    }
    var merged = (typeof global.mergeVolunteerEvents === 'function')
      ? global.mergeVolunteerEvents(volunteerEvents, virt)
      : volunteerEvents.concat(virt);
    merged.forEach(function (ev) {
      if (!ev || !ev.date) return;
      if (ev.date < fromIso || ev.date > toIso) return;
      if (ev.active === false || ev.active === 'false') return;
      out.push(toScheduledEvent(ev, {
        kind: 'volunteer',
        signupCount: signupCounts[ev.id] || 0,
      }));
    });

    out.sort(function (a, b) {
      return (a.date || '').localeCompare(b.date || '')
        || (a.startTime || '').localeCompare(b.startTime || '')
        || (a.title || '').localeCompare(b.title || '');
    });
    return out;
  }

  function calendarSourcedActivityTypes(actTypes) {
    return (Array.isArray(actTypes) ? actTypes : []).filter(function (at) {
      if (!at || at.active === false || at.active === 'false') return false;
      return String(at.scheduleSource || 'bulk') === 'calendar';
    });
  }

  function _eachDay(fromIso, toIso, cb) {
    if (!fromIso || !toIso || fromIso > toIso) return;
    var a = new Date(fromIso + 'T00:00:00');
    var b = new Date(toIso   + 'T00:00:00');
    for (var d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
      var iso = d.toISOString().slice(0, 10);
      cb(iso, d.getDay());
    }
  }

  function _addDaysIso(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  global.toScheduledEvent             = toScheduledEvent;
  global.buildUpcomingEvents          = buildUpcomingEvents;
  global.calendarSourcedActivityTypes = calendarSourcedActivityTypes;
}(typeof window !== 'undefined' ? window : this));
