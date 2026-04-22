// ═══════════════════════════════════════════════════════════════════════════════
// logbook-form.js — Manual-trip logging modal + club-trip join flow
// Extracted from shared/logbook.js. All functions stay global via the existing
// non-module script pattern. Callers (captain/index.html, logbook/index.html)
// must include this file alongside shared/logbook.js.
// ═══════════════════════════════════════════════════════════════════════════════

async function openLogModal(){
  openModal('logModal');
  document.body.style.overflow='hidden';
  _selectedClubTrip=null;
  document.getElementById('joinExtras').style.display='none';
  showStep1();
  document.getElementById('loadMoreTripsBtn').style.display='none';
  // Use cached club trips if fresh (< 30s), otherwise refetch
  const myIds=new Set(myTrips.flatMap(t=>[t.linkedTripId,t.linkedCheckoutId,t.id]).filter(Boolean));
  if(Date.now() - _clubTripsLoadedAt < CLUB_TRIPS_TTL && allClubTrips.length){
    clubTripsOffset=0;
    renderClubTripsList();
    return;
  }
  document.getElementById('recentTripsList').innerHTML='<div class="empty-note">'+s('logbook.loadingTrips')+'</div>';
  try{
    const res=await apiGet('getTrips',{limit:100});
    allClubTrips=(res.trips||[])
      .filter(t=>t.kennitala!==user.kennitala && !myIds.has(t.id))
      .sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    _clubTripsLoadedAt=Date.now();
  }catch(e){allClubTrips=[];}
  clubTripsOffset=0;
  renderClubTripsList();
}

function closeLogModal(){
  closeModal('logModal');
  document.body.style.overflow='';
  document.getElementById('joinExtras').style.display='none';
  _selectedClubTrip=null;
}

function showStep1(){
  document.getElementById('logStep1').style.display='';
  document.getElementById('logStep2').style.display='none';
  document.getElementById('joinExtras').style.display='none';
  _selectedClubTrip=null;
}
function showManualForm(){
  document.getElementById('logStep1').style.display='none';
  document.getElementById('logStep2').style.display='';
  // Scroll the modal sheet back to the top so the form header is in view
  // (logStep1 may have scrolled while the user browsed recent trips).
  const sheet=document.querySelector('#logModal .modal');
  if(sheet) sheet.scrollTop=0;
  document.getElementById('mDate').value=todayISO();
  // Populate boats + locations
  const bSel=document.getElementById('mBoat');
  bSel.innerHTML='<option value="">'+s('logbook.selectBoat')+'</option>';
  allBoats.forEach(b=>{const o=document.createElement('option');o.value=b.id;o.textContent=(b.name||b.id);bSel.appendChild(o);});
  const lSel=document.getElementById('mLocation');
  lSel.innerHTML='<option value="">'+s('logbook.selectLocation')+'</option>';
  allLocs.filter(l=>l.type!=='port').forEach(l=>{const o=document.createElement('option');o.value=l.id;o.textContent=(l.name||l.id);lSel.appendChild(o);});
  // Populate ports datalist
  populatePortsDatalist();
  // Reset file upload state
  _pendingTrack=null; _pendingPhotos=[];
  document.getElementById('mTrackFile').value='';
  document.getElementById('mTrackStatus').textContent='';
  document.getElementById('mPhotoFiles').value='';
  document.getElementById('mPhotoPreview').innerHTML='';
  document.getElementById('mDistanceNm').value='';
  document.getElementById('mDeparturePort').value='';
  document.getElementById('mArrivalPort').value='';
  document.getElementById('addPortHint').style.display='none';
  // Reset new fields
  document.getElementById('mRole').value='skipper';
  document.getElementById('mSkipperSection').style.display='none';
  document.getElementById('mSkipperName').value='';
  document.getElementById('mSkipperName').dataset.kennitala='';
  document.getElementById('mCrew').value='1';
  document.getElementById('mCrewSection').style.display='none';
  document.getElementById('mCrewInputs').innerHTML='';
  document.getElementById('mWindMs').value='';
  document.getElementById('mWindGust').value='';
  document.getElementById('mBft').value='';
  initWindUnitLabels();
  document.getElementById('mAirTemp').value='';
  document.getElementById('mFeelsLike').value='';
  document.getElementById('mSeaTemp').value='';
  document.getElementById('mPressure').value='';
  // Port section: collapsed by default until boat selected
  const pd=document.getElementById('portDetails');
  pd.removeAttribute('open');
  onBoatChange();
  // Reset notes
  const sn=document.getElementById('mSkipperNote'); if(sn) sn.value='';
  document.getElementById('mNotes').value='';
  // Reset non-club state
  document.getElementById('mNonClub').checked=false;
  onNonClubToggle();
  // Apply crew=1 conditional (hides personal note initially)
  onCrewChange();
}

