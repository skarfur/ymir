// ═══════════════════════════════════════════════════════════════════════════════
// logbook-edit.js — Edit-trip modal + inline photo/track uploads
// Extracted from shared/logbook.js. All functions stay global via the existing
// non-module script pattern. Callers (captain/index.html, logbook/index.html)
// must include this file alongside shared/logbook.js.
//
// The two modals (#editTripModal, #photoUploadModal) and their delegated
// data-lb-* click listener are auto-injected at script load if missing — so
// host portals don't need to hand-copy the markup. The logbook portal already
// ships its own copy in HTML; the inject is idempotent so it's a no-op there.
// ═══════════════════════════════════════════════════════════════════════════════

function openEditTrip(tripId) {
  const t = myTrips.find(x => x.id === tripId);
  if (!t) return;
  // Only skipper+owner can edit
  if (t.role === 'crew' || String(t.kennitala) !== String(user.kennitala)) {
    showToast(s('logbook.onlySkipper'), 'err');
    return;
  }
  document.getElementById('etId').value = t.id;
  document.getElementById('etDate').value = t.date || '';
  // Legacy logbook rows may have timeOut/timeIn stored as "1700" or as Sheets
  // serial-time numbers; coerce to HH:MM so <input type=time> accepts them.
  document.getElementById('etTimeOut').value = coerceHHMM(t.timeOut);
  document.getElementById('etTimeIn').value  = coerceHHMM(t.timeIn);
  document.getElementById('etCrew').value = t.crew || 1;
  document.getElementById('etDistanceNm').value = t.distanceNm || '';
  document.getElementById('etDeparturePort').value = t.departurePort || '';
  document.getElementById('etArrivalPort').value = t.arrivalPort || '';
  document.getElementById('etSkipperNote').value = t.skipperNote || '';
  // Populate boat select
  const boatSel = document.getElementById('etBoat');
  boatSel.innerHTML = '<option value="">' + s('logbook.selectBoat') + '</option>';
  allBoats.forEach(b => {
    const o = document.createElement('option');
    o.value = b.id; o.textContent = b.name;
    if (b.id === t.boatId) o.selected = true;
    boatSel.appendChild(o);
  });
  // Populate location select
  const locSel = document.getElementById('etLocation');
  locSel.innerHTML = '<option value="">' + s('logbook.selectLocation') + '</option>';
  allLocs.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id; o.textContent = l.name;
    if (l.id === t.locationId) o.selected = true;
    locSel.appendChild(o);
  });
  // Weather
  let wx = null; try { wx = t.wxSnapshot ? JSON.parse(t.wxSnapshot) : null; } catch(e) {}
  // Display wind in user's preferred unit; parse range values to midpoint
  const etWsRaw = wx?.ws;
  const etWsMs = etWsRaw != null ? parseWsValue(etWsRaw) : null;
  document.getElementById('etWindMs').value = etWsMs != null ? convertWind(etWsMs, _mWindUnit) : '';
  document.getElementById('etWindLabel').textContent = s('logbook.windLabel',{unit:windUnitLabel(_mWindUnit)});
  document.getElementById('etWindDir').value = wx?.dir || t.windDir || '';
  document.getElementById('etBft').value = wx?.bft ?? t.beaufort ?? '';
  // Additional weather fields
  const etGustMs = wx?.wg != null ? parseWsValue(wx.wg) : null;
  document.getElementById('etWindGust').value = etGustMs != null ? convertWind(etGustMs, _mWindUnit) : '';
  document.getElementById('etGustLabel').textContent = s('logbook.gustsLabel',{unit:windUnitLabel(_mWindUnit)});
  document.getElementById('etAirTemp').value = wx?.tc != null ? Math.round(wx.tc) : '';
  document.getElementById('etSeaTemp').value = wx?.sst != null ? wx.sst.toFixed(1) : '';
  document.getElementById('etWave').value = wx?.wv != null ? wx.wv.toFixed(1) : '';
  document.getElementById('etPressure').value = wx?.pres != null ? Math.round(wx.pres) : '';
  document.getElementById('etErr').style.display = 'none';
  document.getElementById('editTripTitle').textContent = s('logbook.editTripTitle');
  document.getElementById('etSubmitBtn').textContent = s('logbook.saveChanges');
  openModal('editTripModal');
}

function closeEditTrip() {
  closeModal('editTripModal');
}

