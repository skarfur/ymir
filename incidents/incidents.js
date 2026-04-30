const user = requireAuth(isStaff);
const L    = getLang();

let incidents    = [];
let selectedTypes = new Set();
let selectedSev   = '';
let boats         = [], locations = [];
let detailId      = null;
let _incFilter    = { status: 'all', sev: 'all' };

// Local-time helpers — avoid ISO/UTC slicing so we don't inherit the
// sub-hour timezone offset issue seen in other time-based features.
function _localDateStr(d) {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}
function _localTimeStr(d) {
  return String(d.getHours()).padStart(2, '0') + ':'
    + String(d.getMinutes()).padStart(2, '0');
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  buildHeader('incidents');
  applyStrings();

  // Wire labels that depend on runtime values
  document.getElementById('modeListLabel').textContent  = s('incident.viewList');
  document.getElementById('modeNewLabel').textContent   = s('incident.fileNew');
  document.getElementById('typeLabel').textContent      = s('incident.typeLabel');
  document.getElementById('boatLabel').textContent      = s('incident.boatLabel');
  document.getElementById('fileBtn').textContent        = s('incident.saveCloseFile');
  document.getElementById('fileReviewBtn').textContent  = s('incident.saveForReview');
  document.getElementById('addReviewerNoteBtn').textContent = s('incident.addReviewerNote');
  document.getElementById('reviewerNoteInput').placeholder  = s('incident.addReviewerNote') + '…';
  document.getElementById('backBtn2').innerHTML         = icon('arrow-left') + ' ' + esc(s('incident.viewList'));

  // Placeholder text
  document.getElementById('iDesc').placeholder       = s('lbl.description') + '…';
  document.getElementById('iInvolved').placeholder   = s('incident.personsInvolved') + '…';
  document.getElementById('iWitnesses').placeholder  = s('incident.witnessHint');
  document.getElementById('iAction').placeholder     = s('incident.actionHint');
  document.getElementById('iFollowUp').placeholder   = s('incident.followUpHint');

  // Hand-off options
  document.getElementById('iHandNone').textContent       = s('lbl.noneDash');
  document.getElementById('iHandEmergency').textContent  = 'Emergency services';
  document.getElementById('iHandHospital').textContent   = 'Hospital';
  document.getElementById('iHandCoastguard').textContent = 'Coastguard';
  document.getElementById('iHandPolice').textContent     = 'Police';
  document.getElementById('iHandGuardian').textContent   = s('incident.handoff.guardian');
  document.getElementById('iHandSelf').textContent       = s('incident.handoff.self');
  document.getElementById('iHandOther').textContent      = s('incident.type.other');

  // Location/boat selects
  document.getElementById('iLocNone').textContent  = '— ' + s('lbl.selectDots').replace('…','') + ' —';
  document.getElementById('iBoatNone').textContent = s('lbl.noneDash');

  // Set defaults
  { const _now = new Date();
    document.getElementById('iDate').value = _localDateStr(_now);
    document.getElementById('iTime').value = _localTimeStr(_now); }

  // Build type grid
  buildTypeGrid();
  buildSevBtns();

  // Load data
  try {
    const [iRes, cfgRes] = await Promise.all([
      apiGet('getIncidents'),
      apiGet('getConfig'),
    ]);
    incidents = iRes.incidents || [];
    boats     = (cfgRes.boats     || []).filter(b => b.active !== false && b.active !== 'false');
    locations = (cfgRes.locations || []).filter(l => l.active !== false && l.active !== 'false');
    populateBoatsLocs();
    renderList();
    updateReviewAlert();
  } catch(e) {
    document.getElementById('incidentsList').innerHTML =
      `<div class="empty-note text-red">${s('toast.loadFailed')}: ${esc(e.message)}</div>`;
  }

  // Delegated click handler — opens detail modal for any incident row
  document.getElementById('incidentsList').addEventListener('click', e => {
    const row = e.target.closest('.incident-row');
    if (!row) return;
    const inc = incidentById(row.dataset.id);
    if (inc) openDetail(inc);
  });

  // Handle hash → jump to detail
  if (window.location.hash) {
    const id = window.location.hash.slice(1);
    const inc = incidents.find(i => i.id === id);
    if (inc) openDetail(inc);
  }

  warmContainer();
});

