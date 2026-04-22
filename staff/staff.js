prefetch({Config:['getConfig'],Checkouts:['getActiveCheckouts']});
const user = requireAuth(isStaff);
if (user) {
  document.getElementById('userBadge').textContent = user.name + (isAdmin(user) ? ' · Admin' : ' · Staff');
}

let _staffStatus = { onDuty: false, supportBoat: false, updatedAt: null, updatedByName: null };
let _latestWxResult = null;
let checkouts = [], boats = [], members = [], locations = [], maintenance = [];
let crewCount = 1, selectedMemberKt = '';
let wxData = null;
let _detailId = null;
let _fleetAllOpen = false;

document.addEventListener('DOMContentLoaded', async () => {
  buildHeader('staff');
  applyStrings(); // ← wire all data-s attributes

  // ── Wire dynamic string labels that can't use data-s (need live values) ──
  const L = getLang();
  document.getElementById('boatsOutNowLabel').textContent    = s('staff.boatsOutNow');
  document.getElementById('newCheckoutLabel').textContent    = s('staff.newCheckout');
  document.getElementById('memberLabel').textContent         = s('lbl.member');
  document.getElementById('boatLabel').textContent           = s('lbl.boat');
  document.getElementById('locationLabel').textContent       = s('lbl.location');
  document.getElementById('departureLabel').textContent      = s('staff.coForm.departure');
  document.getElementById('estReturnLabel').textContent      = s('staff.coForm.estReturn');
  document.getElementById('crewLabel').textContent           = s('staff.coForm.crew');
  document.getElementById('notesLabel').textContent          = s('staff.coForm.notes');
  document.getElementById('cancelCoBtn').textContent         = s('btn.cancel');
  document.getElementById('submitCoBtn').textContent         = s('staff.coForm.submit');
  const coDepPort = document.getElementById('coDeparturePort');
  if (coDepPort) coDepPort.placeholder = s('admin.homePort');
  document.getElementById('selectBoatOpt').textContent       = s('lbl.selectDots');
  document.getElementById('selectLocOpt').textContent        = s('lbl.selectDots');
  document.getElementById('coMember').placeholder            = s('staff.coForm.memberPlaceholder');
  document.getElementById('coNotes').placeholder             = s('staff.coForm.notesPlaceholder');
  document.getElementById('viewAllMaintLink').textContent    = s('btn.viewAll');

  wxWidget(document.getElementById('wxWidget'), { getStaffStatus: () => _staffStatus,
    showRefreshBtn: true,
    onData: snap => {
      wxData = snap;
      updateFlagCard(snap);
    },
  }).start();

  tideWidget(document.getElementById('tideWidget')).start();

  let _cfgRes = null;
  try {
    const [coRes, cfgRes, mRes, maintRes] = await Promise.all([
      window._earlyCheckouts || apiGet('getActiveCheckouts'),
      window._earlyConfig || apiGet('getConfig'),
      apiGet('getMembers'),
      apiGet('getMaintenance').catch(() => ({ requests: [] })),
    ]);
    _cfgRes = cfgRes;
    checkouts   = coRes.checkouts  || [];
    boats       = (cfgRes.boats     || []).filter(b => b.active !== false && b.active !== 'false');
    locations   = (cfgRes.locations || []).filter(l => l.active !== false && l.active !== 'false');
    members     = (mRes.members    || []).filter(m => m.active !== false && m.active !== 'false');
    maintenance = (maintRes.requests || maintRes.maintenance || [])
      .filter(r => r.status !== 'resolved' && !r.resolved && !boolVal(r.saumaklubbur));

    if (cfgRes.boatCategories && cfgRes.boatCategories.length) {
      registerBoatCats(cfgRes.boatCategories.filter(c => c.active !== false && c.active !== 'false'));
    }
    if (typeof wxLoadFlagConfig === 'function' && cfgRes.flagConfig) { wxLoadFlagConfig(cfgRes.flagConfig); document.getElementById('wxWidget')?._wxRefresh?.(); }
    if (cfgRes.staffStatus) { _staffStatus = cfgRes.staffStatus; renderStaffStatusStrip(); document.getElementById('wxWidget')?._wxRefreshBadges?.(); }
    _flagOverride = cfgRes.flagOverride || null;
    if (typeof wxLoadFlagOverride === 'function') wxLoadFlagOverride(_flagOverride);
    renderFlagOverrideCard();
    document.getElementById('wxWidget')?._wxRefresh?.();

    populateSelects();
    renderAll();
    renderMaintenance();

    // Incidents needing review / follow-up — badge on nav card
    apiGet('getIncidents').then(r => {
      const list = (r && r.incidents) || [];
      const needs = list.filter(i => {
        const resolved = i.resolved && i.resolved !== 'false';
        return !resolved && (i.status === 'review' || i.followUp);
      }).length;
      const badge = document.getElementById('incidentsNavBadge');
      if (badge && needs) { badge.textContent = needs + ' ⚠'; badge.classList.remove('hidden'); badge.title = s('incident.statusReview'); }
    }).catch(()=>{});
  } catch(e) {
    document.getElementById('activeCheckouts').innerHTML =
      `<div class="empty-note" style="color:var(--red)">${s('toast.loadFailed')}: ${esc(e.message)}</div>`;
  }

  window._maintUser = user;
    // Init punch clock — find this employee's payroll record
    (async () => {
      try {
        const empRes = await apiGet('getEmployees');
        const me = (empRes.employees||[]).find(e =>
          (e.memberId && String(e.memberId) === String(user?.id)) ||
          (e.kt && String(e.kt).replace(/[^0-9]/g,'') === String(user?.kennitala||'').replace(/[^0-9]/g,'')) ||
          (e.name && user?.name && e.name.trim() === user.name.trim())
        );
        if (me && (me.payrollEnabled === true || me.payrollEnabled === 'true')) {
          const allowBreaks = !!(_cfgRes && _cfgRes.allowBreaks);
          punchClockWidget(document.getElementById('punchClockWidget'), me.id, { allowBreaks });
        } else {
          const el = document.getElementById('punchClockWidget');
          if (el) el.innerHTML = '<div class="empty-note" data-s="payroll.notEnabled"></div>';
          applyStrings(document.getElementById('punchClockWidget'));
        }
      } catch(e) {
        const el = document.getElementById('punchClockWidget');
        if (el) el.innerHTML = '<div class="empty-note">' + s('staff.payrollUnavail') + '</div>';
      }
    })();
  warmContainer();
  setInterval(pollOverdueAlerts, 120000);
});

// Flag info now lives inside the wx widget — nothing extra to update here.
function updateFlagCard(snap) {}



// ── Selects ───────────────────────────────────────────────────────────────────
function populateSelects() {
  const bSel   = document.getElementById('coBoat');
  const active = checkouts.filter(c => c.status === 'out');
  boats.filter(b => !active.find(c => c.boatId === b.id) && !boolVal(b.oos))
    .forEach(b => {
      const o = document.createElement('option'); o.value=b.id;
      const activeRes = getActiveReservation(b);
      o.textContent = b.name + (activeRes ? ' [' + s('fleet.badgeChartered') + ']' : '');
      bSel.appendChild(o);
    });
  const lSel = document.getElementById('coLocation');
  locations.filter(l => l.type !== 'port').forEach(l => {
    const o = document.createElement('option'); o.value=l.id; o.textContent=l.name; lSel.appendChild(o);
  });
  document.getElementById('coTimeOut').value = fmtTimeNow();
}

