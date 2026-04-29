// ═══════════════════════════════════════════════════════════════════════════════
// Logbook UI — trip list, filters, confirmations, photo/track upload, lightbox
// ═══════════════════════════════════════════════════════════════════════════════
//
// Trip-card rendering was extracted to shared/tripcard.js — that file must
// load before this one in any portal that uses the logbook.

// ── Filters ───────────────────────────────────────────────────────────────────

var _filteredTrips = [];
var _renderedCount = 0;
var _tripListObserver = null;
var _TRIP_BATCH = 40;
var _tripFilter = null;  // shared/list-filter.js controller — built in buildFilters()

// O(1) lookup indexes rebuilt whenever allBoats / allMembers reload. Avoids
// the O(n·m) scans that used to happen when tripCard / stats / filters ran
// _boat(t.boatId) inside per-trip loops (500 trips ×
// 50 boats = 25,000 scans per render). Callers use _boat(id) / _member(kt).
var _boatById = new Map();
var _memberByKt = new Map();
function _boat(id)   { return id == null ? null : (_boatById.get(String(id))     || null); }
function _member(kt) { return kt == null ? null : (_memberByKt.get(String(kt))   || null); }
function _rebuildBoatIndex()   { _boatById   = new Map(allBoats.map(b => [String(b.id), b])); }
function _rebuildMemberIndex() { _memberByKt = new Map(allMembers.map(m => [String(m.kennitala), m])); }

// Captain overrides this via its own applyFilter() shim, so we keep a stable name.
function applyFilter(){ if (_tripFilter) _tripFilter.refresh(); }

// ── Filter sheet (slide-down) ─────────────────────────────────────────────────
// Each portal's buildFilters() registers its controller + field config here so
// the shared toggle / chip / pill helpers can drive both pages without each
// duplicating the wiring. Fields: [{ key, elId?, kind:'select'|'pill'|'search' }].
var _fsCtl = null;
var _fsFields = [];

function _fsRegister(controller, fields) {
  _fsCtl = controller;
  _fsFields = fields || [];
  _fsRenderChips();
  _fsSyncPills();
}