// ── TYPE GRID ─────────────────────────────────────────────────────────────────
const INCIDENT_TYPES = [
  { v:'injury',      key:'incident.type.injury' },
  { v:'capsize',     key:'incident.type.capsize' },
  { v:'collision',   key:'incident.type.collision' },
  { v:'equipment',   key:'incident.type.equipment' },
  { v:'medical',     key:'incident.type.medical' },
  { v:'nearMiss',    key:'incident.type.nearMiss' },
  { v:'missing',     key:'incident.type.missing' },
  { v:'propertyDmg', key:'incident.type.propertyDmg' },
  { v:'stranding',   key:'incident.type.stranding' },
  { v:'other',       key:'incident.type.other' },
];

const SEV_LIST = [
  { v:'low',      key:'incident.sev.low' },
  { v:'medium',   key:'incident.sev.medium' },
  { v:'high',     key:'incident.sev.high' },
  { v:'critical', key:'incident.sev.critical' },
];

function buildTypeGrid() {
  const grid = document.getElementById('typeGrid');
  grid.innerHTML = INCIDENT_TYPES.map(t =>
    `<button class="type-toggle" data-v="${t.v}" data-inc-click-el="toggleType">${s(t.key)}</button>`
  ).join('');
}

function buildSevBtns() {
  const div = document.getElementById('sevBtns');
  div.innerHTML = SEV_LIST.map(sv =>
    `<button class="sev-btn" data-v="${sv.v}" data-inc-click-el="setSev">${s(sv.key)}</button>`
  ).join('');
}

function populateBoatsLocs() {
  const bSel = document.getElementById('iBoat');
  boats.forEach(b => {
    const o = document.createElement('option'); o.value=b.id; o.textContent=b.name; bSel.appendChild(o);
  });
  const lSel = document.getElementById('iLocation');
  locations.forEach(l => {
    const o = document.createElement('option'); o.value=l.id; o.textContent=l.name; lSel.appendChild(o);
  });
}

// Scan a boat QR code and auto-select it in the boat dropdown
function scanBoatForIncident() {
  if (typeof openQRScanner !== 'function') { showToast(s('qr.error'), 'err'); return; }
  openQRScanner({
    title: s('qr.scanTitle'),
    onResult: function (text) {
      const id = parseBoatIdFromScan(text);
      if (!id) { showToast(s('qr.invalidCode'), 'err'); return; }
      const boat = boats.find(b => b.id === id);
      if (!boat) { showToast(s('qr.boatNotFound'), 'err'); return; }
      const bSel = document.getElementById('iBoat');
      bSel.value = id;
      // Ensure we're in the new-report view so the user sees the selection
      setMode('new');
      showToast(boat.name);
    }
  });
}

// ── RENDER LIST ───────────────────────────────────────────────────────────────
function _incStatus(i) {
  const resolved = i.resolved && i.resolved !== 'false';
  if (resolved) return 'resolved';
  return i.status === 'review' ? 'review' : 'open';
}

function _incSortKey(i) {
  // Prefer the incident date/time; fall back to filedAt for legacy rows.
  // Compare on HH:MM strings — both sides are local-time entries, so
  // lexicographic sort is correct without any timezone conversion.
  if (i.date) return sstr(i.date) + 'T' + sstr(i.time || '00:00');
  return sstr(i.filedAt).slice(0, 16);
}

function renderList() {
  const el = document.getElementById('incidentsList');
  if (!incidents.length) {
    el.innerHTML = `<div class="empty-note">${s('incident.noIncidents')}</div>`;
    return;
  }
  const sevBadge = { low:'badge-green', medium:'badge-yellow', high:'badge-orange', critical:'badge-red' };
  const filtered = incidents
    .filter(i => _incFilter.status === 'all' || _incStatus(i) === _incFilter.status)
    .filter(i => _incFilter.sev === 'all' || i.severity === _incFilter.sev)
    .slice()
    .sort((a, b) => _incSortKey(b).localeCompare(_incSortKey(a)));
  if (!filtered.length) {
    el.innerHTML = `<div class="empty-note">${s('incident.noMatching')}</div>`;
    return;
  }
  el.innerHTML = filtered.map(i => {
    const types = parseJsonArray(i.types);
    const typeLabels = types.map(t => {
      const def = INCIDENT_TYPES.find(x => x.v === t);
      return def ? s(def.key) : t;
    }).join(', ');
    const sevLabel = i.severity ? (s('incident.sev.'+i.severity) || i.severity) : '';
    const st = _incStatus(i);
    const statusCls = st === 'resolved' ? 'badge-green' : (st === 'review' ? 'badge-orange' : 'badge-yellow');
    const statusLbl = st === 'resolved' ? s('incident.resolved')
      : (st === 'review' ? s('incident.statusReview') : s('incident.open'));
    const dateStr = i.date || (i.filedAt ? fmtDate(i.filedAt) : '');
    const timeStr = i.time || (i.filedAt ? fmtTime(i.filedAt) : '');
    const descStr = sstr(i.description);
    const desc = descStr.slice(0, 140) + (descStr.length > 140 ? '…' : '');
    return `<div class="incident-row" data-id="${esc(i.id)}">
      <div class="incident-header">
        <span class="fw-500 flex-1">${esc(typeLabels || i.title || '')}</span>
        ${sevLabel ? `<span class="badge ${sevBadge[i.severity]||'badge-muted'}">${esc(sevLabel)}</span>` : ''}
        <span class="badge ${statusCls}">${statusLbl}</span>
      </div>
      <div class="incident-meta">
        ${esc(dateStr)}${timeStr ? ' ' + esc(timeStr) : ''}
        ${i.boatName ? ' · '+esc(i.boatName) : ''}
      </div>
      ${desc ? `<div class="incident-desc">${esc(desc)}</div>` : ''}
    </div>`;
  }).join('');
}

