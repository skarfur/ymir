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
  const mod360 = v => ((v % 360) + 360) % 360;
  return {
    s:  mod360(218.3165 + 481267.8813 * T),
    h:  mod360(280.4661 +  36000.7698 * T),
    p:  mod360( 83.3535 +   4069.0137 * T),
    N:  mod360(125.0445 -   1934.1363 * T),
  };
}

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

function _nodal(N) {
  const cosN = Math.cos(N * DEG), sinN = Math.sin(N * DEG);
  return {
    M2: { f: 1.0 - 0.037 * cosN, u: -2.14 * sinN },
    S2: { f: 1.0, u: 0 },
    N2: { f: 1.0 - 0.037 * cosN, u: -2.14 * sinN },
    K2: { f: 1.024 + 0.286 * cosN, u: -17.74 * sinN },
    K1: { f: 1.006 + 0.115 * cosN, u: -8.86 * sinN },
    O1: { f: 1.009 + 0.187 * cosN, u: 10.80 * sinN },
    P1: { f: 1.0, u: 0 },
    Q1: { f: 1.009 + 0.187 * cosN, u: 10.80 * sinN },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIDE PREDICTION
// ═══════════════════════════════════════════════════════════════════════════════

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
    h += n.f * c.H * Math.cos((c.speed * hoursFromMidnight + v0[c.name] + n.u - c.G) * DEG);
  }
  return h;
}

// Dense time series for chart + extrema detection
function _tideSeries(dateStr, stepMin, padH) {
  const base = new Date(dateStr + 'T00:00:00Z');
  const start = base.getTime() - (padH || 0) * 3600000;
  const end   = base.getTime() + 24 * 3600000 + (padH || 0) * 3600000;
  const step  = stepMin * 60000;
  const pts = [];
  for (let ms = start; ms <= end; ms += step) {
    const d = new Date(ms);
    pts.push({ time: d, height: tideHeight(d) });
  }
  return pts;
}

function tideExtrema(dateStr) {
  const pts = _tideSeries(dateStr, 6, 1);
  const dayStart = new Date(dateStr + 'T00:00:00Z').getTime();
  const dayEnd   = dayStart + 24 * 3600000;
  const highs = [], lows = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1].height, cur = pts[i].height, next = pts[i + 1].height;
    const t = pts[i].time.getTime();
    if (t < dayStart || t >= dayEnd) continue;
    if (cur > prev && cur > next) highs.push({ time: pts[i].time, height: cur });
    else if (cur < prev && cur < next) lows.push({ time: pts[i].time, height: cur });
  }
  return { highs, lows };
}

function tideToDailyLog(extrema) {
  const fmt = d => String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
  const fH = h => h.toFixed(1);
  const h1 = extrema.highs[0], h2 = extrema.highs[1];
  const l1 = extrema.lows[0],  l2 = extrema.lows[1];
  return {
    h1t: h1 ? fmt(h1.time) : '', h1h: h1 ? fH(h1.height) : '',
    l1t: l1 ? fmt(l1.time) : '', l1h: l1 ? fH(l1.height) : '',
    h2t: h2 ? fmt(h2.time) : '', h2h: h2 ? fH(h2.height) : '',
    l2t: l2 ? fmt(l2.time) : '', l2h: l2 ? fH(l2.height) : '',
  };
}