function toggleFilterSheet() {
  var body = document.getElementById('fsBody');
  var btn  = document.getElementById('fsToggle');
  if (!body || !btn) return;
  var open = body.classList.toggle('open');
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setFilterPill(key, val) {
  if (!_fsCtl) return;
  document.querySelectorAll('[data-fs-pill="' + key + '"]').forEach(function (p) {
    p.classList.toggle('active', p.dataset.fsVal === val);
  });
  _fsCtl.setFilter(key, val);
}

function _fsSyncPills() {
  if (!_fsCtl) return;
  var st = _fsCtl.getState();
  document.querySelectorAll('[data-fs-pill]').forEach(function (p) {
    var k = p.dataset.fsPill;
    p.classList.toggle('active', String(st[k] || '') === p.dataset.fsVal);
  });
}

function _fsLabelForField(f, val) {
  if (f.kind === 'select') {
    var el = document.getElementById(f.elId);
    if (!el) return val;
    var opt = el.querySelector('option[value="' + (window.CSS && CSS.escape ? CSS.escape(val) : val) + '"]');
    return opt ? (opt.textContent || val) : val;
  }
  if (f.kind === 'pill') {
    var pill = document.querySelector('[data-fs-pill="' + f.key + '"][data-fs-val="' + val + '"]');
    return pill ? (pill.textContent || val).trim() : val;
  }
  return val;
}

function _fsRenderChips() {
  var el = document.getElementById('fsChips');
  if (!el) return;
  var countEl = document.getElementById('filterCount');
  // Clear previous chips while preserving the count node.
  Array.prototype.slice.call(el.querySelectorAll('.fs-chip,.fs-clear')).forEach(function (c) { c.remove(); });
  var active = 0;
  if (_fsCtl) {
    var st = _fsCtl.getState();
    _fsFields.forEach(function (f) {
      var v = st[f.key];
      if (!v) return;
      active++;
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fs-chip';
      chip.dataset.fsClear = f.key;
      chip.innerHTML = '<span>' + esc(_fsLabelForField(f, v)) + '</span><span class="fs-x" aria-hidden="true">×</span>';
      el.insertBefore(chip, countEl);
    });
    if (st.search) {
      active++;
      var sChip = document.createElement('button');
      sChip.type = 'button';
      sChip.className = 'fs-chip';
      sChip.dataset.fsClear = '__search';
      sChip.innerHTML = '<span>"' + esc(st.search) + '"</span><span class="fs-x" aria-hidden="true">×</span>';
      el.insertBefore(sChip, countEl);
    }
    if (active > 1) {
      var clr = document.createElement('button');
      clr.type = 'button';
      clr.className = 'fs-clear';
      clr.dataset.fsClearAll = '1';
      clr.textContent = s('logbook.clearAll');
      el.insertBefore(clr, countEl);
    }
  }
  // Toggle button accent + count badge
  var tg = document.getElementById('fsToggle');
  var ct = document.getElementById('fsCount');
  if (tg) tg.classList.toggle('has-active', active > 0);
  if (ct) {
    if (active > 0) { ct.textContent = String(active); ct.style.display = ''; }
    else { ct.style.display = 'none'; }
  }
}

function _fsClearChip(key) {
  if (!_fsCtl) return;
  if (key === '__search') {
    var inp = document.getElementById('fText');
    if (inp) { inp.value = ''; }
    _fsCtl.setSearch('');
    // setSearch is debounced; the listFilter's render will refresh chips
    // shortly. Render once now too so the chip disappears immediately.
    setTimeout(_fsRenderChips, 0);
    return;
  }
  var f = _fsFields.find(function (x) { return x.key === key; });
  if (!f) return;
  if (f.kind === 'pill') {
    setFilterPill(key, '');
  } else if (f.elId) {
    var sel = document.getElementById(f.elId);
    if (sel) sel.value = '';
    _fsCtl.setFilter(key, '');
  }
}

function _fsClearAll() {
  if (!_fsCtl) return;
  var patch = {};
  _fsFields.forEach(function (f) {
    patch[f.key] = '';
    if (f.kind === 'pill') {
      document.querySelectorAll('[data-fs-pill="' + f.key + '"]').forEach(function (p) {
        p.classList.toggle('active', p.dataset.fsVal === '');
      });
    } else if (f.elId) {
      var sel = document.getElementById(f.elId);
      if (sel) sel.value = '';
    }
  });
  patch.search = '';
  var inp = document.getElementById('fText');
  if (inp) inp.value = '';
  _fsCtl.setFilters(patch);
}

// Document-level click delegation for chip clears (lives at document so it
// covers both portals; guarded so it stays idempotent).
(function () {
  if (typeof document === 'undefined' || document._fsListeners) return;
  document._fsListeners = true;
  document.addEventListener('click', function (e) {
    var ca = e.target.closest('[data-fs-clear-all]');
    if (ca) { _fsClearAll(); return; }
    var c = e.target.closest('[data-fs-clear]');
    if (c) { _fsClearChip(c.dataset.fsClear); return; }
  });
})();

function _renderTripBatch(el) {
  var end = Math.min(_renderedCount + _TRIP_BATCH, _filteredTrips.length);
  var frag = document.createDocumentFragment();
  for (var i = _renderedCount; i < end; i++) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = tripCard(_filteredTrips[i]);
    while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
  }
  // Remove old sentinel before appending new batch
  var oldSentinel = el.querySelector('.trip-scroll-sentinel');
  if (oldSentinel) oldSentinel.remove();
  el.appendChild(frag);
  _renderedCount = end;
  // Add sentinel if more items remain
  if (_renderedCount < _filteredTrips.length) {
    var sentinel = document.createElement('div');
    sentinel.className = 'trip-scroll-sentinel';
    sentinel.style.height = '1px';
    el.appendChild(sentinel);
  }
}

function _setupTripScrollObserver(el) {
  if (_tripListObserver) _tripListObserver.disconnect();
  if (!('IntersectionObserver' in window)) return;
  _tripListObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && _renderedCount < _filteredTrips.length) {
      _renderTripBatch(el);
    }
  }, { rootMargin: '200px' });
  var sentinel = el.querySelector('.trip-scroll-sentinel');
  if (sentinel) _tripListObserver.observe(sentinel);
}