function incSetFilter(btn) {
  const group = btn.dataset.group;
  const v = btn.dataset.v;
  _incFilter[group] = v;
  document.querySelectorAll(`#incidentFilters .filter-btn[data-group="${group}"]`).forEach(b => {
    b.classList.toggle('active', b.dataset.v === v);
  });
  renderList();
}

function incidentById(id) { return incidents.find(i => i.id === id); }

// ── OPEN DETAIL ───────────────────────────────────────────────────────────────
function openDetail(i) {
  if (!i) return;
  detailId = i.id;
  const reviewerNotes = parseJsonArray(i.reviewerNotes);
  const types    = parseJsonArray(i.types);
  const resolved = i.resolved && i.resolved !== 'false';
  const inReview = !resolved && i.status === 'review';

  document.getElementById('detailStatus').innerHTML =
    `<span class="badge ${resolved ? 'badge-green' : (inReview ? 'badge-orange' : 'badge-yellow')}">${resolved ? s('incident.resolved') : (inReview ? s('incident.statusReview') : s('incident.open'))}</span>`;

  document.getElementById('resolveBtn').textContent = resolved ? s('incident.markOpen') : s('incident.markResolved');

  const typeLabels = types.map(t => {
    const def = INCIDENT_TYPES.find(x => x.v === t);
    return def ? s(def.key) : t;
  }).join(', ');

  document.getElementById('detailTitle').textContent = i.title || s('incident.title');

  const sevLabel = i.severity ? (s('incident.sev.'+i.severity) || i.severity) : '';
  const sevBadgeMap = { low:'badge-green', medium:'badge-yellow', high:'badge-orange', critical:'badge-red' };
  const handoffVal = i.handOffTo
    ? `${i.handOffTo}${i.handOffName ? ' — '+i.handOffName : ''}${i.handOffNotes ? ' · '+i.handOffNotes : ''}`
    : '';
  const filedAtStr = i.filedAt ? (fmtDate(i.filedAt) + ' ' + fmtTime(i.filedAt)) : '';
  const filedByVal = (i.filedBy || s('lbl.unknown')) + (filedAtStr ? ' · ' + filedAtStr : '');

  document.getElementById('detailBody').innerHTML = `
    <div class="mb-12">
      <div class="text-sm text-muted mb-4">${esc(typeLabels)}</div>
      ${sevLabel ? `<span class="badge ${sevBadgeMap[i.severity]||'badge-muted'}">${esc(sevLabel)}</span>` : ''}
    </div>
    ${field(s('lbl.date')+' / '+s('lbl.time'), (i.date||'') + (i.time?' '+i.time:''))}
    ${field(s('lbl.location'), i.locationName)}
    ${field(s('incident.boatLabel').replace(' (if applicable)',''), i.boatName)}
    ${field(s('incident.description'), i.description)}
    ${field(s('incident.personsInvolved'), i.involved)}
    ${field(s('incident.witnesses'), i.witnesses)}
    ${field(s('incident.immediateAction'), i.immediateAction)}
    ${field(s('incident.followUp'), i.followUp)}
    ${field(s('incident.handoffTo'), handoffVal)}
    ${field(s('incident.filedBy'), filedByVal)}
  `;

  document.getElementById('reviewerNotesList').innerHTML = reviewerNotes.map(n => `
    <div class="note-item">${esc(n.text)}
      <div class="note-meta">${esc(n.by)} · ${esc(n.at)}</div>
    </div>`).join('');

  openModal('detailModal');
}

