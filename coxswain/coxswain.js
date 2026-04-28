// ══ AUTH (runs immediately — api.js is non-deferred) ═════════════════════════
const user = requireAuth();
if (!user || !hasRowingEndorsement(user)) { window.location.href = '../member/'; throw new Error('No rowing endorsement'); }
const _isReleasedRower = isReleasedRower(user);
const _rowingSub = (typeof getRowingSub === 'function') ? getRowingSub(user) : (_isReleasedRower ? 'released' : 'restricted');
const _isStaffSigner = ['staff','admin','manager'].indexOf(String(user.role || '').toLowerCase()) >= 0;

// ══ Wait for deferred scripts (boats.js, certs.js, maintenance.js) ══════════
document.addEventListener('DOMContentLoaded', function() {

// ══ STATE ════════════════════════════════════════════════════════════════════
var _boats = [], _locations = [], _members = [], _allMaint = [], _allTrips = [];
var _membersLoaded = false, _membersLoadingPromise = null;
var _passportDef = null, _passportProgress = null;
var _passportLang = (localStorage.getItem('ymirLang') || 'IS').toUpperCase();
// Sort mode: 'cat-mod' = Category → Module, 'mod-cat' = Module → Category
var _passportSortMode = localStorage.getItem('ymirPassportSort') || 'cat-mod';
var _passportSignerMode = false;
var _passportTargetMemberId = user.id; // own passport by default

// ══ TAB SWITCHING ════════════════════════════════════════════════════════════
function showCxTab(tab) {
  document.querySelectorAll('#cxTabBar .cx-tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  var crewsEl = document.getElementById('cxTab-crews');
  var passportEl = document.getElementById('cxTab-passport');
  if (crewsEl) crewsEl.classList.toggle('hidden', tab !== 'crews');
  if (passportEl) passportEl.classList.toggle('hidden', tab !== 'passport');
}
window.showCxTab = showCxTab;

// ══ INIT ═════════════════════════════════════════════════════════════════════
(async function init() {
  applyTheme();
  buildHeader('coxswain');
  document.getElementById('cxTitle').textContent = s('cox.title');
  document.getElementById('cxSubtitle').textContent = user.name;

  // Show read-only banner for non-released rowers
  if (!_isReleasedRower) {
    document.getElementById('cxReadOnly').classList.remove('hidden');
  }

  // Restricted rowers: only passport is available. Hide stats and tab bar,
  // and show only the passport tab content.
  if (_rowingSub === 'restricted') {
    var cxStatsEl = document.getElementById('cxStats');
    if (cxStatsEl) cxStatsEl.style.display = 'none';
    document.getElementById('cxTabBar').style.display = 'none';
    showCxTab('passport');
  } else {
    // Released rowers (and staff/admin): default to the crews/slots tab.
    showCxTab('crews');
  }
  // Show member picker for users who can sign for others
  if (_isStaffSigner || _rowingSub === 'released' || _rowingSub === 'coxswain') {
    document.getElementById('passportPicker').classList.remove('hidden');
    ensureMembersLoaded();
  }

  try {
    const [cfgRes, maintRes, tripsRes, boardRes, invRes, passportRes] = await Promise.all([
      apiGet('getConfig'),
      apiGet('getMaintenance'),
      apiGet('getTrips', { limit: 200 }),
      apiGet('getCrewBoard', {}),
      apiGet('getCrewInvites', { kennitala: user.kennitala }),
      apiGet('getRowingPassport', { memberId: user.id }),
    ]);
    _passportDef = passportRes.definition;
    _passportProgress = passportRes.progress;
    renderPassport();

    _boats     = (cfgRes.boats     || []);
    _locations = (cfgRes.locations || []).filter(l => l.active !== false && l.active !== 'false');
    _allMaint  = maintRes.requests || maintRes.items || maintRes.maintenance || [];
    _allBoardCrews = boardRes.crews || [];
    _crewInvites = invRes.invites || [];
    _myCrews = _allBoardCrews.filter(function(c) { return _isMyMember(c); });

    if (cfgRes.boatCategories) registerBoatCats(cfgRes.boatCategories);
    // Register cert defs so normalizeAccessGate can resolve legacy bare-string
    // gate values (e.g. 'released_rower') to their {certId, sub} object shape.
    if (cfgRes.certDefs && typeof registerCertDefsForBoats === 'function') {
      registerCertDefsForBoats(cfgRes.certDefs);
    }

    // Filter trips to rowing-division-gated boats
    var cxBoatIds = new Set(_boats.filter(_isRowingGatedBoat).map(function(b) { return b.id; }));
    _allTrips = (tripsRes.trips || []).filter(t => cxBoatIds.has(t.boatId));

    renderStats();
    renderMaint();
    renderCrewBoard();
    renderCrewInvites();
    initCxSlots();

    applyStrings();
    warmContainer();
  } catch (e) {
    showToast(e.message, 'err');
  }
})();

// Lazy-load members on first modal open (not needed for initial render).
// Tracks an in-flight promise so concurrent callers wait for the same load
// instead of silently racing against an empty _members array.
function ensureMembersLoaded() {
  if (_membersLoaded) return Promise.resolve();
  if (_membersLoadingPromise) return _membersLoadingPromise;
  _membersLoadingPromise = (async function() {
    try {
      var membersRes = await apiGet('getMembers');
      _members = (membersRes.members || []).filter(function(m) { return m.active !== false && m.active !== 'false'; });
      _membersLoaded = true;
    } catch(e) {
      _members = [];
    } finally {
      _membersLoadingPromise = null;
    }
  })();
  return _membersLoadingPromise;
}

// ══ STATS ════════════════════════════════════════════════════════════════════
function renderStats() {
  var now = new Date();
  var yearStart = now.getFullYear() + '-01-01';
  var myTrips = _allTrips.filter(t => String(t.kennitala) === String(user.kennitala) && t.date >= yearStart);
  var totalHrs = 0;
  myTrips.forEach(t => { totalHrs += parseFloat(t.hoursDecimal || 0); });
  document.getElementById('statTrips').textContent = myTrips.length;
  document.getElementById('statHours').textContent = totalHrs.toFixed(1);
  document.getElementById('statDist').textContent = '—';
}

// ══ ROWING-GATE PREDICATE ════════════════════════════════════════════════════
// True if the boat's access gate references the rowing division. Uses
// normalizeAccessGate() to handle both new {accessGate:{certId,sub,minRank}}
// shapes and legacy bare-string accessGateCert values. Also accepts the known
// legacy subcat strings so pre-migration clubs that don't use the
// 'rowing_division' canonical certId still get the right filter.
function _isRowingGatedBoat(b) {
  if (!b) return false;
  var gate = (typeof normalizeAccessGate === 'function') ? normalizeAccessGate(b) : null;
  if (gate && gate.certId === 'rowing_division') return true;
  var raw = b.accessGateCert;
  return raw === 'released_rower' || raw === 'released'
      || raw === 'restricted_rower' || raw === 'restricted'
      || raw === 'coxswain' || raw === 'rowing_division';
}

// ══ MAINTENANCE ══════════════════════════════════════════════════════════════
var _rowingBoatIdSet = null;
function renderMaint() {
  var el = document.getElementById('maintList');
  if (!_rowingBoatIdSet) {
    _rowingBoatIdSet = new Set(_boats.filter(_isRowingGatedBoat).map(function(b) { return b.id; }));
  }
  var items = _allMaint.filter(m => _rowingBoatIdSet.has(m.boatId) && m.status !== 'resolved');
  if (!items.length) {
    el.innerHTML = '<div class="empty-note">' + s('cox.noMaint') + '</div>';
    return;
  }
  el.innerHTML = items.map(m => {
    var sevClass = 'sev-' + (m.severity || 'low');
    return '<div class="cx-card">'
      + '<div style="font-size:12px;font-weight:500;color:var(--text)"><span class="sev-dot ' + sevClass + '"></span>' + esc(m.boatName || '') + '</div>'
      + '<div style="font-size:11px;color:var(--muted);margin-top:3px">' + esc(m.description || m.title || '') + '</div>'
      + '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + esc(m.reportedBy || '') + ' · ' + fmtDate(m.createdAt) + '</div>'
      + '</div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREW MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

var _myCrews = [];
var _allBoardCrews = [];
var _crewInvites = [];
var _invCrewId = null;

function _isMyMember(crew) {
  var kt = String(user.kennitala);
  return (crew.pairs || []).some(function(p) {
    return (p.members || []).some(function(m) { return m && String(m.kennitala) === kt; });
  });
}

function _crewOpenSeats(crew) {
  var count = 0;
  (crew.pairs || []).forEach(function(p) {
    (p.members || []).forEach(function(m) { if (m === null) count++; });
  });
  return count;
}

async function loadCrews() {
  try {
    var [boardRes, invRes] = await Promise.all([
      apiGet('getCrewBoard', {}),
      apiGet('getCrewInvites', { kennitala: user.kennitala }),
    ]);
    _allBoardCrews = boardRes.crews || [];
    _crewInvites = invRes.invites || [];
    // _myCrews = crews where I'm a member (used by slot booking)
    _myCrews = _allBoardCrews.filter(function(c) { return _isMyMember(c); });
  } catch(e) { _allBoardCrews = []; _myCrews = []; _crewInvites = []; }
  renderCrewBoard();
  renderCrewInvites();
}

function renderCrewBoard() {
  var el = document.getElementById('crewBoardList');
  var sorted = _allBoardCrews.slice().sort(function(a, b) {
    var aMe = _isMyMember(a) ? 0 : 1;
    var bMe = _isMyMember(b) ? 0 : 1;
    if (aMe !== bMe) return aMe - bMe;
    if (a.status !== b.status) return a.status === 'forming' ? -1 : 1;
    return 0;
  });
  if (!sorted.length) {
    el.innerHTML = '<div class="empty-note">' + s('cox.crewBoardEmpty') + '</div>';
    return;
  }
  el.innerHTML = '<div class="cb-grid">' + sorted.map(function(c) { return renderCrewCard(c); }).join('') + '</div>';
}

function renderCrewCard(c) {
  var pairs = c.pairs || [];
  var isMine = _isMyMember(c);
  var openSeats = _crewOpenSeats(c);
  var totalSeats = pairs.length * 2;
  var filledSeats = totalSeats - openSeats;
  var isOpen = (c.visibility || 'open') !== 'invite_only';
  var crewColor = c.color || 'var(--border)';

  var badge = c.status === 'active'
    ? '<span class="cb-badge cb-badge--active">' + s('cox.active') + '</span>'
    : '<span class="cb-badge cb-badge--forming">' + s('cox.forming') + '</span>';

  var boatsHtml = '<div class="cb-boats">';
  pairs.forEach(function(p, pi) {
    var members = p.members || [null, null];
    while (members.length < 2) members.push(null);
    boatsHtml += '<div class="cb-boat">';
    boatsHtml += '<div class="cb-boat-label">' + s('cox.boat') + ' ' + (pi + 1) + '</div>';
    boatsHtml += renderSeat(c, p.pairId, 0, members[0], isOpen, isMine);
    boatsHtml += renderSeat(c, p.pairId, 1, members[1], isOpen, isMine);
    boatsHtml += '</div>';
  });
  boatsHtml += '</div>';

  var needsHtml = '';
  if (openSeats > 0) {
    needsHtml = '<div class="cb-needs">' + s('cox.needsMore', { n: openSeats }) + '</div>';
  }

  var actionsHtml = '';
  if (isMine) {
    actionsHtml = '<div class="cb-actions">';
    if (c.status === 'forming' && (c.visibility || 'open') === 'invite_only') {
      actionsHtml += '<button class="btn btn-secondary btn-sm" data-cx-click="openCrewInvModal" data-cx-arg="'+esc(c.id)+'">' + s('cox.inviteMember') + '</button>';
    }
    actionsHtml += '<button class="btn btn-secondary btn-sm" data-cx-click="leaveCrewConfirm" data-cx-arg="'+esc(c.id)+'">' + s('cox.leave') + '</button>';
    actionsHtml += '<button class="btn btn-secondary btn-sm" data-cx-click="disbandCrewConfirm" data-cx-arg="'+esc(c.id)+'">' + s('cox.disband') + '</button>';
    actionsHtml += '</div>';
  }

  var descHtml = c.description ? '<div class="cb-desc">' + esc(c.description) + '</div>' : '';

  return '<div class="cb-card" style="border-color:' + esc(crewColor) + '">'
    + '<div class="cb-header">'
      + '<span class="cb-name">' + esc(c.name) + '</span> ' + badge
      + ' <span class="cb-count">' + filledSeats + '/' + totalSeats + '</span>'
    + '</div>'
    + descHtml + boatsHtml + needsHtml + actionsHtml
  + '</div>';
}

function renderSeat(crew, pairId, seatIdx, member, isOpen, isMine) {
  var kt = String(user.kennitala);
  var isYou = member && String(member.kennitala) === kt;
  var roleLabel = '<span class="cb-seat-role">' + (seatIdx === 0 ? s('cox.bow') : s('cox.stern')) + '</span>';
  if (member) {
    var full = esc(memberDisplayName(member, _members));
    var ini  = esc(memberInitials(member, _members)) || full;
    var cls  = isYou ? 'cb-seat cb-seat--you' : 'cb-seat cb-seat--filled';
    return '<div class="' + cls + '" title="' + full + '" data-full="' + full + '" data-ini="' + ini + '" data-cx-click-el="toggleSeatName">'
      + roleLabel + '<span class="cb-seat-name">' + ini + '</span></div>';
  }
  if (isOpen && _isReleasedRower && !isMine) {
    return '<div class="cb-seat cb-seat--open" data-cx-click="joinSeat" data-cx-arg="'+esc(crew.id)+'" data-cx-arg2="'+esc(pairId)+'" data-cx-arg3="'+seatIdx+'">'
      + roleLabel + '<span class="cb-seat-name">' + s('cox.join') + '</span></div>';
  }
  return '<div class="cb-seat cb-seat--open" style="cursor:default">' + roleLabel + '<span class="cb-seat-name">—</span></div>';
}

// Toggle a filled seat between initials and full name. Uses data- attributes
// populated by renderSeat so we don't need to re-derive the values here.
function toggleSeatName(el) {
  var nameEl = el.querySelector('.cb-seat-name');
  if (!nameEl) return;
  var expanded = el.classList.toggle('cb-seat--expanded');
  nameEl.textContent = expanded ? (el.dataset.full || '') : (el.dataset.ini || '');
}

function renderCrewInvites() {
  var el = document.getElementById('crewInviteList');
  if (!_crewInvites.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="font-size:9px;color:var(--muted);letter-spacing:1px;margin-bottom:6px">' + s('cox.pendingInvites') + '</div>'
    + _crewInvites.map(function(inv) {
      return '<div class="cx-card" style="border-left:3px solid var(--accent)">'
        + '<div style="font-size:12px;font-weight:500">' + esc(inv.crewName || '') + '</div>'
        + '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + s('cox.invitedBy') + ': ' + esc(inv.fromName) + ' · ' + s('cox.boat') + ' ' + esc(inv.pairId || '').replace('pair_', '') + '</div>'
        + '<div style="display:flex;gap:6px;margin-top:8px">'
          + '<button class="btn btn-primary btn-sm" data-cx-click="respondInvite" data-cx-arg="'+esc(inv.id)+'" data-cx-arg2="accepted">' + s('cox.accept') + '</button>'
          + '<button class="btn btn-secondary btn-sm" data-cx-click="respondInvite" data-cx-arg="'+esc(inv.id)+'" data-cx-arg2="rejected">' + s('cox.reject') + '</button>'
        + '</div>'
      + '</div>';
    }).join('');
}

function openCrewModal() {
  document.getElementById('cmCrewName').value = '';
  document.getElementById('cmDescription').value = '';
  document.getElementById('cmNumPairs').value = '2';
  document.getElementById('cmVisibility').value = 'open';
  document.getElementById('cmMySeat').value = '0';
  var pairSel = document.getElementById('cmMyPair');
  pairSel.innerHTML = '<option value="0">' + s('cox.boat') + ' 1</option><option value="1">' + s('cox.boat') + ' 2</option>';
  document.getElementById('cmNumPairs').onchange = function() {
    var n = parseInt(this.value);
    pairSel.innerHTML = '';
    for (var i = 0; i < n; i++) pairSel.innerHTML += '<option value="' + i + '">' + s('cox.boat') + ' ' + (i + 1) + '</option>';
  };
  // Auto-rotate default colour through the shared palette, then render swatches
  var palette = window.YMIR_PALETTE || [];
  var autoIdx = _allBoardCrews.filter(function(c) { return c.status !== 'disbanded'; }).length % palette.length;
  document.getElementById('cmColor').value = palette[autoIdx] || '#e74c3c';
  renderColorSwatches('cmColor', 'cmColorPicker');
  applyStrings(document.getElementById('crewModal'));
  openModal('crewModal');
}

async function createNewCrew() {
  var name = document.getElementById('cmCrewName').value.trim();
  if (!name) { showToast(s('cox.crewNameRequired'), 'err'); return; }
  var numPairs = parseInt(document.getElementById('cmNumPairs').value);
  var myPair = parseInt(document.getElementById('cmMyPair').value);
  var mySeat = parseInt(document.getElementById('cmMySeat').value);
  var description = document.getElementById('cmDescription').value.trim();
  var visibility = document.getElementById('cmVisibility').value;
  var color = document.getElementById('cmColor').value;
  try {
    await apiPost('createCrew', {
      name: name, numPairs: numPairs, creatorPairIndex: myPair, creatorSeatIndex: mySeat,
      description: description, visibility: visibility, color: color,
      kennitala: user.kennitala, memberName: user.name,
    });
    closeModal('crewModal');
    showToast(s('toast.saved'), 'ok');
    sessionStorage.removeItem('ymir_getCrewBoard_');
    await loadCrews();
    initCxSlots();
  } catch(e) { showToast(e.message, 'err'); }
}

async function joinSeat(crewId, pairId, seatIndex) {
  try {
    await apiPost('joinCrew', {
      crewId: crewId, pairId: pairId, seatIndex: seatIndex,
      kennitala: user.kennitala, memberName: user.name,
    });
    showToast(s('cox.joined'), 'ok');
    sessionStorage.removeItem('ymir_getCrewBoard_');
    await loadCrews();
    initCxSlots();
  } catch(e) { showToast(e.message, 'err'); }
}

async function leaveCrewConfirm(crewId) {
  if (!(await ymConfirm(s('cox.confirmLeave')))) return;
  try {
    await apiPost('leaveCrew', { crewId: crewId, kennitala: user.kennitala });
    showToast(s('cox.left'), 'ok');
    sessionStorage.removeItem('ymir_getCrewBoard_');
    await loadCrews();
    initCxSlots();
  } catch(e) { showToast(e.message, 'err'); }
}

function openCrewInvModal(crewId) {
  _invCrewId = crewId;
  document.getElementById('ciMemberKt').value = '';
  document.getElementById('ciMemberSearch').value = '';
  document.getElementById('ciMemberName').textContent = '';
  document.getElementById('ciMemberSuggestions').innerHTML = '';
  ensureMembersLoaded();
  var crew = _allBoardCrews.find(function(c) { return c.id === crewId; });
  var pairSel = document.getElementById('ciPairId');
  pairSel.innerHTML = '';
  if (crew) {
    (crew.pairs || []).forEach(function(p, i) {
      var openSlots = (p.members || []).filter(function(m) { return m === null; }).length;
      if (openSlots > 0) {
        pairSel.innerHTML += '<option value="' + esc(p.pairId) + '">' + s('cox.boat') + ' ' + (i + 1) + ' (' + openSlots + ' ' + s('cox.openSpots') + ')</option>';
      }
    });
  }
  applyStrings(document.getElementById('crewInvModal'));
  openModal('crewInvModal');
}

var _searchCrewInvTimer = null;
function searchCrewInvMember(q) {
  clearTimeout(_searchCrewInvTimer);
  var drop = document.getElementById('ciMemberSuggestions');
  if (!q || q.length < 2) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
  _searchCrewInvTimer = setTimeout(function() {
    var ql = q.toLowerCase();
    var hits = [], count = 0;
    for (var i = 0; i < _members.length && count < 8; i++) {
      var m = _members[i];
      if ((m.name || '').toLowerCase().includes(ql) && isReleasedRower(m)) { hits.push(m); count++; }
    }
    if (!hits.length) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
    drop.innerHTML = hits.map(function(m) {
      return '<div class="suggest-item" style="padding:6px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)" '
        + 'data-cx-click="selectCrewInvMember" data-cx-arg="'+esc(m.kennitala)+'" data-cx-arg2="'+esc(memberDisplayName(m, _members))+'">' + esc(memberDisplayName(m, _members)) + '</div>';
    }).join('');
    drop.style.display = 'block';
  }, 150);
}

function selectCrewInvMember(kt, name) {
  document.getElementById('ciMemberKt').value = kt;
  document.getElementById('ciMemberSearch').value = '';
  document.getElementById('ciMemberName').textContent = name;
  document.getElementById('ciMemberSuggestions').innerHTML = '';
  document.getElementById('ciMemberSuggestions').style.display = 'none';
}

async function sendCrewInvite() {
  if (!_invCrewId) return;
  var kt = document.getElementById('ciMemberKt').value;
  var name = document.getElementById('ciMemberName').textContent;
  var pairId = document.getElementById('ciPairId').value;
  if (!kt || !name) { showToast(s('cox.selectMember'), 'err'); return; }
  if (!pairId) { showToast(s('cox.selectPair'), 'err'); return; }
  try {
    await apiPost('inviteToCrew', {
      crewId: _invCrewId, toKennitala: kt, toName: name,
      fromKennitala: user.kennitala, fromName: user.name,
      pairId: pairId,
    });
    closeModal('crewInvModal');
    showToast(s('cox.inviteSent'), 'ok');
    sessionStorage.removeItem('ymir_getCrewBoard_');
    await loadCrews();
  } catch(e) { showToast(e.message, 'err'); }
}

async function respondInvite(inviteId, response) {
  var prevInvites = _crewInvites.slice();
  _crewInvites = _crewInvites.filter(function(inv) { return inv.id !== inviteId; });
  renderCrewInvites();
  try {
    await apiPost('respondCrewInvite', { inviteId: inviteId, response: response });
    showToast(response === 'accepted' ? s('cox.inviteAccepted') : s('cox.inviteRejected'), 'ok');
    sessionStorage.removeItem('ymir_getCrewBoard_');
    await loadCrews();
    initCxSlots();
  } catch(e) {
    _crewInvites = prevInvites;
    renderCrewInvites();
    showToast(e.message, 'err');
  }
}

async function disbandCrewConfirm(crewId) {
  if (!(await ymConfirm(s('cox.confirmDisband')))) return;
  try {
    await apiPost('disbandCrew', { crewId: crewId });
    showToast(s('cox.crewDisbanded'), 'ok');
    sessionStorage.removeItem('ymir_getCrewBoard_');
    await loadCrews();
    initCxSlots();
  } catch(e) { showToast(e.message, 'err'); }
}


// ═══════════════════════════════════════════════════════════════════════════════
// SLOT BOOKING (ROWING SHELLS)
// ═══════════════════════════════════════════════════════════════════════════════

var _cxWeekStart = null;
var _cxSlots = [];
var _cxSlotBoats = [];

function initCxSlots() {
  // Find rowing-shell boats with slot scheduling
  _cxSlotBoats = (_boats || []).filter(function(b) {
    return boolVal(b.slotSchedulingEnabled) && _isRowingGatedBoat(b);
  });
  var sect = document.getElementById('sectSlots');
  // Show section if there are slot-scheduled boats (no longer requires active crews)
  if (!_cxSlotBoats.length) { sect.style.display = 'none'; return; }
  sect.style.display = '';
  // Populate boat filter
  var boatSel = document.getElementById('cxSlotBoat');
  boatSel.innerHTML = '';
  _cxSlotBoats.forEach(function(b) {
    boatSel.innerHTML += '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>';
  });
  // Populate crew filter (active + forming crews)
  var bookableCrews = _myCrews.filter(function(c) { return c.status === 'active' || c.status === 'forming'; });
  var crewSel = document.getElementById('cxSlotCrew');
  crewSel.innerHTML = '';
  if (!bookableCrews.length) {
    crewSel.innerHTML = '<option value="">' + s('cox.noCrewsShort') + '</option>';
  } else {
    bookableCrews.forEach(function(c) {
      var label = c.name;
      if (c.status === 'forming') label += ' (' + s('cox.forming') + ')';
      crewSel.innerHTML += '<option value="' + esc(c.id) + '">' + esc(label) + '</option>';
    });
  }
  // Init week
  var d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0,0,0,0);
  _cxWeekStart = d;
  loadCxSlots();
}

async function loadCxSlots() {
  var boatId = document.getElementById('cxSlotBoat').value;
  if (!boatId) return;
  var fromDate = _cxWeekStart.toISOString().slice(0, 10);
  var toD = new Date(_cxWeekStart); toD.setDate(toD.getDate() + 6);
  var toDate = toD.toISOString().slice(0, 10);
  try {
    var res = await apiGet('getSlots', { boatId: boatId, fromDate: fromDate, toDate: toDate });
    _cxSlots = res.slots || [];
  } catch(e) { _cxSlots = []; }
  renderCxSlots();
  // Warm adjacent weeks so prev/next navigation hits the cache.
  _cxPrefetchAdjacent(boatId);
}

function _cxPrefetchAdjacent(boatId) {
  [-7, 7].forEach(function(offset) {
    var ws = new Date(_cxWeekStart); ws.setDate(ws.getDate() + offset);
    var we = new Date(ws); we.setDate(we.getDate() + 6);
    apiGet('getSlots', {
      boatId: boatId,
      fromDate: ws.toISOString().slice(0, 10),
      toDate: we.toISOString().slice(0, 10),
    }).catch(function() {});
  });
}

var _cxCalendar = null;
function renderCxSlots() {
  // Update week label
  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(_cxWeekStart); d.setDate(d.getDate() + i); days.push(d);
  }
  document.getElementById('cxWeekLabel').textContent =
    fmtWeekRange(days[0].toISOString(), days[6].toISOString());

  // Build all my crew IDs (active + forming)
  var myCrewIds = _myCrews.filter(function(c) { return c.status === 'active' || c.status === 'forming'; }).map(function(c) { return c.id; });

  if (!_cxCalendar) {
    _cxCalendar = new SlotCalendar('cxSlotGrid', {
      isMine: function(sl) { return sl.bookedByCrewId && myCrewIds.indexOf(sl.bookedByCrewId) !== -1; },
      onBook: function(slotId) { bookCxSlot(slotId); },
      onUnbook: function(slotId) { unbookCxSlot(slotId); },
      getSlotColor: function(sl) {
        if (!sl.bookedByCrewId) return null;
        var crew = _allBoardCrews.find(function(c) { return c.id === sl.bookedByCrewId; });
        return crew ? (crew.color || null) : null;
      },
    });
  }
  _cxCalendar.opts.isMine = function(sl) { return sl.bookedByCrewId && myCrewIds.indexOf(sl.bookedByCrewId) !== -1; };
  // Enrich slots with crew name so the calendar can label each booked slot
  // by crew (unambiguous when the user belongs to multiple crews).
  _cxSlots.forEach(function(sl) {
    if (sl.bookedByCrewId && !sl.bookedByCrewName) {
      var crew = _allBoardCrews.find(function(c) { return c.id === sl.bookedByCrewId; });
      if (crew) sl.bookedByCrewName = crew.name;
    }
  });
  _cxCalendar.setWeekStart(_cxWeekStart);
  _cxCalendar.setSlots(_cxSlots);
}

async function bookCxSlot(slotId) {
  var crewId = document.getElementById('cxSlotCrew').value;
  if (!crewId) { showToast(s('cox.createCrewFirst'), 'err'); return; }
  var crew = _myCrews.find(function(c) { return c.id === crewId; });
  var slot = _cxSlots.find(function(sl) { return sl.id === slotId; });
  if (slot) {
    slot.bookedByKennitala = user.kennitala;
    slot.bookedByName = user.name;
    slot.bookedByCrewId = crewId;
    slot.bookedByCrewName = crew ? crew.name : '';
    renderCxSlots();
  }
  try {
    await apiPost('bookSlot', { slotId: slotId, crewId: crewId, kennitala: user.kennitala, memberName: user.name });
    showToast(s('slot.booked'), 'ok');
  } catch(e) {
    showToast(e.message || 'Error', 'err');
    loadCxSlots();
  }
}

async function unbookCxSlot(slotId) {
  if (!(await ymConfirm(s('slot.confirmUnbook')))) return;
  var slot = _cxSlots.find(function(sl) { return sl.id === slotId; });
  var prevSlot = slot ? Object.assign({}, slot) : null;
  if (slot) {
    slot.bookedByKennitala = '';
    slot.bookedByName = '';
    slot.bookedByCrewId = '';
    slot.bookedByCrewName = '';
    renderCxSlots();
  }
  try {
    await apiPost('unbookSlot', { slotId: slotId, kennitala: user.kennitala });
    showToast(s('slot.unbooked'), 'ok');
  } catch(e) {
    if (prevSlot && slot) { Object.assign(slot, prevSlot); renderCxSlots(); }
    showToast(e.message || 'Error', 'err');
  }
}

function openCxBulkBookModal() {
  var crewId = document.getElementById('cxSlotCrew').value;
  if (!crewId) { showToast(s('cox.createCrewFirst'), 'err'); return; }
  document.querySelectorAll('#cxBbDays input').forEach(function(cb) { cb.checked = false; });
  var today = new Date().toISOString().slice(0, 10);
  document.getElementById('cxBbStartTime').value = '';
  document.getElementById('cxBbEndTime').value = '';
  document.getElementById('cxBbFromDate').value = today;
  var endD = new Date(); endD.setMonth(endD.getMonth() + 1);
  document.getElementById('cxBbToDate').value = endD.toISOString().slice(0, 10);
  document.getElementById('cxBbPreview').textContent = '';
  applyStrings(document.getElementById('cxBulkBookModal'));
  openModal('cxBulkBookModal');
}

async function previewCxBulkBook() {
  var days = [];
  document.querySelectorAll('#cxBbDays input:checked').forEach(function(cb) { days.push(parseInt(cb.value)); });
  var fromDate = document.getElementById('cxBbFromDate').value;
  var toDate = document.getElementById('cxBbToDate').value;
  if (!days.length || !fromDate || !toDate) { document.getElementById('cxBbPreview').textContent = s('slot.selectDays'); return; }
  var boatId = document.getElementById('cxSlotBoat').value;
  var filterStart = document.getElementById('cxBbStartTime').value || '';
  var filterEnd = document.getElementById('cxBbEndTime').value || '';
  try {
    var res = await apiGet('getSlots', { boatId: boatId, fromDate: fromDate, toDate: toDate });
    var slots = res.slots || [];
    var total = 0; var open = 0;
    slots.forEach(function(sl) {
      var d = new Date(sl.date + 'T00:00:00');
      if (days.indexOf(d.getDay()) === -1) return;
      if (filterStart && sl.startTime < filterStart) return;
      if (filterEnd && sl.endTime > filterEnd) return;
      total++;
      if (!sl.bookedByKennitala) open++;
    });
    if (open === 0) { document.getElementById('cxBbPreview').textContent = s('slot.bulkNoSlots'); }
    else { document.getElementById('cxBbPreview').textContent = s('slot.bulkPreview', { open: open, total: total }); }
  } catch(e) { document.getElementById('cxBbPreview').textContent = e.message || 'Error'; }
}

async function submitCxBulkBook() {
  var crewId = document.getElementById('cxSlotCrew').value;
  if (!crewId) { showToast(s('cox.createCrewFirst'), 'err'); return; }
  var days = [];
  document.querySelectorAll('#cxBbDays input:checked').forEach(function(cb) { days.push(parseInt(cb.value)); });
  var fromDate = document.getElementById('cxBbFromDate').value;
  var toDate = document.getElementById('cxBbToDate').value;
  var boatId = document.getElementById('cxSlotBoat').value;
  var startTime = document.getElementById('cxBbStartTime').value || '';
  var endTime = document.getElementById('cxBbEndTime').value || '';
  if (!days.length || !fromDate || !toDate || !boatId) { showToast(s('slot.missingFields'), 'err'); return; }
  try {
    var res = await apiPost('bulkBookSlots', {
      boatId: boatId, crewId: crewId, kennitala: user.kennitala, memberName: user.name,
      fromDate: fromDate, toDate: toDate, daysOfWeek: days,
      startTime: startTime, endTime: endTime,
    });
    closeModal('cxBulkBookModal');
    if (res.skipped > 0) { showToast(s('slot.bulkPartial', { booked: res.booked, skipped: res.skipped }), 'ok'); }
    else { showToast(s('slot.bulkBooked', { count: res.booked }), 'ok'); }
    loadCxSlots();
  } catch(e) { showToast(e.message || 'Error', 'err'); }
}

function shiftCxWeek(dir) {
  _cxWeekStart.setDate(_cxWeekStart.getDate() + dir * 7);
  loadCxSlots();
}

function cxWeekToday() {
  var d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0,0,0,0);
  _cxWeekStart = d;
  loadCxSlots();
}

// ══ ROWING PASSPORT ══════════════════════════════════════════════════════════
function _passportLocal(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  return obj[_passportLang] || obj.EN || obj.IS || '';
}
function ppSetSortMode(mode) {
  _passportSortMode = (mode === 'mod-cat') ? 'mod-cat' : 'cat-mod';
  try { localStorage.setItem('ymirPassportSort', _passportSortMode); } catch (e) {}
  renderPassport();
}
window.ppSetSortMode = ppSetSortMode;

function _ppRenderItemCard(passport, it, prog, signingSomeoneElse, canRevoke, opts) {
  opts = opts || {};
  var st = prog.items[it.id] || { signoffs: [], complete: false, distinctSigners: 0, required: passport.requiredSigs || 2 };
  var name = _passportLocal(it.name);
  var desc = _passportLocal(it.desc);
  var icon = st.complete ? '✔' : (st.distinctSigners > 0 ? '◐' : '○');
  var cls = 'pp-item' + (st.complete ? ' pp-item-complete' : '') + (signingSomeoneElse ? ' pp-item-signable' : '');
  var sigText = st.distinctSigners + '/' + st.required;
  var signersList = st.signoffs.map(function(so){
    var revokeBtn = canRevoke ? ' <a href="#" data-cx-click-event="revokeSignoffClick" data-cx-arg="'+so.id+'" style="color:var(--red);text-decoration:none;font-weight:600">✕</a>' : '';
    return _esc(so.signerName || '?') + ' · ' + String(so.timestamp || '').slice(0,10) + revokeBtn;
  }).join(' · ');
  var onclick = signingSomeoneElse ? ' data-cx-click="signPassportItemClick" data-cx-arg="'+it.id+'"' : '';
  var assessment = it.assessment || 'practical';
  if (assessment === 'theoretical') assessment = 'theory'; // back-compat for older stored data
  var badgeCls = 'pp-asmt pp-asmt-' + assessment;
  var badgeLbl = s('passport.' + assessment);
  var moduleNum = Number(it.module || 0);
  // When sorted by module the bucket header already identifies the module,
  // so suppress the per-item badge there to avoid visual noise.
  var showModBadge = moduleNum > 0 && !opts.suppressModuleBadge;
  var modBadge = showModBadge
    ? ' <span class="pp-mod">' + _esc(s('passport.moduleShort')) + ' ' + moduleNum + '</span>'
    : '';
  return '<div class="' + cls + '"' + onclick + '>'
    + '<div class="pp-item-icon">' + icon + '</div>'
    + '<div class="pp-item-body"><div class="pp-item-name">' + _esc(name)
      + ' <span class="' + badgeCls + '">' + _esc(badgeLbl) + '</span>' + modBadge + '</div>'
    + (desc ? '<div class="pp-item-desc">' + _esc(desc) + '</div>' : '')
    + (signersList ? '<div class="pp-item-sigs">' + signersList + '</div>' : '')
    + '</div><div class="pp-item-count">' + sigText + '</div></div>';
}

function renderPassport() {
  if (!_passportDef) return;
  var passport = (_passportDef.passports || []).find(function(p){ return p.id === 'rower'; });
  if (!passport) { document.getElementById('passportCategories').innerHTML = ''; return; }
  var prog = (_passportProgress && _passportProgress.passports && _passportProgress.passports.rower) || { items: {}, totalCount: 0, completeCount: 0, percent: 0 };
  document.getElementById('passportProgressFill').style.width = prog.percent + '%';
  var label = prog.completeCount + ' / ' + prog.totalCount + ' (' + prog.percent + '%)';
  if (_rowingSub !== 'restricted') label += ' — ' + s('passport.historyNote');
  document.getElementById('passportProgressLabel').textContent = label;

  // Reflect the active sort button
  var btnCatMod = document.getElementById('ppSortCatMod');
  var btnModCat = document.getElementById('ppSortModCat');
  if (btnCatMod && btnModCat) {
    btnCatMod.classList.toggle('pp-sortbtn-active', _passportSortMode !== 'mod-cat');
    btnModCat.classList.toggle('pp-sortbtn-active', _passportSortMode === 'mod-cat');
  }

  // Show sign-mode banner if staff/released viewing someone else's passport
  var canSign = (_isStaffSigner || _rowingSub === 'released' || _rowingSub === 'coxswain');
  var signingSomeoneElse = canSign && String(_passportTargetMemberId) !== String(user.id);
  document.getElementById('passportSignerBanner').classList.toggle('hidden', !signingSomeoneElse);
  var canRevoke = _isStaffSigner;

  var html = '';

  if (_passportSortMode === 'mod-cat') {
    // ── Module → Category ──
    // Flatten all non-retired items, bucket by module, then sub-group by their
    // original category so rowers see teaching order as the primary axis.
    var flat = [];
    (passport.categories || []).forEach(function(cat, ci) {
      (cat.items || []).forEach(function(it) {
        if (it.retired) return;
        flat.push({ cat: cat, ci: ci, it: it });
      });
    });
    var byModule = {};
    flat.forEach(function(entry) {
      var m = Number(entry.it.module || 0);
      if (!byModule[m]) byModule[m] = [];
      byModule[m].push(entry);
    });
    var mods = Object.keys(byModule).map(Number).sort(function(a, b) {
      if (a === 0) return 1;   // unassigned last
      if (b === 0) return -1;
      return a - b;
    });
    if (!mods.length) {
      html = '<div class="empty-note">—</div>';
    }
    mods.forEach(function(modNum) {
      var bucket = byModule[modNum];
      var bucketDone = 0;
      bucket.forEach(function(e){ if (prog.items[e.it.id] && prog.items[e.it.id].complete) bucketDone++; });
      var modLabel = modNum > 0
        ? (s('passport.moduleLabel') + ' ' + modNum)
        : s('passport.unassignedModule');
      html += '<div class="pp-cat">'
        + '<div class="pp-mod-hdr">' + _esc(modLabel)
        + ' <span class="pp-cat-count">' + bucketDone + '/' + bucket.length + '</span></div>';
      // Sub-group by category, preserving the passport's category order.
      var byCat = {};
      bucket.forEach(function(e) {
        if (!byCat[e.ci]) byCat[e.ci] = [];
        byCat[e.ci].push(e);
      });
      var catOrder = Object.keys(byCat).map(Number).sort(function(a, b){ return a - b; });
      catOrder.forEach(function(ci) {
        var cat = passport.categories[ci];
        var catName = _passportLocal(cat.name);
        var entries = byCat[ci].slice().sort(function(a, b) {
          return String(_passportLocal(a.it.name)).localeCompare(String(_passportLocal(b.it.name)));
        });
        html += '<div class="pp-subcat-hdr">' + _esc(catName) + '</div>';
        entries.forEach(function(e) {
          html += _ppRenderItemCard(passport, e.it, prog, signingSomeoneElse, canRevoke, { suppressModuleBadge: true });
        });
      });
      html += '</div>';
    });
  } else {
    // ── Category → Module (default) ──
    // Preserve the passport's category order, sort items within each category
    // by module number so rowers can work through the course in sequence.
    (passport.categories || []).forEach(function(cat) {
      var items = (cat.items || []).filter(function(i){ return !i.retired; });
      if (!items.length) return;
      items = items.slice().sort(function(a, b) {
        var ma = Number(a.module || 0);
        var mb = Number(b.module || 0);
        if (ma !== mb) {
          if (ma === 0) return 1;   // unassigned last within a category
          if (mb === 0) return -1;
          return ma - mb;
        }
        return String(_passportLocal(a.name)).localeCompare(String(_passportLocal(b.name)));
      });
      var catName = _passportLocal(cat.name);
      var catDone = 0;
      items.forEach(function(it){ if (prog.items[it.id] && prog.items[it.id].complete) catDone++; });
      html += '<div class="pp-cat"><div class="pp-cat-hdr">' + _esc(catName) + ' <span class="pp-cat-count">' + catDone + '/' + items.length + '</span></div>';
      items.forEach(function(it) {
        html += _ppRenderItemCard(passport, it, prog, signingSomeoneElse, canRevoke, {});
      });
      html += '</div>';
    });
  }

  document.getElementById('passportCategories').innerHTML = html;
}
function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function signPassportItemClick(itemId) {
  if (!(await ymConfirm(s('passport.confirmSign')))) return;
  try {
    var res = await apiPost('signPassportItem', {
      memberId: _passportTargetMemberId,
      passportId: 'rower',
      itemId: itemId,
      signerId: user.id,
    });
    _passportProgress = res.progress;
    renderPassport();
    if (res.promoted) showToast(s('passport.promoted'), 'ok');
    else showToast(s('passport.signed'), 'ok');
  } catch (e) {
    showToast(e.message, 'err');
  }
}
window.signPassportItemClick = signPassportItemClick;

async function reloadPassportProgress() {
  try {
    var res = await apiGet('getRowingPassport', { memberId: _passportTargetMemberId });
    _passportDef = res.definition; _passportProgress = res.progress;
    renderPassport();
  } catch(e) { showToast(e.message, 'err'); }
}

// Match anyone with a rowing_division club endorsement. Delegates to the
// shared hasRowingEndorsement, which is tolerant of legacy data shapes.
function _ppIsRower(m) { return hasRowingEndorsement(m); }

async function ppSearchMember(q) {
  var box = document.getElementById('ppMemberSuggestions');
  q = (q || '').trim().toLowerCase();
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  var itemStyle = 'padding:6px 8px;font-size:12px;border-bottom:1px solid var(--border)';
  var msgStyle  = itemStyle + ';color:var(--muted);font-style:italic';
  // Members are lazy-loaded — show a loading note until the fetch settles so
  // users see that something is happening instead of a blank dropdown.
  if (!_membersLoaded) {
    box.innerHTML = '<div style="' + msgStyle + '">' + _esc(s('lbl.loading')) + '</div>';
    box.classList.remove('hidden');
    await ensureMembersLoaded();
    // A later keystroke may have superseded us — bail if the input no longer matches.
    var cur = (document.getElementById('ppMemberSearch').value || '').trim().toLowerCase();
    if (cur !== q) return;
  }
  var hits = _members.filter(function(m) {
    if (!_ppIsRower(m)) return false;
    var n = String(m.name || '').toLowerCase();
    var k = String(m.kennitala || '').toLowerCase();
    return n.indexOf(q) >= 0 || k.indexOf(q) >= 0;
  }).slice(0, 20);
  if (!hits.length) {
    box.innerHTML = '<div style="' + msgStyle + '">No matching rowers</div>';
    box.innerHTML = diag;
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = hits.map(function(m){
    return '<div class="suggest-item" style="' + itemStyle + ';cursor:pointer" data-cx-click="ppSelectMember" data-cx-arg="'+m.id+'">'
      + _esc(m.name) + ' <span style="color:var(--muted);font-size:10px">' + _esc(m.kennitala || '') + '</span></div>';
  }).join('');
  box.classList.remove('hidden');
}
async function ppSelectMember(memberId) {
  var m = _members.find(function(x){ return String(x.id) === String(memberId); });
  _passportTargetMemberId = memberId;
  document.getElementById('ppMemberSuggestions').classList.add('hidden');
  document.getElementById('ppMemberSearch').value = '';
  document.getElementById('ppCurrentTarget').textContent = m ? ('Viewing: ' + m.name) : '';
  await reloadPassportProgress();
}
function ppViewSelf() {
  _passportTargetMemberId = user.id;
  document.getElementById('ppCurrentTarget').textContent = '';
  document.getElementById('ppMemberSearch').value = '';
  document.getElementById('ppMemberSuggestions').classList.add('hidden');
  reloadPassportProgress();
}
async function revokeSignoffClick(ev, signoffId) {
  ev.preventDefault(); ev.stopPropagation();
  var reason = await ymPrompt(s('passport.revokeReason'));
  if (reason === null) return;
  try {
    await apiPost('revokePassportSignoff', { signoffId: signoffId, revokedBy: user.name || '', reason: reason || '' });
    showToast(s('passport.revoked'), 'ok');
    await reloadPassportProgress();
  } catch(e) { showToast(e.message, 'err'); }
}
window.ppSearchMember = ppSearchMember;
window.ppSelectMember = ppSelectMember;
window.ppViewSelf = ppViewSelf;
window.revokeSignoffClick = revokeSignoffClick;

// ── Expose onclick handlers to global scope (they live inside DOMContentLoaded closure) ──
window.openCrewModal = openCrewModal;
window.createNewCrew = createNewCrew;
window.joinSeat = joinSeat;
window.leaveCrewConfirm = leaveCrewConfirm;
window.openCrewInvModal = openCrewInvModal;
window.searchCrewInvMember = searchCrewInvMember;
window.selectCrewInvMember = selectCrewInvMember;
window.sendCrewInvite = sendCrewInvite;
window.respondInvite = respondInvite;
window.disbandCrewConfirm = disbandCrewConfirm;
window.loadCxSlots = loadCxSlots;
window.renderCxSlots = renderCxSlots;
window.bookCxSlot = bookCxSlot;
window.unbookCxSlot = unbookCxSlot;
window.shiftCxWeek = shiftCxWeek;
window.cxWeekToday = cxWeekToday;
window.openCxBulkBookModal = openCxBulkBookModal;
window.previewCxBulkBook = previewCxBulkBook;
window.submitCxBulkBook = submitCxBulkBook;

}); // end DOMContentLoaded

(function () {
  if (typeof document === 'undefined' || document._cxListeners) return;
  document._cxListeners = true;
  document.addEventListener('click', function (e) {
    var cs = e.target.closest('[data-cx-close-self]');
    if (cs && e.target === cs) { closeModal(cs.id); return; }
    var cl = e.target.closest('[data-cx-close]');
    if (cl) { closeModal(cl.dataset.cxClose); return; }
    var ce = e.target.closest('[data-cx-click-el]');
    if (ce && typeof window[ce.dataset.cxClickEl] === 'function') { window[ce.dataset.cxClickEl](ce); return; }
    var cev = e.target.closest('[data-cx-click-event]');
    if (cev && typeof window[cev.dataset.cxClickEvent] === 'function') { window[cev.dataset.cxClickEvent](e, cev.dataset.cxArg); return; }
    var c = e.target.closest('[data-cx-click]');
    if (c && typeof window[c.dataset.cxClick] === 'function') {
      var a = [c.dataset.cxArg, c.dataset.cxArg2, c.dataset.cxArg3].filter(function (v) { return v != null; });
      window[c.dataset.cxClick].apply(null, a);
    }
  });
  document.addEventListener('change', function (e) {
    var c = e.target.closest('[data-cx-change]');
    if (c && typeof window[c.dataset.cxChange] === 'function') window[c.dataset.cxChange]();
  });
  document.addEventListener('input', function (e) {
    var iv = e.target.closest('[data-cx-input-val]');
    if (iv && typeof window[iv.dataset.cxInputVal] === 'function') window[iv.dataset.cxInputVal](iv.value);
  });
})();
