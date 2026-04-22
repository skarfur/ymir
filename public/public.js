// ── Event wiring (replaces inline onclicks; CSP blocks those) ──────────
document.getElementById('lang-toggle').addEventListener('click', function() { toggleLang(); });
document.addEventListener('click', function(e) {
  var hmBtn = e.target.closest('.cap-hm-btn');
  if (hmBtn && hmBtn.dataset.capCi != null) {
    setCapHM(parseInt(hmBtn.dataset.capCi, 10), hmBtn.dataset.mode);
    return;
  }
  var moreBtn = e.target.closest('.cap-show-more');
  if (moreBtn && moreBtn.dataset.capCi != null) {
    showCapTrips(parseInt(moreBtn.dataset.capCi, 10), parseInt(moreBtn.dataset.capTotal, 10));
  }
});

// ── Minimal esc() since we don't load ui.js ──
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

var REFRESH_MS = 5 * 60 * 1000; // 5 minutes
var _map = null;
var _heatLayer = null;
var _staffStatus = null;
var _wxWidgetInstance = null;
var _tideWidgetInstance = null;

function lang() { return (typeof getLang === 'function') ? getLang() : 'IS'; }

function toggleLang() {
  var next = lang() === 'EN' ? 'IS' : 'EN';
  if (typeof setLang === 'function') setLang(next);
  location.reload();
}

function applyStaticText() {
  document.getElementById('hdr-subtitle').textContent = s('pub.dash.subtitle');
  document.getElementById('lang-toggle').textContent = lang() === 'EN' ? 'IS' : 'EN';
  document.getElementById('loading-text').textContent = s('pub.dash.loading');
}

async function fetchDashboard() {
  return _call('dashboard', {});
}

