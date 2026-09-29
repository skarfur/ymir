// ── Event wiring (replaces inline onclicks; CSP blocks those) ──────────
document.getElementById('lang-toggle').addEventListener('click', function() { toggleLang(); });

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

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 19, attribution: 'Tiles &copy; Esri' }).addTo(_map);
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

function fmtTimeNow() {
  var n = new Date();
  return n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
}

async function load() {
  applyStaticText();
  try {
    var data = await fetchDashboard();
    renderDashboard(data);
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