function field(label, val) {
  if (!val || String(val).trim() === '' || val === '—') return '';
  return `<div class="detail-field">
    <div class="detail-field-label">${esc(label)}</div>
    <div class="detail-field-value">${esc(val)}</div>
  </div>`;
}

// ── TYPE / SEVERITY TOGGLES ───────────────────────────────────────────────────
function toggleType(btn) {
  const v = btn.dataset.v;
  if (selectedTypes.has(v)) { selectedTypes.delete(v); btn.classList.remove('on'); }
  else                      { selectedTypes.add(v);    btn.classList.add('on'); }
}

function setSev(btn) {
  document.querySelectorAll('.sev-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  selectedSev = btn.dataset.v;
}

// ── FILE REPORT ───────────────────────────────────────────────────────────────
async function fileReport(pathway) {
  pathway = pathway || 'closed';
  const desc = document.getElementById('iDesc').value.trim();
  if (!desc)               { showToast(s('incident.descRequired'), 'err'); return; }
  if (!selectedTypes.size) { showToast(s('incident.typeRequired'), 'err'); return; }
  if (!selectedSev)        { showToast(s('incident.sevRequired'),  'err'); return; }

  const btn = document.getElementById('fileBtn');
  const btn2 = document.getElementById('fileReviewBtn');
  const msg = document.getElementById('saveMsg');
  btn.disabled = true; btn2.disabled = true; msg.textContent = '';

  const boatSel = document.getElementById('iBoat');
  const locSel  = document.getElementById('iLocation');
  const boatOpt = boatSel.options[boatSel.selectedIndex];
  const locOpt  = locSel.options[locSel.selectedIndex];
  const handTo  = document.getElementById('iHandOffTo').value;

  const typeLabels = [...selectedTypes].map(t => {
    const def = INCIDENT_TYPES.find(x => x.v === t);
    return def ? s(def.key) : t;
  }).join(', ');

  try {
    const iDate = document.getElementById('iDate').value;
    const iTime = document.getElementById('iTime').value;
    const res = await apiPost('createIncident', {
      types:         JSON.stringify([...selectedTypes]),
      typeLabels,
      severity:      selectedSev,
      date:          iDate,
      time:          iTime,
      locationId:    locSel.value,
      locationName:  locOpt.value ? locOpt.textContent : '',
      boatId:        boatSel.value,
      boatName:      boatSel.value ? boatOpt.textContent : '',
      description:   desc,
      involved:      document.getElementById('iInvolved').value.trim(),
      witnesses:     document.getElementById('iWitnesses').value.trim(),
      immediateAction: document.getElementById('iAction').value.trim(),
      followUp:      document.getElementById('iFollowUp').value.trim(),
      handOffTo:     handTo,
      handOffName:   document.getElementById('iHandOffName').value.trim(),
      handOffNotes:  document.getElementById('iHandOffNotes').value.trim(),
      filedBy:       user.name,
      filedAt:       new Date().toISOString(),
      title:         typeLabels,
      status:        pathway === 'review' ? 'review' : 'closed',
      resolved:      pathway === 'closed',
    });
    const newInc = { ...res, types: JSON.stringify([...selectedTypes]),
      description: desc, severity: selectedSev, filedBy: user.name,
      filedAt: new Date().toISOString(), title: typeLabels,
      date: iDate, time: iTime,
      status: pathway === 'review' ? 'review' : 'closed',
      resolved: pathway === 'closed' };
    incidents.unshift(newInc);
    showToast(s('incident.filed'));
    setMode('list');
    renderList();
    updateReviewAlert();
    resetForm();
  } catch(e) {
    msg.textContent = s('toast.error') + ': ' + e.message;
    showToast(s('toast.saveFailed'), 'err');
  } finally {
    btn.disabled = false; btn2.disabled = false;
  }
}

function resetForm() {
  selectedTypes.clear();
  selectedSev = '';
  document.querySelectorAll('.type-toggle').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.sev-btn').forEach(b => b.classList.remove('on'));
  ['iDesc','iInvolved','iWitnesses','iAction','iFollowUp','iHandOffName','iHandOffNotes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('iHandOffTo').value = '';
  { const _now = new Date();
    document.getElementById('iDate').value = _localDateStr(_now);
    document.getElementById('iTime').value = _localTimeStr(_now); }
}

// ── ADD NOTE ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addReviewerNoteBtn').addEventListener('click', addReviewerNote);
  document.getElementById('fileBtn').addEventListener('click', () => fileReport('closed'));
  document.getElementById('fileReviewBtn').addEventListener('click', () => fileReport('review'));
  document.getElementById('reviewerNoteInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addReviewerNote();
  });
});