function renderDashboard(data) {
  var L_ = lang();
  var IS = L_ === 'IS';
  var main = document.getElementById('main-content');
  var html = '';

  // Store staff status globally for wxWidget callback
  _staffStatus = data.staffStatus || null;

  // Load flag config if provided
  if (data.flagConfig && typeof wxLoadFlagConfig === 'function') {
    wxLoadFlagConfig(data.flagConfig);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 0) ON THE WATER — stat strip at the very top
  // ═══════════════════════════════════════════════════════════════════
  html += '<section>';
  html += '<h2><span class="live-badge"></span>' + esc(s('pub.dash.onWater')) + '</h2>';
  html += '<div class="stat-strip">';
  html += '<div class="strip-cell"><div class="strip-n">' + esc(data.onWater.boatCount) + '</div><div class="strip-l">' + esc(s('staff.statBoats')) + '</div></div>';
  html += '<div class="strip-cell"><div class="strip-n">' + esc(data.onWater.peopleCount) + '</div><div class="strip-l">' + esc(s('staff.statPeople')) + '</div></div>';
  html += '</div>';
  html += '</section>';

  // ═══════════════════════════════════════════════════════════════════
  // 1) TWO COLUMNS — left: flag + duty + boats | right: weather + tide
  // ═══════════════════════════════════════════════════════════════════
  html += '<section>';
  html += '<div class="two-col">';

  // ── Left column ──
  html += '<div>';

  // Flag banner (populated by wxWidget onData callback)
  html += '<div class="flag-banner-wrap" id="pub-flag-banner"><div style="color:var(--muted);font-size:11px;font-style:italic">Loading conditions…</div></div>';

  // Duty status pills
  html += '<div class="duty-pills" id="pub-duty-pills"></div>';

  // Boats out cards
  html += '<h2 style="margin-top:4px">' + esc(s('pub.dash.boatsOut')) + '</h2>';
  if (data.onWater.boatCount > 0) {
    html += '<div class="water-grid">';
    data.onWater.boats.forEach(function(b) {
      html += '<div class="water-card">'
        + '<div class="water-emoji">' + esc(b.emoji || '⛵') + '</div>'
        + '<div>'
        + '<div class="water-name">' + esc(b.boatName) + '</div>'
        + (b.locationName ? '<div class="water-loc">' + esc(b.locationName) + '</div>' : '')
        + '</div></div>';
    });
    html += '</div>';
  } else {
    html += '<div class="empty-msg">' + esc(s('pub.dash.noActivity')) + '</div>';
  }
  html += '</div>';

  // ── Right column ──
  html += '<div>';
  html += '<h2>' + esc(s('pub.dash.weather')) + '</h2>';
  // Weather widget container (populated after render by wxWidget)
  html += '<div id="pub-wx-widget" class="wx-widget" style="min-height:120px"><div style="color:var(--muted);font-size:11px;font-style:italic">Loading weather…</div></div>';
  // Tide widget container (populated after render by tideWidget)
  html += '<div id="pub-tide-widget" style="margin-top:14px"></div>';
  html += '</div>';

  html += '</div>'; // end .two-col
  html += '</section>';

   // ═══════════════════════════════════════════════════════════════════
  // 2) MEMBERSHIP — active members count + become-a-member CTA
  // ═══════════════════════════════════════════════════════════════════
  html += '<section>';
  html += '<div class="membership-row">';
  html += '<div class="stat-box"><div class="stat-val">' + esc(data.activeMembers || 0) + '</div><div class="stat-lbl">' + esc(s('pub.dash.activeMembers')) + '</div></div>';
  html += '<a class="become-member-btn" href="https://www.abler.io/shop/siglingafelagid/1" target="_blank" rel="noopener">' + esc(s('pub.dash.becomeMember')) + '</a>';
  html += '</div>';
  html += '</section>';
  
  // ═══════════════════════════════════════════════════════════════════
  // 3) HEATMAP + YTD STATS + future text
  // ═══════════════════════════════════════════════════════════════════
  html += '<section>';
  html += '<h2>' + esc(s('pub.dash.locations')) + '</h2>';
  html += '<div class="map-stats">';
  html += '<div id="map-container"></div>';
  html += '<div class="ytd-sidebar">';
  html += '<div class="stat-box"><div class="stat-val">' + esc(data.ytd.totalTrips) + '</div><div class="stat-lbl">' + esc(s('pub.dash.ytdTrips')) + '</div></div>';
  html += '<div class="stat-box"><div class="stat-val">' + esc(data.ytd.totalHours) + '</div><div class="stat-lbl">' + esc(s('pub.dash.totalHours')) + '</div></div>';
  if (data.ytd.byCategory && data.ytd.byCategory.length) {
    html += '<h3>' + esc(s('pub.dash.byCategory')) + '</h3>';
    data.ytd.byCategory.forEach(function(c) {
      var label = IS ? (c.labelIS || c.labelEN) : c.labelEN;
      html += '<div class="cat-card">'
        + '<div class="cat-emoji">' + esc(c.emoji) + '</div>'
        + '<div class="cat-info">'
        + '<div class="cat-name">' + esc(label) + '</div>'
        + '<div class="cat-detail">' + esc(s('pub.dash.tripCount', { n: c.count })) + ' &middot; ' + esc(s('pub.dash.hourCount', { n: c.hours })) + '</div>'
        + '</div></div>';
    });
  }
  html += '</div>';

  // Future text placeholder
  html += '<div class="future-text"><p>' + esc(s('pub.dash.comingSoon')) + '</p></div>';
  html += '</div>';

  html += '</section>';

  // ═══════════════════════════════════════════════════════════════════
  // 4) CAPTAINS — profile, trips, heatmap per captain
  // ═══════════════════════════════════════════════════════════════════
  html += '<section>';
  html += '<h2>' + esc(s('pub.dash.captainData')) + '</h2>';
  if (data.captains && data.captains.length) {
    html += '<div class="captain-list">';
    data.captains.forEach(function(cap, ci) {
      html += '<div class="captain-card">';

      // ── Header: headshot + name/stats ──
      html += '<div class="captain-header">';
      if (cap.headshotUrl) {
        var hsUrl = cap.headshotUrl;
        var dm = hsUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (dm) hsUrl = 'https://drive.google.com/thumbnail?id=' + dm[1] + '&sz=w200';
        html += '<img class="captain-headshot" src="' + esc(hsUrl) + '" alt="' + esc(cap.name) + '">';
      } else {
        html += '<div class="captain-headshot-ph">&#9875;</div>';
      }
      html += '<div>';
      html += '<div class="captain-name">' + esc(cap.name) + '</div>';
      html += '<div class="captain-stats">'
        + '<span>' + esc(cap.tripCount) + ' ' + esc(s('pub.dash.trips')) + '</span>'
        + '<span>' + esc(cap.totalHours) + 'h</span>'
        + '<span>' + esc(cap.totalDist || 0) + ' nm</span>'
        + '</div>';
      html += '</div></div>';

      // ── Bio ──
      if (cap.bio) {
        html += '<div class="captain-bio">' + esc(cap.bio) + '</div>';
      }

      // ── Certs ──
      if (cap.certs && cap.certs.length) {
        var capIS = lang() === 'IS';
        html += '<div class="captain-certs">';
        cap.certs.forEach(function(c) {
          var lbl = capIS ? (c.labelIS || c.labelEN || c.label || '') : (c.labelEN || c.label || '');
          html += '<span class="cert-badge">' + esc(lbl) + '</span>';
        });
        html += '</div>';
      }

      // ── Heatmap ──
      if ((cap.locations && cap.locations.length) || (cap.trackLines && cap.trackLines.length)) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between">'
          + '<span style="font-size:9px;color:var(--muted);letter-spacing:1px;text-transform:uppercase">Heatmap</span>'
          + '<div class="cap-hm-toggle" data-ci="' + ci + '">'
          + '<button class="cap-hm-btn active" data-mode="trips"  data-cap-ci="' + ci + '">Trips</button>'
          + '<button class="cap-hm-btn"        data-mode="time"   data-cap-ci="' + ci + '">Time</button>'
          + '<button class="cap-hm-btn"        data-mode="tracks" data-cap-ci="' + ci + '">Tracks</button>'
          + '</div></div>';
        html += '<div class="cap-heatmap" id="capmap-' + ci + '"></div>';
      }

      // ── Keelboat trips table ──
      if (cap.trips && cap.trips.length) {
        var initShow = 10;
        html += '<div style="overflow-x:auto;margin-top:8px;border:1px solid var(--border);border-radius:8px">'
          + '<table class="cap-trip-table"><tr>'
          + '<th>' + esc(IS ? 'Dags.' : 'Date') + '</th>'
          + '<th>' + esc(IS ? 'Bátur' : 'Boat') + '</th>'
          + '<th>' + esc(IS ? 'Gerð' : 'Make/Model') + '</th>'
          + '<th>' + esc(IS ? 'Staðsetning' : 'Location') + '</th>'
          + '<th>' + esc(IS ? 'Áhöfn' : 'Crew') + '</th>'
          + '<th>' + esc(IS ? 'Tími' : 'Time') + '</th>'
          + '<th>' + esc(IS ? 'Vegalengd' : 'Distance') + '</th>'
          + '</tr>';
        cap.trips.forEach(function(t, ti) {
          html += '<tr' + (ti >= initShow ? ' class="cap-extra-row-' + ci + '" style="display:none"' : '') + '>'
            + '<td>' + esc(t.date) + '</td>'
            + '<td>' + esc(t.boatName) + '</td>'
            + '<td>' + esc(t.makeModel) + '</td>'
            + '<td class="loc-col">' + esc(t.location) + '</td>'
            + '<td style="text-align:center">' + esc(t.crew) + '</td>'
            + '<td>' + (t.duration ? esc(t.duration) + 'h' : '') + '</td>'
            + '<td>' + (t.distance ? esc(t.distance) + ' nm' : '') + '</td>'
            + '</tr>';
        });
        html += '</table></div>';
        if (cap.trips.length > initShow) {
          html += '<button class="cap-show-more" id="cap-more-' + ci + '" data-cap-ci="' + ci + '" data-cap-total="' + cap.trips.length + '">'
            + esc(IS ? 'Sýna fleiri' : 'Show all') + ' (' + (cap.trips.length - initShow) + ' ' + esc(IS ? 'í viðbót' : 'more') + ')</button>';
        }
      }

      html += '</div>';
    });
    html += '</div>';
  } else {
    html += '<div class="captain-placeholder"><p>' + esc(s('pub.dash.captainSoon')) + '</p></div>';
  }
  html += '</section>';

  main.innerHTML = html;

  // Footer
  var footer = document.getElementById('footer');
  footer.style.display = '';
  var now = new Date();
  var timeStr = fmtTimeNow();
  document.getElementById('footer-text').textContent = s('pub.dash.lastUpdated') + ' ' + timeStr;

  // ── Render duty status pills ──
  renderDutyPills();

  // ── Init map after DOM has laid out ──
  setTimeout(function() { initMap(data.locations || []); }, 50);

  // ── Init weather widget (right column) ──
  initWeatherWidget();

  // ── Init tide widget (right column) ──
  initTideWidget();
}

