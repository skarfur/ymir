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
  ship:        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M2 20a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1"/><path d="M4 18l-1 -5h18l-2 4"/><path d="M5 13v-6h8l4 6"/><path d="M7 7v-4h2"/></svg>',
  shipOff:     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M3 3l18 18"/><path d="M2 20a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1"/><path d="M4 18l-1 -5h13m4 0h1l-2 4"/><path d="M5 13v-6h2m4 0h2l4 6"/><path d="M7 7v-4h2"/></svg>',
  lifebuoy:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M15 15l3.35 3.35"/><path d="M9 15l-3.35 3.35"/><path d="M5.65 5.65l3.35 3.35"/><path d="M18.35 5.65l-3.35 3.35"/></svg>',
  lifebuoyOff: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M3 3l18 18"/><path d="M9.171 5.176a9 9 0 0 1 11.65 11.654m-1.341 2.66a9 9 0 0 1 -12.98 -12.98"/><path d="M10.586 10.589a2 2 0 0 0 2.836 2.823"/><path d="M15 15l3.35 3.35"/><path d="M9 15l-3.35 3.35"/><path d="M5.65 5.65l3.35 3.35"/><path d="M14.95 9.05l3.4 -3.4"/></svg>',
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCORE_CONFIG  —  single source of truth for all flag/scoring logic.
// Admin-editable via admin → Flags tab. wxLoadFlagConfig() merges saved values
// over these defaults; "Reset to defaults" in the admin tab reloads them.
// wxScoreFlag()  computes total score → flag + full breakdown.
//
// Four flags: green / yellow / red / black. Calibrated so 20 points ≈ one flag
// step and sustained wind alone decides the flag at each force (F5 yellow,
// F6–F7 red, F8+ black); other factors push a borderline case up a step.
// `orange` is no longer scored — it stays in `flags` only so trips and
// snapshots recorded before the switch still render an icon.
// ═══════════════════════════════════════════════════════════════════════════════
const FLAG_KEYS = ['green', 'yellow', 'red', 'black'];
// Legacy orange sorts with red: it was a "restricted, staff decide" level.
const _FLAG_RANK = { green: 0, yellow: 1, orange: 2, red: 2, black: 3 };
function wxFlagRank(key) { return _FLAG_RANK[key] != null ? _FLAG_RANK[key] : 0; }
// Normalises any stored flag key onto the four live flags.
function wxNormFlagKey(key) { return key === 'orange' ? 'red' : (FLAG_KEYS.includes(key) ? key : ''); }

const SCORE_CONFIG = {
  // Score at or above which each flag applies.
  thresholds: { yellow: 20, red: 40, black: 80 },
  // Points below a threshold the score must fall before the current flag is
  // lowered again (stops the flag flickering at a boundary between refreshes).
  hysteresis: 5,
  wind: [
    { maxBft: 3,  pts: 0 },  { maxBft: 4, pts: 8 },  { maxBft: 5, pts: 20 },
    { maxBft: 6,  pts: 40 }, { maxBft: 7, pts: 60 }, { maxBft: 12, pts: 80 },
  ],
  // Added when wind is from a listed (offshore) direction at Force ≥ minBft.
  windDirModifier: { dirs: ['NNE', 'NE', 'ENE', 'E', 'ESE', 'SE'], pts: 6, minBft: 3 },
  gustModifier1Pts: 0,                     // gusts exactly 1 Force level above sustained (normal)
  gustModifier2Pts: 10,                    // gusts 2+ Force levels above sustained (squally)
  waves: [
    { maxM: 0.5, pts: 0 }, { maxM: 1, pts: 3 },  { maxM: 1.5, pts: 6 },
    { maxM: 2,   pts: 10 }, { maxM: 3, pts: 16 }, { maxM: 99,  pts: 26 },
  ],
  sst: [
    { minC: 12, pts: 0 }, { minC: 10, pts: 2 }, { minC: 8, pts: 4 },
    { minC: 5,  pts: 7 }, { minC: 2,  pts: 10 }, { minC: -99, pts: 12 },
  ],
  // Scored on apparent ("feels like") temperature.
  feelsLike: [
    { minC: 5, pts: 0 }, { minC: 0, pts: 3 }, { minC: -5, pts: 6 }, { minC: -99, pts: 10 },
  ],
  visibility: { good: 0, reduced: 8, poor: 30 },
  // ─────────────────────────────────────────────────────────────────────────────
  // flags:
  //   color / bg / border / icon  — visual constants (NOT admin-editable).
  //   advice / adviceIS            — short one-line guidance shown next to icon.
  //   description / descriptionIS  — longer guidance shown in the detail modal.
  //
  // Advice and description (both EN + IS) are ADMIN-EDITABLE via
  // admin/index.html → Flags tab and persisted under the `flagConfig` key in
  // app_config. The values here are the defaults used when nothing is saved.
  //
  // There is intentionally no `label` field — the colored banner plus icon
  // already communicate the flag identity (issue #376).
  // ─────────────────────────────────────────────────────────────────────────────
  flags: {
    green:  { color:'var(--green)', bg:'color-mix(in srgb, var(--green) 10%, transparent)', border:'color-mix(in srgb, var(--green) 27%, transparent)', icon:'🟢',
              advice:'Good conditions – open to all qualified members.',
              adviceIS:'Góðar aðstæður – opið öllum félögum með tilskilin réttindi.',
              description:'Conditions are suitable for all boats and experience levels, according to your certification. Check the guidance for your boat below.',
              descriptionIS:'Aðstæður henta öllum bátum og reynslustigum, samkvæmt réttindum hvers og eins. Kynntu þér leiðbeiningar fyrir þinn bát hér að neðan.' },
    yellow: { color:'var(--yellow)', bg:'color-mix(in srgb, var(--yellow) 10%, transparent)', border:'color-mix(in srgb, var(--yellow) 27%, transparent)', icon:'🟡',
              advice:'Marginal conditions – experienced sailors, or sheltered area with safety cover.',
              adviceIS:'Jaðaraðstæður – aðeins reyndir siglarar, eða innan Fossvogs með öryggisgæslu.',
              description:'Conditions are marginal. Only experienced sailors with strong boat-handling skills should go out. Others may sail within Fossvogur if staff and a support boat are on duty. Check the guidance for your boat below.',
              descriptionIS:'Aðstæður eru á mörkunum. Aðeins reyndir siglarar ættu að fara á sjó. Aðrir geta siglt innan Fossvogs ef starfsfólk og gæslubátur eru á vakt. Kynntu þér leiðbeiningar fyrir þinn bát hér að neðan.' },
    // Legacy only — not produced by scoring any more (see header).
    orange: { color:'var(--orange)', bg:'color-mix(in srgb, var(--orange) 10%, transparent)', border:'color-mix(in srgb, var(--orange) 27%, transparent)', icon:'🟠',
              advice:'Difficult conditions (legacy flag).',
              adviceIS:'Erfiðar aðstæður (eldra flagg).' },
    red:    { color:'var(--red)', bg:'color-mix(in srgb, var(--red) 10%, transparent)', border:'color-mix(in srgb, var(--red) 27%, transparent)', icon:'🔴',
              advice:'Hazardous conditions – staff or captain approval required for every checkout.',
              adviceIS:'Hættulegar aðstæður – starfsmaður eða skipstjóri þarf að samþykkja hverja útskráningu.',
              description:'Rescue with club equipment may be difficult or impossible. Only suitable boats may go out, with safety cover on the water, and a staff member or captain must assess and approve every checkout.',
              descriptionIS:'Björgun með búnaði klúbbsins getur verið erfið eða ómöguleg. Aðeins hentugir bátar mega fara á sjó, með öryggisgæslu á sjónum, og starfsmaður eða skipstjóri þarf að meta aðstæður og samþykkja hverja útskráningu.' },
    black:  { color:'var(--muted)', bg:'color-mix(in srgb, var(--muted) 10%, transparent)', border:'color-mix(in srgb, var(--muted) 27%, transparent)', icon:'⚫️',
              advice:'Water closed – all sailing suspended.',
              adviceIS:'Siglingasvæðið lokað – allar siglingar stöðvaðar.',
              description:'The water is closed to all sailing. All boats must remain ashore or return to harbour immediately. Check back later for updated conditions.',
              descriptionIS:'Siglingasvæðið er lokað. Allir bátar skulu vera á landi eða snúa tafarlaust aftur til hafnar. Fylgstu með uppfærðum aðstæðum.' },
  },
};