async function addReviewerNote() {
  const input = document.getElementById('reviewerNoteInput');
  const text  = input.value.trim();
  if (!text || !detailId) return;
  try {
    await apiPost('addIncidentNote', { id: detailId, by: user.name, text, at: new Date().toISOString(), kind: 'reviewer' });
    const i = incidents.find(x => x.id === detailId);
    if (i) {
      const notes = parseJson(i.reviewerNotes, []);
      const timeStr = fmtDate(new Date().toISOString()) + ' ' + fmtTime(new Date().toISOString());
      notes.push({ by: user.name, at: timeStr, text });
      i.reviewerNotes = JSON.stringify(notes);
      document.getElementById('reviewerNotesList').innerHTML += `
        <div class="note-item">${esc(text)}
          <div class="note-meta">${esc(user.name)} · ${esc(timeStr)}</div>
        </div>`;
    }
    input.value = '';
    showToast(s('toast.saved'));
  } catch(e) { showToast(s('toast.error'), 'err'); }
}

// ── RESOLVE / REOPEN ──────────────────────────────────────────────────────────
async function toggleResolve() {
  const i = incidents.find(x => x.id === detailId);
  if (!i) return;
  const resolved = !(i.resolved && i.resolved !== 'false');
  try {
    await apiPost('resolveIncident', { id: detailId, resolved, resolvedAt: resolved ? new Date().toISOString() : '', status: resolved ? 'closed' : (i.status || 'open') });
    i.resolved = resolved;
    if (resolved) i.status = 'closed';
    showToast(s('toast.saved'));
    renderList();
    updateReviewAlert();
    closeDetail();
  } catch(e) { showToast(s('toast.error'), 'err'); }
}

function updateReviewAlert() {
  const needs = incidents.filter(i => {
    const r = i.resolved && i.resolved !== 'false';
    return !r && (i.status === 'review' || i.followUp);
  });
  const el = document.getElementById('reviewAlert');
  const txt = document.getElementById('reviewAlertText');
  if (!el) return;
  if (needs.length) {
    el.classList.remove('hidden');
    txt.textContent = `${needs.length} ${s('incident.statusReview')}`;
  } else {
    el.classList.add('hidden');
  }
}

// ── MODE SWITCHING ────────────────────────────────────────────────────────────
function setMode(mode) {
  document.getElementById('listMode').classList.toggle('hidden',   mode !== 'list');
  document.getElementById('newMode').classList.toggle('hidden',    mode !== 'new');
  document.getElementById('modeListBtn').classList.toggle('active', mode === 'list');
  document.getElementById('modeNewBtn').classList.toggle('active',  mode === 'new');
}

function closeDetail() {
  closeModal('detailModal');
  detailId = null;
  if (window.location.hash) history.replaceState(null,'',window.location.pathname+window.location.search);
}

// Parse a cell that should hold a JSON array. Older rows on /incidents/
// were saved double-encoded (a JSON string whose contents were another JSON
// string), so one pass of JSON.parse yields a string instead of an array.
// Peel until we get something non-string, and always return an array.
function parseJsonArray(v) {
  if (v == null || v === '') return [];
  let cur = v;
  for (let i = 0; i < 3 && typeof cur === 'string'; i++) {
    try { cur = JSON.parse(cur); } catch(e) { return []; }
  }
  return Array.isArray(cur) ? cur : [];
}

function parseJson(v, fallback) {
  if (!v) return fallback;
  let cur = v;
  for (let i = 0; i < 3 && typeof cur === 'string'; i++) {
    try { cur = JSON.parse(cur); } catch(e) { return fallback; }
  }
  return cur == null ? fallback : cur;
}

(function () {
  if (typeof document === 'undefined' || document._incListeners) return;
  document._incListeners = true;
  document.addEventListener('click', function (e) {
    var cs = e.target.closest('[data-inc-close-self]');
    if (cs && e.target === cs) { closeDetail(); return; }
    var ce = e.target.closest('[data-inc-click-el]');
    if (ce && typeof window[ce.dataset.incClickEl] === 'function') { window[ce.dataset.incClickEl](ce); return; }
    var c = e.target.closest('[data-inc-click]');
    if (c && typeof window[c.dataset.incClick] === 'function') window[c.dataset.incClick](c.dataset.incArg);
  });
})();
