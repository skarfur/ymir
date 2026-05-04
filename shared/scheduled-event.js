// ══ ACTIVITY — CLIENT NORMALIZER ═════════════════════════════════════════════
// Backend storage lives in the `activities` sheet (one row per concrete
// activity occurrence). The canonical flag is `signupRequired` (boolean) —
// see scheduling.gs.
//
// On the client we keep the two existing API surfaces
// (getConfig().volunteerEvents and getDailyLog().log.activities) and project
// them through a single shape for views that want a unified timeline:
//
//   { id, signupRequired, source, status,
//     date, endDate, startTime, endTime,
//     activityTypeId, subtypeId, subtypeName,
//     title, titleIS, notes, notesIS,
//     participants,
//     leaderMemberId, leaderName, leaderPhone, showLeaderPhone,
//     roles, signupCount, capacity,
//     gcalEventId,
//     raw }
//
//   signupRequired ∈ { true, false }
//   source         ∈ { 'bulk' | 'calendar' | 'manual' | 'daily-log' }

(function (global) {
  'use strict';

  function _parse(v, fallback) {
    if (Array.isArray(v)) return v;
    if (!v) return fallback;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  }

  // Normalize a single raw row (volunteer event DTO from getConfig, or a
  // daily-log activity from getDailyLog) into the unified Activity shape.
  // `opts.signupRequired` determines the flavor (legacy `opts.kind` is still
  // accepted for back-compat); `opts.source` defaults to a sensible guess.
  function toScheduledEvent(raw, opts) {
    if (!raw) return null;
    opts = opts || {};
    // Resolve signupRequired from explicit opt, raw row, or by sniffing
    // (presence of roles/leaderName implies a signup-tracked activity).
    // Legacy `kind` is consulted as a final fallback for stragglers.
    var signupRequired;
    if (opts.signupRequired === true || opts.signupRequired === false) {
      signupRequired = opts.signupRequired;
    } else if (raw.signupRequired === true || raw.signupRequired === false) {
      signupRequired = raw.signupRequired;
    } else if (opts.kind) {
      signupRequired = (opts.kind === 'volunteer');
    } else if (raw.kind) {
      signupRequired = (raw.kind === 'volunteer');
    } else {
      signupRequired = !!(raw.roles || raw.leaderName);
    }
    var source = opts.source || _guessSource(raw, signupRequired);
    var roles = _parse(raw.roles, []);
    var capacity = roles.reduce(function (acc, r) { return acc + (Number(r && r.slots) || 0); }, 0);
    var status = raw.status
      || (raw.active === false || raw.orphaned ? 'orphaned' : null)
      || (_isPastDate(raw.date) ? 'completed' : 'upcoming');
    return {
      id:                raw.id || '',
      signupRequired:    signupRequired,
      source:            source,
      status:            status,
      date:              raw.date || '',
      endDate:           raw.endDate || '',
      startTime:         raw.startTime || raw.start || '',
      endTime:           raw.endTime   || raw.end   || '',
      activityTypeId:    raw.activityTypeId || raw.sourceActivityTypeId || '',
      subtypeId:         raw.subtypeId || raw.sourceSubtypeId || '',
      subtypeName:       raw.subtypeName || raw.subtitle || '',
      classTag:          raw.classTag   || '',
      classTagIS:        raw.classTagIS || '',
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

  function _guessSource(raw, signupRequired) {
    if (!signupRequired) {
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
    // Cancelled tombstones (plain-activity rows with status=cancelled).
    // Passed through getConfig as a list of ids; build a Set for O(1) lookup
    // so the projection skips matching dates.
    var cancelled = new Set(Array.isArray(opts.cancelledActivityOccurrences) ? opts.cancelledActivityOccurrences : []);
    var out = [];

    // 1) Bulk-scheduled activity projections (per day × per active, bulk-sourced class).
    _eachDay(fromIso, toIso, function (iso, dow) {
      actTypes.forEach(function (cls) {
        if (!cls || cls.active === false || cls.active === 'false') return;
        if (String(cls.scheduleSource || 'bulk') !== 'bulk') return;
        if (!cls.bulkSchedule) return;
        var bs = cls.bulkSchedule;
        if (bs.fromDate && iso < bs.fromDate) return;
        if (bs.toDate   && iso > bs.toDate)   return;
        var days = Array.isArray(bs.daysOfWeek) ? bs.daysOfWeek.map(Number) : [];
        if (!days.length || days.indexOf(dow) === -1) return;
        var rawId = 'sched-' + cls.id + '-' + iso;
        if (cancelled.has(rawId)) return;
        var raw = {
          id:             rawId,
          activityTypeId: cls.id,
          classTag:       cls.classTag   || '',
          classTagIS:     cls.classTagIS || '',
          date:           iso,
          startTime:      bs.startTime || cls.defaultStart || '',
          endTime:        bs.endTime   || cls.defaultEnd   || '',
          name:           cls.name || '',
          title:          cls.name || '',
          titleIS:        cls.nameIS || '',
        };
        out.push(toScheduledEvent(raw, { signupRequired: false, source: 'bulk' }));
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
        signupRequired: true,
        signupCount: signupCounts[ev.id] || 0,
      }));
    });

    out.sort(function (a, b) {
      return (a.date || '').localeCompare(b.date || '')
        || (a.startTime || '').localeCompare(b.startTime || '')
        || (a.title || '').localeCompare(b.title || '');
    });

    // Pair each volunteer event with its matching activity row (same class +
    // date) so the timeline shows one row per occurrence. The volunteer side
    // contributes its signup chip + modal target via `linkedVolunteerEvent`;
    // the activity side keeps its daily-log link and reschedule/cancel
    // buttons. Volunteer events without a matching activity (manual one-offs,
    // or activity-class cancelled but signups remain) still render alone.
    var volByKey = {};
    out.forEach(function (ev) {
      if (!ev.signupRequired || !ev.activityTypeId) return;
      var key = ev.activityTypeId + '|' + ev.date;
      if (!volByKey[key]) volByKey[key] = ev;
    });
    var consumed = {};
    out.forEach(function (ev) {
      if (ev.signupRequired || !ev.activityTypeId) return;
      var key = ev.activityTypeId + '|' + ev.date;
      var vol = volByKey[key];
      if (!vol || consumed[vol.id]) return;
      ev.linkedVolunteerEvent = vol;
      ev.signupCount = vol.signupCount;
      ev.capacity    = vol.capacity;
      consumed[vol.id] = true;
    });
    return out.filter(function (ev) {
      return !(ev.signupRequired && consumed[ev.id]);
    });
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