// Pristine copy taken before any saved config is merged in — what the admin
// "Reset to defaults" button restores.
const SCORE_CONFIG_DEFAULTS = _wxClone(SCORE_CONFIG);

// ═══════════════════════════════════════════════════════════════════════════════
// FLAG GUIDANCE  —  what each flag means for each boat class and activity.
//
//   profiles[key][flagKey] = { s, en, is }
//     key       — a boat category key (dinghy, keelboat, …) or a custom
//                 profile (e.g. optimist) that individual boats point at
//     s         — 'ok' | 'cond' (open with conditions) | 'approval' (staff or
//                 captain must approve each checkout) | 'no' (not allowed)
//   boatProfiles[boatId] = profile key — overrides the boat's category
//   activities[activityTemplateId][flagKey] = { s, en, is }
//     s         — 'go' | 'adjust' | 'cancel'
//
// Enforced server-side by save_checkout (see
// supabase/migrations/20260929100000_flag_guidance.sql), which reads the same
// structure from app_config.flagConfig.guidance. These defaults are what the
// migration seeds and what the admin "Reset to defaults" restores; boat and
// activity mappings reference real ids so they only live in saved config.
// ═══════════════════════════════════════════════════════════════════════════════
const FLAG_GUIDANCE_DEFAULTS = {
  profiles: {
    keelboat: {
      green:  { s: 'ok' },
      yellow: { s: 'ok', en: 'Reef early.', is: 'Rifið snemma.' },
      red:    { s: 'approval', en: 'Experienced skipper, at least 2 crew, reefed.', is: 'Reyndur skipstjóri, a.m.k. 2 í áhöfn, rifað.' },
      black:  { s: 'no' },
    },
    dinghy: {
      green:  { s: 'ok', en: 'According to your certification.', is: 'Samkvæmt réttindum.' },
      yellow: { s: 'cond', en: 'Experienced sailors only. Beginners only inside Fossvogur with staff and a support boat on duty.', is: 'Aðeins reyndir siglarar. Byrjendur aðeins innan Fossvogs þegar starfsfólk og gæslubátur eru á vakt.' },
      red:    { s: 'approval', en: 'Experienced sailors only, support boat on the water.', is: 'Aðeins reyndir siglarar, gæslubátur á sjó.' },
      black:  { s: 'no' },
    },
    optimist: {
      labelEN: 'Optimist', labelIS: 'Optimist',
      green:  { s: 'cond', en: 'Supervised sessions only.', is: 'Aðeins undir eftirliti.' },
      yellow: { s: 'cond', en: 'Coached sessions with a support boat, sheltered area only.', is: 'Aðeins á æfingum með þjálfara og gæslubát, í skjóli.' },
      red:    { s: 'no' },
      black:  { s: 'no' },
    },
    wingfoil: {
      green:  { s: 'ok' },
      yellow: { s: 'ok' },
      red:    { s: 'approval', en: 'Experienced riders only, support boat on the water, not in offshore wind.', is: 'Aðeins reyndir, gæslubátur á sjó, ekki í aflandsvindi.' },
      black:  { s: 'no' },
    },
    kayak: {
      green:  { s: 'ok' },
      yellow: { s: 'cond', en: 'Experienced paddlers only. Stay inside Fossvogur, not in easterly (offshore) wind.', is: 'Aðeins reyndir ræðarar. Haldið ykkur innan Fossvogs, ekki í austlægri (aflands) átt.' },
      red:    { s: 'no' },
      black:  { s: 'no' },
    },
    rowboat: {
      green:  { s: 'ok' },
      yellow: { s: 'cond', en: 'Inside Fossvogur only.', is: 'Aðeins innan Fossvogs.' },
      red:    { s: 'no' },
      black:  { s: 'no' },
    },
    'rowing-shell': {
      green:  { s: 'cond', en: 'Flat water only.', is: 'Aðeins á sléttum sjó.' },
      yellow: { s: 'no' },
      red:    { s: 'no' },
      black:  { s: 'no' },
    },
    sup: {
      green:  { s: 'cond', en: 'Leash and buoyancy aid; not in offshore wind.', is: 'Ól og flotvesti; ekki í aflandsvindi.' },
      yellow: { s: 'no', en: 'Coached sessions only.', is: 'Aðeins á skipulögðum æfingum.' },
      red:    { s: 'no' },
      black:  { s: 'no' },
    },
    'support-boat': {
      green:  { s: 'ok' },
      yellow: { s: 'ok' },
      red:    { s: 'ok' },
      black:  { s: 'approval', en: 'Rescue or recovery only.', is: 'Aðeins til björgunar eða að sækja báta.' },
    },
  },
  boatProfiles: {},
  activities: {},
};
function _wxEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _wxClone(o) { return JSON.parse(JSON.stringify(o)); }
let FLAG_GUIDANCE = _wxClone(FLAG_GUIDANCE_DEFAULTS);

