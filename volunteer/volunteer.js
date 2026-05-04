prefetch({Config:['getConfig'],VolSignups:{post:'getVolunteerSignups'}});

// ══ STATE ════════════════════════════════════════════════════════════════════
const user = requireAuth();
let _volEvents = [];
let _volSignups = [];
let _volActTypes = [];
let _volCertDefs = [];
let _vpView = 'list';
let _vpMonth = (function() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();
let _vpDayModalIso = null;
let _myCerts = [];
let _vpListFilter = 'all'; // 'all' | 'mine'
const VP_LIST_PAGE = 20;
let _vpListShown  = VP_LIST_PAGE;

// ══ INIT ═════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  buildHeader('volunteer');
  applyStrings();

  try { _myCerts = user && user.certifications
    ? (typeof user.certifications === 'string' ? JSON.parse(user.certifications) : user.certifications)
    : []; } catch(e) { _myCerts = []; }

  try {
    const [cfgRes, suRes] = await Promise.all([
      window._earlyConfig || apiGet('getConfig'),
      window._earlyVolSignups || apiPost('getVolunteerSignups', {}),
    ]);
    _volActTypes = cfgRes.activityTemplates || [];
    // Defense-in-depth: hide materialized events whose source activity type is
    // missing, inactive, or no longer volunteer-flagged. Manually-created
    // events (no sourceActivityTypeId) are shown regardless. Mirrors the
    // admin volunteer-tab filter so stale data never leaks through.
    const _vpActiveAtIds = new Set((_volActTypes || [])
      .filter(a => a && a.active !== false && a.active !== 'false'
                   && (a.volunteer === true || a.volunteer === 'true'))
      .map(a => a.id));
    _volEvents = (cfgRes.volunteerEvents || []).filter(e => {
      if (!e || e.active === false) return false;
      if (e.sourceActivityTypeId) return _vpActiveAtIds.has(e.sourceActivityTypeId);
      return true;
    });
    _volCertDefs = (typeof certDefsFromConfig === 'function'
      ? certDefsFromConfig(cfgRes.certDefs || [])
      : (cfgRes.certDefs || []));
    _volSignups  = (suRes && suRes.signups) || [];
  } catch(e) {
    document.getElementById('vpListContainer').innerHTML =
      '<div class="empty-note text-red">' + s('toast.loadFailed') + ': ' + esc(e.message) + '</div>';
    return;
  }

  renderVpList();
  renderVpCalendar();
});

