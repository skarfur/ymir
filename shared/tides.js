// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR  —  shared/tides.js
//
// Client-side tidal prediction for Reykjavík harbour (Faxaflói) using harmonic
// analysis, plus sunrise/sunset from Open-Meteo and moon phase computation.
//
// IMPORTANT: Tide predictions are interpolated from a harmonic model using
// estimated constituents. They are NOT from published authoritative data.
// Predictions may differ from actual conditions by 15-30 minutes and 0.1-0.3m.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Reykjavík harmonic constants (estimated) ─────────────────────────────────
// Amplitudes (m) and Greenwich phase lags (°) for principal constituents.
// Speeds are exact astronomical values in degrees per hour.
// Z0 = mean sea level above chart datum (LAT), metres.
const TIDE_STATION = {
  name: 'Reykjavík',
  lat: 64.15, lon: -21.94,
  z0: 2.15,
  constituents: [
    { name: 'M2', H: 1.61, G: 188, speed: 28.9841042 },
    { name: 'S2', H: 0.53, G: 218, speed: 30.0000000 },
    { name: 'N2', H: 0.34, G: 168, speed: 28.4397295 },
    { name: 'K2', H: 0.14, G: 218, speed: 30.0821373 },
    { name: 'K1', H: 0.10, G: 190, speed: 15.0410686 },
    { name: 'O1', H: 0.07, G: 170, speed: 13.9430356 },
    { name: 'P1', H: 0.03, G: 190, speed: 14.9589314 },
    { name: 'Q1', H: 0.02, G: 150, speed: 13.3986609 },
  ],
};

const DEG = Math.PI / 180;

// ═══════════════════════════════════════════════════════════════════════════════
// ASTRONOMICAL PARAMETERS
// ═══════════════════════════════════════════════════════════════════════════════

// Julian centuries from J2000.0 (2000-01-01 12:00 UTC)
function _jcen(d) {
  return (d.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / (36525 * 86400000);
}

// Mean astronomical longitudes (degrees) at Julian century T
function _astro(T) {
  const mod360 = v => ((v % 360) + 360) % 360;
  return {
    s:  mod360(218.3165 + 481267.8813 * T),  // Moon mean longitude
    h:  mod360(280.4661 +  36000.7698 * T),  // Sun mean longitude
    p:  mod360( 83.3535 +   4069.0137 * T),  // Moon perigee longitude
    N:  mod360(125.0445 -   1934.1363 * T),  // Moon node longitude
    pp: mod360(282.9384 +      1.7195 * T),  // Sun perigee (perihelion)
  };
}

// Equilibrium argument V0 at midnight UTC for each constituent
// (hour angle T = 0 at midnight, folded into speed × time)
function _v0(a) {
  const { s, h, p } = a;
  const mod360 = v => ((v % 360) + 360) % 360;
  return {
    M2: mod360(2 * h - 2 * s),
    S2: 0,
    N2: mod360(2 * h - 3 * s + p),
    K2: mod360(2 * h),
    K1: mod360(h - 90),
    O1: mod360(h - 2 * s + 90),
    P1: mod360(-h + 90),
    Q1: mod360(h - 3 * s + p + 90),
  };
}

// Nodal amplitude factor (f) and phase correction (u, degrees)
// Simplified Schureman formulas depending on N (Moon node longitude)
function _nodal(N) {
  const cosN = Math.cos(N * DEG);
  const sinN = Math.sin(N * DEG);
  return {
    M2: { f: 1.0 - 0.037 * cosN, u: -2.14 * sinN },
    S2: { f: 1.0,                 u: 0 },
    N2: { f: 1.0 - 0.037 * cosN, u: -2.14 * sinN },
    K2: { f: 1.024 + 0.286 * cosN, u: -17.74 * sinN },
    K1: { f: 1.006 + 0.115 * cosN, u: -8.86 * sinN },
    O1: { f: 1.009 + 0.187 * cosN, u: 10.80 * sinN },
    P1: { f: 1.0,                 u: 0 },
    Q1: { f: 1.009 + 0.187 * cosN, u: 10.80 * sinN },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIDE PREDICTION
// ═══════════════════════════════════════════════════════════════════════════════

// Water level (m above chart datum) at a JS Date
function tideHeight(date) {
  const midnight = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const T = _jcen(midnight);
  const a = _astro(T);
  const v0 = _v0(a);
  const nd = _nodal(a.N);
  const hoursFromMidnight = (date.getTime() - midnight.getTime()) / 3600000;

  let h = TIDE_STATION.z0;
  for (const c of TIDE_STATION.constituents) {
    const n = nd[c.name];
    const arg = c.speed * hoursFromMidnight + v0[c.name] + n.u - c.G;
    h += n.f * c.H * Math.cos(arg * DEG);
  }
  return h;
}

// Compute tide heights at interval (minutes) over a date range, return array of {time, height}
function _tideTimeSeries(dateStr, intervalMin, padHours) {
  const dayStart = new Date(dateStr + 'T00:00:00Z');
  const startMs = dayStart.getTime() - (padHours || 0) * 3600000;
  const endMs   = dayStart.getTime() + 24 * 3600000 + (padHours || 0) * 3600000;
  const stepMs  = intervalMin * 60000;
  const pts = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const d = new Date(ms);
    pts.push({ time: d, height: tideHeight(d) });
  }
  return pts;
}

// Find local extrema (highs and lows) for a given date string 'YYYY-MM-DD'
// Returns { highs: [{time, height}], lows: [{time, height}] }
function tideExtrema(dateStr) {
  // 6-minute intervals with 1-hour padding for boundary extrema
  const pts = _tideTimeSeries(dateStr, 6, 1);
  const dayStart = new Date(dateStr + 'T00:00:00Z').getTime();
  const dayEnd   = dayStart + 24 * 3600000;
  const highs = [], lows = [];

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1].height, cur = pts[i].height, next = pts[i + 1].height;
    const t = pts[i].time.getTime();
    // Only include extrema within the target day
    if (t < dayStart || t >= dayEnd) continue;
    if (cur > prev && cur > next) {
      highs.push({ time: pts[i].time, height: cur });
    } else if (cur < prev && cur < next) {
      lows.push({ time: pts[i].time, height: cur });
    }
  }
  return { highs, lows };
}

