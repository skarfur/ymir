// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/weather.js
//
// Shared weather utilities used across member, staff, daily-log and weather pages.
// Wind data always comes from the atmosphere API at club coords.
//
// FLAG SYSTEM
// -----------
// All flag thresholds live in FLAG_CONFIG (below). Admin can edit these via
// admin/index.html → Flags tab; changes are saved to the backend and fetched
// on load via wxLoadFlagConfig(). No magic numbers anywhere else.
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

// ═══════════════════════════════════════════════════════════════════════════════
// FLAG CONFIG — single source of truth for all flag logic
// Admin-editable via admin → Flags tab.  wxLoadFlagConfig() merges saved values.
// ═══════════════════════════════════════════════════════════════════════════════
const FLAG_CONFIG = {
  // Beaufort thresholds — the minimum Bft to trigger each level
  wind: {
    yellow: 5,   // Bft ≥ 5 → yellow
    orange: 6,   // Bft ≥ 6 → orange
    red:    7,   // Bft ≥ 7 → red
  },
  // Easterly directions add +1 to the flag level
  easterlyDirs: ['E', 'NE', 'SE'],
  // Wave height thresholds (metres)
  wave: {
    yellow: 0.6,
    orange: 1.2,
    red:    2.0,
  },
  // Display labels & advice — editable by admin
  flags: {
    green:  {
      color: '#27ae60', bg: '#27ae6018', border: '#27ae6044',
      icon: '🟢', label: 'Green',
      advice: 'Good conditions.',
    },
    yellow: {
      color: '#f1c40f', bg: '#f1c40f18', border: '#f1c40f44',
      icon: '🟡', label: 'Yellow',
      advice: 'Marginal — experienced sailors only.',
    },
    orange: {
      color: '#e67e22', bg: '#e67e2218', border: '#e67e2244',
      icon: '🟠', label: 'Orange',
      advice: 'Difficult — keelboats only, staff auth for dinghies.',
    },
    red: {
      color: '#e74c3c', bg: '#e74c3c18', border: '#e74c3c44',
      icon: '🔴', label: 'Red',
      advice: 'Do not sail — all sailing suspended.',
    },
  },
};

/**
 * Merge saved flag config from the backend into FLAG_CONFIG.
 * Call this once after auth, before any weather fetch.
 * @param {object} saved — the flagConfig object from getConfig response
 */
function wxLoadFlagConfig(saved) {
  if (!saved) return;
  if (saved.wind)        Object.assign(FLAG_CONFIG.wind,  saved.wind);
  if (saved.wave)        Object.assign(FLAG_CONFIG.wave,  saved.wave);
  if (saved.easterlyDirs) FLAG_CONFIG.easterlyDirs = saved.easterlyDirs;
  if (saved.flags) {
    for (const key of ['green','yellow','orange','red']) {
      if (saved.flags[key]) Object.assign(FLAG_CONFIG.flags[key], saved.flags[key]);
    }
  }
}

// ── Unit helpers ──────────────────────────────────────────────────────────────
function wxMsToBft(ms) {
  const T = [0,0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7];
  for (let i = T.length - 1; i >= 0; i--) if (ms >= T[i]) return i;
  return 0;
}
function wxMsToKt(ms)   { return Math.round(ms * 1.944); }
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

// ── Core flag assessment — reads from FLAG_CONFIG ─────────────────────────────
/**
 * Assess the sailing flag level from weather data.
 * @param {number} ws     — wind speed m/s
 * @param {string} wDir   — compass direction label e.g. 'NE'
 * @param {number} waveH  — wave height metres (0 if unknown)
 * @returns {{ flagKey, flag, reasons }}
 */
