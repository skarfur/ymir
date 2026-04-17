// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR  —  shared/weather.js
//
// Shared weather utilities used across member, staff, daily-log and weather pages.
// Wind data always comes from the atmosphere API at club coords.
//
// FLAG SYSTEM
// -----------
// All flag thresholds live in SCORE_CONFIG (below). Admin can edit these via
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

// Runtime location  —  overridden by full-page location picker (not persisted in
// widgets, which always use the default)
let WX_LAT   = WX_DEFAULT.lat;
let WX_LON   = WX_DEFAULT.lon;
let WX_LABEL = WX_DEFAULT.label;

// ═══════════════════════════════════════════════════════════════════════════════
// DUTY STATUS ICONS  —  Tabler v3 (MIT). Inherit currentColor to match badge text.
// Consumed by wxFlagDetailHtml() below, staff/index.html toggle buttons, and
// public/index.html status pills. Loaded via every page that loads weather.js.
// ═══════════════════════════════════════════════════════════════════════════════
window.DUTY_ICONS = Object.freeze({
  ship:        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1em;height:1em;vertical-align:-.125em;flex-shrink:0"><path d="M2 20a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1"/><path d="M4 18l-1 -5h18l-2 4"/><path d="M5 13v-6h8l4 6"/><path d="M7 7v-4h2"/></svg>',
  shipOff:     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1em;height:1em;vertical-align:-.125em;flex-shrink:0"><path d="M3 3l18 18"/><path d="M2 20a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1"/><path d="M4 18l-1 -5h13m4 0h1l-2 4"/><path d="M5 13v-6h2m4 0h2l4 6"/><path d="M7 7v-4h2"/></svg>',
  lifebuoy:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1em;height:1em;vertical-align:-.125em;flex-shrink:0"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M15 15l3.35 3.35"/><path d="M9 15l-3.35 3.35"/><path d="M5.65 5.65l3.35 3.35"/><path d="M18.35 5.65l-3.35 3.35"/></svg>',
  lifebuoyOff: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1em;height:1em;vertical-align:-.125em;flex-shrink:0"><path d="M3 3l18 18"/><path d="M9.171 5.176a9 9 0 0 1 11.65 11.654m-1.341 2.66a9 9 0 0 1 -12.98 -12.98"/><path d="M10.586 10.589a2 2 0 0 0 2.836 2.823"/><path d="M15 15l3.35 3.35"/><path d="M9 15l-3.35 3.35"/><path d="M5.65 5.65l3.35 3.35"/><path d="M14.95 9.05l3.4 -3.4"/></svg>',
});