const GUIDANCE_BOAT_STATUSES = ['ok', 'cond', 'approval', 'no'];
const GUIDANCE_ACT_STATUSES  = ['go', 'adjust', 'cancel'];

// Bands are matched with .find(), so they must be in scan order: wind/waves
// ascending by their max, sst/feelsLike descending by their min.
function wxSortBands(cfg) {
  if (Array.isArray(cfg.wind))      cfg.wind.sort((a, b) => a.maxBft - b.maxBft);
  if (Array.isArray(cfg.waves))     cfg.waves.sort((a, b) => a.maxM - b.maxM);
  if (Array.isArray(cfg.sst))       cfg.sst.sort((a, b) => b.minC - a.minC);
  if (Array.isArray(cfg.feelsLike)) cfg.feelsLike.sort((a, b) => b.minC - a.minC);
  return cfg;
}

function wxLoadFlagConfig(saved) {
  if (!saved) return;
  if (saved.thresholds) {
    for (const k of ['yellow', 'red', 'black']) {
      if (saved.thresholds[k] != null) SCORE_CONFIG.thresholds[k] = saved.thresholds[k];
    }
  }
  if (saved.hysteresis != null)      SCORE_CONFIG.hysteresis = saved.hysteresis;
  if (saved.wind?.length)            SCORE_CONFIG.wind      = saved.wind;
  if (saved.waves?.length)           SCORE_CONFIG.waves     = saved.waves;
  if (saved.sst?.length)             SCORE_CONFIG.sst       = saved.sst;
  if (Array.isArray(saved.feelsLike)) SCORE_CONFIG.feelsLike = saved.feelsLike;
  if (saved.visibility)              Object.assign(SCORE_CONFIG.visibility, saved.visibility);
  if (saved.windDirModifier) {
    const w = saved.windDirModifier;
    if (w.dirs)          SCORE_CONFIG.windDirModifier.dirs   = Array.from(new Set(w.dirs));
    if (w.pts != null)   SCORE_CONFIG.windDirModifier.pts    = w.pts;
    if (w.minBft != null) SCORE_CONFIG.windDirModifier.minBft = w.minBft;
  }
  if (saved.gustModifier1Pts != null) SCORE_CONFIG.gustModifier1Pts = saved.gustModifier1Pts;
  if (saved.gustModifier2Pts != null) SCORE_CONFIG.gustModifier2Pts = saved.gustModifier2Pts;
  if (saved.flags) {
    for (const key of FLAG_KEYS) {
      if (saved.flags[key]) Object.assign(SCORE_CONFIG.flags[key], saved.flags[key]);
    }
  }
  if (saved.guidance) wxLoadFlagGuidance(saved.guidance);
  wxSortBands(SCORE_CONFIG);
}

function wxLoadFlagGuidance(g) {
  if (!g) { FLAG_GUIDANCE = _wxClone(FLAG_GUIDANCE_DEFAULTS); return; }
  FLAG_GUIDANCE = {
    profiles:     g.profiles     ? _wxClone(g.profiles)     : _wxClone(FLAG_GUIDANCE_DEFAULTS.profiles),
    boatProfiles: g.boatProfiles ? _wxClone(g.boatProfiles) : {},
    activities:   g.activities   ? _wxClone(g.activities)   : {},
  };
}

// Profile key a boat is judged by: its explicit override, else its category.
function wxBoatProfileKey(boat) {
  if (!boat) return '';
  const ov = boat.id && FLAG_GUIDANCE.boatProfiles[boat.id];
  if (ov && FLAG_GUIDANCE.profiles[ov]) return ov;
  return String(boat.category || '').toLowerCase();
}

// → { status, note, profileKey } for a boat under a flag. A boat with no
// guidance profile (or a flag the profile doesn't mention) is 'ok'.
function wxBoatGuidance(boat, flagKey, lang) {
  const key = wxBoatProfileKey(boat);
  const p = FLAG_GUIDANCE.profiles[key];
  const e = p && p[wxNormFlagKey(flagKey)];
  if (!e) return { status: 'ok', note: '', profileKey: key, configured: !!p };
  const IS = (lang || (typeof getLang === 'function' ? getLang() : 'EN')) === 'IS';
  return { status: e.s || 'ok', note: (IS && e.is) ? e.is : (e.en || e.is || ''), profileKey: key, configured: true };
}