function wxAssessFlag(ws, wDir, waveH) {
  const cfg  = FLAG_CONFIG;
  let lv     = 0;
  const reasons = [];
  const bft  = wxMsToBft(ws || 0);
  const east = cfg.easterlyDirs.includes((wDir || '').toUpperCase());

  // Wind assessment
  if (bft >= cfg.wind.red) {
    lv = 3;
    reasons.push({ f: 'red',    t: `Force ${bft} — all sailing suspended` });
  } else if (bft >= cfg.wind.orange) {
    lv = 2;
    reasons.push({ f: 'orange', t: `Force ${bft} — difficult conditions` });
    if (east) { lv = 3; reasons.push({ f: 'red', t: `Easterly F${bft} — amplified hazard` }); }
  } else if (bft >= cfg.wind.yellow) {
    lv = 1;
    reasons.push({ f: 'yellow', t: `Force ${bft} — marginal` });
    if (east) { lv = Math.max(lv, 2); reasons.push({ f: 'orange', t: `Easterly F${bft} — elevated risk` }); }
  } else if (bft === cfg.wind.yellow - 1 && east) {
    // One Bft below yellow but easterly — still flag yellow
    lv = 1;
    reasons.push({ f: 'yellow', t: `Easterly F${bft} — warrants caution` });
  }

  // Wave assessment
  const wh = waveH || 0;
  if (wh >= cfg.wave.red) {
    lv = Math.max(lv, 3);
    reasons.push({ f: 'red',    t: `Waves ${wh.toFixed(1)}m — very rough` });
  } else if (wh >= cfg.wave.orange) {
    lv = Math.max(lv, 2);
    reasons.push({ f: 'orange', t: `Waves ${wh.toFixed(1)}m — rough` });
  } else if (wh >= cfg.wave.yellow) {
    lv = Math.max(lv, 1);
    reasons.push({ f: 'yellow', t: `Waves ${wh.toFixed(1)}m — moderate` });
  }

  const keys    = ['green', 'yellow', 'orange', 'red'];
  const flagKey = keys[lv];
  return { flagKey, flag: cfg.flags[flagKey], reasons };
}

// ── Pressure trend ────────────────────────────────────────────────────────────
function wxPressureTrend(pressureArr, nowIdx) {
  if (!pressureArr || pressureArr.length < 4) return { trend: 'steady', diff: 0 };
  const past = pressureArr[Math.max(0, nowIdx - 3)];
  const now  = pressureArr[nowIdx];
  const diff = now - past;
  return { trend: diff > 1 ? 'rising' : diff < -1 ? 'falling' : 'steady', diff: Math.round(diff * 10) / 10 };
}
function wxPressureTrendIcon(trend)  { return { rising:'↗', falling:'↘', steady:'→' }[trend] || '→'; }
function wxPressureTrendColor(trend) { return { rising:'var(--green)', falling:'var(--orange)', steady:'var(--muted)' }[trend] || 'var(--muted)'; }

// ── Direction string → degrees (for wxDirArrow / wxDirLabel compatibility) ────
// apis.is returns direction as a compass string e.g. "NNE", "S", "Calm"
const _DIR_TO_DEG = {
  N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5,
  S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5,
};
function wxDirStrToDeg(s) {
  if (!s || s === 'Calm' || s === '–') return null;
  return _DIR_TO_DEG[s.toUpperCase()] ?? null;
}

// ── API fetch ─────────────────────────────────────────────────────────────────
// Wind/temp/pressure: BIRK (Reykjavík airport) proxied via Apps Script backend
//                     (apis.is blocks direct browser fetches due to CORS)
// Waves/SST:          Open-Meteo marine API
// Hourly chart data:  Open-Meteo atmosphere API (wind history/forecast for chart)

