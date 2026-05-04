const user = requireAuth(isStaff);
const L = getLang();

// Globals consumed by shared/tripcard.js — must be `var` so tripCard()
// references resolve through the same window slot we mutate at load time.
var allTrips = [], allBoats = [], allMembers = [], allLocs = [];
var _confirmations = { incoming: [], outgoing: [] };
var _windUnit = (typeof getPref === 'function') ? getPref('windUnit', 'ms') : 'ms';

let filtered    = [];
let _certDefs   = [];   // single source of truth for cert definitions
let _certCats   = [];   // cert categories, used for bilingual label resolution
let _verifyReqs = [];   // pending 'verify' handshakes
let _dataLoaded = false;

// Currently selected member in the cert panel
let _certMember = null;   // { id, name, kennitala }

// Activity-log section state — populated by loadActivityLog()
let _actTypes      = [];  // activity-type config rows (for dropdown labels + classTag map)
let _actAll        = [];  // last-fetched activity rows (server already filtered by date range)
let _actDataLoaded = false;

// Helpers required by shared/tripcard.js (each portal that uses tripCard
// provides its own — keep in sync with captain.js / logbook/logbook.js).
function parseDateParts(d) {
  if (!d) return { day: '—', mon: '', yr: '' };
  return { day: d.slice(8, 10) || '—', mon: String(new Date(d + 'T12:00:00').getMonth() + 1).padStart(2, '0'), yr: d.slice(0, 4) };
}
function bftLabel(b) {
  var n = parseInt(b);
  return ['Calm','Light air','Light breeze','Gentle breeze','Moderate breeze','Fresh breeze','Strong breeze','Near gale','Gale','Severe gale'][n] || 'Force ' + b;
}

document.addEventListener('DOMContentLoaded', () => {
  buildHeader('logbook-review');
  applyStrings();

  // Wire string-keyed placeholders/labels that can't use data-s
  document.getElementById('filterName').placeholder   = s('logrev.filterName');
  document.getElementById('filterFrom').title         = s('logrev.filterFrom');
  document.getElementById('filterTo').title           = s('logrev.filterTo');
  document.getElementById('filterOptAll').textContent      = s('logrev.filterAll');
  document.getElementById('filterOptPending').textContent  = s('logrev.filterPending');
  document.getElementById('filterOptVerified').textContent = s('logrev.filterVerified');
  document.getElementById('certMemberSearch').placeholder  = s('logrev.certSearchPlaceholder');
  document.getElementById('actFilterSearch').placeholder   = s('slr.act.searchPlaceholder');
  document.getElementById('actFilterFrom').title           = s('logrev.filterFrom');
  document.getElementById('actFilterTo').title             = s('logrev.filterTo');
  document.getElementById('actFilterTagAll').textContent   = s('slr.act.allTags');
  document.getElementById('actFilterTypeAll').textContent  = s('slr.act.allTypes');

  init();
});

// ── Shared mcm.js wiring (cert modal — same component admin/captain use) ──────
window.mcmGetMembers        = function () { return allMembers; };
window.mcmGetCertDefs       = function () { return _certDefs; };
window.mcmGetCertCategories = function () { return _certCats; };
window.mcmOnUpdate          = function () { renderCertPanelList(); applyCertFilter(); };

// ── Init: load trips + members + certDefs in one pass ────────────────────────
async function init() {
  try {
    const [tripsRes, membersRes, cfgRes, verifyRes] = await Promise.all([
      apiGet('getTrips', { limit: 200 }),
      apiGet('getMembers'),
      apiGet('getConfig'),
      apiGet('getVerificationRequests'),
    ]);

    allMembers  = membersRes.members || [];
    allBoats    = (cfgRes.boats || []).filter(b => !b.oos && b.oos !== 'true');
    allLocs     = cfgRes.locations || [];
    _certDefs   = certDefsFromConfig(cfgRes.certDefs || []);
    _certCats   = certCategoriesFromConfig(cfgRes.certCategories || []);
    _verifyReqs = verifyRes.requests || [];
    _dataLoaded = true;
    if (typeof registerBoatCats === 'function') registerBoatCats(cfgRes.boatCategories || []);

    // Populate cert-type dropdown once
    populateCertFilterType();

    // Activity-log section setup: dropdowns from activityTypes config + first
    // fetch over the default range (last 30 days). Filters are client-side
    // except date range, which re-fetches.
    _actTypes = cfgRes.activityTypes || [];
    populateActivityFilters();
    initActivityDateInputs();
    loadActivityLog();

    // Enrich trips with resolved member name where missing
    allTrips = (tripsRes.trips || [])
      .map(t => _enrichTripMember(t))
      .sort((a, b) => (b.date > a.date ? 1 : -1));

    updateStats();
    applyFilters();
  } catch (e) {
    document.getElementById('tripList').innerHTML =
      `<div class="empty-note text-red">${s('toast.loadFailed')}: ${esc(e.message)}</div>`;
  }
}