function buildFilters(){
  const years=[...new Set(myTrips.map(t=>sstr(t.date).slice(0,4)).filter(Boolean))].sort().reverse();
  const yrSel=document.getElementById('fYear');
  years.forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y;yrSel.appendChild(o);});
  const thisYear=String(new Date().getFullYear());
  if(years.includes(thisYear)) yrSel.value=thisYear;

  const cats=[...new Set(myTrips.map(t=>(_boat(t.boatId)?.category)||t.boatCategory||'').filter(Boolean))].sort();
  const cSel=document.getElementById('fCat');
  cats.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=boatEmoji(c.toLowerCase())+' '+c;cSel.appendChild(o);});

  _tripFilter = createListFilter({
    source:  function() { return myTrips; },
    filters: { yr: yrSel.value, cat: '', role: '', wind: '', verified: '' },
    predicate: function(t, f) {
      if (f.yr && !(t.date || '').startsWith(f.yr)) return false;
      if (f.cat) {
        const tCat = ((_boat(t.boatId)?.category) || t.boatCategory || '').toLowerCase();
        if (tCat !== f.cat.toLowerCase()) return false;
      }
      if (f.role === 'skipper' && t.role === 'crew') return false;
      if (f.role === 'crew'    && t.role !== 'crew') return false;
      if (f.role === 'helm'    && !(t.helm    && t.helm    !== 'false')) return false;
      if (f.role === 'student' && !(t.student && t.student !== 'false')) return false;
      if (f.role === 'guest') {
        const _m = _member(t.kennitala);
        if (!_m || _m.role !== 'guest') return false;
      }
      if (f.wind) {
        const b = parseInt(t.beaufort) || 0;
        if (f.wind === 'gt4'  && b <= 4) return false;
        if (f.wind === 'lte4' && b >  4) return false;
        if (['calm','light','moderate','strong'].includes(f.wind) && bftGroup(b) !== f.wind) return false;
      }
      if (f.verified) {
        const v = t.verified && t.verified !== 'false';
        if (f.verified === 'yes' && !v) return false;
        if (f.verified === 'no'  &&  v) return false;
      }
      if (f.search) {
        const hay = [t.boatName, t.locationName, t.date, t.beaufort, t.windDir, t.notes, t.skipperNote, t.boatCategory].join(' ').toLowerCase();
        if (!hay.includes(f.search.toLowerCase().trim())) return false;
      }
      return true;
    },
    render: function(filtered) {
      // Tear down stale thumb maps before re-rendering; batched render below.
      Object.keys(_thumbMaps).forEach(k => { try { _thumbMaps[k].remove(); } catch(e){} delete _thumbMaps[k]; });
      _filteredTrips = filtered;
      _renderedCount = 0;
      const el = document.getElementById('tripList');
      if (!filtered.length) {
        el.innerHTML = '<div class="empty-note">' + s('logbook.noFilter') + '</div>';
      } else {
        el.innerHTML = '';
        _renderTripBatch(el);
        _setupTripScrollObserver(el);
      }
      document.getElementById('filterCount').textContent = filtered.length + ' / ' + myTrips.length;
      _fsRenderChips();
    },
  }).autoWire({
    fields: { fYear: 'yr', fCat: 'cat', fRole: 'role', fWind: 'wind' },
    search: 'fText',
  });

  _fsRegister(_tripFilter, [
    { key: 'yr',       elId: 'fYear', kind: 'select' },
    { key: 'cat',      elId: 'fCat',  kind: 'select' },
    { key: 'role',     elId: 'fRole', kind: 'select' },
    { key: 'wind',     elId: 'fWind', kind: 'select' },
    { key: 'verified',                kind: 'pill'   },
  ]);
}

// ── Log manually modal ────────────────────────────────────────────────────────
let allClubTrips = [], clubTripsOffset = 0, _clubTripsLoadedAt = 0;
const CLUB_PAGE = 10;
const CLUB_TRIPS_TTL = 30000; // 30s cache