async function wxFetch(lat, lon) {
  // ── 1. BIRK current observations — via backend proxy ─────────────────────
  const birkPromise = apiGet('getWeather');

  // ── 2. Open-Meteo hourly + current — chart data + fills nulls left by BIRK ──────────
  const hourlyParams = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure';
  const currentParams = 'wind_gusts_10m,apparent_temperature,surface_pressure,weather_code';
  const hourlyUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourlyParams}&current=${currentParams}&forecast_hours=9&past_hours=3&timezone=auto&wind_speed_unit=ms`;
  const hourlyPromise = fetch(hourlyUrl).then(r => r.ok ? r.json() : null).catch(() => null);

  // ── 3. Marine API (waves / SST) — unchanged ───────────────────────────────
  const marineParams  = 'wave_height,wave_direction,wave_period,sea_surface_temperature';
  const marineUrl    = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=${marineParams}&hourly=${marineParams}&past_hours=3&forecast_hours=9&timezone=auto`;
  const marinePromise = fetch(marineUrl)
    .then(r => {
      if (!r.ok) {
        const fb = WX_MARINE_FALLBACK;
        return fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${fb.lat}&longitude=${fb.lon}&current=${marineParams}&hourly=${marineParams}&past_hours=3&forecast_hours=9&timezone=auto`)
          .then(r2 => r2.ok ? r2.json() : null);
      }
      return r.json();
    })
    .catch(() => null);

  const [birkRes, hourlyData, marine] = await Promise.all([
    birkPromise, hourlyPromise, marinePromise,
  ]);

  // ── Map BIRK METAR into the wx.current shape the rest of the code expects
  // aviationweather.gov JSON fields:
  //   wdir (degrees), wspd (knots), wgst (knots or null), temp (°C),
  //   slp (hPa sea-level pressure), altim (inches Hg — NOT used)
  const obs   = birkRes?.obs ?? {};
  const wdDeg = (obs.wdir != null && obs.wdir !== 'VRB') ? Number(obs.wdir) : null;
  const ws    = obs.wspd  != null ? Number(obs.wspd)  * 0.514444 : 0;  // knots → m/s
  const wg    = obs.wgst != null  ? Number(obs.wgst) * 0.514444 : ws;  // knots → m/s, fallback to wspd
  const temp  = obs.temp  != null ? Number(obs.temp)  : null;           // already °C
  const pres  = obs.slp   != null ? Number(obs.slp)   : null;           // hPa sea-level

  const wx = {
    current: {
      wind_speed_10m:      ws,
      wind_direction_10m:  wdDeg,
      wind_gusts_10m:      wg,
      temperature_2m:      temp,
      apparent_temperature: temp,   // BIRK doesn't supply feels-like; use actual temp
      weather_code:        null,    // no weather code from BIRK
      surface_pressure:    pres,
      _source: 'BIRK',
      _obs_time: obs.reportTime || obs.obsTime || null,
    },
    // Hourly data for chart — from Open-Meteo (or empty fallback)
    hourly: hourlyData?.hourly ?? {
      time: [], wind_speed_10m: [], wind_direction_10m: [],
      wind_gusts_10m: [], surface_pressure: [],
    },
  };

  // ── Supplement BIRK nulls with ATM current data ──────────────────────────────────
  const atmCur = hourlyData?.current;
  if (atmCur) {
    if (wx.current.wind_gusts_10m === wx.current.wind_speed_10m && atmCur.wind_gusts_10m != null)
      wx.current.wind_gusts_10m = atmCur.wind_gusts_10m;
    if (wx.current.apparent_temperature === wx.current.temperature_2m && atmCur.apparent_temperature != null)
      wx.current.apparent_temperature = atmCur.apparent_temperature;
    if (wx.current.surface_pressure == null && atmCur.surface_pressure != null)
      wx.current.surface_pressure = atmCur.surface_pressure;
    if (wx.current.weather_code == null && atmCur.weather_code != null)
      wx.current.weather_code = atmCur.weather_code;
  }
  return { wx, marine };
}

// ── Compact widget (member + dailylog) ────────────────────────────────────────
// Always uses WX_DEFAULT coords regardless of any location override.
// targetEl  : DOM element to render into (must have class wx-widget in CSS)
// onData    : optional callback(snapshot)
// Returns { refresh(), start(), stop() }
function wxWidget(targetEl, { onData, showRefreshBtn = true, label } = {}) {
  const loc = { lat: WX_DEFAULT.lat, lon: WX_DEFAULT.lon, label: label || WX_DEFAULT.label };
  let timer = null;

  async function refresh() {
    try {
      const { wx, marine } = await wxFetch(loc.lat, loc.lon);
      const c    = wx.current;
      const mc   = marine?.current;
      const hr   = wx.hourly;
      const ws   = c.wind_speed_10m, wd = c.wind_direction_10m, wg = c.wind_gusts_10m;
      const bft  = wxMsToBft(ws), wDir = wxDirLabel(wd);
      const waveH = mc?.wave_height ?? null;
      const sst   = mc?.sea_surface_temperature ?? null;
      const pres  = c.surface_pressure;
      const { flagKey, flag, reasons } = wxAssessFlag(ws, wDir, waveH ?? 0);

      const nowISO = new Date().toISOString().slice(0,13);
      const nowIdx = Math.max(0, (hr.time||[]).findIndex(t => t.slice(0,13) === nowISO));
      const { trend, diff } = wxPressureTrend(hr.surface_pressure, nowIdx);

      if (onData) onData({ ws, wd, wg, bft, waveH, wDir, sst, airT: c.temperature_2m,
        apparentT: c.apparent_temperature, code: c.weather_code, flagKey, pres, presTrend: trend });

      const updTime = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      targetEl.className = `wx-widget flag-${flagKey}`;
      targetEl.innerHTML = `
        <div class="wx-top">
          <div style="display:flex;align-items:flex-start;gap:14px">
            <!-- wind col -->
            <div style="flex:1">
              <div style="font-size:9px;color:var(--muted);letter-spacing:1.2px;margin-bottom:8px">BIRK · CONDITIONS${c._obs_time ? ' · ' + c._obs_time.slice(11,16) + ' UTC' : ''}</div>
              <!-- row 1: arrow · speed · m/s · divider · conditions icon · air temp · feels like -->
              <div style="display:flex;align-items:center;gap:0;line-height:1;flex-wrap:wrap">
                <span style="font-size:36px;color:var(--brass);font-weight:500;line-height:1;margin-right:4px">${wxDirArrow(wd)}</span>
                <span style="font-size:36px;color:var(--brass);font-weight:500;line-height:1">${Math.round(ws)}</span>
                <span style="font-size:13px;color:var(--muted);margin-left:5px;margin-right:16px">m/s</span>
                <span style="width:1px;height:32px;background:var(--border);margin-right:16px;flex-shrink:0"></span>
                <span style="font-size:28px;line-height:1;margin-right:10px">${c.weather_code != null ? wxCondIcon(c.weather_code) : '🌬'}</span>
                <span style="display:flex;flex-direction:column;gap:2px">
                  <span style="font-size:20px;font-weight:500;color:var(--text);line-height:1">${c.temperature_2m != null ? Math.round(c.temperature_2m)+'°' : '–'}</span>
                  ${c.apparent_temperature != null && c.apparent_temperature !== c.temperature_2m
                    ? `<span style="font-size:10px;color:var(--muted);line-height:1">feels ${Math.round(c.apparent_temperature)}°</span>`
                    : ''}
                </span>
              </div>
              <!-- row 2: dir · kt -->
              <div style="font-size:13px;color:var(--muted);margin-top:5px;display:flex;align-items:center;gap:6px">
                <b style="color:var(--text)">${wDir}</b>
                <span style="color:var(--border)">·</span>
                <b style="color:var(--text)">${wxMsToKt(ws)}</b> kt
                ${c.weather_code != null ? `<span style="color:var(--border)">·</span><span style="font-size:11px">${wxCondDesc(c.weather_code)}</span>` : ''}
              </div>
              <!-- gusts row -->
              <div style="font-size:11px;color:var(--muted);margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;gap:14px;flex-wrap:wrap">
                <span>Gusts <b style="color:var(--text)">${Math.round(wg)} m/s</b> · <b style="color:var(--text)">${wxMsToKt(wg)} kt</b></span>
                <span>Bft <b style="color:var(--text)">${bft}</b> — ${wxBftDesc(bft)}</span>
              </div>
            </div>
          </div>
        </div>
        <!-- secondary cells: sea · waves · pressure -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:10px">
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
        <!-- footer: flag pill · refresh · full forecast -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;border-top:1px solid var(--border);padding-top:10px;gap:8px;flex-wrap:wrap">
          <span class="flag-pill" style="color:${flag.color};border-color:${flag.border};background:${flag.bg};display:inline-flex;align-items:center;gap:6px;border-radius:20px;border:1px solid;padding:4px 10px;font-size:11px;font-weight:500">
            ${flag.icon} ${flag.label} — ${flag.advice}
          </span>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            ${showRefreshBtn ? `<button onclick="this.closest('.wx-widget')._wxRefresh()" title="Refresh" style="background:none;border:1px solid var(--border);color:var(--muted);padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;font-family:inherit" aria-label="Refresh weather">↻ ${updTime}</button>` : `<span style="font-size:10px;color:var(--muted)">↻ ${updTime}</span>`}
            <a href="../weather/" style="font-size:12px;font-weight:500;color:#fff;background:var(--brass);border-radius:6px;padding:4px 12px;text-decoration:none;white-space:nowrap">⛅ Full forecast →</a>
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

// ── wxSnapshot ────────────────────────────────────────────────────────────────
// Compact storable object from an onData snapshot. Integer wind speeds, 1dp waves.
function wxSnapshot(snap) {
  if (!snap) return null;
  return {
    bft:      snap.bft,
    ws:       Math.round(snap.ws  || 0),
    wg:       Math.round(snap.wg  || 0),
    wd:       snap.wd  != null ? Math.round(snap.wd)  : null,
    dir:      snap.wDir || '',
    wv:       snap.waveH    != null ? parseFloat(snap.waveH.toFixed(1))    : null,
    waveDir:  snap.waveDir  != null ? snap.waveDir                         : null,
    sst:      snap.sst      != null ? parseFloat(snap.sst.toFixed(1))      : null,
    tc:       snap.airT     != null ? Math.round(snap.airT)                : null,
    feels:    snap.apparentT!= null ? Math.round(snap.apparentT)           : null,
    pres:     snap.pres     != null ? Math.round(snap.pres)                : null,
    presTrend:snap.presTrend || null,
    cond:     snap.code != null ? { icon: wxCondIcon(snap.code), desc: wxCondDesc(snap.code) } : null,
    flag:     snap.flagKey || '',
    ts:       new Date().toISOString().slice(0,16),
  };
}
