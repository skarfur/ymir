// ══ VOLUNTEER ACTIVITY HELPERS ═══════════════════════════════════════════════
// Expands volunteer-flagged activity types with bulk schedules into virtual
// volunteer event occurrences. Used by both the admin volunteers tab and the
// member volunteer events list so that activity types marked as volunteer
// automatically appear without requiring a hand-crafted volunteer event row.
//
// A "virtual" event has the same shape as a saved volunteer event (id, title,
// date, startTime, endTime, roles, …) but with a deterministic id of the form
// `vae-{activityTypeId}-{subtypeId}-{YYYYMMDD}` and a `virtual: true` flag.
// On signup, the client sends the source activity type + subtype + date so
// the backend can materialize the event on demand.

(function(global) {
  'use strict';

  function _parse(v, fallback) {
    if (Array.isArray(v)) return v;
    if (!v) return fallback;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  }

  // Returns true if ISO date string `d` falls within [from, to] inclusive.
  // Empty bounds are treated as unbounded.
  function _inRange(d, from, to) {
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  }

  // Iterate each day between two ISO dates (inclusive) and yield the date and
  // its day-of-week (0=Sun..6=Sat).
  function _eachDay(fromIso, toIso, cb) {
    var a = new Date(fromIso + 'T00:00:00');
    var b = new Date(toIso   + 'T00:00:00');
    for (var d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
      var iso = d.toISOString().slice(0, 10);
      cb(iso, d.getDay());
    }
  }

  // Expand all active, volunteer-flagged activity types into virtual volunteer
  // events within [rangeFrom, rangeTo]. Subtypes without a bulk schedule are
  // skipped. Subtypes with bulk schedules that lack default times are also
  // skipped (times come from subtype defaults now).
  //
  //   actTypes : array from config
  //   rangeFrom: ISO date (default: today)
  //   rangeTo  : ISO date (default: today + 90 days)
  //   locale   : 'IS' or 'EN' (unused here; consumer handles localization)
  //
  // Returns an array of virtual event objects.
  function expandVolunteerActivityTypes(actTypes, rangeFrom, rangeTo) {
    if (!Array.isArray(actTypes) || !actTypes.length) return [];
    var today = new Date();
    var fromIso = rangeFrom || today.toISOString().slice(0, 10);
    if (!rangeTo) {
      var until = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
      rangeTo = until.toISOString().slice(0, 10);
    }
    var out = [];
    actTypes.forEach(function(at) {
      if (!at || at.active === false || at.active === 'false') return;
      var isVol = at.volunteer === true || at.volunteer === 'true';
      if (!isVol) return;
      var roles = _parse(at.roles, []);
      if (!roles.length) return;
      var subs = _parse(at.subtypes, []);
      subs.forEach(function(st) {
        if (!st || !st.bulkSchedule) return;
        var bs = st.bulkSchedule;
        var fd = bs.fromDate || '';
        var td = bs.toDate   || '';
        if (!fd || !td) return;
        var startT = st.defaultStart || '';
        var endT   = st.defaultEnd   || '';
        if (!startT || !endT) return;
        var days = Array.isArray(bs.daysOfWeek)
          ? bs.daysOfWeek.map(function(n) { return parseInt(n, 10); })
          : [];
        if (!days.length) return;
        // Intersect the subtype's own range with the requested range
        var effFrom = fd > fromIso ? fd : fromIso;
        var effTo   = td < rangeTo ? td : rangeTo;
        if (effFrom > effTo) return;
        _eachDay(effFrom, effTo, function(iso, dow) {
          if (days.indexOf(dow) === -1) return;
          var id = 'vae-' + at.id + '-' + (st.id || 'st') + '-' + iso.replace(/-/g, '');
          out.push({
            id: id,
            virtual: true,
            sourceActivityTypeId: at.id,
            sourceSubtypeId: st.id || '',
            title: at.name || '',
            titleIS: at.nameIS || '',
            subtitle: st.name || '',
            subtitleIS: st.nameIS || '',
            activityTypeId: at.id,
            date: iso,
            startTime: startT,
            endTime: endT,
            leaderName: '',
            leaderPhone: '',
            showLeaderPhone: false,
            notes: '',
            notesIS: '',
            // Each virtual instance gets its own role ids so signups don't
            // collide across days for the same activity type.
            roles: roles.map(function(r) {
              return {
                id: (r.id || 'r') + '-' + iso.replace(/-/g, ''),
                baseRoleId: r.id || '',
                name: r.name || '',
                nameIS: r.nameIS || '',
                description: r.description || '',
                descriptionIS: r.descriptionIS || '',
                slots: r.slots || 1,
                requiredEndorsement: r.requiredEndorsement || '',
              };
            }),
            active: true,
          });
        });
      });
    });
    return out;
  }

  // Merge virtual events with saved events. Saved events win if they share
  // the same virtual id (i.e. they've already been materialized via signup).
  function mergeVolunteerEvents(savedEvents, virtualEvents) {
    var saved = Array.isArray(savedEvents)   ? savedEvents   : [];
    var virt  = Array.isArray(virtualEvents) ? virtualEvents : [];
    var ids = {};
    saved.forEach(function(e) { if (e && e.id) ids[e.id] = true; });
    var out = saved.slice();
    virt.forEach(function(e) { if (!ids[e.id]) out.push(e); });
    return out;
  }

  // Returns true if the given member can take the given role. `memberCerts`
  // is the member's enriched certifications array (each item has at least
  // .certId). A role with no requiredEndorsement is always allowed.
  function memberCanTakeRole(role, memberCerts) {
    if (!role || !role.requiredEndorsement) return true;
    if (!Array.isArray(memberCerts)) return false;
    return memberCerts.some(function(c) {
      return c && (c.certId === role.requiredEndorsement || c.id === role.requiredEndorsement);
    });
  }

  global.expandVolunteerActivityTypes = expandVolunteerActivityTypes;
  global.mergeVolunteerEvents         = mergeVolunteerEvents;
  global.memberCanTakeRole            = memberCanTakeRole;
})(typeof window !== 'undefined' ? window : this);