// ══ TAB SWITCHING ════════════════════════════════════════════════════════════
function showVpTab(tab) {
  _vpView = tab;
  document.querySelectorAll('.vp-tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.getElementById('vpTab-list').classList.toggle('hidden', tab !== 'list');
  document.getElementById('vpTab-calendar').classList.toggle('hidden', tab !== 'calendar');
  if (tab === 'calendar') renderVpCalendar();
}

// ══ HELPERS ══════════════════════════════════════════════════════════════════
function getMergedEvents(rangeFrom, rangeTo) {
  const virtual = (typeof expandVolunteerActivityTypes === 'function')
    ? expandVolunteerActivityTypes(_volActTypes || [], rangeFrom || null, rangeTo || null)
    : [];
  return (typeof mergeVolunteerEvents === 'function')
    ? mergeVolunteerEvents(_volEvents, virtual)
    : _volEvents.concat(virtual);
}

function localizedTitle(ev) {
  const L = getLang();
  return (L === 'IS' && ev.titleIS ? ev.titleIS : ev.title) || ev.title || '';
}

// Date/time formatters live in shared/dateutil.js:
//   formatDayLabel(iso), formatEventDateLabel(ev), formatTimeRange(ev)

// The effective end date for ordering/filtering purposes.
function _evEndIso(ev) {
  if (ev && ev.endDate && ev.endDate > (ev.date || '')) return ev.endDate;
  return ev ? (ev.date || '') : '';
}

function isMineSignup(su) {
  return user && String(su.kennitala) === String(user.kennitala);
}

// Local-time ISO date (YYYY-MM-DD) — avoids UTC drift on non-zero offsets
function _localIso(d) {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}
function _todayIso() { return _localIso(new Date()); }

// ══ LIST VIEW ════════════════════════════════════════════════════════════════
function vpSetFilter(mode) {
  _vpListFilter = mode;
  _vpListShown  = VP_LIST_PAGE;
  document.getElementById('vpFilterAll').classList.toggle('active',  mode === 'all');
  document.getElementById('vpFilterMine').classList.toggle('active', mode === 'mine');
  renderVpList();
}

function _vpEventHasMine(ev) {
  const roles = Array.isArray(ev.roles) ? ev.roles : [];
  return _volSignups.some(function(su) {
    return su.eventId === ev.id && isMineSignup(su)
      && roles.some(function(r) { return r.id === su.roleId; });
  });
}

function vpShowMore() {
  _vpListShown += VP_LIST_PAGE;
  renderVpList();
}

function _vpGetSortedUpcoming() {
  const today = _todayIso();
  // Expand one year out — enough for any reasonable season and bounded so
  // clients don't iterate huge bulk schedules day-by-day.
  const end = new Date();
  end.setDate(end.getDate() + 365);
  const toIso = _localIso(end);
  const merged = getMergedEvents(today, toIso);
  let upcoming = merged
    // An event is "upcoming" if any part of its span is today or later.
    .filter(function(e) { return _evEndIso(e) >= today; })
    .sort(function(a, b) {
      return (a.date || '').localeCompare(b.date || '')
        || (a.startTime || '').localeCompare(b.startTime || '');
    });
  if (_vpListFilter === 'mine') {
    upcoming = upcoming.filter(_vpEventHasMine);
  }
  return upcoming;
}

function renderVpList() {
  const container = document.getElementById('vpListContainer');
  if (!container) return;
  const upcoming = _vpGetSortedUpcoming();
  if (!upcoming.length) {
    const emptyKey = _vpListFilter === 'mine' ? 'volunteer.noMyEvents' : 'member.noVolEvents';
    container.innerHTML = '<div class="vp-empty">' + s(emptyKey) + '</div>';
    return;
  }
  const visible = upcoming.slice(0, _vpListShown);
  let html = visible.map(renderVpCard).join('');
  if (upcoming.length > _vpListShown) {
    const remaining = upcoming.length - _vpListShown;
    html += '<div style="text-align:center;padding:6px 0 2px">'
      + '<button class="vp-btn" data-vp-action="show-more">'
      + esc(s('volunteer.showMore').replace('{n}', remaining))
      + '</button></div>';
  }
  container.innerHTML = html;
}

// Delegate to the shared volunteer card renderer so /volunteer/ and
// /admin/ stay visually consistent. The shared helper handles the
// date · title · subtype header line, a leader chip badge, inline
// signup chips next to the progress bar, and an on-click role
// description (member mode).
function renderVpCard(ev) {
  return renderVolunteerCard(ev, {
    mode: 'member',
    lang: getLang(),
    signups: _volSignups,
    certDefs: _volCertDefs,
    certDefName: (typeof certDefName === 'function') ? certDefName : function(d) { return d && (d.name || d.id) || ''; },
    esc: esc,
    s: s,
    formatDay: formatEventDateLabel,
    formatTime: formatTimeRange,
    userKennitala: user && user.kennitala,
    myCerts: _myCerts,
    onSignup: 'vpSignup',
    onWithdraw: 'vpWithdraw',
  });
}

// ══ CALENDAR VIEW ════════════════════════════════════════════════════════════
function renderVpCalendar() {
  const grid = document.getElementById('vpCalGrid');
  const titleEl = document.getElementById('vpCalTitle');
  if (!grid || !titleEl) return;

  const y = _vpMonth.y, m = _vpMonth.m;
  const monthKeys = ['month.jan','month.feb','month.mar','month.apr','month.may','month.jun',
                     'month.jul','month.aug','month.sep','month.oct','month.nov','month.dec'];
  titleEl.textContent = s(monthKeys[m]) + ' ' + y;

  // Day-of-week header (Mon-first)
  const dowKeys = ['day.mon','day.tue','day.wed','day.thu','day.fri','day.sat','day.sun'];
  let html = dowKeys.map(function(k) { return '<div class="vp-cal-dow">' + s(k) + '</div>'; }).join('');

  // Compute first cell: shift so Monday is column 0
  const first = new Date(y, m, 1);
  const dow0 = (first.getDay() + 6) % 7; // Mon=0..Sun=6
  const startDate = new Date(y, m, 1 - dow0);

  // Always render 6 rows × 7 cols = 42 cells
  const todayIso = _todayIso();

  // Range for events (whole grid)
  const lastDate = new Date(startDate);
  lastDate.setDate(lastDate.getDate() + 41);
  const fromIso = _localIso(startDate);
  const toIso   = _localIso(lastDate);
  const merged  = getMergedEvents(fromIso, toIso);

  // Bucket events by date. Multi-day events are placed on every day in their
  // span (inclusive of start and end). `_vpCalSpanInfo` is attached per-bucket
  // so the day cell can render "start"/"mid"/"end" markers if desired.
  const byDate = {};
  function _pushBucket(iso, ev, pos) {
    if (!byDate[iso]) byDate[iso] = [];
    byDate[iso].push({ ev: ev, pos: pos });
  }
  merged.forEach(function(ev) {
    if (!ev.date) return;
    const startIso = ev.date;
    const endIso = (ev.endDate && ev.endDate > startIso) ? ev.endDate : startIso;
    if (startIso === endIso) {
      _pushBucket(startIso, ev, 'only');
      return;
    }
    // Iterate every day in [startIso, endIso].
    const a = new Date(startIso + 'T00:00:00');
    const b = new Date(endIso + 'T00:00:00');
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
      const iso = _localIso(d);
      const pos = iso === startIso ? 'start' : (iso === endIso ? 'end' : 'mid');
      _pushBucket(iso, ev, pos);
    }
  });
  Object.keys(byDate).forEach(function(k) {
    byDate[k].sort(function(a, b) { return (a.ev.startTime || '').localeCompare(b.ev.startTime || ''); });
  });

  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const iso = _localIso(d);
    const isOther = d.getMonth() !== m;
    const isToday = iso === todayIso;
    const evs = byDate[iso] || [];

    let evsHtml = '';
    let dayHasMine = false;
    const maxShow = 2;
    evs.slice(0, maxShow).forEach(function(entry) {
      const ev = entry.ev;
      const pos = entry.pos;
      const cls = vpEventCls(ev);
      const isMine = cls === 'mine';
      if (isMine) dayHasMine = true;
      // Only show the time on the first day of a multi-day span; on middle
      // and end days show a "…" continuation marker in place of the time.
      const t = (ev.startTime || '').slice(0, 5);
      let prefix;
      if (pos === 'start' || pos === 'only') prefix = t ? t + ' ' : '';
      else if (pos === 'end') prefix = '…';
      else prefix = '…';
      const lbl = prefix + localizedTitle(ev);
      const titleAttr = (isMine ? s('volunteer.youSignedUp') + ' · ' : '') + lbl;
      const checkHtml = isMine ? '<span class="vp-cal-ev-check">\u2713</span>' : '';
      const spanCls = pos !== 'only' ? ' vp-cal-ev-span vp-cal-ev-span-' + pos : '';
      evsHtml += '<span class="vp-cal-ev ' + cls + spanCls + '" data-vp-open-day="' + iso + '" title="' + esc(titleAttr) + '">'
        + checkHtml + esc(lbl) + '</span>';
    });
    // Also detect "mine" in hidden overflow events so the day dot still appears
    if (!dayHasMine && evs.length > maxShow) {
      for (let j = maxShow; j < evs.length; j++) {
        if (vpEventCls(evs[j].ev) === 'mine') { dayHasMine = true; break; }
      }
    }
    if (evs.length > maxShow) {
      evsHtml += '<span class="vp-cal-ev-more" data-vp-open-day="' + iso + '">+'
        + (evs.length - maxShow) + ' ' + s('volunteer.more') + '</span>';
    }

    html += '<div class="vp-cal-day' + (isOther ? ' other-month' : '') + (isToday ? ' today' : '')
      + (dayHasMine ? ' has-mine' : '') + '"'
      + (evs.length ? ' data-vp-open-day="' + iso + '"' : '') + '>'
      + '<div class="vp-cal-day-num">' + d.getDate() + '</div>'
      + evsHtml
      + '</div>';
  }
  grid.innerHTML = html;
}