// ── Render all ────────────────────────────────────────────────────────────────
function renderAll() {
  renderStats();
  renderCheckouts();
  renderRecentCheckins();
  renderFleet();
  pollOverdueAlerts();
}

function renderStats() {
  const active  = checkouts.filter(c => c.status === 'out');
  const overdue = active.filter(c => {
    if (!c.expectedReturn) return false;
    return c.expectedReturn < fmtTimeNow();
  });
  const people  = active.reduce((n, c) => n + (parseInt(c.crew) || 1), 0);
  // Count total boats: group checkouts may have multiple boats
  const totalBoats = active.reduce((n, c) => {
    if (c.isGroup === true || c.isGroup === 'true') {
      try { const bn = c.boatNames ? (typeof c.boatNames==='string'?JSON.parse(c.boatNames):c.boatNames) : [c.boatName]; return n + bn.length; } catch(e){ return n+1; }
    }
    return n + 1;
  }, 0);
  document.getElementById('statBoats').textContent   = totalBoats;
  document.getElementById('statPeople').textContent  = people;
  const el = document.getElementById('statOverdue');
  el.textContent = overdue.length;
  el.style.color = overdue.length ? 'var(--red)' : 'var(--muted)';
}

// ── Fleet ─────────────────────────────────────────────────────────────────────
function renderFleet() {
  const active = checkouts.filter(c => c.status === 'out');
  renderFleetStatus('fleetStatus', boats, active, {
    onClickAction: 'openBoatActionCard',
    toggleFn:      'toggleFleetCat',
    collapsed:     true,
    staffView:     true,
  });
}

function toggleFleetCat(hdr) {
  const targetId = hdr.dataset.target;
  const body  = targetId ? document.getElementById(targetId) : hdr.nextElementSibling;
  const arrow = hdr.querySelector('.fsb-arrow,.fct-arrow');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.textContent = isOpen ? '▾' : '▴';
}



// ── Active checkouts ──────────────────────────────────────────────────────────
function renderCheckouts() {
  const el     = document.getElementById('activeCheckouts');
  const active = checkouts.filter(c => c.status === 'out');
  if (!active.length) { el.innerHTML = '<div class="empty-note">' + s('staff.noOverdue').replace('overdue ','') + '</div>'; return; }
  el.innerHTML = '';
  const groups  = active.filter(c => c.isGroup === true || c.isGroup === 'true');
  const singles = active.filter(c => c.isGroup !== true && c.isGroup !== 'true');
  boatRegistry.setCos(singles);
  groups.forEach(c => { el.appendChild(renderGroupCard(c)); });
  singles.forEach(c => {
    const inner = renderCheckoutCard(c, {
      staffView: true,
      onCheckIn: "staffCheckIn",
      onDelete:  "staffDeleteCheckout",
    });
    const wrapper = document.createElement('div');
    wrapper.innerHTML = inner.replace(
      'class="bc-checkout-card"',
      'class="bc-checkout-card" data-checkout-id="' + c.id + '" data-staff-card="co-detail" style="cursor:pointer"'
    );
    el.appendChild(wrapper.firstElementChild);
  });
}

// ── Recent check-ins ──────────────────────────────────────────────────────────
function renderRecentCheckins() {
  const el     = document.getElementById('recentCheckins');
  const recent = checkouts.filter(c => c.status === 'in').slice(0, 10);
  const IS     = document.documentElement.lang === 'IS' || getLang() === 'IS';
  if (!recent.length) { el.innerHTML = `<div class="empty-note">${s('lbl.noData')}</div>`; return; }
  const header = `<div class="recent-row recent-header">
    <span>${s('staff.recentIn')}</span>
    <span>${s('staff.recentMember')}</span>
    <span>${s('staff.recentBoat')}</span>
    <span>${s('staff.recentArea')}</span>
    <span>${s('staff.recentDuration')}</span>
  </div>`;
  const rows = recent.map(c => {
    const tin  = sstr(c.checkedInAt ||c.timeIn).slice(0,5);
    const tout = sstr(c.checkedOutAt||c.timeOut).slice(0,5);
    let dur = '';
    if (tout && tin) {
      const [oh,om] = tout.split(':').map(Number);
      const [ih,im] = tin.split(':').map(Number);
      let mins = (ih*60+im) - (oh*60+om);
      if (mins < 0) mins += 1440;
      dur = mins >= 60 ? Math.floor(mins/60)+'h'+(mins%60?String(mins%60).padStart(2,'0'):'') : mins+'min';
    }
    return `<div class="recent-row">
      <span class="recent-time">${esc(tin)||'—'}</span>
      <span class="recent-name">${esc(c.memberName||'')}</span>
      <span class="recent-boat">${esc(c.boatName||c.boatId||'')}</span>
      <span class="recent-loc">${esc(c.locationName||'')}</span>
      <span class="recent-dur">${dur}</span>
    </div>`;
  }).join('');
  el.innerHTML = header + rows;
}

// ── Maintenance ───────────────────────────────────────────────────────────────
function renderMaintenance() {
  const el = document.getElementById('maintList');
  if (!el) return;
  const open = (maintenance || []).filter(r => !boolVal(r.resolved));
  if (!open.length) {
    el.innerHTML = `<div class="empty-note">${s('staff.noMaint')}</div>`;
    return;
  }
  el.innerHTML = open.map(r => maintRenderCardCompact(r)).join('');
  el.querySelectorAll('.maint-card-compact').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const r  = (maintenance || []).find(x => x.id === id);
      if (r) maintOpenDetail(r, user?.name);
    });
  });
}

// ── Checkout form helpers ─────────────────────────────────────────────────────
function toggleCheckoutForm() {
  const form = document.getElementById('coForm');
  form.classList.toggle('hidden');
}

function searchMember(q) {
  const box = document.getElementById('coMemberSuggestions');
  if (!q || q.length < 2) { box.innerHTML=''; return; }
  const matches = members.filter(m =>
    m.name.toLowerCase().includes(q.toLowerCase()) || String(m.kennitala).includes(q)
  ).slice(0,6);
  let html = matches.map(m =>
    `<div style="padding:6px 10px;cursor:pointer;border:1px solid var(--border);border-top:none;
      background:var(--card);font-size:12px" onmousedown="selectMember('${m.kennitala}','${esc(memberDisplayName(m, members))}')"
    >${esc(memberDisplayName(m, members))} <span style="color:var(--muted)">${m.kennitala}</span>${m.isMinor?`<span class="badge badge-yellow" style="margin-left:6px">${s('lbl.minor')}</span>`:''}</div>`
  ).join('');
  if (q.length >= 3) {
    html += `<div class="guest-add-hint" onmousedown="promptGuestSkipper('${esc(q.trim())}')"
      >${s('staff.addAsGuest',{name:esc(q.trim())})}</div>`;
  }
  box.innerHTML = html;
}

function promptGuestSkipper(name) {
  document.getElementById('coMemberSuggestions').innerHTML = '';
  openGuestModal(name, function(guest) {
    selectedMemberKt = guest.kennitala || guest.id || '';
    document.getElementById('coMember').value = guest.name;
    document.getElementById('coMemberName').textContent = guest.phone || '';
  });
}