// ═══════════════════════════════════════════════════════════════════════════════
// FLAG CONFIG  —  single source of truth for all flag logic
// Admin-editable via admin → Flags tab.  wxLoadFlagConfig() merges saved values.
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// SCORE_CONFIG  —  single source of truth for all flag/scoring logic.
// Admin-editable via admin → Flags tab. wxLoadFlagConfig() merges saved values.
// wxScoreFlag()  computes total score → flag + full breakdown.
// ═══════════════════════════════════════════════════════════════════════════════
const SCORE_CONFIG = {
  thresholds: { yellow: 25, orange: 45, red: 65, black: 80 },
  wind: [
    { maxBft: 3,  pts: 0  },
    { maxBft: 4,  pts: 8  },
    { maxBft: 5,  pts: 16 },
    { maxBft: 6,  pts: 22 },
    { maxBft: 7,  pts: 28 },
    { maxBft: 12, pts: 35 },
  ],
  easterlyDirs:    ['E', 'NE', 'SE', 'ENE', 'ESE'],
  easterlyPts:     5,
  gustModifier1Pts: 4,   // gusts exactly 1 Force level higher than sustained
  gustModifier2Pts: 8,   // gusts 2+ Force levels higher than sustained
  waves: [
    { maxM: 0.5,  pts: 0  },
    { maxM: 1.0,  pts: 8  },
    { maxM: 1.5,  pts: 14 },
    { maxM: 2.0,  pts: 18 },
    { maxM: 99,   pts: 22 },
  ],
  sst: [
    { minC: 12,  pts: 0  },
    { minC: 8,   pts: 5  },
    { minC: 5,   pts: 10 },
    { minC: -99, pts: 15 },
  ],
  feelsLike: [
    { minC: 10,  pts: 0  },
    { minC: 5,   pts: 3  },
    { minC: 0,   pts: 6  },
    { minC: -99, pts: 10 },
  ],
  visibility: { good: 0, reduced: 3, poor: 5 },
  // ─────────────────────────────────────────────────────────────────────────────
  // flags:
  //   color / bg / border / icon  — visual constants (NOT admin-editable).
  //   advice / adviceIS            — short one-line guidance shown next to icon.
  //   description / descriptionIS  — longer guidance shown in the detail modal.
  //
  // Advice and description (both EN + IS) are ADMIN-EDITABLE via
  // admin/index.html → Flags tab. Edits are persisted as JSON under the
  // `flagConfig` key in the config sheet (code.gs saveConfig/getFlagConfig_)
  // and merged into SCORE_CONFIG.flags at page load by wxLoadFlagConfig()
  // below. The values here are the defaults used when no override is saved.
  //
  // There is intentionally no `label` field — the colored banner plus icon
  // already communicate the flag identity, so a textual "Green"/"Red" label
  // would be redundant (issue #376).
  // ─────────────────────────────────────────────────────────────────────────────
  flags: {
    green:  { color:'var(--green)', bg:'color-mix(in srgb, var(--green) 10%, transparent)', border:'color-mix(in srgb, var(--green) 27%, transparent)', icon:'🟢',
              advice:'Good conditions  —  open to all qualified members.',
              adviceIS:'Góðar aðstæður — opið öllum hæfum félögum.',
              description:'Conditions are suitable for sailing. All qualified members may use boats according to their credential level.',
              descriptionIS:'Aðstæður eru hæfar fyrir siglingar. Allir hæfir félagar mega taka báta út samkvæmt skírteinastigi.' },
    yellow: { color:'var(--yellow)', bg:'color-mix(in srgb, var(--yellow) 10%, transparent)', border:'color-mix(in srgb, var(--yellow) 27%, transparent)', icon:'🟡',
              advice:'Marginal  —  experienced sailors only.',
              adviceIS:'Jaðaraðstæður — aðeins reyndir siglingar.',
              description:'Conditions are marginal. Only experienced sailors with strong boat-handling skills should go out. Ensure someone ashore knows your plans and expected return time.',
              descriptionIS:'Aðstæður eru á mörkum. Aðeins reyndir siglingar áttu að fara út. Gerið ráð fyrir óvæntum breytingum og tryggist að einhver á landi viti af áætlunum ykkar.' },
    orange: { color:'var(--orange)', bg:'color-mix(in srgb, var(--orange) 10%, transparent)', border:'color-mix(in srgb, var(--orange) 27%, transparent)', icon:'🟠',
              advice:'Difficult  —  keelboats only; staff auth required for dinghies.',
              adviceIS:'Erfiðar aðstæður — kjólbátar einungis; starfsmaður ¾arfnast heimildar.' },
    red:    { color:'var(--red)', bg:'color-mix(in srgb, var(--red) 10%, transparent)', border:'color-mix(in srgb, var(--red) 27%, transparent)', icon:'🔴',
              advice:'No self-service sailing  —  staff must approve each checkout.',
              adviceIS:'Engin sjálfsafgreiðsla — starfsmaður verður að samþykkja hverja útskráningu.',
              description:'Hazardous conditions. No self-service sailing. Staff must personally assess and authorise every checkout. Experienced keelboat sailors only with direct staff supervision.',
              descriptionIS:'Hættuleg aðstæður. Engin sjálfsafgreiðsla. Starfsmaður verður að meta og samþykkja hverja útlágingu persónulega.' },
    black:  { color:'var(--muted)', bg:'color-mix(in srgb, var(--muted) 10%, transparent)', border:'color-mix(in srgb, var(--muted) 27%, transparent)', icon:'⚫️',
              advice:'Water closed  —  all sailing suspended.',
              adviceIS:'Sjór lokaður — allar siglingar stöðvaðar.',
              description:'The water is closed to all sailing. All boats must remain ashore or return to harbour immediately. Check back later for updated conditions.',
              descriptionIS:'Sjór er lokaður öllum siglingu. Allir bátar verða að vera á landi eða snara aftur til hafnar þegar á stað.' },
  },
};

function wxLoadFlagConfig(saved) {
  if (!saved) return;
  if (saved.thresholds)            Object.assign(SCORE_CONFIG.thresholds, saved.thresholds);
  if (saved.wind)                  if (saved.wind?.length) SCORE_CONFIG.wind = saved.wind;
  if (saved.waves)                 if (saved.waves?.length) SCORE_CONFIG.waves = saved.waves;
  if (saved.sst)                   if (saved.sst?.length) SCORE_CONFIG.sst = saved.sst;
  if (saved.feelsLike)             if (saved.feelsLike?.length) SCORE_CONFIG.feelsLike = saved.feelsLike;
  if (saved.visibility)            Object.assign(SCORE_CONFIG.visibility, saved.visibility);
  if (saved.easterlyDirs)          SCORE_CONFIG.easterlyDirs  = saved.easterlyDirs;
  if (saved.easterlyPts    != null) SCORE_CONFIG.easterlyPts      = saved.easterlyPts;
  if (saved.gustModifier1Pts != null) SCORE_CONFIG.gustModifier1Pts = saved.gustModifier1Pts;
  if (saved.gustModifier2Pts != null) SCORE_CONFIG.gustModifier2Pts = saved.gustModifier2Pts;
  if (saved.flags) {
    for (const key of ['green','yellow','orange','red','black']) {
      if (saved.flags[key]) Object.assign(SCORE_CONFIG.flags[key], saved.flags[key]);
    }
  }
}