// Resolve memberName from allMembers if the trip doesn't have it
function _enrichTripMember(t) {
  if (t.memberName) return t;
  const m = allMembers.find(x =>
    (t.memberKennitala && x.kennitala === t.memberKennitala) ||
    (t.memberId       && x.id        === t.memberId)
  );
  return m ? { ...t, memberName: m.name } : t;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const yr  = new Date().getFullYear() + '';
  const ytd = allTrips.filter(t => (t.date || '').startsWith(yr));

  const verifyTripIds = new Set(_verifyReqs.map(r => r.tripId).filter(Boolean));
  const requested = allTrips.filter(t =>
    ((t.validationRequested === true || t.validationRequested === 'true') || verifyTripIds.has(t.id)) &&
    (!t.verified || t.verified === 'false')
  ).length;
  const verified = allTrips.filter(t => t.verified && t.verified !== 'false').length;

  const totalPersons = ytd.reduce((n, t) => n + (parseInt(t.crew) || 1), 0);
  const uniqueIds    = new Set(ytd.map(t => t.memberKennitala || t.memberId || t.memberName || '').filter(Boolean));

  const catCounts = {};
  ytd.forEach(t => {
    const c = (t.boatCategory || '').trim() || 'Other';
    catCounts[c] = (catCounts[c] || 0) + 1;
  });
  const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
  const catMax = catEntries.length ? catEntries[0][1] : 0;
  const catHtml = catEntries.map(([k, v]) => {
    const key = (k || '').toLowerCase();
    const col = (typeof boatCatColors === 'function') ? boatCatColors(key) : { color: 'var(--accent)' };
    const pct = catMax ? Math.round(v / catMax * 100) : 0;
    const label = (typeof _boatCatLabel === 'function') ? _boatCatLabel(key || 'other') : k;
    return `<div class="cat-hour-row">
      <span style="min-width:70px;color:var(--text)">${esc(label)}</span>
      <div class="cat-hour-bar-wrap"><div class="cat-hour-bar" style="width:${pct}%;background:${col.color}"></div></div>
      <span class="cat-hour-val">${v}</span>
    </div>`;
  }).join('');

  _set('sTotalTrips',   ytd.length);
  _set('sRequested',    requested);
  _set('sVerified',     verified);
  _set('sTotalPersons', totalPersons);
  _set('sUniquePersons',uniqueIds.size);
  const bc = document.getElementById('sBoatCats');
  if (bc) bc.innerHTML = catHtml || '—';
}

function _set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Trips filter + render ─────────────────────────────────────────────────────
function applyFilters() {
  const name    = document.getElementById('filterName').value.trim().toLowerCase();
  const status  = document.getElementById('filterStatus').value;
  const from    = document.getElementById('filterFrom').value;
  const to      = document.getElementById('filterTo').value;
  const showAll = document.getElementById('showAllTrips')?.checked ?? false;

  // Build set of trip IDs with pending verify handshakes
  const verifyTripIds = new Set(_verifyReqs.map(r => r.tripId).filter(Boolean));

  filtered = allTrips.filter(t => {
    if (!showAll &&
        t.validationRequested !== true &&
        t.validationRequested !== 'true' &&
        !verifyTripIds.has(t.id)) return false;
    if (name && !(t.memberName || '').toLowerCase().includes(name)) return false;
    if (status === 'pending'  && (t.verified && t.verified !== 'false')) return false;
    if (status === 'verified' && (!t.verified || t.verified === 'false')) return false;
    if (from && (t.date || '') < from) return false;
    if (to   && (t.date || '') > to)   return false;
    return true;
  });

  renderTrips();
}