// → { status, note } for an activity template under a flag, or null if the
// activity has no guidance configured.
function wxActivityGuidance(templateId, flagKey, lang) {
  const a = templateId && FLAG_GUIDANCE.activities[templateId];
  const e = a && a[wxNormFlagKey(flagKey)];
  if (!e) return null;
  const IS = (lang || (typeof getLang === 'function' ? getLang() : 'EN')) === 'IS';
  return { status: e.s || 'go', note: (IS && e.is) ? e.is : (e.en || e.is || '') };
}

// Status icons (Lucide, MIT). Approval uses user-check — "a person signs off".
const _GUIDANCE_ICON_PATHS = {
  ok:       '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  go:       '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  cond:     '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  adjust:   '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  approval: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  no:       '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  cancel:   '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
};
const _GUIDANCE_COLORS = {
  ok: 'var(--green)', go: 'var(--green)', cond: 'var(--yellow)', adjust: 'var(--yellow)',
  approval: 'var(--orange)', no: 'var(--red)', cancel: 'var(--red)',
};
function wxGuidanceColor(status) { return _GUIDANCE_COLORS[status] || 'var(--muted)'; }
function wxGuidanceIcon(status) {
  const p = _GUIDANCE_ICON_PATHS[status];
  if (!p) return '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline" aria-hidden="true">' + p + '</svg>';
}
// Icon + short status word, colored. Used in the flag modal, checkout forms,
// staff approvals and activity badges.
function wxGuidanceChip(status) {
  const c = wxGuidanceColor(status);
  return '<span class="wx-guidance-chip" style="color:' + c + ';border-color:color-mix(in srgb, ' + c + ' 35%, transparent);background:color-mix(in srgb, ' + c + ' 10%, transparent)">'
    + wxGuidanceIcon(status) + ' ' + s('wx.gd.' + status) + '</span>';
}

// Display label for a guidance profile — boat category label when the key is
// a category, else the profile's own label.
function wxProfileLabel(key, lang) {
  const IS = (lang || (typeof getLang === 'function' ? getLang() : 'EN')) === 'IS';
  const p = FLAG_GUIDANCE.profiles[key] || {};
  if (p.labelEN || p.labelIS) return (IS && p.labelIS) ? p.labelIS : (p.labelEN || p.labelIS);
  const cats = (typeof window !== 'undefined' && window._wxBoatCats) || [];
  const c = cats.find(x => x.key === key);
  if (c) return (IS && c.labelIS) ? c.labelIS : (c.labelEN || key);
  return key.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
// Pages that know the boat categories register them so profile labels match.
function wxRegisterBoatCats(cats) { if (typeof window !== 'undefined') window._wxBoatCats = cats || []; }

// "What this means" table for the flag detail modal: one row per profile.
function wxGuidanceTableHtml(flagKey, lang) {
  const keys = Object.keys(FLAG_GUIDANCE.profiles);
  if (!keys.length) return '';
  const cats = (typeof window !== 'undefined' && window._wxBoatCats) || [];
  // Hide profiles for inactive categories (custom profiles always show).
  const shown = keys.filter(k => {
    const c = cats.find(x => x.key === k);
    return !c || (c.active !== false && c.active !== 'false');
  });
  const rows = shown.map(k => {
    const e = FLAG_GUIDANCE.profiles[k][wxNormFlagKey(flagKey)] || { s: 'ok' };
    const IS = lang === 'IS';
    const note = (IS && e.is) ? e.is : (e.en || e.is || '');
    return '<div class="wx-guidance-row">'
      + '<span class="wx-guidance-name">' + _wxEsc(wxProfileLabel(k, lang)) + '</span>'
      + wxGuidanceChip(e.s || 'ok')
      + (note ? '<span class="wx-guidance-note">' + _wxEsc(note) + '</span>' : '')
      + '</div>';
  }).join('');
  return '<div class="section-label mt-8 mb-6">' + s('wx.gd.whatThisMeans') + '</div>'
    + '<div class="wx-guidance-table">' + rows + '</div>';
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLAG OVERRIDE  —  staff-set manual flag that supersedes the score until midnight
// Shape: { active, flagKey, notes, notesIS, setAt, setByName, expiresAt }
// Loaded from getConfig via wxLoadFlagOverride(); wxFlagNow() applies it.
// ═══════════════════════════════════════════════════════════════════════════════
let _FLAG_OVERRIDE = null;
function wxLoadFlagOverride(ov) {
  if (!ov || !ov.active) { _FLAG_OVERRIDE = null; return; }
  if (ov.expiresAt && new Date(ov.expiresAt).getTime() <= Date.now()) { _FLAG_OVERRIDE = null; return; }
  _FLAG_OVERRIDE = Object.assign({}, ov, { flagKey: wxNormFlagKey(ov.flagKey) || 'yellow' });
}
function wxGetFlagOverride() { return _FLAG_OVERRIDE; }

// Next UTC midnight (Iceland stays on UTC year-round). Used by staff page when setting override.
function wxNextMidnightUTC() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
}

// Hysteresis: raise the flag as soon as the score crosses a threshold, but
// only lower it once the score is `hysteresis` points below the threshold of
// the flag currently shown. The last shown flag is remembered per device for
// two hours so a page reload doesn't reset it.
const _HYST_KEY = 'ymir_flag_hyst';
const _HYST_TTL = 2 * 3600 * 1000;
function _wxApplyHysteresis(scored) {
  const H = Number(SCORE_CONFIG.hysteresis) || 0;
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(_HYST_KEY) || 'null'); } catch (e) {}
  let key = scored.flagKey;
  if (H > 0 && prev && FLAG_KEYS.includes(prev.k) && Date.now() - prev.t < _HYST_TTL
      && wxFlagRank(key) < wxFlagRank(prev.k)) {
    const thr = SCORE_CONFIG.thresholds[prev.k];
    if (thr != null && scored.score > thr - H) key = prev.k;
  }
  try { localStorage.setItem(_HYST_KEY, JSON.stringify({ k: key, t: Date.now() })); } catch (e) {}
  if (key === scored.flagKey) return scored;
  return { ...scored, flagKey: key, flag: SCORE_CONFIG.flags[key], held: true };
}

