window._logbookSkipInit = true;

// ══ STATE ════════════════════════════════════════════════════════════════════
const user = requireAuth();
if (!user || !isCaptain(user)) { window.location.href = '../member/'; throw new Error('Not a captain'); }
const L = getLang();

let _boats = [], _locations = [], _allMaint = [], _allTrips = [], _myKeelboatTrips = [];
let _crewConfirmations = [], _verificationRequests = [];
let _maintFilter = 'open', _maintBoatFilter = '';
let _cqMembers = [], _cqCertDefs = [], _cqCertCategories = [];
let _boatCats = [];
let _editingBoatId = null, _bmEditAllowlist = [];

// Globals required by shared/logbook.js
var allTrips = [], myTrips = [], allBoats = [], allMembers = [], allLocs = [];
const _windUnit = getPref('windUnit', 'ms');
// parseDateParts / bftLabel used by tripCard()
function parseDateParts(d) {
  if (!d) return {day:'—',mon:'',yr:''};
  return {day:d.slice(8,10)||'—', mon:String(new Date(d+'T12:00:00').getMonth()+1).padStart(2,'0'), yr:d.slice(0,4)};
}
function bftLabel(b) {
  var n = parseInt(b);
  return ['Calm','Light air','Light breeze','Gentle breeze','Moderate breeze','Fresh breeze','Strong breeze','Near gale','Gale','Severe gale'][n] || 'Force '+b;
}

// ══ INIT ═════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  buildHeader('captain');
  injectBoatModalHtml();
  // Captain's slot context is implicit — the boat is already selected via
  // #cqResBoat in the reservations section, so we hide rsBoat in the modal.
  // Notes aren't captured in captain's workflow either.
  injectRecurringSlotModal({ showBoat: false, showNote: false,
    previewFn: 'previewBulkSlots', saveFn: 'saveBulkSlots', saveKey: 'slot.bulkBook' });
  // Single-slot modal: captain creates-and-books in one step (no edit/delete).
  injectSingleSlotModal({ showBoatName: false, showNote: false, showBookedInfo: false,
    saveFn: 'saveAndBookSlot', saveKey: 'slot.createAndBook',
    titleKey: 'slot.createAndBookTitle' });
  applyStrings();

  document.getElementById('cqTitle').textContent = s('cq.title');
  document.getElementById('cqSubtitle').textContent = user.name + ' — ' + s('cq.subtitle');
  document.getElementById('bioText').placeholder = s('cq.bioPlaceholder');

  // Load existing bio & headshot
  if (user.bio) document.getElementById('bioText').value = user.bio;
  if (user.headshotUrl) renderHeadshot(user.headshotUrl);

  // Headshot upload handler
  document.getElementById('headshotFile').addEventListener('change', uploadHeadshot);

  // Build filter pills
  buildMaintPills();

  // Fetch all data in parallel
  try {
    const [cfgRes, maintRes, tripsRes, confRes, verRes, membersRes] = await Promise.all([
      apiGet('getConfig'),
      apiGet('getMaintenance'),
      apiGet('getTrips', { limit: 500 }),
      apiGet('getConfirmations', { kennitala: user.kennitala }),
      apiGet('getVerificationRequests'),
      apiGet('getMembers'),
    ]);

    _boats     = (cfgRes.boats     || []);
    _locations = (cfgRes.locations || []).filter(l => l.active !== false && l.active !== 'false');
    _cqMembers = (membersRes.members || []).filter(m => m.active !== false && m.active !== 'false');
    _cqCertDefs = certDefsFromConfig(cfgRes.certDefs || []);
    _cqCertCategories = certCategoriesFromConfig(cfgRes.certCategories || []);
    _boatCats = (cfgRes.boatCategories || []).filter(c => c.active !== false && c.active !== 'false');
    if (_boatCats.length) registerBoatCats(_boatCats);
    _allMaint  = maintRes.requests || maintRes.items || maintRes.maintenance || [];
    _verificationRequests = verRes.requests || [];

    // All trips (logbook shows all, defaults to keelboat filter)
    var allTripsRaw = tripsRes.trips || [];
    _allTrips = allTripsRaw;
    _myKeelboatTrips  = _allTrips.filter(t => (t.boatCategory || '').toLowerCase() === 'keelboat')
                         .filter(t => String(t.kennitala) === String(user.kennitala));

    // Confirmations: pending ones where I'm the recipient
    _crewConfirmations = confRes.confirmations || confRes.items || [];

    // Populate logbook globals (myTrips = all trips, captain sees fleet-wide)
    allBoats   = _boats;
    allTrips   = _allTrips;
    myTrips    = _allTrips.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    allMembers = _cqMembers;
    allLocs    = _locations;

    renderStats();
    buildMaintBoatFilter();
    renderMaint();
    renderValidation();
    renderCrew();
    renderBoats();
    initCqReservations();
    buildFilters();
    applyFilter();
  } catch (e) {
    console.error(e);
    showToast(s('toast.loadFailed') + ': ' + e.message, 'err');
  }

  warmContainer();
});

// ══ STATS ════════════════════════════════════════════════════════════════════
function renderStats() {
  var yearStart = new Date().getFullYear() + '-01-01';
  var ytd = _myKeelboatTrips.filter(t => (t.date || '') >= yearStart && (t.role === 'skipper' || t.role === 'captain'));
  var hours = 0, dist = 0;
  ytd.forEach(t => { hours += Number(t.hoursDecimal) || 0; dist += Number(t.distanceNm) || 0; });
  document.getElementById('statTrips').textContent = ytd.length;
  document.getElementById('statHours').textContent = hours.toFixed(1);
  document.getElementById('statDist').textContent  = dist.toFixed(1) + ' ' + s('cq.nm');
}

// ══ MAINTENANCE ══════════════════════════════════════════════════════════════
function buildMaintPills() {
  var el = document.getElementById('maintPills');
  el.innerHTML = '';
  [{k:'open',s:'cq.maintOpen'},{k:'closed',s:'cq.maintClosed'},{k:'all',s:'cq.maintAll'}].forEach(p => {
    var btn = document.createElement('button');
    btn.className = 'cq-pill' + (p.k === _maintFilter ? ' active' : '');
    btn.textContent = s(p.s);
    btn.onclick = () => { _maintFilter = p.k; buildMaintPills(); renderMaint(); };
    el.appendChild(btn);
  });
}

function buildMaintBoatFilter() {
  var sel = document.getElementById('mfBoat');
  // Collect unique keelboat names from maintenance items
  var boatNames = [...new Set(_allMaint
    .filter(m => { var cat = (m.boatCategory||'').toLowerCase(); if (!cat && m.boatId) { var b = _boats.find(x=>x.id===m.boatId); if(b) cat=(b.category||'').toLowerCase(); } return cat==='keelboat'; })
    .map(m => m.boatName || '')
    .filter(Boolean)
  )].sort();
  sel.innerHTML = '<option value="">' + s('cq.allBoats') + '</option>' + boatNames.map(n => '<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
  sel.onchange = function() { _maintBoatFilter = this.value; renderMaint(); };
}

function renderMaint() {
  var el = document.getElementById('maintList');
  // Filter for keelboat-related maintenance
  var items = _allMaint.filter(m => {
    var cat = (m.boatCategory || '').toLowerCase();
    if (!cat && m.boatId) { var b = _boats.find(x => x.id === m.boatId); if (b) cat = (b.category || '').toLowerCase(); }
    return cat === 'keelboat';
  });
  if (_maintFilter === 'open') items = items.filter(m => !m.resolved && !boolVal(m.resolved));
  else if (_maintFilter === 'closed') items = items.filter(m => m.resolved || boolVal(m.resolved));
  if (_maintBoatFilter) items = items.filter(m => (m.boatName || '') === _maintBoatFilter);
  items.sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);

  if (!items.length) { el.innerHTML = '<div class="empty-note">' + s('cq.noMaint') + '</div>'; return; }
  var rendered = items.slice(0, 50);
  el.innerHTML = rendered.map(m => maintRenderCardCompact(m)).join('');
  el.querySelectorAll('.maint-card-compact').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const r  = rendered.find(x => x.id === id);
      if (r) maintOpenDetail(r, (typeof user !== 'undefined' && user) ? user.name : null);
    });
  });
}