// ── Non-club trip toggle ─────────────────────────────────────────────────────
function onNonClubToggle(){
  const on=document.getElementById('mNonClub').checked;
  document.getElementById('mBoatClub').style.display=on?'none':'';
  document.getElementById('mBoatFree').style.display=on?'':'none';
  document.getElementById('mLocClub').style.display=on?'none':'';
  document.getElementById('mLocFree').style.display=on?'':'none';
  if(!on){
    document.getElementById('mBoatFreeInput').value='';
    document.getElementById('mBoatFreeCat').value='dinghy';
    document.getElementById('mBoatFreeModel').value='';
    document.getElementById('mBoatFreeSail').value='';
    document.getElementById('mBoatFreeReg').value='';
    document.getElementById('mBoatFreeLen').value='';
    document.getElementById('mLocFreeInput').value='';
    delete document.getElementById('mLocFreeInput').dataset.lat;
    delete document.getElementById('mLocFreeInput').dataset.lng;
    const gs=document.getElementById('mLocGeoStatus'); if(gs) gs.style.display='none';
  }
}

// ── Geolocation helper (shared between logbook + member page) ────────────────
function useMyLocation(inputId,statusId){
  const input=document.getElementById(inputId||'mLocFreeInput');
  const status=document.getElementById(statusId||'mLocGeoStatus');
  if(!input) return;
  if(!navigator.geolocation){
    if(status){status.textContent=s('logbook.locationDenied');status.style.display='';}
    return;
  }
  if(status){status.textContent=s('logbook.locating');status.style.display='';}
  navigator.geolocation.getCurrentPosition(
    function(pos){
      const lat=pos.coords.latitude.toFixed(4),lng=pos.coords.longitude.toFixed(4);
      input.dataset.lat=lat; input.dataset.lng=lng;
      // Reverse geocode via Nominatim (free, no key)
      fetch('https://nominatim.openstreetmap.org/reverse?lat='+lat+'&lon='+lng+'&format=json&zoom=10')
        .then(function(r){return r.json();})
        .then(function(data){
          if(data&&data.address){
            var place=data.address.village||data.address.town||data.address.city||data.address.municipality||'';
            if(!place&&data.display_name) place=data.display_name.split(',')[0];
            input.value=place||lat+', '+lng;
          } else {
            input.value=lat+', '+lng;
          }
          if(status){status.textContent=lat+', '+lng;status.style.display='';}
        })
        .catch(function(){
          input.value=lat+', '+lng;
          if(status){status.textContent=lat+', '+lng;status.style.display='';}
        });
    },
    function(){
      if(status){status.textContent=s('logbook.locationDenied');status.style.display='';}
    },
    {enableHighAccuracy:false,timeout:10000}
  );
}