// Scores + applies hysteresis + override. Same return shape as wxScoreFlag,
// plus `override` and `autoScored` when the override is active. Use this for
// the *current* flag only; forecast/past-hour rendering should call
// wxScoreFlag directly so trajectories reflect the raw scoring model.
function wxFlagNow(ws, wDir, waveH, airT, sst, wg, visKey) {
  const scored = _wxApplyHysteresis(wxScoreFlag(ws, wDir, waveH, airT, sst, wg, visKey));
  if (!_FLAG_OVERRIDE) return { ...scored, override: null, autoScored: null };
  const ov = _FLAG_OVERRIDE;
  const flag = SCORE_CONFIG.flags[ov.flagKey] || scored.flag;
  return {
    flagKey: ov.flagKey,
    flag,
    score: scored.score,
    breakdown: scored.breakdown,
    reasons: [],
    override: ov,
    autoScored: scored,
  };
}

// ── Unit helpers ───────────────────────────────────────────────────────────────────────────────
function wxMsToBft(ms) {
  const T = [0,0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7];
  for (let i = T.length - 1; i >= 0; i--) if (ms >= T[i]) return i;
  return 0;
}
function wxMsToKt(ms)   { return Math.round(ms * 1.944); }
function wxDirLabel(d)  { if (d == null) return ''; return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d/22.5)%16]; }
// CSS-rotated ↓ (= "wind from N blows S") so the arrow points the actual
// observed bearing rather than snapping to one of 8 cardinals. d=0 leaves ↓
// alone; d=90 rotates 90° clockwise to point west (wind from E); etc.
// inline-block is required — transform: rotate doesn't apply to inline spans.
function wxDirArrow(d)  { if (d == null) return ''; return `<span style="display:inline-block;transform:rotate(${Math.round(d)}deg)">↓</span>`; }
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
 * Every caller should pass every factor it has; a null factor scores 0, so
 * leaving one out silently lowers the flag.
 * @param {number} ws      wind speed m/s
 * @param {string} wDir    compass direction e.g. 'NE' (or degrees)
 * @param {number} waveH   wave height metres (null/0 if unknown)
 * @param {number} airT    apparent ("feels like") air temp °C (null if unknown)
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
  if (wBand && wBand.pts > 0) {
    score += wBand.pts;
    breakdown.push({ factor:'wind', pts:wBand.pts,
      label: s('wx.bdWind', { n: bft, desc: wxBftDesc(bft) }) });
  }

  const dir = (typeof wDir === 'number' ? wxDirLabel(wDir) : (wDir || '')).toUpperCase().trim();
  const wdm = cfg.windDirModifier;
  const wdmMin = wdm.minBft != null ? wdm.minBft : 1;
  if (dir && wdm.pts > 0 && wdm.dirs.includes(dir) && bft >= wdmMin) {
    score += wdm.pts;
    breakdown.push({ factor:'direction', pts:wdm.pts,
      label: s('wx.bdWindDir', { dir }) });
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
    if (wvBand && wvBand.pts > 0) {
      score += wvBand.pts;
      breakdown.push({ factor:'waves', pts:wvBand.pts,
        label: s('wx.bdWaves', { h: wh.toFixed(1) }) });
    }
  }

  if (sst != null) {
    const sBand = cfg.sst.find(b => sst >= b.minC) || cfg.sst[cfg.sst.length - 1];
    if (sBand && sBand.pts > 0) {
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
  const flagKey = score >= t.black ? 'black' : score >= t.red ? 'red' : score >= t.yellow ? 'yellow' : 'green';
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

// ── Flag detail modal ───────────────────────────────────────────────────────────────
// Single shared modal used by: this widget's flag pill (staff/member/daily-log),
// the standalone weather page, and the public dashboard. Lazy-injected once per
// page via ensureWxFlagModal(); showWxFlagModal() fills + opens it.
function ensureWxFlagModal() {
  if (document.getElementById('wxFlagModal')) return;
  const md = document.createElement('div');
  md.innerHTML = '<div class="modal-overlay hidden" id="wxFlagModal">'
    + '<div class="modal modal--md">'
    + '<div class="modal-header">'
    + '<h3 id="wxFlagModalTitle" style="margin:0"></h3>'
    + '<button class="modal-close-x" data-wx-close="wxFlagModal">&times;</button>'
    + '</div><div id="wxFlagModalBody"></div>'
    + '<div class="btn-row" style="margin-top:16px"><button class="btn btn-secondary" data-wx-close="wxFlagModal">'
    + (typeof s === 'function' ? s('btn.close') : 'Close')
    + '</button></div></div></div>';
  const overlay = md.firstElementChild;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal('wxFlagModal');
  });
  overlay.querySelectorAll('[data-wx-close]').forEach(function(btn) {
    btn.addEventListener('click', function() { closeModal(btn.dataset.wxClose); });
  });
}