// ══ VALIDATION REQUESTS ══════════════════════════════════════════════════════
function renderValidation() {
  var el = document.getElementById('validationList');
  if (!_verificationRequests.length) { el.innerHTML = '<div class="empty-note">' + s('cq.noValidation') + '</div>'; return; }
  el.innerHTML = _verificationRequests.map(r => {
    // Reuse the canonical trip card. Fall back to the request payload when
    // the trip can't be found locally (e.g. outside the limit window).
    var rawTrip = _allTrips.find(t => t.id === r.tripId) || _verifyReqAsTrip(r);
    // Surface the ⏳ VERIFICATION PENDING badge — these cards exist because of
    // a pending verify handshake, but the local trip row may not have the flag
    // set yet. Match the staff review page's approach.
    var isVer = rawTrip.verified && rawTrip.verified !== 'false';
    var trip = isVer ? rawTrip : Object.assign({}, rawTrip, { validationRequested: true });
    return verifyCard({
      trip: trip,
      prefix: 'cq',
      wrapperId: 'vr-' + r.id,
      commentId: 'vrcomment-' + r.id,
      commentValue: trip.staffComment || '',
      commentPlaceholder: s('cq.verifyComment'),
      buttons: [
        { kind:'primary',   label:'✓ ' + s('btn.confirm'), action:'respondValidation', args:[r.id, 'confirmed'] },
        { kind:'secondary', label:'✗ ' + s('cq.reject'),   action:'rejectValidation', args:[r.id] },
      ],
    });
  }).join('');
}

// Shape a verification-request row to look like a trip so tripCard() can
// render it when the underlying trip isn't in the local _allTrips window.
function _verifyReqAsTrip(r) {
  return {
    id: r.tripId, kennitala: r.fromKennitala, memberName: r.fromName,
    date: r.date, timeOut: r.timeOut, timeIn: r.timeIn,
    hoursDecimal: r.hoursDecimal, boatId: r.boatId, boatName: r.boatName,
    boatCategory: r.boatCategory, locationId: r.locationId, locationName: r.locationName,
    crew: r.crew, role: r.role, helm: r.helm,
    beaufort: r.beaufort, windDir: r.windDir, wxSnapshot: r.wxSnapshot,
    skipperNote: r.skipperNote, linkedCheckoutId: r.linkedCheckoutId,
    verified: false, validationRequested: true,
  };
}

async function respondValidation(id, response) {
  var commentEl = document.getElementById('vrcomment-' + id);
  var staffComment = (commentEl && commentEl.value || '').trim();
  // Optimistic UI — remove card immediately
  var prev = _verificationRequests.slice();
  _verificationRequests = _verificationRequests.filter(r => r.id !== id);
  renderValidation();
  try {
    await apiPost('respondConfirmation', { id, response, staffComment, responderName: user.name });
    showToast(s('toast.saved'), 'ok');
  } catch (e) {
    _verificationRequests = prev;
    renderValidation();
    showToast(e.message, 'err');
  }
}

async function rejectValidation(id) {
  var commentEl = document.getElementById('vrcomment-' + id);
  var staffComment = (commentEl && commentEl.value || '').trim();
  var prev = _verificationRequests.slice();
  _verificationRequests = _verificationRequests.filter(r => r.id !== id);
  renderValidation();
  try {
    await apiPost('respondConfirmation', { id, response: 'rejected', staffComment, rejectComment: staffComment, responderName: user.name });
    showToast(s('toast.saved'), 'ok');
  } catch (e) {
    _verificationRequests = prev;
    renderValidation();
    showToast(e.message, 'err');
  }
}

// ══ CREW APPROVALS ═══════════════════════════════════════════════════════════
function renderCrew() {
  var el = document.getElementById('crewList');
  // Pending crew confirmations where I'm asked to confirm (crew_assigned sent TO me, or crew_join sent BY someone to me as skipper)
  var pending = _crewConfirmations.filter(c =>
    c.status === 'pending' && !c.dismissed
    && (c.type === 'crew_assigned' || c.type === 'crew_join')
  );
  if (!pending.length) { el.innerHTML = '<div class="empty-note">' + s('cq.noCrew') + '</div>'; return; }
  el.innerHTML = pending.map(c => {
    var who = c.type === 'crew_join' ? c.fromName : c.toName;
    return '<div class="cq-card">'
      + '<div class="cq-card-title">' + esc(who || '') + '</div>'
      + '<div class="cq-card-sub">' + esc(c.boatName || '') + ' · ' + esc(c.date || '') + '</div>'
      + '<div class="cq-card-meta">' + (c.type === 'crew_join' ? s('cq.crewJoinRequest') : s('cq.crewAssignPending')) + '</div>'
      + '<div class="conf-actions">'
        + '<button class="btn-confirm" data-cq-click="respondCrew" data-cq-arg="'+esc(c.id)+'" data-cq-arg2="confirmed">' + s('btn.confirm') + '</button>'
        + '<button class="btn-reject" data-cq-click="respondCrew" data-cq-arg="'+esc(c.id)+'" data-cq-arg2="rejected">' + s('btn.cancel') + '</button>'
      + '</div>'
    + '</div>';
  }).join('');
}

async function respondCrew(id, response) {
  // Optimistic UI — update card immediately
  var prev = _crewConfirmations.slice();
  _crewConfirmations = _crewConfirmations.map(c => c.id === id ? Object.assign({}, c, { status: response }) : c);
  renderCrew();
  try {
    await apiPost('respondConfirmation', { id, response, responderName: user.name });
    showToast(s('toast.saved'), 'ok');
  } catch (e) {
    _crewConfirmations = prev;
    renderCrew();
    showToast(e.message, 'err');
  }
}


// ══ BIO & HEADSHOT ═══════════════════════════════════════════════════════════
function renderHeadshot(url) {
  if (!url) return;
  var wrap = document.getElementById('headshotWrap');
  // Convert Drive URL to thumbnail
  var displayUrl = url;
  var driveMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) displayUrl = 'https://drive.google.com/thumbnail?id=' + driveMatch[1] + '&sz=w200';
  wrap.innerHTML = '<img src="' + esc(displayUrl) + '" class="cq-headshot-preview" alt="Headshot">';
}

async function uploadHeadshot() {
  var input = document.getElementById('headshotFile');
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { showToast(s('cq.fileTooLarge'), 'err'); return; }
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var res = await apiPost('uploadHeadshot', {
        kennitala: user.kennitala,
        fileData: e.target.result,
        fileName: file.name,
        mimeType: file.type,
      });
      if (res.headshotUrl) {
        renderHeadshot(res.headshotUrl);
        user.headshotUrl = res.headshotUrl;
        setUser(user);
        showToast(s('cq.headshotUploaded'), 'ok');
      }
    } catch (err) { showToast(err.message, 'err'); }
  };
  reader.readAsDataURL(file);
}

async function saveBio() {
  var bio = document.getElementById('bioText').value.trim();
  try {
    await apiPost('saveCaptainBio', { kennitala: user.kennitala, bio: bio });
    user.bio = bio;
    setUser(user);
    showToast(s('cq.bioSaved'), 'ok');
  } catch (e) { showToast(e.message, 'err'); }
}