function renderTrips() {
  const el = document.getElementById('tripList');
  if (!filtered.length) {
    el.innerHTML = `<div class="empty-note">${s('logrev.noTrips')}</div>`;
    return;
  }
  const verifyTripIds = new Set(_verifyReqs.map(r => r.tripId).filter(Boolean));
  el.innerHTML = filtered.map(t => {
    const isVer = t.verified && t.verified !== 'false';
    // Surface the verification-request handshake on the card itself by setting
    // the same flag that the shared trip card already understands.
    const tripView = verifyTripIds.has(t.id) && !isVer
      ? Object.assign({}, t, { validationRequested: true })
      : t;
    return verifyCard({
      trip: tripView,
      prefix: 'slr',
      wrapperId: 'vrow-' + t.id,
      isVerified: isVer,
      commentId: 'comment-' + t.id,
      commentValue: t.staffComment || '',
      commentPlaceholder: s('logrev.staffComment'),
      buttons: [isVer
        ? { kind:'secondary', label:'✗ ' + s('logrev.unverify'), action:'unverifyTrip', args:[t.id] }
        : { kind:'primary',   label:'✓ ' + s('logrev.verify'),   action:'verifyTrip',   args:[t.id] }],
      footer: (t.staffComment && isVer && t.verifiedBy)
        ? `<div class="slr-verified-by text-xs text-muted">— ${esc(t.verifiedBy)}</div>`
        : '',
    });
  }).join('');
}

// ── Verify / Unverify ─────────────────────────────────────────────────────────
async function verifyTrip(id) {
  const comment = document.getElementById('comment-' + id)?.value.trim() || '';
  const btn = document.querySelector(`#tc-${id} .btn-primary`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    // If there's a pending 'verify' handshake for this trip, respond via the protocol
    const vr = _verifyReqs.find(r => r.tripId === id && r.status === 'pending');
    if (vr) {
      await apiPost('respondConfirmation', { id: vr.id, response: 'confirmed', responderName: user.name });
      _verifyReqs = _verifyReqs.filter(r => r.id !== vr.id);
    }
    // Also update staffComment directly (handshake sets verified + verifiedBy)
    await apiPost('saveTrip', { id, verified: true, staffComment: comment, verifiedBy: user.name });
    const t = allTrips.find(x => x.id === id);
    if (t) Object.assign(t, { verified: 'true', staffComment: comment, verifiedBy: user.name });
    updateStats();
    applyFilters();
    showToast(s('lbl.verified'));
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '✓ ' + s('logrev.verify'); }
    showToast(s('toast.error'), 'err');
  }
}

async function unverifyTrip(id) {
  const comment = document.getElementById('comment-' + id)?.value.trim() || '';
  try {
    await apiPost('saveTrip', { id, verified: false, staffComment: comment, verifiedBy: '' });
    const t = allTrips.find(x => x.id === id);
    if (t) Object.assign(t, { verified: 'false', staffComment: comment, verifiedBy: '' });
    updateStats();
    applyFilters();
    showToast(s('logrev.unverify'));
  } catch (e) {
    showToast(s('toast.error'), 'err');
  }
}

// ── Certification section: member search ──────────────────────────────────────
function searchCertMember(q) {
  const drop = document.getElementById('certMemberDrop');
  if (!q || q.length < 2) { drop.style.display = 'none'; drop.innerHTML = ''; return; }

  const matches = allMembers
    .filter(m => m.name && m.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);

  if (!matches.length) { drop.style.display = 'none'; return; }

  drop.innerHTML = '';
  matches.forEach(m => {
    const item = document.createElement('div');
    item.className = 'text-md';
    item.style.cssText = 'padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border)';
    item.textContent   = m.name;
    item.addEventListener('mouseover', function () { this.style.background = 'var(--card)'; });
    item.addEventListener('mouseout',  function () { this.style.background = ''; });
    item.addEventListener('mousedown', e => { e.preventDefault(); selectCertMember(m); });
    drop.appendChild(item);
  });
  drop.style.display = 'block';
}

function selectCertMember(m) {
  _certMember = m;   // store full member object

  document.getElementById('certMemberSearch').value   = m.name;
  document.getElementById('certMemberDrop').style.display = 'none';
  document.getElementById('certPanelName').textContent = m.name;
  document.getElementById('certPanelMeta').textContent =
    [m.kennitala, m.email].filter(Boolean).join(' · ');
  document.getElementById('certMemberPanel').classList.remove('d-none');
  document.getElementById('certMemberEmpty').classList.add('d-none');

  renderCertPanelList();
}