async function submitEditTrip() {
  const tripId = document.getElementById('etId').value;
  const t = myTrips.find(x => x.id === tripId);
  if (!t) return;
  const errEl = document.getElementById('etErr');
  errEl.style.display = 'none';
  const date = document.getElementById('etDate').value;
  const boatId = document.getElementById('etBoat').value;
  const boat = _boat(boatId);
  const boatName = boat?.name || '';
  const boatCategory = boat?.category || '';
  const locId = document.getElementById('etLocation').value;
  const loc = allLocs.find(l => l.id === locId);
  const locName = loc?.name || '';
  const timeOut = document.getElementById('etTimeOut').value.trim();
  const timeIn = document.getElementById('etTimeIn').value.trim();
  const crew = parseInt(document.getElementById('etCrew').value) || 1;
  const distanceNm = document.getElementById('etDistanceNm').value.trim();
  const depPort = document.getElementById('etDeparturePort').value.trim();
  let arrPort = document.getElementById('etArrivalPort').value.trim();
  if (!arrPort && depPort) arrPort = depPort;
  const skipperNote = document.getElementById('etSkipperNote').value.trim();
  // Weather — convert from user's unit to m/s
  const windRaw = document.getElementById('etWindMs').value.trim();
  const windMsVal = windRaw ? convertToMs(parseFloat(windRaw), _mWindUnit) : null;
  const windDir = document.getElementById('etWindDir').value;
  const bft = document.getElementById('etBft').value;
  // Validate
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (timeOut && !timeRe.test(timeOut)) { errEl.textContent = s('logbook.errDepartureTime'); errEl.style.display = ''; return; }
  if (timeIn && !timeRe.test(timeIn)) { errEl.textContent = s('logbook.errReturnTime'); errEl.style.display = ''; return; }
  if (!date) { errEl.textContent = s('logbook.errDate'); errEl.style.display = ''; return; }
  // Compute hours
  let hoursDecimal = 0;
  if (timeOut && timeIn) {
    const [oh, om] = timeOut.split(':').map(Number);
    const [ih, im] = timeIn.split(':').map(Number);
    let mins = (ih * 60 + im) - (oh * 60 + om);
    if (mins < 0) mins += 1440;
    hoursDecimal = +(mins / 60).toFixed(2);
  }
  // Additional weather fields
  const gustRaw = document.getElementById('etWindGust').value.trim();
  const gustMsVal = gustRaw ? convertToMs(parseFloat(gustRaw), _mWindUnit) : null;
  const airTemp = document.getElementById('etAirTemp').value.trim();
  const seaTemp = document.getElementById('etSeaTemp').value.trim();
  const waveHeight = document.getElementById('etWave').value.trim();
  const pressure = document.getElementById('etPressure').value.trim();
  // Build wx — preserve existing snapshot fields not in the form
  let wxSnapshot = '';
  let wxObj = {};
  try { if (t.wxSnapshot) wxObj = JSON.parse(t.wxSnapshot); } catch(e) { wxObj = {}; }
  if (bft) wxObj.bft = parseInt(bft); else delete wxObj.bft;
  if (windMsVal != null && !isNaN(windMsVal)) {
    wxObj.ws = +windMsVal.toFixed(1);
  } else if (bft) {
    const range = bftToMsRange(parseInt(bft));
    if (range) wxObj.ws = range[0] + '-' + range[1];
  } else { delete wxObj.ws; }
  if (windDir) wxObj.dir = windDir; else delete wxObj.dir;
  if (gustMsVal != null && !isNaN(gustMsVal)) wxObj.wg = +gustMsVal.toFixed(1); else delete wxObj.wg;
  if (airTemp) wxObj.tc = parseFloat(airTemp); else delete wxObj.tc;
  if (seaTemp) wxObj.sst = parseFloat(seaTemp); else delete wxObj.sst;
  if (waveHeight) wxObj.wv = parseFloat(waveHeight); else delete wxObj.wv;
  if (pressure) wxObj.pres = parseInt(pressure); else delete wxObj.pres;
  if (Object.keys(wxObj).length) wxSnapshot = JSON.stringify(wxObj);

  const btn = document.getElementById('etSubmitBtn');
  btn.disabled = true; btn.textContent = s('logbook.saving');
  try {
    await apiPost('saveTrip', {
      id: tripId, date, boatId, boatName, boatCategory,
      locationId: locId, locationName: locName,
      timeOut, timeIn, hoursDecimal, crew,
      beaufort: bft, windDir, wxSnapshot, skipperNote,
      distanceNm, departurePort: depPort, arrivalPort: arrPort,
    });
    // Update local data
    Object.assign(t, { date, boatId, boatName, boatCategory, locationId: locId, locationName: locName, timeOut, timeIn, hoursDecimal, crew, beaufort: bft, windDir, wxSnapshot, skipperNote, distanceNm, departurePort: depPort, arrivalPort: arrPort });
    closeEditTrip();
    applyFilter();
    showToast(s('logbook.tripUpdated2'), 'success');
  } catch(e) {
    errEl.textContent = s('logbook.errGeneric',{msg:e.message}); errEl.style.display = '';
  }
  btn.disabled = false; btn.textContent = s('logbook.saveChanges');
}