// ══ MY BOATS ═════════════════════════════════════════════════════════════════
function renderBoats() {
  var el = document.getElementById('boatList');
  // Find boats: owned, reserved for captain, or controlled-access with captain gate cert
  var myBoats = _boats.filter(b => {
    // Only privately owned boats belong in "My Boats"
    if (b.ownership !== 'private') return false;
    // Private boat owned by this captain
    if (String(b.ownerId || b.ownerKennitala || '') === String(user.kennitala)) return true;
    // Private boat with active reservation for this captain
    if (b.reservations && b.reservations.some(r => String(r.memberKennitala) === String(user.kennitala))) return true;
    return false;
  });

  var addBtn = '<div style="margin-top:10px"><button class="btn btn-secondary btn-sm" data-cq-click="openBoatModal">+ ' + esc(s('admin.boatModal.add')) + '</button></div>';
  if (!myBoats.length) { el.innerHTML = '<div class="empty-note">' + s('cq.noBoats') + '</div>' + addBtn; return; }
  el.innerHTML = myBoats.map(b => {
    var isOos = boolVal(b.oos);
    var portName = '';
    if (b.defaultPortId) { var loc = _locations.find(l => l.id === b.defaultPortId); if (loc) portName = loc.name; }
    var isOwner = b.ownership === 'private' && (String(b.ownerId || b.ownerKennitala || '') === String(user.kennitala));
    var isControlled = b.accessMode === 'controlled';

    // Reservation list
    var resHtml = '';
    if (b.reservations && b.reservations.length) {
      resHtml = '<div style="margin-top:8px;font-size:10px;color:var(--muted);letter-spacing:.5px;margin-bottom:4px">' + s('cq.reservations') + '</div>';
      resHtml += b.reservations.map(r => {
        return '<div style="font-size:11px;padding:4px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;margin-bottom:3px;display:flex;justify-content:space-between;align-items:center">'
          + '<span>' + esc(r.memberName) + ' · ' + esc(r.startDate) + ' → ' + esc(r.endDate)
          + (r.note ? ' · <span style="color:var(--muted)">' + esc(r.note) + '</span>' : '') + '</span>'
          + '<button style="font-size:10px;background:none;border:none;color:var(--red);cursor:pointer" data-cq-click="removeCqReservation" data-cq-arg="'+esc(b.id)+'" data-cq-arg2="'+esc(r.id)+'">&times;</button>'
          + '</div>';
      }).join('');
    }

    return '<div class="cq-boat">'
      + '<div>'
        + '<div class="cq-boat-name">' + esc(boatEmoji(b.category)) + ' ' + esc(b.name)
          + (isControlled ? ' <span style="font-size:8px;letter-spacing:.5px;padding:2px 6px;border-radius:10px;border:1px solid var(--accent)44;background:var(--accent)11;color:var(--accent-fg)">' + esc(s('fleet.badgeControlled')) + '</span>' : '')
        + '</div>'
        + '<div class="cq-boat-sub">'
          + (isOos ? '<span style="color:var(--red)">OUT OF SERVICE</span>' : '<span style="color:var(--green)">AVAILABLE</span>')
          + (portName ? ' · ' + esc(portName) : '')
        + '</div>'
      + '</div>'
      + '<div class="cq-boat-actions">'
        + '<button data-cq-click="toggleBoatOos" data-cq-arg="'+esc(b.id)+'" data-cq-arg2="'+(!isOos)+'">' + s(isOos ? 'cq.makeAvailable' : 'cq.makeUnavailable') + '</button>'
        + '<button data-cq-click="openPortModal" data-cq-arg="'+esc(b.id)+'">' + s('cq.changePort') + '</button>'
        + '<button data-cq-click="openResModal" data-cq-arg="'+esc(b.id)+'">' + s('cq.addReservation') + '</button>'
      + '</div>'
      + resHtml
    + '</div>';
  }).join('') + addBtn;
}