function renderCertPanelList() {
  const el = document.getElementById('certPanelList');
  if (!_certMember) return;

  const m     = allMembers.find(x => x.id === _certMember.id);
  const certs = m ? enrichMemberCerts(_parseJson(m.certifications, []), _certDefs, _certCats) : [];

  if (!certs.length) {
    el.innerHTML = `<div class="text-muted text-md" style="padding:8px 0">${s('cert.noCerts')}</div>`;
    return;
  }

  el.innerHTML = certs.map(certBadgeHTML).join('');
}

// Open the shared credential modal (same component used by admin/captain).
function openCertAssignModal() {
  if (!_certMember) return;
  if (typeof window.openMemberCertModal !== 'function') {
    showToast(s('toast.error'), 'err');
    return;
  }
  window.openMemberCertModal(_certMember.id);
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function _parseJson(v, fallback) {
  if (!v) return fallback;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fallback; }
}

  function populateCertFilterType() {
  const sel = document.getElementById('certFilterType');
  if (!sel) return;
  sel.innerHTML = `<option value="">— Select credential —</option>`;
  _certDefs.forEach(d => {
    if (d.subcats?.length) {
      d.subcats.forEach(sc => {
        const o = document.createElement('option');
        o.value = d.id + '|' + sc.key;
        o.textContent = certDefName(d) + ' — ' + certSubcatLabel(sc);
        sel.appendChild(o);
      });
    } else {
      const o = document.createElement('option');
      o.value = d.id + '|';
      o.textContent = certDefName(d);
      sel.appendChild(o);
    }
  });
}

function setCertMode(mode) {
  const isMember = mode === 'member';
  document.getElementById('certPanelModeA').classList.toggle('d-none', !isMember);
  document.getElementById('certPanelModeB').classList.toggle('d-none', isMember);
  document.getElementById('certModeByMember').style.background = isMember ? 'var(--accent)' : 'var(--surface)';
  document.getElementById('certModeByMember').style.color      = isMember ? '#fff' : 'var(--muted)';
  document.getElementById('certModeByType').style.background   = isMember ? 'var(--surface)' : 'var(--accent)';
  document.getElementById('certModeByType').style.color        = isMember ? 'var(--muted)' : '#fff';
}
  
function applyCertFilter() {
  const el = document.getElementById('certFilterResults');
  const val = document.getElementById('certFilterType').value;
  if (!val) { el.innerHTML = ''; return; }
  const [certId, sub] = val.split('|');
  const def = _certDefs.find(d => d.id === certId);
  const matches = (allMembers || []).filter(m => {
    const certs = _parseJson(m.certifications, []);
    return certs.some(c => c.certId === certId && (sub ? c.sub === sub : true));
  });
  if (!matches.length) {
    el.innerHTML = `<div class="text-muted text-md" style="padding:6px 0">${s('logrev.certNoMatches')}</div>`;
    return;
  }
  const color = certColor(def || {});
  el.innerHTML = `<div class="text-xs text-muted mb-6">${matches.length} member${matches.length!==1?'s':''}</div>` +
    matches.map(m => {
      const certs = _parseJson(m.certifications, []);
      const c = certs.find(c => c.certId === certId && (sub ? c.sub === sub : true));
      const expiry = c?.expiresAt ? (c.expiresAt < todayISO() ? `<span class="text-red text-xs"> · expired</span>` : `<span class="text-muted text-xs"> · exp. ${c.expiresAt}</span>`) : '';
      return `<div class="flex-center gap-10" style="padding:7px 0;border-bottom:1px solid var(--border)44">
        <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div>
        <div class="flex-1 text-base">${esc(m.name)}<span class="text-xs text-muted" style="margin-left:6px">${esc(m.role||'')}</span>${expiry}</div>
      </div>`;
    }).join('');
}

// ── Activity log section ──────────────────────────────────────────────────────
// Default range mirrors the server's fallback (last 30 days). Filling the
// inputs lets the user widen or narrow without first guessing dates.
function initActivityDateInputs() {
  var today = todayISO();
  var d = new Date(today + 'T00:00:00');
  d.setDate(d.getDate() - 30);
  var from = d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  var fromEl = document.getElementById('actFilterFrom');
  var toEl   = document.getElementById('actFilterTo');
  if (fromEl && !fromEl.value) fromEl.value = from;
  if (toEl   && !toEl.value)   toEl.value   = today;
}

