prefetch({Trips:['getTrips',{limit:500}],Config:['getConfig'],Members:['getMembers']});

requireAuth();
buildHeader('logbook');
const user = getUser();
const IS   = getLang() === 'IS';
const _windUnit = getPref('windUnit', 'ms');
const _statsVis = (getPrefs().statsVisibility) || {};

let myTrips  = [];
let allTrips = [];  // all trips (for crew name lookups across users)
let allBoats = [], allLocs = [], allMembers = [];
let allRecentTrips = [];
let recentOffset   = 0;
const RECENT_PAGE  = 10;

// ── File upload state ─────────────────────────────────────────────────────────
let _pendingTrack  = null;   // {fileName, fileData (base64), mimeType}
let _pendingPhotos = [];     // [{fileName, fileData (base64), mimeType}]
let _lastPortInput = null;   // which port input was last typed into
let _selectedClubTrip = null;

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function parseDateParts(d){
  if(!d) return{day:'—',mon:'',yr:''};
  return{day:d.slice(8,10)||'—',mon:String(new Date(d+'T12:00:00').getMonth()+1).padStart(2,'0'),yr:d.slice(0,4)};
}
function bftLabel(b){
  const n=parseInt(b);
  if (!isNaN(n) && n>=0 && n<=12) return s('wx.bft'+n);
  return s('wx.force')+' '+b;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function renderStats(){
  const year=String(new Date().getFullYear());
  const season=myTrips.filter(t=>(t.date||'').startsWith(year));
  const hours=myTrips.reduce((s,t)=>s+(parseFloat(t.hoursDecimal)||0),0);
  const skipperTrips=myTrips.filter(t=>!t.role||t.role==='skipper');

  // New stats calculations
  const totalNm=myTrips.reduce((s,t)=>s+(parseFloat(t.distanceNm)||0),0);
  const longestH=myTrips.reduce((m,t)=>Math.max(m,parseFloat(t.hoursDecimal)||0),0);
  const bftTrips=myTrips.filter(t=>t.beaufort!==''&&t.beaufort!=null&&!isNaN(parseFloat(t.beaufort)));
  const avgBft=bftTrips.length?bftTrips.reduce((s,t)=>s+parseFloat(t.beaufort),0)/bftTrips.length:0;
  // Beaufort midpoint m/s lookup for unit conversion
  const _bftMs=[0,0.8,2.4,4.4,6.7,9.4,12.3,15.5,18.9,22.6,26.5,30.6,34];
  const avgBftMs=avgBft?_bftMs[Math.round(avgBft)]||avgBft*2.5:0;
  // Streak: consecutive weeks with at least one trip (counting back from current week)
  let streak=0;
  if(myTrips.length){
    const toISOWeek=d=>{const dt=new Date(d);dt.setHours(0,0,0,0);dt.setDate(dt.getDate()+3-(dt.getDay()+6)%7);const w1=new Date(dt.getFullYear(),0,4);return dt.getFullYear()+'-W'+(1+Math.round(((dt-w1)/864e5-3+(w1.getDay()+6)%7)/7)).toString().padStart(2,'0')};
    const weeks=new Set(myTrips.map(t=>t.date?toISOWeek(t.date):null).filter(Boolean));
    const now=new Date();let d=new Date(now);
    while(true){const wk=toISOWeek(d);if(!weeks.has(wk))break;streak++;d.setDate(d.getDate()-7)}
  }
  const uniqueBoats=new Set(myTrips.map(t=>t.boatId||t.boatName).filter(Boolean)).size;
  const crewTrips=myTrips.filter(t=>t.role==='crew').length;
  const heavyWx=myTrips.filter(t=>(parseInt(t.beaufort)||0)>=5).length;
  const avgDur=myTrips.length?hours/myTrips.length:0;
  const uniqueLocs=new Set(myTrips.map(t=>t.locationName||t.locationId).filter(Boolean)).size;
  const verifiedTrips=myTrips.filter(t=>t.verified&&t.verified!=='false').length;
  // Hours spent at the helm (includes crew-while-helming, the common use case)
  const helmHours=myTrips.filter(t=>t.helm&&t.helm!=='false').reduce((s,t)=>s+(parseFloat(t.hoursDecimal)||0),0);
  // Trips logged as a student
  const studentTrips=myTrips.filter(t=>t.student&&t.student!=='false').length;
  // Favorite boat: most hours aggregated by boatId (fall back to boatName)
  const boatHours={},boatNames={};
  myTrips.forEach(t=>{
    const id=t.boatId||t.boatName;if(!id)return;
    boatHours[id]=(boatHours[id]||0)+(parseFloat(t.hoursDecimal)||0);
    if(!boatNames[id])boatNames[id]=(allBoats.find(b=>b.id===t.boatId)?.name)||t.boatName||id;
  });
  let favBoatName='',favBoatH=0;
  Object.entries(boatHours).forEach(([id,h])=>{if(h>favBoatH){favBoatH=h;favBoatName=boatNames[id]}});
  // Favorite location: most trips at a named location
  const locCount={};
  myTrips.forEach(t=>{const n=t.locationName||t.locationId;if(n)locCount[n]=(locCount[n]||0)+1});
  let favLocName='',favLocN=0;
  Object.entries(locCount).forEach(([n,c])=>{if(c>favLocN){favLocN=c;favLocName=n}});
  // Peak wind: highest Beaufort recorded across logged trips
  const peakBft=myTrips.reduce((m,t)=>{const b=parseInt(t.beaufort);return isNaN(b)?m:Math.max(m,b)},0);
  const peakBftMs=peakBft?(_bftMs[peakBft]||peakBft*2.5):0;

  // Apply stats visibility preferences
  const stTripsEl=document.getElementById('stTrips');
  const stHoursEl=document.getElementById('stHours');
  const stSeasonEl=document.getElementById('stSeason');
  const stSkipperEl=document.getElementById('stSkipper');
  const stDistanceEl=document.getElementById('stDistance');
  const stLongestEl=document.getElementById('stLongest');
  const stAvgWindEl=document.getElementById('stAvgWind');
  const stStreakEl=document.getElementById('stStreak');
  const stBoatsEl=document.getElementById('stBoats');
  const stCrewEl=document.getElementById('stCrew');
  const stHeavyEl=document.getElementById('stHeavy');
  const stAvgDurEl=document.getElementById('stAvgDuration');
  const stLocsEl=document.getElementById('stLocations');
  const stVerifiedEl=document.getElementById('stVerified');
  const stHelmHoursEl=document.getElementById('stHelmHours');
  const stStudentEl=document.getElementById('stStudent');
  const stFavBoatEl=document.getElementById('stFavBoat');
  const stFavLocEl=document.getElementById('stFavLocation');
  const stPeakWindEl=document.getElementById('stPeakWind');

  if(!isStatVisible('career',_statsVis)){stTripsEl.parentElement.style.display='none'}else{stTripsEl.textContent=myTrips.length}
  if(!isStatVisible('hours',_statsVis)){stHoursEl.parentElement.style.display='none'}else{stHoursEl.textContent=hours.toFixed(0)+'h'}
  if(!isStatVisible('ytd',_statsVis)){stSeasonEl.parentElement.style.display='none'}else{stSeasonEl.textContent=season.length}
  if(!isStatVisible('skipper',_statsVis)){stSkipperEl.parentElement.style.display='none'}else{stSkipperEl.textContent=skipperTrips.length}
  if(!isStatVisible('distance',_statsVis)){stDistanceEl.parentElement.style.display='none'}else{stDistanceEl.textContent=totalNm.toFixed(0)+' nm'}
  if(!isStatVisible('longest',_statsVis)){stLongestEl.parentElement.style.display='none'}else{stLongestEl.textContent=longestH.toFixed(1)+'h'}
  if(!isStatVisible('avgWind',_statsVis)){stAvgWindEl.parentElement.style.display='none'}else{
    if(!avgBft){stAvgWindEl.textContent='—'}
    else if(_windUnit==='bft'){stAvgWindEl.textContent='F '+avgBft.toFixed(1)}
    else{stAvgWindEl.textContent=convertWind(avgBftMs,_windUnit)+' '+windUnitLabel(_windUnit)}
  }
  if(!isStatVisible('streak',_statsVis)){stStreakEl.parentElement.style.display='none'}else{stStreakEl.textContent=streak?streak+'w':'—'}
  if(!isStatVisible('boats',_statsVis)){stBoatsEl.parentElement.style.display='none'}else{stBoatsEl.textContent=uniqueBoats}
  if(!isStatVisible('crew',_statsVis)){stCrewEl.parentElement.style.display='none'}else{stCrewEl.textContent=crewTrips}
  if(!isStatVisible('heavy',_statsVis)){stHeavyEl.parentElement.style.display='none'}else{stHeavyEl.textContent=heavyWx}
  if(!isStatVisible('avgDuration',_statsVis)){stAvgDurEl.parentElement.style.display='none'}else{stAvgDurEl.textContent=avgDur?avgDur.toFixed(1)+'h':'—'}
  if(!isStatVisible('locations',_statsVis)){stLocsEl.parentElement.style.display='none'}else{stLocsEl.textContent=uniqueLocs}
  if(!isStatVisible('verified',_statsVis)){stVerifiedEl.parentElement.style.display='none'}else{stVerifiedEl.textContent=verifiedTrips}
  if(!isStatVisible('helmHours',_statsVis)){stHelmHoursEl.parentElement.style.display='none'}else{stHelmHoursEl.textContent=helmHours?helmHours.toFixed(0)+'h':'—'}
  if(!isStatVisible('student',_statsVis)){stStudentEl.parentElement.style.display='none'}else{stStudentEl.textContent=studentTrips}
  if(!isStatVisible('favBoat',_statsVis)){stFavBoatEl.parentElement.style.display='none'}else{stFavBoatEl.textContent=favBoatName||'—';stFavBoatEl.title=favBoatName?favBoatName+' — '+favBoatH.toFixed(0)+'h':''}
  if(!isStatVisible('favLocation',_statsVis)){stFavLocEl.parentElement.style.display='none'}else{stFavLocEl.textContent=favLocName||'—';stFavLocEl.title=favLocName?favLocName+' — '+favLocN+' trips':''}
  if(!isStatVisible('peakWind',_statsVis)){stPeakWindEl.parentElement.style.display='none'}else{
    if(!peakBft){stPeakWindEl.textContent='—'}
    else if(_windUnit==='bft'){stPeakWindEl.textContent='F '+peakBft}
    else{stPeakWindEl.textContent=convertWind(peakBftMs,_windUnit)+' '+windUnitLabel(_windUnit)}
  }

  // Adjust grid columns based on visible cards
  const visKeys=['career','hours','ytd','skipper','distance','longest','avgWind','streak','boats','crew','heavy','avgDuration','locations','verified','helmHours','student','favBoat','favLocation','peakWind'];
  const visibleCards=visKeys.filter(k=>isStatVisible(k,_statsVis)).length;
  const strip=document.querySelector('.stat-strip');
  if(strip && visibleCards>0){strip.style.gridTemplateColumns='repeat('+Math.min(visibleCards,4)+',1fr)';strip.style.display='grid'}
  else if(strip && visibleCards===0){strip.style.display='none'}

  if(!isStatVisible('byCategory',_statsVis)){document.getElementById('catHours').style.display='none';return}

  const catH={};
  myTrips.forEach(t=>{
    const c=(allBoats.find(b=>b.id===t.boatId)?.category)||t.boatCategory||'Other';
    catH[c]=(catH[c]||0)+(parseFloat(t.hoursDecimal)||0);
  });
  const entries=Object.entries(catH).sort(([,a],[,b])=>b-a);
  if(entries.length>1){
    const max=entries[0][1];
    document.getElementById('catHoursList').innerHTML=entries.map(([cat,h])=>{
      const col=BOAT_CAT_COLORS[(cat||'').toLowerCase()]||BOAT_CAT_COLORS.other;
      const pct=max?Math.round(h/max*100):0;
      return `<div class="cat-hour-row">
        <span class="text-lg" style="width:20px;text-align:center">${boatEmoji(cat.toLowerCase())}</span>
        <span style="min-width:80px;color:var(--text)">${esc(_boatCatLabel(cat))}</span>
        <div class="cat-hour-bar-wrap"><div class="cat-hour-bar" style="width:${pct}%;background:${col.color}"></div></div>
        <span class="cat-hour-val">${h.toFixed(0)}h</span>
      </div>`;
    }).join('');
    document.getElementById('catHours').style.display='';
  }
}

// ── Certs ─────────────────────────────────────────────────────────────────────
async function renderCerts(){
  const el=document.getElementById('certsList');
  try{
    const [mRes,cfgRes]=await Promise.all([apiGet('getMembers'),apiGet('getConfig')]);
    const certDefs=certDefsFromConfig(cfgRes.certDefs||[]);
    const certCategories=certCategoriesFromConfig(cfgRes.certCategories||[]);
    const member=(mRes.members||[]).find(m=>String(m.kennitala)===String(user.kennitala))||{};
    const certs=enrichMemberCerts(parseJson(member.certifications,[]),certDefs,certCategories);
    if(!certs.length){el.innerHTML=`<div class="empty-note">${s('cert.noCerts')}</div>`;return;}
    certInjectStyles();
    const {credentials,endorsements}=groupCerts(certs);
    let html=credentials.map(certCardHTML).join('');
    if(endorsements.length){
      html+=`<div class="ccard-endorsement-hdr">${s('cert.clubEndorsements')}</div>`;
      html+=endorsements.map(certCardHTML).join('');
    }
    el.innerHTML=html;
  }catch(e){
    el.innerHTML=`<div class="empty-note text-red">${s('cert.loadError')}</div>`;
  }
}

// ── Member heatmap ───────────────────────────────────────────────────────────
let _hmMap = null, _hmHeatLayer = null, _hmMarkers = [], _hmTrackLines = [];
let _hmMode = 'trips'; // 'trips' | 'time' | 'tracks'

function buildLocStats() {
  const stats = {}; // locationId → { count, hours }
  myTrips.forEach(t => {
    const lid = t.locationId || '';
    if (!lid) return;
    if (!stats[lid]) stats[lid] = { count: 0, hours: 0 };
    stats[lid].count++;
    stats[lid].hours += parseFloat(t.hoursDecimal) || 0;
  });
  const result = [];
  Object.keys(stats).forEach(lid => {
    const loc = allLocs.find(l => l.id === lid);
    if (!loc || !loc.coordinates) return;
    const parts = String(loc.coordinates).split(',');
    if (parts.length < 2) return;
    const lat = parseFloat(parts[0]), lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return;
    result.push({ id: lid, name: loc.name || lid, lat, lng, tripCount: stats[lid].count, totalHours: Math.round(stats[lid].hours * 10) / 10 });
  });
  return result;
}

function getAllTrackPoints() {
  const allPts = [];
  myTrips.forEach(t => {
    if (!t.trackSimplified) return;
    try {
      const pts = JSON.parse(t.trackSimplified);
      if (Array.isArray(pts)) pts.forEach(p => {
        if (typeof p.lat === 'number' && typeof p.lng === 'number') allPts.push(p);
      });
    } catch(e) {}
  });
  return allPts;
}

function getTrackLines() {
  const lines = [];
  myTrips.forEach(t => {
    if (!t.trackSimplified) return;
    try {
      const pts = JSON.parse(t.trackSimplified);
      if (Array.isArray(pts) && pts.length >= 2) {
        lines.push(pts.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number'));
      }
    } catch(e) {}
  });
  return lines;
}

async function initMemberHeatmap() {
  if (getPref('showHeatmap', true) === false) return;

  const locData = buildLocStats();
  const trackPts = getAllTrackPoints();
  if (!locData.length && !trackPts.length) return;

  document.getElementById('memberHeatmapWrap').style.display = '';

  await loadLeaflet();
  if (_hmMap) { _hmMap.remove(); _hmMap = null; }
  _hmMap = L.map('memberHeatmap', { zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.25 });
  addSeaLayers(_hmMap);

  renderHeatMode();
}

function clearHeatLayers() {
  if (_hmHeatLayer) { _hmMap.removeLayer(_hmHeatLayer); _hmHeatLayer = null; }
  _hmMarkers.forEach(m => _hmMap.removeLayer(m));
  _hmMarkers = [];
  _hmTrackLines.forEach(l => _hmMap.removeLayer(l));
  _hmTrackLines = [];
}

function renderHeatMode() {
  if (!_hmMap) return;
  clearHeatLayers();

  if (_hmMode === 'tracks') {
    renderTrackMode();
  } else {
    renderLocationMode();
  }
}

function renderLocationMode() {
  const locData = buildLocStats();
  if (!locData.length) {
    _hmMap.setView([64.148, -21.965], 11.25);
    return;
  }

  const isTime = _hmMode === 'time';
  const maxVal = locData.reduce((m, l) => Math.max(m, isTime ? l.totalHours : l.tripCount), 1);

  const heatData = locData.map(l => [l.lat, l.lng, (isTime ? l.totalHours : l.tripCount) / maxVal]);
  _hmHeatLayer = L.heatLayer(heatData, {
    radius: 30, blur: 20, maxZoom: 14, max: 1.0,
    gradient: { 0.2: '#1e3f6e', 0.4: '#2e86c1', 0.6: '#f1c40f', 0.8: '#e67e22', 1.0: '#e74c3c' }
  }).addTo(_hmMap);

  locData.forEach(l => {
    const intensity = (isTime ? l.totalHours : l.tripCount) / maxVal;
    const radius = Math.max(6, Math.min(20, 6 + intensity * 14));
    const valLabel = isTime
      ? l.totalHours + 'h'
      : l.tripCount + (l.tripCount === 1 ? ' trip' : ' trips');
    const marker = L.circleMarker([l.lat, l.lng], {
      radius, color: '#d4af37', fillColor: '#d4af37', fillOpacity: 0.3, weight: 1,
    }).bindTooltip(
      '<strong>' + esc(l.name) + '</strong><br>' + valLabel + ' &middot; ' + l.totalHours + 'h',
      { className: 'map-tooltip' }
    ).addTo(_hmMap);
    _hmMarkers.push(marker);
  });

  const bounds = L.latLngBounds(locData.map(l => [l.lat, l.lng]));
  _hmMap.fitBounds(bounds.pad(0.15), { maxZoom: 11 });
}

function renderTrackMode() {
  const lines = getTrackLines();
  if (!lines.length) {
    _hmMap.setView([64.148, -21.965], 11.25);
    return;
  }

  const allPts = [];
  lines.forEach(pts => {
    const latlngs = pts.map(p => [p.lat, p.lng]);
    allPts.push(...latlngs);
    const line = L.polyline(latlngs, { color: '#d4af37', weight: 2, opacity: 0.6 }).addTo(_hmMap);
    _hmTrackLines.push(line);
  });

  // Add a subtle heat layer from track point density
  if (allPts.length) {
    _hmHeatLayer = L.heatLayer(allPts.map(p => [p[0], p[1], 0.5]), {
      radius: 20, blur: 15, maxZoom: 14, max: 1.0,
      gradient: { 0.2: '#1e3f6e', 0.4: '#2e86c1', 0.6: '#f1c40f', 0.8: '#e67e22', 1.0: '#e74c3c' }
    }).addTo(_hmMap);
  }

  const bounds = L.latLngBounds(allPts);
  _hmMap.fitBounds(bounds.pad(0.1), { maxZoom: 11 });
}

function setHeatMode(mode) {
  _hmMode = mode;
  document.querySelectorAll('.heatmap-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  renderHeatMode();
}

// Populate shared weather-field markup (from shared/trip-form.js) into both
// modals. Runs inline right after the last <div id="*WxFields"> is parsed,
// before shared/logbook.js (deferred) runs — so logbook.js's init can rely
// on the fields already existing.
(function () {
  var mWx  = document.getElementById('mWxFields');
  var etWx = document.getElementById('etWxFields');
  if (mWx)  mWx.innerHTML  = tripFormWeatherFieldsHtml('m',  { verboseBft: true, includeFeelsLike: true, wrapExtraInDetails: true });
  if (etWx) etWx.innerHTML = tripFormWeatherFieldsHtml('et', { extraStep: '0.1' });
  // logModal's wind/gust inputs had inline handlers in the original markup;
  // rewire via addEventListener now that the fields exist.
  var mBft  = document.getElementById('mBft');
  var mWind = document.getElementById('mWindMs');
  var mGust = document.getElementById('mWindGust');
  if (mBft)  mBft.addEventListener('change', function () { if (typeof onBftChange  === 'function') onBftChange();  });
  if (mWind) mWind.addEventListener('input', function () { if (typeof onWindInput === 'function') onWindInput(); });
  if (mGust) mGust.addEventListener('input', function () { if (typeof onGustInput === 'function') onGustInput(); });
})();

(function () {
  if (typeof document === 'undefined' || document._lbListeners) return;
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
    var tf = e.target.closest('[data-lb-time-format]');
    if (tf) {
      var v = tf.value.replace(/[^0-9]/g, '');
      if (v.length >= 2) v = v.slice(0, 2) + ':' + v.slice(2, 4);
      tf.value = v;
      return;
    }
    var ie = e.target.closest('[data-lb-input-el]');
    if (ie && typeof window[ie.dataset.lbInputEl] === 'function') { window[ie.dataset.lbInputEl](ie, ie.dataset.lbArg); return; }
    var i = e.target.closest('[data-lb-input]');
    if (i && typeof window[i.dataset.lbInput] === 'function') window[i.dataset.lbInput](i.dataset.lbArg);
  });
})();