// ── Inline GPS track upload ────────────────────────────────────────────────
function inlineUploadTrack(tripId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gpx,.kml,.kmz';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    showToast(s('logbook.uploadingTrack'));
    try {
      // readFileForUpload gzips GPX/KML transparently before base64-encoding.
      const info = await readFileForUpload(file);
      const res = await apiPost('uploadTripFile', { fileType: 'track', fileName: info.fileName, fileData: info.fileData, mimeType: info.mimeType, compressed: info.compressed });
      if (!res.ok) { showToast(s('logbook.uploadFailed'), 'err'); return; }
      // Save track to trip
      const updates = { trackFileUrl: res.trackFileUrl || '', trackSimplified: res.trackSimplified || '', trackSource: res.trackSource || '' };
      if (res.distanceNm) updates.distanceNm = res.distanceNm;
      await apiPost('saveTrip', { id: tripId, ...updates });
      const t = myTrips.find(x => x.id === tripId);
      if (t) Object.assign(t, updates);
      applyFilter();
      showToast(s('logbook.trackAdded2'), 'success');
    } catch(e) { showToast('Error: ' + e.message, 'err'); }
  };
  input.click();
}

// ── Inline photo upload ────────────────────────────────────────────────────
let _inlinePhotos = []; // [{fileName, fileData, mimeType}]

function inlineUploadPhotos(tripId) {
  _inlinePhotos = [];
  document.getElementById('puTripId').value = tripId;
  document.getElementById('puPhotoFiles').value = '';
  document.getElementById('puPhotoPreview').innerHTML = '';
  document.getElementById('puShared').checked = true;
  document.getElementById('puClubUse').checked = false;
  document.getElementById('puErr').style.display = 'none';
  document.getElementById('photoUploadTitle').textContent = s('logbook.addPhotosTitle');
  document.getElementById('puSharedLbl').textContent = s('logbook.shareWithCrew');
  document.getElementById('puClubLbl').textContent = s('logbook.clubMayUse');
  document.getElementById('puHint').textContent = s('logbook.photoHint');
  document.getElementById('puSubmitBtn').textContent = s('logbook.uploadPhotos');
  openModal('photoUploadModal');
}

function closePhotoUpload() {
  closeModal('photoUploadModal');
  _inlinePhotos = [];
}

