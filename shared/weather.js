// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR SHARED WEATHER MODULE  v3
//
// Default location: Reykjavík / BIRK area (Fossvogur)
//   Atmosphere coords: 64.1188°N  21.9376°W  (requested club coords)
//   Marine fallback:   64.25°N   22.25°W     (open Faxaflói, valid ocean cell)
//
// Marine strategy: try the exact club coords first; if the marine API returns
// a non-ok response (coastal land cell → 400), silently retry with the open-
// water fallback. Wind data always comes from the atmosphere API at club coords.
// ═══════════════════════════════════════════════════════════════════════════════

const WX_DEFAULT = {
  lat:   64.1188,
  lon:  -21.9376,
  label: 'Fossvogur',
};
// Offshore fallback used only if marine API 400s at club coords
const WX_MARINE_FALLBACK = { lat: 64.25, lon: -22.25 };

// Runtime location — overridden by full-page location picker (not persisted in
// widgets, which always use the default)
let WX_LAT   = WX_DEFAULT.lat;
let WX_LON   = WX_DEFAULT.lon;
let WX_LABEL = WX_DEFAULT.label;

// ── Unit helpers ──────────────────────────────────────────────────────────────
function wxMsToBft(ms) {
  const T = [0,0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7];
  for (let i = T.length - 1; i >= 0; i--) if (ms >= T[i]) return i;
  return 0;
}
function wxMsToKt(ms)   { return (ms * 1.944).toFixed(1); }
function wxDirLabel(d)  { if (d == null) return '–'; return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d/22.5)%16]; }
function wxDirArrow(d)  { if (d == null) return ''; return ['↓','↙','←','↖','↑','↗','→','↘'][Math.round(d/45)%8]; }
function wxBftDesc(b)   { return ['Calm','Light air','Light breeze','Gentle breeze','Moderate breeze','Fresh breeze','Strong breeze','Near gale','Gale','Strong gale','Storm','Violent storm','Hurricane'][b] || ''; }
function wxCondIcon(c)  {
  if (c === 0) return '☀️'; if (c === 1) return '🌤'; if (c === 2) return '⛅'; if (c === 3) return '☁️';
  if ([45,48].includes(c)) return '🌫'; if ([51,53,55,61,63,65,80,81,82].includes(c)) return '🌧';
  if ([71,73,75,77,85,86].includes(c)) return '🌨'; if ([95,96,99].includes(c)) return '⛈'; return '🌡';
}
function wxCondDesc(c)  {
  if (c === 0) return 'Clear sky'; if (c === 1) return 'Mainly clear'; if (c === 2) return 'Partly cloudy'; if (c === 3) return 'Overcast';
  if ([45,48].includes(c)) return 'Fog'; if ([51,53,55].includes(c)) return 'Drizzle';
  if ([61,63,65,80,81,82].includes(c)) return 'Rain'; if ([71,73,75,77].includes(c)) return 'Snow';
  if ([95,96,99].includes(c)) return 'Thunderstorm'; return '–';
}
function wxAssessFlag(ws, wDir, waveH) {
  let lv = 0;
  const bft = wxMsToBft(ws || 0);
  const east = ['E','NE','SE'].includes((wDir || '').toUpperCase());
  if (bft >= 7) lv = 3;
  else if (bft === 6) { lv = 2; if (east) lv = 3; }
  else if (bft === 5) { lv = 1; if (east) lv = 2; }
  else if (bft === 4 && east) lv = 1;
  if ((waveH || 0) >= 2.0) lv = Math.max(lv, 3);
  else if ((waveH || 0) >= 1.2) lv = Math.max(lv, 2);
  else if ((waveH || 0) >= 0.6) lv = Math.max(lv, 1);
  const keys = ['green','yellow','orange','red'];
  const FLAGS = {
    green:  { color:'#27ae60', bg:'#27ae6018', border:'#27ae6044', icon:'🟢', label:'Green',  advice:'Good conditions.' },
    yellow: { color:'#f1c40f', bg:'#f1c40f18', border:'#f1c40f44', icon:'🟡', label:'Yellow', advice:'Marginal — experienced only.' },
    orange: { color:'#e67e22', bg:'#e67e2218', border:'#e67e2244', icon:'🟠', label:'Orange', advice:'Difficult — keelboats only.' },
    red:    { color:'#e74c3c', bg:'#e74c3c18', border:'#e74c3c44', icon:'🔴', label:'Red',    advice:'Do not sail.' },
  };
  return { flagKey: keys[lv], flag: FLAGS[keys[lv]], flags: FLAGS };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
// lat/lon optional — defaults to current WX_LAT/WX_LON
async function wxFetch(lat, lon) {
  lat = lat ?? WX_LAT;
  lon = lon ?? WX_LON;
  const tz = 'Atlantic%2FReykjavik';

  const wxUrl = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}&timezone=${tz}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure` +
    `&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure` +
    `&wind_speed_unit=ms&past_hours=3&forecast_days=1`;

  // Try marine at exact coords first; if that fails (coastal land cell → 400/error),
  // retry at the open-ocean fallback for waves and SST
  const marineCurrent = `wave_height,wave_direction,wave_period,sea_surface_temperature`;
  const marineHourly  = `wave_height,wave_direction,wave_period,sea_surface_temperature`;

  async function tryMarine(mLat, mLon) {
    const url = `https://marine-api.open-meteo.com/v1/marine` +
      `?latitude=${mLat}&longitude=${mLon}&timezone=${tz}` +
      `&current=${marineCurrent}&hourly=${marineHourly}` +
      `&past_hours=3&forecast_days=1`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`marine ${r.status}`);
    return r.json();
  }

  const wxPromise = fetch(wxUrl).then(r => {
    if (!r.ok) throw new Error(`Weather API ${r.status}`);
    return r.json();
  });

  const marinePromise = tryMarine(lat, lon).catch(() => {
    // Fallback to open-ocean cell — only for waves/SST, wind still from atmosphere API
    return tryMarine(WX_MARINE_FALLBACK.lat, WX_MARINE_FALLBACK.lon).catch(() => null);
  });

  const [wx, marine] = await Promise.all([wxPromise, marinePromise]);
  return { wx, marine };
}