// ── Trip card toggle (init maps on first expand) ─────────────────────────────
// Clicking the card header toggles open/close — the little chevron at the
// right of the header rotates to cue the state. No separate close-X button.
function openTripCard(card) {
  if (card.classList.contains('open')) { card.classList.remove('open'); return; }
  card.classList.add('open');
  // Defer so the expand section is visible before Leaflet measures it
  requestAnimationFrame(() => {
    card.querySelectorAll('.track-map-thumb').forEach(el => {
      if (!_thumbMaps[el.id]) initSingleThumbMap(el);
    });
  });
}
// Close open trip cards when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.trip-card')) {
    document.querySelectorAll('.trip-card.open').forEach(c => c.classList.remove('open'));
  }
});
function toggleTripDetail(btn) {
  const detail = btn.parentElement.querySelector('.trip-detailed');
  if (!detail) return;
  detail.classList.toggle('open');
  btn.textContent = detail.classList.contains('open') ? s('logbook.showLess') : s('logbook.showMore');
}
function toggleSectionDetail(hdr) {
  const detail = hdr.parentElement.querySelector('.exp-section-detail');
  if (!detail) return;
  detail.classList.toggle('open');
  hdr.classList.toggle('expanded');
  // Init any track maps that become visible
  if (detail.classList.contains('open')) {
    requestAnimationFrame(() => {
      detail.querySelectorAll('.track-map-thumb').forEach(el => {
        if (!_thumbMaps[el.id]) initSingleThumbMap(el);
      });
    });
  }
}

// ── Lazy Leaflet loader ──────────────────────────────────────────────────────
var _leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise(function(resolve, reject) {
    // CSS
    if (!document.querySelector('link[href*="leaflet"]')) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      css.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
      css.crossOrigin = 'anonymous';
      document.head.appendChild(css);
    }
    // JS
    var s1 = document.createElement('script');
    s1.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s1.integrity = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH';
    s1.crossOrigin = 'anonymous';
    s1.onload = function() {
      var s2 = document.createElement('script');
      s2.src = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js';
      s2.integrity = 'sha384-mFKkGiGvT5vo1fEyGCD3hshDdKmW3wzXW/x+fWriYJArD0R3gawT6lMvLboM22c0';
      s2.crossOrigin = 'anonymous';
      s2.onload = resolve;
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    s1.onerror = reject;
    document.head.appendChild(s1);
  });
  return _leafletPromise;
}

// ── Track map rendering ──────────────────────────────────────────────────────
const _thumbMaps = {};  // id → Leaflet map instance (thumbnails)
let   _fullMap   = null;

function addSeaLayers(map) {
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; CartoDB' }).addTo(map);
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxNativeZoom:17, maxZoom:19, opacity:0.9 }).addTo(map);
}

async function initSingleThumbMap(el) {
  const id = el.id;
  if (_thumbMaps[id]) return;
  let pts;
  try { pts = JSON.parse(el.dataset.track); } catch(e) { return; }
  if (!pts || pts.length < 2) return;
  await loadLeaflet();
  const map = L.map(el, { zoomControl:false, attributionControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, touchZoom:false, boxZoom:false, keyboard:false });
  addSeaLayers(map);
  const latlngs = pts.map(p => [p.lat, p.lng]);
  L.polyline(latlngs, { color:'#d4af37', weight:2.5, opacity:.9 }).addTo(map);
  L.circleMarker(latlngs[0], { radius:4, color:'#27ae60', fillColor:'#27ae60', fillOpacity:1, weight:0 }).addTo(map);
  L.circleMarker(latlngs[latlngs.length-1], { radius:4, color:'#e74c3c', fillColor:'#e74c3c', fillOpacity:1, weight:0 }).addTo(map);
  map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
  _thumbMaps[id] = map;
}

async function openMapModal(tripId) {
  const trip = myTrips.find(t => t.id === tripId);
  if (!trip) return;
  let pts;
  try { pts = JSON.parse(trip.trackSimplified); } catch(e) { return; }
  if (!pts || pts.length < 2) return;

  openModal('mapModal');
  document.body.style.overflow = 'hidden';
  document.getElementById('mapModalTitle').textContent =
    (trip.boatName || '') + ' — ' + (trip.date || '') + (trip.distanceNm ? ' · ' + trip.distanceNm + ' nm' : '');

  // Destroy previous full map
  if (_fullMap) { _fullMap.remove(); _fullMap = null; }
  const container = document.getElementById('mapModalBody');
  container.innerHTML = '';
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;inset:0';
  container.appendChild(div);

  await loadLeaflet();
  _fullMap = L.map(div, { zoomControl: true });
  addSeaLayers(_fullMap);
  const latlngs = pts.map(p => [p.lat, p.lng]);
  L.polyline(latlngs, { color:'#d4af37', weight: 3, opacity: .9 }).addTo(_fullMap);
  L.circleMarker(latlngs[0], { radius: 6, color:'#27ae60', fillColor:'#27ae60', fillOpacity:1, weight:0 }).bindPopup(s('logbook.departure')).addTo(_fullMap);
  L.circleMarker(latlngs[latlngs.length-1], { radius: 6, color:'#e74c3c', fillColor:'#e74c3c', fillOpacity:1, weight:0 }).bindPopup(s('logbook.arrival')).addTo(_fullMap);
  _fullMap.fitBounds(L.latLngBounds(latlngs).pad(0.1));
}