function vpEventCls(ev) {
  const roles = Array.isArray(ev.roles) ? ev.roles : [];
  let totalSlots = 0, totalFilled = 0;
  let mineHere = false;
  roles.forEach(function(r) {
    const slots = Number(r.slots) || 0;
    totalSlots += slots;
    const su = _volSignups.filter(function(s) { return s.eventId === ev.id && s.roleId === r.id; });
    totalFilled += su.length;
    if (su.some(isMineSignup)) mineHere = true;
  });
  if (mineHere) return 'mine';
  if (totalSlots > 0 && totalFilled >= totalSlots) return 'full';
  return '';
}

function vpShiftMonth(delta) {
  let m = _vpMonth.m + delta;
  let y = _vpMonth.y;
  while (m < 0)  { m += 12; y--; }
  while (m > 11) { m -= 12; y++; }
  _vpMonth = { y: y, m: m };
  renderVpCalendar();
}

function vpJumpToday() {
  const d = new Date();
  _vpMonth = { y: d.getFullYear(), m: d.getMonth() };
  renderVpCalendar();
}

// ══ DAY MODAL ════════════════════════════════════════════════════════════════
function vpOpenDay(iso) {
  _vpDayModalIso = iso;
  vpRenderDayModal();
  openModal('vpDayModal');
}

