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

  // Expand all active, volunteer-flagged activity classes into virtual
  // volunteer events within [rangeFrom, rangeTo]. Classes without a bulk
  // schedule or without default times are skipped.
  //
  //   activityTemplates : flat-template array from config (cfg.activityTemplates,
  //              with cfg.activityTypes as legacy alias)
  //   rangeFrom: ISO date (default: today)
  //   rangeTo  : ISO date (default: today + 90 days)
  //
  // Returns an array of virtual event objects.
  function expandVolunteerActivityTypes(activityTemplates, rangeFrom, rangeTo) {
    if (!Array.isArray(activityTemplates) || !activityTemplates.length) return [];
    var today = new Date();
    var fromIso = rangeFrom || today.toISOString().slice(0, 10);
    if (!rangeTo) {
      var until = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
      rangeTo = until.toISOString().slice(0, 10);
    }
    var out = [];
    activityTemplates.forEach(function(cls) {
      if (!cls || cls.active === false || cls.active === 'false') return;
      var isVol = cls.volunteer === true || cls.volunteer === 'true';
      if (!isVol) return;
      var roles = _parse(cls.roles, []);
      if (!roles.length) return;
      if (!cls.bulkSchedule) return;
      var bs = cls.bulkSchedule;
      var fd = bs.fromDate || '';
      var td = bs.toDate   || '';
      if (!fd || !td) return;
      var startT = cls.defaultStart || '';
      var endT   = cls.defaultEnd   || '';
      if (!startT || !endT) return;
      var days = Array.isArray(bs.daysOfWeek)
        ? bs.daysOfWeek.map(function(n) { return parseInt(n, 10); })
        : [];
      if (!days.length) return;
      // Intersect the class's own range with the requested range
      var effFrom = fd > fromIso ? fd : fromIso;
      var effTo   = td < rangeTo ? td : rangeTo;
      if (effFrom > effTo) return;
      _eachDay(effFrom, effTo, function(iso, dow) {
        if (days.indexOf(dow) === -1) return;
        var id = 'vae-' + cls.id + '-' + iso.replace(/-/g, '');
        out.push({
          id: id,
          virtual: true,
          sourceActivityTypeId: cls.id,
          title: cls.name || '',
          titleIS: cls.nameIS || '',
          subtitle: cls.classTag || '',
          subtitleIS: cls.classTag || '',
          activityTypeId: cls.id,
          date: iso,
          startTime: startT,
          endTime: endT,
          leaderMemberId: cls.leaderMemberId || '',
          leaderName: cls.leaderName || '',
          leaderPhone: cls.leaderPhone || '',
          showLeaderPhone: cls.showLeaderPhone === true || cls.showLeaderPhone === 'true',
          reservedBoatIds: Array.isArray(cls.reservedBoatIds) ? cls.reservedBoatIds.map(String).filter(Boolean) : [],
          notes: '',
          notesIS: '',
          // Each virtual instance gets its own role ids so signups don't
          // collide across days for the same activity class.
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

  // Format a date string like "Wed, 15 Apr" using shared day/month
  // localization keys. Requires a global `s(key)` lookup function.
  function formatVolunteerDay(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    var dows = ['day.sun','day.mon','day.tue','day.wed','day.thu','day.fri','day.sat'];
    var months = ['month.jan','month.feb','month.mar','month.apr','month.may','month.jun',
                  'month.jul','month.aug','month.sep','month.oct','month.nov','month.dec'];
    var sFn = (typeof global.s === 'function') ? global.s : function(k) { return k; };
    return sFn(dows[d.getDay()]) + ', ' + d.getDate() + ' ' + sFn(months[d.getMonth()]);
  }

  // Format an event's time range like "14:00–16:00" (or just the start if
  // no end is set, or '' if neither is set).
  function formatVolunteerTime(ev) {
    var a = (ev && ev.startTime || '').slice(0, 5);
    var b = (ev && ev.endTime || '').slice(0, 5);
    if (a && b) return a + '–' + b;
    if (a) return a;
    return '';
  }

  // ──────────────────────────────────────────────────────────────────────
  // Shared volunteer-event card renderer
  //
  // Produces the HTML for a single volunteer event card. Used by both the
  // admin volunteer tab and the member-facing volunteer page so they stay
  // visually consistent. The caller supplies context — signups, members,
  // the escape/localize helpers, and callback names — so this function
  // stays free of direct DOM coupling.
  //
  // Required context fields:
  //   mode          — 'admin' | 'member'
  //   lang          — 'IS' | 'EN'
  //   signups       — array of volunteer_signups rows (for counts + chips)
  //   esc           — HTML-escape function
  //   s             — localized-string lookup function
  //   formatDay     — function(iso) → "Wed, 15 Apr"
  //   formatTime    — function(ev)  → "14:00–16:00"
  //
  // Admin-only context:
  //   members       — members array for live phone/consent lookup
  //   certDefs      — cert definitions (for endorsement labels)
  //   certDefName   — function(def) → localized name
  //   onCardClick   — name of a global fn taking (eventId) for card click
  //   onEditClick   — name of a global fn taking (eventId) for edit button
  //   onDeleteClick — name of a global fn taking (eventId) for delete button
  //
  // Member-only context:
  //   userKennitala — current user's kennitala (for isMine)
  //   myCerts       — member's cert array for allowed check
  //   onSignup      — name of a global fn taking (eventId, roleId)
  //   onWithdraw    — name of a global fn taking (signupId)
  function renderVolunteerCard(ev, ctx) {
    const esc  = ctx.esc;
    const s    = ctx.s;
    const L    = ctx.lang || 'EN';
    const mode = ctx.mode || 'member';

    const title    = (L === 'IS' && ev.titleIS ? ev.titleIS : ev.title) || ev.title || '';
    const subtitle = (L === 'IS' && ev.subtitleIS ? ev.subtitleIS : ev.subtitle) || ev.subtitle || '';
    const notes    = (L === 'IS' && ev.notesIS ? ev.notesIS : ev.notes) || ev.notes || '';
    const roles    = Array.isArray(ev.roles) ? ev.roles : [];
    // formatDay receives the full event so callers can render multi-day
    // ranges (ev.date → ev.endDate) as "Wed 15 Apr – Fri 17 Apr".
    const dayLbl   = ctx.formatDay  ? ctx.formatDay(ev) : (ev.date || '');
    const timeLbl  = ctx.formatTime ? ctx.formatTime(ev) : '';

    // Header row — date · title · subtype all on one line (flex-wrap for narrow screens)
    const headerHtml = '<div class="vp-card-head">'
      + '<span class="vp-card-date">' + esc(dayLbl) + (timeLbl ? ' · ' + esc(timeLbl) : '') + '</span>'
      + '<span class="vp-card-title">' + esc(title) + '</span>'
      + (subtitle ? '<span class="vp-card-subtitle">· ' + esc(subtitle) + '</span>' : '')
      + (mode === 'admin'
          ? '<div class="vp-card-actions">'
            + '<button class="row-edit" data-vp-action="edit" data-vp-fn="' + (ctx.onEditClick || '') + '" data-vp-event="' + ev.id + '">Edit</button>'
            + '<button class="row-del" data-vp-action="delete" data-vp-fn="' + (ctx.onDeleteClick || '') + '" data-vp-event="' + ev.id + '">×</button>'
            + '</div>'
          : '')
      + '</div>';

    // Leader chip
    const leaderHtml = ev.leaderName
      ? (function() {
          const phoneLink = (ev.leaderPhone && ev.showLeaderPhone)
            ? ' · <a href="tel:' + esc(ev.leaderPhone) + '" data-vp-nobubble>' + esc(ev.leaderPhone) + '</a>'
            : '';
          return '<div class="vp-card-leader">'
            + '<span>' + s('volunteer.inCharge') + ':</span>'
            + '<span class="vp-chip">' + esc(ev.leaderName) + phoneLink + '</span>'
            + '</div>';
        })()
      : '';

    const notesHtml = notes ? '<div class="vp-card-notes">' + esc(notes) + '</div>' : '';

    const rolesHtml = roles.length
      ? roles.map(function(r) { return renderVolunteerRole(ev, r, ctx); }).join('')
      : '<div class="vp-card-notes">' + s('admin.noRoles') + '</div>';

    const cardClass = 'vp-card' + (mode === 'admin' ? ' admin' : '');
    const cardAttrs = mode === 'admin' && ctx.onCardClick
      ? 'class="' + cardClass + '" data-vp-action="card" data-vp-fn="' + ctx.onCardClick + '" data-vp-event="' + ev.id + '"'
      : 'class="' + cardClass + '"';

    return '<div ' + cardAttrs + '>'
      + headerHtml
      + leaderHtml
      + notesHtml
      + rolesHtml
      + '</div>';
  }

  function renderVolunteerRole(ev, role, ctx) {
    const esc  = ctx.esc;
    const s    = ctx.s;
    const L    = ctx.lang || 'EN';
    const mode = ctx.mode || 'member';

    const rn   = (L === 'IS' && role.nameIS ? role.nameIS : role.name) || role.name || '';
    const desc = (L === 'IS' && role.descriptionIS ? role.descriptionIS : role.description) || '';

    const signups = (ctx.signups || []).filter(function(su) {
      return su.eventId === ev.id && su.roleId === role.id;
    });
    const filled = signups.length;
    const total  = Number(role.slots) || 0;
    const isFull = total > 0 && filled >= total;
    const pct    = total > 0 ? Math.min(100, Math.round(filled / total * 100)) : 0;

    // Endorsement label
    let endorseHtml = '';
    if (role.requiredEndorsement) {
      const def = (ctx.certDefs || []).find(function(d) { return d && d.id === role.requiredEndorsement; });
      const name = (def && ctx.certDefName) ? ctx.certDefName(def) : role.requiredEndorsement;
      endorseHtml = '<span class="vp-role-endorse">[' + esc(name) + ']</span>';
    }

    // Signup chips — in admin mode, do a live phone/consent lookup on
    // ctx.members; in member mode, "me" replaces own name.
    const chipsHtml = signups.map(function(su) {
      if (mode === 'admin') {
        const mem = (ctx.members || []).find(function(m) {
          return String(m.kennitala) === String(su.kennitala);
        });
        let showPhone = false;
        let phone = '';
        if (mem) {
          phone = mem.phone || '';
          let prefs = {};
          try { prefs = JSON.parse(mem.preferences || '{}'); } catch (e) { prefs = {}; }
          showPhone = prefs.sharePhoneVolunteer === true || prefs.sharePhoneVolunteer === 'true';
        }
        const phoneHtml = (showPhone && phone)
          ? ' · <a href="tel:' + esc(phone) + '" data-vp-nobubble>' + esc(phone) + '</a>'
          : '';
        return '<span class="vp-chip">' + esc(su.name || '—') + phoneHtml + '</span>';
      } else {
        const isMine = ctx.userKennitala && String(su.kennitala) === String(ctx.userKennitala);
        const label  = isMine ? s('volunteer.me') : (su.name || '—');
        return '<span class="vp-chip' + (isMine ? ' me' : '') + '">' + esc(label) + '</span>';
      }
    }).join('');

    // Action button (member mode only)
    let actionHtml = '';
    if (mode === 'member') {
      const mySignup = signups.find(function(su) {
        return ctx.userKennitala && String(su.kennitala) === String(ctx.userKennitala);
      });
      const allowed = memberCanTakeRole(role, ctx.myCerts || []);
      if (mySignup) {
        actionHtml = '<button class="vp-btn signed-up" data-vp-action="withdraw" data-vp-fn="'
          + (ctx.onWithdraw || '') + '" data-vp-signup="' + mySignup.id + '">'
          + s('member.volWithdraw') + '</button>';
      } else if (!allowed) {
        actionHtml = '<span class="vp-role-note">' + s('member.volNeedsEndorsement') + '</span>';
      } else if (isFull) {
        actionHtml = '<span class="vp-role-note full">' + s('member.volFull') + '</span>';
      } else {
        actionHtml = '<button class="vp-btn" data-vp-action="signup" data-vp-fn="'
          + (ctx.onSignup || '') + '" data-vp-event="' + ev.id + '" data-vp-role="' + role.id + '">'
          + s('member.volSignUp') + '</button>';
      }
    }

    // Description visibility
    //   admin  → always visible (no toggle)
    //   member → hidden by default, expanded on click of the role head
    const descId = 'vr-desc-' + ev.id + '-' + role.id;
    let descHtml = '';
    let headClass = 'vp-role-head';
    let headClick = '';
    if (desc) {
      if (mode === 'admin') {
        descHtml = '<div class="vp-role-desc">' + esc(desc) + '</div>';
      } else {
        descHtml = '<div class="vp-role-desc" id="' + descId + '" style="display:none">' + esc(desc) + '</div>';
        headClass += ' clickable';
        headClick = ' data-vp-action="toggle-desc" data-vp-desc="' + descId + '"';
      }
    }

    const statusText = (total > 0 ? (filled + '/' + total) : (filled + '/∞'));

    return '<div class="vp-role">'
      + '<div class="' + headClass + '"' + headClick + '>'
      + '<div class="vp-role-main">'
      + '<span class="vp-role-name">' + esc(rn) + '</span>'
      + '<div class="vp-bar"><div class="vp-bar-fill' + (isFull ? ' full' : '') + '" style="width:' + pct + '%"></div></div>'
      + '<span class="vp-role-status">' + statusText + '</span>'
      + endorseHtml
      + chipsHtml
      + '</div>'
      + (actionHtml ? '<div>' + actionHtml + '</div>' : '')
      + '</div>'
      + descHtml
      + '</div>';
  }

  // Toggles a hidden description panel. Invoked by the delegated click
  // handler below when the user clicks a role head marked
  // data-vp-action="toggle-desc".
  function _volToggleRoleDesc(e, descId) {
    if (e && e.stopPropagation) e.stopPropagation();
    const el = (typeof document !== 'undefined') ? document.getElementById(descId) : null;
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  // Delegated click handler for card actions (replaces inline onclick=
  // attrs in the render templates, which CSP blocks under strict
  // script-src). Attached once per document; looks up the handler by
  // function name on the global object.
  const VP_CARD_ACTIONS = { signup:1, withdraw:1, edit:1, delete:1, card:1, 'toggle-desc':1 };
  if (typeof document !== 'undefined' && !document._volCardListener) {
    document._volCardListener = true;
    document.addEventListener('click', function(e) {
      // tel: links etc. shouldn't trigger card actions from above
      if (e.target.closest('[data-vp-nobubble]')) return;
      const el = e.target.closest('[data-vp-action]');
      if (!el) return;
      const action = el.dataset.vpAction;
      if (!VP_CARD_ACTIONS[action]) return;
      e.stopPropagation();
      if (action === 'toggle-desc') {
        _volToggleRoleDesc(e, el.dataset.vpDesc);
        return;
      }
      const fn = el.dataset.vpFn;
      if (!fn || typeof global[fn] !== 'function') return;
      switch (action) {
        case 'signup':   global[fn](el.dataset.vpEvent, el.dataset.vpRole); break;
        case 'withdraw': global[fn](el.dataset.vpSignup); break;
        case 'edit':
        case 'delete':
        case 'card':     global[fn](el.dataset.vpEvent); break;
      }
    });
  }

  global.expandVolunteerActivityTypes = expandVolunteerActivityTypes;
  global.mergeVolunteerEvents         = mergeVolunteerEvents;
  global.memberCanTakeRole            = memberCanTakeRole;
  global.formatVolunteerDay           = formatVolunteerDay;
  global.formatVolunteerTime          = formatVolunteerTime;
  global.renderVolunteerCard          = renderVolunteerCard;
  global.renderVolunteerRole          = renderVolunteerRole;
  global._volToggleRoleDesc           = _volToggleRoleDesc;
})(typeof window !== 'undefined' ? window : this);
