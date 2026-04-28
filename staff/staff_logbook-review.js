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
  document.getElementById('tcmAssignBtn').textContent      = s('logrev.assignBtn');

  // Pre-fill today in assigned-date
  document.getElementById('tcmAssignedAt').value = todayISO();

  init();
});

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

function _buildCertTypeSelect() {
  const sel = document.getElementById('tcmCertType');
  sel.innerHTML = `<option value="">${s('lbl.selectDots')}</option>`;
  _certDefs.forEach(d => {
    const o = document.createElement('option');
    o.value       = d.id;
    o.textContent = certDefName(d);
    sel.appendChild(o);
  });
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
    // Mirror trip-card boat-category tint on the wrapper so the verify row
    // reads as the same surface (matches tripCard's --tc-cat formula).
    const cat = (allBoats.find(b => b.id === t.boatId)?.category) || t.boatCategory || '';
    const catCol = boatCatColors(cat);
    return `<div class="slr-trip${isVer ? ' is-verified' : ''}" style="--tc-cat:${catCol.color}">
      ${tripCard(tripView)}
      <div class="slr-verify-row" id="vrow-${esc(t.id)}">
        <div class="slr-reviewer">
          <input type="text" id="comment-${esc(t.id)}" placeholder="${s('logrev.staffComment')}"
                 value="${esc(t.staffComment || '')}" class="text-md flex-1">
          ${isVer
            ? `<button class="btn btn-secondary btn-sm" data-slr-click="unverifyTrip" data-slr-arg="${esc(t.id)}">✗ ${s('logrev.unverify')}</button>`
            : `<button class="btn btn-primary btn-sm" data-slr-click="verifyTrip" data-slr-arg="${esc(t.id)}">✓ ${s('logrev.verify')}</button>`}
        </div>
        ${t.staffComment && isVer && t.verifiedBy
          ? `<div class="slr-verified-by text-xs text-muted">— ${esc(t.verifiedBy)}</div>`
          : ''}
      </div>
    </div>`;
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
  document.getElementById('certMemberPanel').style.display = '';
  document.getElementById('certMemberEmpty').style.display = 'none';

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

  el.innerHTML = certs.map(c => {
    const expiry = c.expiresAt
      ? (new Date(c.expiresAt) < new Date()
          ? `<span class="text-red">Expired ${esc(c.expiresAt)}</span>`
          : `Expires ${esc(c.expiresAt)}`)
      : 'Does not expire';
    const defLabel = c.def ? certDefName(c.def) : (c.certId || '');
    const label = c.subcat
      ? `${esc(defLabel)} — ${esc(certSubcatLabel(c.subcat))}`
      : esc(defLabel);
    return `<div class="cert-row">
      <div>
        <div class="cert-name">${label}</div>
        <div class="cert-meta">${expiry}${c.assignedAt ? ' · Issued ' + esc(c.assignedAt) : ''}</div>
      </div>
      <div class="cert-actions">
        <button class="btn btn-secondary btn-sm"
          data-slr-click="editCert" data-slr-arg="${esc(c.certId)}" data-slr-arg2="${esc(c.sub||'')}">Edit</button>
        <button class="btn btn-secondary btn-sm text-red"
          data-slr-click="deleteCert" data-slr-arg="${esc(c.certId)}" data-slr-arg2="${esc(c.sub||'')}">✕</button>
      </div>
    </div>`;
  }).join('');
}

// ── Cert assignment modal ─────────────────────────────────────────────────────
function openCertAssignModal(certId, subcatKey) {
  if (!_certMember) return;

  document.getElementById('tcmTitle').textContent =
    s('cert.assign') + ' — ' + _certMember.name;

  // Show current certs
  const m     = allMembers.find(x => x.id === _certMember.id);
  const certs = m ? enrichMemberCerts(_parseJson(m.certifications, []), _certDefs, _certCats) : [];
  document.getElementById('tcmCurrentList').innerHTML = certs.length
    ? certs.map(certBadgeHTML).join('')
    : `<div class="text-muted text-sm" style="font-style:italic">${s('cert.noCerts')}</div>`;

  // Reset / pre-fill form
  document.getElementById('tcmAssignedAt').value     = todayISO();
  document.getElementById('tcmExpiresAt').value      = '';
  document.getElementById('tcmSubcatField').style.display = 'none';
  document.getElementById('tcmExpiryField').style.display = 'none';

  if (certId) {
    document.getElementById('tcmCertType').value = certId;
    tcmCertTypeChanged();
    if (subcatKey) {
      // wait one tick for subcat select to render
      setTimeout(() => {
        document.getElementById('tcmSubcat').value = subcatKey;
      }, 50);
    }
  } else {
    document.getElementById('tcmCertType').value = '';
  }

  openModal('tripCertModal');
}