function handleInlinePhotos(input) {
  const preview = document.getElementById('puPhotoPreview');
  Array.from(input.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      _inlinePhotos.push({ fileName: file.name, fileData: reader.result, mimeType: file.type });
      const img = document.createElement('img');
      img.src = reader.result;
      img.className = 'photo-thumb';
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

async function submitInlinePhotos() {
  const tripId = document.getElementById('puTripId').value;
  const t = myTrips.find(x => x.id === tripId);
  if (!t) return;
  if (!_inlinePhotos.length) {
    document.getElementById('puErr').textContent = s('logbook.noPhotosSelected');
    document.getElementById('puErr').style.display = '';
    return;
  }
  const shared = document.getElementById('puShared').checked;
  const clubUse = document.getElementById('puClubUse').checked;
  const btn = document.getElementById('puSubmitBtn');
  btn.disabled = true; btn.textContent = s('logbook.uploading');
  try {
    let urls = []; try { urls = JSON.parse(t.photoUrls || '[]'); } catch(e) {}
    let meta = {}; try { if (t.photoMeta) meta = JSON.parse(t.photoMeta); } catch(e) {}
    const newUrls = [];
    await Promise.all(_inlinePhotos.map(async ph => {
      try {
        const res = await apiPost('uploadTripFile', { fileType: 'photo', fileName: ph.fileName, fileData: ph.fileData, mimeType: ph.mimeType, shared, clubUse });
        if (res.ok && res.photoUrl) {
          newUrls.push(res.photoUrl);
          meta[res.photoUrl] = { shared, clubUse, uploadedBy: user.kennitala };
        }
      } catch(e) { showToast(s('logbook.uploadFailed2',{msg:e.message}), 'warn'); }
    }));
    if (newUrls.length) {
      const allUrls = urls.concat(newUrls);
      const photoUrls = JSON.stringify(allUrls);
      const photoMeta = JSON.stringify(meta);
      await apiPost('saveTrip', { id: tripId, photoUrls, photoMeta });
      t.photoUrls = photoUrls;
      t.photoMeta = photoMeta;
    }
    closePhotoUpload();
    applyFilter();
    showToast(s('logbook.photosAdded2'), 'success');
  } catch(e) {
    document.getElementById('puErr').textContent = s('logbook.errGeneric',{msg:e.message});
    document.getElementById('puErr').style.display = '';
  }
  btn.disabled = false; btn.textContent = s('logbook.uploadPhotos');
}

// ── Modal HTML + delegated lb-* listener (auto-injected) ────────────────────
;(function () {
  if (typeof document === 'undefined') return;

  function editModalHtml() {
    return ''
      + '<div class="modal-overlay hidden" id="editTripModal" data-lb-close-self="closeEditTrip">'
      +   '<div class="modal modal--md">'
      +     '<div class="modal-title">'
      +       '<span id="editTripTitle" data-s="lb.editTrip"></span>'
      +       '<button class="modal-close" data-lb-click="closeEditTrip">&#10005;</button>'
      +     '</div>'
      +     '<input type="hidden" id="etId">'
      +     '<div class="form-row">'
      +       '<div class="form-field"><label for="etDate" data-s="lbl.date"></label><input type="date" id="etDate"></div>'
      +       '<div class="form-field"><label for="etBoat" data-s="lbl.boat"></label>'
      +         '<select id="etBoat"><option value="" data-s="lb.selectBoat"></option></select>'
      +       '</div>'
      +     '</div>'
      +     '<div class="form-field"><label for="etLocation" data-s="lbl.location"></label>'
      +       '<select id="etLocation"><option value="" data-s="lb.selectLocation"></option></select>'
      +     '</div>'
      +     '<div class="form-row">'
      +       '<div class="form-field"><label for="etTimeOut" data-s="lb.departed"></label><input type="time" id="etTimeOut"></div>'
      +       '<div class="form-field"><label for="etTimeIn"  data-s="lb.returned"></label><input type="time" id="etTimeIn" ></div>'
      +     '</div>'
      +     '<div class="form-row">'
      +       '<div class="form-field"><label for="etCrew" data-s="lb.crewAboard"></label><input type="number" id="etCrew" min="1" value="1"></div>'
      +       '<div class="form-field"><label for="etDistanceNm" data-s="lb.distanceNm"></label><input type="number" id="etDistanceNm" min="0" step="0.1"></div>'
      +     '</div>'
      +     '<div class="form-row">'
      +       '<div class="form-field"><label for="etDeparturePort" data-s="lb.departurePort"></label><input list="portsList" id="etDeparturePort" autocomplete="off"></div>'
      +       '<div class="form-field"><label for="etArrivalPort" data-s="lb.arrivalPort"></label><input list="portsList" id="etArrivalPort" autocomplete="off"></div>'
      +     '</div>'
      +     '<div class="section-label" style="margin:12px 0 8px" data-s="lb.weatherHdr"></div>'
      +     '<div id="etWxFields"></div>'
      +     '<div class="form-field mt-8"><label for="etSkipperNote">Skipper\'s comments <span class="text-muted text-9" data-s="lb.parenVisibleToCrew"></span></label>'
      +       '<textarea id="etSkipperNote" rows="2"></textarea>'
      +     '</div>'
      +     '<div id="etErr" class="text-sm text-red mb-8" style="display:none"></div>'
      +     '<button class="btn-primary" id="etSubmitBtn" data-lb-click="submitEditTrip"><span data-s="lb.saveChanges"></span></button>'
      +   '</div>'
      + '</div>';
  }

  function photoModalHtml() {
    return ''
      + '<div class="modal-overlay hidden" id="photoUploadModal" data-lb-close-self="closePhotoUpload">'
      +   '<div class="modal modal--md">'
      +     '<div class="modal-title">'
      +       '<span id="photoUploadTitle" data-s="lb.addPhotos"></span>'
      +       '<button class="modal-close" data-lb-click="closePhotoUpload">&#10005;</button>'
      +     '</div>'
      +     '<input type="hidden" id="puTripId">'
      +     '<div class="form-field">'
      +       '<label for="puPhotoFiles" data-s="lb.photosLabel"></label>'
      +       '<input type="file" id="puPhotoFiles" accept="image/*" multiple data-lb-change-el="handleInlinePhotos" class="text-sm">'
      +       '<div id="puPhotoPreview" class="flex-center flex-wrap gap-6 mt-6"></div>'
      +     '</div>'
      +     '<div class="photo-meta-row mb-8">'
      +       '<label><input type="checkbox" id="puShared" checked> <span id="puSharedLbl" data-s="lb.shareWithCrew"></span></label>'
      +       '<label><input type="checkbox" id="puClubUse"> <span id="puClubLbl" data-s="lb.clubMayUse"></span></label>'
      +     '</div>'
      +     '<div class="text-xs text-muted mb-12" id="puHint" data-s="lb.photosBlurb"></div>'
      +     '<div id="puErr" class="text-sm text-red mb-8" style="display:none"></div>'
      +     '<button class="btn-primary" id="puSubmitBtn" data-lb-click="submitInlinePhotos"><span data-s="lb.uploadPhotos"></span></button>'
      +   '</div>'
      + '</div>';
  }

  function injectIfMissing() {
    if (!document.getElementById('editTripModal')) {
      var w = document.createElement('div');
      w.innerHTML = editModalHtml();
      document.body.appendChild(w.firstElementChild);
    }
    if (!document.getElementById('photoUploadModal')) {
      var w2 = document.createElement('div');
      w2.innerHTML = photoModalHtml();
      document.body.appendChild(w2.firstElementChild);
    }
    // Populate the weather sub-fields once the container exists.
    var etWx = document.getElementById('etWxFields');
    if (etWx && !etWx.firstElementChild && typeof tripFormWeatherFieldsHtml === 'function') {
      etWx.innerHTML = tripFormWeatherFieldsHtml('et', { extraStep: '0.1' });
    }
    if (typeof applyStrings === 'function') applyStrings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectIfMissing, { once: true });
  } else {
    injectIfMissing();
  }

  // Delegated data-lb-* listener — same vocabulary as the logbook portal's
  // local listener. Guarded so the two don't double-fire when both load.
  if (!document._lbListeners) {
    document._lbListeners = true;
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-lb-nobubble]')) { e.stopPropagation(); return; }
      var cs = e.target.closest('[data-lb-close-self]');
      if (cs && e.target === cs) { window[cs.dataset.lbCloseSelf](); return; }
      var c = e.target.closest('[data-lb-click]');
      if (c && typeof window[c.dataset.lbClick] === 'function') {
        var a = [c.dataset.lbArg, c.dataset.lbArg2].filter(function (v) { return v != null; });
        window[c.dataset.lbClick].apply(null, a);
      }
    });
    document.addEventListener('change', function (e) {
      var ce = e.target.closest('[data-lb-change-el]');
      if (ce && typeof window[ce.dataset.lbChangeEl] === 'function') { window[ce.dataset.lbChangeEl](ce); return; }
      var c = e.target.closest('[data-lb-change]');
      if (c && typeof window[c.dataset.lbChange] === 'function') window[c.dataset.lbChange]();
    });
    document.addEventListener('input', function (e) {
      var ie = e.target.closest('[data-lb-input-el]');
      if (ie && typeof window[ie.dataset.lbInputEl] === 'function') { window[ie.dataset.lbInputEl](ie, ie.dataset.lbArg); return; }
      var i = e.target.closest('[data-lb-input]');
      if (i && typeof window[i.dataset.lbInput] === 'function') window[i.dataset.lbInput](i.dataset.lbArg);
    });
    document.addEventListener('focusout', function (e) {
      var bh = e.target.closest('[data-lb-blur-hide]');
      if (bh) {
        var id = bh.dataset.lbBlurHide;
        setTimeout(function () {
          var el = document.getElementById(id);
          if (el) el.style.display = 'none';
        }, 200);
      }
    });
  }
})();