function renderDutyPills() {
  var el = document.getElementById('pub-duty-pills');
  if (!el || !_staffStatus) { if (el) el.innerHTML = ''; return; }
  var IS = lang() === 'IS';
  var bst = 'display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:20px;border:1px solid;font-size:11px;font-weight:500;white-space:nowrap;';
  var dc  = _staffStatus.onDuty      ? 'var(--blue)' : 'var(--orange)';
  var bc  = _staffStatus.supportBoat ? 'var(--blue)' : 'var(--orange)';
  var dbg = _staffStatus.onDuty      ? 'color-mix(in srgb, var(--blue) 10%, transparent);border-color:color-mix(in srgb, var(--blue) 27%, transparent)' : 'color-mix(in srgb, var(--orange) 10%, transparent);border-color:color-mix(in srgb, var(--orange) 27%, transparent)';
  var bbg = _staffStatus.supportBoat ? 'color-mix(in srgb, var(--blue) 10%, transparent);border-color:color-mix(in srgb, var(--blue) 27%, transparent)' : 'color-mix(in srgb, var(--orange) 10%, transparent);border-color:color-mix(in srgb, var(--orange) 27%, transparent)';
  var dtx = IS ? (_staffStatus.onDuty      ? 'Starfsmaður á vakt' : 'Enginn starfsmaður')
               : (_staffStatus.onDuty      ? 'Staff on duty'      : 'No staff on duty');
  var btx = IS ? (_staffStatus.supportBoat ? 'Björgunarbátur á sjó' : 'Enginn björgunarbátur')
               : (_staffStatus.supportBoat ? 'Support boat out'     : 'No support boat');
  el.innerHTML =
    '<span style="' + bst + 'background:' + dbg + ';color:' + dc + '">' + DUTY_ICONS[_staffStatus.onDuty ? 'lifebuoy' : 'lifebuoyOff'] + dtx + '</span>'
    + '<span style="' + bst + 'background:' + bbg + ';color:' + bc + '">' + DUTY_ICONS[_staffStatus.supportBoat ? 'ship' : 'shipOff'] + btx + '</span>';
}

