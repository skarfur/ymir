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

function _jcen(d) {
  return (d.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / (36525 * 86400000);
}

function _astro(T) {
  const m = v => ((v % 360) + 360) % 360;
  return {
    s: m(218.3165 + 481267.8813 * T),
    h: m(280.4661 +  36000.7698 * T),
    p: m( 83.3535 +   4069.0137 * T),
    N: m(125.0445 -   1934.1363 * T),
  };
}

function _v0(a) {
  const { s, h, p } = a;
  const m = v => ((v % 360) + 360) % 360;
  return {
    M2: m(2*h - 2*s), S2: 0, N2: m(2*h - 3*s + p), K2: m(2*h),
    K1: m(h - 90), O1: m(h - 2*s + 90), P1: m(-h + 90), Q1: m(h - 3*s + p + 90),
  };
}

function _nodal(N) {
  const c = Math.cos(N * DEG), s = Math.sin(N * DEG);
  return {
    M2: { f: 1.0 - 0.037*c, u: -2.14*s },   S2: { f: 1.0, u: 0 },
    N2: { f: 1.0 - 0.037*c, u: -2.14*s },   K2: { f: 1.024 + 0.286*c, u: -17.74*s },
    K1: { f: 1.006 + 0.115*c, u: -8.86*s },  O1: { f: 1.009 + 0.187*c, u: 10.80*s },
    P1: { f: 1.0, u: 0 },                     Q1: { f: 1.009 + 0.187*c, u: 10.80*s },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIDE PREDICTION
// ═══════════════════════════════════════════════════════════════════════════════

function tideHeight(date) {
  const midnight = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const T = _jcen(midnight), a = _astro(T), v0 = _v0(a), nd = _nodal(a.N);
  const hrs = (date.getTime() - midnight.getTime()) / 3600000;
  let h = TIDE_STATION.z0;
  for (const c of TIDE_STATION.constituents) {
    const n = nd[c.name];
    h += n.f * c.H * Math.cos((c.speed * hrs + v0[c.name] + n.u - c.G) * DEG);
  }
  return h;
}

function _tideSeries(dateStr, stepMin, padH) {
  const base = new Date(dateStr + 'T00:00:00Z');
  const s = base.getTime() - (padH||0)*3600000, e = base.getTime() + 24*3600000 + (padH||0)*3600000;
  const step = stepMin * 60000, pts = [];
  for (let ms = s; ms <= e; ms += step) { const d = new Date(ms); pts.push({ time: d, height: tideHeight(d) }); }
  return pts;
}

function tideExtrema(dateStr) {
  const pts = _tideSeries(dateStr, 6, 1);
  const ds = new Date(dateStr + 'T00:00:00Z').getTime(), de = ds + 86400000;
  const highs = [], lows = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i-1].height, c = pts[i].height, n = pts[i+1].height, t = pts[i].time.getTime();
    if (t < ds || t >= de) continue;
    if (c > p && c > n) highs.push(pts[i]);
    else if (c < p && c < n) lows.push(pts[i]);
  }
  return { highs, lows };
}

function tideToDailyLog(ex) {
  const f = d => String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
  const v = h => h.toFixed(1);
  const [h1,h2] = ex.highs, [l1,l2] = ex.lows;
  return {
    h1t: h1?f(h1.time):'', h1h: h1?v(h1.height):'', l1t: l1?f(l1.time):'', l1h: l1?v(l1.height):'',
    h2t: h2?f(h2.time):'', h2h: h2?v(h2.height):'', l2t: l2?f(l2.time):'', l2h: l2?v(l2.height):'',
  };
}

function tideChartSeries(dateStr) { return _tideSeries(dateStr, 15, 0); }

// ═══════════════════════════════════════════════════════════════════════════════
// MOON PHASE
// ═══════════════════════════════════════════════════════════════════════════════
const SYNODIC_MONTH = 29.53059;
const NEW_MOON_EPOCH = Date.UTC(2024, 0, 11, 11, 57, 0);

function moonPhase(date) {
  const days = (date.getTime() - NEW_MOON_EPOCH) / 86400000;
  const fr = (((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH) / SYNODIC_MONTH;
  const IS = typeof getLang === 'function' && getLang() === 'IS';
  const phases = [
    [0.0625, '\u{1F311}', 'New Moon',        'Nýtt tungl'],
    [0.1875, '\u{1F312}', 'Waxing Crescent', 'Vaxandi skera'],
    [0.3125, '\u{1F313}', 'First Quarter',   'Fyrsti fjórðungur'],
    [0.4375, '\u{1F314}', 'Waxing Gibbous',  'Vaxandi hálft'],
    [0.5625, '\u{1F315}', 'Full Moon',        'Fullt tungl'],
    [0.6875, '\u{1F316}', 'Waning Gibbous',   'Minnkandi hálft'],
    [0.8125, '\u{1F317}', 'Last Quarter',     'Síðasti fjórðungur'],
    [0.9375, '\u{1F318}', 'Waning Crescent',  'Minnkandi skera'],
    [1.0001, '\u{1F311}', 'New Moon',          'Nýtt tungl'],
  ];
  const p = phases.find(x => fr < x[0]);
  return { fraction: fr, icon: p[1], label: IS ? p[3] : p[2] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUNRISE / SUNSET
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchSunTimes(lat, lon, dateStr) {
  const k = 'ymir_sun_' + dateStr;
  const c = sessionStorage.getItem(k);
  if (c) { const o = JSON.parse(c); if (Date.now() - o.ts < 3600000) return o.data; }
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=Atlantic/Reykjavik&start_date=${dateStr}&end_date=${dateStr}`);
    if (!r.ok) return null;
    const j = await r.json();
    const data = { sunrise: (j.daily?.sunrise?.[0]||'').slice(11,16)||null, sunset: (j.daily?.sunset?.[0]||'').slice(11,16)||null };
    sessionStorage.setItem(k, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch(_) { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED SVG CHART  —  matches weather page chart style
//
// Renders a tide curve with:
//  · Past-time dark overlay + dashed NOW marker (like wind/pressure charts)
//  · Time axis along bottom every 3h
//  · High labels above peaks, low labels inside troughs (above baseline)
//  · Dots at extrema
// ═══════════════════════════════════════════════════════════════════════════════
function tideSvgChart(series, extrema, nowMs, W, H) {
  const P = { t: 14, b: 26, l: 4, r: 4 };
  const iW = W - P.l - P.r, iH = H - P.t - P.b;
  // Fixed Y scale based on station tidal range (0m to ~4.3m full spring range)
  const hMin = 0, hMax = 4.3;
  const hRange = hMax - hMin;
  const t0 = series[0].time.getTime(), t1 = series[series.length-1].time.getTime();
  const tR = t1 - t0 || 1;

  const xOf = t => P.l + ((t - t0) / tR) * iW;
  const yOf = h => P.t + (1 - (h - hMin) / hRange) * iH;
  const f1 = v => v.toFixed(1);
  const fmtT = d => String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');

  // Curve paths
  const pts = series.map(p => `${f1(xOf(p.time.getTime()))},${f1(yOf(p.height))}`);
  const linePath = 'M' + pts.join('L');
  const areaPath = linePath + `L${f1(xOf(t1))},${f1(yOf(hMin))}L${f1(xOf(t0))},${f1(yOf(hMin))}Z`;

  let svg = '';

  // Past overlay
  if (nowMs > t0 && nowMs <= t1) {
    const nw = Math.max(0, xOf(nowMs) - P.l);
    svg += `<rect class="chart-past" x="${P.l}" y="${P.t}" width="${f1(nw)}" height="${iH}"/>`;
  }

  // Area fill + line
  svg += `<path class="chart-area c-blue" d="${areaPath}"/>`;
  svg += `<path class="chart-line c-blue" d="${linePath}"/>`;

  // NOW marker
  if (nowMs > t0 && nowMs <= t1) {
    const nx = f1(xOf(nowMs));
    svg += `<line class="chart-now" x1="${nx}" y1="${P.t}" x2="${nx}" y2="${f1(P.t+iH)}"/>`;
    svg += `<text class="chart-now-t" x="${nx}" y="${f1(H-P.b+11)}" text-anchor="middle">NOW</text>`;
  }

  // Time axis (every 3h)
  for (let h = 0; h <= 24; h += 3) {
    const ms = t0 + h * 3600000;
    if (ms > t1) break;
    const tx = f1(xOf(ms));
    const lbl = String(h).padStart(2, '0') + ':00';
    svg += `<text class="chart-axis-t" x="${tx}" y="${f1(H-2)}" text-anchor="middle">${lbl}</text>`;
  }

  // Extrema labels + dots
  const events = [
    ...extrema.highs.map(e => ({ ...e, type: 'high' })),
    ...extrema.lows.map(e  => ({ ...e, type: 'low' })),
  ];
  events.forEach(e => {
    const ex = xOf(e.time.getTime()), ey = yOf(e.height);
    const isHigh = e.type === 'high';
    const cc = isHigh ? 'c-brass' : 'c-blue';
    const timeTxt = fmtT(e.time);
    const htTxt = e.height.toFixed(1) + 'm';

    // Time above the dot, height below the dot
    const timeY = Math.max(8, ey - 8);
    const htY = Math.min(H - 4, ey + 13);
    const lineW = Math.max(timeTxt.length, htTxt.length) * 4.6;

    // Background rects for legibility
    svg += `<rect class="chart-lbl-bg" x="${f1(ex - lineW/2 - 1)}" y="${f1(timeY - 7)}" width="${f1(lineW + 2)}" height="9" rx="1"/>`;
    svg += `<text class="chart-lbl ${cc}" x="${f1(ex)}" y="${f1(timeY)}" text-anchor="middle">${timeTxt}</text>`;
    svg += `<circle class="chart-dot ${cc}" cx="${f1(ex)}" cy="${f1(ey)}" r="2"/>`;
    svg += `<rect class="chart-lbl-bg" x="${f1(ex - lineW/2 - 1)}" y="${f1(htY - 7)}" width="${f1(lineW + 2)}" height="9" rx="1"/>`;
    svg += `<text class="chart-lbl c-muted" x="${f1(ex)}" y="${f1(htY)}" text-anchor="middle">${htTxt}</text>`;
  });

  return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">${svg}</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIDE WIDGET  —  compact card with SVG curve + day nav + today button
// ═══════════════════════════════════════════════════════════════════════════════
function tideWidget(targetEl, { onData } = {}) {
  let timer = null, _dateOffset = 0;

  function _dateStr(off) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + (off||0));
    return d.toISOString().slice(0,10);
  }

  async function refresh() {
    const IS = typeof getLang === 'function' && getLang() === 'IS';
    const now = new Date();
    const dateStr = _dateStr(_dateOffset);
    const isToday = _dateOffset === 0;
    const extrema = tideExtrema(dateStr);
    const series  = tideChartSeries(dateStr);
    const moon = moonPhase(isToday ? now : new Date(dateStr + 'T12:00:00Z'));
    const sun = await fetchSunTimes(TIDE_STATION.lat, TIDE_STATION.lon, dateStr);
    if (onData) onData({ extrema, moon, sun, dateStr });

    // Status (today: trend, other days: today button)
    let statusHtml = '';
    if (isToday) {
      const curH = tideHeight(now), soonH = tideHeight(new Date(now.getTime() + 600000));
      const up = soonH > curH;
      const col = up ? 'var(--green,#2ecc71)' : 'var(--orange,#e67e22)';
      const lbl = up ? (IS?'Hækkandi':'Rising') : (IS?'Lækkandi':'Falling');
      statusHtml = `<span style="color:${col};font-weight:700;font-size:12px">${up?'↑':'↓'}</span>`
        + `<span style="color:${col};font-size:10px;font-weight:500">${lbl}</span>`
        + `<span style="font-size:11px;font-weight:500;color:var(--text);font-family:'DM Mono',monospace">${curH.toFixed(1)}m</span>`;
    } else {
      statusHtml = `<button class="tide-today-btn" style="background:none;border:1px solid var(--border);color:var(--brass);border-radius:4px;padding:0 6px;font-size:9px;cursor:pointer;font-family:inherit;line-height:1.6;letter-spacing:.3px">${IS?'Fara á í dag':'Go to today'}</button>`;
    }

    // Day label
    const dd = new Date(dateStr + 'T12:00:00Z');
    const dayLabel = isToday ? (IS?'Í dag':'Today')
      : dd.toLocaleDateString(IS?'is-IS':'en-GB', { weekday:'short', day:'numeric', month:'short' });

    // Today button now lives in status area (see above)

    // Nav button style (shared)
    const navStyle = 'background:none;border:1px solid var(--border);color:var(--muted);border-radius:4px;padding:0 6px;font-size:11px;cursor:pointer;font-family:inherit;line-height:1.6';

    // Sun / moon
    const sunHtml = sun
      ? `<span style="font-size:10px">☀️</span>`
      + `<span style="font-size:10px;color:var(--muted)"><b style="font-weight:700">↑</b> <span style="color:var(--text);font-weight:500">${sun.sunrise||'–'}</span></span>`
      + `<span style="font-size:10px;color:var(--muted)"><b style="font-weight:700">↓</b> <span style="color:var(--text);font-weight:500">${sun.sunset||'–'}</span></span>`
      : '';
    const moonHtml = `<span style="font-size:12px">${moon.icon}</span><span style="font-size:9px;color:var(--muted)">${moon.label}</span>`;

    const disclaimer = IS
      ? 'Spálíkan ±15–30 mín'
      : 'Prediction model ±15–30 min';

    // Chart
    const svg = tideSvgChart(series, extrema, isToday ? now.getTime() : -1, 640, 120);

    targetEl.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="display:flex;align-items:center;gap:4px">${statusHtml}</div>
          <div style="display:flex;align-items:center;gap:6px">${sunHtml}${moonHtml}</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:2px">
          <button class="tide-nav-btn" data-dir="-1" style="${navStyle}">◀</button>
          <span style="font-size:10px;color:var(--text);font-weight:500;min-width:70px;text-align:center">${dayLabel}</span>
          <button class="tide-nav-btn" data-dir="1" style="${navStyle}">▶</button>
        </div>
        ${svg}
        <div style="text-align:right;margin-top:2px">
          <span style="font-size:7px;color:var(--muted);opacity:.55">⚠️ ${disclaimer}</span>
        </div>
      </div>`;

    // Wire nav
    targetEl.querySelectorAll('.tide-nav-btn').forEach(b => {
      b.onclick = () => { _dateOffset += parseInt(b.dataset.dir); refresh(); };
    });
    const tb = targetEl.querySelector('.tide-today-btn');
    if (tb) tb.onclick = () => { _dateOffset = 0; refresh(); };
  }

  function start(ms) { refresh(); timer = setInterval(refresh, ms||300000); return { refresh, start, stop }; }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  return { refresh, start, stop };
}