// Convert extrema to daily log format {h1t, h1h, l1t, l1h, h2t, h2h, l2t, l2h}
function tideToDailyLog(extrema) {
  const fmt = d => {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  };
  const fmtH = h => h.toFixed(1);
  const h1 = extrema.highs[0], h2 = extrema.highs[1];
  const l1 = extrema.lows[0],  l2 = extrema.lows[1];
  return {
    h1t: h1 ? fmt(h1.time) : '', h1h: h1 ? fmtH(h1.height) : '',
    l1t: l1 ? fmt(l1.time) : '', l1h: l1 ? fmtH(l1.height) : '',
    h2t: h2 ? fmt(h2.time) : '', h2h: h2 ? fmtH(h2.height) : '',
    l2t: l2 ? fmt(l2.time) : '', l2h: l2 ? fmtH(l2.height) : '',
  };
}

// Hourly heights for a day (for simple chart rendering), 25 points (00:00–24:00)
function tideHourly(dateStr) {
  const pts = [];
  const base = new Date(dateStr + 'T00:00:00Z');
  for (let h = 0; h <= 24; h++) {
    const d = new Date(base.getTime() + h * 3600000);
    pts.push({ hour: h, height: tideHeight(d) });
  }
  return pts;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOON PHASE  (synodic cycle from known new-moon epoch)
// ═══════════════════════════════════════════════════════════════════════════════
const SYNODIC_MONTH = 29.53059;
// Known new moon: 2024-01-11 11:57 UTC
const NEW_MOON_EPOCH = Date.UTC(2024, 0, 11, 11, 57, 0);

function moonPhase(date) {
  const daysSince = (date.getTime() - NEW_MOON_EPOCH) / 86400000;
  const phase = ((daysSince % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const fraction = phase / SYNODIC_MONTH; // 0 = new, 0.5 = full

  const IS = typeof getLang === 'function' && getLang() === 'IS';
  let icon, label;
  if      (fraction < 0.0625) { icon = '\u{1F311}'; label = IS ? 'Nýtt tungl'         : 'New Moon'; }
  else if (fraction < 0.1875) { icon = '\u{1F312}'; label = IS ? 'Vaxandi skera'      : 'Waxing Crescent'; }
  else if (fraction < 0.3125) { icon = '\u{1F313}'; label = IS ? 'Fyrsti fjórðungur'   : 'First Quarter'; }
  else if (fraction < 0.4375) { icon = '\u{1F314}'; label = IS ? 'Vaxandi hálft'       : 'Waxing Gibbous'; }
  else if (fraction < 0.5625) { icon = '\u{1F315}'; label = IS ? 'Fullt tungl'         : 'Full Moon'; }
  else if (fraction < 0.6875) { icon = '\u{1F316}'; label = IS ? 'Minnkandi hálft'     : 'Waning Gibbous'; }
  else if (fraction < 0.8125) { icon = '\u{1F317}'; label = IS ? 'Síðasti fjórðungur'  : 'Last Quarter'; }
  else if (fraction < 0.9375) { icon = '\u{1F318}'; label = IS ? 'Minnkandi skera'     : 'Waning Crescent'; }
  else                        { icon = '\u{1F311}'; label = IS ? 'Nýtt tungl'         : 'New Moon'; }

  return { fraction, phase, icon, label };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUNRISE / SUNSET  (from Open-Meteo daily API, cached in sessionStorage)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchSunTimes(lat, lon, dateStr) {
  const cacheKey = 'ymir_sun_' + dateStr;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    const c = JSON.parse(cached);
    if (Date.now() - c.ts < 3600000) return c.data; // 1 hour cache
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&daily=sunrise,sunset&timezone=Atlantic/Reykjavik&start_date=${dateStr}&end_date=${dateStr}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const sunrise = json.daily?.sunrise?.[0] || null;
    const sunset  = json.daily?.sunset?.[0]  || null;
    const data = {
      sunrise: sunrise ? sunrise.slice(11, 16) : null,
      sunset:  sunset  ? sunset.slice(11, 16)  : null,
    };
    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch (_) { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIDE WIDGET
// Follows the wxWidget() pattern from weather.js — returns { refresh, start, stop }
// ═══════════════════════════════════════════════════════════════════════════════

function tideWidget(targetEl, { onData } = {}) {
  let timer = null;

  async function refresh() {
    const IS = typeof getLang === 'function' && getLang() === 'IS';
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const currentHeight = tideHeight(now);
    const extrema = tideExtrema(dateStr);
    const moon = moonPhase(now);

    // Determine rising/falling
    const soon = new Date(now.getTime() + 600000); // 10 min later
    const soonH = tideHeight(soon);
    const rising = soonH > currentHeight;

    // Merge and sort all extrema chronologically
    const events = [
      ...extrema.highs.map(e => ({ ...e, type: 'high' })),
      ...extrema.lows.map(e  => ({ ...e, type: 'low' })),
    ].sort((a, b) => a.time - b.time);

    // Find next upcoming event
    const nextEvent = events.find(e => e.time > now) || events[events.length - 1];

    // Fetch sun times
    const sun = await fetchSunTimes(TIDE_STATION.lat, TIDE_STATION.lon, dateStr);

    if (onData) onData({ extrema, currentHeight, rising, moon, sun, events });

    // ── Render ────────────────────────────────────────────────────────────────
    const fmtTime = d => {
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    };

    const eventRows = events.map(e => {
      const isNext = e === nextEvent;
      const icon = e.type === 'high' ? '▲' : '▼';
      const color = e.type === 'high' ? 'var(--brass)' : '#4a9eca';
      const lbl = e.type === 'high' ? (IS ? 'Flóð' : 'High') : (IS ? 'Fjara' : 'Low');
      const highlight = isNext ? 'font-weight:600;color:var(--text)' : 'color:var(--muted)';
      const marker = isNext ? ` <span style="font-size:8px;background:var(--brass);color:#000;padding:1px 5px;border-radius:8px;vertical-align:middle">${IS ? 'NÆST' : 'NEXT'}</span>` : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;${isNext ? 'border-left:2px solid var(--brass);padding-left:8px;margin-left:-10px' : ''}">
        <span style="color:${color};font-size:14px;width:16px;text-align:center">${icon}</span>
        <span style="font-size:11px;min-width:40px;${highlight}">${lbl}</span>
        <span style="font-size:13px;font-weight:500;color:var(--text);font-family:'DM Mono',monospace">${fmtTime(e.time)}</span>
        <span style="font-size:12px;color:var(--muted)">${e.height.toFixed(1)}m</span>
        ${marker}
      </div>`;
    }).join('');

    const trendArrow = rising ? '↑' : '↓';
    const trendColor = rising ? 'var(--green, #2ecc71)' : 'var(--orange, #e67e22)';
    const trendLabel = rising ? (IS ? 'Hækkandi' : 'Rising') : (IS ? 'Lækkandi' : 'Falling');

    const sunRow = sun ? `
      <div style="display:flex;align-items:center;gap:14px;font-size:11px;color:var(--muted)">
        <span>☀️ ${IS ? 'Rís' : 'Rise'} <b style="color:var(--text)">${sun.sunrise || '–'}</b></span>
        <span>🌅 ${IS ? 'Set' : 'Set'} <b style="color:var(--text)">${sun.sunset || '–'}</b></span>
      </div>` : '';

    const moonRow = `
      <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)">
        <span style="font-size:16px">${moon.icon}</span>
        <span>${moon.label}</span>
      </div>`;

    const disclaimer = IS
      ? 'Flóðspár eru reiknaðar úr harmónísku líkani og ekki frá birtum gögnum. Notið með varúð.'
      : 'Tide predictions are interpolated from harmonic models, not from published data. Use with caution.';

    targetEl.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 18px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:9px;color:var(--muted);letter-spacing:1.2px">${IS ? 'FLÓÐ · FAXAFLÓI' : 'TIDES · FAXAFLÓI'}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:18px;color:${trendColor};font-weight:600">${trendArrow}</span>
            <span style="font-size:12px;color:${trendColor};font-weight:500">${trendLabel}</span>
            <span style="font-size:14px;font-weight:600;color:var(--text);font-family:'DM Mono',monospace">${currentHeight.toFixed(1)}m</span>
          </div>
        </div>
        <div style="margin-bottom:12px;padding-left:10px">
          ${eventRows}
        </div>
        <div style="border-top:1px solid var(--border);padding-top:10px;display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center">
          ${sunRow}
          ${moonRow}
        </div>
        <div style="margin-top:10px;font-size:9px;color:var(--muted);line-height:1.4;opacity:0.7">
          ⚠ ${disclaimer}
        </div>
      </div>`;
  }

  function start(intervalMs) {
    refresh();
    timer = setInterval(refresh, intervalMs || 300000); // 5 min default
    return { refresh, start, stop };
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { refresh, start, stop };
}