function renderFlagBanner(result) {
  var el = document.getElementById('pub-flag-banner');
  if (!el || !result) return;
  var IS = lang() === 'IS';
  var flag = result.flag;
  var advice = (IS && flag.adviceIS) ? flag.adviceIS : flag.advice;

  // Clickable chips for contributing factors
  var chipsHtml = '';
  var considerations = (result.breakdown || []).filter(function(b) { return b.pts > 0; });
  if (considerations.length) {
    chipsHtml = '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:10px">';
    considerations.forEach(function(b) {
      chipsHtml += '<span style="font-size:10px;padding:2px 8px;border-radius:16px;border:1px solid '
        + flag.border + ';color:' + flag.color + ';background:' + flag.bg + '">'
        + esc(b.label)
        + ' <b>+' + b.pts + '</b></span>';
    });
    chipsHtml += '</div>';
  }

  el.innerHTML =
    '<div id="pub-flag-click" style="background:' + flag.bg + ';border:1px solid ' + flag.border + ';border-radius:10px;padding:14px 16px;cursor:pointer">'
    + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">'
    + '<span style="font-size:28px">' + flag.icon + '</span>'
    + '<div style="font-size:14px;font-weight:600;color:' + flag.color + '">' + esc(advice) + '</div>'
    + '</div>'
    + chipsHtml
    + '</div>';

  // Wire click → flag detail modal (shared helper in shared/weather.js)
  var clickEl = document.getElementById('pub-flag-click');
  if (clickEl) {
    clickEl.onclick = function() {
      var IS2 = lang() === 'IS';
      showWxFlagModal(
        flag.icon + ' · ' + result.score + (IS2 ? ' stig' : ' pts'),
        wxFlagDetailHtml(result, _staffStatus, IS2 ? 'IS' : 'EN')
      );
    };
  }
}