// ── Unit helpers ───────────────────────────────────────────────────────────────────────────────
function wxMsToBft(ms) {
  const T = [0,0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7];
  for (let i = T.length - 1; i >= 0; i--) if (ms >= T[i]) return i;
  return 0;
}
function wxMsToKt(ms)   { return Math.round(ms * 1.944); }
function wxDirLabel(d)  { if (d == null) return ''; return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d/22.5)%16]; }
function wxDirArrow(d)  { if (d == null) return ''; return ['↓','↙','←','↖','↑','↗','→','↘'][Math.round(d/45)%8]; }
function wxBftDesc(b)   { const n = Math.max(0, Math.min(12, b|0)); return s('wx.bft'+n) || ''; }
function wxCondIcon(c)  {
  if (c === 0) return '☀️'; if (c === 1) return '🌤'; if (c === 2) return '⛅️'; if (c === 3) return '☁️';
  if ([45,48].includes(c)) return '🌫️'; if ([51,53,55,61,63,65,80,81,82].includes(c)) return '🌧️';
  if ([71,73,75,77,85,86].includes(c)) return '❄️'; if ([95,96,99].includes(c)) return '⛈️'; return '☁️';
}
function wxCondDesc(c)  {
  if (c === 0) return s('wx.condClearSky');
  if (c === 1) return s('wx.condMainlyClear');
  if (c === 2) return s('wx.condPartlyCloudy');
  if (c === 3) return s('wx.condOvercast');
  if ([45,48].includes(c)) return s('wx.condFog');
  if ([51,53,55].includes(c)) return s('wx.condDrizzle');
  if ([61,63,65,80,81,82].includes(c)) return s('wx.condRain');
  if ([71,73,75,77].includes(c)) return s('wx.condSnow');
  if ([95,96,99].includes(c)) return s('wx.condThunderstorm');
  return '';
}

/**
 * wxScoreFlag  —  points-based flag assessment.
 * @param {number} ws      wind speed m/s
 * @param {string} wDir    compass direction e.g. 'NE'
 * @param {number} waveH   wave height metres (null/0 if unknown)
 * @param {number} airT    feels-like air temp °C (null if unknown)
 * @param {number} sst     sea surface temp °C (null if unknown)
 * @param {number} wg      wind gusts m/s (null if unknown)
 * @param {string} visKey  'good'|'reduced'|'poor' (default 'good')
 * @returns {{ flagKey, flag, score, breakdown, reasons }}
 */
function wxScoreFlag(ws, wDir, waveH, airT, sst, wg, visKey) {
  const cfg = SCORE_CONFIG;
  const breakdown = [];
  let score = 0;

  const bft = wxMsToBft(ws || 0);
  const wBand = cfg.wind.find(b => bft <= b.maxBft) || cfg.wind[cfg.wind.length - 1];
  if (wBand.pts > 0) {
    score += wBand.pts;
    breakdown.push({ factor:'wind', pts:wBand.pts,
      label: s('wx.bdWind', { n: bft, desc: wxBftDesc(bft) }) });
  }

  const dir = (typeof wDir === 'number' ? wxDirLabel(wDir) : (wDir || '')).toUpperCase().trim();
  if (dir && cfg.easterlyDirs.includes(dir) && bft > 0) {
    score += cfg.easterlyPts;
    breakdown.push({ factor:'direction', pts:cfg.easterlyPts,
      label: s('wx.bdEasterly', { dir }) });
  }

  if (wg != null && ws != null && wxMsToBft(wg) > bft) {
    const _gustDiff = wxMsToBft(wg) - bft;
    const _gustPts  = _gustDiff >= 2 ? cfg.gustModifier2Pts : cfg.gustModifier1Pts;
    if (_gustPts > 0) {
      score += _gustPts;
      breakdown.push({ factor:'gusts', pts:_gustPts,
        label: s('wx.bdGusts', { n: wxMsToBft(wg), sust: bft }) });
    }
  }

  const wh = waveH || 0;
  if (wh > 0) {
    const wvBand = cfg.waves.find(b => wh <= b.maxM) || cfg.waves[cfg.waves.length - 1];
    if (wvBand.pts > 0) {
      score += wvBand.pts;
      breakdown.push({ factor:'waves', pts:wvBand.pts,
        label: s('wx.bdWaves', { h: wh.toFixed(1) }) });
    }
  }

  if (sst != null) {
    const sBand = cfg.sst.find(b => sst >= b.minC) || cfg.sst[cfg.sst.length - 1];
    if (sBand.pts > 0) {
      score += sBand.pts;
      breakdown.push({ factor:'sst', pts:sBand.pts,
        label: s('wx.bdSst', { t: sst.toFixed(1) }) });
    }
  }

  if (airT != null) {
    const fBand = cfg.feelsLike.find(b => airT >= b.minC) || cfg.feelsLike[cfg.feelsLike.length - 1];
    if (fBand && fBand.pts > 0) {
      score += fBand.pts;
      breakdown.push({ factor:'feelsLike', pts:fBand.pts,
        label: s('wx.bdFeelsLike', { t: Math.round(airT) }) });
    }
  }

  const vPts = cfg.visibility[visKey || 'good'] || 0;
  if (vPts > 0) {
    score += vPts;
    breakdown.push({ factor:'visibility', pts:vPts,
      label: s(visKey === 'poor' ? 'wx.poorVisibility' : 'wx.reducedVisibility') });
  }

  const t = cfg.thresholds;
  const flagKey = score >= t.black ? 'black' : score >= t.red ? 'red' : score >= t.orange ? 'orange' : score >= t.yellow ? 'yellow' : 'green';
  return { flagKey, flag: cfg.flags[flagKey], score, breakdown,
    reasons: breakdown.map(b => ({ f: flagKey, t: b.label })) };
}