function vpRenderDayModal() {
  const iso = _vpDayModalIso;
  if (!iso) return;
  // Pull the full upcoming range so we catch multi-day events whose span
  // overlaps this day but whose start date lies outside [iso, iso].
  const end = new Date();
  end.setDate(end.getDate() + 365);
  const merged = getMergedEvents(_localIso(new Date(new Date().getFullYear() - 1, 0, 1)), _localIso(end));
  const evs = merged
    .filter(function(e) {
      const startIso = e.date || '';
      if (!startIso) return false;
      const endIso = (e.endDate && e.endDate > startIso) ? e.endDate : startIso;
      return startIso <= iso && iso <= endIso;
    })
    .sort(function(a, b) { return (a.startTime || '').localeCompare(b.startTime || ''); });
  document.getElementById('vpDayModalTitle').textContent = formatDayLabel(iso);
  const body = document.getElementById('vpDayModalBody');
  if (!evs.length) {
    body.innerHTML = '<div class="vp-empty">' + s('volunteer.noEventsThisDay') + '</div>';
  } else {
    body.innerHTML = evs.map(renderVpCard).join('');
  }
}

// ══ SIGNUP / WITHDRAW ════════════════════════════════════════════════════════
async function vpSignup(eventId, roleId) {
  if (!user) return;
  try {
    const payload = {
      eventId: eventId,
      roleId: roleId,
      kennitala: user.kennitala,
      name: user.name || '',
    };
    if (String(eventId).indexOf('vae-') === 0) {
      const today = _todayIso();
      const virt = (typeof expandVolunteerActivityTypes === 'function')
        ? expandVolunteerActivityTypes(_volActTypes || [], today, null)
        : [];
      const src = virt.find(function(e) { return e.id === eventId; });
      if (src) payload.virtualEvent = src;
    }
    const res = await apiPost('volunteerSignup', payload);
    _volSignups.push(res.signup || { id: res.id, eventId: eventId, roleId: roleId, kennitala: user.kennitala, name: user.name });
    refreshVpViews();
    showToast(s('toast.saved'));
  } catch(e) {
    showToast(e.message, 'err');
  }
}

async function vpWithdraw(signupId) {
  try {
    await apiPost('volunteerWithdraw', { id: signupId });
    _volSignups = _volSignups.filter(function(su) { return su.id !== signupId; });
    refreshVpViews();
    showToast(s('toast.saved'));
  } catch(e) {
    showToast(e.message, 'err');
  }
}

function refreshVpViews() {
  renderVpList();
  renderVpCalendar();
  const dayModal = document.getElementById('vpDayModal');
  if (dayModal && !dayModal.classList.contains('hidden')) {
    vpRenderDayModal();
  }
}

// ── Event wiring (replaces inline onclick= attrs; CSP blocks those) ──────────
document.querySelectorAll('.vp-tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() { showVpTab(btn.dataset.tab); });
});
document.getElementById('vpFilterAll').addEventListener('click', function() { vpSetFilter('all'); });
document.getElementById('vpFilterMine').addEventListener('click', function() { vpSetFilter('mine'); });
document.querySelector('[data-vp-nav="prev"]').addEventListener('click', function() { vpShiftMonth(-1); });
document.querySelector('[data-vp-nav="today"]').addEventListener('click', vpJumpToday);
document.querySelector('[data-vp-nav="next"]').addEventListener('click', function() { vpShiftMonth(1); });

var _vpDayModalEl = document.getElementById('vpDayModal');
_vpDayModalEl.addEventListener('click', function(e) {
  if (e.target === _vpDayModalEl) closeModal('vpDayModal');
});
_vpDayModalEl.querySelector('.modal-close-x').addEventListener('click', function() { closeModal('vpDayModal'); });

// Delegation for dynamically-rendered [data-vp-open-day] and show-more.
document.addEventListener('click', function(e) {
  var openDay = e.target.closest('[data-vp-open-day]');
  if (openDay) { vpOpenDay(openDay.dataset.vpOpenDay); return; }
  var more = e.target.closest('[data-vp-action="show-more"]');
  if (more) { vpShowMore(); }
});