// ── Pressure trend ────────────────────────────────────────────────────────────
function wxPressureTrend(hourlyPressure, nowIdx) {
  if (!hourlyPressure || nowIdx < 1) return { trend: 'steady', diff: 0 };
  const histIdx = Math.max(0, nowIdx - 3);
  const diff = (hourlyPressure[nowIdx] || 0) - (hourlyPressure[histIdx] || 0);
  return { trend: diff > 1 ? 'rising' : diff < -1 ? 'falling' : 'steady', diff: Math.round(diff * 10) / 10 };
}
function wxPressureTrendIcon(trend)  { return { rising:'↗', falling:'↘', steady:'→' }[trend] || '→'; }
function wxPressureTrendColor(trend) { return { rising:'var(--green)', falling:'var(--orange)', steady:'var(--muted)' }[trend] || 'var(--muted)'; }

// ── Compact widget (member + dailylog) ────────────────────────────────────────
// Always uses WX_DEFAULT coords regardless of any location override.
// targetEl  : DOM element to render into (must have class wx-widget in CSS)
// onData    : optional callback(snapshot) — snapshot has ws,wd,wg,bft,waveH,wDir,sst,airT,apparentT,code,flagKey,pres,presTrend
// Returns { refresh(), start(), stop() }
function wxWidget(targetEl, { onData, showRefreshBtn = true, label } = {}) {
  const loc = { lat: WX_DEFAULT.lat, lon: WX_DEFAULT.lon, label: label || WX_DEFAULT.label };
  let timer = null;

  async function refresh() {
    try {
      const { wx, marine } = await wxFetch(loc.lat, loc.lon);
      const c   = wx.current;
      const mc  = marine?.current;
      const hr  = wx.hourly;
      const ws  = c.wind_speed_10m, wd = c.wind_direction_10m, wg = c.wind_gusts_10m;
      const bft = wxMsToBft(ws), wDir = wxDirLabel(wd);
      const waveH = mc?.wave_height ?? null;
      const sst   = mc?.sea_surface_temperature ?? null;
      const pres  = c.surface_pressure;
      const { flagKey, flag } = wxAssessFlag(ws, wDir, waveH ?? 0);

      const nowISO = new Date().toISOString().slice(0,13);
      const nowIdx = Math.max(0, (hr.time||[]).findIndex(t => t.slice(0,13) === nowISO));
      const { trend, diff } = wxPressureTrend(hr.surface_pressure, nowIdx);

      if (onData) onData({ ws, wd, wg, bft, waveH, wDir, sst, airT: c.temperature_2m,
        apparentT: c.apparent_temperature, code: c.weather_code, flagKey, pres, presTrend: trend });

      const updTime = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      targetEl.className = `wx-widget flag-${flagKey}`;
      targetEl.innerHTML = `
        <div class="wx-top">
          <div style="flex:1">
            <div style="font-size:9px;color:var(--muted);letter-spacing:1.2px;margin-bottom:5px">${loc.label.toUpperCase()} · CONDITIONS</div>
            <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
              <span style="font-size:36px;color:var(--brass);font-weight:500;line-height:1">${ws.toFixed(1)}</span>
              <span style="font-size:14px;color:var(--muted)">m/s</span>
              <span style="font-size:16px;color:var(--muted)">${wxMsToKt(ws)} kt</span>
              <span style="font-size:14px;color:var(--text)">${wxDirArrow(wd)} ${wDir}</span>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:5px;display:flex;gap:12px;flex-wrap:wrap">
              <span>Gusts <b style="color:var(--text)">${wg.toFixed(1)} m/s</b> / <b style="color:var(--text)">${wxMsToKt(wg)} kt</b></span>
              <span>Bft <b style="color:var(--text)">${bft}</b> — ${wxBftDesc(bft)}</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:28px">${wxCondIcon(c.weather_code)}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:3px">${wxCondDesc(c.weather_code)}</div>
            ${showRefreshBtn ? `<button onclick="this.closest('.wx-widget')._wxRefresh()" style="margin-top:6px;background:none;border:1px solid var(--border);color:var(--muted);padding:3px 8px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit">↻</button>` : ''}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-top:10px">
          <div class="wx-cell">
            <div style="font-size:10px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">AIR</div>
            <div style="font-size:17px;color:var(--text)">${c.temperature_2m != null ? Math.round(c.temperature_2m)+'°C' : '–'}</div>
            <div style="font-size:10px;color:var(--muted)">Feels ${c.apparent_temperature != null ? Math.round(c.apparent_temperature)+'°C' : '–'}</div>
          </div>
          <div class="wx-cell">
            <div style="font-size:10px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">SEA</div>
            <div style="font-size:17px;color:#4a9eca">${sst != null ? sst.toFixed(1)+'°C' : '–'}</div>
            <div style="font-size:10px;color:var(--muted)">Surface</div>
          </div>
          <div class="wx-cell">
            <div style="font-size:10px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">WAVES</div>
            <div style="font-size:17px;color:#4a9eca">${waveH != null ? waveH.toFixed(1)+'m' : '–'}</div>
            <div style="font-size:10px;color:var(--muted)">${mc?.wave_direction != null ? wxDirArrow(mc.wave_direction)+' '+wxDirLabel(mc.wave_direction) : '–'}</div>
          </div>
          <div class="wx-cell">
            <div style="font-size:10px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">PRESSURE</div>
            <div style="font-size:17px;color:var(--text)">${pres != null ? Math.round(pres) : '–'}</div>
            <div style="font-size:10px;color:${wxPressureTrendColor(trend)}">${wxPressureTrendIcon(trend)} ${trend}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
          <span class="flag-pill" style="color:${flag.color};border-color:${flag.border};background:${flag.bg};display:inline-flex;align-items:center;gap:6px;border-radius:20px;border:1px solid;padding:4px 10px;font-size:11px;font-weight:500">
            ${flag.icon} ${flag.label} — ${flag.advice}
          </span>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:10px;color:var(--muted)">↻ ${updTime}</span>
            <a href="../weather/" style="font-size:11px;color:var(--brass);text-decoration:none">Full forecast →</a>
          </div>
        </div>`;
      targetEl._wxRefresh = refresh;
    } catch(e) {
      targetEl.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:6px 0">⚠ Weather unavailable — <a href="../weather/" style="color:var(--brass)">try full page →</a>${showRefreshBtn ? ` <button onclick="this.closest('.wx-widget')._wxRefresh()" style="margin-left:8px;background:none;border:1px solid var(--border);color:var(--muted);padding:2px 8px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit">↻</button>` : ''}</div>`;
      targetEl._wxRefresh = refresh;
    }
  }

  const WX_REFRESH_MS = 10 * 60 * 1000;
  return {
    refresh,
    start()  { refresh(); timer = setInterval(refresh, WX_REFRESH_MS); },
    stop()   { if (timer) clearInterval(timer); },
  };
}