function showWxFlagModal(title, bodyHtml) {
  ensureWxFlagModal();
  const t = document.getElementById('wxFlagModalTitle');
  const b = document.getElementById('wxFlagModalBody');
  if (t) t.textContent = title || '';
  if (b) b.innerHTML   = bodyHtml || '';
  if (typeof openModal === 'function') openModal('wxFlagModal');
  else document.getElementById('wxFlagModal').classList.remove('hidden');
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
  // What the current flag means per boat class, plus footnotes: flag held by
  // hysteresis, wave data from the offshore fallback point, and the reminder
  // that club flags are not Veðurstofa warnings.
  const guidanceHtml = wxGuidanceTableHtml(result.flagKey, IS ? 'IS' : 'EN');
  const footHtml = '<div class="wx-flag-foot">'
    + (result.held ? '<div>' + s('wx.flagHeld', { n: SCORE_CONFIG.hysteresis }) + '</div>' : '')
    + (result.marineFallback ? '<div>' + s('wx.marineFallback') + '</div>' : '')
    + '<div>' + s('wx.notMetWarning') + '</div>'
    + '</div>';
  // ── Override mode: show manual notes instead of score breakdown ─────────────
  if (result.override) {
    const ov = result.override;
    const noteText = (IS && ov.notesIS) ? ov.notesIS : (ov.notes || ov.notesIS || '');
    const setBy    = ov.setByName ? s('wx.overrideBy', { name: ov.setByName }) : '';
    const setTime  = ov.setAt ? String(ov.setAt).slice(11,16) + ' UTC' : '';
    const expText  = s('wx.overrideResetsMidnight');
    const escN     = String(noteText).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    return _ssBadgesHtml + '<div style="background:'+flag.bg+';border:1px solid '+flag.border+';border-radius:8px;padding:12px 14px;margin-bottom:14px">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="font-size:28px">'+flag.icon+'</div>'
      + '<span style="font-size:10px;letter-spacing:1.2px;color:'+flag.color+';border:1px solid '+flag.border+';padding:2px 8px;border-radius:10px">'+s('wx.overrideBadge')+'</span></div>'
      + '<div style="font-size:13px;color:'+flag.color+';font-weight:500;margin-bottom:6px">'+advice+'</div>'
      + (noteText ? '<div style="font-size:12px;color:var(--text);line-height:1.55;border-top:1px solid '+flag.border+';padding-top:10px;margin-top:4px">'+escN+'</div>' : '')
      + '</div>'
      + '<div style="font-size:10px;color:var(--muted);margin-bottom:14px">'
      + (setBy ? setBy + ' · ' : '') + (setTime ? setTime + ' · ' : '') + expText
      + '</div>'
      + '<div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">'+s('wx.autoScoreWouldBe')+'</div>'
      + '<div style="font-size:11px;color:var(--muted);padding:4px 0">' + s('wx.totalScore') + ': ' + result.score + '</div>'
      + guidanceHtml + footHtml;
  }
  return _ssBadgesHtml + '<div style="background:'+flag.bg+';border:1px solid '+flag.border+';border-radius:8px;padding:12px 14px;margin-bottom:14px">'
    + '<div style="font-size:28px;margin-bottom:6px">'+flag.icon+'</div>'
    + '<div style="font-size:13px;color:'+flag.color+';font-weight:500;margin-bottom:6px">'+advice+'</div>'
    + (desc ? '<div style="font-size:12px;color:var(--text);line-height:1.55;border-top:1px solid '+flag.border+';padding-top:10px;margin-top:4px">'+desc+'</div>' : '')
    + '</div>'
    + chipsHtml
    + barHtml
    + '<div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:4px">'+s('wx.scoreBreakdown')+'</div>'
    + rows + totalRow
    + guidanceHtml + footHtml;
}