var _portBoatId = null;
function openPortModal(boatId) {
  _portBoatId = boatId;
  var sel = document.getElementById('portSelect');
  var ports = _locations.filter(l => l.type === 'port');
  var boat = _boats.find(b => b.id === boatId);
  sel.innerHTML = '<option value="">' + s('lbl.selectDots') + '</option>'
    + ports.map(p => '<option value="' + esc(p.id) + '"' + (boat && boat.defaultPortId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  document.getElementById('portModalTitle').textContent = s('cq.changePort');
  openModal('portModal');
}

async function savePort() {
  if (!_portBoatId) return;
  var portId = document.getElementById('portSelect').value;
  var idx = _boats.findIndex(b => b.id === _portBoatId);
  if (idx < 0) return;
  var prev = _boats[idx].defaultPortId;
  _boats[idx].defaultPortId = portId || '';
  renderBoats();
  closeModal('portModal');
  try {
    await apiPost('saveConfig', { boats: _boats });
    showToast(s('toast.saved'), 'ok');
  } catch (e) {
    _boats[idx].defaultPortId = prev;
    renderBoats();
    showToast(e.message, 'err');
  }
}

async function toggleBoatOos(boatId, oos) {
  var idx = _boats.findIndex(b => b.id === boatId);
  if (idx < 0) return;
  var prev = _boats[idx].oos;
  _boats[idx].oos = oos;
  renderBoats();
  try {
    await apiPost('saveConfig', { boats: _boats });
    showToast(s('toast.saved'), 'ok');
  } catch (e) {
    _boats[idx].oos = prev;
    renderBoats();
    showToast(e.message, 'err');
  }
}

// ══ RESERVATION MANAGEMENT ═══════════════════════════════════════════════════
var _resBoatId = null;

function openResModal(boatId) {
  _resBoatId = boatId;
  document.getElementById('cqResMemberKt').value = '';
  document.getElementById('cqResMemberSearch').value = '';
  document.getElementById('cqResMemberName').textContent = '';
  document.getElementById('cqResMemberSuggestions').innerHTML = '';
  document.getElementById('cqResStart').value = '';
  document.getElementById('cqResEnd').value = '';
  document.getElementById('cqResNote').value = '';
  openModal('resModal');
}

var _searchCqResTimer = null;
function searchCqResMember(q) {
  clearTimeout(_searchCqResTimer);
  var drop = document.getElementById('cqResMemberSuggestions');
  if (!q || q.length < 2) { drop.innerHTML=''; drop.style.display='none'; return; }
  _searchCqResTimer = setTimeout(function() {
    var ql = q.toLowerCase();
    var hits = [], count = 0;
    for (var i = 0; i < _cqMembers.length && count < 8; i++) {
      if (((_cqMembers[i].name||'').toLowerCase()).includes(ql)) { hits.push(_cqMembers[i]); count++; }
    }
    if (!hits.length) { drop.innerHTML=''; drop.style.display='none'; return; }
    drop.innerHTML = hits.map(m => '<div class="suggest-item" style="padding:6px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)" '
      + 'data-cq-click="selectCqResMember" data-cq-arg="'+esc(m.kennitala)+'" data-cq-arg2="'+esc(memberDisplayName(m, _cqMembers))+'">' + esc(memberDisplayName(m, _cqMembers)) + '</div>').join('');
    drop.style.display = 'block';
  }, 150);
}

function selectCqResMember(kt, name) {
  document.getElementById('cqResMemberKt').value = kt;
  document.getElementById('cqResMemberSearch').value = '';
  document.getElementById('cqResMemberName').textContent = name;
  document.getElementById('cqResMemberSuggestions').innerHTML = '';
  document.getElementById('cqResMemberSuggestions').style.display = 'none';
}

async function saveCqReservation() {
  if (!_resBoatId) return;
  var kt = document.getElementById('cqResMemberKt').value;
  var name = document.getElementById('cqResMemberName').textContent;
  var start = document.getElementById('cqResStart').value;
  var end = document.getElementById('cqResEnd').value;
  var note = document.getElementById('cqResNote').value.trim();
  if (!kt || !name || !start || !end) { showToast(s('cq.memberDatesRequired'), 'err'); return; }
  try {
    var res = await apiPost('saveReservation', { boatId: _resBoatId, memberKennitala: kt, memberName: name, startDate: start, endDate: end, note: note });
    var b = _boats.find(x => x.id === _resBoatId);
    if (b && res.boat) { b.reservations = res.boat.reservations; }
    closeModal('resModal');
    renderBoats();
    showToast(s('boat.reservationSaved'), 'ok');
  } catch (e) { showToast(e.message, 'err'); }
}

async function removeCqReservation(boatId, resId) {
  if (!(await ymConfirm(s('boat.removeReservation') + '?'))) return;
  try {
    var res = await apiPost('removeReservation', { boatId: boatId, reservationId: resId });
    var b = _boats.find(x => x.id === boatId);
    if (b && res.boat) { b.reservations = res.boat.reservations; }
    renderBoats();
    showToast(s('boat.reservationRemoved'), 'ok');
  } catch (e) { showToast(e.message, 'err'); }
}

// ══ CREDENTIAL ASSIGNMENT (Captain) — uses shared/mcm.js ═══════════════════
window.mcmGetMembers        = function() { return _cqMembers; };
window.mcmGetCertDefs       = function() { return _cqCertDefs; };
window.mcmGetCertCategories = function() { return _cqCertCategories; };

// ══ CAPTAIN LOGBOOK FILTERS (override shared/logbook.js) ════════════════════
var _captains = [];
var _cqTripFilter = null;  // shared/list-filter.js controller built in buildFilters()

// Resolve the skipper's kennitala for a trip. For a crew trip, this walks the
// linkage (linkedTripId / linkedCheckoutId) back to the skipper row.
function _tripSkipperKt(t) {
  if (!t) return '';
  if (t.role !== 'crew') return String(t.kennitala || '');
  var skip = null;
  if (t.linkedTripId) {
    skip = allTrips.find(function(x) { return x.id === t.linkedTripId; });
  }
  if (!skip && t.linkedCheckoutId) {
    skip = allTrips.find(function(x) {
      return x.linkedCheckoutId === t.linkedCheckoutId && x.role !== 'crew';
    });
  }
  return skip ? String(skip.kennitala || '') : '';
}

// Set of kennitala for everyone aboard the voyage that includes trip t:
// owner + linked skipper + all sibling trips + entries in crewNames.
function _tripPartyKts(t) {
  var set = new Set();
  if (!t) return set;
  if (t.kennitala) set.add(String(t.kennitala));
  var skKt = _tripSkipperKt(t);
  if (skKt) set.add(skKt);
  var coId = t.linkedCheckoutId || '';
  var skipperId = t.role === 'crew' ? (t.linkedTripId || '') : t.id;
  allTrips.forEach(function(x) {
    var sameVoyage = (coId && x.linkedCheckoutId === coId) ||
                     (skipperId && (x.id === skipperId || x.linkedTripId === skipperId));
    if (sameVoyage && x.kennitala) set.add(String(x.kennitala));
  });
  var stored = [];
  try { if (t.crewNames) stored = typeof t.crewNames === 'string' ? JSON.parse(t.crewNames) : t.crewNames; } catch(e) {}
  if (!stored.length && t.role === 'crew') {
    var skTrip = null;
    if (t.linkedTripId) skTrip = allTrips.find(function(x) { return x.id === t.linkedTripId && x.crewNames; });
    if (!skTrip && t.linkedCheckoutId) {
      skTrip = allTrips.find(function(x) { return x.linkedCheckoutId === t.linkedCheckoutId && x.role !== 'crew' && x.crewNames; });
    }
    if (skTrip) {
      try { stored = typeof skTrip.crewNames === 'string' ? JSON.parse(skTrip.crewNames) : skTrip.crewNames; } catch(e) {}
    }
  }
  (stored || []).forEach(function(cn) { if (cn && cn.kennitala) set.add(String(cn.kennitala)); });
  return set;
}

function _rebuildBoatNameOptions(catFilter) {
  var lc = (catFilter || '').toLowerCase();
  var names = [...new Set(myTrips
    .filter(function(t) {
      if (!lc) return true;
      var tCat = ((allBoats.find(function(b) { return b.id === t.boatId; }) || {}).category || t.boatCategory || '').toLowerCase();
      return tCat === lc;
    })
    .map(function(t) { return t.boatName || ''; }).filter(Boolean))].sort();
  var bSel = document.getElementById('fBoatName');
  var prev = bSel.value;
  bSel.innerHTML = '<option value="">' + s('cq.allBoats') + '</option>';
  names.forEach(function(n) { var o = document.createElement('option'); o.value = n; o.textContent = n; bSel.appendChild(o); });
  if (names.indexOf(prev) !== -1) bSel.value = prev;
}

function buildFilters() {
  // Year filter
  var years = [...new Set(myTrips.map(function(t) { return sstr(t.date).slice(0, 4); }).filter(Boolean))].sort().reverse();
  var yrSel = document.getElementById('fYear');
  yrSel.innerHTML = '<option value="">' + s('cq.allYears') + '</option>';
  years.forEach(function(y) { var o = document.createElement('option'); o.value = y; o.textContent = y; yrSel.appendChild(o); });
  var thisYear = String(new Date().getFullYear());
  if (years.includes(thisYear)) yrSel.value = thisYear;

  // Category filter (default to keelboat)
  var cats = [...new Set(myTrips.map(function(t) { return (allBoats.find(function(b) { return b.id === t.boatId; }) || {}).category || t.boatCategory || ''; }).filter(Boolean))].sort();
  var cSel = document.getElementById('fCat');
  cSel.innerHTML = '<option value="">' + s('cq.allCategories') + '</option>';
  cats.forEach(function(c) { var o = document.createElement('option'); o.value = c; o.textContent = boatEmoji(c.toLowerCase()) + ' ' + c; cSel.appendChild(o); });
  var keelboatCat = cats.find(function(c) { return c.toLowerCase() === 'keelboat'; });
  if (keelboatCat) cSel.value = keelboatCat;

  // Boat name filter — options follow the selected category
  _rebuildBoatNameOptions(cSel.value);

  // Captain filter (members who isCaptain)
  _captains = _cqMembers.filter(function(m) { return isCaptain(m); }).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
  var capSel = document.getElementById('fCaptain');
  capSel.innerHTML = '<option value="">' + s('cq.allCaptains') + '</option>';
  _captains.forEach(function(c) { var o = document.createElement('option'); o.value = c.kennitala; o.textContent = memberDisplayName(c, _captains); capSel.appendChild(o); });

  // Member filter (anyone with keelboat_crew endorsement)
  var keelboatMembers = _cqMembers.filter(function(m) {
    if (!m.certifications) return false;
    var certs = typeof m.certifications === 'string' ? parseJson(m.certifications, []) : (m.certifications || []);
    return Array.isArray(certs) && certs.some(function(c) { return c.certId === 'keelboat_crew'; });
  }).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
  var mSel = document.getElementById('fMember');
  mSel.innerHTML = '<option value="">' + s('cq.allMembers') + '</option>';
  keelboatMembers.forEach(function(m) { var o = document.createElement('option'); o.value = m.kennitala; o.textContent = memberDisplayName(m, keelboatMembers); mSel.appendChild(o); });

  // Category change rebuilds boat-name options before the filter re-runs.
  cSel.addEventListener('change', function() { _rebuildBoatNameOptions(this.value); });

  var yrInitial  = yrSel.value;
  var catInitial = cSel.value;
  _cqTripFilter = createListFilter({
    source:  function() { return myTrips; },
    filters: { yr: yrInitial, cat: catInitial, boatName: '', captain: '', member: '', wind: '', verified: '' },
    predicate: function(t, f) {
      if (f.yr && !(t.date || '').startsWith(f.yr)) return false;
      if (f.cat) {
        var tCat = ((allBoats.find(function(b) { return b.id === t.boatId; }) || {}).category || t.boatCategory || '').toLowerCase();
        if (tCat !== f.cat.toLowerCase()) return false;
      }
      if (f.boatName && (t.boatName || '') !== f.boatName) return false;
      if (f.captain  && _tripSkipperKt(t) !== String(f.captain)) return false;
      if (f.member   && !_tripPartyKts(t).has(String(f.member))) return false;
      if (f.wind) {
        var b = parseInt(t.beaufort) || 0;
        if (f.wind === 'gt4'  && b <= 4) return false;
        if (f.wind === 'lte4' && b >  4) return false;
        if (['calm','light','moderate','strong'].includes(f.wind) && bftGroup(b) !== f.wind) return false;
      }
      if (f.verified) {
        var v = t.verified && t.verified !== 'false';
        if (f.verified === 'yes' && !v) return false;
        if (f.verified === 'no'  &&  v) return false;
      }
      if (f.search) {
        var hay = [t.boatName, t.memberName, t.locationName, t.date, t.beaufort, t.windDir, t.notes, t.skipperNote, t.boatCategory].join(' ').toLowerCase();
        if (!hay.includes(f.search.toLowerCase().trim())) return false;
      }
      return true;
    },
    render: function(filtered) {
      // Tear down previous mini-maps before re-rendering cards — leaflet leaks
      // handlers otherwise.
      Object.keys(_thumbMaps).forEach(function(k) { try { _thumbMaps[k].remove(); } catch(e){} delete _thumbMaps[k]; });
      document.getElementById('tripList').innerHTML = filtered.length
        ? filtered.map(tripCard).join('')
        : '<div class="empty-note">' + s('cq.noTripsMatch') + '</div>';
      document.getElementById('filterCount').textContent = filtered.length + ' / ' + myTrips.length;
      if (typeof _fsRenderChips === 'function') _fsRenderChips();
    },
  }).autoWire({
    fields: { fYear: 'yr', fCat: 'cat', fBoatName: 'boatName', fCaptain: 'captain', fMember: 'member', fWind: 'wind' },
    search: 'fText',
  });

  if (typeof _fsRegister === 'function') {
    _fsRegister(_cqTripFilter, [
      { key: 'yr',       elId: 'fYear',     kind: 'select' },
      { key: 'cat',      elId: 'fCat',      kind: 'select' },
      { key: 'boatName', elId: 'fBoatName', kind: 'select' },
      { key: 'captain',  elId: 'fCaptain',  kind: 'select' },
      { key: 'member',   elId: 'fMember',   kind: 'select' },
      { key: 'wind',     elId: 'fWind',     kind: 'select' },
      { key: 'verified',                    kind: 'pill'   },
    ]);
  }
}

// Kept as a thin shim so existing callers (init, post-save refreshes) keep working.
function applyFilter() { if (_cqTripFilter) _cqTripFilter.refresh(); }

// ═══════════════════════════════════════════════════════════════════════════════
// CAPTAIN RESERVATION SLOTS
// ═══════════════════════════════════════════════════════════════════════════════

var _cqWeekStart = null;
var _cqSlots = [];
var _cqSlotBoats = [];

function initCqReservations() {
  // Find keelboats with slot scheduling that the captain can access
  _cqSlotBoats = (_boats || []).filter(function(b) {
    return boolVal(b.slotSchedulingEnabled) && b.accessMode === 'controlled'
      && (b.category || '').toLowerCase() === 'keelboat';
  });
  var sect = document.getElementById('sectReservations');
  if (!_cqSlotBoats.length) { sect.style.display = 'none'; return; }
  sect.style.display = '';
  // Populate boat filter
  var sel = document.getElementById('cqResBoat');
  sel.innerHTML = '';
  _cqSlotBoats.forEach(function(b) {
    sel.innerHTML += '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>';
  });
  // Initialize booking color picker from user preferences
  var colorEl = document.getElementById('cqBookingColor');
  if (colorEl) {
    var prefs = {};
    try { prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : (user.preferences || {}); } catch (e) {}
    colorEl.value = prefs.bookingColor || '#2e7d32';
    var trig = document.getElementById('cqBookingColorBtn');
    if (trig) trig.style.background = colorEl.value;
    if (typeof renderColorSwatches === 'function') renderColorSwatches('cqBookingColor', 'cqBookingColorSwatches');
  }
  // Set week start
  var d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0,0,0,0);
  _cqWeekStart = d;
  loadCqSlots();
}

async function loadCqSlots() {
  var boatId = document.getElementById('cqResBoat').value;
  if (!boatId) return;
  // Show "Create & Book" button only when boat is available outside its defined slots
  var selBoat = _cqSlotBoats.find(function(b) { return b.id === boatId; });
  var createBtn = document.getElementById('cqCreateSlotBtn');
  if (createBtn) createBtn.style.display = (selBoat && selBoat.availableOutsideSlots !== false) ? '' : 'none';
  var fromDate = _cqWeekStart.toISOString().slice(0, 10);
  var toD = new Date(_cqWeekStart); toD.setDate(toD.getDate() + 6);
  var toDate = toD.toISOString().slice(0, 10);
  try {
    var res = await apiGet('getSlots', { boatId: boatId, fromDate: fromDate, toDate: toDate });
    _cqSlots = res.slots || [];
  } catch(e) { _cqSlots = []; }
  renderCqSlots();
  // Warm adjacent weeks so prev/next navigation hits the cache instead of
  // round-tripping. Fire-and-forget; failures are silently ignored.
  _cqPrefetchAdjacent(boatId);
}

function _cqPrefetchAdjacent(boatId) {
  [-7, 7].forEach(function(offset) {
    var ws = new Date(_cqWeekStart); ws.setDate(ws.getDate() + offset);
    var we = new Date(ws); we.setDate(we.getDate() + 6);
    apiGet('getSlots', {
      boatId: boatId,
      fromDate: ws.toISOString().slice(0, 10),
      toDate: we.toISOString().slice(0, 10),
    }).catch(function() {});
  });
}

var _cqCalendar = null;
function renderCqSlots() {
  // Update week label
  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(_cqWeekStart); d.setDate(d.getDate() + i); days.push(d);
  }
  document.getElementById('cqWeekLabel').textContent =
    fmtWeekRange(days[0].toISOString(), days[6].toISOString());

  // Create calendar instance once, then reuse
  if (!_cqCalendar) {
    _cqCalendar = new SlotCalendar('cqSlotGrid', {
      isMine: function(sl) { return sl.bookedByKennitala && String(sl.bookedByKennitala) === String(user.kennitala); },
      onBook: function(slotId) { bookCqSlot(slotId); },
      onUnbook: function(slotId) { unbookCqSlot(slotId); },
      getSlotColor: function(sl) { return sl.bookingColor || null; },
    });
  }
  _cqCalendar.setWeekStart(_cqWeekStart);
  _cqCalendar.setSlots(_cqSlots);
}