function populateActivityFilters() {
  var tagSel  = document.getElementById('actFilterTag');
  var typeSel = document.getElementById('actFilterType');
  if (!tagSel || !typeSel) return;
  // Distinct class tags (server uses the EN form for filtering).
  var tagSeen = {};
  var tagOpts = [];
  (_actTypes || []).forEach(function (t) {
    if (!t || !t.classTag) return;
    if (tagSeen[t.classTag]) return;
    tagSeen[t.classTag] = true;
    tagOpts.push({ value: t.classTag, label: actTagLabel(t) });
  });
  tagOpts.sort(function (a, b) { return a.label.localeCompare(b.label); });
  // Preserve "All tags" option (already in the markup) and append the rest.
  tagSel.querySelectorAll('option:not(#actFilterTagAll)').forEach(function (o) { o.remove(); });
  tagOpts.forEach(function (o) {
    var opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    tagSel.appendChild(opt);
  });
  // Activity types: only those with an id, sorted by displayed name.
  var typeOpts = (_actTypes || [])
    .filter(function (t) { return t && t.id; })
    .map(function (t)    { return { id: t.id, label: actTypeLabel(t) }; })
    .sort(function (a, b) { return a.label.localeCompare(b.label); });
  typeSel.querySelectorAll('option:not(#actFilterTypeAll)').forEach(function (o) { o.remove(); });
  typeOpts.forEach(function (t) {
    var opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label;
    typeSel.appendChild(opt);
  });
}

function actTypeLabel(t) {
  if (!t) return '';
  return (L === 'IS' && t.nameIS) ? t.nameIS : (t.name || t.nameIS || '');
}
function actTagLabel(t) {
  if (!t) return '';
  return (L === 'IS' && t.classTagIS) ? t.classTagIS : (t.classTag || t.classTagIS || '');
}

async function loadActivityLog() {
  var from = document.getElementById('actFilterFrom').value;
  var to   = document.getElementById('actFilterTo').value;
  var listEl = document.getElementById('actList');
  if (listEl) listEl.innerHTML = `<div class="empty-note">${s('lbl.loading')}</div>`;
  try {
    var res = await apiPost('getActivityLog', { from: from, to: to });
    _actAll = res.activities || [];
    _actDataLoaded = true;
    applyActivityFilters();
  } catch (e) {
    if (listEl) listEl.innerHTML =
      `<div class="empty-note text-red">${s('toast.loadFailed')}: ${esc(e.message)}</div>`;
  }
}

function reloadActivityLog() { loadActivityLog(); }

