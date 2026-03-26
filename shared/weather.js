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
// ═══════════════════════════════════════════════════════════════════════════════
// SCORE_CONFIG — single source of truth for all flag/scoring logic.
// Admin-editable via admin → Flags tab. wxLoadFlagConfig() merges saved values.
// wxScoreFlag()  computes total score → flag + full breakdown.
// wxAssessFlag() is a backwards-compatible wrapper for legacy call sites.
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
  flags: {
    green:  { color:'#27ae60', bg:'#27ae6018', border:'#27ae6044', icon:'🟢',
              label:'Green',  labelIS:'Grænn',
              advice:'Good conditions — open to all qualified members.',
              adviceIS:'Góðar aðstæður — opið öllum hæfum félögum.',
              description:'Conditions are suitable for sailing. All qualified members may use boats according to their certification level.',
              descriptionIS:'Aðstæður eru hæfar fyrir siglingar. Allir hæfir félagar mega taka báta út samkvæmt skírteinastigi.' },
    yellow: { color:'#f1c40f', bg:'#f1c40f18', border:'#f1c40f44', icon:'🟡',
              label:'Yellow', labelIS:'Gulur',
              advice:'Marginal — experienced sailors only.',
              adviceIS:'Jaðaraðstæður — aðeins reyndir siglingar.',
              description:'Conditions are marginal. Only experienced sailors with strong boat-handling skills should go out. Ensure someone ashore knows your plans and expected return time.',
              descriptionIS:'Aðstæður eru á mörkum. Aðeins reyndir siglingar ættu að fara út. Gerið ráð fyrir óvæntum breytingum og tryggist að einhver á landi viti af þíðum ykkar.' },
    orange: { color:'#e67e22', bg:'#e67e2218', border:'#e67e2244', icon:'🟠',
              label:'Orange', labelIS:'Appelsínugulur',
              advice:'Difficult — keelboats only; staff auth required for dinghies.',
              adviceIS:'Erfiðar aðstæður — kjölbátar einungis; starfsmaður þarfnast á skrúббur.' },
    red:    { color:'#e74c3c', bg:'#e74c3c18', border:'#e74c3c44', icon:'🔴',
              label:'Red',    labelIS:'Rauður',
              advice:'No self-service sailing — staff must approve each checkout.',
              adviceIS:'Engin sjálfsafgreiðsla — starfsmaður verður að samþykkja hverja útskráningu.',
              description:'Hazardous conditions. No self-service sailing. Staff must personally assess and authorise every checkout. Experienced keelboat sailors only with direct staff supervision.',
              descriptionIS:'Hættuleg aðstæður. Engin sjálfsafgreiðsla. Starfsmaður verður að meta og samþykkja hverja útlægingu personuðlega.' },
    black:  { color:'#999',    bg:'#99999918', border:'#99999944', icon:'⛔',
              label:'Closed', labelIS:'Lokað',
              advice:'Water closed — all sailing suspended.',
              adviceIS:'Sjór lokaður — allar siglingar staðvaðar.',
              description:'The water is closed to all sailing. All boats must remain ashore or return to harbour immediately. Check back later for updated conditions.',
              descriptionIS:'Sjór er lokaður öllum siglingu. Allir bátar verða að vera á landi eða snara aftur til hafnar þegar í stað.' },
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
  if (saved.gustModifierPts != null) SCORE_CONFIG.gustModifierPts  = saved.gustModifierPts;
  if (saved.flags) {
    for (const key of ['green','yellow','orange','red','black']) {
      if (saved.flags[key]) Object.assign(SCORE_CONFIG.flags[key], saved.flags[key]);
    }
  }
}

// Backwards-compat shim
const FLAG_CONFIG = {
  get flags()        { return SCORE_CONFIG.flags; },
  get easterlyDirs() { return SCORE_CONFIG.easterlyDirs; },
  get wind()  { return { yellow: SCORE_CONFIG.thresholds.yellow, orange: SCORE_CONFIG.thresholds.orange, red: SCORE_CONFIG.thresholds.red }; },
  get wave()  { const w = SCORE_CONFIG.waves; return { yellow:(w[1]||{}).maxM||0.5, orange:(w[2]||{}).maxM||1.0, red:(w[3]||{}).maxM||1.5 }; },
};