function _cqGetBookingColor() {
  var el = document.getElementById('cqBookingColor');
  if (el && el.value) return el.value;
  try {
    var prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : (user.preferences || {});
    return prefs.bookingColor || '';
  } catch (e) { return ''; }
}

async function saveCqBookingColor() {
  var color = document.getElementById('cqBookingColor').value;
  var btn = document.getElementById('cqBookingColorBtn');
  if (btn) btn.style.background = color;
  var prefs = {};
  try { prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : (user.preferences || {}); } catch (e) {}
  prefs.bookingColor = color;
  user.preferences = prefs;
  try {
    await apiPost('savePreferences', { kennitala: user.kennitala, preferences: prefs });
    toast(s('toast.saved'));
  } catch(e) { toast(e.message || 'Error', 'err'); }
  renderCqSlots();
}

function toggleCqBookingColorPop() {
  var pop = document.getElementById('cqBookingColorPop');
  var btn = document.getElementById('cqBookingColorBtn');
  if (!pop || !btn) return;
  var opening = pop.classList.contains('hidden');
  if (opening) {
    pop.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    // Defer binding so the click that opened doesn't immediately close.
    setTimeout(function () {
      document.addEventListener('mousedown', _cqBookingColorOutside, true);
      document.addEventListener('keydown', _cqBookingColorKey, true);
    }, 0);
  } else {
    _cqBookingColorClose();
  }
}

function _cqBookingColorClose() {
  var pop = document.getElementById('cqBookingColorPop');
  var btn = document.getElementById('cqBookingColorBtn');
  if (pop) pop.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('mousedown', _cqBookingColorOutside, true);
  document.removeEventListener('keydown', _cqBookingColorKey, true);
}

function _cqBookingColorOutside(e) {
  var pop = document.getElementById('cqBookingColorPop');
  var btn = document.getElementById('cqBookingColorBtn');
  if (!pop || !btn) return;
  if (pop.contains(e.target) || btn.contains(e.target)) return;
  _cqBookingColorClose();
}

function _cqBookingColorKey(e) {
  if (e.key === 'Escape') { _cqBookingColorClose(); document.getElementById('cqBookingColorBtn')?.focus(); }
}

async function bookCqSlot(slotId) {
  var slot = _cqSlots.find(function(sl) { return sl.id === slotId; });
  var bookingColor = _cqGetBookingColor();
  if (slot) {
    slot.bookedByKennitala = user.kennitala;
    slot.bookedByName = user.name;
    if (bookingColor) slot.bookingColor = bookingColor;
    renderCqSlots();
  }
  try {
    var res = await apiPost('bookSlot', { slotId: slotId, kennitala: user.kennitala, memberName: user.name, bookingColor: bookingColor });
    // Booking a virtual class-slot materializes a real reservationSlots row
    // on the backend; capture the new id (and drop the `virtual` flag) so a
    // subsequent unbook in the same session targets the materialized row
    // instead of being rejected as "virtual class slot — nothing to unbook".
    if (slot && res && res.slotId && res.slotId !== slotId) {
      slot.id = res.slotId;
      slot.virtual = false;
    }
    toast(s('slot.booked'));
    // Reconcile with backend truth — cheap defensive refresh in case the
    // optimistic update missed a field (e.g. tentative flag for forming crews).
    loadCqSlots();
  } catch(e) {
    toast(e.message || 'Error', 'err');
    loadCqSlots();
  }
}

async function unbookCqSlot(slotId) {
  if (!(await ymConfirm(s('slot.confirmUnbook')))) return;
  var slot = _cqSlots.find(function(sl) { return sl.id === slotId; });
  var prevSlot = slot ? Object.assign({}, slot) : null;
  if (slot) {
    slot.bookedByKennitala = '';
    slot.bookedByName = '';
    slot.bookedByCrewId = '';
    slot.bookingColor = '';
    // Class-slot bookings are dematerialized on the backend (the row is
    // deleted so the projection re-emits the virtual). Mirror that locally:
    // restore the virtual flag + vslot-* id so the renderer paints the held
    // pattern instead of plain "open", and a follow-up click books cleanly
    // against the projected id.
    if (slot.sourceActivityClassId) {
      slot.virtual = true;
      slot.id = 'vslot-' + slot.sourceActivityClassId + '-' + slot.boatId + '-' + slot.date;
    }
    renderCqSlots();
  }
  try {
    await apiPost('unbookSlot', { slotId: slotId, kennitala: user.kennitala });
    toast(s('slot.unbooked'));
    // Reconcile with backend truth — guarantees the rendered state matches
    // even if the optimistic update missed something (e.g. dematerialized
    // class slot needs the freshly-projected vslot back).
    loadCqSlots();
  } catch(e) {
    if (prevSlot && slot) { Object.assign(slot, prevSlot); renderCqSlots(); }
    toast(e.message || 'Error', 'err');
  }
}