// Visibility (metres) → flag-score key. Thresholds: poor <1km, reduced <5km.
function wxVisKey(metres) {
  if (metres == null) return 'good';
  if (metres < 1000) return 'poor';
  if (metres < 5000) return 'reduced';
  return 'good';
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
  // The proxy (Supabase Edge Function `weather`, see supabase/functions/weather)
  // fetches METAR BIRK (half-hourly + SPECI) and Vedur.is station 1477
  // (hourly) server-side in parallel and returns the newer one, fresh on every
  // call, with no caching of its own — the whole widget was blocking on this
  // one leg for up to 5s whenever Vedur.is was slow, even though the other
  // two legs (Open-Meteo) typically settle in well under a second. Capped
  // shorter here since the fallback path is already solid: if BIRK isn't
  // back in time, the widget renders with Open-Meteo's `current` data
  // instead, and the eventual (still in-flight) response just warms the
  // sessionStorage cache for the next refresh tick.
  const BIRK_TIMEOUT_MS = 2000;
  // The proxy is session-gated, so anonymous viewers (the public dashboard)
  // skip it and go straight to the Open-Meteo fallback.
  const hasSession = typeof _getSessionToken === 'function' && !!_getSessionToken();
  const birkPromise = (useBirk && hasSession)
    ? Promise.race([
        apiGet('getWeather', fresh ? { _fresh: true } : {}).catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), BIRK_TIMEOUT_MS)),
      ])
    : Promise.resolve(null);

  // ── 2. Open-Meteo hourly + current  —  chart data + fills nulls left by BIRK ──────────
  // Pinned to ICON-EU (6.5km, DWD) for consistent source across all variables including visibility.
  const hourlyParams = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,visibility,apparent_temperature';
  const currentParams = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,apparent_temperature,surface_pressure,weather_code,visibility';
  const hourlyUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourlyParams}&current=${currentParams}&models=icon_eu&forecast_hours=9&past_hours=3&timezone=auto&wind_speed_unit=ms`;
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
            // Tag the offshore fallback so the flag modal can say the wave
            // figure is from open water, not Fossvogur itself.
            .then(r2 => r2.ok ? r2.json() : null).then(d2 => { if (d2) d2._fallback = true; return d2; });
        }
        return r.json();
      })
      .then(d => { if (d) _wxCacheSet(marineCacheKey, d); return d; })
      .catch(() => null);
  })();

  const [birkRes, hourlyData, marine] = await Promise.all([
    birkPromise, hourlyPromise, marinePromise,
  ]);

  // ── Map BIRK obs into the wx.current shape the rest of the code expects
  // Backend (Edge Function `weather`) returns m/s for wspd/wgst (METAR knots
  // are converted server-side), degrees for wdir, °C for temp, hPa for slp
  // (METAR QNH; null when only Vedur answered). All match the site's
  // internal canonical units so values pass straight through.
  const obs   = birkRes?.obs ?? {};
  const wdDeg = (obs.wdir != null && obs.wdir !== 'VRB') ? Number(obs.wdir) : null;
  const ws    = obs.wspd  != null ? Number(obs.wspd) : 0;
  const wg    = obs.wgst != null  ? Number(obs.wgst) : ws;  // fall back to wspd when no gust
  const temp  = obs.temp  != null ? Number(obs.temp) : null;
  const pres  = obs.slp   != null ? Number(obs.slp)  : null;

  // useBirk asked for BIRK data; useBirkEffective also requires that the
  // BIRK call actually returned something (timeout / failure / empty obs
  // all flip us to the Open-Meteo render branch instead of rendering a card
  // full of zeros).
  const atmCurEarly = hourlyData?.current;
  const useBirkEffective = useBirk && birkRes && birkRes.obs;
  const wx = {
    current: useBirkEffective ? {
      wind_speed_10m:      ws,
      wind_direction_10m:  wdDeg,
      wind_gusts_10m:      wg,
      temperature_2m:      temp,
      apparent_temperature: temp,   // BIRK doesn't supply feels-like; use actual temp
      weather_code:        null,    // no weather code from BIRK
      surface_pressure:    pres,
      visibility:          null,    // filled from Open-Meteo below
      _source: obs._source || 'BIRK',
      _obs_time: obs.reportTime || obs.obsTime || null,
    } : {
      wind_speed_10m:       atmCurEarly?.wind_speed_10m      ?? 0,
      wind_direction_10m:   atmCurEarly?.wind_direction_10m  ?? null,
      wind_gusts_10m:       atmCurEarly?.wind_gusts_10m      ?? 0,
      temperature_2m:       atmCurEarly?.temperature_2m      ?? null,
      apparent_temperature: atmCurEarly?.apparent_temperature ?? null,
      weather_code:         atmCurEarly?.weather_code        ?? null,
      surface_pressure:     atmCurEarly?.surface_pressure    ?? null,
      visibility:           atmCurEarly?.visibility          ?? null,
      _source: 'OpenMeteo',
      _obs_time: atmCurEarly?.time || null,
    },
    // Hourly data for chart  —  from Open-Meteo (or empty fallback)
    hourly: hourlyData?.hourly ?? {
      time: [], wind_speed_10m: [], wind_direction_10m: [],
      wind_gusts_10m: [], surface_pressure: [], visibility: [], apparent_temperature: [],
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
    if (wx.current.visibility == null && atmCur.visibility != null)
      wx.current.visibility = atmCur.visibility;
  }
  return { wx, marine };
}

// ── Retroactive fetch ─────────────────────────────────────────────────────────
// Fetch a single past hour for a given calendar date. Used by the daily-log
// retro-snapshot button. BIRK has no public historical API, so this is purely
// Open-Meteo (forecast API for the recent ~92-day window, archive API beyond
// that). Returns { wx, marine, hourIdx } shaped like wxFetch so the caller can
// reuse wxScoreFlag / wxPressureTrend / wxSnapshot.
async function wxFetchAt(lat, lon, dateISO, hhmm) {
  if (!dateISO || !hhmm) return null;
  const todayISOStr = new Date().toISOString().slice(0, 10);
  const daysAgo = Math.floor((Date.parse(todayISOStr) - Date.parse(dateISO)) / 86400000);
  // Forecast API serves the most recent ~92 days at full resolution; older
  // dates fall through to the ERA5 archive (≈5-day publication lag).
  const useArchive = daysAgo > 90;
  const host = useArchive ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const marineHost = 'https://marine-api.open-meteo.com/v1/marine';
  const hourlyParams = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,temperature_2m,apparent_temperature,weather_code,visibility';
  const marineParams = 'wave_height,wave_direction,wave_period,sea_surface_temperature';
  // ICON-EU is forecast-only; archive endpoint silently ignores `models=` and
  // serves ERA5, so the param is harmless either way.
  const url = `${host}?latitude=${lat}&longitude=${lon}&hourly=${hourlyParams}` +
              `${useArchive ? '' : '&models=icon_eu'}` +
              `&start_date=${dateISO}&end_date=${dateISO}&timezone=auto&wind_speed_unit=ms`;
  const marineUrl = `${marineHost}?latitude=${lat}&longitude=${lon}&hourly=${marineParams}` +
                    `&start_date=${dateISO}&end_date=${dateISO}&timezone=auto`;

  const [hourlyData, marineData] = await Promise.all([
    fetch(url).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(marineUrl).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  if (!hourlyData?.hourly?.time?.length) return null;

  const targetHour = `${dateISO}T${hhmm.slice(0, 2)}:00`;
  const hr = hourlyData.hourly;
  const idx = hr.time.findIndex(t => t === targetHour);
  if (idx < 0) return null;

  const mhr = marineData?.hourly;
  const wx = {
    current: {
      wind_speed_10m:       hr.wind_speed_10m?.[idx]      ?? 0,
      wind_direction_10m:   hr.wind_direction_10m?.[idx]  ?? null,
      wind_gusts_10m:       hr.wind_gusts_10m?.[idx]      ?? 0,
      temperature_2m:       hr.temperature_2m?.[idx]      ?? null,
      apparent_temperature: hr.apparent_temperature?.[idx] ?? null,
      weather_code:         hr.weather_code?.[idx]        ?? null,
      surface_pressure:     hr.surface_pressure?.[idx]    ?? null,
      visibility:           hr.visibility?.[idx]          ?? null,
      _source: useArchive ? 'OpenMeteoArchive' : 'OpenMeteoHindcast',
      _obs_time: hr.time[idx],
    },
    hourly: hr,
  };
  const marine = mhr ? {
    current: {
      wave_height:             mhr.wave_height?.[idx]             ?? null,
      wave_direction:          mhr.wave_direction?.[idx]          ?? null,
      wave_period:             mhr.wave_period?.[idx]             ?? null,
      sea_surface_temperature: mhr.sea_surface_temperature?.[idx] ?? null,
    },
    hourly: mhr,
  } : null;
  return { wx, marine, hourIdx: idx };
}

// ── Compact widget (member + dailylog) ────────────────────────────────────────
// Always uses WX_DEFAULT coords regardless of any location override.
// targetEl  : DOM element to render into (must have class wx-widget in CSS)
// onData    : optional callback(snapshot)
// Returns { refresh(), start(), stop() }
function wxWidget(targetEl, { onData, showRefreshBtn = true, label, getStaffStatus } = {}) {
  const loc = { lat: WX_DEFAULT.lat, lon: WX_DEFAULT.lon, label: label || WX_DEFAULT.label };
  let timer = null;

  // Delegated refresh-button handler (replaces inline onclick= in innerHTML
  // templates below, which CSP blocks under strict script-src).
  if (!targetEl._wxClickBound) {
    targetEl._wxClickBound = true;
    targetEl.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-wx-refresh]');
      if (btn && typeof targetEl._wxRefresh === 'function') {
        targetEl._wxRefresh({ fresh: btn.dataset.wxRefresh === 'fresh' });
      }
    });
  }

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
      const _flagResult = wxFlagNow(ws, wDir, waveH ?? 0, c.apparent_temperature ?? c.temperature_2m, sst, wg, wxVisKey(c.visibility));
      const { flagKey, flag, score, breakdown, reasons, override } = _flagResult;

      const nowISO = new Date().toISOString().slice(0,13);
      const nowIdx = Math.max(0, (hr.time||[]).findIndex(t => t.slice(0,13) === nowISO));
      const { trend, diff } = wxPressureTrend(hr.surface_pressure, nowIdx);

      if (onData) onData({ ws, wd, wg, bft, waveH, wDir, sst, airT: c.temperature_2m,
        apparentT: c.apparent_temperature, code: c.weather_code, flagKey, score, breakdown,
        pres, presTrend: trend,
        flagResult: { flagKey, flag, score, breakdown },
      });

      const updTime = fmtTimeNow();
      targetEl.classList.remove('flag-green', 'flag-yellow', 'flag-orange', 'flag-red', 'flag-black');
      targetEl.classList.add('wx-widget', `flag-${flagKey}`);
      targetEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:9px;color:var(--muted);letter-spacing:1.2px">${s('wx.birkConditions')}${c._obs_time ? ' · ' + c._obs_time.slice(11,16) + ' UTC' : ''}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            ${showRefreshBtn ? `<button data-wx-refresh="fresh" title="Refresh" style="background:none;border:1px solid var(--border);color:var(--muted);padding:2px 6px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit">↻ ${updTime}</button>` : `<span style="font-size:10px;color:var(--muted)">↻ ${updTime}</span>`}
            <a href="../weather/" style="font-size:11px;font-weight:600;color:var(--accent-fg);text-decoration:none;white-space:nowrap;border:1px solid var(--accent);border-radius:6px;padding:4px 10px;background:var(--accent)12">${s('wx.openForecast')}</a>
          </div>
        </div>
        <!-- 2-row grid, columns locked -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
          <div class="wx-cell">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.8px;margin-bottom:6px">${s('wx.wind')}</div>
            <div style="display:flex;align-items:center;gap:3px;line-height:1">
              <span style="font-size:32px;color:var(--accent-fg);font-weight:500;line-height:1">${wxDirArrow(wd)}</span>
              <span style="font-size:32px;color:var(--accent-fg);font-weight:500;line-height:1">${Math.round(ws)}</span>
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
            <div style="font-size:28px;font-weight:500;color:var(--accent-fg);line-height:1">${c.temperature_2m != null ? Math.round(c.temperature_2m)+'°' : ''}</div>
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
            ${override ? `<span style="font-size:9px;letter-spacing:1px;padding:1px 6px;border:1px solid ${flag.border};border-radius:8px;opacity:.85">${s('wx.overrideBadge')}</span>` : ''}
          </span>
          <div class="wx-status-badges" style="display:flex;flex-wrap:wrap;gap:5px"></div>
        </div>`;
      targetEl._wxRefresh = refresh;
      targetEl._wxResult  = { flagKey, flag, score, breakdown, reasons, override, held: _flagResult.held, marineFallback: !!marine?._fallback, snap: { ws, wDir, waveH, temperature_2m: c.temperature_2m, sst, wg } };
      ensureWxFlagModal();

      // ── Wire flag pill click  —  uses snap stored on this element ──
      const pill = targetEl.querySelector('#wxFlagPill') || targetEl.querySelector('.flag-pill');
      if (pill) pill.onclick = () => {
        const IS2 = typeof getLang === 'function' ? getLang() === 'IS' : false;
        const r   = targetEl._wxResult;  // exact result that drew this pill
        const ss  = typeof getStaffStatus === 'function' ? getStaffStatus() : null;
        if (!r) return;
        showWxFlagModal(
          r.flag.icon + ' · ' + r.score + ' ' + s('wx.pts'),
          wxFlagDetailHtml(r, ss, IS2 ? 'IS' : 'EN')
        );
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
      targetEl.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:6px 0">⚠️ Weather unavailable  —  <a href="../weather/" style="color:var(--accent-fg)">try full page →</a>${showRefreshBtn ? ` <button data-wx-refresh="" style="margin-left:8px;background:none;border:1px solid var(--border);color:var(--muted);padding:2px 8px;border-radius:4px;font-size:10px;cursor:pointer;font-family:inherit">↻</button>` : ''}</div>`;
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