// ── Staff status badge HTML ─────────────────────────────────────────────────────────────────────
function wxStaffStatusHtml(status) {
  if (!status) return '';
  const badges = [];
  if (status.onDuty)      badges.push('<span style="display:inline-flex;align-items:center;gap:5px;background:color-mix(in srgb, var(--blue) 10%, transparent);border:1px solid color-mix(in srgb, var(--blue) 27%, transparent);color:var(--blue);border-radius:20px;padding:3px 10px;font-size:11px">'+DUTY_ICONS.lifebuoy+s('wx.staffOnDuty')+'</span>');
  if (status.supportBoat) badges.push('<span style="display:inline-flex;align-items:center;gap:5px;background:color-mix(in srgb, var(--blue) 10%, transparent);border:1px solid color-mix(in srgb, var(--blue) 27%, transparent);color:var(--blue);border-radius:20px;padding:3px 10px;font-size:11px">'+DUTY_ICONS.ship+s('wx.supportBoatOut')+'</span>');
  if (!badges.length) return '';
  let ago = '';
  if (status.updatedAt) {
    const mins = Math.round((Date.now() - new Date(status.updatedAt)) / 60000);
    ago = mins < 2  ? s('wx.justNow')
        : mins < 60 ? s('wx.minAgo', { n: mins })
        :             s('wx.hrAgo', { n: Math.floor(mins/60) });
  }
  return '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">'
    + badges.join('') + (ago ? '<span style="font-size:10px;color:var(--muted)">'+ago+'</span>' : '') + '</div>';
}

// ── Flag score detail panel HTML ───────────────────────────────────────────────────────────────
function wxFlagDetailHtml(result, staffStatus, lang) {
  const IS = lang === 'IS';
  const flag   = result.flag;
  const advice = (IS && flag.adviceIS) ? flag.adviceIS : flag.advice;
  const t = SCORE_CONFIG.thresholds;
  const maxScore = t.black + 20;
  const pct = Math.min(100, Math.round(result.score / maxScore * 100));
  const markers = [
    { pct: Math.round(t.yellow/maxScore*100), key:'yellow' },
    { pct: Math.round(t.orange/maxScore*100), key:'orange' },
    { pct: Math.round(t.red   /maxScore*100), key:'red'    },
    { pct: Math.round(t.black /maxScore*100), key:'black'  },
  ];
  const markerHtml = markers.map(m =>
    '<div style="position:absolute;left:'+m.pct+'%;top:0;bottom:0;width:1px;background:color-mix(in srgb, '+SCORE_CONFIG.flags[m.key].color+' 33%, transparent)"></div>'
  ).join('');
  const barHtml =
    '<div style="position:relative;height:10px;background:var(--border);border-radius:5px;margin:12px 0 4px;overflow:hidden">'
    + markerHtml
    + '<div style="height:100%;width:'+pct+'%;background:'+flag.color+';border-radius:5px"></div></div>'
    + '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-bottom:14px">'
    + '<span>0</span>'
    + markers.map(m => '<span style="color:'+SCORE_CONFIG.flags[m.key].color+'">'+t[m.key]+'</span>').join('')
    + '</div>';
  const rows = result.breakdown.length
    ? result.breakdown.map(b =>
        '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)44;font-size:12px">'
        + '<span style="color:var(--text)">'+b.label+'</span>'
        + '<span style="color:'+flag.color+';font-weight:500;min-width:36px;text-align:right">+'+b.pts+'</span></div>'
      ).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:6px 0">'+s('wx.noScoring')+'</div>';
  const totalRow =
    '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer" id="wxFlagPill" title="Tap for details">'
    + '<span>'+s('wx.totalScore')+'</span>'
    + '<span style="color:'+flag.color+'">'+result.score+'</span></div>';
  const desc = IS && flag.descriptionIS ? flag.descriptionIS : (flag.description || '');
  // Considerations: factors that contributed points
  // Staff status badges (shown if staffStatus passed)
  const _ssBadgesHtml = (() => {
    if (!staffStatus) return '';
    const bst   = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;border:1px solid;font-size:11px;font-weight:500;white-space:nowrap;margin-bottom:10px;';
    const dCol  = staffStatus.onDuty      ? 'var(--blue)' : 'var(--orange)';
    const bCol  = staffStatus.supportBoat ? 'var(--blue)' : 'var(--orange)';
    const dBg   = staffStatus.onDuty      ? 'color-mix(in srgb, var(--blue) 10%, transparent);border-color:color-mix(in srgb, var(--blue) 27%, transparent)' : 'color-mix(in srgb, var(--orange) 10%, transparent);border-color:color-mix(in srgb, var(--orange) 27%, transparent)';
    const bBg   = staffStatus.supportBoat ? 'color-mix(in srgb, var(--blue) 10%, transparent);border-color:color-mix(in srgb, var(--blue) 27%, transparent)' : 'color-mix(in srgb, var(--orange) 10%, transparent);border-color:color-mix(in srgb, var(--orange) 27%, transparent)';
    const dTx   = s(staffStatus.onDuty      ? 'wx.staffOnDuty'    : 'wx.noStaffOnDuty');
    const bTx   = s(staffStatus.supportBoat ? 'wx.supportBoatOut' : 'wx.noSupportBoat');
    return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">'
      + '<span style="'+bst+'background:'+dBg+';color:'+dCol+'">'+DUTY_ICONS[staffStatus.onDuty ? 'lifebuoy' : 'lifebuoyOff']+dTx+'</span>'
      + '<span style="'+bst+'background:'+bBg+';color:'+bCol+'">'+DUTY_ICONS[staffStatus.supportBoat ? 'ship' : 'shipOff']+bTx+'</span>'
      + '</div>';
  })();
  const considerations = result.breakdown.filter(b => b.pts > 0);
  const chipsHtml = considerations.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">'
      + considerations.map(b =>
          '<span style="font-size:11px;padding:3px 10px;border-radius:20px;border:1px solid '
          + flag.border+';color:'+flag.color+';background:'+flag.bg+'">'
          + b.label
          + ' <b>+'+b.pts+'</b></span>'
        ).join('')
      + '</div>'
    : '';
  return _ssBadgesHtml + '<div style="background:'+flag.bg+';border:1px solid '+flag.border+';border-radius:8px;padding:12px 14px;margin-bottom:14px">'
    + '<div style="font-size:28px;margin-bottom:6px">'+flag.icon+'</div>'
    + '<div style="font-size:13px;color:'+flag.color+';font-weight:500;margin-bottom:6px">'+advice+'</div>'
    + (desc ? '<div style="font-size:12px;color:var(--text);line-height:1.55;border-top:1px solid '+flag.border+';padding-top:10px;margin-top:4px">'+desc+'</div>' : '')
    + '</div>'
    + chipsHtml
    + barHtml
    + '<div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">'+s('wx.scoreBreakdown')+'</div>'
    + rows + totalRow;
}