function applyActivityFilters() {
  if (!_actDataLoaded) return;
  var tag    = document.getElementById('actFilterTag').value;
  var typeId = document.getElementById('actFilterType').value;
  var q      = document.getElementById('actFilterSearch').value.trim().toLowerCase();
  var loggedOnly = document.getElementById('actFilterLogged').checked;
  var rows = _actAll.filter(function (a) {
    if (tag    && (a.classTag || '') !== tag) return false;
    if (typeId && a.activityTypeId !== typeId) return false;
    if (loggedOnly && !a.hasLog) return false;
    if (q) {
      var hay = [a.title, a.subtypeName, a.participants, a.notes, a.runNotes, a.leaderName]
        .map(function (v) { return (v || '').toLowerCase(); }).join(' ');
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  renderActivityLog(rows);
}

function renderActivityLog(rows) {
  var summaryEl = document.getElementById('actSummary');
  var listEl    = document.getElementById('actList');
  if (!listEl) return;
  if (summaryEl) {
    var loggedCount = rows.filter(function (a) { return a.hasLog; }).length;
    summaryEl.textContent = s('slr.act.summary')
      .replace('{n}',      String(rows.length))
      .replace('{logged}', String(loggedCount));
  }
  if (!rows.length) {
    listEl.innerHTML = `<div class="empty-note">${s('slr.act.empty')}</div>`;
    return;
  }
  listEl.innerHTML = rows.map(activityCardHTML).join('');
}

function activityCardHTML(a) {
  var tagLbl = (L === 'IS' && a.classTagIS) ? a.classTagIS : a.classTag;
  var titleLbl = (L === 'IS' && a.titleIS) ? a.titleIS : (a.title || a.titleIS || '');
  if (a.subtypeName) titleLbl += ' · ' + a.subtypeName;
  var time = (a.startTime || a.endTime)
    ? `<span class="text-xs text-muted" style="margin-left:6px">${esc(a.startTime || '')}${a.endTime ? '–' + esc(a.endTime) : ''}</span>`
    : '';
  var tagBadge = tagLbl
    ? `<span class="slr-act-tag">${esc(tagLbl)}</span>`
    : '';
  var leaderLine = a.leaderName
    ? `<div class="text-xs text-muted">${esc(s('slr.act.leader'))}: ${esc(a.leaderName)}</div>`
    : '';
  var participantsLine = a.participants
    ? `<div class="text-xs text-muted">${esc(s('slr.act.participants'))}: ${esc(a.participants)}</div>`
    : '';
  var notesLine = a.notes
    ? `<div class="text-sm mt-6"><span class="text-xs text-muted">${esc(s('slr.act.brief'))}:</span> ${esc(a.notes)}</div>`
    : '';
  var logLine = a.hasLog
    ? `<div class="text-sm mt-6 slr-act-log"><span class="text-xs text-muted">${esc(s('slr.act.log'))}:</span> ${esc(a.runNotes)}</div>`
    : `<div class="text-xs text-muted mt-6 fst-italic">${esc(s('slr.act.noLog'))}</div>`;
  return `<div class="slr-act-card${a.hasLog ? '' : ' slr-act-card-empty'}">
    <div class="flex-between mb-4">
      <div class="fw-500">${esc(titleLbl || '—')}${time}</div>
      ${tagBadge}
    </div>
    <div class="text-xs text-muted mb-4">${esc(a.date)}</div>
    ${leaderLine}
    ${participantsLine}
    ${notesLine}
    ${logLine}
  </div>`;
}

// Minimal trip-card delegation — staff doesn't load shared/logbook.js, so we
// reimplement the open-card / toggle-section toggles locally. Keeps tripCard's
// own data-trip-action surface working without pulling in the full module.
(function () {
  if (typeof document === 'undefined' || document._slrTripListener) return;
  document._slrTripListener = true;
  document.addEventListener('click', function (e) {
    // Don't collapse a trip card when interacting with its inner controls.
    if (e.target.closest('[data-trip-nobubble]') && !e.target.closest('[data-trip-action]')) {
      e.stopPropagation();
      return;
    }
    var el = e.target.closest('[data-trip-action]');
    if (!el) {
      // Click outside any trip-card collapses any open ones (matches logbook.js behavior).
      if (!e.target.closest('.trip-card')) {
        document.querySelectorAll('.trip-card.open').forEach(function (c) { c.classList.remove('open'); });
      }
      return;
    }
    var action = el.dataset.tripAction;
    if (action === 'open-card') {
      e.stopPropagation();
      el.parentElement.classList.toggle('open');
    } else if (action === 'toggle-section') {
      e.stopPropagation();
      var detail = el.parentElement.querySelector('.exp-section-detail');
      if (detail) detail.classList.toggle('open');
      el.classList.toggle('expanded');
    }
  });
})();

(function () {
  if (typeof document === 'undefined' || document._slrListeners) return;
  document._slrListeners = true;
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-slr-click]');
    if (c && typeof window[c.dataset.slrClick] === 'function') {
      var a = [c.dataset.slrArg, c.dataset.slrArg2].filter(function (v) { return v != null; });
      window[c.dataset.slrClick].apply(null, a);
    }
  });
  document.addEventListener('change', function (e) {
    var c = e.target.closest('[data-slr-change]');
    if (c && typeof window[c.dataset.slrChange] === 'function') window[c.dataset.slrChange]();
  });
  document.addEventListener('input', function (e) {
    var iv = e.target.closest('[data-slr-input-val]');
    if (iv && typeof window[iv.dataset.slrInputVal] === 'function') { window[iv.dataset.slrInputVal](iv.value); return; }
    var i = e.target.closest('[data-slr-input]');
    if (i && typeof window[i.dataset.slrInput] === 'function') window[i.dataset.slrInput]();
  });
})();