// ── Fetch current weather from Open-Meteo using geolocation ──────────────────
async function fetchCurrentWeather(){
  const status=document.getElementById('mWxFetchStatus');
  const btn=document.getElementById('mWxFetchBtn');
  function setStatus(msg,err){ if(!status) return; status.textContent=msg; status.style.display=''; status.style.color=err?'var(--red)':'var(--muted)'; }
  if(!navigator.geolocation){ setStatus('Geolocation not available',true); return; }
  // Try to reuse coords from non-club location input if already set
  let lat=null,lng=null;
  const locInp=document.getElementById('mLocFreeInput');
  if(locInp && locInp.dataset.lat && locInp.dataset.lng){ lat=locInp.dataset.lat; lng=locInp.dataset.lng; }
  btn && (btn.disabled=true);
  setStatus('Locating…');
  try{
    if(lat==null){
      const pos=await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:false,timeout:10000}));
      lat=pos.coords.latitude.toFixed(4); lng=pos.coords.longitude.toFixed(4);
    }
    setStatus('Fetching weather…');
    const cur='wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,apparent_temperature,surface_pressure';
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=${cur}&wind_speed_unit=ms&timezone=auto`;
    const marineUrl=`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=wave_height,sea_surface_temperature&timezone=auto`;
    const [wxRes,marRes]=await Promise.all([
      fetch(url).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(marineUrl).then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    const c=wxRes&&wxRes.current;
    if(!c){ setStatus('Could not fetch weather',true); btn&&(btn.disabled=false); return; }
    function setVal(id,v){ const el=document.getElementById(id); if(el && v!=null && v!==''){ el.value=v; } }
    // Wind speed: convert m/s into user's display unit
    if(c.wind_speed_10m!=null){
      const ws=convertWind(c.wind_speed_10m, _mWindUnit);
      setVal('mWindMs', ws);
      onWindInput(); // sync Beaufort
    }
    if(c.wind_gusts_10m!=null) setVal('mWindGust', convertWind(c.wind_gusts_10m, _mWindUnit));
    if(c.wind_direction_10m!=null){
      const dirs=['N','NE','E','SE','S','SW','W','NW'];
      const idx=Math.round(((c.wind_direction_10m%360)+360)%360/45)%8;
      setVal('mWindDir', dirs[idx]);
    }
    if(c.temperature_2m!=null) setVal('mAirTemp', c.temperature_2m.toFixed(1));
    if(c.apparent_temperature!=null) setVal('mFeelsLike', c.apparent_temperature.toFixed(1));
    if(c.surface_pressure!=null) setVal('mPressure', Math.round(c.surface_pressure));
    const m=marRes&&marRes.current;
    if(m){
      if(m.wave_height!=null) setVal('mWave', m.wave_height.toFixed(1));
      if(m.sea_surface_temperature!=null) setVal('mSeaTemp', m.sea_surface_temperature.toFixed(1));
    }
    setStatus('Weather loaded ✓');
  }catch(e){
    setStatus('Location denied or unavailable',true);
  }finally{
    btn && (btn.disabled=false);
  }
}

// ── Wind unit + Beaufort sync helpers ────────────────────────────────────────
// Determine the numeric wind unit for manual inputs (bft pref → use m/s for inputs)
let _mWindUnit = (function(){ var p = getPref('windUnit','ms'); return p === 'bft' ? 'ms' : p; })();
let _bftSyncing = false; // prevent circular updates

function initWindUnitLabels(){
  const pref = getPref('windUnit', 'ms');
  // For input fields we use a numeric unit; if pref is 'bft', default inputs to m/s
  _mWindUnit = (pref === 'bft') ? 'ms' : pref;
  const label = windUnitLabel(_mWindUnit);
  document.getElementById('mWindLabel').textContent = s('logbook.windLabel',{unit:label});
  document.getElementById('mGustLabel').textContent = s('logbook.gustsLabel',{unit:label});
  // Adjust step for knots/kmh/mph (whole numbers more common)
  const step = (_mWindUnit === 'ms') ? '0.1' : '0.1';
  document.getElementById('mWindMs').step = step;
  document.getElementById('mWindGust').step = step;
}

function onBftChange(){
  if(_bftSyncing) return;
  _bftSyncing = true;
  const bft = document.getElementById('mBft').value;
  const windEl = document.getElementById('mWindMs');
  if(bft !== ''){
    // Auto-fill wind speed with midpoint of Beaufort range, in user's unit
    const midMs = bftToMsMid(parseInt(bft));
    if(midMs != null && !windEl.value){
      windEl.value = convertWind(midMs, _mWindUnit);
    }
  }
  _bftSyncing = false;
}

function onWindInput(){
  if(_bftSyncing) return;
  _bftSyncing = true;
  const val = parseFloat(document.getElementById('mWindMs').value);
  if(!isNaN(val)){
    const ms = convertToMs(val, _mWindUnit);
    document.getElementById('mBft').value = bftFromMs(ms);
  } else {
    document.getElementById('mBft').value = '';
  }
  _bftSyncing = false;
}

function onGustInput(){
  // No auto-sync needed for gusts, but placeholder for future use
}

function populatePortsDatalist(){
  const dl=document.getElementById('portsList');
  if(!dl) return;
  const ports=allLocs.filter(l=>l.type==='port');
  dl.innerHTML=ports.map(p=>`<option value="${esc(p.name)}">`).join('');
}

function onBoatChange(){
  const boatId=document.getElementById('mBoat').value;
  const boat=_boat(boatId);
  const isKeelboat=(boat?.category||'').toLowerCase()==='keelboat';
  const pd=document.getElementById('portDetails');
  if(isKeelboat){
    pd.setAttribute('open','');
    document.getElementById('portSummaryLabel').textContent=s('logbook.ports');
  } else {
    pd.removeAttribute('open');
    document.getElementById('portSummaryLabel').textContent=s('logbook.portsOptional2');
  }
  // Auto-fill default port if fields are empty
  if(boat?.defaultPortId){
    const port=allLocs.find(l=>l.id===boat.defaultPortId);
    if(port){
      const dep=document.getElementById('mDeparturePort');
      const arr=document.getElementById('mArrivalPort');
      if(!dep.value) dep.value=port.name;
      if(!arr.value) arr.value=port.name;
    }
  }
}

// ── Role / crew / member search helpers ──────────────────────────────────────
function onRoleChange(){
  const isCrew = document.getElementById('mRole').value === 'crew';
  document.getElementById('mSkipperSection').style.display = isCrew ? '' : 'none';
  if(!isCrew){
    document.getElementById('mSkipperName').value='';
    document.getElementById('mSkipperName').dataset.kennitala='';
  }
}

function onCrewChange(){
  const n = parseInt(document.getElementById('mCrew').value)||1;
  const sec = document.getElementById('mCrewSection');
  const wrap = document.getElementById('mCrewInputs');
  // Personal note only makes sense when there's crew besides skipper
  const personalWrap=document.getElementById('mPersonalNoteWrap');
  if(personalWrap) personalWrap.style.display = (n < 2) ? 'none' : '';
  if(n < 2){ sec.style.display='none'; return; }
  sec.style.display='';
  const existing = Array.from(wrap.querySelectorAll('.manual-crew-row')).map(row => {
    const inp = row.querySelector('input[type="text"]');
    const cbs = row.querySelectorAll('input[type="checkbox"]');
    return { val: inp?.value||'', kt: inp?.dataset.kennitala||'', helm: cbs[0]?.checked||false, student: cbs[1]?.checked||false };
  });
  wrap.innerHTML='';
  for(let i = 0; i < n-1; i++){
    const row = document.createElement('div');
    row.className = 'manual-crew-row';
    const fields = document.createElement('div');
    fields.className = 'crew-row-fields';
    const inp = document.createElement('input');
    inp.type='text'; inp.placeholder=s('logbook.crewSearchPh',{n:i+1});
    inp.value = existing[i]?.val||'';
    inp.dataset.kennitala = existing[i]?.kt||'';
    inp.style.cssText='flex:1;min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:inherit;font-size:11px;padding:6px 8px;box-sizing:border-box';
    const drop = document.createElement('div');
    drop.className='manual-member-drop';
    inp.addEventListener('input',function(){ searchManualMember(this, drop); });
    inp.addEventListener('blur',function(){ setTimeout(()=>drop.style.display='none',200); });
    const helmLbl = document.createElement('label');
    helmLbl.className='helm-toggle';
    const helmCb = document.createElement('input');
    helmCb.type='checkbox'; helmCb.checked=existing[i]?.helm||false;
    helmLbl.appendChild(helmCb);
    helmLbl.appendChild(document.createTextNode(s('logbook.helmLabel')));
    const studentLbl = document.createElement('label');
    studentLbl.className='helm-toggle';
    const studentCb = document.createElement('input');
    studentCb.type='checkbox'; studentCb.checked=existing[i]?.student||false;
    studentLbl.appendChild(studentCb);
    studentLbl.appendChild(document.createTextNode(s('logbook.studentLabel')));
    fields.appendChild(inp);
    fields.appendChild(helmLbl);
    fields.appendChild(studentLbl);
    row.appendChild(fields);
    row.appendChild(drop);
    wrap.appendChild(row);
  }
}

function searchManualMember(inp, dropOrId){
  const drop = typeof dropOrId==='string' ? document.getElementById(dropOrId) : dropOrId;
  const q = inp.value.trim().toLowerCase();
  if(!q || q.length<2){ drop.style.display='none'; return; }
  const skip = user.kennitala;
  const matches = allMembers.filter(m =>
    m.name && m.name.toLowerCase().includes(q) && String(m.kennitala)!==String(skip)
  ).slice(0,8);
  drop.innerHTML='';
  matches.forEach(m => {
    const item = document.createElement('div');
    item.className='mm-item';
    if (m.role==='guest') { item.classList.add('flex-center','gap-6'); item.style.cssText=''; }
    item.appendChild(document.createTextNode(m.name));
    if (m.role==='guest') {
      const badge=document.createElement('span');
      badge.textContent=s('lbl.guest');
      badge.style.cssText='font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid var(--brass)55;background:var(--brass)11;color:var(--brass-fg);flex-shrink:0';
      item.appendChild(badge);
    }
    item.addEventListener('mousedown',function(e){
      e.preventDefault();
      inp.value=m.name;
      inp.dataset.kennitala=m.kennitala||'';
      inp.dataset.guest=m.role==='guest'?'1':'';
      drop.style.display='none';
    });
    drop.appendChild(item);
  });
  if(q.length>=3){
    const guest = document.createElement('div');
    guest.className='mm-guest';
    guest.textContent=s('logbook.addAsGuest',{name:inp.value.trim()});
    guest.addEventListener('mousedown',function(e){
      e.preventDefault();
      drop.style.display='none';
      _lgGuestCallback=function(g){ inp.value=g.name; inp.dataset.kennitala=g.kennitala||g.id||''; inp.dataset.guest='1'; };
      openLgGuestModal(inp.value.trim());
    });
    drop.appendChild(guest);
  }
  drop.style.display='block';
}

// ── Guest prompt (logbook) — delegates to shared/guests.js ───────────────────
let _lgGuestCallback = null;
function openLgGuestModal(name){
  openGuestPrompt({
    name: name,
    targetList: allMembers,
    onConfirm: function(guest){ if (_lgGuestCallback) _lgGuestCallback(guest); _lgGuestCallback = null; },
    onCancel:  function(){ _lgGuestCallback = null; },
  });
}

function watchPortInput(which){
  const inputId = which==='departure' ? 'mDeparturePort' : 'mArrivalPort';
  const val=document.getElementById(inputId).value.trim();
  _lastPortInput=which;
  if(!val){ document.getElementById('addPortHint').style.display='none'; return; }
  const ports=allLocs.filter(l=>l.type==='port');
  const exists=ports.some(p=>p.name.toLowerCase()===val.toLowerCase());
  if(!exists){
    document.getElementById('addPortName').textContent=val;
    document.getElementById('addPortHint').style.display='';
  } else {
    document.getElementById('addPortHint').style.display='none';
  }
}

async function addNewPort(){
  const inputId=_lastPortInput==='arrival'?'mArrivalPort':'mDeparturePort';
  const val=document.getElementById(inputId).value.trim();
  if(!val) return;
  const newPort={id:'loc_'+Date.now().toString(36), name:val, type:'port', active:true};
  allLocs.push(newPort);
  try{
    await apiPost('saveConfig',{locations:allLocs});
    populatePortsDatalist();
    document.getElementById('addPortHint').style.display='none';
    // Also fill the other port field if empty
    const otherEl=document.getElementById(_lastPortInput==='arrival'?'mDeparturePort':'mArrivalPort');
    if(!otherEl.value) otherEl.value=val;
    showToast(s('logbook.portAdded'),'success');
  }catch(e){ showToast(s('logbook.errSaveFailed',{msg:e.message}),'err'); allLocs.pop(); }
}

function handleTrackFile(input){
  const file=input.files[0];
  if(!file){ _pendingTrack=null; document.getElementById('mTrackStatus').textContent=''; return; }
  const statusEl=document.getElementById('mTrackStatus');
  statusEl.textContent=s('logbook.readingFile');
  const reader=new FileReader();
  reader.onload=function(e){
    _pendingTrack={fileName:file.name, fileData:e.target.result, mimeType:file.type||'application/octet-stream'};
    statusEl.textContent=s('logbook.fileReady',{name:file.name});
    statusEl.style.color='var(--brass)';
  };
  reader.onerror=function(){ statusEl.textContent=s('logbook.readError'); statusEl.style.color='var(--red)'; _pendingTrack=null; };
  reader.readAsDataURL(file);
}

function handlePhotoFiles(input){
  const files=Array.from(input.files);
  _pendingPhotos=[];
  const preview=document.getElementById('mPhotoPreview');
  preview.innerHTML='';
  files.forEach(function(file){
    const reader=new FileReader();
    reader.onload=function(e){
      _pendingPhotos.push({fileName:file.name, fileData:e.target.result, mimeType:file.type||'image/jpeg'});
      const img=document.createElement('img');
      img.src=e.target.result; img.className='photo-thumb';
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

async function submitJoinTrip(){
  if(!_selectedClubTrip){ showToast(s('logbook.noTripSelected'),'err'); return; }
  const t=_selectedClubTrip;
  const errEl=document.getElementById('jErr');
  errEl.style.display='none';
  const btn=document.getElementById('jSubmitBtn');
  btn.disabled=true; btn.textContent=s('logbook.sendingRequest');

  try{
    await apiPost('createConfirmation',{
      type:'crew_join',
      fromKennitala: user.kennitala, fromName: user.name,
      toKennitala: t.kennitala, toName: t.memberName,
      tripId: t.id,
      linkedCheckoutId: t.linkedCheckoutId||'',
      boatId: t.boatId, boatName: t.boatName, boatCategory: t.boatCategory||'',
      locationId: t.locationId, locationName: t.locationName,
      date: t.date, timeOut: t.timeOut, timeIn: t.timeIn,
      hoursDecimal: t.hoursDecimal,
      role:'crew',
      beaufort: t.beaufort||'', windDir: t.windDir||'',
      wxSnapshot: t.wxSnapshot||'',
    });
    showToast(s('logbook.requestSent'),'success');
    closeLogModal();
  }catch(e){
    errEl.textContent=e.message;
    errEl.style.display='';
    btn.disabled=false;
    btn.textContent=s('logbook.addToLogbook');
  }
}

function renderClubTripsList(){
  var el=document.getElementById('recentTripsList');
  var page=allClubTrips.slice(0, clubTripsOffset+CLUB_PAGE);
  if(!allClubTrips.length){
    el.innerHTML='<div class="empty-note">'+s('logbook.noClubTrips')+'</div>';
    document.getElementById('loadMoreTripsBtn').style.display='none';
    return;
  }
  var _gBadge = ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid var(--brass)55;background:var(--brass)11;color:var(--brass-fg);margin-left:2px">'+s('tc.guest')+'</span>';
  var frag = document.createDocumentFragment();
  page.forEach(function(t) {
    var _sm = t.kennitala ? _member(t.kennitala) : null;
    var _sg = (_sm && _sm.role==='guest') ? _gBadge : '';
    var card = document.createElement('div');
    card.className = 'trip-pick-card';
    card.dataset.lbClick = 'joinTripAsCrew';
    card.dataset.lbArg = t.id;
    card.innerHTML =
      '<div class="tpc-boat">'+esc(t.boatName||'—')+' · '+esc(t.locationName||'—')+'</div>'
      +'<div class="tpc-sub">'+esc(t.date||'—')+' · '+esc(t.timeOut||'')+'–'+esc(t.timeIn||'')
      +(t.beaufort?' · 💨 Force '+esc(t.beaufort):'')
      +' · '+esc(t.memberName||'?')+_sg+' (skipper)</div>';
    frag.appendChild(card);
  });
  el.innerHTML = '';
  el.appendChild(frag);
  document.getElementById('loadMoreTripsBtn').style.display=
    allClubTrips.length>clubTripsOffset+CLUB_PAGE?'':'none';
}
function loadMoreTrips(){
  clubTripsOffset+=CLUB_PAGE;
  renderClubTripsList();
}

function joinTripAsCrew(tripId){
  const el=document.querySelector('.trip-pick-card[data-lb-arg="'+tripId+'"]');
  if(!el) return;
  // Toggle deselect
  if(el.classList.contains('selected')){
    el.classList.remove('selected');
    document.getElementById('joinExtras').style.display='none';
    _selectedClubTrip=null;
    return;
  }
  document.querySelectorAll('.trip-pick-card.selected').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected');
  const t=allClubTrips.find(x=>x.id===tripId);
  if(!t) return;

  // Guard: already in logbook
  const alreadyInLog=myTrips.some(x=>
    x.linkedTripId===t.id||
    (t.linkedCheckoutId&&x.linkedCheckoutId===t.linkedCheckoutId)
  );
  if(alreadyInLog){
    el.classList.remove('selected');
    showToast(s('logbook.alreadyInLog'),'err');
    return;
  }

  _selectedClubTrip=t;
  // Reset extras form
  document.getElementById('jErr').style.display='none';
  const btn=document.getElementById('jSubmitBtn');
  btn.disabled=false; btn.textContent=s('logbook.requestToJoin');
  document.getElementById('joinExtras').style.display='';
  // Scroll extras into view
  document.getElementById('joinExtras').scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function submitManual(){
  const errEl=document.getElementById('mErr');
  errEl.style.display='none';
  const date      = document.getElementById('mDate').value;
  const isNonClub = document.getElementById('mNonClub').checked;
  let boatId, boatName, boatCategory, locId, locName;
  if(isNonClub){
    boatId='';
    boatName=document.getElementById('mBoatFreeInput').value.trim();
    boatCategory=document.getElementById('mBoatFreeCat').value;
    locId='';
    locName=document.getElementById('mLocFreeInput').value.trim();
    var _ncModel=(document.getElementById('mBoatFreeModel')?.value||'').trim();
    var _ncSail=(document.getElementById('mBoatFreeSail')?.value||'').trim();
    var _ncReg=(document.getElementById('mBoatFreeReg')?.value||'').trim();
    var _ncLen=(document.getElementById('mBoatFreeLen')?.value||'').trim();
  } else {
    boatId=document.getElementById('mBoat').value;
    boatName=document.getElementById('mBoat').selectedOptions[0]?.text||'';
    const boat=_boat(boatId);
    boatCategory=boat?.category||'';
    locId=document.getElementById('mLocation').value;
    locName=document.getElementById('mLocation').selectedOptions[0]?.text||'';
  }
  const timeOut   = document.getElementById('mTimeOut').value;
  const timeIn    = document.getElementById('mTimeIn').value;
  const crew      = parseInt(document.getElementById('mCrew').value)||1;
  const role      = document.getElementById('mRole').value;
  const bft       = document.getElementById('mBft').value;
  const wdir      = document.getElementById('mWindDir').value;
  const wave      = document.getElementById('mWave').value;
  const windRaw   = document.getElementById('mWindMs').value;
  const gustRaw   = document.getElementById('mWindGust').value;
  // Convert from user's display unit back to m/s for storage
  const windMs    = windRaw ? convertToMs(parseFloat(windRaw), _mWindUnit).toFixed(1) : '';
  const windGust  = gustRaw ? convertToMs(parseFloat(gustRaw), _mWindUnit).toFixed(1) : '';
  const airTemp   = document.getElementById('mAirTemp').value;
  const feelsLike = document.getElementById('mFeelsLike').value;
  const seaTemp   = document.getElementById('mSeaTemp').value;
  const pressure  = document.getElementById('mPressure').value;
  const skipperNote = (document.getElementById('mSkipperNote')?.value||'').trim();
  // Personal note is only used when there are crew besides the skipper
  const _crewN    = parseInt(document.getElementById('mCrew').value)||1;
  const notes     = (_crewN>1) ? document.getElementById('mNotes').value.trim() : '';
  const distInput = parseFloat(document.getElementById('mDistanceNm').value)||'';
  let   depPort   = document.getElementById('mDeparturePort').value.trim();
  let   arrPort   = document.getElementById('mArrivalPort').value.trim();
  if(arrPort===''&&depPort!=='') arrPort=depPort;   // default arrival = departure

  // Validate time format (HH:MM with minutes ≤59)
  const timeRe=/^([01]\d|2[0-3]):[0-5]\d$/;
  if(timeOut && !timeRe.test(timeOut)){errEl.textContent=s('logbook.errDepartureTime');errEl.style.display='';return;}
  if(timeIn  && !timeRe.test(timeIn)){errEl.textContent=s('logbook.errReturnTime');errEl.style.display='';return;}

  if(!date){errEl.textContent=s('logbook.errDate');errEl.style.display='';return;}
  if(isNonClub && !boatName){errEl.textContent=s('logbook.enterBoatName');errEl.style.display='';return;}
  if(isNonClub && !locName){errEl.textContent=s('logbook.enterLocation');errEl.style.display='';return;}
  if(!isNonClub && !boatId){errEl.textContent=s('logbook.errBoat');errEl.style.display='';return;}

  // Validate skipper assignment when role is crew
  if(role==='crew'){
    const skipKt=document.getElementById('mSkipperName').dataset.kennitala||'';
    if(!skipKt){errEl.textContent=s('logbook.errSkipper');errEl.style.display='';return;}
  }

  // Check for duplicate trip on same date + boat (skip for non-club trips)
  if(!isNonClub){
    const dupeTrip=myTrips.find(x=>x.date===date&&x.boatId===boatId);
    if(dupeTrip){
      errEl.textContent=s('logbook.errDuplicate');
      errEl.style.display='';
      return;
    }
  }

  // Compute hours
  let hoursDecimal=0;
  if(timeOut&&timeIn){
    const [oh,om]=timeOut.split(':').map(Number);
    const [ih,im]=timeIn.split(':').map(Number);
    let mins=(ih*60+im)-(oh*60+om);
    if(mins<0) mins+=1440;
    hoursDecimal=+(mins/60).toFixed(2);
  }

  // Build wxSnapshot from all weather fields (always stored in m/s)
  let wxSnapshot='';
  const wxObj={};
  if(bft)       wxObj.bft=parseInt(bft);
  if(windMs){
    wxObj.ws=parseFloat(windMs)||0;
  } else if(bft){
    // Beaufort-only: save m/s range so it can be converted to other units
    const range=bftToMsRange(parseInt(bft));
    if(range) wxObj.ws=range[0]+'-'+range[1];
  }
  if(wdir)      wxObj.dir=wdir;
  if(windGust)  wxObj.wg=parseFloat(windGust)||0;
  if(wave)      wxObj.wv=parseFloat(wave)||0;
  if(airTemp)   wxObj.tc=parseFloat(airTemp);
  if(feelsLike) wxObj.feels=parseFloat(feelsLike);
  if(seaTemp)   wxObj.sst=parseFloat(seaTemp);
  if(pressure)  wxObj.pres=parseFloat(pressure);
  if(Object.keys(wxObj).length) wxSnapshot=JSON.stringify(wxObj);

  // Disable submit while uploading
  const btn=document.getElementById('mSubmitBtn');
  btn.disabled=true; btn.textContent=s('logbook.uploading');

  // Upload GPS track
  let trackFileUrl='', trackSimplified='', trackSource='', distanceNm=distInput;
  if(_pendingTrack){
    try{
      const tr=await apiPost('uploadTripFile',{fileType:'track',fileName:_pendingTrack.fileName,fileData:_pendingTrack.fileData,mimeType:_pendingTrack.mimeType});
      if(tr.ok){
        trackFileUrl=tr.trackFileUrl||'';
        trackSimplified=tr.trackSimplified||'';
        trackSource=tr.trackSource||'';
        if(!distanceNm && tr.distanceNm){
          distanceNm=tr.distanceNm;
          const dEl=document.getElementById('mDistanceNm');
          if(dEl) dEl.value=tr.distanceNm;
        }
      } else {
        showToast(s('logbook.uploadNoConfig'),'warn');
      }
    }catch(e){ showToast(s('logbook.gpsUploadFailed',{msg:e.message}),'warn'); }
  }

  // Upload photos in parallel
  const photoUrls=[];
  const mPhotoShared = document.getElementById('mPhotoShared').checked;
  const mPhotoClubUse = document.getElementById('mPhotoClubUse').checked;
  await Promise.all(_pendingPhotos.map(async ph=>{
    try{
      const pr=await apiPost('uploadTripFile',{fileType:'photo',fileName:ph.fileName,fileData:ph.fileData,mimeType:ph.mimeType,shared:mPhotoShared,clubUse:mPhotoClubUse});
      if(pr.ok && pr.photoUrl) photoUrls.push(pr.photoUrl);
      else if(!pr.ok) showToast(s('logbook.photoNoConfig'),'warn');
    }catch(e){ showToast(s('logbook.photoUploadFailed',{msg:e.message}),'warn'); }
  }));

  // Build photo metadata
  const photoMeta = {};
  photoUrls.forEach(u => { photoMeta[u] = { shared: mPhotoShared, clubUse: mPhotoClubUse, uploadedBy: user.kennitala }; });

  btn.disabled=false; btn.textContent=s('logbook.saveToLogbook');

  try{
    // Build crewNames JSON from crew inputs
    const crewInputs = Array.from(document.querySelectorAll('#mCrewInputs .manual-crew-row'));
    const _crewNamesArr = crewInputs.map(row => {
      const inp = row.querySelector('input[type="text"]');
      const cbs = row.querySelectorAll('input[type="checkbox"]');
      const nm = inp?.value.trim();
      if (!nm) return null;
      return { name: nm, kennitala: inp?.dataset.kennitala||'', helm: cbs[0]?.checked||false, student: cbs[1]?.checked||false, guest: !!(inp?.dataset.guest) };
    }).filter(Boolean);
    const helmSelf = !!(document.getElementById('mHelmSelf')?.checked);
    const tripBase = {
      date, boatId, boatName, boatCategory,
      locationId:locId, locationName:locName,
      timeOut, timeIn, hoursDecimal, crew, role,
      beaufort:bft, windDir:wdir, notes, skipperNote, wxSnapshot,
      distanceNm, departurePort:depPort, arrivalPort:arrPort,
      trackFileUrl, trackSimplified, trackSource,
      photoUrls: photoUrls.length ? JSON.stringify(photoUrls) : '',
      photoMeta: Object.keys(photoMeta).length ? JSON.stringify(photoMeta) : '',
      nonClub: isNonClub||false,
      boatModel: isNonClub ? (typeof _ncModel!=='undefined'?_ncModel:'') : '',
      boatSailNumber: isNonClub ? (typeof _ncSail!=='undefined'?_ncSail:'') : '',
      boatRegistration: isNonClub ? (typeof _ncReg!=='undefined'?_ncReg:'') : '',
      boatLengthM: isNonClub ? (typeof _ncLen!=='undefined'?_ncLen:'') : '',
      helm: helmSelf,
      crewNames: _crewNamesArr.length ? JSON.stringify(_crewNamesArr) : '',
    };
    const res=await apiPost('saveTrip', tripBase);
    const savedTrip = Object.assign({id:res.id, kennitala:user.kennitala}, tripBase);
    myTrips.unshift(savedTrip);

    // Save linked crew trips for named crew members
    const linkedId = res.id; // use the skipper trip id as the link
    for(const row of crewInputs){
      const inp = row.querySelector('input[type="text"]');
      const cbs = row.querySelectorAll('input[type="checkbox"]');
      const cName = inp?.value.trim();
      const cKt = inp?.dataset.kennitala||'';
      if(!cName) continue;
      try{
        await apiPost('saveTrip',{
          kennitala: cKt, memberName: cName,
          date, boatId, boatName, boatCategory,
          locationId:locId, locationName:locName,
          timeOut, timeIn, hoursDecimal,
          crew, role:'crew', isLinked:true,
          linkedTripId: linkedId,
          helm: cbs[0]?.checked||false,
          student: cbs[1]?.checked||false,
          beaufort:bft, windDir:wdir, wxSnapshot,
          distanceNm, departurePort:depPort, arrivalPort:arrPort,
          nonClub: isNonClub||false,
        });
      }catch(e2){ console.warn('Crew trip save failed for',cName,e2.message); }
    }

    renderStats(); buildFilters(); applyFilter();
    showToast('Trip saved ✓','ok');
    closeLogModal();
  }catch(e){
    errEl.textContent=e.message;
    errEl.style.display='';
  }
}