function selectMember(kt, name) {
  selectedMemberKt = kt;
  document.getElementById('coMember').value = name;
  document.getElementById('coMemberSuggestions').innerHTML = '';
  const m = members.find(x => x.kennitala === kt);
  document.getElementById('coMemberName').textContent = m ? (m.phone||'') : '';
}

function adjustCrew(d) {
  crewCount = Math.max(1, crewCount + d);
  document.getElementById('crewNum').textContent = crewCount;
  renderCoCrewInputs();
}

function setCoReturnIn(mins) {
  const now = new Date();
  now.setMinutes(now.getMinutes() + mins);
  document.getElementById('coReturnBy').value = now.toTimeString().slice(0,5);
}

async function renderCoCrewInputs() {
  const n    = crewCount - 1;
  const sec  = document.getElementById('coCrewSection');
  const wrap = document.getElementById('coCrewInputs');
  if (!sec || !wrap) return;
  if (n < 1) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  const existing = Array.from(wrap.querySelectorAll('input')).map(i => ({ val: i.value, kt: i.dataset.kennitala||'', guest: i.dataset.guest||'' }));
  wrap.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const prev = existing[i] || {};
    const row = document.createElement('div');
    row.style.cssText = 'position:relative;margin-bottom:6px';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = s('staff.crewSearchPh',{n:i+1});
    inp.value = prev.val || '';
    inp.dataset.kennitala = prev.kt || '';
    if (prev.guest) inp.dataset.guest = prev.guest;
    inp.style.cssText = 'width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:inherit;font-size:11px;padding:6px 8px';
    const drop = document.createElement('div');
    drop.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:var(--surface);border:1px solid var(--border);border-radius:0 0 6px 6px;z-index:200;max-height:160px;overflow-y:auto;display:none';
    inp.addEventListener('input', function() { searchCoCrewMembers(this, drop); });
    inp.addEventListener('blur',  function() { setTimeout(function(){ drop.style.display='none'; }, 200); });
    row.appendChild(inp);
    row.appendChild(drop);
    wrap.appendChild(row);
  }
}
function searchCoCrewMembers(inp, drop) {
  const q = inp.value.trim().toLowerCase();
  if (!q || q.length < 2) { drop.style.display = 'none'; return; }
  const skip = selectedMemberKt; // exclude the skipper
  const matches = (members||[]).filter(m =>
    m.name && m.name.toLowerCase().includes(q) && m.kennitala !== skip
  ).slice(0, 8);
  drop.innerHTML = '';
  matches.forEach(function(m) {
    const item = document.createElement('div');
    item.style.cssText = 'padding:7px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px';
    item.appendChild(document.createTextNode(m.name));
    if (m.role === 'guest') {
      const badge = document.createElement('span');
      badge.textContent = s('lbl.guest');
      badge.style.cssText = 'font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid var(--brass)55;background:var(--brass)11;color:var(--brass-fg);flex-shrink:0';
      item.appendChild(badge);
    }
    item.addEventListener('mouseover', function(){ this.style.background = 'var(--card)'; });
    item.addEventListener('mouseout',  function(){ this.style.background = ''; });
    item.addEventListener('mousedown', function(e) {
      e.preventDefault();
      inp.value = m.name;
      inp.dataset.kennitala = m.kennitala || '';
      inp.dataset.guest = m.role === 'guest' ? '1' : '';
      drop.style.display = 'none';
    });
    drop.appendChild(item);
  });
  // "Add as guest" option when typed name is not found
  if (q.length >= 3) {
    const guestItem = document.createElement('div');
    guestItem.className = 'guest-add-hint';
    guestItem.textContent = s('staff.addAsGuest',{name:inp.value.trim()});
    guestItem.addEventListener('mousedown', function(e) {
      e.preventDefault();
      drop.style.display = 'none';
      const typedName = inp.value.trim();
      openGuestModal(typedName, function(guest) {
        inp.value = guest.name;
        inp.dataset.kennitala = guest.kennitala || '';
      });
    });
    drop.appendChild(guestItem);
  }
  drop.style.display = 'block';
}

async function submitCheckout() {
  const kt  = selectedMemberKt;
  const bid = document.getElementById('coBoat').value;
  const lid = document.getElementById('coLocation').value;
  const err = document.getElementById('coErr');
  if (!kt)  { err.textContent = s('staff.coForm.errMember');   err.style.display='block'; return; }
  if (!bid) { err.textContent = s('staff.coForm.errBoat');     err.style.display='block'; return; }
  if (!lid) { err.textContent = s('staff.coForm.errLocation'); err.style.display='block'; return; }
  err.style.display = 'none';
  const boat     = boats.find(b => b.id === bid) || {};
  const location = locations.find(l => l.id === lid) || {};
  const member   = members.find(m => m.kennitala === kt) || {};
  const snap     = (typeof wxSnapshot === 'function') ? wxSnapshot(wxData) : null;
  try {
    const res = await apiPost('saveCheckout', {
      memberKennitala: kt, memberName: member.name||kt,
      boatId: bid, boatName: boat.name||bid, boatCategory: boat.category||'',
      locationId: lid, locationName: location.name||lid,
      checkedOutAt: document.getElementById('coTimeOut').value,
      expectedReturn: document.getElementById('coReturnBy').value,
      crew: crewCount, notes: document.getElementById('coNotes').value.trim(),
      departurePort: (document.getElementById('coDeparturePort').value||'').trim(),
      memberPhone: member.phone||'', memberIsMinor: member.isMinor||false,
      guardianName: member.guardianName||'', guardianPhone: member.guardianPhone||'',
      wxSnapshot: snap,
      crewNames: (function(){ var _cn=Array.from(document.querySelectorAll('#coCrewInputs input')).map(function(i){return{name:i.value.trim(),kennitala:i.dataset.kennitala||'',guest:!!i.dataset.guest};}).filter(function(c){return c.name;}); return _cn.length?JSON.stringify(_cn):''; })(),
    });
    checkouts = (await apiGet('getActiveCheckouts')).checkouts || [];
    // Create confirmation requests for named crew members
    const _crewNames = Array.from(document.querySelectorAll('#coCrewInputs input'))
      .map(i => ({ name: i.value.trim(), kennitala: i.dataset.kennitala||'', guest: !!i.dataset.guest }))
      .filter(c => c.name);
    if (_crewNames.length) {
      const _coId = res?.checkoutId || res?.id || '';
      for (const _cn of _crewNames.filter(c => c.kennitala && !c.guest)) {
        try { await apiPost('createConfirmation', {
          type: 'crew_assigned',
          fromKennitala: kt, fromName: member.name||kt,
          toKennitala: _cn.kennitala, toName: _cn.name,
          linkedCheckoutId: _coId,
          boatId: bid, boatName: boat.name||bid, boatCategory: boat.category||'',
          locationId: lid, locationName: location.name||lid,
          date: todayISO(),
          timeOut: document.getElementById('coTimeOut').value,
          timeIn: document.getElementById('coReturnBy').value,
          role: 'crew', wxSnapshot: snap,
        }); } catch(e2) { console.warn('crew confirmation failed for', _cn, e2.message); }
      }
    }
    toggleCheckoutForm();
    renderAll();
    showToast(s('staff.coForm.checkedOut'));
  } catch(e) { err.textContent=s('toast.error')+': '+e.message; err.style.display='block'; }
}