function openBulkSlotModal() {
  document.querySelectorAll('#rsDays input').forEach(function(cb) { cb.checked = false; });
  var today = new Date().toISOString().slice(0, 10);
  document.getElementById('rsStartTime').value = '';
  document.getElementById('rsEndTime').value = '';
  document.getElementById('rsFromDate').value = today;
  var endD = new Date(); endD.setMonth(endD.getMonth() + 1);
  document.getElementById('rsToDate').value = endD.toISOString().slice(0, 10);
  document.getElementById('rsPreview').textContent = '';
  applyStrings(document.getElementById('recurSlotModal'));
  openModal('recurSlotModal');
}

async function previewBulkSlots() {
  var days = [];
  document.querySelectorAll('#rsDays input:checked').forEach(function(cb) { days.push(parseInt(cb.value)); });
  var fromDate = document.getElementById('rsFromDate').value;
  var toDate = document.getElementById('rsToDate').value;
  if (!days.length || !fromDate || !toDate) { document.getElementById('rsPreview').textContent = s('slot.selectDays'); return; }
  var boatId = document.getElementById('cqResBoat').value;
  var filterStart = document.getElementById('rsStartTime').value || '';
  var filterEnd = document.getElementById('rsEndTime').value || '';
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
    if (open === 0) { document.getElementById('rsPreview').textContent = s('slot.bulkNoSlots'); }
    else { document.getElementById('rsPreview').textContent = s('slot.bulkPreview', { open: open, total: total }); }
  } catch(e) { document.getElementById('rsPreview').textContent = e.message || 'Error'; }
}

async function saveBulkSlots() {
  var days = [];
  document.querySelectorAll('#rsDays input:checked').forEach(function(cb) { days.push(parseInt(cb.value)); });
  var fromDate = document.getElementById('rsFromDate').value;
  var toDate = document.getElementById('rsToDate').value;
  var boatId = document.getElementById('cqResBoat').value;
  var startTime = document.getElementById('rsStartTime').value || '';
  var endTime = document.getElementById('rsEndTime').value || '';
  if (!days.length || !fromDate || !toDate || !boatId) { toast(s('slot.missingFields'), 'err'); return; }
  try {
    var res = await apiPost('bulkBookSlots', {
      boatId: boatId, kennitala: user.kennitala, memberName: user.name,
      fromDate: fromDate, toDate: toDate, daysOfWeek: days,
      startTime: startTime, endTime: endTime, bookingColor: _cqGetBookingColor(),
    });
    closeModal('recurSlotModal');
    if (res.skipped > 0) { toast(s('slot.bulkPartial', { booked: res.booked, skipped: res.skipped })); }
    else { toast(s('slot.bulkBooked', { count: res.booked })); }
    loadCqSlots();
  } catch(e) { toast(e.message || 'Error', 'err'); }
}

function shiftCqWeek(dir) {
  _cqWeekStart.setDate(_cqWeekStart.getDate() + dir * 7);
  loadCqSlots();
}

function cqWeekToday() {
  var d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0,0,0,0);
  _cqWeekStart = d;
  loadCqSlots();
}

function openCreateSlotModal() {
  var today = new Date().toISOString().slice(0, 10);
  document.getElementById('smDate').value = today;
  document.getElementById('smStartTime').value = '';
  document.getElementById('smEndTime').value = '';
  applyStrings(document.getElementById('slotModal'));
  openModal('slotModal');
}

async function saveAndBookSlot() {
  var boatId = document.getElementById('cqResBoat').value;
  if (!boatId) { toast(s('slot.missingFields'), 'err'); return; }
  var date = document.getElementById('smDate').value;
  var startTime = document.getElementById('smStartTime').value;
  var endTime = document.getElementById('smEndTime').value;
  if (!date || !startTime || !endTime) { toast(s('slot.missingFields'), 'err'); return; }
  if (endTime <= startTime) { toast(s('slot.missingFields'), 'err'); return; }
  // Pre-flight: check loaded slots for overlaps on this boat/date so captains
  // get instant feedback instead of a round-trip. The backend also enforces
  // this, so out-of-view slots (e.g. not in the current week) are still caught.
  try {
    var pre = await apiGet('getSlots', { boatId: boatId, fromDate: date, toDate: date });
    var existing = pre.slots || [];
    var conflict = existing.some(function(sl) {
      return sl.date === date && startTime < sl.endTime && endTime > sl.startTime;
    });
    if (conflict) { toast(s('slot.conflict'), 'err'); return; }
  } catch(e) { /* fall through — backend will still validate */ }
  try {
    // Create the slot
    var res = await apiPost('saveSlot', { boatId: boatId, date: date, startTime: startTime, endTime: endTime });
    // Book it for the current user
    await apiPost('bookSlot', { slotId: res.slotId, kennitala: user.kennitala, memberName: user.name });
    closeModal('slotModal');
    toast(s('slot.createdAndBooked'));
    loadCqSlots();
  } catch(e) { toast(e.message || 'Error', 'err'); }
}

// ══ ADD BOAT MODAL (captain) ════════════════════════════════════════════════
function populateCqCategorySelect() {
  var sorted = _boatCats.slice().sort(function(a, b) {
    var la = (L === 'IS' && a.labelIS ? a.labelIS : a.labelEN) || '';
    var lb = (L === 'IS' && b.labelIS ? b.labelIS : b.labelEN) || '';
    return la.localeCompare(lb);
  });
  var opts = sorted.map(function(c) {
    return '<option value="' + esc(c.key) + '">' + esc(c.emoji || '') + ' ' + esc(L === 'IS' && c.labelIS ? c.labelIS : c.labelEN) + '</option>';
  }).join('');
  var bCat = document.getElementById('bCategory');
  if (bCat) bCat.innerHTML = opts;
}