function closeMapModal() {
  closeModal('mapModal');
  document.body.style.overflow = '';
  if (_fullMap) { _fullMap.remove(); _fullMap = null; }
}

// ── Photo lightbox ───────────────────────────────────────────────────────────
let _lbTripId = null, _lbIndex = 0, _lbUrls = [];

function openLightboxUrl(tripId, photoUrl) {
  const trip = myTrips.find(t => t.id === tripId);
  if (!trip) return;
  try { _lbUrls = JSON.parse(trip.photoUrls || '[]'); } catch(e) { _lbUrls = []; }
  const idx = _lbUrls.indexOf(photoUrl);
  openLightbox(tripId, idx >= 0 ? idx : 0);
  return;
}

function openLightbox(tripId, index) {
  const trip = myTrips.find(t => t.id === tripId);
  if (!trip) return;
  try { _lbUrls = JSON.parse(trip.photoUrls || '[]'); } catch(e) { _lbUrls = []; }
  if (!_lbUrls.length) return;
  _lbTripId = tripId;
  _lbIndex = Math.max(0, Math.min(index, _lbUrls.length - 1));
  showLightboxImage();
  document.getElementById('lightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function showLightboxImage() {
  document.getElementById('lightboxImg').src = _lbUrls[_lbIndex];
  // Show/hide nav buttons
  document.querySelector('.lightbox-nav.prev').style.display = _lbUrls.length > 1 ? '' : 'none';
  document.querySelector('.lightbox-nav.next').style.display = _lbUrls.length > 1 ? '' : 'none';
}

function lightboxNav(dir) {
  _lbIndex = (_lbIndex + dir + _lbUrls.length) % _lbUrls.length;
  showLightboxImage();
}

function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
  document.body.style.overflow = '';
}

// Close lightbox / map on Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeLightbox(); closeMapModal(); }
  if (e.key === 'ArrowLeft' && !document.getElementById('lightbox').classList.contains('hidden')) lightboxNav(-1);
  if (e.key === 'ArrowRight' && !document.getElementById('lightbox').classList.contains('hidden')) lightboxNav(1);
});

