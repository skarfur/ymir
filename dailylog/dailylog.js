// ════════════════════════════════════════════════════════════════════════════
// SECTION 1 — AUTH + CONSTANTS
// ════════════════════════════════════════════════════════════════════════════
const user  = requireAuth(isStaff);
const L     = getLang();
const TODAY = todayISO();

function esc(s) {
  return (s == null ? '' : String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2 — STATE
// ════════════════════════════════════════════════════════════════════════════
let viewDate  = TODAY;
let logId     = null;
let dirty     = false;
// Tracks whether the loaded day was signed off when fetched. Drives the
// "edit as an amendment?" confirm prompt so the user knows they're amending
// a finalized log rather than editing a draft.
let logSignedOff   = false;
let logSignedOffBy = '';
let logSignedOffAt = '';
let wxData    = null;
let wxLog     = [];
let amChecks  = {};
let pmChecks  = {};
let amItems   = [];
let pmItems   = [];
let activities    = [];
let activityTypes = [];
let tripsData     = [];
let tideData      = {};
let _selectedActType = null;
// Collapse state for the morning/evening checklists. Morning defaults
// expanded on today, collapsed otherwise; evening starts collapsed and pops
// open automatically when the morning list is fully ticked.
let amOpen = true;
let pmOpen = false;

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4 — DOM REFS
// ════════════════════════════════════════════════════════════════════════════
const dom = domRefs({
  mainWrap:          'mainWrap',
  dateBig:           'dateBig',
  dateHero:          'dateHero',
  prevBtn:           'prevBtn',
  nextBtn:           'nextBtn',
  todayBtn:          'todayBtn',
  datePicker:        'datePicker',
  signoffBadge:      'signoffBadge',
  readonlyBadge:     'readonlyBadge',
  logWxBtn:          'logWxBtn',
  logWxDesc:         'logWxDesc',
  wxLogList:         'wxLogList',
  wxLogCount:        'wxLogCount',
  tripsCard:         'tripsCard',
  tripsCount:        'tripsCount',
  amSection:         'amSection',
  pmSection:         'pmSection',
  amProgressChip:    'amProgressChip',
  pmProgressChip:    'pmProgressChip',
  amCard:            'amCard',
  pmCard:            'pmCard',
  activitiesCard:    'activitiesCard',
  activitiesEmpty:   'activitiesEmpty',
  activitiesList:    'activitiesList',
  narrativeInput:    'narrativeInput',
  incidentContainer: 'incidentContainer',
  incidentHeading:   'incidentHeading',
  saveMsg:           'saveMsg',
  signOffBtn:        'signOffBtn',
  actTypeBtns:       'actTypeBtns',
  actName:           'actName',
  actStart:          'actStart',
  actEnd:            'actEnd',
  actParticipants:   'actParticipants',
  actNotes:          'actNotes',
  activityModal:     'activityModal',
  addActivityBtn:    'addActivityBtn',
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5 — RENDER
// ════════════════════════════════════════════════════════════════════════════
function renderTrips() {
  const spinner = '<div class="empty-state"><span class="spinner"></span></div>';
  if (!tripsData.length) {
    dom.tripsCard.innerHTML = `<div class="empty-state">${s('daily.noTrips')}</div>`;
    dom.tripsCount.textContent = '';
    return;
  }
  dom.tripsCount.textContent = `(${tripsData.length})`;
  replaceWithFragment(dom.tripsCard, tripsData, co => {
    const row   = document.createElement('div');
    row.className = 'trip-row';
    row.dataset.tripId = co.id;
    const tout  = sstr(co.checkedOutAt||co.timeOut).slice(0,5);
    const tin   = sstr(co.checkedInAt ||co.timeIn).slice(0,5);
    const retBy = sstr(co.expectedReturn).slice(0,5);
    const overdue = retBy && !tin && retBy < fmtTimeNow();
    row.innerHTML = `<div class="flex-1">
      <div class="trip-boat">${esc(co.boatName||co.boatId)}
        ${co.memberIsMinor ? `<span class="badge badge-yellow" style="margin-left:6px">${s('lbl.minor')}</span>` : ''}
      </div>
      <div class="trip-meta">${esc(co.memberName||'')}${co.locationName ? ' · '+esc(co.locationName) : ''}${co.crew && co.crew > 1 ? ' · '+co.crew+' '+s('lbl.crew').toLowerCase() : ''}</div>
    </div>
    <div class="trip-times">
      <div>${tout || '—'}</div>
      ${tin ? `<div class="text-green">${tin}</div>` : (retBy ? `<div class="${overdue?'text-red':'text-muted'}">↩${retBy}</div>` : '')}
    </div>`;
    return row;
  });
}

function renderChecklists() {
  renderCL(dom.amCard, amItems, amChecks, 'am');
  renderCL(dom.pmCard, pmItems, pmChecks, 'pm');
  applyChecklistOpenState();
}

function clCountsFor(prefix) {
  const items = prefix === 'am' ? amItems : pmItems;
  const state = prefix === 'am' ? amChecks : pmChecks;
  const done  = items.filter(i => state[i.id]).length;
  return { done, total: items.length };
}

function applyChecklistOpenState() {
  if (dom.amSection) dom.amSection.classList.toggle('collapsed', !amOpen);
  if (dom.pmSection) dom.pmSection.classList.toggle('collapsed', !pmOpen);
  updateChecklistChips();
}

function updateChecklistChips() {
  ['am','pm'].forEach(p => {
    const chip = p === 'am' ? dom.amProgressChip : dom.pmProgressChip;
    if (!chip) return;
    const c = clCountsFor(p);
    chip.textContent = c.total ? (c.done + ' / ' + c.total) : '';
    chip.classList.toggle('done', c.total > 0 && c.done === c.total);
  });
}

function toggleChecklist(prefix) {
  if (prefix === 'am') {
    amOpen = !amOpen;
    // When collapsing morning, surface the evening list so the user has
    // somewhere to go next — but don't auto-open if they're just glancing.
    if (!amOpen) pmOpen = true;
  } else {
    pmOpen = !pmOpen;
  }
  applyChecklistOpenState();
}

function renderCL(card, items, state, prefix) {
  const done = items.filter(i => state[i.id]).length;
  const pct  = items.length ? Math.round(done / items.length * 100) : 0;
  card.innerHTML = '';
  const prog = document.createElement('div');
  prog.className = 'cl-progress-line';
  prog.innerHTML = `<span>${done}</span> / ${items.length} complete`;
  const barWrap = document.createElement('div'); barWrap.className = 'cl-bar-wrap';
  const bar = document.createElement('div'); bar.className = 'cl-bar'; bar.style.width = pct + '%';
  barWrap.appendChild(bar); card.appendChild(prog); card.appendChild(barWrap);
  items.forEach(it => {
    const row = document.createElement('label');
    row.className = 'checklist-item' + (state[it.id] ? ' done' : '');
    row.dataset.toggle = '1'; row.dataset.prefix = prefix; row.dataset.itemId = it.id;
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!state[it.id];
    const txt = document.createElement('span'); txt.className = 'item-text';
    txt.textContent = L === 'IS' && it.textIS ? it.textIS : it.textEN;
    row.appendChild(cb); row.appendChild(txt); card.appendChild(row);
  });
}


function renderActivities() {
  dom.activitiesEmpty.style.display = activities.length ? 'none' : '';
  replaceWithFragment(dom.activitiesList, activities, act => {
    const row = document.createElement('div');
    row.className = 'activity-row activity-row-edit';
    row.dataset.editActivity = act.id;
    const info = document.createElement('div'); info.className = 'activity-info';
    const meta = [act.type, act.subtypeName||'', act.start && act.end ? act.start+'\u2013'+act.end : act.start, act.participants].filter(Boolean).join(' \u00b7 ');
    const ablerBadge  = act.ablerRegistered ? '<span style="font-size:9px;background:color-mix(in srgb, var(--moss) 12%, transparent);border:1px solid color-mix(in srgb, var(--moss) 40%, transparent);color:var(--moss);border-radius:10px;padding:1px 7px;margin-left:6px;letter-spacing:.3px">Abler ✓</span>' : '';
    // Scheduled-from-template badge intentionally suppressed for now — the
    // `act.scheduled` flag is still set by the projection so the data is
    // there, just not surfaced. Bring back by restoring the badge below.
    const scheduledBadge = '';
    const editedBadge = act.editedBy ? (() => {
      const when = act.editedAt ? (fmtDate(act.editedAt) + ' ' + fmtTime(act.editedAt)) : '';
      const tip = s('daily.editedByTip', { name: act.editedBy, when: when });
      return '<span class="activity-edited-badge" title="' + esc(tip) + '">' + s('daily.edited') + '</span>';
    })() : '';
    const linkedCount = act.linkedGroupCheckoutIds && act.linkedGroupCheckoutIds.length
      ? '<span style="font-size:9px;background:var(--card);border:1px solid color-mix(in srgb, var(--navy) 33%, transparent);border-left:2px solid var(--navy);border-radius:4px;padding:1px 7px;margin-left:4px">⛵ ' + act.linkedGroupCheckoutIds.length + ' ' + (act.linkedGroupCheckoutIds.length>1?s('daily.groups'):s('daily.group')) + '</span>' : '';
    // Two distinct notes surfaces, matching the bifurcation in the activity
    // modal: `notes` is the pre-execution brief (intent / context, often
    // inherited from the template) shown muted; `runNotes` is the
    // post-execution record authored in the daily log, shown prominently.
    const briefHtml = act.notes
      ? `<div class="activity-note activity-note-brief">${esc(act.notes)}</div>`
      : '';
    const recordHtml = act.runNotes
      ? `<div class="activity-note activity-note-record">${esc(act.runNotes)}</div>`
      : '';
    info.innerHTML = `<div class="activity-name">${esc(act.name)}${scheduledBadge}${ablerBadge}${editedBadge}${linkedCount}</div>
      <div class="activity-meta">${esc(meta)}</div>
      ${briefHtml}${recordHtml}`;
    const del = document.createElement('button');
    del.className = 'del-btn'; del.dataset.deleteActivity = act.id; del.innerHTML = '&times;';
    row.appendChild(info); row.appendChild(del);
    return row;
  });
}

// ── Incident helpers — fully bilingual ───────────────────────────────────────
// Older rows in the incidents sheet were written double-stringified (see the
// createIncident_ backend fix), so a single JSON.parse yields a string. Peel
// until we reach an array and return that, otherwise an empty array.
function _dlParseIncidentTypes(v) {
  if (v == null || v === '') return [];
  let cur = v;
  for (let i = 0; i < 3 && typeof cur === 'string'; i++) {
    try { cur = JSON.parse(cur); } catch(e) { return []; }
  }
  return Array.isArray(cur) ? cur : [];
}

// Cache the incidents shown under a given daily log so the click handler can
// look up the row without another network call.
let _dlIncidentsById = {};

function renderIncidentSection(incidents) {
  const container = dom.incidentContainer;
  const heading   = dom.incidentHeading;
  _dlIncidentsById = {};
  if (!incidents || !incidents.length) {
    heading.textContent = s('daily.incidentReport');
    container.innerHTML = `<div class="content-card text-muted text-md">${s('daily.noIncidents')}</div>`;
    return;
  }
  heading.textContent = `${s('daily.incidentReport')} · ${incidents.length}`;
  container.innerHTML = incidents.map(inc => {
    _dlIncidentsById[inc.id] = inc;
    const typeList = _dlParseIncidentTypes(inc.types);
    const typeLabels = typeList
      .map(function(k) { return s('incident.type.' + k) || k; })
      .join(', ');
    const dateStr = inc.date || sstr(inc.filedAt).slice(0,10);
    const timeStr = inc.time || sstr(inc.filedAt).slice(11,16);
    const sevLabel = inc.severity ? (s('incident.sev.'+inc.severity) || inc.severity) : '';
    const sevClass = inc.severity === 'critical' ? 'red'
      : inc.severity === 'high' ? 'orange'
      : inc.severity === 'medium' ? 'yellow'
      : inc.severity === 'low' ? 'green'
      : 'muted';
    const resolved = inc.resolved && inc.resolved !== 'false';
    const inReview = !resolved && inc.status === 'review';
    const statusLabel = resolved ? s('incident.resolved')
      : inReview ? s('incident.statusReview')
      : s('incident.open');
    const statusClass = resolved ? 'green' : (inReview ? 'orange' : 'yellow');
    const descStr = sstr(inc.description);
    const desc = descStr.slice(0,140);
    const descMore = descStr.length > 140 ? '…' : '';
    return `<div class="incident-btn" style="align-items:flex-start" data-incident-id="${esc(inc.id)}">
      <div style="flex:1;font-size:12px;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="fw-500">${esc(typeLabels || inc.title || '')}</span>
          ${sevLabel ? `<span class="badge badge-${sevClass}">${esc(sevLabel)}</span>` : ''}
          <span class="badge badge-${statusClass}">${esc(statusLabel)}</span>
        </div>
        <div class="text-muted" style="margin-top:3px">${esc(dateStr)}${timeStr ? ' ' + esc(timeStr) : ''}${inc.boatName ? ' · ' + esc(inc.boatName) : ''}</div>
        ${desc ? `<div class="text-muted" style="margin-top:4px">${esc(desc)}${descMore}</div>` : ''}
      </div>
      <span class="ml-auto text-accent" style="font-size:16px">→</span>
    </div>`;
  }).join('');
}

// ── Incident detail modal ───────────────────────────────────────────────────
function _dlIncidentField(label, val) {
  if (val == null || val === '' || val === '—') return '';
  return '<div class="dl-drow"><span class="dl-dlbl">' + esc(label) + '</span>'
    + '<span class="dl-dval">' + esc(val) + '</span></div>';
}

function openIncidentDetail(id) {
  const inc = _dlIncidentsById[id];
  if (!inc) return;
  const typeList = _dlParseIncidentTypes(inc.types);
  const typeLabels = typeList
    .map(function(k) { return s('incident.type.' + k) || k; })
    .join(', ');
  const sevLabel = inc.severity ? (s('incident.sev.' + inc.severity) || inc.severity) : '';
  const sevClass = inc.severity === 'critical' ? 'red'
    : inc.severity === 'high' ? 'orange'
    : inc.severity === 'medium' ? 'yellow'
    : inc.severity === 'low' ? 'green'
    : 'muted';
  const resolved = inc.resolved && inc.resolved !== 'false';
  const inReview = !resolved && inc.status === 'review';
  const statusLabel = resolved ? s('incident.resolved')
    : inReview ? s('incident.statusReview')
    : s('incident.open');
  const statusClass = resolved ? 'green' : (inReview ? 'orange' : 'yellow');

  document.getElementById('idTitle').textContent = typeLabels || inc.title || s('incident.title');
  document.getElementById('idStatusRow').innerHTML =
    (sevLabel ? '<span class="badge badge-' + sevClass + '">' + esc(sevLabel) + '</span>' : '')
    + '<span class="badge badge-' + statusClass + '">' + esc(statusLabel) + '</span>';

  const handoffVal = inc.handOffTo
    ? (inc.handOffTo
       + (inc.handOffName  ? ' — ' + inc.handOffName  : '')
       + (inc.handOffNotes ? ' · ' + inc.handOffNotes : ''))
    : '';
  const filedAtStr = inc.filedAt ? (fmtDate(inc.filedAt) + ' ' + fmtTime(inc.filedAt)) : '';
  const filedByVal = (inc.filedBy || s('lbl.unknown')) + (filedAtStr ? ' · ' + filedAtStr : '');
  const dateTimeVal = (inc.date || '') + (inc.time ? ' ' + inc.time : '');

  document.getElementById('idBody').innerHTML =
    _dlIncidentField(s('lbl.date') + ' / ' + s('lbl.time'), dateTimeVal)
    + _dlIncidentField(s('lbl.location'),                   inc.locationName)
    + _dlIncidentField(s('incident.boatLabel').replace(' (if applicable)', ''), inc.boatName)
    + _dlIncidentField(s('incident.description'),           inc.description)
    + _dlIncidentField(s('incident.personsInvolved'),       inc.involved)
    + _dlIncidentField(s('incident.witnesses'),             inc.witnesses)
    + _dlIncidentField(s('incident.immediateAction'),       inc.immediateAction)
    + _dlIncidentField(s('incident.followUp'),              inc.followUp)
    + _dlIncidentField(s('incident.handoffTo'),             handoffVal)
    + _dlIncidentField(s('incident.filedBy'),               filedByVal);

  // Deep-link into /incidents/ for review/resolve controls
  const full = document.getElementById('idOpenFull');
  if (full) full.href = '../incidents/#' + encodeURIComponent(inc.id);

  openModal('incidentDetailModal');
}

// ── Activity-class buttons ────────────────────────────────────────────────────
function renderActTypeBtns() {
  dom.actTypeBtns.replaceChildren();
  activityTypes.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'type-btn' + (t.id === _selectedActType ? ' selected' : '');
    btn.dataset.typeId = t.id;
    const label = L === 'IS' && t.nameIS ? t.nameIS : t.name;
    const tag = t.classTag ? '\n[' + t.classTag + ']' : '';
    btn.textContent = label + tag;
    btn.style.whiteSpace = 'pre';
    btn.addEventListener('click', function() {
      _selectedActType = t.id;
      renderActTypeBtns();
      // When the user picks a class, prefill name + default times + leader
      // if those fields are still untouched (so re-picking doesn't clobber
      // edits the user already made).
      const cls = activityTypes.find(x => x.id === t.id);
      if (cls) {
        if (!dom.actName.value)  dom.actName.value  = L==='IS' && cls.nameIS ? cls.nameIS : (cls.name || '');
        if (!dom.actStart.value && cls.defaultStart) dom.actStart.value = cls.defaultStart;
        if (!dom.actEnd.value   && cls.defaultEnd)   dom.actEnd.value   = cls.defaultEnd;
        var leaderEl = document.getElementById('actLeader');
        var leaderIdEl = document.getElementById('actLeaderMemberId');
        if (leaderEl && !leaderEl.value && cls.leaderName) {
          leaderEl.value = cls.leaderName;
          if (leaderIdEl) leaderIdEl.value = cls.leaderMemberId || '';
        }
      }
    });
    dom.actTypeBtns.appendChild(btn);
  });
}

// ── Weather log ───────────────────────────────────────────────────────────────
function renderWxLog() {
  var fi = { green:"🟢", yellow:"🟡", orange:"🟠", red:"🔴" };
  dom.wxLogCount.textContent = wxLog.length
    ? wxLog.length + (wxLog.length === 1 ? ' snapshot' : ' snapshots') : '';
  dom.wxLogList.innerHTML = "";
  wxLog.forEach(function(snap, i) {
    var card = document.createElement("div");
    card.className = "wx-snap-card";
    var time = snap.time || (snap.ts ? sstr(snap.ts).slice(11,16) : "");
    var cells = [
      { lbl:"WIND",     val: (snap.dir||"") + " " + (snap.ws!=null ? (typeof snap.ws==='string'&&snap.ws.indexOf('-')!==-1?snap.ws.split('-').map(function(v){return Math.round(v);}).join('–'):snap.ws)+"m/s · Force "+snap.bft : "—") },
      { lbl:"GUSTS",    val: (snap.wg!=null && snap.wg!==snap.ws) ? snap.wg+"m/s" : null },
      { lbl:"WAVES",    val: snap.wv!=null ? snap.wv+"m"+(snap.waveDir?" "+snap.waveDir:"") : null },
      { lbl:"SEA TEMP", val: snap.sst!=null ? snap.sst+"°C" : null },
      { lbl:"CONDITIONS", val: snap.cond ? snap.cond.icon+" "+snap.cond.desc : null },
      { lbl:"AIR",      val: snap.tc!=null ? snap.tc+"°C"+(snap.feels!=null&&snap.feels!==snap.tc?" / feels "+snap.feels+"°C":"") : null },
      { lbl:"PRESSURE", val: snap.pres!=null ? snap.pres+"hPa"+(snap.presTrend?" "+(snap.presTrend==="rising"?"↗":snap.presTrend==="falling"?"↘":"→"):"") : null },
    ].filter(function(c) { return c.val; });
    var gridHtml = cells.map(function(c) {
      return '<div><div class="wx-snap-label">'+c.lbl+'</div><div class="wx-snap-val">'+esc(c.val)+'</div></div>';
    }).join("");
    card.innerHTML =
      '<div class="wx-snap-header">'
      + '<span class="wx-snap-time">' + esc(time) + '</span>'
      + '<span class="wx-snap-flag">' + (snap.flag ? fi[snap.flag]||"" : "") + '</span>'
      + '<button class="del-btn text-lg" data-delete-wx="' + i + '">&times;</button>'
      + '</div>'
      + '<div class="wx-snap-grid">' + gridHtml + '</div>';
    dom.wxLogList.appendChild(card);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6 — EVENT DELEGATION
// ════════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  buildHeader('dailylog');
  applyStrings(); // ← wire all data-s attributes

  // Placeholders that applyStrings can't reach (attrs)
  dom.narrativeInput.placeholder = s('daily.notesPlaceholder');
  dom.actName.placeholder        = s('daily.actNameHint');
  dom.actParticipants.placeholder = s('daily.actPartHint');
  dom.actNotes.placeholder       = s('daily.actNotesHint');

  // Trip detail modal label text
  document.getElementById('tdOutLabel').textContent    = 'OUT';
  document.getElementById('tdReturnLabel').textContent = s('staff.coDetail.return');
  document.getElementById('tdInLabel').textContent     = 'IN';

  // Checklist item toggle
  document.addEventListener('click', e => {
    const item = e.target.closest('[data-toggle]');
    if (!item) return;
    toggleCL(item.dataset.prefix, item.dataset.itemId);
  });

  // Checklist section collapse/expand (clicking the heading)
  document.addEventListener('click', e => {
    const h = e.target.closest('[data-cl-toggle]');
    if (!h) return;
    toggleChecklist(h.dataset.clToggle);
  });

  dom.activitiesList.addEventListener('click', async e => {
    const del = e.target.closest('[data-delete-activity]');
    if (del) {
      if (!await confirmEditEntry()) return;
      deleteActivity(del.dataset.deleteActivity);
      return;
    }
    const row = e.target.closest('[data-edit-activity]');
    if (!row) return;
    if (!await confirmEditEntry()) return;
    openActivityModal(row.dataset.editActivity);
  });

  dom.wxLogList.addEventListener('click', e => {
    const btn = e.target.closest('[data-delete-wx]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.deleteWx);
    wxLog.splice(idx, 1);
    renderWxLog();
    markDirty();
  });

  dom.tripsCard.addEventListener('click', e => {
    const row = e.target.closest('[data-trip-id]');
    if (!row) return;
    openTripDetail(row.dataset.tripId);
  });

  // Open the incident detail modal on card click. The modal reads its
  // data from _dlIncidentsById, which is populated by renderIncidentSection.
  dom.incidentContainer.addEventListener('click', e => {
    const card = e.target.closest('[data-incident-id]');
    if (!card) return;
    // Let taps on inner links (e.g. phone) through.
    if (e.target.closest('a')) return;
    openIncidentDetail(card.dataset.incidentId);
  });

  function debounce(fn, ms) {
    let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  const debouncedNav = debounce(navigateDay, 300);
  dom.prevBtn.addEventListener('click',  async () => { if (await confirmDiscardDirty()) debouncedNav(-1); });
  dom.nextBtn.addEventListener('click',  async () => { if (await confirmDiscardDirty()) debouncedNav(1); });
  dom.todayBtn.addEventListener('click', async () => { if (await confirmDiscardDirty()) navigateToToday(); });
  dom.datePicker.addEventListener('change', async () => {
    const v = dom.datePicker.value;
    if (!v) return;
    if (!await confirmDiscardDirty()) {
      // Roll the picker back to the still-loaded day so it doesn't appear
      // to "stick" on the rejected date.
      dom.datePicker.value = viewDate;
      return;
    }
    viewDate = v;
    loadDay();
  });

  dom.addActivityBtn.addEventListener('click', openActivityModal);
  document.getElementById('actCancelBtn').addEventListener('click', closeActivityModal);
  document.getElementById('actSaveBtn').addEventListener('click',   function() { saveActivity(false); });
  document.getElementById('actSaveAddBtn').addEventListener('click', function() { saveActivity(true); });

  dom.signOffBtn.addEventListener('click', async () => {
    // Today: full sign-off (marks signedOffBy/signedOffAt). Past/future: save
    // as an amendment — the row already has a signOffBy stamp (either staff
    // or the midnight trigger), and updatedBy/updatedAt distinguishes the edit.
    if (isToday()) { signOffDay(); return; }
    const msg = s('daily.confirmAmendmentSave', { date: viewDate });
    if (!await ymConfirm(msg)) return;
    doSave(false);
  });
  dom.narrativeInput.addEventListener('input', markDirty);
  dom.logWxBtn.addEventListener('click',     logCurrentWeather);

  // Tide fields are now auto-filled from harmonic prediction (no manual inputs)

  // Silent weather poll for snapshots
  let _wxTimer = null;
  async function pollWx() {
    try {
      var fetched = await wxFetch(WX_DEFAULT.lat, WX_DEFAULT.lon);
      var c = fetched.wx.current, hr = fetched.wx.hourly;
      var mc = (fetched.marine && fetched.marine.current) ? fetched.marine.current : {};
      var ws = c.wind_speed_10m || 0, wg = c.wind_gusts_10m || ws, wd = c.wind_direction_10m;
      var bft = wxMsToBft(ws), wDir = wxDirLabel(wd);
      var waveH   = mc.wave_height != null ? mc.wave_height : null;
      var waveDir = mc.wave_direction != null ? wxDirLabel(mc.wave_direction) : null;
      var sst     = mc.sea_surface_temperature != null ? mc.sea_surface_temperature : null;
      var nowISO  = new Date().toISOString().slice(0,13);
      var nowIdx  = Math.max(0, (hr.time||[]).findIndex(function(tt) { return sstr(tt).slice(0,13) === nowISO; }));
      var presObj = wxPressureTrend(hr.surface_pressure, nowIdx);
      var assessed = wxScoreFlag(ws, wDir, waveH || 0, null, null, null, 'good');
      wxData = { ws:ws, wd:wd, wg:wg, bft:bft, wDir:wDir, waveH:waveH,
                 waveDir:waveDir, sst:sst, flagKey:assessed.flagKey,
                 airT:c.temperature_2m, apparentT:c.apparent_temperature,
                 pres:c.surface_pressure, presTrend:presObj.trend,
                 code:c.weather_code };
    } catch(e) {}
  }
  pollWx();
  _wxTimer = setInterval(pollWx, 10 * 60 * 1000);

  navigateToToday();

  // Handle ?linkCheckout= redirect from staff group checkout
  const _lcParam = new URLSearchParams(location.search).get('linkCheckout');
  if (_lcParam) {
    _linkedGroupCheckoutIds = [_lcParam];
    setTimeout(function(){ openActivityModal(); }, 800);
  }

  warmContainer();
  // Auto-save every 30s when dirty
  setInterval(function(){ if (dirty && isToday()) saveDraft(); }, 30000);
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 7 — DATE NAVIGATION
// ════════════════════════════════════════════════════════════════════════════
function isToday()  { return viewDate === TODAY; }
function isFuture() { return viewDate >  TODAY; }

function updateDateNav() {
  dom.nextBtn.disabled = false;
  dom.todayBtn.disabled = isToday();
  // Past/future days are amendable, not read-only — weather logging is the
  // only today-exclusive action (snapshot reflects real-time wx).
  dom.mainWrap.classList.remove('readonly');
  dom.readonlyBadge.classList.add('hidden');
  dom.signOffBtn.style.display = '';
  dom.signOffBtn.textContent   = isToday() ? s('btn.signOff') : s('daily.saveAmendments');
  dom.logWxBtn.parentElement.style.display = 'block';
  dom.logWxBtn.style.display   = isToday() ? '' : 'none';
  dom.logWxDesc.style.display  = isToday() ? '' : 'none';
}

function navigateDay(d) {
  const dt = new Date(viewDate + 'T12:00:00');
  dt.setDate(dt.getDate() + d);
  viewDate = dt.toISOString().slice(0, 10);
  loadDay();
}

function navigateToToday() {
  viewDate = TODAY;
  loadDay();
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 8 — CHECKLIST TOGGLE
// ════════════════════════════════════════════════════════════════════════════
function toggleCL(prefix, id) {
  // Past/future days are amendable too — edits get audited via the
  // dailyLog row's updatedBy/updatedAt on save.
  // normalise new phase names (opening/closing) to internal am/pm keys
  const _p    = (prefix === 'opening') ? 'am' : (prefix === 'closing') ? 'pm' : prefix;
  const state = _p === 'am' ?
  amChecks : pmChecks;
  state[id] = !state[id];
  const items = _p === 'am' ? amItems : pmItems;
  const item = document.querySelector(`[data-prefix="${prefix}"][data-item-id="${id}"]`);
  if (item) {
    item.classList.toggle('done', !!state[id]);
    const cb = item.querySelector('input[type=checkbox]');
    if (cb) cb.checked = !!state[id];
  }
  updateCLProgress(_p === 'am' ? dom.amCard : dom.pmCard, items, state);
  updateChecklistChips();
  // Morning complete → nudge: collapse AM and auto-open PM so the user has
  // somewhere to go next. User can still re-expand manually at any time.
  if (_p === 'am' && items.length && items.every(i => state[i.id]) && amOpen) {
    amOpen = false; pmOpen = true;
    applyChecklistOpenState();
  }
  markDirty();
}

function updateCLProgress(card, items, state) {
  const done = items.filter(i => state[i.id]).length;
  const pct  = items.length ? Math.round(done / items.length * 100) : 0;
  const prog = card.querySelector('.cl-progress-line');
  if (prog) prog.querySelector('span').textContent = done;
  const bar = card.querySelector('.cl-bar');
  if (bar) bar.style.width = pct + '%';
}

function deleteActivity(id) {
  activities = activities.filter(a => a.id !== id);
  renderActivities();
  markDirty();
}

let _editingActivityId = null;

function openActivityModal(id) {
  _editingActivityId = id || null;
  const existing = id ? activities.find(a => a.id === id) : null;
  _selectedActType = existing ? (existing.activityTypeId || null) : (activityTypes[0]?.id || null);
  _linkedGroupCheckoutIds = existing && Array.isArray(existing.linkedGroupCheckoutIds) ? existing.linkedGroupCheckoutIds.slice() : [];
  renderActTypeBtns();
  // Prefill name + default times from the picked class on a fresh add; on edit
  // we keep the existing instance values verbatim.
  const cls = activityTypes.find(t => t.id === _selectedActType);
  dom.actName.value  = existing ? (existing.name  || '') : (cls ? (L==='IS' && cls.nameIS ? cls.nameIS : cls.name) || '' : '');
  dom.actStart.value = existing ? (existing.start || '') : (cls ? cls.defaultStart || '' : '');
  dom.actEnd.value   = existing ? (existing.end   || '') : (cls ? cls.defaultEnd   || '' : '');
  dom.actParticipants.value = existing ? (existing.participants || '') : '';
  // Leader: existing instance wins; otherwise inherit from the picked type so
  // the leader follows the class by default (admin-set on the type).
  document.getElementById('actLeader').value = existing
    ? (existing.leaderName || '')
    : (cls ? (cls.leaderName || '') : '');
  document.getElementById('actLeaderMemberId').value = existing
    ? (existing.leaderMemberId || '')
    : (cls ? (cls.leaderMemberId || '') : '');
  // Pre-execution notes: stay verbatim on edit; on a fresh add, inherit any
  // intent the admin authored on the parent template so staff can see
  // context. The post-execution `runNotes` only ever comes from the user
  // filling the daily log — never from the template.
  dom.actNotes.value    = existing ? (existing.notes    || '') : (cls ? (L === 'IS' && cls.notesIS ? cls.notesIS : (cls.notes || '')) : '');
  document.getElementById('actRunNotes').value = existing ? (existing.runNotes || '') : '';
  document.getElementById('actAbler').checked = !!(existing && existing.ablerRegistered);
  // The "save + add another" button doesn't make sense when editing a single row
  const saAdd = document.getElementById('actSaveAddBtn');
  if (saAdd) saAdd.style.display = _editingActivityId ? 'none' : '';
  renderGroupLinkCards();
  openModal('activityModal');
}
function closeActivityModal() { _editingActivityId = null; closeModal('activityModal'); }

function saveActivity(keepOpen) {
  const name = dom.actName.value.trim();
  const cls = activityTypes.find(t => t.id === _selectedActType);
  if (!name) { showToast(s('daily.actNameLabel') + ' required.', 'warn'); return; }
  if (!cls)  { showToast(s('daily.actType') + ' required.', 'warn'); return; }
  const leaderName = document.getElementById('actLeader').value.trim();
  if (!leaderName) { showToast(s('daily.actLeaderRequired'), 'warn'); return; }
  const fields = {
    activityTypeId:        cls.id,
    classTag:              cls.classTag || '',
    name,
    start:                 dom.actStart.value || '',
    end:                   dom.actEnd.value   || '',
    participants:          dom.actParticipants.value || '',
    leaderName,
    leaderMemberId:        document.getElementById('actLeaderMemberId').value || '',
    notes:                 dom.actNotes.value.trim(),
    runNotes:              document.getElementById('actRunNotes').value.trim(),
    ablerRegistered:       document.getElementById('actAbler').checked,
    linkedGroupCheckoutIds: _linkedGroupCheckoutIds.slice(),
  };
  if (_editingActivityId) {
    const idx = activities.findIndex(a => a.id === _editingActivityId);
    if (idx >= 0) {
      // Preserve id + scheduled-origin flag, replace the editable fields, and
      // stamp the audit pair. Keep it simple: just who/when, no diff log.
      activities[idx] = Object.assign({}, activities[idx], fields, {
        editedBy: user.name || '',
        editedAt: new Date().toISOString(),
      });
    }
  } else {
    activities.push(Object.assign({ id: 'act-' + Date.now() }, fields));
  }
  renderActivities();
  markDirty();
  saveDraft(); // persist the add/edit immediately — audit stamps land with it
  if (keepOpen && !_editingActivityId) {
    // Reset form fields for next entry but keep modal open
    dom.actName.value = '';
    dom.actStart.value = '';
    dom.actEnd.value = '';
    dom.actParticipants.value = '';
    document.getElementById('actLeader').value = '';
    document.getElementById('actLeaderMemberId').value = '';
    dom.actNotes.value = '';
    document.getElementById('actRunNotes').value = '';
    document.getElementById('actAbler').checked = false;
    _linkedGroupCheckoutIds = [];
    renderGroupLinkCards();
    showToast(s('toast.saved'));
  } else {
    closeActivityModal();
  }
}


function logCurrentWeather() {
  if (!wxData) { showToast(s('wx.unavailable'), 'warn'); return; }
  const snap = wxSnapshot(wxData);
  if (snap) {
    snap.time = new Date().toTimeString().slice(0, 5);
    snap.pres = wxData.pres  != null ? Math.round(wxData.pres)  : null;
    wxLog.unshift(snap);
    renderWxLog();
    markDirty();
  }
}

// ── Trip detail modal ─────────────────────────────────────────────────────────
function openTripDetail(id) {
  const co = tripsData.find(c => c.id === id);
  if (!co) return;
  document.getElementById('tdTitle').textContent    = esc(co.boatName||co.boatId);
  document.getElementById('tdBoat').textContent     = esc(co.boatName||co.boatId);
  document.getElementById('tdLocation').textContent = esc(co.locationName||'—');
  document.getElementById('tdOut').textContent      = sstr(co.checkedOutAt||co.timeOut).slice(0,5)||'—';
  document.getElementById('tdReturn').textContent   = co.expectedReturn||'—';
  document.getElementById('tdIn').textContent       = (co.checkedInAt||co.timeIn||'')||'—';
  document.getElementById('tdCrew').textContent     = co.crew||1;
  const notesRow = document.getElementById('tdNotesRow');
  notesRow.style.display = co.notes ? '' : 'none';
  document.getElementById('tdNotes').textContent    = co.notes||'';
  document.getElementById('tdMember').textContent   = esc(co.memberName||co.memberKennitala);
  document.getElementById('tdPhoneRow').style.display    = co.memberPhone ? '' : 'none';
  document.getElementById('tdPhone').textContent         = co.memberPhone||'';
  document.getElementById('tdGuardianRow').style.display = (co.memberIsMinor && co.guardianName) ? '' : 'none';
  document.getElementById('tdGuardian').textContent      = co.guardianName
    ? co.guardianName + (co.guardianPhone ? ' · '+co.guardianPhone : '') : '';
  openModal('tripDetailModal');
}


function _autoFillTide() {
  if (typeof tideExtrema !== 'function') return;
  const extrema = tideExtrema(viewDate);
  tideData = tideToDailyLog(extrema);
}

let _tideWidgetInstance = null;
function _renderDailyTide() {
  const el = document.getElementById('dailyTideWidget');
  if (!el || typeof tideWidget !== 'function') return;
  if (!_tideWidgetInstance) {
    _tideWidgetInstance = tideWidget(el, {
      onData: function(d) { tideData = tideToDailyLog(d.extrema); }
    });
  }
  _tideWidgetInstance.refresh();
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 9 — API / DATA LOADERS
// ════════════════════════════════════════════════════════════════════════════
function sjson(v, fallback) {
  if (!v) return fallback;
  try {
    var parsed = typeof v === 'string' ? JSON.parse(v) : v;
    // Legacy rows were written double-encoded by the client; unwrap once more.
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch (e) {}
    }
    return parsed;
  } catch (e) { return fallback; }
}

async function loadDay() {
  logId = null; dirty = false;
  logSignedOff = false; logSignedOffBy = ''; logSignedOffAt = '';
  wxLog = []; amChecks = {}; pmChecks = {};
  activities = []; tripsData = []; tideData = {};
  amItems = []; pmItems = [];
  // Morning expanded only on today; evening always starts collapsed.
  amOpen = isToday();
  pmOpen = false;
  applyChecklistOpenState();

  const d = new Date(viewDate + 'T12:00:00');
  dom.dateBig.textContent = d.toLocaleDateString(L === 'IS' ? 'is-IS' : 'en-GB', { weekday:'long' }).toUpperCase();
  dom.dateHero.textContent = String(d.getDate()).padStart(2,'0') + ' ' + d.toLocaleDateString(L === 'IS' ? 'is-IS' : 'en-GB', { month:'long' }) + ' ' + d.getFullYear();
  if (dom.datePicker) dom.datePicker.value = viewDate;
  dom.signoffBadge.classList.add('hidden');
  dom.signoffBadge.textContent = s('daily.signedOff');
  dom.narrativeInput.value = '';
  updateDateNav();

  const spinner = '<div class="empty-state"><span class="spinner"></span></div>';
  ['tripsCard','amCard','pmCard'].forEach(id => { dom[id].innerHTML = spinner; });
  dom.activitiesEmpty.style.display = '';
  dom.activitiesList.replaceChildren();
  dom.wxLogList.replaceChildren();
  dom.wxLogCount.textContent = '';
  dom.tripsCount.textContent = '';
  _renderDailyTide();

  if (isToday()) {
    await Promise.all([loadTodayLog(), loadTodayTrips()]);
  } else if (isFuture()) {
    await loadOtherLog();
    tripsData = []; renderTrips();
  } else {
    await Promise.all([loadOtherLog(), loadPastTrips()]);
  }
}

async function loadTodayLog() {
  // Don't pre-render checklists/activity-type buttons before config arrives —
  // the spinner from loadDay() stays until real data replaces it.
  renderActivities(); renderWxLog(); renderIncidentSection([]);
  try {
    const [logRes, cfgRes, incidents] = await Promise.all([
      apiGet('getDailyLog', { date: TODAY }),
      apiGet('getConfig'),
      loadIncidentsForDate(TODAY),
    ]);
    applyLogData(logRes, cfgRes);
    renderIncidentSection(incidents);
  } catch(e) {
    console.warn('loadTodayLog failed:', e.message);
    ['tripsCard','amCard','pmCard'].forEach(id => {
      dom[id].innerHTML = '<div class="empty-state">Could not load: ' + (e && e.message ? e.message : 'network error') + '</div>';
    });
  }
  renderChecklists();
  renderActivities();
  renderWxLog();
  renderActTypeBtns();
}

// Loads a non-today day (past or future). No sheet row is written until the
// user edits + saves, or the midnight trigger materializes it.
async function loadOtherLog() {
  try {
    const [logRes, cfgRes, incidents] = await Promise.all([
      apiGet('getDailyLog', { date: viewDate }),
      apiGet('getConfig'),
      isFuture() ? Promise.resolve([]) : loadIncidentsForDate(viewDate),
    ]);
    applyLogData(logRes, cfgRes);
    renderIncidentSection(incidents);
  } catch(e) {
    console.warn('loadOtherLog failed:', e.message);
    renderIncidentSection([]);
  }
  renderChecklists();
  renderActivities();
  renderWxLog();
}

async function loadTodayTrips() {
  try {
    const res = await apiGet('getActiveCheckouts').then(r => { window._activeCheckouts = (r.checkouts||[]); return r; });
    tripsData = res.checkouts || [];
  } catch(e) { tripsData = []; }
  renderTrips();
}

async function loadPastTrips() {
  try {
    const res = await apiGet('getTrips', { date: viewDate });
    tripsData = (res.trips || []).filter(t => t.timeIn); // only completed trips
  } catch(e) {
    tripsData = [];
  }
  renderTrips();
}
async function loadIncidentsForDate(date) {
  try {
    const res = await apiGet('getIncidents', { date });
    return res.incidents || [];
  } catch(e) { return []; }
}

function applyLogData(logRes, cfgRes) {
  const cfg = cfgRes || {};
  if (cfg.flagConfig && typeof wxLoadFlagConfig === 'function') wxLoadFlagConfig(cfg.flagConfig);
  amItems       = cfg.dailyChecklist?.opening || [];
  pmItems       = cfg.dailyChecklist?.closing || [];
  activityTypes = cfg.activityTypes || [];
  // Always auto-fill tides from harmonic prediction for the viewed date
  _autoFillTide();

  const log = logRes && logRes.log ? logRes.log : null;
  const scheduled = (logRes && Array.isArray(logRes.scheduledActivities)) ? logRes.scheduledActivities : [];

  if (log) {
    logId    = log.id;
    logSignedOff   = !!log.signedOffBy;
    logSignedOffBy = log.signedOffBy || '';
    logSignedOffAt = log.signedOffAt || '';
    amChecks = sjson(log.openingChecks, {});
    pmChecks = sjson(log.closingChecks, {});
    activities = sjson(log.activities, []);
    wxLog    = sjson(log.weatherLog, []);
    dom.narrativeInput.value = log.narrative || '';
    if (log.signedOffBy) {
      dom.signoffBadge.classList.remove('hidden');
      const at = log.signedOffAt
        ? ' at ' + fmtTime(log.signedOffAt) : '';
      let txt = s('daily.signedOffBy') + (log.signedOffBy||'') + at;
      // Amendment annotation: if the row was updated after sign-off by
      // someone other than the signer, surface who/when.
      if (log.updatedAt && log.signedOffAt && log.updatedAt > log.signedOffAt
          && log.updatedBy && log.updatedBy !== log.signedOffBy) {
        txt += ' · ' + s('daily.amendedBy', {
          name: log.updatedBy,
          when: fmtDate(log.updatedAt) + ' ' + fmtTime(log.updatedAt),
        });
      }
      dom.signoffBadge.textContent = txt;
    }
  } else {
    // No sheet row yet — pre-populate from the bulk schedule so today's user
    // sees the planned lessons/events, and forward-browsing shows what's coming.
    // Nothing is written to the sheet until the user edits + saves (isToday)
    // or the midnight trigger materializes the day.
    activities = scheduled;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 10 — SAVE / SIGN OFF
// ════════════════════════════════════════════════════════════════════════════
function markDirty() { dirty = true; }

// Confirm before opening an entry for edit. Only prompts when the day's log
// has been signed off — for live (un-signed) days, edits flow through the
// usual draft cycle and don't need extra friction.
async function confirmEditEntry() {
  if (!logSignedOff) return true;
  const when = logSignedOffAt
    ? (fmtDate(logSignedOffAt) + ' ' + fmtTime(logSignedOffAt))
    : '';
  return await ymConfirm(s('daily.confirmEditEntry', { name: logSignedOffBy, when: when }));
}

// Confirm before discarding unsaved local edits (date nav, today button,
// jump-to picker). beforeunload covers browser-level navigation.
async function confirmDiscardDirty() {
  if (!dirty) return true;
  return await ymConfirm(s('daily.unsavedConfirm'));
}

window.addEventListener('beforeunload', function (e) {
  if (!dirty) return;
  e.preventDefault();
  // Modern browsers ignore the string but require returnValue to be set.
  e.returnValue = '';
  return '';
});

async function saveDraft()  { await doSave(false); }
async function signOffDay() {
  if (!isToday()) return;
  const done = pmItems.filter(i => pmChecks[i.id]).length;
  if (done < pmItems.length) {
    const msg = s('daily.signOffConfirm').replace('{done}',done).replace('{total}',pmItems.length);
    if (!await ymConfirm(msg)) return;
  }
  await doSave(true);
}

async function doSave(signOff) {
  if (signOff) {
    dom.signOffBtn.disabled = true;
    dom.signOffBtn.textContent = s('daily.signOffSaving');
  }
  dom.saveMsg.textContent = '';

  try {
    const nowIso = new Date().toISOString();
    const payload = {
      date:          viewDate,
      openingChecks: amChecks,
      closingChecks: pmChecks,
      activities:    activities,
      weatherLog:    wxLog,
      tideData:      tideData,
      narrative:     dom.narrativeInput.value.trim(),
      signOff,
      // Audit stamps: always record who saved + when. On explicit sign-off
      // (today only), stamp signedOffBy/At too — the backend preserves these
      // on subsequent saves so amendments don't overwrite the original.
      updatedBy:     user.name || '',
      ...(signOff ? { signedOffBy: user.name || '', signedOffAt: nowIso } : {}),
      ...(logId ? { id: logId } : {}),
    };
    const res = await apiPost('saveDailyLog', payload);
    if (res.id && !logId) logId = res.id;
    dirty = false;
    dom.saveMsg.className = 'save-ok';
    dom.saveMsg.textContent = signOff ? s('toast.signedOff') : s('toast.saved');
    if (!signOff) setTimeout(function(){ dom.saveMsg.textContent = ''; }, 3000);
    if (signOff) {
      dom.signoffBadge.classList.remove('hidden');
      dom.signoffBadge.textContent = s('daily.signedOffBy') + user.name;
    }
    if (signOff) showToast(s('toast.signedOff'));
  } catch(e) {
    dom.saveMsg.className = 'save-err';
    dom.saveMsg.textContent = s('toast.error') + ': ' + e.message;
    if (signOff) showToast(s('toast.saveFailed') + ': ' + e.message, 'err');
  } finally {
    if (signOff) {
      dom.signOffBtn.disabled = false;
      dom.signOffBtn.textContent = s('btn.signOff');
    }
  }
}

// ── Activity subtype + group link helpers ────────────────────────────────────
let _linkedGroupCheckoutIds = [];
let _groupLinkPickerSelected = new Set();

function renderGroupLinkCards() {
  const wrap = document.getElementById('actGroupLinkCards');
  if (!wrap) return;
  if (!_linkedGroupCheckoutIds.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = _linkedGroupCheckoutIds.map(function(id) {
    return '<div class="flex-between callout-panel text-sm" style="border-left:3px solid var(--navy);border-color:color-mix(in srgb, var(--navy) 33%, transparent);border-left-color:var(--navy);padding:6px 10px">' +
      '<span>⛵ Group checkout ' + esc(sstr(id).slice(-6)) + '</span>' +
      '<button class="btn-dismiss" data-dl-click="_unlinkGroupCheckout" data-dl-arg="'+id+'">✕</button>' +
      '</div>';
  }).join('');
}

function openGroupLinkPicker() {
  _groupLinkPickerSelected = new Set(_linkedGroupCheckoutIds);
  const wrap  = document.getElementById('groupLinkPickerCards');
  const empty = document.getElementById('groupLinkEmpty');
  // Get today's group checkouts from the active checkouts in memory
  const groups = (window._activeCheckouts || []).filter(function(c) {
    return (c.isGroup === true || c.isGroup === 'true') && c.status === 'out';
  });
  if (!groups.length) {
    wrap.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
    wrap.innerHTML = groups.map(function(c) {
      let boatArr; try { boatArr = c.boatNames?(typeof c.boatNames==='string'?JSON.parse(c.boatNames):c.boatNames):[c.boatName||'—']; } catch(e){ boatArr=[c.boatName||'—']; }
      let staffArr; try { staffArr = c.staffNames?(typeof c.staffNames==='string'?JSON.parse(c.staffNames):c.staffNames):[]; } catch(e){ staffArr=[]; }
      const sel = _groupLinkPickerSelected.has(c.id);
      return '<div data-dl-click="toggleGroupLinkPick" data-dl-arg="'+c.id+'" class="callout-panel mb-6" style="background:' + (sel?'color-mix(in srgb, var(--navy) 12%, transparent)':'var(--surface)') + ';border-color:' + (sel?'var(--navy)':'var(--border)') + ';border-left:3px solid var(--navy);cursor:pointer">' +
        '<div class="text-md fw-500">' + esc(boatArr.join(', ')) + '</div>' +
        '<div class="text-sm text-muted">' + (staffArr[0]?esc(staffArr[0])+' · ':'') + esc(c.activityTypeName||'—') + ' · Out ' + esc(sstr(c.checkedOutAt||c.timeOut).slice(0,5)) + '</div>' +
        '</div>';
    }).join('');
  }
  openModal('groupLinkModal');
}

function toggleGroupLinkPick(id) {
  if (_groupLinkPickerSelected.has(id)) _groupLinkPickerSelected.delete(id);
  else _groupLinkPickerSelected.add(id);
  openGroupLinkPicker();
}

function confirmGroupLink() {
  _linkedGroupCheckoutIds = Array.from(_groupLinkPickerSelected);
  renderGroupLinkCards();
  closeModal('groupLinkModal');
}


function _unlinkGroupCheckout(id) {
  if (typeof _linkedGroupCheckoutIds === 'undefined') return;
  window._linkedGroupCheckoutIds = _linkedGroupCheckoutIds.filter(function (x) { return x !== id; });
  if (typeof renderGroupLinkCards === 'function') renderGroupLinkCards();
}

(function () {
  if (typeof document === 'undefined' || document._dlListeners) return;
  document._dlListeners = true;
  document.addEventListener('click', function (e) {
    var cs = e.target.closest('[data-dl-close-self]');
    if (cs && e.target === cs) { closeModal(cs.id); return; }
    var cl = e.target.closest('[data-dl-close]');
    if (cl) { closeModal(cl.dataset.dlClose); return; }
    var c = e.target.closest('[data-dl-click]');
    if (c && typeof window[c.dataset.dlClick] === 'function') window[c.dataset.dlClick](c.dataset.dlArg);
  });
})();