async function staffCheckIn(id) {
  try {
    const co = checkouts.find(c => c.id === id);
    const timeIn = new Date().toTimeString().slice(0, 5);
    await apiPost('checkIn', { id, timeIn });
    // Auto-create trip record for the skipper
    if (co && co.memberKennitala) {
      const timeOut = sstr(co.checkedOutAt || co.timeOut).slice(0, 5);
      let hoursDecimal = 0;
      if (timeOut && timeIn) {
        const [oh, om] = timeOut.split(':').map(Number);
        const [ih, im] = timeIn.split(':').map(Number);
        let mins = (ih * 60 + im) - (oh * 60 + om);
        if (mins < 0) mins += 1440;
        hoursDecimal = +(mins / 60).toFixed(2);
      }
      try {
        await apiPost('saveTrip', {
          kennitala: co.memberKennitala, memberName: co.memberName || '',
          date: todayISO(),
          timeOut, timeIn, hoursDecimal,
          boatId: co.boatId, boatName: co.boatName, boatCategory: co.boatCategory || '',
          locationId: co.locationId, locationName: co.locationName,
          crew: co.crew || 1, role: 'skipper',
          linkedCheckoutId: id, isLinked: true,
          departurePort: co.departurePort || '',
          wxSnapshot: co.wxSnapshot || '',
        });
      } catch(e2) { console.warn('Auto trip save failed:', e2.message); }
    }
    const localCo = checkouts.find(c => c.id === id);
    if (localCo) { localCo.status = 'in'; localCo.checkedInAt = timeIn; }
    renderAll();
    showToast(s('toast.checkedIn'));
  } catch(e) { ymAlert(s('toast.error') + ': ' + e.message); }
}

async function staffDeleteCheckout(id, boatName) {
  if (boatName == null) {
    const co = checkouts.find(c => c.id === id);
    boatName = co && co.boatName || '';
  }
  if (!await ymConfirm(`${s('staff.deleteCheckout')}: ${boatName||''}?`)) return;
  try {
    await apiPost('deleteCheckout', { id });
    checkouts = checkouts.filter(c => c.id !== id);
    renderAll();
    showToast(s('toast.deleted'));
  } catch(e) { ymAlert(s('toast.error')+': '+e.message); }
}

// ── Checkout detail modal ─────────────────────────────────────────────────────
function openCoDetail(id, event) {
  if (event) {
    const tgt = event.target;
    if (tgt.closest('button') || tgt.closest('a')) return;
  }
  const co = checkouts.find(c => c.id === id);
  if (!co) return;
  _detailId = id;
  document.getElementById('cdTitle').textContent    = esc(co.boatName || co.boatId);
  document.getElementById('cdBoat').textContent     = esc(co.boatName || co.boatId);
  document.getElementById('cdLocation').textContent = esc(co.locationName || '—');
  document.getElementById('cdOut').textContent      = sstr(co.checkedOutAt||co.timeOut).slice(0,5) || '—';
  document.getElementById('cdReturn').textContent   = co.expectedReturn || '—';
  document.getElementById('cdCrew').textContent     = co.crew || 1;
  const notesRow = document.getElementById('cdNotesRow');
  notesRow.style.display = co.notes ? '' : 'none';
  document.getElementById('cdNotes').textContent    = co.notes || '';
  document.getElementById('cdMember').textContent   = esc(co.memberName || co.memberKennitala);
  const phoneRow = document.getElementById('cdPhoneRow');
  phoneRow.style.display = co.memberPhone ? '' : 'none';
  document.getElementById('cdPhone').textContent    = co.memberPhone || '';
  const guardRow = document.getElementById('cdGuardianRow');
  guardRow.style.display = (co.memberIsMinor && co.guardianName) ? '' : 'none';
  document.getElementById('cdGuardian').textContent =
    co.guardianName ? co.guardianName + (co.guardianPhone ? ' · '+co.guardianPhone : '') : '';
  openModal('coDetailModal');
}

function closeCoDetail() { closeModal('coDetailModal'); }

// ── Keelboat departure port in checkout form ──────────────────────────────────
function onCoBoatChange() {
  const bid  = document.getElementById('coBoat').value;
  const boat = boats.find(b => b.id === bid);
  const isKeel = (boat?.category || '').toLowerCase() === 'keelboat';
  const portRow = document.getElementById('coPortRow');
  portRow.style.display = isKeel ? '' : 'none';
  if (isKeel) {
    // Populate datalist with ports
    const dl = document.getElementById('coPortsList');
    dl.innerHTML = locations.filter(l => l.type === 'port')
      .map(p => `<option value="${esc(p.name)}">`).join('');
    // Auto-fill with boat's default port if field is empty
    const portInput = document.getElementById('coDeparturePort');
    if (!portInput.value && boat?.defaultPortId) {
      const home = locations.find(l => l.id === boat.defaultPortId);
      if (home) portInput.value = home.name;
    }
  } else {
    document.getElementById('coDeparturePort').value = '';
  }
}

// ── Overdue alert banner ────────────────────────────────────────────────────
let _snoozeMins = 30;

async function resolveAlertAction(checkoutId, op, btnEl) {
  btnEl.disabled = true;
  try {
    await apiPost('resolveAlert', { checkoutId, op });
    // Remove the checkout card from the active list immediately
    if (op === 'checkInAndClose') {
      document.querySelectorAll('[data-checkout-id="' + checkoutId + '"]').forEach(el => el.remove());
    }
    // Immediately re-render — the checkout status will update on next refresh
    // For check-in, optimistically remove the alert card
    const card = btnEl.closest('.ob-alert');
    if (card) card.remove();
    // Update banner visibility
    const banner = document.getElementById('overdue-banner');
    if (banner && !banner.querySelector('.ob-alert')) banner.classList.remove('has-alerts');
    // Force a data refresh after a short delay
    setTimeout(() => load(), 1500);
  } catch(e) {
    btnEl.disabled = false;
    ymAlert(gs_('error') + ': ' + e.message);
  }
}