function initWeatherWidget() {
  var el = document.getElementById('pub-wx-widget');
  if (!el) return;
  _wxWidgetInstance = wxWidget(el, {
    showRefreshBtn: false,
    getStaffStatus: function() { return _staffStatus; },
    onData: function(snap) {
      // Use the flag result from the weather widget to populate the left-column banner
      if (snap.flagResult) {
        renderFlagBanner(snap.flagResult);
      }
    }
  });
  _wxWidgetInstance.start();
}

function initTideWidget() {
  var el = document.getElementById('pub-tide-widget');
  if (!el) return;
  _tideWidgetInstance = tideWidget(el);
  _tideWidgetInstance.start();
}

function initMap(locations) {
  var el = document.getElementById('map-container');
  if (!el) return;

  if (_map) { _map.remove(); _map = null; }

  _map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.25 });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; CartoDB' }).addTo(_map);
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxNativeZoom: 17, maxZoom: 19, opacity: 0.9 }).addTo(_map);

  var valid = locations.filter(function(loc) {
    return typeof loc.lat === 'number' && typeof loc.lng === 'number' && !isNaN(loc.lat) && !isNaN(loc.lng);
  });

  _map.setView([64.148, -21.965], 11.25);

  if (!valid.length) {
    return;
  }

  var maxTrips = 1;
  valid.forEach(function(loc) { if (loc.tripCount > maxTrips) maxTrips = loc.tripCount; });

  var heatData = valid.map(function(loc) {
    return [loc.lat, loc.lng, loc.tripCount / maxTrips];
  });

  _heatLayer = L.heatLayer(heatData, {
    radius: 30, blur: 20, maxZoom: 14, max: 1.0,
    gradient: { 0.2: '#1e3f6e', 0.4: '#2e86c1', 0.6: '#f1c40f', 0.8: '#e67e22', 1.0: '#e74c3c' }
  }).addTo(_map);

  valid.forEach(function(loc) {
    var radius = Math.max(6, Math.min(20, 6 + (loc.tripCount / maxTrips) * 14));
    L.circleMarker([loc.lat, loc.lng], {
      radius: radius, color: '#d4af37', fillColor: '#d4af37', fillOpacity: 0.3, weight: 1,
    }).bindTooltip(
      '<strong>' + esc(loc.name) + '</strong><br>'
      + s('pub.dash.tripCount', { n: loc.tripCount }) + ' &middot; '
      + s('pub.dash.hourCount', { n: loc.totalHours }),
      { className: 'map-tooltip' }
    ).addTo(_map);
  });
}

// ── Captain heatmaps ──
var _capData = [];         // captains array from API
var _capMaps = {};         // ci → Leaflet map
var _capHeatLayers = {};   // ci → heat layer
var _capMarkers = {};      // ci → [markers]
var _capTrkLines = {};     // ci → [polylines]
var _capModes = {};        // ci → 'trips'|'time'|'tracks'

function initCapMaps() {
  if (!_capData.length) return;
  _capData.forEach(function(cap, ci) {
    var el = document.getElementById('capmap-' + ci);
    if (!el) return;
    if (_capMaps[ci]) { _capMaps[ci].remove(); _capMaps[ci] = null; }
    _capModes[ci] = 'trips';
    _capMarkers[ci] = [];
    _capTrkLines[ci] = [];
    var map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.25 });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxNativeZoom: 17, maxZoom: 19, opacity: 0.9 }).addTo(map);
    _capMaps[ci] = map;
    renderCapHM(ci);
  });
}

function clearCapHM(ci) {
  var map = _capMaps[ci]; if (!map) return;
  if (_capHeatLayers[ci]) { map.removeLayer(_capHeatLayers[ci]); _capHeatLayers[ci] = null; }
  (_capMarkers[ci] || []).forEach(function(m) { map.removeLayer(m); }); _capMarkers[ci] = [];
  (_capTrkLines[ci] || []).forEach(function(l) { map.removeLayer(l); }); _capTrkLines[ci] = [];
}