// Chart-resolution series (every 15 min) for SVG rendering
function tideChartSeries(dateStr) {
  return _tideSeries(dateStr, 15, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOON PHASE
// ═══════════════════════════════════════════════════════════════════════════════
const SYNODIC_MONTH = 29.53059;
const NEW_MOON_EPOCH = Date.UTC(2024, 0, 11, 11, 57, 0);

function moonPhase(date) {
  const daysSince = (date.getTime() - NEW_MOON_EPOCH) / 86400000;
  const phase = ((daysSince % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const fraction = phase / SYNODIC_MONTH;
  const IS = typeof getLang === 'function' && getLang() === 'IS';
  let icon, label;
  if      (fraction < 0.0625) { icon = '\u{1F311}'; label = IS ? 'Nýtt tungl'        : 'New Moon'; }
  else if (fraction < 0.1875) { icon = '\u{1F312}'; label = IS ? 'Vaxandi skera'     : 'Waxing Crescent'; }
  else if (fraction < 0.3125) { icon = '\u{1F313}'; label = IS ? 'Fyrsti fjórðungur'  : 'First Quarter'; }
  else if (fraction < 0.4375) { icon = '\u{1F314}'; label = IS ? 'Vaxandi hálft'      : 'Waxing Gibbous'; }
  else if (fraction < 0.5625) { icon = '\u{1F315}'; label = IS ? 'Fullt tungl'        : 'Full Moon'; }
  else if (fraction < 0.6875) { icon = '\u{1F316}'; label = IS ? 'Minnkandi hálft'    : 'Waning Gibbous'; }
  else if (fraction < 0.8125) { icon = '\u{1F317}'; label = IS ? 'Síðasti fjórðungur' : 'Last Quarter'; }
  else if (fraction < 0.9375) { icon = '\u{1F318}'; label = IS ? 'Minnkandi skera'    : 'Waning Crescent'; }
  else                        { icon = '\u{1F311}'; label = IS ? 'Nýtt tungl'        : 'New Moon'; }
  return { fraction, icon, label };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUNRISE / SUNSET
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchSunTimes(lat, lon, dateStr) {
  const cacheKey = 'ymir_sun_' + dateStr;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) { const c = JSON.parse(cached); if (Date.now() - c.ts < 3600000) return c.data; }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&daily=sunrise,sunset&timezone=Atlantic/Reykjavik&start_date=${dateStr}&end_date=${dateStr}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const data = {
      sunrise: (json.daily?.sunrise?.[0] || '').slice(11, 16) || null,
      sunset:  (json.daily?.sunset?.[0]  || '').slice(11, 16) || null,
    };
    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch (_) { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIDE WIDGET  —  compact card with SVG wave curve + day navigation
// ═══════════════════════════════════════════════════════════════════════════════
function tideWidget(targetEl, { onData } = {}) {
  let timer = null;
  let _dateOffset = 0; // 0 = today, +1 = tomorrow, -1 = yesterday

  function _dateStr(offset) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + (offset || 0));
    return d.toISOString().slice(0, 10);
  }

  function _fmtTime(d) {
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }

  // ── SVG wave curve ────────────────────────────────────────────────────────
  function _renderCurve(series, extrema, nowMs, W, H) {
    const PAD_T = 18, PAD_B = 4, PAD_L = 0, PAD_R = 0;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const hMin = Math.min(...series.map(p => p.height));
    const hMax = Math.max(...series.map(p => p.height));
    const range = hMax - hMin || 1;
    const t0 = series[0].time.getTime(), t1 = series[series.length - 1].time.getTime();
    const tRange = t1 - t0 || 1;

    const x = t => PAD_L + ((t - t0) / tRange) * plotW;
    const y = h => PAD_T + plotH - ((h - hMin) / range) * plotH;

    // Wave path
    const pathPts = series.map(p => `${x(p.time.getTime()).toFixed(1)},${y(p.height).toFixed(1)}`);
    const path = `M${pathPts.join('L')}`;

    // Filled area
    const fill = `${path}L${x(t1).toFixed(1)},${(PAD_T + plotH).toFixed(1)}L${x(t0).toFixed(1)},${(PAD_T + plotH).toFixed(1)}Z`;

    // Now-marker
    let nowLine = '';
    if (nowMs >= t0 && nowMs <= t1) {
      const nx = x(nowMs);
      nowLine = `<line x1="${nx.toFixed(1)}" y1="${PAD_T}" x2="${nx.toFixed(1)}" y2="${(PAD_T + plotH).toFixed(1)}" stroke="var(--brass)" stroke-width="1.5" stroke-dasharray="3,2" opacity="0.7"/>`;
    }

    // Extrema labels positioned at the curve peaks/troughs
    const allEvents = [
      ...extrema.highs.map(e => ({ ...e, type: 'high' })),
      ...extrema.lows.map(e  => ({ ...e, type: 'low' })),
    ];
    const labels = allEvents.map(e => {
      const ex = x(e.time.getTime());
      const ey = y(e.height);
      const isHigh = e.type === 'high';
      const color = isHigh ? 'var(--brass)' : '#4a9eca';
      // Place label above highs, below lows
      const ly = isHigh ? Math.max(2, ey - 5) : Math.min(H - 1, ey + 11);
      const txt = _fmtTime(e.time) + ' ' + e.height.toFixed(1) + 'm';
      return `<text x="${ex.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="${color}" font-size="8" font-family="'DM Mono',monospace" font-weight="500">${txt}</text>`
        + `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.5" fill="${color}"/>`;
    }).join('');

    // Hour ticks along bottom
    const ticks = [];
    const dayStart = series[0].time.getTime();
    for (let h = 0; h <= 24; h += 6) {
      const ms = dayStart + h * 3600000;
      if (ms < t0 || ms > t1) continue;
      const tx = x(ms);
      ticks.push(`<line x1="${tx.toFixed(1)}" y1="${(PAD_T + plotH).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(PAD_T + plotH + 3).toFixed(1)}" stroke="var(--border)" stroke-width="0.5"/>`);
      ticks.push(`<text x="${tx.toFixed(1)}" y="${(H).toFixed(1)}" text-anchor="middle" fill="var(--muted)" font-size="7" font-family="'DM Mono',monospace">${String(h).padStart(2,'0')}</text>`);
    }

    return `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;overflow:visible">
      <path d="${fill}" fill="var(--brass)" opacity="0.07"/>
      <path d="${path}" fill="none" stroke="var(--brass)" stroke-width="1.5" opacity="0.6"/>
      ${ticks.join('')}
      ${nowLine}
      ${labels}
    </svg>`;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  async function refresh() {
    const IS = typeof getLang === 'function' && getLang() === 'IS';
    const now = new Date();
    const dateStr = _dateStr(_dateOffset);
    const isToday = _dateOffset === 0;
    const extrema = tideExtrema(dateStr);
    const series  = tideChartSeries(dateStr);
    const moon = moonPhase(isToday ? now : new Date(dateStr + 'T12:00:00Z'));
    const sun = await fetchSunTimes(TIDE_STATION.lat, TIDE_STATION.lon, dateStr);

    // Current state (only meaningful for today)
    let statusHtml = '';
    if (isToday) {
      const curH = tideHeight(now);
      const soonH = tideHeight(new Date(now.getTime() + 600000));
      const rising = soonH > curH;
      const arrow = rising ? '↑' : '↓';
      const color = rising ? 'var(--green,#2ecc71)' : 'var(--orange,#e67e22)';
      const lbl = rising ? (IS ? 'Hækkandi' : 'Rising') : (IS ? 'Lækkandi' : 'Falling');
      statusHtml = `<span style="color:${color};font-weight:600;font-size:13px">${arrow}</span>`
        + `<span style="color:${color};font-size:11px;font-weight:500">${lbl}</span>`
        + `<span style="font-size:12px;font-weight:600;color:var(--text);font-family:'DM Mono',monospace">${curH.toFixed(1)}m</span>`;
    }

    // Date label for nav
    const dd = new Date(dateStr + 'T12:00:00Z');
    const dayLabel = isToday
      ? (IS ? 'Í dag' : 'Today')
      : dd.toLocaleDateString(IS ? 'is-IS' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

    // Sun row
    const sunHtml = sun
      ? `<span style="font-size:11px;color:var(--muted)">☀↑<b style="color:var(--text);margin:0 2px">${sun.sunrise || '–'}</b></span>`
      + `<span style="font-size:11px;color:var(--muted)">☀↓<b style="color:var(--text);margin:0 2px">${sun.sunset || '–'}</b></span>`
      : '';

    const moonHtml = `<span style="font-size:13px">${moon.icon}</span><span style="font-size:10px;color:var(--muted)">${moon.label}</span>`;

    const disclaimer = IS
      ? 'Spá reiknuð úr harmónísku líkani — ekki birt gögn. Notið með varúð.'
      : 'Predicted from harmonic model — not published data. Use with caution.';

    // SVG
    const svgHtml = _renderCurve(series, extrema, isToday ? now.getTime() : -1, 280, 70);

    if (onData) onData({ extrema, moon, sun, dateStr });

    targetEl.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="font-size:9px;color:var(--muted);letter-spacing:1.2px">${IS ? 'FLÓÐ · FAXAFLÓI' : 'TIDES · FAXAFLÓI'}</div>
          <div style="display:flex;align-items:center;gap:5px">${statusHtml}</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:4px">
          <button class="tide-nav-btn" data-dir="-1" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:4px;padding:1px 7px;font-size:12px;cursor:pointer;font-family:inherit;line-height:1.4">◀</button>
          <span style="font-size:11px;color:var(--text);font-weight:500;min-width:80px;text-align:center">${dayLabel}</span>
          <button class="tide-nav-btn" data-dir="1" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:4px;padding:1px 7px;font-size:12px;cursor:pointer;font-family:inherit;line-height:1.4">▶</button>
        </div>
        <div style="margin:0 -4px">${svgHtml}</div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-top:6px">
          ${sunHtml}
          ${moonHtml}
        </div>
        <div style="margin-top:6px;font-size:8px;color:var(--muted);line-height:1.3;opacity:0.6">⚠ ${disclaimer}</div>
      </div>`;

    // Wire nav buttons
    targetEl.querySelectorAll('.tide-nav-btn').forEach(btn => {
      btn.onclick = () => {
        _dateOffset += parseInt(btn.dataset.dir);
        refresh();
      };
    });
  }

  function start(intervalMs) {
    refresh();
    timer = setInterval(refresh, intervalMs || 300000);
    return { refresh, start, stop };
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { refresh, start, stop };
}