function renderOverdueBanner(alerts) {
  const banner = document.getElementById('overdue-banner');
  if (!banner) return;
  if (!alerts || alerts.length === 0) {
    banner.innerHTML = '';
    banner.classList.remove('has-alerts');
    return;
  }

  banner.innerHTML = alerts.map(a => {
    const hrs = Math.floor(a.minutesOverdue / 60);
    const min = a.minutesOverdue % 60;
    const overdueStr = hrs > 0
      ? s('staff.hrsMin',{h:hrs,m:min})
      : s('staff.minOnly',{m:min});
    const phoneStr = a.isMinor
      ? s('staff.guardianLabel') + ': ' + (a.guardianPhone || '—')
      : s('staff.phoneLabel') + ': ' + (a.memberPhone || '—');
    return `<div class="ob-alert">
      <div class="ob-icon">⚠️</div>
      <div class="ob-body">
        <div class="ob-title">${a.memberName} — ${a.boatName}${a.isMinor ? ' ⚠️' : ''}</div>
        <div class="ob-meta">
          ${s('staff.expectedBack')}: ${a.expectedReturn} &nbsp;·&nbsp;
          ${s('staff.overdueBy')}: <strong>${overdueStr}</strong> &nbsp;·&nbsp;
          ${a.locationName} &nbsp;·&nbsp; ${phoneStr}
        </div>
        <div class="ob-actions">
          <button class="ob-btn ob-btn-checkin"
            data-staff-alert-action="checkInAndClose" data-staff-arg="${a.checkoutId}">
            ✓ ${s('staff.checkInClose')}
          </button>
          <button class="ob-btn ob-btn-snooze"
            data-staff-alert-action="snooze" data-staff-arg="${a.checkoutId}">
            ⏱ ${s('staff.snoozeBtn',{n:_snoozeMins})}
          </button>
          <button class="ob-btn ob-btn-silence"
            data-staff-alert-action="silence" data-staff-arg="${a.checkoutId}">
            🔕 ${s('staff.silenceBtn')}
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
  banner.classList.add('has-alerts');
}

async function pollOverdueAlerts() {
  try {
    const result = await apiGet('getOverdueAlerts');
    _snoozeMins = result.snoozeMins || 30;
    renderOverdueBanner(result.alerts || []);
  } catch(e) { /* silent fail — don't disrupt the page */ }
}


// ── Select a boat directly from fleet status to begin checkout ───────────────
function selectBoatForCheckout(boatId) {
  // Show and scroll to checkout form
  const formEl = document.getElementById('coForm');
  if (formEl && formEl.style.display === 'none') {
    document.getElementById('checkOutBtn')?.click();
  }
  // Pre-select the boat
  const boatSel = document.getElementById('coBoat');
  if (boatSel) {
    boatSel.value = boatId;
    boatSel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Scroll into view
  setTimeout(() => {
    (formEl || document.getElementById('checkOutBtn'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 80);
}


// ── Boat action card (fleet status click) ─────────────────────────────────────
function openBoatActionCard(boat) {
  // Close any existing action card
  closeBoatActionCard();
  if (!boat) return;

  const oos = boolVal(boat.oos);
  const co  = checkouts.find(c => c.status === 'out' && c.boatId === boat.id);

  const overlay = document.createElement('div');
  overlay.id = 'boatActionOverlay';
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:9999';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeBoatActionCard(); });

  const emoji = boatEmoji((boat.category||'').toLowerCase());
  const name  = esc(boat.name || boat.id || '');

  // Build action buttons — checkout only if available (not OOS and not currently out)
  const canCheckout = !oos && !co;
  const checkoutBtn = canCheckout
    ? `<button class="btn btn-primary" style="width:100%;font-size:13px;padding:10px" data-staff-click="_staffBoatCheckout" data-staff-arg="${esc(boat.id)}">${s('fleet.actionCheckout')}</button>`
    : '';
  const maintBtn = `<button class="btn btn-secondary" style="width:100%;font-size:13px;padding:10px" data-staff-click="_staffBoatMaint" data-staff-arg="${esc(boat.id)}" data-staff-arg2="${esc(boat.name||'')}">${s('fleet.actionMaint')}</button>`;
  const toggleLabel = oos ? s('fleet.actionMarkAvail') : s('fleet.actionMarkOos');
  const toggleBtn = `<button class="btn btn-secondary" style="width:100%;font-size:13px;padding:10px" data-staff-click="_staffBoatToggle" data-staff-arg="${esc(boat.id)}">${toggleLabel}</button>`;

  overlay.innerHTML = `<div class="modal" style="max-width:320px;padding:20px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:15px;font-weight:600">${emoji} ${name}</div>
      <button style="background:none;border:none;cursor:pointer;font-size:20px;color:var(--muted);padding:0 2px;line-height:1" data-staff-click="closeBoatActionCard">&times;</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${checkoutBtn}
      ${maintBtn}
      ${toggleBtn}
    </div>
  </div>`;

  document.body.appendChild(overlay);
}

function closeBoatActionCard() {
  const el = document.getElementById('boatActionOverlay');
  if (el) el.remove();
}

function openBoatMaintRequest(boatId, boatName) {
  // Navigate to maintenance page with boat pre-selected
  window.location.href = '../maintenance/?prefillBoat=' + encodeURIComponent(boatId);
}

async function toggleBoatAvailability(boatId) {
  try {
    const cfgRes = await apiGet('getConfig');
    const allBoats = cfgRes.boats || [];
    const idx = allBoats.findIndex(b => b.id === boatId);
    if (idx < 0) { showToast(s('staff.boatNotFound'), 'err'); return; }
    const wasOos = boolVal(allBoats[idx].oos);
    allBoats[idx] = Object.assign({}, allBoats[idx], {
      oos: !wasOos,
      oosReason: wasOos ? '' : (allBoats[idx].oosReason || ''),
    });
    await apiPost('saveConfig', { boats: allBoats });
    boats = allBoats.filter(b => b.active !== false && b.active !== 'false');
    renderAll();
    showToast(wasOos ? s('fleet.actionMarkAvail') + ' ✓' : s('fleet.actionMarkOos') + ' ✓');
  } catch(e) {
    showToast(s('logbook.errGeneric',{msg:e.message}), 'err');
  }
}

// ══ GROUP CHECKOUT ═══════════════════════════════════════════════════════════
let _groupBoats = new Set();
let _groupParticipants = 0;

function openGroupModal() {
  document.getElementById('groupModalTitle').textContent = s('staff.groupCheckoutTitle');
  document.getElementById('gmBoatsLabel').textContent    = s('staff.selectBoats');
  document.getElementById('gmParticLabel').textContent   = s('staff.participants');
  document.getElementById('gmLocLabel').textContent      = s('lbl.location');
  document.getElementById('gmActivityLabel').textContent = s('staff.activityType');
  _groupBoats = new Set();
  _groupParticipants = 0;
  document.getElementById('gmParticCount').textContent = '0';
  document.getElementById('gmTotalNote').textContent = '';
  document.getElementById('gmErr').style.display = 'none';
  document.getElementById('gmTimeOut').value = fmtTimeNow();
  document.getElementById('gmReturnBy').value = '';
  const grid = document.getElementById('gmBoatGrid');
  const active = checkouts.filter(c => c.status === 'out');
  grid.innerHTML = '';
  boats.filter(b => b.active !== false && b.active !== 'false').forEach(b => {
    const out = active.find(c => c.boatId === b.id);
    const btn = document.createElement('button');
    btn.className = 'gm-boat-btn';
    btn.textContent = boatEmoji((b.category||'').toLowerCase()) + ' ' + (b.name || b.id);
    btn.dataset.id = b.id;
    if (boolVal(b.oos)) { btn.disabled = true; btn.style.opacity='.35'; btn.title = s('staff.oosTitle'); }
    else if (out) { btn.disabled = true; btn.style.opacity='.35'; btn.title = s('staff.alreadyOut'); }
    else btn.addEventListener('click', function() { toggleGmBoat(this); });
    grid.appendChild(btn);
  });
  const lSel = document.getElementById('gmLocation');
  lSel.innerHTML = '<option value="">—</option>';
  locations.filter(l => l.type !== 'port').forEach(l => { const o=document.createElement('option'); o.value=l.id; o.textContent=l.name; lSel.appendChild(o); });
  const foss = locations.filter(l => l.type !== 'port').find(l => l.name && l.name.toLowerCase().includes('fossvogur'));
  if (foss) lSel.value = foss.id;
  const aSel = document.getElementById('gmActivity');
  aSel.innerHTML = '<option value="">' + s('staff.noneOption') + '</option>';
  (window._activityTypes || []).forEach(t => {
    const o=document.createElement('option'); o.value=t.id;
    o.textContent = getLang()==='IS' ? (t.nameIS||t.name) : t.name;
    aSel.appendChild(o);
  });
  const sec = document.getElementById('gmStaffSection');
  sec.innerHTML = '';
  addGmStaffRow();
  openModal('groupModal');
  document.body.style.overflow = 'hidden';
}

function closeGroupModal() {
  closeModal('groupModal');
  document.body.style.overflow = '';
}

function toggleGmBoat(btn) {
  const id = btn.dataset.id;
  if (_groupBoats.has(id)) { _groupBoats.delete(id); btn.classList.remove('selected'); }
  else { _groupBoats.add(id); btn.classList.add('selected'); }
  updateGmTotalNote();
}

function adjGroupCount(type, d) {
  if (type === 'participants') {
    _groupParticipants = Math.max(0, _groupParticipants + d);
    document.getElementById('gmParticCount').textContent = _groupParticipants;
    updateGmTotalNote();
  }
}

function updateGmTotalNote() {
  const staffCount = document.querySelectorAll('#gmStaffSection input[type=text]').length;
  const total = _groupParticipants + staffCount;
  const n = document.getElementById('gmTotalNote');
  n.textContent = total > 0 ? s('staff.onWaterTotal',{n:total, b:_groupBoats.size, boatWord:_groupBoats.size!==1?s('staff.boats'):s('staff.boat')}) : '';
}

function addGmStaffRow() {
  const sec = document.getElementById('gmStaffSection');
  const idx = sec.children.length;
  const wrap = document.createElement('div');
  wrap.className = 'gm-staff-wrap';
  const inp = document.createElement('input');
  inp.className = 'gm-staff-input';
  inp.type = 'text';
  inp.placeholder = s('staff.searchStaff');
  inp.dataset.kennitala = '';
  const drop = document.createElement('div');
  drop.className = 'gm-drop';
  inp.addEventListener('input', function() { this.dataset.kennitala=''; this.style.borderColor=''; searchGmStaff(this, drop); });
  inp.addEventListener('blur',  function() { setTimeout(function(){ drop.style.display='none'; }, 200); });
  wrap.appendChild(inp); wrap.appendChild(drop);
  sec.appendChild(wrap);
  updateGmTotalNote();
}

function searchGmStaff(inp, drop) {
  const q = inp.value.trim().toLowerCase();
  if (!q || q.length < 2) { drop.style.display = 'none'; return; }
  const matches = (members || []).filter(m => m.name && m.name.toLowerCase().includes(q) && m.role !== 'guest').slice(0, 8);
  if (!matches.length) { drop.style.display = 'none'; return; }
  drop.innerHTML = '';
  matches.forEach(function(m) {
    const item = document.createElement('div');
    item.className = 'gm-drop-item';
    item.textContent = m.name;
    item.addEventListener('mouseover', function(){ this.style.background = 'var(--card)'; });
    item.addEventListener('mouseout',  function(){ this.style.background = ''; });
    item.addEventListener('mousedown', function(e) {
      e.preventDefault();
      inp.value = m.name;
      inp.dataset.kennitala = m.kennitala || '';
      inp.style.borderColor = 'var(--green)';
      drop.style.display = 'none';
      updateGmTotalNote();
    });
    drop.appendChild(item);
  });
  drop.style.display = 'block';
}

async function submitGroupCheckout() {
  const err = document.getElementById('gmErr');
  err.style.display = 'none';
  if (_groupBoats.size === 0) { err.textContent = s('staff.errSelectBoat'); err.style.display = ''; return; }
  const lid = document.getElementById('gmLocation').value;
  if (!lid) { err.textContent = s('staff.errSailingArea'); err.style.display = ''; return; }
  const tout  = document.getElementById('gmTimeOut').value || fmtTimeNow();
  const retBy = document.getElementById('gmReturnBy').value;
  const actId = document.getElementById('gmActivity').value;
  const actName = document.getElementById('gmActivity').selectedOptions[0]?.text || '';
  const loc = locations.find(l => l.id === lid) || {};
  const snap = (typeof wxSnapshot === 'function') ? wxSnapshot(wxData) : null;
  const staffEntries = Array.from(document.querySelectorAll('#gmStaffSection input'))
    .map(i => ({ name: i.value.trim(), kennitala: i.dataset.kennitala || '' })).filter(s => s.name);
  if (!staffEntries.length) { err.textContent = s('staff.errStaffRequired'); err.style.display = ''; return; }
  // Warn if any staff entry was typed but not selected from DB
  const unmatched = staffEntries.filter(s => !s.kennitala);
  if (unmatched.length && members.length > 0) { err.textContent = s('staff.errStaffFromList',{names:unmatched.map(x=>x.name).join(', ')}); err.style.display = ''; return; }
  const boatIds   = Array.from(_groupBoats);
  const boatNames = boatIds.map(id => (boats.find(b => b.id === id) || {}).name || id);
  const totalAboard = _groupParticipants + staffEntries.length;
  try {
    await apiPost('saveGroupCheckout', {
      boatIds, boatNames,
      locationId: lid, locationName: loc.name || lid,
      checkedOutAt: tout, expectedReturn: retBy,
      participants: _groupParticipants,
      staffNames: staffEntries.map(s => s.name),
      staffKennitalar: staffEntries.map(s => s.kennitala).filter(Boolean),
      crew: totalAboard,
      activityTypeId: actId, activityTypeName: actName,
      wxSnapshot: snap,
    });
    const _gcRes = await apiGet('getActiveCheckouts');
    checkouts = _gcRes.checkouts || [];
    const _newGrpId = (_gcRes.checkouts||[]).slice().reverse().find(function(c){ return c.isGroup===true||c.isGroup==='true'; })?.id || null;
    closeGroupModal();
    renderAll();
    showToast(s('staff.groupLaunched'));
    if (_newGrpId) setTimeout(function(){ openDlLinkModal(_newGrpId); }, 600);
  } catch(e) { err.textContent = e.message; err.style.display = ''; }
}

async function staffGroupCheckIn(id) {
  try {
    const timeIn = new Date().toTimeString().slice(0, 5);
    await apiPost('groupCheckIn', { id, timeIn });
    checkouts = (await apiGet('getActiveCheckouts')).checkouts || [];
    renderAll();
    showToast(s('toast.checkedIn'));
  } catch(e) { ymAlert(s('toast.error') + ': ' + e.message); }
}

function renderGroupCard(c) {
  const now = new Date().toTimeString().slice(0, 5);
  const retBy = c.expectedReturn || c.returnBy || '';
  const overdue = retBy && retBy < now;
  let boatArr;
  try { boatArr = c.boatNames ? (typeof c.boatNames==='string'?JSON.parse(c.boatNames):c.boatNames) : [c.boatName||'—']; } catch(e){ boatArr=[c.boatName||'—']; }
  let staffArr;
  try { staffArr = c.staffNames ? (typeof c.staffNames==='string'?JSON.parse(c.staffNames):c.staffNames) : []; } catch(e){ staffArr=[]; }
  const firstStaff = staffArr[0] || '';
  const partic     = parseInt(c.participants) || 0;
  const total      = partic + staffArr.length;
  const boatCount  = boatArr.length;
  const tout       = sstr(c.checkedOutAt || c.timeOut).slice(0, 5);
  const actName    = c.activityTypeName || '';

  // Left column pills: activity → first staff → boats → total
  const actBadge   = actName   ? '<span class="gc-badge">'  + esc(actName)   + '</span>' : '';
  const staffBadge = firstStaff? '<span style="font-size:12px;font-weight:500;color:var(--text)">' + esc(firstStaff) + '</span>' : '';
  const boatsBadge = '<span style="font-size:11px;color:var(--muted)">' + boatCount + ' ' + (boatCount!==1?s('staff.boats'):s('staff.boat')) + '</span>';
  const peopleBadge = '<span style="font-size:11px;color:var(--muted)">' + total + ' ' + s('staff.peopleOnWater') + '</span>';

  // Right: return time
  const retHtml = retBy
    ? '<div style="font-size:16px;font-weight:500;color:' + (overdue?'var(--red)':' var(--text)') + '">\u21a9 ' + esc(retBy) + '</div>'
    + (overdue ? '<div style="font-size:9px;letter-spacing:.5px;color:var(--red);text-align:right">OVERDUE</div>' : '')
    : '';

  const div = document.createElement('div');
  div.className = 'bc-group-card' + (overdue ? ' overdue' : '');
  div.dataset.checkoutId = c.id;
  div.innerHTML =
    '<div class="gc-header">'
    + '<div style="display:flex;flex-direction:column;gap:4px">'
    + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    +   actBadge
    +   staffBadge
    + '</div>'
    + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    +   boatsBadge + peopleBadge
    + '</div>'
    + '</div>'
    + '<div class="gc-ret">' + retHtml + '</div>'
    + '</div>'
    + '<div class="gc-meta">' + esc(c.locationName||'—') + ' \u00b7 Out ' + esc(tout) + '</div>'
    + '<div style="display:flex;gap:6px;margin-top:10px">'
    + '<button class="btn btn-primary" style="font-size:11px;flex:1" data-staff-click="staffGroupCheckIn" data-staff-arg="' + esc(c.id) + '">\u2693 ' + s('staff.checkInAll') + '</button>'
    + '<button class="btn btn-secondary" style="font-size:11px;padding:6px 12px;color:var(--muted)" data-staff-click="staffDeleteCheckout" data-staff-arg="' + esc(c.id) + '">\u2715</button>'
    + '</div>';
  return div;
}


// ── Daily log link after group checkout ──────────────────────────────────────
let _dlLinkCheckoutId  = null;
let _dlLinkSelectedAct = null;
let _dlLinkTodayActs   = [];

async function openDlLinkModal(checkoutId) {
  _dlLinkCheckoutId  = checkoutId;
  _dlLinkSelectedAct = null;
  // Fetch today's daily log activities
  try {
    const today = todayISO();
    const res   = await apiGet('getDailyLog', { date: today });
    const log   = res.log || {};
    _dlLinkTodayActs = (typeof log.activities === 'string' ? JSON.parse(log.activities||'[]') : (log.activities||[]));
  } catch(e) { _dlLinkTodayActs = []; }

  const list = document.getElementById('dlLinkActList');
  if (!_dlLinkTodayActs.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">' + s('staff.noActivities') + '</div>';
    document.getElementById('dlLinkConfirmBtn').style.display = 'none';
  } else {
    document.getElementById('dlLinkConfirmBtn').style.display = '';
    list.innerHTML = _dlLinkTodayActs.map(function(act) {
      const meta = [act.type, act.start && act.end ? act.start+'\u2013'+act.end : act.start].filter(Boolean).join(' \u00b7 ');
      return '<div class="dl-act-card" data-actid="' + esc(act.id) + '" data-staff-click="selectDlAct" data-staff-arg="' + act.id + '">' +
        '<div class="dl-act-name">' + esc(act.name) + '</div>' +
        '<div class="dl-act-meta">' + esc(meta) + '</div>' +
        '</div>';
    }).join('');
  }
  openModal('dlLinkModal');
}

function selectDlAct(actId) {
  _dlLinkSelectedAct = actId;
  document.querySelectorAll('.dl-act-card').forEach(function(c) {
    c.classList.toggle('selected', c.dataset.actid === actId);
  });
}

async function confirmDlLink() {
  if (!_dlLinkSelectedAct || !_dlLinkCheckoutId) { closeDlLinkModal(); return; }
  try {
    await apiPost('linkGroupCheckoutToActivity', {
      checkoutId:  _dlLinkCheckoutId,
      activityId:  _dlLinkSelectedAct,
    });
    showToast(s('staff.linkedDailyLog'));
  } catch(e) {
    showToast('Link saved locally — sync when online', 'warn');
  }
  closeDlLinkModal();
}

function closeDlLinkModal() {
  closeModal('dlLinkModal');
  _dlLinkCheckoutId  = null;
  _dlLinkSelectedAct = null;
}

function openDailyLogForNew() {
  // Navigate to daily log; pass checkout id so it can pre-link
  closeDlLinkModal();
  window.location.href = '../dailylog/?linkCheckout=' + encodeURIComponent(_dlLinkCheckoutId || '');
}


// ══ STAFF STATUS ═══════════════════════════════════════════════════════════════════════════
function renderStaffStatusStrip() {
  const btnDuty = document.getElementById('btnStaffOnDuty');
  const btnBoat = document.getElementById('btnSupportBoat');
  const upd     = document.getElementById('staffStatusUpdated');
  if (!btnDuty || !btnBoat) return;
  const base = 'display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;border:none;font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer;font-family:inherit;transition:opacity .15s;';
  const on   = 'background:var(--blue);color:#fff;';
  const off  = 'background:var(--orange);color:#fff;';
  btnDuty.setAttribute('style', base + (_staffStatus.onDuty      ? on : off));
  btnBoat.setAttribute('style', base + (_staffStatus.supportBoat ? on : off));
  btnDuty.innerHTML = DUTY_ICONS[_staffStatus.onDuty ? 'lifebuoy' : 'lifebuoyOff'] + (_staffStatus.onDuty ? s('staff.staffOnDuty') : s('staff.noStaffOnDuty'));
  btnBoat.innerHTML = DUTY_ICONS[_staffStatus.supportBoat ? 'ship' : 'shipOff'] + (_staffStatus.supportBoat ? s('staff.supportBoat') : s('staff.noSupportBoat'));
  if (upd && _staffStatus.updatedAt) upd.textContent = s('staff.updatedShort') + ' ' + _staffStatus.updatedAt.slice(11,16) + ' UTC';
}
async function toggleStaffStatus(field) {
  _staffStatus[field] = !_staffStatus[field];
  _staffStatus.updatedAt = new Date().toISOString();
  _staffStatus.updatedByName = (typeof user !== 'undefined' && user) ? (user.name || '') : '';
  renderStaffStatusStrip();
  document.getElementById('wxWidget')?._wxRefreshBadges?.();
  try { await apiPost('saveConfig', { staffStatus: _staffStatus }); }
  catch(e) { showToast('Status saved — sync when online', 'warn'); }
}

// ══ WEATHER FLAG OVERRIDE ═══════════════════════════════════════════════════
let _flagOverride = null;  // { active, flagKey, notes, notesIS, setAt, setByName, expiresAt } or null
let _foDraftFlag = 'yellow';

function renderFlagOverrideCard() {
  const activeRow   = document.getElementById('foActiveRow');
  const inactiveRow = document.getElementById('foInactiveRow');
  const form        = document.getElementById('foForm');
  const ov = _flagOverride;
  if (ov && ov.active) {
    activeRow.classList.remove('hidden');
    activeRow.style.display = 'flex';
    inactiveRow.style.display = 'none';
    form.classList.add('hidden');
    const flag = (typeof SCORE_CONFIG !== 'undefined' && SCORE_CONFIG.flags[ov.flagKey]) || { icon:'⚑', color:'var(--text)', border:'var(--border)', bg:'var(--surface)', advice:ov.flagKey };
    const IS  = (typeof getLang === 'function' && getLang() === 'IS');
    const badge = document.getElementById('foActiveBadge');
    badge.style.color = flag.color;
    badge.style.borderColor = flag.border;
    badge.style.background = flag.bg;
    badge.textContent = flag.icon + ' ' + ((IS && flag.adviceIS) ? flag.adviceIS : flag.advice || '');
    const note = (IS && ov.notesIS) ? ov.notesIS : (ov.notes || ov.notesIS || '');
    document.getElementById('foActiveNotes').textContent = note;
    const setBy  = ov.setByName ? s('staff.flagOverrideBy', { name: ov.setByName }) : '';
    const setT   = ov.setAt ? String(ov.setAt).slice(11,16) + ' UTC' : '';
    document.getElementById('foActiveMeta').textContent = [setBy, setT].filter(Boolean).join(' · ');
  } else {
    activeRow.classList.add('hidden');
    activeRow.style.display = 'none';
    inactiveRow.style.display = 'flex';
  }
}

function renderFoFlagBtns() {
  const container = document.getElementById('foFlagBtns');
  if (!container || typeof SCORE_CONFIG === 'undefined') return;
  const IS = (typeof getLang === 'function' && getLang() === 'IS');
  container.innerHTML = ['green','yellow','orange','red','black'].map(k => {
    const f = SCORE_CONFIG.flags[k]; if (!f) return '';
    const selected = k === _foDraftFlag;
    const advice = (IS && f.adviceIS) ? f.adviceIS : (f.advice || k);
    return `<button type="button" data-staff-click="pickFoFlag" data-staff-arg="${k}" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:4px 10px;border-radius:20px;border:1px solid ${f.border};background:${selected ? f.bg : 'transparent'};color:${f.color};cursor:pointer;font-family:inherit;${selected ? 'outline:2px solid '+f.border : ''}">${f.icon} ${advice}</button>`;
  }).join('');
}