function editCert(certId, subcatKey) {
  openCertAssignModal(certId, subcatKey);
}

function tcmCertTypeChanged() {
  const def    = _certDefs.find(d => d.id === document.getElementById('tcmCertType').value);
  const sField = document.getElementById('tcmSubcatField');
  const eField = document.getElementById('tcmExpiryField');

  if (def?.subcats?.length) {
    const sSel = document.getElementById('tcmSubcat');
    sSel.innerHTML = `<option value="">${s('lbl.selectDots')}</option>`;
    def.subcats.forEach(sc => {
      const o = document.createElement('option');
      o.value = sc.key; o.textContent = sc.label;
      sSel.appendChild(o);
    });
    sField.style.display = '';
  } else {
    sField.style.display = 'none';
  }

  if (def?.expires) {
    eField.style.display = '';
  } else {
    document.getElementById('tcmExpiresAt').value = '';
    eField.style.display = 'none';
  }
}

async function tcmAssign() {
  const certId = document.getElementById('tcmCertType').value;
  if (!certId) { showToast(s('lbl.type') + ' required.', 'err'); return; }

  const def = _certDefs.find(d => d.id === certId);
  const sub = def?.subcats?.length ? document.getElementById('tcmSubcat').value : null;
  if (def?.subcats?.length && !sub) { showToast(s('cert.level') + ' required.', 'err'); return; }

  if (!_certMember) { showToast(s('logrev.noMemberSelected'), 'err'); return; }

  const m = allMembers.find(x => x.id === _certMember.id);
  if (!m) { showToast(s('logrev.memberNotFound'), 'err'); return; }

  const newCert = {
    certId,
    sub:        sub || null,
    assignedBy: user.name,
    assignedAt: document.getElementById('tcmAssignedAt').value || todayISO(),
    expiresAt:  document.getElementById('tcmExpiresAt').value  || null,
  };

  // Apply rank rule (removes lower-ranked subcats of same cert), then
  // remove exact duplicate before appending
  let existing = _parseJson(m.certifications, []);
  existing = applyRankRule(existing, newCert, _certDefs);
  existing = existing.filter(c => !(c.certId === certId && (c.sub || null) === (sub || null)));
  const updated = [...existing, newCert];

  try {
    await apiPost('saveMemberCert', { memberId: _certMember.id, certifications: updated });

    // Update local copy
    const idx = allMembers.findIndex(x => x.id === _certMember.id);
    if (idx >= 0) allMembers[idx] = { ...allMembers[idx], certifications: JSON.stringify(updated) };

    // Refresh current-certs display inside modal
    document.getElementById('tcmCurrentList').innerHTML =
      enrichMemberCerts(updated, _certDefs, _certCats).map(certBadgeHTML).join('');

    // Reset form
    document.getElementById('tcmCertType').value         = '';
    document.getElementById('tcmSubcatField').style.display = 'none';
    document.getElementById('tcmExpiryField').style.display = 'none';

    showToast('✓ ' + s('cert.assign') + ': ' + m.name);

    // Refresh cert panel list too
    renderCertPanelList();
  } catch (e) {
    showToast(s('toast.error') + ': ' + e.message, 'err');
  }
}

async function deleteCert(certId, subcatKey) {
  if (!_certMember) return;
  if (!await ymConfirm('Remove this credential?')) return;

  const m = allMembers.find(x => x.id === _certMember.id);
  if (!m) return;

  let certs = _parseJson(m.certifications, []);
  certs = certs.filter(c => !(c.certId === certId && (c.sub || '') === (subcatKey || '')));

  try {
    await apiPost('saveMemberCert', { memberId: _certMember.id, certifications: certs });
    const idx = allMembers.findIndex(x => x.id === _certMember.id);
    if (idx >= 0) allMembers[idx] = { ...allMembers[idx], certifications: JSON.stringify(certs) };
    renderCertPanelList();
    showToast(s('logrev.credentialRemoved'));
  } catch (e) {
    showToast(s('toast.error') + ': ' + e.message, 'err');
  }
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
  document.getElementById('certPanelModeA').style.display  = isMember ? '' : 'none';
  document.getElementById('certPanelModeB').style.display  = isMember ? 'none' : '';
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
    var cs = e.target.closest('[data-slr-close-self]');
    if (cs && e.target === cs) { closeModal('tripCertModal'); return; }
    var cl = e.target.closest('[data-slr-close]');
    if (cl) { closeModal(cl.dataset.slrClose); return; }
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