// ── Delete trip files ────────────────────────────────────────────────────────
async function toggleHelm(tripId, checked) {
  try {
    await apiPost('setHelm', { tripId, helm: checked });
    // Update local data
    const t = myTrips.find(x => x.id === tripId);
    if (t) t.helm = checked;
    applyFilter();
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

async function deleteTripTrack(tripId) {
  if (!await ymConfirm(s('logbook.deleteTrack'))) return;
  try {
    await apiPost('deleteTripFile', { tripId, kennitala: user.kennitala, fileType: 'track' });
    const t = myTrips.find(x => x.id === tripId);
    if (t) { t.trackFileUrl = ''; t.trackSimplified = ''; t.trackSource = ''; }
    applyFilter();
    showToast(s('logbook.trackDeleted'), 'success');
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

async function deleteTripPhoto(tripId, photoUrl) {
  if (!await ymConfirm(s('logbook.deletePhoto'))) return;
  try {
    await apiPost('deleteTripFile', { tripId, kennitala: user.kennitala, fileType: 'photo', photoUrl });
    const t = myTrips.find(x => x.id === tripId);
    if (t) {
      let urls = []; try { urls = JSON.parse(t.photoUrls || '[]'); } catch(e) {}
      urls = urls.filter(u => u !== photoUrl);
      t.photoUrls = urls.length ? JSON.stringify(urls) : '';
      // Clean up photo meta
      let meta = {}; try { if (t.photoMeta) meta = JSON.parse(t.photoMeta); } catch(e) {}
      delete meta[photoUrl];
      t.photoMeta = Object.keys(meta).length ? JSON.stringify(meta) : '';
      await apiPost('saveTrip', { id: tripId, photoMeta: t.photoMeta });
    }
    applyFilter();
    showToast(s('logbook.photoDeleted'), 'success');
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

// ── Share tokens ─────────────────────────────────────────────────────────────
async function reload(){
  try{
    const res=await apiGet('getTrips',{limit:500});
    allTrips=res.trips||[];
    myTrips=allTrips
      .filter(t=>t.kennitala===user.kennitala)
      .sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    renderStats();
    buildFilters();
    applyFilter();
  }catch(e){
    document.getElementById('tripList').innerHTML=
      '<div class="empty-note text-red">'+s('logbook.loadFailed',{msg:esc(e.message)})+'</div>';
  }
}

(async function init(){
  if (window._logbookSkipInit) return;
  applyStrings();
  try{
    const [tripsRes,cfgRes,membersRes]=await Promise.all([
      window._earlyTrips || apiGet('getTrips',{limit:500}),
      window._earlyConfig || apiGet('getConfig'),
      window._earlyMembers || apiGet('getMembers'),
    ]);
    allTrips=tripsRes.trips||[];
    myTrips=allTrips
      .filter(t=>t.kennitala===user.kennitala)
      .sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    // Load boats + locations + members for manual form
    const boats=cfgRes.boats||[];
    const locs =cfgRes.locations||[];
    allBoats=boats.filter(b=>!b.oos&&b.oos!=='true');
    allLocs =locs;
    allMembers=(membersRes.members||[]).filter(m=>m.active!==false&&m.active!=='false');
    _rebuildBoatIndex();
    _rebuildMemberIndex();
    registerBoatCats(cfgRes.boatCategories||[]);
    renderStats();
    if (typeof initMemberHeatmap === 'function') initMemberHeatmap();
    buildFilters();
    applyFilter();
    renderCerts();
    loadShareTokens();
    warmContainer();
  }catch(e){
    document.getElementById('tripList').innerHTML=
      '<div class="empty-note text-red">'+s('logbook.loadFailed2',{msg:esc(e.message)})+'</div>';
  }
})();

// ── Edit trip (skipper only) ────────────────────────────────────────────────


// Delegated handlers for data-trip-* attrs on rendered logbook DOM
// (replaces inline onclick/onerror in the trip-card / confirmation /
// share-token templates above for CSP-strict pages).
(function () {
  if (typeof document === 'undefined' || document._tripClickListener) return;
  document._tripClickListener = true;

  var SINGLE = {
    'delete-track':     'deleteTripTrack',
    'open-map':         'openMapModal',
    'edit-trip':        'openEditTrip',
    'upload-track':     'inlineUploadTrack',
    'upload-photos':    'inlineUploadPhotos',
    'request-validate': 'requestTripValidation',
    'copy-share':       'copyShareLink',
    'revoke-share':     'revokeShareToken',
    'reject-conf':      'promptRejectConf',
    'ack-rej':          'ackCrewRejection',
  };
  var TWO = {
    'delete-photo':  'deleteTripPhoto',
    'open-lightbox': 'openLightboxUrl',
    'edit-note':     'editNote',
    'respond-conf':  'respondConf',
  };

  document.addEventListener('click', function (e) {
    // Check for an actionable element first. `.trip-expand` carries
    // `data-trip-nobubble` so stray clicks inside don't close the card, but
    // that attribute also covers every nested action button + section header —
    // so the nobubble guard has to run AFTER we've given data-trip-action a
    // chance to match, otherwise "Edit trip", "Add GPS", "Request verification"
    // and the collapsible weather / trip-details sections all silently die.
    var el = e.target.closest('[data-trip-action]');
    if (!el) {
      if (e.target.closest('[data-trip-nobubble]')) { e.stopPropagation(); }
      return;
    }
    var action = el.dataset.tripAction;
    e.stopPropagation();
    if (action === 'open-card')      { openTripCard(el.parentElement); return; }
    if (action === 'toggle-section') { toggleSectionDetail(el); return; }
    var id = el.dataset.tripId;
    if (SINGLE[action] && typeof window[SINGLE[action]] === 'function') {
      window[SINGLE[action]](id);
      return;
    }
    if (TWO[action] && typeof window[TWO[action]] === 'function') {
      window[TWO[action]](id, el.dataset.tripArg);
    }
  });

  // image onerror doesn't bubble, so listen in capture phase
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (img && img.matches && img.matches('[data-trip-hide-on-err]') && img.parentElement) {
      img.parentElement.style.display = 'none';
    }
  }, true);
})();
