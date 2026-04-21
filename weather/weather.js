buildHeader('weather');

document.getElementById('geoBtn').addEventListener('click', useMyLocation);
document.getElementById('fossBtn').addEventListener('click', useFossvogur);
document.getElementById('refreshBtn').addEventListener('click', fetchAll);

// ═══════════════════════════════════════════════════════════════════════════════
// LOCATION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
const FOSSVOGUR = { lat: 64.1188, lon: -21.9376, label: 'Fossvogur' };
let CURRENT_LOC = { ...FOSSVOGUR, isDefault: true };

function updateLocDisplay() {
  document.getElementById('locName').textContent = CURRENT_LOC.label;
  const latStr = CURRENT_LOC.lat.toFixed(4) + '°' + (CURRENT_LOC.lat >= 0 ? 'N' : 'S');
  const lonStr = Math.abs(CURRENT_LOC.lon).toFixed(4) + '°' + (CURRENT_LOC.lon >= 0 ? 'E' : 'W');
  document.getElementById('locCoords').textContent = latStr + ' ' + lonStr;
  document.getElementById('fossBtn').style.display = CURRENT_LOC.isDefault ? 'none' : '';
}

function useFossvogur() {
  CURRENT_LOC = { ...FOSSVOGUR, isDefault: true };
  updateLocDisplay();
  fetchAll();
}