// ── Unit helpers ───────────────────────────────────────────────────────────────────────────────
function wxMsToBft(ms) {
  const T = [0,0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7];
  for (let i = T.length - 1; i >= 0; i--) if (ms >= T[i]) return i;
  return 0;
}
function wxMsToKt(ms)   { return Math.round(ms * 1.944); }
function wxDirLabel(d)  { if (d == null) return '–'; return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d/22.5)%16]; }
function wxDirArrow(d)  { if (d == null) return ''; return ['↓','↙','←','↖','↑','↗','→','↘'][Math.round(d/45)%8]; }
function wxBftDesc(b)   { return ['Calm','Light air','Light breeze','Gentle breeze','Moderate breeze','Fresh breeze','Strong breeze','Near gale','Gale','Strong gale','Storm','Violent storm','Hurricane'][b] || ''; }
function wxBftDescIS(b)  { return ['Logn','Andvari','Kul','Gola','Stinningsgola','Kaldi','Stinningskaldi','Allhvass vindur','Hvassvirði','Stormur','Rok','Ofsaveður','Fárvirði'][b] || ''; }
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

/**
 * wxScoreFlag — points-based flag assessment.
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
      label:'Wind Force '+bft+' ('+wxBftDesc(bft)+')', labelIS:'Vindur Vindstig '+bft });
  }

  const dir = (typeof wDir === 'number' ? wxDirLabel(wDir) : (wDir || '')).toUpperCase().trim();
  if (dir && cfg.easterlyDirs.includes(dir) && bft > 0) {
    score += cfg.easterlyPts;
    breakdown.push({ factor:'direction', pts:cfg.easterlyPts,
      label:'Easterly wind ('+dir+')', labelIS:'Austurlæg vindátt ('+dir+')' });
  }

  if (wg != null && ws != null && wxMsToBft(wg) > bft) {
    const _gustDiff = wxMsToBft(wg) - bft;
    const _gustPts  = _gustDiff >= 2 ? cfg.gustModifier2Pts : cfg.gustModifier1Pts;
    if (_gustPts > 0) {
      score += _gustPts;
      breakdown.push({ factor:'gusts', pts:_gustPts,
        label:'Gusts Force '+wxMsToBft(wg)+' (sustained Force '+bft+')',
        labelIS:'Hviður Vindstig '+wxMsToBft(wg) });
    }
  }

  const wh = waveH || 0;
  if (wh > 0) {
    const wvBand = cfg.waves.find(b => wh <= b.maxM) || cfg.waves[cfg.waves.length - 1];
    if (wvBand.pts > 0) {
      score += wvBand.pts;
      breakdown.push({ factor:'waves', pts:wvBand.pts,
        label:'Waves '+wh.toFixed(1)+' m', labelIS:'Bylgjur '+wh.toFixed(1)+' m' });
    }
  }

  if (sst != null) {
    const sBand = cfg.sst.find(b => sst >= b.minC) || cfg.sst[cfg.sst.length - 1];
    if (sBand.pts > 0) {
      score += sBand.pts;
      breakdown.push({ factor:'sst', pts:sBand.pts,
        label:'Sea temp '+sst.toFixed(1)+'°C', labelIS:'Sjávarhiti '+sst.toFixed(1)+'°C' });
    }
  }

  if (airT != null) {
    const fBand = cfg.feelsLike.find(b => airT >= b.minC) || cfg.feelsLike[cfg.feelsLike.length - 1];
    if (fBand && fBand.pts > 0) {
      score += fBand.pts;
      breakdown.push({ factor:'feelsLike', pts:fBand.pts,
        label:'Feels like '+Math.round(airT)+'°C', labelIS:'Líður eins og '+Math.round(airT)+'°C' });
    }
  }

  const vPts = cfg.visibility[visKey || 'good'] || 0;
  if (vPts > 0) {
    score += vPts;
    breakdown.push({ factor:'visibility', pts:vPts,
      label: visKey === 'poor' ? 'Poor visibility' : 'Reduced visibility',
      labelIS: visKey === 'poor' ? 'Slæm sín' : 'Skert sín' });
  }

  const t = cfg.thresholds;
  const flagKey = score >= t.black ? 'black' : score >= t.red ? 'red' : score >= t.orange ? 'orange' : score >= t.yellow ? 'yellow' : 'green';
  return { flagKey, flag: cfg.flags[flagKey], score, breakdown,
    reasons: breakdown.map(b => ({ f: flagKey, t: b.label })) };
}

// Backwards-compat wrapper
function wxAssessFlag(ws, wDir, waveH) {
  return wxScoreFlag(ws, wDir, waveH, null, null, null, 'good');
}

// ── Staff status badge HTML ─────────────────────────────────────────────────────────────────────
function wxStaffStatusHtml(status, lang) {
  if (!status) return '';
  const IS = lang === 'IS';
  const badges = [];
  if (status.onDuty)      badges.push('<span style="display:inline-flex;align-items:center;gap:5px;background:#27ae6018;border:1px solid #27ae6044;color:#27ae60;border-radius:20px;padding:3px 10px;font-size:11px">🧑 '+(IS?'Starfsmaður á vakt':'Staff on duty')+'</span>');
  if (status.supportBoat) badges.push('<span style="display:inline-flex;align-items:center;gap:5px;background:#2980b918;border:1px solid #2980b944;color:#5dade2;border-radius:20px;padding:3px 10px;font-size:11px">⛵ '+(IS?'Björunarbátur á sjó':'Support boat out')+'</span>');
  if (!badges.length) return '';
  let ago = '';
  if (status.updatedAt) {
    const mins = Math.round((Date.now() - new Date(status.updatedAt)) / 60000);
    ago = mins < 2 ? (IS ? 'Rétt í ûessu' : 'just now')
        : mins < 60 ? (IS ? 'fyrir '+mins+' mín' : mins+' min ago')
        : (IS ? 'fyrir '+Math.floor(mins/60)+' klst' : Math.floor(mins/60)+'h ago');
  }
  return '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">'
    + badges.join('') + (ago ? '<span style="font-size:10px;color:var(--muted)">'+ago+'</span>' : '') + '</div>';
}

// ── Flag score detail panel HTML ───────────────────────────────────────────────────────────────
function wxFlagDetailHtml(result, staffStatus, lang) {
  const IS = lang === 'IS';
  const flag   = result.flag;
  const label  = (IS && flag.labelIS)  ? flag.labelIS  : flag.label;
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
    '<div style="position:absolute;left:'+m.pct+'%;top:0;bottom:0;width:1px;background:'+SCORE_CONFIG.flags[m.key].color+'55"></div>'
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
        + '<span style="color:var(--text)">'+(IS && b.labelIS ? b.labelIS : b.label)+'</span>'
        + '<span style="color:'+flag.color+';font-weight:500;min-width:36px;text-align:right">+'+b.pts+'</span></div>'
      ).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:6px 0">'+(IS?'Engin stigagjöf.':'No scoring factors.')+'</div>';
  const totalRow =
    '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;font-weight:500;cursor:pointer" id="wxFlagPill" title="Tap for details">'
    + '<span>'+(IS?'Heildarstig':'Total score')+'</span>'
    + '<span style="color:'+flag.color+'">'+result.score+'</span></div>';
  let staffHtml = '';
  if (staffStatus) {
    staffHtml =
      '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">'
      + '<div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:8px">'+(IS?'STAÐA STARFSMANNA':'STAFF STATUS')+'</div>'
      + '<div style="display:flex;gap:12px;flex-wrap:wrap">'
      + '<span style="font-size:12px;color:'+(staffStatus.onDuty?'#27ae60':'var(--muted)')+'">🧑 '+(IS?'Starfsmaður á vakt':'Staff on duty')+': <b>'+(staffStatus.onDuty?(IS?'Já':'Yes'):(IS?'Nei':'No'))+'</b></span>'
      + '<span style="font-size:12px;color:'+(staffStatus.supportBoat?'#5dade2':'var(--muted)')+'">⛵ '+(IS?'Björunarbátur':'Support boat')+': <b>'+(staffStatus.supportBoat?(IS?'Á sjó':'Out'):(IS?'Ekki á sjó':'Not out'))+'</b></span>'
      + '</div></div>';
  }
  const desc = IS && flag.descriptionIS ? flag.descriptionIS : (flag.description || '');
  // Considerations: factors that contributed points
  // Staff status badges (shown if staffStatus passed)
  const _ssBadgesHtml = (() => {
    if (!staffStatus) return '';
    const IS2   = lang === 'IS';
    const bst   = 'display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;border:1px solid;font-size:11px;font-weight:500;white-space:nowrap;margin-bottom:10px;';
    const dCol  = staffStatus.onDuty      ? '#27ae60' : '#e74c3c';
    const bCol  = staffStatus.supportBoat ? '#27ae60' : '#e74c3c';
    const dBg   = staffStatus.onDuty      ? '#27ae6015;border-color:#27ae6040' : '#e74c3c15;border-color:#e74c3c40';
    const bBg   = staffStatus.supportBoat ? '#27ae6015;border-color:#27ae6040' : '#e74c3c15;border-color:#e74c3c40';
    const dTx   = IS2 ? (staffStatus.onDuty      ? 'Starfsmaður á vakt' : 'Enginn starfsmaður')
                      : (staffStatus.onDuty      ? 'Staff on duty'                : 'No staff on duty');
    const bTx   = IS2 ? (staffStatus.supportBoat ? 'Björunarbátur'           : 'Enginn björunarbátur')
                      : (staffStatus.supportBoat ? 'Support boat out'            : 'No support boat');
    return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">'
      + '<span style="'+bst+'background:'+dBg+';color:'+dCol+'">🧑 '+dTx+'</span>'
      + '<span style="'+bst+'background:'+bBg+';color:'+bCol+'">⛵ '+bTx+'</span>'
      + '</div>';
  })();
  const considerations = result.breakdown.filter(b => b.pts > 0);
  const chipsHtml = considerations.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">'
      + considerations.map(b =>
          '<span style="font-size:11px;padding:3px 10px;border-radius:20px;border:1px solid '
          + flag.border+';color:'+flag.color+';background:'+flag.bg+'">'
          + (IS && b.labelIS ? b.labelIS : b.label)
          + ' <b>+'+b.pts+'</b></span>'
        ).join('')
      + '</div>'
    : '';
  return _ssBadgesHtml + '<div style="background:'+flag.bg+';border:1px solid '+flag.border+';border-radius:8px;padding:12px 14px;margin-bottom:14px">'
    + '<div style="font-size:18px;margin-bottom:6px">'+flag.icon+' <span style="color:'+flag.color+';font-weight:500">'+label+'</span></div>'
    + '<div style="font-size:12px;color:'+flag.color+';opacity:.85;margin-bottom:6px">'+advice+'</div>'
    + (desc ? '<div style="font-size:12px;color:var(--text);line-height:1.55;border-top:1px solid '+flag.border+';padding-top:10px;margin-top:4px">'+desc+'</div>' : '')
    + '</div>'
    + chipsHtml
    + barHtml
    + '<div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">'+(IS?'STIGAÚTREIKNINGUR':'SCORE BREAKDOWN')+'</div>'
    + rows + totalRow + staffHtml;
}


// ── Shared flag detail modal ─────────────────────────────────────────────────
// Each page calls wxInitFlagModal(getSnap, getStaffStatus) once on load.
// getSnap / getStaffStatus are zero-arg functions returning current values.
function wxInitFlagModal(getStaffStatus) {
  if (!document.getElementById('wxFlagModal')) {
    const div = document.createElement('div');
    div.innerHTML = "<!-- ══ FLAG DETAIL MODAL ══ -->\n<div class=\"modal-overlay hidden\" id=\"wxFlagModal\" onclick=\"if(event.target===this)closeModal('wxFlagModal')\">\n  <div class=\"modal\" style=\"max-width:480px\">\n    <div style=\"display:flex;align-items:center;justify-content:space-between;margin-bottom:14px\">\n      <h3 style=\"margin:0\" id=\"wxFlagModalTitle\"></h3>\n      <button class=\"btn-ghost\" onclick=\"closeModal('wxFlagModal')\" style=\"font-size:20px;padding:0 6px;line-height:1;border:none;color:var(--muted)\">×</button>\n    </div>\n    <div id=\"wxFlagModalBody\"></div>\n    <div class=\"btn-row\" style=\"margin-top:16px\">\n      <button class=\"btn btn-secondary\" onclick=\"closeModal('wxFlagModal')\" data-s=\"btn.close\"></button>\n    </div>\n  </div>\n</div>";
    document.body.appendChild(div.firstElementChild);
  }
  window._wxGetStaffStatus = typeof getStaffStatus === 'function' ? getStaffStatus : () => getStaffStatus;
  window.wxOpenFlagDetail = function() {
    const wxEl        = document.getElementById('wxWidget');
    const snap        = wxEl && wxEl._wxResult;
    const staffStatus = typeof window._wxGetStaffStatus === 'function' ? window._wxGetStaffStatus() : null;
    const IS          = typeof getLang === 'function' ? getLang() === 'IS' : false;
    const body        = document.getElementById('wxFlagModalBody');
    const title       = document.getElementById('wxFlagModalTitle');
    if (!body || !snap) return;
    const result = wxScoreFlag(snap.ws, snap.wDir, snap.waveH ?? 0,
      snap.temperature_2m, snap.sst, snap.wg, 'good');
    if (title) title.textContent = (IS && result.flag.labelIS ? result.flag.labelIS : result.flag.label)
      + ' · ' + result.score + ' stig';
    body.innerHTML = wxFlagDetailHtml(result, staffStatus, IS ? 'IS' : 'EN');
    if (typeof openModal === 'function') openModal('wxFlagModal');
    else document.getElementById('wxFlagModal')?.classList.remove('hidden');
  };
}

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
function wxWidget(targetEl, { onData, showRefreshBtn = true, label, getStaffStatus } = {}) {
  const loc = { lat: WX_DEFAULT.lat, lon: WX_DEFAULT.lon, label: label || WX_DEFAULT.label };
  let timer = null;

  async function refresh() {
    const IS = typeof getLang === 'function' && getLang() === 'IS';
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
      const { flagKey, flag, score, breakdown, reasons } = wxScoreFlag(ws, wDir, waveH ?? 0, c.temperature_2m, sst, wg, 'good');

      const nowISO = new Date().toISOString().slice(0,13);
      const nowIdx = Math.max(0, (hr.time||[]).findIndex(t => t.slice(0,13) === nowISO));
      const { trend, diff } = wxPressureTrend(hr.surface_pressure, nowIdx);

      if (onData) onData({ ws, wd, wg, bft, waveH, wDir, sst, airT: c.temperature_2m,
        apparentT: c.apparent_temperature, code: c.weather_code, flagKey, score, breakdown,
        pres, presTrend: trend,
        flagResult: { flagKey, flag, score, breakdown },
      });

      const updTime = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      targetEl.className = `wx-widget flag-${flagKey}`;
      targetEl.innerHTML = `
        <div style="font-size:9px;color:var(--muted);letter-spacing:1.2px;margin-bottom:8px">${IS?'BIRK · Aðstæður':'BIRK · CONDITIONS'}${c._obs_time ? ' · ' + c._obs_time.slice(11,16) + ' UTC' : ''}</div>
        <!-- 2-row grid, columns locked -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
          <div class="wx-cell">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:6px">${IS?'VINDUR':'WIND'}</div>
            <div style="display:flex;align-items:center;gap:3px;line-height:1">
              <span style="font-size:32px;color:var(--brass);font-weight:500;line-height:1">${wxDirArrow(wd)}</span>
              <span style="font-size:32px;color:var(--brass);font-weight:500;line-height:1">${Math.round(ws)}</span>
              <span style="font-size:12px;color:var(--muted);margin-left:2px">m/s</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:5px">
              <b style="color:var(--text)">${wDir}</b> · <b style="color:var(--text)">${wxMsToKt(ws)}</b> kt · ${IS?'Vindstig':'Force'} <b style="color:var(--text)">${bft}</b>
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:3px">
              ${IS?'Hviður':'Gusts'} <b style="color:var(--text)">${Math.round(wg)} m/s</b> · ${IS?wxBftDescIS(bft):wxBftDesc(bft)}
            </div>
          </div>
          <div class="wx-cell">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:6px">${IS?'LOFTHITI':'AIR TEMP'}</div>
            <div style="font-size:28px;font-weight:500;color:var(--text);line-height:1">${c.temperature_2m != null ? Math.round(c.temperature_2m)+'°' : '–'}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:5px">${c.apparent_temperature != null && c.apparent_temperature !== c.temperature_2m ? (IS?'líður eins og ':'feels ') + Math.round(c.apparent_temperature) + '°' : ''}</div>
          </div>
          <div class="wx-cell">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:6px">${IS?'AÐSTÆÐUR':'CONDITIONS'}</div>
            <div style="font-size:36px;line-height:1">${c.weather_code != null ? wxCondIcon(c.weather_code) : '🌬'}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:5px">${c.weather_code != null ? wxCondDesc(c.weather_code) : IS?'BIRK mælingar':'BIRK obs'}</div>
          </div>
          <div class="wx-cell" style="border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">${IS?'BYLGJUR':'WAVES'}</div>
            <div style="font-size:17px;color:#4a9eca">${waveH != null ? waveH.toFixed(1)+'m' : '–'}</div>
            <div style="font-size:10px;color:var(--muted)">${mc?.wave_direction != null ? wxDirArrow(mc.wave_direction)+' '+wxDirLabel(mc.wave_direction) : '–'}</div>
          </div>
          <div class="wx-cell" style="border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">${IS?'SJÓR':'SEA'}</div>
            <div style="font-size:17px;color:#4a9eca">${sst != null ? sst.toFixed(1)+'°C' : '–'}</div>
            <div style="font-size:10px;color:var(--muted)">${IS?'Yfirborð':'Surface'}</div>
          </div>
          <div class="wx-cell" style="border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">${IS?'LUÐÞÍNG':'PRESSURE'}</div>
            <div style="font-size:17px;color:var(--text)">${pres != null ? Math.round(pres) : '–'}</div>
            <div style="font-size:10px;color:${wxPressureTrendColor(trend)}">${wxPressureTrendIcon(trend)} ${IS?(trend==='rising'?'úrlag':(trend==='falling'?'ðfall':'stöðugt')):trend}</div>
          </div>
        </div>
        <!-- footer: flag · refresh · forecast -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;border-top:1px solid var(--border);padding-top:10px;gap:8px;flex-wrap:wrap">
          <span class="flag-pill" style="color:${flag.color};border-color:${flag.border};background:${flag.bg};display:inline-flex;align-items:center;gap:6px;border-radius:20px;border:1px solid;padding:4px 10px;font-size:11px;font-weight:500;cursor:pointer" id="wxFlagPill">
            ${flag.icon} ${flag.label} — ${IS&&flag.adviceIS?flag.adviceIS:flag.advice}
          </span>
          <div class="wx-status-badges" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px"></div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            ${showRefreshBtn ? `<button onclick="this.closest('.wx-widget')._wxRefresh()" title="Refresh" style="background:none;border:1px solid var(--border);color:var(--muted);padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;font-family:inherit">↻ ${updTime}</button>` : `<span style="font-size:10px;color:var(--muted)">↻ ${updTime}</span>`}
            <a href="../weather/" style="font-size:12px;font-weight:500;color:#fff;background:var(--brass);border-radius:6px;padding:4px 12px;text-decoration:none;white-space:nowrap">⛅ Full forecast →</a>
          </div>
        </div>`;
      targetEl._wxRefresh = refresh;
      targetEl._wxResult  = { flagKey, flag, score, breakdown, snap: { ws, wDir, waveH, temperature_2m: c.temperature_2m, sst, wg } };
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
          + (typeof getLang==='function'&&getLang()==='IS' ? 'Loka' : 'Close')
          + '</button></div></div></div>';
        document.body.appendChild(_md.firstElementChild);
      }

      // ── Wire flag pill click — uses snap stored on this element ──
      const pill = targetEl.querySelector('#wxFlagPill') || targetEl.querySelector('.flag-pill');
      if (pill) pill.onclick = () => {
        const IS     = typeof getLang === 'function' ? getLang() === 'IS' : false;
        const _wr    = targetEl._wxResult;
        const snap   = _wr?.snap;
        const ss     = typeof getStaffStatus === 'function' ? getStaffStatus() : null;
        const body   = document.getElementById('wxFlagModalBody');
        const title  = document.getElementById('wxFlagModalTitle');
        if (!body || !snap) return;
        const r = wxScoreFlag(snap.ws, snap.wDir, snap.waveH ?? 0, snap.temperature_2m, snap.sst, snap.wg, 'good');
        if (title) title.textContent = (IS && r.flag.labelIS ? r.flag.labelIS : r.flag.label) + ' · ' + r.score + ' stig';
        body.innerHTML = wxFlagDetailHtml(r, ss, IS ? 'IS' : 'EN');
        if (typeof openModal === 'function') openModal('wxFlagModal');
        else document.getElementById('wxFlagModal')?.classList.remove('hidden');
      };

      // ── Render duty status badges ──
      const _ssBadges = targetEl.querySelector('.wx-status-badges');
      if (_ssBadges) {
        const _ss  = typeof getStaffStatus === 'function' ? getStaffStatus() : null;
        const _isB = typeof getLang === 'function' && getLang() === 'IS';
        const _bst = 'display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;border:1px solid;font-size:10px;font-weight:500;white-space:nowrap;';
        if (_ss) {
          const _dc  = _ss.onDuty      ? '#27ae60' : '#e74c3c';
          const _bc  = _ss.supportBoat ? '#27ae60' : '#e74c3c';
          const _dbg = _ss.onDuty      ? '#27ae6015;border-color:#27ae6040' : '#e74c3c15;border-color:#e74c3c40';
          const _bbg = _ss.supportBoat ? '#27ae6015;border-color:#27ae6040' : '#e74c3c15;border-color:#e74c3c40';
          const _dtx = _isB ? (_ss.onDuty      ? 'Starfsmaður á vakt' : 'Enginn starfsmaður')
                            : (_ss.onDuty      ? 'Staff on duty'                 : 'No staff on duty');
          const _btx = _isB ? (_ss.supportBoat ? 'Björunarbátur'           : 'Enginn björunarbátur')
                            : (_ss.supportBoat ? 'Support boat out'             : 'No support boat');
          _ssBadges.innerHTML =
            '<span style="'+_bst+'background:'+_dbg+';color:'+_dc+'">🧑 '+_dtx+'</span>'
            + ' '
            + '<span style="'+_bst+'background:'+_bbg+';color:'+_bc+'">⛵ '+_btx+'</span>';
        } else {
          _ssBadges.innerHTML = '';
        }
      }
      // Expose badge-only re-render so pages can call after toggling duty status
      targetEl._wxRefreshBadges = () => {
        const _b = targetEl.querySelector('.wx-status-badges');
        if (!_b) return;
        const _ss2  = typeof getStaffStatus === 'function' ? getStaffStatus() : null;
        const _is2  = typeof getLang === 'function' && getLang() === 'IS';
        const _bst2 = 'display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;border:1px solid;font-size:10px;font-weight:500;white-space:nowrap;';
        if (_ss2) {
          const _dc2  = _ss2.onDuty      ? '#27ae60' : '#e74c3c';
          const _bc2  = _ss2.supportBoat ? '#27ae60' : '#e74c3c';
          const _dbg2 = _ss2.onDuty      ? '#27ae6015;border-color:#27ae6040' : '#e74c3c15;border-color:#e74c3c40';
          const _bbg2 = _ss2.supportBoat ? '#27ae6015;border-color:#27ae6040' : '#e74c3c15;border-color:#e74c3c40';
          const _is2B = typeof getLang === 'function' && getLang() === 'IS';
          const _dtx2 = _is2B ? (_ss2.onDuty      ? 'Starfsmaður á vakt' : 'Enginn starfsmaður')
                              : (_ss2.onDuty      ? 'Staff on duty'                 : 'No staff on duty');
          const _btx2 = _is2B ? (_ss2.supportBoat ? 'Björunarbátur'           : 'Enginn björunarbátur')
                              : (_ss2.supportBoat ? 'Support boat out'             : 'No support boat');
          _b.innerHTML =
            '<span style="'+_bst2+'background:'+_dbg2+';color:'+_dc2+'">🧑 '+_dtx2+'</span>'
            + ' '
            + '<span style="'+_bst2+'background:'+_bbg2+';color:'+_bc2+'">⛵ '+_btx2+'</span>';
        } else { _b.innerHTML = ''; }
      };
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