function pickFoFlag(key) { _foDraftFlag = key; renderFoFlagBtns(); }

function toggleFlagOverrideForm(show) {
  const form = document.getElementById('foForm');
  if (show) {
    _foDraftFlag = (_flagOverride?.flagKey) || 'yellow';
    document.getElementById('foNotes').value   = _flagOverride?.notes   || '';
    document.getElementById('foNotesIS').value = _flagOverride?.notesIS || '';
    form.classList.remove('hidden');
    renderFoFlagBtns();
  } else {
    form.classList.add('hidden');
  }
}

async function saveFlagOverride() {
  const notes   = document.getElementById('foNotes').value.trim();
  const notesIS = document.getElementById('foNotesIS').value.trim();
  const ov = {
    active: true,
    flagKey: _foDraftFlag,
    notes, notesIS,
    setAt: new Date().toISOString(),
    setByName: (typeof user !== 'undefined' && user) ? (user.name || '') : '',
    expiresAt: new Date(wxNextMidnightUTC()).toISOString(),
  };
  _flagOverride = ov;
  wxLoadFlagOverride(ov);
  renderFlagOverrideCard();
  document.getElementById('wxWidget')?._wxRefresh?.();
  try { await apiPost('saveConfig', { flagOverride: ov }); }
  catch(e) { showToast(s('staff.flagOverrideSaveFail'), 'warn'); }
}