function useMyLocation() {
  if (!navigator.geolocation) {
    document.getElementById('updatedAt').textContent = s('wx.geoUnavailable');
    return;
  }
  const btn = document.getElementById('geoBtn');
  btn.disabled = true;
  document.getElementById('updatedAt').textContent = s('wx.locating');
  navigator.geolocation.getCurrentPosition(
    pos => {
      CURRENT_LOC = {
        lat: +pos.coords.latitude.toFixed(4),
        lon: +pos.coords.longitude.toFixed(4),
        label: s('wx.myLocation'),
        isDefault: false,
      };
      updateLocDisplay();
      btn.disabled = false;
      fetchAll();
    },
    () => {
      btn.disabled = false;
      document.getElementById('updatedAt').textContent = s('wx.geoDenied');
    },
    { enableHighAccuracy: false, timeout: 10000 }
  );
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtT(t) { return t ? t.slice(11,16) : '–'; }

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH + RENDER
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchAll() {
  const rBtn = document.getElementById('refreshBtn');
  const rIcon = document.getElementById('refreshIcon');
  const rLabel = s('wx.refresh');
  rBtn.setAttribute('aria-label', rLabel);
  rBtn.setAttribute('title', rLabel);
  rBtn.disabled = true;
  rIcon.textContent = '⏳';
  document.getElementById('mainContent').innerHTML = '<div class="loading-msg">⚓️ ' + s('wx.fetching') + '</div>';
  document.getElementById('updatedAt').textContent = s('wx.updating');
  try {
    const [{ wx, marine }, cfgRes] = await Promise.all([
      wxFetch(CURRENT_LOC.lat, CURRENT_LOC.lon, { fresh: true, useBirk: CURRENT_LOC.isDefault }),
      apiGet('getConfig').catch(() => null),
    ]);
    if (cfgRes?.flagConfig && typeof wxLoadFlagConfig === 'function') wxLoadFlagConfig(cfgRes.flagConfig);
    if (typeof wxLoadFlagOverride === 'function') wxLoadFlagOverride(cfgRes?.flagOverride ?? null);
    const staffStatus = cfgRes?.staffStatus ?? null;
    render(wx, marine, staffStatus);
    document.getElementById('updatedAt').textContent =
      'Updated ' + fmtTimeNow();
  } catch(e) {
    document.getElementById('mainContent').innerHTML =
      `<div class="error-msg">⚠️ ${esc(e.message)}<br><span class="text-sm text-muted">${s('wx.checkConnection')}</span></div>`;
    document.getElementById('updatedAt').textContent = s('wx.failed');
  } finally {
    rBtn.disabled = false;
    rIcon.textContent = '↻';
  }
}

function render(wx, marine, staffStatus) {
  const c   = wx.current, hr  = wx.hourly;
  const mc  = marine?.current, mhr = marine?.hourly;

  const ws  = c.wind_speed_10m, wd = c.wind_direction_10m, wg = c.wind_gusts_10m;
  const bft = wxMsToBft(ws), wDir = wxDirLabel(wd);
  const waveH = mc?.wave_height ?? null;
  const sst   = mc?.sea_surface_temperature ?? null;
  const pres  = c.surface_pressure;
  const vis   = c.visibility;
  const visKey = wxVisKey(vis);

  const nowISO = new Date().toISOString().slice(0,13);
  const nowIdx = Math.max(0, (hr.time||[]).findIndex(t => t.slice(0,13) === nowISO));
  const { trend: presTrend, diff: presDiff } = wxPressureTrend(hr.surface_pressure, nowIdx);

  // wxFlagNow applies a staff override if one is active (expires at midnight);
  // otherwise identical to wxScoreFlag. The hourly strip below stays on raw
  // scoring so the forecast trajectory is still visible.
  const _flagResult = wxFlagNow(ws, wDir, waveH ?? 0, c.temperature_2m, sst, wg, visKey);
  const { flagKey, flag, score, breakdown, reasons, override } = _flagResult;
  const presClass = presTrend === 'rising' ? 'rising' : presTrend === 'falling' ? 'falling' : '';

  // BIRK doesn't provide a weather code — derive a simple description from wind/conditions
  const condIcon = c.weather_code != null ? wxCondIcon(c.weather_code)
    : bft >= 7 ? '🌬' : bft >= 5 ? '💨' : bft >= 3 ? '🌊' : '🌤';
  const condDesc = c.weather_code != null ? wxCondDesc(c.weather_code)
    : bft >= 7 ? 'Strong wind' : bft >= 5 ? 'Fresh breeze' : bft >= 3 ? 'Light breeze' : 'Calm';

  // All points: up to 3h history + 6h forecast
  const pts = [];
  const end = Math.min(hr.time.length - 1, nowIdx + 6);
  for (let i = Math.max(0, nowIdx - 3); i <= end; i++) {
    pts.push({
      t: fmtT(hr.time[i]), i,
      ws:   hr.wind_speed_10m[i]   || 0,
      wg:   hr.wind_gusts_10m[i]   || 0,
      wd:   hr.wind_direction_10m[i],
      pr:   hr.surface_pressure?.[i] ?? null,
      vis:  hr.visibility?.[i] ?? null,
      mWH:  mhr?.wave_height?.[i]  ?? null,
      isNow:  i === nowIdx,
      isPast: i < nowIdx,
    });
  }

  const marineNote = ''

  window._wfFlagResult  = { flagKey, flag, score, breakdown, override };
  window._wfStaffStatus = staffStatus;
  const IS_LANG = document.documentElement.lang === 'is';
  const overrideNote = override ? ((IS_LANG && override.notesIS) ? override.notesIS : (override.notes || override.notesIS || '')) : '';
  document.getElementById('mainContent').innerHTML = `

<div class="flag-banner" style="background:${flag.bg};border-color:${flag.border};color:${flag.color};cursor:pointer" title="Tap for details">
  <div style="font-size:28px;line-height:1">${flag.icon}</div>
  <div class="flex-1">
    <div class="flag-advice">${flag.advice}${override ? ` <span style="font-size:9px;letter-spacing:1px;margin-left:6px;padding:1px 6px;border:1px solid ${flag.border};border-radius:8px;opacity:.85">${s('wx.overrideBadge')}</span>` : ''}</div>
    ${override
      ? (overrideNote ? `<div class="flag-reasons" style="font-size:12px;opacity:.9;margin-top:6px;white-space:pre-wrap">${esc(overrideNote)}</div>` : '')
      : (reasons.length ? `<div class="flag-reasons">${reasons.map(r=>`<span class="flag-chip" style="color:${SCORE_CONFIG.flags[r.f].color};border-color:${SCORE_CONFIG.flags[r.f].border}">${esc(r.t)}</span>`).join('')}</div>` : '')}
  </div>
</div>
${staffStatus ? wxStaffStatusHtml(staffStatus) : ''}

<!-- WIND HERO -->
<div class="wind-hero">
  <div class="text-muted mb-12" style="font-size:9px;letter-spacing:1.2px">WIND · ${c._source || 'BIRK'}${c._obs_time ? ' · ' + String(c._obs_time).slice(11,16) + ' UTC' : ''}</div>
  <div class="wind-cols">
    <div class="wind-data">
      <div class="wind-speed-row">
        <span class="dir-arrow">${wxDirArrow(wd)}</span>
        <span class="wind-ms">${Math.round(ws)}</span>
        <span class="wind-unit">m/s</span>
      </div>
      <div class="wind-sub">
        <b>${wDir}</b>
        <span class="sep">·</span>
        <b>${wxMsToKt(ws)}</b> kt
        <span class="sep">·</span>
        <span class="text-base">${wd != null ? Math.round(wd)+'°' : ''}</span>
      </div>
    </div>
    <div class="wind-icon-col">
      <div class="wind-cond-icon">${condIcon}</div>
      <div class="text-xs text-muted" style="text-align:center;margin-top:4px">${condDesc}</div>
    </div>
  </div>
  <div class="gust-row">
    <div>
      <div class="gust-lbl">GUSTS</div>
      <div class="gust-val">${Math.round(wg)}<span class="text-base text-muted"> m/s</span>
        <span class="text-muted" style="font-size:15px;margin-left:8px">${wxMsToKt(wg)} kt</span>
      </div>
    </div>
    <div style="width:1px;height:36px;background:var(--border)"></div>
    <div>
      <div class="gust-lbl">BEAUFORT</div>
      <div class="gust-val">${bft} <span style="font-size:13px;color:var(--muted)">${wxBftDesc(bft)}</span></div>
    </div>
  </div>
</div>

<!-- TEMPS -->
<div class="info-grid">
  <div class="info-card">
    <div class="info-lbl">AIR TEMPERATURE</div>
    <div class="info-val">${c.temperature_2m != null ? Math.round(c.temperature_2m) : '–'}<span class="unit">°C</span></div>
    <div class="info-sub">${c._source === 'OpenMeteo' ? 'Open-Meteo forecast' : 'BIRK station reading'}</div>
  </div>
  <div class="info-card">
    <div class="info-lbl">SEA TEMPERATURE</div>
    <div class="info-val">${sst != null ? sst.toFixed(1) : '–'}<span class="unit">°C</span></div>
    <div class="info-sub">${sst != null ? 'Surface water' : marine ? 'No SST for this cell' : 'Marine unavailable'}</div>
  </div>
</div>

<!-- WAVES -->
<div class="info-card" style="margin-bottom:12px">
  <div class="info-lbl">WAVES</div>
  <div style="display:grid;grid-template-columns:1fr 1px 1fr 1px 1fr;gap:0;align-items:center">
    <div style="text-align:center;padding:4px 8px">
      <div style="font-size:28px;color:var(--navy-l);font-weight:500;line-height:1">${waveH != null ? waveH.toFixed(1) : '–'}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px">m height</div>
      ${marineNote ? `<div style="font-size:9px;color:var(--muted);margin-top:3px">${marineNote.replace(/<[^>]+>/g,'')}</div>` : ''}
    </div>
    <div style="background:var(--border);height:40px;align-self:center"></div>
    <div style="text-align:center;padding:4px 8px">
      <div style="font-size:28px;color:var(--navy-l);line-height:1">${mc?.wave_direction != null ? wxDirArrow(mc.wave_direction) : '–'}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px">${mc?.wave_direction != null ? wxDirLabel(mc.wave_direction)+' · '+Math.round(mc.wave_direction)+'°' : 'direction'}</div>
    </div>
    <div style="background:var(--border);height:40px;align-self:center"></div>
    <div style="text-align:center;padding:4px 8px">
      <div style="font-size:28px;color:var(--navy-l);font-weight:500;line-height:1">${mc?.wave_period != null ? mc.wave_period.toFixed(0) : '–'}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px">s period</div>
    </div>
  </div>
</div>

<!-- PRESSURE + VISIBILITY -->
<div class="info-grid" style="margin-bottom:14px">
  <div class="info-card">
    <div class="info-lbl">BAROMETRIC PRESSURE</div>
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <div class="info-val">${pres != null ? Math.round(pres) : '–'}<span class="unit">hPa</span></div>
      <div style="font-size:22px;color:${wxPressureTrendColor(presTrend)}">${wxPressureTrendIcon(presTrend)}</div>
    </div>
    <div class="info-sub ${presClass}">${presTrend}${presDiff !== 0 ? ' ('+( presDiff>0?'+':'')+presDiff+' hPa / 3h)' : ''}</div>
  </div>
  <div class="info-card">
    <div class="info-lbl">VISIBILITY</div>
    <div class="info-val">${vis == null ? '–' : vis >= 1000 ? (vis/1000).toFixed(vis >= 10000 ? 0 : 1) : Math.round(vis)}<span class="unit">${vis != null && vis < 1000 ? 'm' : 'km'}</span></div>
    <div class="info-sub">${vis == null ? 'Unavailable' : visKey === 'poor' ? s('wx.poorVisibility') : visKey === 'reduced' ? s('wx.reducedVisibility') : 'Clear'}</div>
  </div>
</div>

<!-- WIND + WAVE CHART -->
<div class="chart-card">
  <div class="chart-header">
    <span class="chart-title-txt">WIND & WAVES · 3H HISTORY + 6H FORECAST</span>
    <div class="chart-legend">
      <span class="leg-item"><span class="leg-dot" style="background:var(--brass)"></span>Wind m/s</span>
      <span class="leg-item" style="opacity:.55;font-style:italic">— — Gusts</span>
      ${marine ? `<span class="leg-item"><span class="leg-dot" style="background:var(--navy-l)"></span>Waves m</span>` : ''}
    </div>
  </div>
  <svg class="chart" id="windChart" height="120"></svg>
</div>

<!-- PRESSURE CHART -->
<div class="chart-card">
  <div class="chart-header">
    <span class="chart-title-txt">PRESSURE TREND · 3H HISTORY + 6H FORECAST</span>
    <div class="chart-legend">
      <span class="leg-item"><span class="leg-dot" style="background:var(--navy-l)"></span>hPa</span>
    </div>
  </div>
  <svg class="chart" id="presChart" height="80"></svg>
</div>

<!-- TIDES -->
<div id="wxTideWidget" style="margin-bottom:14px"></div>

<!-- HOURLY STRIP -->
<div class="section-lbl">HOUR BY HOUR</div>
<div class="hour-strip" id="hourStrip"></div>`;

  const _flagBanner = document.querySelector('.flag-banner');
  if (_flagBanner) _flagBanner.addEventListener('click', openWfFlagModal);

  renderHourStrip(pts);
  drawWindChart(pts, pts.findIndex(p=>p.isNow));
  drawPresChart(pts, pts.findIndex(p=>p.isNow));
  tideWidget(document.getElementById('wxTideWidget')).refresh();
}

// ─── Hourly strip ─────────────────────────────────────────────────────────────
const WAVE_ICON_ = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>';
function renderHourStrip(pts) {
  const FLAG_COLORS = { green:'var(--green)', yellow:'var(--yellow)', orange:'var(--orange)', red:'var(--red)' };
  document.getElementById('hourStrip').innerHTML = pts.map(p => {
    const { flagKey } = wxScoreFlag(p.ws, wxDirLabel(p.wd), p.mWH ?? 0, null, null, null, wxVisKey(p.vis));
    return `<div class="h-slot${p.isNow?' now':p.isPast?' past':''}">
      <div class="h-time">${p.isNow ? 'NOW' : p.t}</div>
      <div class="h-main">
        <span class="h-dir">${wxDirArrow(p.wd)}</span>
        <span class="h-wind">${Math.round(p.ws)}</span>
        <span class="h-unit">m/s</span>
      </div>
      <div class="h-kt">${wxMsToKt(p.ws)} kt</div>
      <div class="h-gust">↑${Math.round(p.wg)}</div>
      ${p.mWH != null ? `<div class="h-wave">${WAVE_ICON_}<span>${p.mWH.toFixed(1)}m</span></div>` : ''}
      ${p.pr  != null ? `<div class="h-pres">${Math.round(p.pr)}</div>` : ''}
      <div class="h-flag" style="background:${FLAG_COLORS[flagKey]}"></div>
    </div>`;
  }).join('');
  setTimeout(() => {
    const nowEl = document.querySelector('.h-slot.now');
    if (nowEl) nowEl.scrollIntoView({ inline:'center', block:'nearest', behavior:'smooth' });
  }, 100);
}

// ─── Wind/wave chart ──────────────────────────────────────────────────────────
function drawWindChart(pts, nowI) {
  const svg = document.getElementById('windChart');
  if (!svg || !pts.length) return;
  const W = svg.clientWidth || 640, H = 120, P = {t:14,b:26,l:4,r:4};
  const iW = W-P.l-P.r, iH = H-P.t-P.b;
  const winds = pts.map(p=>p.ws), gusts = pts.map(p=>p.wg), waves = pts.map(p=>p.mWH??0);
  const maxV = Math.max(...winds,...gusts,...waves,5);
  const xOf = i => P.l+(i/(pts.length-1))*iW;
  const yOf = v => P.t+(1-v/maxV)*iH;
  const line = vals => vals.map((v,i)=>`${i?'L':'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const area = vals => line(vals)+` L${xOf(vals.length-1).toFixed(1)},${yOf(0).toFixed(1)} L${xOf(0).toFixed(1)},${yOf(0).toFixed(1)} Z`;
  const nowX = xOf(nowI).toFixed(1);
  let h = `<rect class="chart-past" x="${P.l}" y="${P.t}" width="${Math.max(0,parseFloat(nowX)-P.l)}" height="${iH}"/>`;
  if (waves.some(v=>v>0)) { h+=`<path class="chart-area c-blue" d="${area(waves)}"/>`;h+=`<path class="chart-line c-blue" d="${line(waves)}"/>`; }
  h+=`<path class="chart-area c-brass" d="${area(winds)}"/>`;
  h+=`<path class="chart-line c-brass" d="${line(winds)}"/>`;
  h+=`<path class="chart-dash c-brass" d="${line(gusts)}"/>`;
  h+=`<line class="chart-now" x1="${nowX}" y1="${P.t}" x2="${nowX}" y2="${H-P.b}"/>`;
  h+=`<text class="chart-now-t" x="${nowX}" y="${H-P.b+11}" text-anchor="middle">NOW</text>`;
  pts.forEach((p,i) => {
    h+=`<circle class="chart-dot ${p.isPast?'c-muted':'c-brass'}" cx="${xOf(i).toFixed(1)}" cy="${yOf(p.ws).toFixed(1)}" r="2"/>`;
    if (p.isNow||i===0||i===pts.length-1) {
      h+=`<text class="chart-lbl c-brass" x="${xOf(i).toFixed(1)}" y="${(yOf(p.ws)-4).toFixed(1)}" text-anchor="middle">${Math.round(p.ws)}</text>`;
      if (p.mWH != null)
        h+=`<text class="chart-lbl c-blue" x="${xOf(i).toFixed(1)}" y="${(yOf(p.mWH)-4).toFixed(1)}" text-anchor="middle">${p.mWH.toFixed(1)}</text>`;
    }
    if (p.isNow||i===0||i===pts.length-1||i%2===0)
      h+=`<text class="chart-axis-t" x="${xOf(i).toFixed(1)}" y="${H-2}" text-anchor="middle">${p.t}</text>`;
  });
  svg.innerHTML = h; svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
}

// ─── Pressure chart ───────────────────────────────────────────────────────────
function drawPresChart(pts, nowI) {
  const svg = document.getElementById('presChart');
  if (!svg) return;
  const hasPres = pts.some(p=>p.pr!=null);
  if (!hasPres) { svg.innerHTML=`<text class="chart-axis-t" x="50%" y="40" text-anchor="middle">${s('wx.pressureUnavail')}</text>`; return; }
  const W = svg.clientWidth||640, H=80, P={t:8,b:22,l:4,r:4};
  const iW=W-P.l-P.r, iH=H-P.t-P.b;
  const valid = pts.map((p,i)=>({...p,pi:i})).filter(p=>p.pr!=null);
  const prs   = valid.map(p=>p.pr);
  const minP  = Math.min(...prs)-0.5, maxP = Math.max(...prs)+0.5;
  const xOf   = i => P.l+(i/(pts.length-1))*iW;
  const yOf   = v => P.t+(1-(v-minP)/(maxP-minP))*iH;
  const nowX  = xOf(nowI).toFixed(1);
  const lpath = valid.map((p,j)=>`${j?'L':'M'}${xOf(p.pi).toFixed(1)},${yOf(p.pr).toFixed(1)}`).join(' ');
  const apath = lpath+` L${xOf(valid[valid.length-1].pi).toFixed(1)},${yOf(minP).toFixed(1)} L${xOf(valid[0].pi).toFixed(1)},${yOf(minP).toFixed(1)} Z`;
  let h = `<rect class="chart-past" x="${P.l}" y="${P.t}" width="${Math.max(0,parseFloat(nowX)-P.l)}" height="${iH}"/>`;
  h+=`<path class="chart-area c-blue" d="${apath}"/>`;
  h+=`<path class="chart-line c-blue" d="${lpath}"/>`;
  h+=`<line class="chart-now" x1="${nowX}" y1="${P.t}" x2="${nowX}" y2="${H-P.b}"/>`;
  valid.forEach((p,j) => {
    if (j===0||p.isNow||j===valid.length-1) {
      h+=`<text class="chart-axis-t" x="${xOf(p.pi).toFixed(1)}" y="${H-2}" text-anchor="middle">${p.t}</text>`;
      h+=`<text class="chart-lbl c-blue" x="${xOf(p.pi).toFixed(1)}" y="${yOf(p.pr)-4}" text-anchor="middle">${Math.round(p.pr)}</text>`;
    }
  });
  svg.innerHTML=h; svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
fetchAll();

// ── Flag detail modal (shared helper in shared/weather.js) ──────────────────
function openWfFlagModal() {
  if (!window._wfFlagResult || typeof wxFlagDetailHtml !== 'function') return;
  const IS = document.documentElement.lang === 'is';
  const r  = window._wfFlagResult;
  showWxFlagModal(
    r.flag.icon + ' · ' + r.score + (IS ? ' stig' : ' pts'),
    wxFlagDetailHtml(r, window._wfStaffStatus ?? null, IS ? 'IS' : 'EN')
  );
}