function wxPressureTrend(pressureArr, nowIdx) {
  if (!pressureArr || pressureArr.length < 4) return { trend: 'steady', diff: 0 };
  const past = pressureArr[Math.max(0, nowIdx - 3)];
  const now  = pressureArr[nowIdx];
  const diff = now - past;
  return { trend: diff > 1 ? 'rising' : diff < -1 ? 'falling' : 'steady', diff: Math.round(diff * 10) / 10 };
}
function wxPressureTrendIcon(trend)  { return { rising:'↑', falling:'↓', steady:'→' }[trend] || '→'; }
function wxPressureTrendColor(trend) { return { rising:'var(--green)', falling:'var(--orange)', steady:'var(--muted)' }[trend] || 'var(--muted)'; }

// ── Direction string → degrees (for wxDirArrow / wxDirLabel compatibility) ────
// apis.is returns direction as a compass string e.g. "NNE", "S", "Calm"
const _DIR_TO_DEG = {
  N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5,
  S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5,
};
function wxDirStrToDeg(s) {
  if (!s || s === 'Calm' ) return null;
  return _DIR_TO_DEG[s.toUpperCase()] ?? null;
}

// ── API fetch ─────────────────────────────────────────────────────────────────
// Wind/temp/pressure: BIRK (Reykjavík airport) proxied via Apps Script backend
//                     (apis.is blocks direct browser fetches due to CORS)
// Waves/SST:          Open-Meteo marine API
// Hourly chart data:  Open-Meteo atmosphere API (wind history/forecast for chart)