async function clearFlagOverride() {
  _flagOverride = null;
  wxLoadFlagOverride(null);
  renderFlagOverrideCard();
  document.getElementById('wxWidget')?._wxRefresh?.();
  try { await apiPost('saveConfig', { flagOverride: null }); }
  catch(e) { showToast(s('staff.flagOverrideSaveFail'), 'warn'); }
}

// ══ GUEST SUPPORT ═══════════════════════════════════════════════════════════
// Guest prompt — delegates to shared openGuestPrompt(). Keep old signature
// openGuestModal(name, callback) so existing call sites don't need changes.
function openGuestModal(name, callback) {
  openGuestPrompt({
    name:       name,
    targetList: members,
    onConfirm:  callback,
  });
}


// ─── Named wrappers for compound inline handlers ─────────────────────────────
function _staffBoatCheckout(id) { closeBoatActionCard(); selectBoatForCheckout(id); }
function _staffBoatMaint(id, name) { closeBoatActionCard(); openBoatMaintRequest(id, name); }
function _staffBoatToggle(id) { closeBoatActionCard(); toggleBoatAvailability(id); }
function doDetailCheckIn() { staffCheckIn(_detailId); closeCoDetail(); }
function doDetailDelete() {
  // staffDeleteCheckout is now 1-arg tolerant (looks up boatName when undefined)
  staffDeleteCheckout(_detailId);
  closeCoDetail();
}