function populateCqDefaultPortSelect(selectedId) {
  var sel = document.getElementById('bDefaultPortId');
  if (!sel) return;
  var ports = _locations.filter(function(l) { return l.type === 'port'; });
  sel.innerHTML = '<option value="">' + s('admin.optionNone') + '</option>'
    + ports.map(function(p) { return '<option value="' + esc(p.id) + '"' + (p.id === selectedId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
}

function updateBoatModalFields() {
  var cat = document.getElementById('bCategory').value;
  var isKeelboat = cat === 'keelboat';
  var lbl = document.getElementById('bRegNoLabel');
  var inp = document.getElementById('bRegNo');
  lbl.setAttribute('data-s', isKeelboat ? 'boat.registrationNo' : 'boat.sailNo');
  lbl.textContent = s(isKeelboat ? 'boat.registrationNo' : 'boat.sailNo');
  inp.placeholder = isKeelboat ? 'e.g. ÍS-342' : 'e.g. 1234';
}

function updateOwnershipFields() {
  var isPrivate = document.getElementById('bOwnership').value === 'private';
  document.getElementById('bOwnerField').classList.toggle('hidden', !isPrivate);
}

function searchBoatOwner(q) {
  var drop = document.getElementById('bOwnerSuggestions');
  if (!q || q.length < 2) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
  var ql = q.toLowerCase();
  var hits = _cqMembers.filter(function(m) { return (m.name || '').toLowerCase().includes(ql); }).slice(0, 8);
  if (!hits.length) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
  drop.innerHTML = hits.map(function(m) {
    return '<div class="suggest-item" style="padding:6px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)" '
      + 'data-cq-click="selectBoatOwner" data-cq-arg="'+esc(m.kennitala)+'" data-cq-arg2="'+esc(memberDisplayName(m, _cqMembers))+'">' + esc(memberDisplayName(m, _cqMembers)) + '</div>';
  }).join('');
  drop.style.display = 'block';
}

function selectBoatOwner(kt, name) {
  document.getElementById('bOwnerId').value = kt;
  document.getElementById('bOwnerSearch').value = '';
  document.getElementById('bOwnerName').textContent = name;
  document.getElementById('bOwnerSuggestions').innerHTML = '';
  document.getElementById('bOwnerSuggestions').style.display = 'none';
}

function updateAccessFields() {
  var isControlled = document.getElementById('bAccessMode').value === 'controlled';
  document.getElementById('bAccessControlledSection').classList.toggle('hidden', !isControlled);
  document.getElementById('bSlotSchedulingSection').classList.toggle('hidden', !isControlled);
}

function updateSlotFields() {
  var enabled = document.getElementById('bSlotScheduling').checked;
  document.getElementById('bSlotOptions').classList.toggle('hidden', !enabled);
}

// Gate encoding/decoding helpers — mirror of admin's version. See
// populateGateCertSelect in admin/index.html for the canonical commentary.
function _cqEncodeGateValue(gate) {
  if (!gate || !gate.certId) return '';
  var out = { certId: gate.certId };
  if (gate.sub) out.sub = gate.sub;
  if (gate.minRank) out.minRank = Number(gate.minRank);
  return JSON.stringify(out);
}
function _cqDecodeGateValue(v) {
  if (!v) return null;
  try { var o = JSON.parse(v); return (o && o.certId) ? o : null; } catch (e) { return null; }
}
function _cqCurrentGateFor(boat) {
  if (!boat) return null;
  if (typeof normalizeAccessGate === 'function') {
    return normalizeAccessGate(boat, _cqCertDefs);
  }
  if (boat.accessGate && boat.accessGate.certId) return boat.accessGate;
  return null;
}

function populateCqGateCertSelect(currentGate) {
  var sel = document.getElementById('bGateCert');
  sel.innerHTML = '<option value="">' + esc(s('boat.gateCertNone')) + '</option>';
  var selectedVal = _cqEncodeGateValue(currentGate);
  var anyLbl   = s('boat.gateCertAny');
  var orHigher = s('boat.gateCertOrHigher');
  (_cqCertDefs || []).forEach(function(def) {
    if (!def || !def.id) return;
    var defName = certDefName(def);
    var subs    = Array.isArray(def.subcats) ? def.subcats : [];
    if (!subs.length) {
      var v0 = _cqEncodeGateValue({ certId: def.id });
      sel.innerHTML += '<option value="' + esc(v0) + '"' + (v0 === selectedVal ? ' selected' : '') + '>'
        + esc(defName) + '</option>';
      return;
    }
    var vAny = _cqEncodeGateValue({ certId: def.id });
    sel.innerHTML += '<option value="' + esc(vAny) + '"' + (vAny === selectedVal ? ' selected' : '') + '>'
      + esc(defName + ' — ' + anyLbl) + '</option>';
    subs.forEach(function(sc) {
      if (!sc || !sc.key) return;
      var vExact = _cqEncodeGateValue({ certId: def.id, sub: sc.key });
      sel.innerHTML += '<option value="' + esc(vExact) + '"' + (vExact === selectedVal ? ' selected' : '') + '>'
        + esc(defName + ' — ' + certSubcatLabel(sc)) + '</option>';
    });
    subs.forEach(function(sc) {
      if (!sc || !sc.key || !sc.rank) return;
      var vRank = _cqEncodeGateValue({ certId: def.id, minRank: Number(sc.rank) });
      sel.innerHTML += '<option value="' + esc(vRank) + '"' + (vRank === selectedVal ? ' selected' : '') + '>'
        + esc(defName + ' — ' + certSubcatLabel(sc) + ' ' + orHigher) + '</option>';
    });
  });
}

function renderAllowlistChips() {
  var el = document.getElementById('bAllowlistChips');
  if (!_bmEditAllowlist.length) { el.innerHTML = ''; return; }
  el.innerHTML = _bmEditAllowlist.map(function(kt) {
    var m = _cqMembers.find(function(x) { return x.kennitala === kt; });
    var name = m ? memberDisplayName(m, _cqMembers) : kt;
    return '<span style="font-size:10px;padding:3px 8px;border-radius:12px;background:var(--surface);border:1px solid var(--border);color:var(--text);display:inline-flex;align-items:center;gap:4px">'
      + esc(name)
      + '<span style="cursor:pointer;color:var(--red);font-size:12px" data-cq-click="removeFromAllowlist" data-cq-arg="'+esc(kt)+'">&times;</span>'
      + '</span>';
  }).join('');
}

function searchAllowlistMember(q) {
  var drop = document.getElementById('bAllowlistSuggestions');
  if (!q || q.length < 2) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
  var ql = q.toLowerCase();
  var hits = _cqMembers.filter(function(m) { return (m.name || '').toLowerCase().includes(ql) && _bmEditAllowlist.indexOf(m.kennitala) === -1; }).slice(0, 8);
  if (!hits.length) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
  drop.innerHTML = hits.map(function(m) {
    return '<div class="suggest-item" style="padding:6px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)" '
      + 'data-cq-click="addToAllowlist" data-cq-arg="'+esc(m.kennitala)+'">' + esc(memberDisplayName(m, _cqMembers)) + '</div>';
  }).join('');
  drop.style.display = 'block';
}

function addToAllowlist(kt) {
  if (_bmEditAllowlist.indexOf(kt) === -1) _bmEditAllowlist.push(kt);
  document.getElementById('bAllowlistSearch').value = '';
  document.getElementById('bAllowlistSuggestions').innerHTML = '';
  document.getElementById('bAllowlistSuggestions').style.display = 'none';
  renderAllowlistChips();
}

function removeFromAllowlist(kt) {
  _bmEditAllowlist = _bmEditAllowlist.filter(function(k) { return k !== kt; });
  renderAllowlistChips();
}

function renderReservationList(boat) {
  var el = document.getElementById('bReservationList');
  var actEl = document.getElementById('bReservationActions');
  if (!boat || !boat.reservations || !boat.reservations.length) {
    el.innerHTML = '';
    actEl.innerHTML = '<button class="btn btn-secondary btn-sm" data-cq-click="showResForm">' + esc(s('boat.addReservation')) + '</button>';
    return;
  }
  el.innerHTML = boat.reservations.map(function(r) {
    return '<div style="font-size:11px;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">'
      + '<div><strong>' + esc(r.memberName) + '</strong> · ' + esc(r.startDate) + ' → ' + esc(r.endDate)
      + (r.note ? ' · <span style="color:var(--muted)">' + esc(r.note) + '</span>' : '') + '</div>'
      + '<button style="font-size:10px;background:none;border:none;color:var(--red);cursor:pointer" data-cq-click="removeBmResFromModal" data-cq-arg="'+esc(r.id)+'">&times;</button>'
      + '</div>';
  }).join('');
  actEl.innerHTML = '<button class="btn btn-secondary btn-sm" data-cq-click="showResForm">' + esc(s('boat.addReservation')) + '</button>';
}

function showResForm() {
  document.getElementById('bReservationForm').classList.remove('hidden');
}

function cancelResForm() {
  document.getElementById('bReservationForm').classList.add('hidden');
}

function searchResMember(q) {
  var drop = document.getElementById('bResMemberSuggestions');
  if (!q || q.length < 2) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
  var ql = q.toLowerCase();
  var hits = _cqMembers.filter(function(m) { return (m.name || '').toLowerCase().includes(ql); }).slice(0, 8);
  if (!hits.length) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
  drop.innerHTML = hits.map(function(m) {
    return '<div class="suggest-item" style="padding:6px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)" '
      + 'data-cq-click="selectResMember" data-cq-arg="'+esc(m.kennitala)+'" data-cq-arg2="'+esc(memberDisplayName(m, _cqMembers))+'">' + esc(memberDisplayName(m, _cqMembers)) + '</div>';
  }).join('');
  drop.style.display = 'block';
}

function selectResMember(kt, name) {
  document.getElementById('bResMemberKt').value = kt;
  document.getElementById('bResMemberSearch').value = '';
  document.getElementById('bResMemberName').textContent = name;
  document.getElementById('bResMemberSuggestions').innerHTML = '';
  document.getElementById('bResMemberSuggestions').style.display = 'none';
}

async function saveResFromModal() {
  var boatId = _editingBoatId;
  if (!boatId) return;
  var kt = document.getElementById('bResMemberKt').value;
  var name = document.getElementById('bResMemberName').textContent;
  var start = document.getElementById('bResStart').value;
  var end = document.getElementById('bResEnd').value;
  var note = document.getElementById('bResNote').value.trim();
  if (!kt || !name || !start || !end) { showToast(s('admin.memberDatesRequired'), 'err'); return; }
  try {
    var res = await apiPost('saveReservation', { boatId: boatId, memberKennitala: kt, memberName: name, startDate: start, endDate: end, note: note });
    var b = _boats.find(function(x) { return x.id === boatId; });
    if (b && res.boat) { b.reservations = res.boat.reservations; }
    cancelResForm();
    renderReservationList(b);
    showToast(s('boat.reservationSaved'), 'ok');
  } catch (e) { showToast(s('toast.error') + ': ' + e.message, 'err'); }
}

async function removeBmResFromModal(resId) {
  var boatId = _editingBoatId;
  if (!boatId) return;
  if (!(await ymConfirm(s('boat.removeReservation') + '?'))) return;
  try {
    var res = await apiPost('removeReservation', { boatId: boatId, reservationId: resId });
    var b = _boats.find(function(x) { return x.id === boatId; });
    if (b && res.boat) { b.reservations = res.boat.reservations; }
    renderReservationList(b);
    showToast(s('boat.reservationRemoved'), 'ok');
  } catch (e) { showToast(s('toast.error') + ': ' + e.message, 'err'); }
}

function openBoatModal(id) {
  _editingBoatId = id || null;
  var b = id ? _boats.find(function(x) { return x.id === id; }) : null;
  document.getElementById('boatModalTitle').textContent = b ? s('admin.boatModal.edit') : s('admin.boatModal.add');
  populateCqCategorySelect();
  document.getElementById('bName').value = b ? b.name : '';
  document.getElementById('bCategory').value = b ? (b.category || _boatCats[0]?.key || 'dinghy') : (_boatCats[0]?.key || 'dinghy');
  document.getElementById('bOOS').checked = b ? boolVal(b.oos) : false;
  document.getElementById('bOOSReason').value = b ? (b.oosReason || '') : '';
  document.getElementById('oosReasonField').classList.toggle('hidden', !b || !boolVal(b.oos));
  document.getElementById('bActive').checked = b ? boolVal(b.active) : true;
  document.getElementById('bDeleteBtn').classList.toggle('hidden', !b);
  document.getElementById('bRegNo').value = b ? (b.registrationNo || '') : '';
  document.getElementById('bLoa').value = b ? (b.loa || '') : '';
  document.getElementById('bTypeModel').value = b ? (b.typeModel || '') : '';
  populateCqDefaultPortSelect(b ? (b.defaultPortId || '') : '');
  // Ownership — default to private with current user as owner for new boats
  document.getElementById('bOwnership').value = b ? (b.ownership === 'private' ? 'private' : 'club') : 'private';
  document.getElementById('bOwnerId').value = b ? (b.ownerId || '') : user.kennitala;
  document.getElementById('bOwnerSearch').value = '';
  document.getElementById('bOwnerName').textContent = b && b.ownerName ? b.ownerName : (!b ? user.name : '');
  document.getElementById('bOwnerSuggestions').innerHTML = '';
  // Access mode
  document.getElementById('bAccessMode').value = b && b.accessMode === 'controlled' ? 'controlled' : 'free';
  populateCqGateCertSelect(_cqCurrentGateFor(b));
  _bmEditAllowlist = b && Array.isArray(b.accessAllowlist) ? b.accessAllowlist.slice() : [];
  renderAllowlistChips();
  updateAccessFields();
  // Slot scheduling
  document.getElementById('bSlotScheduling').checked = b && boolVal(b.slotSchedulingEnabled);
  document.getElementById('bAvailOutside').checked = b ? (b.availableOutsideSlots === undefined || b.availableOutsideSlots === null || boolVal(b.availableOutsideSlots)) : true;
  updateSlotFields();
  // Reservations
  document.getElementById('bReservationForm').classList.add('hidden');
  document.getElementById('bResMemberKt').value = '';
  document.getElementById('bResMemberSearch').value = '';
  document.getElementById('bResMemberName').textContent = '';
  document.getElementById('bResStart').value = '';
  document.getElementById('bResEnd').value = '';
  document.getElementById('bResNote').value = '';
  renderReservationList(b);
  updateOwnershipFields();
  updateBoatModalFields();
  applyStrings(document.getElementById('boatModal'));
  openModal('boatModal');
}

async function saveBoat() {
  var name = document.getElementById('bName').value.trim();
  if (!name) { showToast(s('admin.nameRequired'), 'err'); return; }

  var id = _editingBoatId || ('boat_' + Date.now().toString(36));
  var cat = document.getElementById('bCategory').value;
  var ownershipVal = document.getElementById('bOwnership').value;
  var accessModeVal = document.getElementById('bAccessMode').value;
  var payload = {
    id: id, name: name,
    category: cat,
    defaultPortId: document.getElementById('bDefaultPortId').value || '',
    oos: document.getElementById('bOOS').checked,
    oosReason: document.getElementById('bOOSReason').value.trim(),
    active: document.getElementById('bActive').checked,
    registrationNo: document.getElementById('bRegNo').value.trim(),
    typeModel: document.getElementById('bTypeModel').value.trim(),
    loa: parseFloat(document.getElementById('bLoa').value) || '',
    ownership: ownershipVal,
    ownerId: ownershipVal === 'private' ? (document.getElementById('bOwnerId').value || '') : '',
    ownerName: ownershipVal === 'private' ? (document.getElementById('bOwnerName').textContent || '') : '',
    accessMode: accessModeVal,
    accessGate: accessModeVal === 'controlled' ? _cqDecodeGateValue(document.getElementById('bGateCert').value) : null,
    accessGateCert: accessModeVal === 'controlled' ? (function() {
      var _g = _cqDecodeGateValue(document.getElementById('bGateCert').value);
      return _g ? (_g.sub || _g.certId) : '';
    })() : '',
    accessAllowlist: accessModeVal === 'controlled' ? _bmEditAllowlist.slice() : [],
    slotSchedulingEnabled: accessModeVal === 'controlled' && document.getElementById('bSlotScheduling').checked,
    availableOutsideSlots: accessModeVal === 'controlled' && document.getElementById('bSlotScheduling').checked ? document.getElementById('bAvailOutside').checked : true
  };

  var idx = _boats.findIndex(function(x) { return x.id === id; });
  if (idx >= 0) {
    payload.reservations = _boats[idx].reservations || [];
    _boats[idx] = Object.assign({}, _boats[idx], payload);
  } else {
    payload.reservations = [];
    _boats.push(payload);
  }

  try {
    await apiPost('saveConfig', { boats: _boats });
    closeModal('boatModal');
    renderBoats();
    showToast(s('toast.saved'), 'ok');
  } catch (e) { showToast(s('toast.saveFailed') + ': ' + e.message, 'err'); }
}

async function deleteBoat() {
  var id = _editingBoatId;
  if (!id) return;
  if (!(await ymConfirm(s('admin.confirmDeleteBoat')))) return;
  _boats = _boats.map(function(b) { return b.id === id ? Object.assign({}, b, { active: false }) : b; });
  try {
    await apiPost('saveConfig', { boats: _boats });
    renderBoats();
    closeModal('boatModal');
    showToast(s('toast.saved'), 'ok');
  } catch (e) { showToast(s('toast.saveFailed') + ': ' + e.message, 'err'); }
}

(function () {
  if (typeof document === 'undefined' || document._cqListeners) return;
  document._cqListeners = true;
  document.addEventListener('click', function (e) {
    var cs = e.target.closest('[data-cq-close-self]');
    if (cs && e.target === cs) { closeModal(cs.id); return; }
    var cl = e.target.closest('[data-cq-close]');
    if (cl) { closeModal(cl.dataset.cqClose); return; }
    var c = e.target.closest('[data-cq-click]');
    if (c && typeof window[c.dataset.cqClick] === 'function') {
      var a = [c.dataset.cqArg, c.dataset.cqArg2].filter(function (v) { return v != null; });
      window[c.dataset.cqClick].apply(null, a);
    }
  });
  document.addEventListener('change', function (e) {
    var c = e.target.closest('[data-cq-change]');
    if (c && typeof window[c.dataset.cqChange] === 'function') window[c.dataset.cqChange]();
  });
  document.addEventListener('input', function (e) {
    var iv = e.target.closest('[data-cq-input-val]');
    if (iv && typeof window[iv.dataset.cqInputVal] === 'function') window[iv.dataset.cqInputVal](iv.value);
  });
})();