async function wxFetch(lat, lon, { fresh = false, useBirk = true } = {}) {
  const WX_CACHE_TTL = 300000; // 5min cache — aligns with 10min auto-refresh interval

  function _wxCacheGet(key) {
    if (fresh) return null;
    try {
      const c = sessionStorage.getItem(key);
      if (c) { const o = JSON.parse(c); if (Date.now() - o.ts < WX_CACHE_TTL) return o.data; }
    } catch(e) {}
    return null;
  }
  function _wxCacheSet(key, data) {
    try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch(e) {}
  }

  // ── 1. BIRK current observations  —  via backend proxy (skipped for non-club locations) ──
  const birkPromise = useBirk
    ? apiGet('getWeather', fresh ? { _fresh: true } : {})
    : Promise.resolve(null);

  // ── 2. Open-Meteo hourly + current  —  chart data + fills nulls left by BIRK ──────────
  const hourlyParams = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure';
  const currentParams = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,apparent_temperature,surface_pressure,weather_code';
  const hourlyUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourlyParams}&current=${currentParams}&forecast_hours=9&past_hours=3&timezone=auto&wind_speed_unit=ms`;
  const hourlyCacheKey = `ymir_wx_hourly_${lat}_${lon}`;
  const hourlyPromise = (() => {
    const cached = _wxCacheGet(hourlyCacheKey);
    if (cached) return Promise.resolve(cached);
    return fetch(hourlyUrl).then(r => r.ok ? r.json() : null).then(d => { if (d) _wxCacheSet(hourlyCacheKey, d); return d; }).catch(() => null);
  })();

  // ── 3. Marine API (waves / SST)  —  unchanged ──────────────────────────────
  const marineParams  = 'wave_height,wave_direction,wave_period,sea_surface_temperature';
  const marineUrl    = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=${marineParams}&hourly=${marineParams}&past_hours=3&forecast_hours=9&timezone=auto`;
  const marineCacheKey = `ymir_wx_marine_${lat}_${lon}`;
  const marinePromise = (() => {
    const cached = _wxCacheGet(marineCacheKey);
    if (cached) return Promise.resolve(cached);
    return fetch(marineUrl)
      .then(r => {
        if (!r.ok) {
          const fb = WX_MARINE_FALLBACK;
          return fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${fb.lat}&longitude=${fb.lon}&current=${marineParams}&hourly=${marineParams}&past_hours=3&forecast_hours=9&timezone=auto`)
            .then(r2 => r2.ok ? r2.json() : null);
        }
        return r.json();
      })
      .then(d => { if (d) _wxCacheSet(marineCacheKey, d); return d; })
      .catch(() => null);
  })();

  const [birkRes, hourlyData, marine] = await Promise.all([
    birkPromise, hourlyPromise, marinePromise,
  ]);

  // ── Map BIRK METAR into the wx.current shape the rest of the code expects
  // aviationweather.gov JSON fields:
  //   wdir (degrees), wspd (knots), wgst (knots or null), temp (°C),
  //   slp (hPa sea-level pressure), altim (inches Hg  —  NOT used)
  const obs   = birkRes?.obs ?? {};
  const wdDeg = (obs.wdir != null && obs.wdir !== 'VRB') ? Number(obs.wdir) : null;
  const ws    = obs.wspd  != null ? Number(obs.wspd)  * 0.514444 : 0;  // knots → m/s
  const wg    = obs.wgst != null  ? Number(obs.wgst) * 0.514444 : ws;  // knots → m/s, fallback to wspd
  const temp  = obs.temp  != null ? Number(obs.temp)  : null;           // already °C
  const pres  = obs.slp   != null ? Number(obs.slp)   : null;           // hPa sea-level

  const atmCurEarly = hourlyData?.current;
  const wx = {
    current: useBirk ? {
      wind_speed_10m:      ws,
      wind_direction_10m:  wdDeg,
      wind_gusts_10m:      wg,
      temperature_2m:      temp,
      apparent_temperature: temp,   // BIRK doesn't supply feels-like; use actual temp
      weather_code:        null,    // no weather code from BIRK
      surface_pressure:    pres,
      _source: 'BIRK',
      _obs_time: obs.reportTime || obs.obsTime || null,
    } : {
      wind_speed_10m:       atmCurEarly?.wind_speed_10m      ?? 0,
      wind_direction_10m:   atmCurEarly?.wind_direction_10m  ?? null,
      wind_gusts_10m:       atmCurEarly?.wind_gusts_10m      ?? 0,
      temperature_2m:       atmCurEarly?.temperature_2m      ?? null,
      apparent_temperature: atmCurEarly?.apparent_temperature ?? null,
      weather_code:         atmCurEarly?.weather_code        ?? null,
      surface_pressure:     atmCurEarly?.surface_pressure    ?? null,
      _source: 'OpenMeteo',
      _obs_time: atmCurEarly?.time || null,
    },
    // Hourly data for chart  —  from Open-Meteo (or empty fallback)
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
function wxWidget(targetEl, { onData, showRefreshBtn = true, label, getStaffStatus } = {}) {
  const loc = { lat: WX_DEFAULT.lat, lon: WX_DEFAULT.lon, label: label || WX_DEFAULT.label };
  let timer = null;

  async function refresh({ fresh = false } = {}) {
    const IS = typeof getLang === 'function' && getLang() === 'IS';
    try {
      const { wx, marine } = await wxFetch(loc.lat, loc.lon, { fresh });
      const c    = wx.current;
      const mc   = marine?.current;
      const hr   = wx.hourly;
      const ws   = c.wind_speed_10m, wd = c.wind_direction_10m, wg = c.wind_gusts_10m;
      const bft  = wxMsToBft(ws), wDir = wxDirLabel(wd);
      const waveH = mc?.wave_height ?? null;
      const sst   = mc?.sea_surface_temperature ?? null;
      const pres  = c.surface_pressure;
      const { flagKey, flag, score, breakdown, reasons } = wxScoreFlag(ws, wDir, waveH ?? 0, c.temperature_2m, sst, wg, 'good');

      const nowISO = new Date().toISOString().slice(0,13);
      const nowIdx = Math.max(0, (hr.time||[]).findIndex(t => t.slice(0,13) === nowISO));
      const { trend, diff } = wxPressureTrend(hr.surface_pressure, nowIdx);

      if (onData) onData({ ws, wd, wg, bft, waveH, wDir, sst, airT: c.temperature_2m,
        apparentT: c.apparent_temperature, code: c.weather_code, flagKey, score, breakdown,
        pres, presTrend: trend,
        flagResult: { flagKey, flag, score, breakdown },
      });

      const updTime = fmtTimeNow();
      targetEl.className = `wx-widget flag-${flagKey}`;
      targetEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:9px;color:var(--muted);letter-spacing:1.2px">${s('wx.birkConditions')}${c._obs_time ? ' · ' + c._obs_time.slice(11,16) + ' UTC' : ''}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            ${showRefreshBtn ? `<button onclick="this.closest('.wx-widget')._wxRefresh({fresh:true})" title="Refresh" style="background:none;border:1px solid var(--border);color:var(--muted);padding:2px 6px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit">↻ ${updTime}</button>` : `<span style="font-size:10px;color:var(--muted)">↻ ${updTime}</span>`}
            <a href="../weather/" style="font-size:11px;font-weight:600;color:var(--brass-fg);text-decoration:none;white-space:nowrap;border:1px solid var(--brass);border-radius:6px;padding:4px 10px;background:var(--brass)12">${s('wx.openForecast')}</a>
          </div>
        </div>
        <!-- 2-row grid, columns locked -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
          <div class="wx-cell">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:6px">${s('wx.wind')}</div>
            <div style="display:flex;align-items:center;gap:3px;line-height:1">
              <span style="font-size:32px;color:var(--brass-fg);font-weight:500;line-height:1">${wxDirArrow(wd)}</span>
              <span style="font-size:32px;color:var(--brass-fg);font-weight:500;line-height:1">${Math.round(ws)}</span>
              <span style="font-size:12px;color:var(--muted);margin-left:2px">m/s</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:5px">
              <b style="color:var(--navy-l)">${wDir}</b> · <b style="color:var(--navy-l)">${wxMsToKt(ws)}</b> kt · ${s('wx.force')} <b style="color:var(--navy-l)">${bft}</b>
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:3px">
              ${s('wx.gusts')} <b style="color:var(--navy-l)">${Math.round(wg)} m/s</b> · <b style="color:var(--navy-l)">${wxMsToKt(wg)}</b> kt · ${wxBftDesc(bft)}
            </div>
          </div>
          <div class="wx-cell">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:6px">${s('wx.airTemp')}</div>
            <div style="font-size:28px;font-weight:500;color:var(--brass-fg);line-height:1">${c.temperature_2m != null ? Math.round(c.temperature_2m)+'°' : ''}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:5px">${c.apparent_temperature != null && c.apparent_temperature !== c.temperature_2m ? s('wx.feelsLike', { t: Math.round(c.apparent_temperature) }) : ''}</div>
          </div>
          <div class="wx-cell">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:6px">${s('wx.conditions')}</div>
            <div style="font-size:36px;line-height:1">${c.weather_code != null ? wxCondIcon(c.weather_code) : '⛅️'}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:5px">${c.weather_code != null ? wxCondDesc(c.weather_code) : s('wx.birkObs')}</div>
          </div>
          <div class="wx-cell" style="border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">${s('wx.waves')}</div>
            <div style="font-size:17px;color:var(--navy-l)">${waveH != null ? waveH.toFixed(1)+'m' : ''}</div>
            <div style="font-size:10px;color:var(--muted)">${mc?.wave_direction != null ? wxDirArrow(mc.wave_direction)+' '+wxDirLabel(mc.wave_direction) : ''}</div>
          </div>
          <div class="wx-cell" style="border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">${s('wx.sea')}</div>
            <div style="font-size:17px;color:var(--navy-l)">${sst != null ? sst.toFixed(1)+'°C' : ''}</div>
            <div style="font-size:10px;color:var(--muted)">${s('wx.surface')}</div>
          </div>
          <div class="wx-cell" style="border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">${s('wx.pressure')}</div>
            <div style="font-size:17px;color:var(--navy-l)">${pres != null ? Math.round(pres) : ''}</div>
            <div style="font-size:10px;color:${wxPressureTrendColor(trend)}">${wxPressureTrendIcon(trend)} ${s('wx.pressure' + trend[0].toUpperCase() + trend.slice(1))}</div>
          </div>
        </div>
        <!-- footer: flag pill + status badges -->
        <div style="display:flex;align-items:center;gap:6px;margin-top:14px;border-top:1px solid var(--border);padding-top:14px;flex-wrap:wrap">
          <span class="flag-pill" style="color:${flag.color};border-color:${flag.border};background:${flag.bg};display:inline-flex;align-items:center;gap:6px;border-radius:20px;border:1px solid;padding:4px 10px;font-size:11px;font-weight:500;cursor:pointer" id="wxFlagPill">
            ${flag.icon} ${IS&&flag.adviceIS?flag.adviceIS:flag.advice}
          </span>
          <div class="wx-status-badges" style="display:flex;flex-wrap:wrap;gap:5px"></div>
        </div>`;
      targetEl._wxRefresh = refresh;
      targetEl._wxResult  = { flagKey, flag, score, breakdown, reasons, snap: { ws, wDir, waveH, temperature_2m: c.temperature_2m, sst, wg } };
      // ── Inject modal HTML once per page ──
      if (!document.getElementById('wxFlagModal')) {
        const _md = document.createElement('div');
        _md.innerHTML = '<div class="modal-overlay hidden" id="wxFlagModal" onclick="if(event.target===this)this.classList.add(\'hidden\')">'
          + '<div class="modal" style="max-width:480px">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
          + '<div id="wxFlagModalTitle" style="font-weight:600;font-size:15px"></div>'
          + '<button onclick="document.getElementById(\'wxFlagModal\').classList.add(\'hidden\')" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);padding:0 4px">×</button>'
          + '</div><div id="wxFlagModalBody"></div>'
          + '<div style="margin-top:16px"><button class="btn btn-secondary" style="width:100%" onclick="document.getElementById(\'wxFlagModal\').classList.add(\'hidden\')">'
          + s('btn.close')
          + '</button></div></div></div>';
        document.body.appendChild(_md.firstElementChild);
      }

      // ── Wire flag pill click  —  uses snap stored on this element ──
      const pill = targetEl.querySelector('#wxFlagPill') || targetEl.querySelector('.flag-pill');
      if (pill) pill.onclick = () => {
        const IS2 = typeof getLang === 'function' ? getLang() === 'IS' : false;
        const r   = targetEl._wxResult;  // exact result that drew this pill
        const ss  = typeof getStaffStatus === 'function' ? getStaffStatus() : null;
        const body  = document.getElementById('wxFlagModalBody');
        const title = document.getElementById('wxFlagModalTitle');
        if (!body || !r) return;
        if (title) title.textContent = r.flag.icon + ' · ' + r.score + ' ' + s('wx.pts');
        body.innerHTML = wxFlagDetailHtml(r, ss, IS2 ? 'IS' : 'EN');
        if (typeof openModal === 'function') openModal('wxFlagModal');
        else document.getElementById('wxFlagModal')?.classList.remove('hidden');
      };

      // ── Render duty status badges ──
      const _renderSsBadges = (container) => {
        if (!container) return;
        const _ss = typeof getStaffStatus === 'function' ? getStaffStatus() : null;
        if (!_ss) { container.innerHTML = ''; return; }
        const _bst = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;border:1px solid;font-size:11px;font-weight:500;white-space:nowrap;';
        const _dc  = _ss.onDuty      ? 'var(--blue)' : 'var(--orange)';
        const _bc  = _ss.supportBoat ? 'var(--blue)' : 'var(--orange)';
        const _dbg = _ss.onDuty      ? 'color-mix(in srgb, var(--blue) 10%, transparent);border-color:color-mix(in srgb, var(--blue) 27%, transparent)' : 'color-mix(in srgb, var(--orange) 10%, transparent);border-color:color-mix(in srgb, var(--orange) 27%, transparent)';
        const _bbg = _ss.supportBoat ? 'color-mix(in srgb, var(--blue) 10%, transparent);border-color:color-mix(in srgb, var(--blue) 27%, transparent)' : 'color-mix(in srgb, var(--orange) 10%, transparent);border-color:color-mix(in srgb, var(--orange) 27%, transparent)';
        const _dtx = s(_ss.onDuty      ? 'wx.staffOnDuty'    : 'wx.noStaffOnDuty');
        const _btx = s(_ss.supportBoat ? 'wx.supportBoatOut' : 'wx.noSupportBoat');
        container.innerHTML =
          '<span style="'+_bst+'background:'+_dbg+';color:'+_dc+'">'+DUTY_ICONS[_ss.onDuty ? 'lifebuoy' : 'lifebuoyOff']+_dtx+'</span>'
          + ' '
          + '<span style="'+_bst+'background:'+_bbg+';color:'+_bc+'">'+DUTY_ICONS[_ss.supportBoat ? 'ship' : 'shipOff']+_btx+'</span>';
      };
      _renderSsBadges(targetEl.querySelector('.wx-status-badges'));
      // Expose badge-only re-render so pages can call after toggling duty status
      targetEl._wxRefreshBadges = () => _renderSsBadges(targetEl.querySelector('.wx-status-badges'));
    } catch(e) {
      targetEl.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:6px 0">⚠️ Weather unavailable  —  <a href="../weather/" style="color:var(--brass-fg)">try full page →</a>${showRefreshBtn ? ` <button onclick="this.closest('.wx-widget')._wxRefresh()" style="margin-left:8px;background:none;border:1px solid var(--border);color:var(--muted);padding:2px 8px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit">↻</button>` : ''}</div>`;
      targetEl._wxRefresh = refresh;
    }
  }

  const WX_REFRESH_MS = 10 * 60 * 1000;
  return {
    refresh,
    start()  {
      targetEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px 0">'+s('wx.loadingWeather')+'</div>';
      refresh();
      timer = setInterval(refresh, WX_REFRESH_MS);
    },
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
    cond:     snap.code != null ? { icon: wxCondIcon(snap.code), desc: wxCondDesc(snap.code), code: snap.code } : null,
    flag:     snap.flagKey || '',
    ts:       new Date().toISOString().slice(0,16),
  };
}