// ─── Delegated handlers for data-staff-* attrs ───────────────────────────────
// (replaces all inline onclick/onchange/oninput handlers in this page)
(function () {
  if (typeof document === 'undefined' || document._staffListeners) return;
  document._staffListeners = true;

  function argsFrom(el) {
    var a = [];
    if ('staffArg'  in el.dataset) a.push(el.dataset.staffArg);
    if ('staffArg2' in el.dataset) a.push(el.dataset.staffArg2);
    return a;
  }

  document.addEventListener('click', function (e) {
    // Modal click-outside-to-close
    var closeSelf = e.target.closest('[data-staff-close-self]');
    if (closeSelf && e.target === closeSelf) {
      var which = closeSelf.dataset.staffCloseSelf;
      if (which === 'coDetail')   closeCoDetail();
      if (which === 'groupModal') closeGroupModal();
      return;
    }

    // Checkout card root → open detail (skip if the click landed on an
    // inner button, which shared/boats.js already captured)
    var card = e.target.closest('[data-staff-card="co-detail"]');
    if (card && !e.target.closest('[data-boat-action]')) {
      openCoDetail(card.dataset.checkoutId, e);
      return;
    }

    // Alert resolve buttons (success/snooze/silence)
    var alertBtn = e.target.closest('[data-staff-alert-action]');
    if (alertBtn) {
      resolveAlertAction(alertBtn.dataset.staffArg,
                         alertBtn.dataset.staffAlertAction,
                         alertBtn);
      return;
    }

    // Generic click dispatcher
    var clk = e.target.closest('[data-staff-click]');
    if (clk) {
      var fn = clk.dataset.staffClick;
      if (typeof window[fn] === 'function') {
        // Boolean args come in as strings; normalise 'true'/'false'
        var a = argsFrom(clk).map(function (v) {
          if (v === 'true')  return true;
          if (v === 'false') return false;
          return v;
        });
        window[fn].apply(null, a);
      }
    }
  });

  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-staff-change]');
    if (el && typeof window[el.dataset.staffChange] === 'function') {
      window[el.dataset.staffChange]();
    }
  });

  document.addEventListener('input', function (e) {
    // HH:MM time-input auto-formatter
    var fmt = e.target.closest('[data-staff-time-format]');
    if (fmt) {
      var v = fmt.value.replace(/[^0-9]/g, '');
      if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2);
      fmt.value = v;
      return;
    }
    // Generic input dispatcher (value passed through)
    var el = e.target.closest('[data-staff-input]');
    if (el && typeof window[el.dataset.staffInput] === 'function') {
      window[el.dataset.staffInput](e.target.value);
    }
  });
})();