function renderCapHM(ci) {
  var map = _capMaps[ci]; if (!map) return;
  var cap = _capData[ci]; if (!cap) return;
  clearCapHM(ci);
  var mode = _capModes[ci] || 'trips';

  if (mode === 'tracks') {
    var lines = cap.trackLines || [];
    if (!lines.length) { map.setView([64.148, -21.965], 11.25); return; }
    var all = [];
    lines.forEach(function(pts) {
      var ll = pts.map(function(p) { return [p.lat, p.lng]; });
      all = all.concat(ll);
      var ln = L.polyline(ll, { color: '#d4af37', weight: 2, opacity: 0.6 }).addTo(map);
      _capTrkLines[ci].push(ln);
    });
    if (all.length) {
      _capHeatLayers[ci] = L.heatLayer(all.map(function(p) { return [p[0], p[1], 0.5]; }), {
        radius: 20, blur: 15, maxZoom: 14, max: 1.0,
        gradient: { 0.2: '#1e3f6e', 0.4: '#2e86c1', 0.6: '#f1c40f', 0.8: '#e67e22', 1.0: '#e74c3c' }
      }).addTo(map);
      map.fitBounds(L.latLngBounds(all).pad(0.1), { maxZoom: 11 });
    }
  } else {
    var locs = cap.locations || [];
    if (!locs.length) { map.setView([64.148, -21.965], 11.25); return; }
    var isTime = mode === 'time';
    var maxV = locs.reduce(function(m, l) { return Math.max(m, isTime ? l.hours : l.count); }, 1);
    var hd = locs.map(function(l) { return [l.lat, l.lng, (isTime ? l.hours : l.count) / maxV]; });
    _capHeatLayers[ci] = L.heatLayer(hd, {
      radius: 30, blur: 20, maxZoom: 14, max: 1.0,
      gradient: { 0.2: '#1e3f6e', 0.4: '#2e86c1', 0.6: '#f1c40f', 0.8: '#e67e22', 1.0: '#e74c3c' }
    }).addTo(map);
    locs.forEach(function(l) {
      var int = (isTime ? l.hours : l.count) / maxV;
      var r = Math.max(6, Math.min(20, 6 + int * 14));
      var vl = isTime ? l.hours + 'h' : l.count + (l.count === 1 ? ' trip' : ' trips');
      var mk = L.circleMarker([l.lat, l.lng], { radius: r, color: '#d4af37', fillColor: '#d4af37', fillOpacity: 0.3, weight: 1 })
        .bindTooltip('<strong>' + esc(l.name) + '</strong><br>' + vl + ' &middot; ' + l.hours + 'h').addTo(map);
      _capMarkers[ci].push(mk);
    });
    map.fitBounds(L.latLngBounds(locs.map(function(l) { return [l.lat, l.lng]; })).pad(0.15), { maxZoom: 11 });
  }
}

function setCapHM(ci, mode) {
  _capModes[ci] = mode;
  var toggle = document.querySelector('.cap-hm-toggle[data-ci="' + ci + '"]');
  if (toggle) {
    toggle.querySelectorAll('.cap-hm-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.mode === mode); });
  }
  renderCapHM(ci);
}

function showCapTrips(ci, total) {
  document.querySelectorAll('.cap-extra-row-' + ci).forEach(function(r) { r.style.display = ''; });
  var btn = document.getElementById('cap-more-' + ci);
  if (btn) btn.style.display = 'none';
}

function fmtTimeNow() {
  var n = new Date();
  return n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
}

async function load() {
  applyStaticText();
  try {
    var data = await fetchDashboard();
    _capData = data.captains || [];
    renderDashboard(data);
    setTimeout(function() { initCapMaps(); }, 100);
  } catch (e) {
    console.error('Dashboard load error:', e);
    document.getElementById('main-content').innerHTML = '<div class="error-msg">' + esc(s('pub.dash.error')) + '</div>';
  }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', function() {
  load();
  setInterval(function() { load(); }, REFRESH_MS);
});
