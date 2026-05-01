/* ═══════════════════════════════════════════════════════════════════════════════
   ÝMIR — shared/boats.js
   Shared boat-card and checkout-card rendering helpers.

   Usage:
     boatEmoji(category)          → emoji string
     boatCatBadge(category)       → <span class="cat-badge &">&</span> HTML
     renderBoatCard(boat, opts)   → fleet-card HTML  (available / out / oos)
     renderCheckoutCard(co, opts) → checkout-card HTML

   opts for renderBoatCard:
     { onClick, status, checkoutData }
       status        'avail' | 'out' | 'overdue' | 'oos'   (auto-detected if omitted)
       checkoutData  the matching checkout row if out/overdue
       onClick       string of JS to attach as onclick

   opts for renderCheckoutCard:
     { isMe, staffView, onCheckIn, onDelete, onReturn }
       isMe       true when the current user is the skipper
       staffView  true → show contact row + check-in/delete buttons
                  false → show YOURS/OUT/OVERDUE badge + member check-in button
   ═══════════════════════════════════════════════════════════════════════════════ */


// ── Object registry — avoids JSON-in-onclick attribute problems ───────────────
// Pages call boatRegistry.set(id, obj) after loading data,
// then onclick can safely call boatRegistry.get(id).
const boatRegistry = {
  _boats: {},
  _cos:   {},
  setBoat(b)  { this._boats[b.id] = b; },
  setBoats(bs){ bs.forEach(b => this.setBoat(b)); },
  getBoat(id) { return this._boats[id] || null; },
  setCo(c)    { this._cos[c.id] = c; },
  setCos(cs)  { cs.forEach(c => this.setCo(c)); },
  getCo(id)   { return this._cos[id] || null; },
};

// ── Category registry ──────────────────────────────────────────────────────────
// Pages call boatRegistry.setCats(catsArray) after loading config so that
// boatCatBadge / renderFleetStatus can show the translated label (EN/IS)
// instead of the raw key.
const _boatCatRegistry = [];

function registerBoatCats(cats) {
  _boatCatRegistry.length = 0;
  if (cats && cats.length) cats.forEach(c => _boatCatRegistry.push(c));
}

function _boatCatLabel(key) {
  const c = _boatCatRegistry.find(x => x.key === key);
  if (!c) return key.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const lang = typeof getLang === 'function' ? getLang() : 'EN';
  return (lang === 'IS' && c.labelIS) ? c.labelIS : (c.labelEN || key);
}

// ── Category meta ──────────────────────────────────────────────────────────────

const BOAT_ICON_SVG_ = {
  dinghy:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M10 2v15"/><path d="M7 22a4 4 0 0 1-4-4 1 1 0 0 1 1-1h16a1 1 0 0 1 1 1 4 4 0 0 1-4 4z"/><path d="M9.159 2.46a1 1 0 0 1 1.521-.193l9.977 8.98A1 1 0 0 1 20 13H4a1 1 0 0 1-.824-1.567z"/></svg>',
  keelboat: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M10 2v15"/><path d="M7 22a4 4 0 0 1-4-4 1 1 0 0 1 1-1h16a1 1 0 0 1 1 1 4 4 0 0 1-4 4z"/><path d="M9.159 2.46a1 1 0 0 1 1.521-.193l9.977 8.98A1 1 0 0 1 20 13H4a1 1 0 0 1-.824-1.567z"/></svg>',
  kayak:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M6.414 6.414a2 2 0 0 0 0-2.828l-1.414-1.414-2.828 2.828 1.414 1.414a2 2 0 0 0 2.828 0"/><path d="M17.586 17.586a2 2 0 0 0 0 2.828l1.414 1.414 2.828-2.828-1.414-1.414a2 2 0 0 0-2.828 0"/><path d="M6.5 6.5l11 11"/><path d="M22 2.5c-9.983 2.601-17.627 7.952-20 19.5 9.983-2.601 17.627-7.952 20-19.5"/><path d="M6.5 12.5l5 5"/><path d="M12.5 6.5l5 5"/></svg>',
  rowboat:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M10 2v15"/><path d="M7 22a4 4 0 0 1-4-4 1 1 0 0 1 1-1h16a1 1 0 0 1 1 1 4 4 0 0 1-4 4z"/><path d="M9.159 2.46a1 1 0 0 1 1.521-.193l9.977 8.98A1 1 0 0 1 20 13H4a1 1 0 0 1-.824-1.567z"/></svg>',
  other:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M2 17h14.4a3 3 0 0 0 2.5-1.34l3.1-4.66h-6.23a4 4 0 0 0-1.49.29l-3.56 1.42a4 4 0 0 1-1.49.29h-5.73l-1.5 4"/><path d="M6 13l1.5-5"/><path d="M6 8h8l2 3"/></svg>',
};
const BOAT_EMOJI_ = {
  dinghy:        "⛵",
  keelboat:      "⛵",
  kayak:         "🛶",
  "rowing-shell":"🚣",
  rowboat:       "🚣",
  sup:           "🏄",
  wingfoil:      "🪁",
  other:         "🚤",
};

const BOAT_CAT_COLORS = {
  dinghy:        { bg:"#1a4a8a22", color:"#5b9bd5",  border:"#5b9bd544" },
  keelboat:      { bg:"#d4af3718", color:"#d4af37",  border:"#d4af3744" },
  kayak:         { bg:"#8e44ad18", color:"#9b59b6",  border:"#9b59b644" },
  "rowing-shell":{ bg:"#0e6b9a18", color:"#3498db",  border:"#3498db44" },
  rowboat:       { bg:"#16a08518", color:"#1abc9c",  border:"#1abc9c44" },
  sup:           { bg:"#e67e2218", color:"#e67e22",  border:"#e67e2244" },
  wingfoil:      { bg:"#c0392b18", color:"#e74c3c",  border:"#e74c3c44" },
  other:         { bg:"#1e3f6e",   color:"#6b92b8",  border:"#2a5490"   },
};

// Admin-configurable per-category color. Returns the triplet {bg, color, border}
// used by badge, fleet-status bar, and admin boat-card backgrounds.
// Precedence: category.color (admin override) → BOAT_CAT_COLORS[key] → .other
function boatCatColors(catKey) {
  const key  = (catKey || '').toLowerCase();
  const cat  = _boatCatRegistry.find(x => x.key === key);
  const hex  = cat && typeof cat.color === 'string' ? cat.color.trim() : '';
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return { color: hex, bg: hex + '18', border: hex + '44' };
  }
  return BOAT_CAT_COLORS[key] || BOAT_CAT_COLORS.other;
}

// Built-in default color for a category key (used by the admin "reset" button).
// Returns the text color (hex) from the hardcoded fallback map.
function boatCatDefaultColor(catKey) {
  const key = (catKey || '').toLowerCase();
  return (BOAT_CAT_COLORS[key] && BOAT_CAT_COLORS[key].color) || BOAT_CAT_COLORS.other.color;
}

function boatEmoji(cat) {
  const key = (cat||"").toLowerCase();
  const c = _boatCatRegistry.find(x => x.key === key);
  if (c && c.emoji) return c.emoji;
  if (BOAT_ICON_SVG_[key]) return BOAT_ICON_SVG_[key];
  return BOAT_EMOJI_[key] || "⛵";
}

// ── Access-gate registry & normalization ──────────────────────────────────────
// Pages that need cert-aware access checks (rank gates, legacy subcat-key
// disambiguation) should call registerCertDefsForBoats(cfgRes.certDefs) after
// loading config. Pages that don't register still get correct behaviour for
// structured gates and exact subcat matches — only rank-based gates and
// legacy-string → certId resolution require defs.
var _boatAccessCertDefs = [];
function registerCertDefsForBoats(defs) {
  _boatAccessCertDefs = Array.isArray(defs) ? defs : [];
}

/**
 * Return a {certId, sub, minRank} object describing the boat's access gate,
 * or null if no gate is set. Handles three input shapes:
 *   1. New:     boat.accessGate = { certId, sub?, minRank? }
 *   2. Legacy subcat key:  boat.accessGateCert = 'released'        → resolves via defs
 *   3. Legacy def id:      boat.accessGateCert = 'support_boat_skipper'
 * When defs are unavailable and the legacy string can't be resolved, returns
 * a sub-only shape ({certId:'', sub:raw}) which memberHasGate() treats as a
 * loose subcat match — preserving pre-migration behaviour.
 */
function normalizeAccessGate(boat, certDefs) {
  if (!boat) return null;
  var defs = Array.isArray(certDefs) ? certDefs : _boatAccessCertDefs;
  // Shape 1: structured object
  if (boat.accessGate && typeof boat.accessGate === 'object' && boat.accessGate.certId) {
    var minRank = Number(boat.accessGate.minRank || 0) || 0;
    return {
      certId:  String(boat.accessGate.certId),
      sub:     boat.accessGate.sub ? String(boat.accessGate.sub) : '',
      minRank: minRank > 0 ? minRank : 0,
    };
  }
  // Shape 2/3: bare string
  var raw = boat.accessGateCert;
  if (!raw || typeof raw !== 'string') return null;
  if (defs.length) {
    // Try subcat key match first (most legacy values are subcat keys)
    for (var i = 0; i < defs.length; i++) {
      var def = defs[i];
      if (def && Array.isArray(def.subcats)) {
        for (var j = 0; j < def.subcats.length; j++) {
          if (def.subcats[j] && def.subcats[j].key === raw) {
            return { certId: def.id, sub: raw, minRank: 0 };
          }
        }
      }
    }
    // Then def id match (flat credentials like 'support_boat_skipper')
    for (var k = 0; k < defs.length; k++) {
      if (defs[k] && defs[k].id === raw) return { certId: raw, sub: '', minRank: 0 };
    }
  }
  // Unresolved legacy: treat as sub-only match
  return { certId: '', sub: raw, minRank: 0 };
}

function _gateSubcatRank(certDefs, certId, subKey) {
  var defs = Array.isArray(certDefs) ? certDefs : _boatAccessCertDefs;
  if (!defs.length || !certId || !subKey) return 0;
  var def = null;
  for (var i = 0; i < defs.length; i++) { if (defs[i] && defs[i].id === certId) { def = defs[i]; break; } }
  if (!def || !Array.isArray(def.subcats)) return 0;
  for (var j = 0; j < def.subcats.length; j++) {
    var sc = def.subcats[j];
    if (sc && sc.key === subKey) return Number(sc.rank || 0) || 0;
  }
  return 0;
}

/**
 * Unified predicate: does `certs` (a member's credentials array) satisfy
 * `gate` (a normalized access gate)?
 *
 * Rules:
 *   - No gate (null / empty) → always true
 *   - Expired credentials (c.expiresAt < today) never match
 *   - gate.minRank > 0: any subcat on the same certId whose rank >= minRank
 *   - gate.sub: exact subcat match on the same certId
 *   - gate.certId only: member holds any credential with that certId
 *   - gate.sub without certId (unresolved legacy): match by sub alone
 */
function memberHasGate(certs, gate, certDefs) {
  if (!gate || (!gate.certId && !gate.sub)) return true;
  if (!Array.isArray(certs)) return false;
  var today = todayISO();
  var defs = Array.isArray(certDefs) ? certDefs : _boatAccessCertDefs;
  return certs.some(function(c) {
    if (!c) return false;
    if (c.expiresAt && c.expiresAt < today) return false;
    // Legacy sub-only gate (certId unknown): match by sub alone
    if (!gate.certId) return gate.sub && c.sub === gate.sub;
    if (c.certId !== gate.certId) return false;
    if (gate.minRank > 0) {
      return _gateSubcatRank(defs, gate.certId, c.sub) >= gate.minRank;
    }
    if (gate.sub) return c.sub === gate.sub;
    return true; // certId-only gate satisfied
  });
}

// ── Ownership / charter helpers ───────────────────────────────────────────────

/** Returns true if the boat is privately owned. */
function isPrivate(boat) {
  return boat && boat.ownership === 'private';
}

/** Returns true if the boat is in controlled-access mode. */
function isControlledAccess(boat) {
  return boat && boat.accessMode === 'controlled';
}

/** Returns true if the boat has an active reservation for the given member. */
function hasActiveReservation(boat, kennitala) {
  if (!boat || !boat.reservations || !boat.reservations.length) return false;
  var today = todayISO();
  return boat.reservations.some(function(r) {
    return String(r.memberKennitala) === String(kennitala) && today >= r.startDate && today <= r.endDate;
  });
}

/** Returns the first active reservation (today within range), or null. */
function getActiveReservation(boat) {
  if (!boat || !boat.reservations || !boat.reservations.length) return null;
  var today = todayISO();
  for (var i = 0; i < boat.reservations.length; i++) {
    var r = boat.reservations[i];
    if (today >= r.startDate && today <= r.endDate) return r;
  }
  return null;
}

/** Returns true if the boat uses slot-based scheduling. */
function isSlotScheduled(boat) {
  return boat && boolVal(boat.slotSchedulingEnabled);
}

/** Returns true if the boat is available outside of admin-defined slots. */
function isAvailableOutsideSlots(boat) {
  if (!boat || boat.availableOutsideSlots === undefined || boat.availableOutsideSlots === null) return true;
  return boolVal(boat.availableOutsideSlots);
}

/**
 * Check if user has a booked slot right now for this boat.
 * Requires _allSlots to be loaded (via loadSlots()).
 */
function hasActiveSlot(boat, kennitala, slots) {
  if (!boat || !slots || !slots.length) return false;
  var today = todayISO();
  var now = new Date();
  var nowTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  return slots.some(function(s) {
    if (s.boatId !== boat.id || s.date !== today) return false;
    if (s.startTime > nowTime || s.endTime <= nowTime) return false;
    if (!s.bookedByKennitala) return false;
    if (String(s.bookedByKennitala) === String(kennitala)) return true;
    // Crew member check handled by caller with crew data
    return false;
  });
}

/**
 * Returns true if the given user can access this boat.
 * Free-access boats: anyone. Controlled-access boats: staff, owner, cert-gated, allowlisted, or has reservation/slot.
 */
function canAccessBoat(boat, user, opts) {
  if (!boat || !boat.accessMode || boat.accessMode === 'free') return true;
  if (!user) return false;
  if (isStaff(user)) return true;
  // Private boat owner always has access
  if (boat.ownership === 'private' && String(boat.ownerId || boat.ownerKennitala || '') === String(user.kennitala)) return true;
  // Slot-only boats (slot scheduling on, not available outside slots): an
  // active slot booking is the sole non-staff/non-owner path. Cert gates and
  // allowlists qualify a member to book, but don't bypass the slot itself.
  // Only enforce when slot data is provided — display contexts that don't
  // load slots fall through to the permissive checks below.
  if (isSlotScheduled(boat) && !isAvailableOutsideSlots(boat) && opts && opts.slots) {
    return hasActiveSlot(boat, user.kennitala, opts.slots);
  }
  // Check cert gate via unified helper (honours expiry + rank + new structured shape)
  var gate = normalizeAccessGate(boat, opts && opts.certDefs);
  if (gate) {
    var certs = parseJson(user.certifications, []);
    if (memberHasGate(certs, gate, opts && opts.certDefs)) return true;
  }
  // Check allowlist
  if (boat.accessAllowlist && Array.isArray(boat.accessAllowlist) && boat.accessAllowlist.indexOf(String(user.kennitala)) !== -1) return true;
  // Check active date-range reservation for this user
  if (hasActiveReservation(boat, user.kennitala)) return true;
  // Check active slot booking
  if (isSlotScheduled(boat) && opts && opts.slots) {
    if (hasActiveSlot(boat, user.kennitala, opts.slots)) return true;
  }
  return false;
}

function boatCatBadge(cat) {
  const key = (cat||"other").toLowerCase();
  const col = boatCatColors(key);
  const label = _boatCatLabel(key);
  return `<span style="font-size:10px;font-weight:600;letter-spacing:.5px;padding:2px 7px;border-radius:10px;`
       + `border:1px solid ${col.border};background:${col.bg};color:${col.color};display:inline-block">`
       + `${_besc(label)}</span>`;
}

// ── Fleet card (available / out / oos) ─────────────────────────────────────────
/*
  Standard card used on both member Fleet tab and staff Fleet grid.
  Caller provides status + optional checkoutData.

  Appearance:
    ╔═════════════════════════════════════════╗
    ║  ⛵ Boat Name              [badge]       ║
    ║  location if avail                       ║
    ║  member · location · dep · est return    ║  → only if out/overdue
    ║  OOS reason                              ║  → only if oos
    ╚═════════════════════════════════════════╝
*/
function renderBoatCard(boat, opts) {
  opts = opts || {};
  const cat    = (boat.category||"other").toLowerCase();
  const emoji  = boatEmoji(cat);
  const name   = _besc(boat.name||"");
  const oos    = boat.oos===true || boat.oos==="true" || boat.oos===1;

  // Determine status
  const co     = opts.checkoutData || null;
  let   status = opts.status;
  if (!status) {
    if      (co && opts.overdue) status = "overdue";
    else if (co)                 status = "out";
    else if (oos)                status = "oos";
    else                         status = "avail";
  }

  // Left accent colour
  const accentMap = { out:"var(--accent)", overdue:"var(--red)", oos:"var(--border)", avail:"transparent" };
  const accent    = accentMap[status] || "transparent";

  // Badge
  const badgeMap = {
    avail:   { text:s("fleet.badgeAvail"),   style:"color:var(--moss);border-color:color-mix(in srgb, var(--moss) 33%, transparent);background:color-mix(in srgb, var(--moss) 8%, transparent)" },
    out:     { text:s("fleet.badgeOut"),      style:"color:var(--accent-fg);border-color:var(--accent)55;background:var(--accent)11" },
    overdue: { text:s("fleet.badgeOverdue"),  style:"color:var(--red);border-color:var(--red)55;background:var(--red)11" },
    oos:     { text:s("fleet.badgeOos"),      style:"color:var(--muted);border-color:var(--border);background:var(--surface)" },
  };
  const badge  = badgeMap[status] || badgeMap.avail;
  const bdgHtml = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;${badge.style}">${badge.text}</span>`;

  // Checkout info line (when out / overdue)
  let infoLine = "";
  if (co && (status==="out"||status==="overdue")) {
    const tout  = sstr(co.checkedOutAt||co.timeOut).slice(0,5);
    const retBy = co.expectedReturn||co.returnBy||"";
    infoLine = `<div style="font-size:11px;color:var(--muted);margin-top:4px">`
             + `${_besc(co.memberName||"")} · ${_besc(co.locationName||"")} · ${_besc(s("fleet.outTime",{t:tout}))}`
             + `${retBy?" · ↩ "+_besc(retBy):""}`
             + `</div>`;
  }

  // OOS reason
  const oosLine = (oos && boat.oosReason)
    ? `<div style="font-size:11px;color:var(--red);margin-top:4px">${_besc(boat.oosReason)}</div>` : "";

  // Location shown when available
  const locLine = (status==="avail" && boat.location)
    ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${_besc(boat.location)}</div>` : "";

  // Ownership / charter info
  const priv      = isPrivate(boat);
  const activeRes = getActiveReservation(boat);
  const controlled = isControlledAccess(boat);
  const curUser   = opts.currentUser || null;
  const userCanAccess = curUser ? canAccessBoat(boat, curUser) : true;
  let ownerLine = "";
  if (priv && boat.ownerName) {
    ownerLine = `<div style="font-size:10px;color:var(--accent-fg);margin-top:4px">${_besc(s("fleet.ownedBy",{name:boat.ownerName}))}</div>`;
  }
  let charterLine = "";
  if (activeRes) {
    charterLine = `<div style="font-size:10px;color:var(--accent-fg);margin-top:4px">`
                + `${_besc(s("boat.reservedFor",{name:activeRes.memberName}))} ${_besc(s("boat.reservedUntil",{date:activeRes.endDate}))}`
                + `</div>`;
  }

  // Use registry-based onclick to avoid JSON-in-attribute encoding problems
  const boatId = _besc(boat.id || "");
  const clickAttr = opts.onClickAction
    ? ` style="cursor:pointer" data-boat-action="click" data-boat-fn="${opts.onClickAction}" data-boat-id="${boatId}"`
    : opts.onAvailClick
    ? ` style="cursor:pointer" data-boat-action="avail" data-boat-fn="${opts.onAvailClick}" data-boat-id="${boatId}"`
    : "";

  // Extra badge for access mode / chartered / private boats
  let ownerBadge = "";
  if (controlled && !userCanAccess && !opts.staffView) {
    ownerBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--red);border-color:var(--red)55;background:var(--red)11;margin-left:4px">${_besc(s("fleet.badgeRestricted"))}</span>`;
  } else if (activeRes) {
    ownerBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--accent-fg);border-color:var(--accent)55;background:var(--accent)11;margin-left:4px">${_besc(s("fleet.badgeChartered"))}</span>`;
  } else if (controlled && userCanAccess && !opts.staffView) {
    ownerBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--moss);border-color:color-mix(in srgb, var(--moss) 33%, transparent);background:color-mix(in srgb, var(--moss) 8%, transparent);margin-left:4px">${_besc(s("fleet.badgeAuthorized"))}</span>`;
  } else if (priv) {
    ownerBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--muted);border-color:var(--border);background:var(--surface);margin-left:4px">${_besc(s("fleet.badgePrivate"))}</span>`;
  }

  // Muted card style for restricted boats (controlled access without authorization)
  const isMuted = (!opts.staffView && controlled && !userCanAccess);
  const charteredMuted = isMuted ? "opacity:.55;pointer-events:none;" : "";
  // Left accent always reflects the boat category; oos/restricted cards are
  // muted via opacity (.bc-oos / charteredMuted) rather than a different color.
  const catBorder = `border-left:3px solid ${boatCatColors(cat).color};`;

  return `<div class="bc-card bc-${status}"${clickAttr} style="${charteredMuted}${catBorder}">`
       + `<div style="display:flex;align-items:flex-start;flex-wrap:wrap;gap:4px 8px;margin-bottom:4px">`
       + `<div style="font-size:14px;font-weight:500;color:var(--text)">${emoji} ${name}</div>`
       + `<div style="display:flex;gap:4px;flex-shrink:0;margin-left:auto">${ownerBadge}${bdgHtml}</div>`
       + `</div>`
       + locLine + infoLine + oosLine + ownerLine + charterLine
       + (opts.extraHtml||"")
       + `</div>`;
}

// ── Checkout card (active / out) ───────────────────────────────────────────────
/*
  Standard card for an active checkout.

  Member view  (staffView=false):
    ╔═════════════════════════════════════════╗
    ║  ⛵ Boat Name  [cat]    [YOURS/OUT/OVR]  ║
    ║  Member · Location · Dep 13:00 · Est ·  ║
    ║  [Check In]  [×]                         ║  → only if isMe
    ╚═════════════════════════════════════════╝

  Staff view   (staffView=true):
    ╔═════════════════════════════════════════╗
    ║  ⛵ Boat Name  [cat]    [OVERDUE?]       ║
    ║  Member · Location · Out 13:00 · ↩     ║
    ║  · At launch: Bft 4 · 8m/s SW · < 0.8m║
    ║  [guardian/phone contact row]            ║
    ║  [✓ Check In]          [× Delete]       ║
    ╚═════════════════════════════════════════╝

  opts:
    isMe       bool
    staffView  bool
    onCheckIn  JS string, e.g. "staffCheckIn('id')"
    onDelete   JS string
    onReturn   JS string  (member return flow)
*/
function renderCheckoutCard(co, opts) {
  opts = opts || {};
  const isMe      = !!opts.isMe;
  const staffView = !!opts.staffView;
  const cat       = (co.boatCategory||co.category||"other").toLowerCase();
  const emoji     = boatEmoji(cat);
  const now       = new Date().toTimeString().slice(0,5);
  const retBy     = co.expectedReturn||co.returnBy||"";
  const tout      = sstr(co.checkedOutAt||co.timeOut).slice(0,5);
  const overdue   = co.isOverdue === true || co.isOverdue === 'true' || isCheckoutOverdue(retBy, tout, now);

  // Top badge (member view only — staff don't need it, they see all)
  let topBadge = "";
  if (!staffView) {
    if      (overdue) topBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--red);border-color:var(--red)55;background:var(--red)11">${_besc(s("fleet.badgeOverdue"))}</span>`;
    else if (isMe)    topBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--moss);border-color:color-mix(in srgb, var(--moss) 33%, transparent);background:color-mix(in srgb, var(--moss) 8%, transparent)">${_besc(s("fleet.badgeYours"))}</span>`;
    else              topBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--accent-fg);border-color:var(--accent)55;background:var(--accent)11">${_besc(s("fleet.badgeOut"))}</span>`;
  } else if (overdue) {
    topBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--red);border-color:var(--red)55;background:var(--red)11">⚠️ ${_besc(s("fleet.badgeOverdue"))}</span>`;
  }

  // Sub-line
  const isKeel  = cat === 'keelboat';
  const portInfo = isKeel && co.departurePort ? ` · ⚓️ ${_besc(co.departurePort)}` : '';
  const subLine = `${_besc(co.locationName||"")}${portInfo} · ${_besc(s("fleet.outTime",{t:tout}))}`;

  // Wx snapshot (staff)
  let wxHtml = "";
  if (staffView && co.wxSnapshot) {
    try {
      const w = typeof co.wxSnapshot==="string" ? JSON.parse(co.wxSnapshot) : co.wxSnapshot;
      wxHtml = `<div style="font-size:10px;color:var(--muted);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap">`
             + `· Bft ${w.bft} · ${typeof w.ws==='string'&&w.ws.indexOf('-')!==-1?w.ws.split('-').map(v=>Math.round(v)).join('–'):w.ws} m/s ${w.dir||""}`
             + `${w.wv!=null?" · < "+w.wv+"m":""}`
             + `</div>`;
    } catch(e) {}
  }

  // Contact row (staff only)
  let contactHtml = "";
  if (staffView) {
    const isMinor = co.memberIsMinor===true || co.memberIsMinor==="true";
    if (isMinor && co.guardianName) {
      contactHtml = `<div style="font-size:11px;color:var(--muted);background:var(--card);border:1px solid var(--accent)44;border-radius:6px;padding:7px 10px;margin-top:8px;display:flex;align-items:center;gap:8px">`
                  + `<span>· Minor — guardian: <strong style="color:var(--text)">${_besc(co.guardianName)}</strong></span>`
                  + `${co.guardianPhone?`<a href="tel:${_besc(co.guardianPhone)}" style="color:var(--accent-fg);text-decoration:none">${_besc(co.guardianPhone)}</a>`:""}`
                  + `</div>`;
    } else if (co.memberPhone) {
      contactHtml = `<div style="font-size:11px;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:6px;padding:7px 10px;margin-top:8px;display:flex;align-items:center;gap:8px">`
                  + `<span>=</span><a href="tel:${_besc(co.memberPhone)}" style="color:var(--accent-fg);text-decoration:none">${_besc(co.memberPhone)}</a>`
                  + `</div>`;
    }
  }

  // Action buttons
  let actionsHtml = "";
  if (staffView && (opts.onCheckIn || opts.onDelete)) {
    actionsHtml = `<div style="display:flex;gap:6px;margin-top:10px">`
                + (opts.onCheckIn ? `<button class="btn btn-primary btn-sm" style="flex:1" data-boat-action="check-in" data-boat-fn="${opts.onCheckIn}" data-co-id="${co.id}">✓ ${_besc(s("fleet.checkIn"))}</button>` : "")
                + (opts.onDelete  ? `<button class="btn btn-secondary btn-sm" style="color:var(--muted)" data-boat-action="delete" data-boat-fn="${opts.onDelete}" data-co-id="${co.id}">× ${_besc(s("fleet.delete"))}</button>` : "")
                + `</div>`;
  } else if (!staffView && isMe && (opts.onReturn || opts.onDelete)) {
    actionsHtml = `<div style="display:flex;gap:6px;margin-top:8px">`
                + (opts.onReturn ? `<button class="btn btn-secondary btn-sm" data-boat-action="return" data-boat-fn="${opts.onReturn}" data-co-id="${co.id}">${_besc(s("fleet.checkIn"))}</button>` : "")
                + (opts.onDelete ? `<button class="btn-ghost" style="font-size:10px;padding:4px 6px;color:var(--muted)" title="${_besc(s("fleet.delete"))}" data-boat-action="delete" data-boat-fn="${opts.onDelete}" data-co-id="${co.id}">×</button>` : "")
                + `</div>`;
  }

  // Card border accent — accent color for individual staff checkouts, red for overdue
  const borderStyle = overdue
    ? "border-left:4px solid var(--red)"
    : staffView
    ? "border-left:4px solid var(--accent)"
    : (isMe ? "border-left:4px solid var(--accent)" : "border-left:4px solid var(--border)");

  return `<div class="bc-checkout-card" style="${borderStyle}">`
       + `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px">`
       + `<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">`
       + `<div style="font-size:13px;font-weight:500;color:var(--text)">${emoji} ${_besc(co.boatName||co.boatId||"")} ${boatCatBadge(cat)}</div>`
       + `<div style="font-size:13px;font-weight:500;color:var(--text)">${_besc(co.memberName||"")}</div>`
       + `<div style="font-size:11px;color:var(--muted)">${_besc(s("fleet.aboard",{n:co.crew||1}))}</div>`
       + `</div>`
       + `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0">`
       + (retBy ? `<div style="font-size:13px;font-weight:500;color:${overdue?"var(--red)":"var(--text)"}">↩ ${_besc(retBy)}</div>` : "")
       + (overdue && staffView ? `<div style="font-size:9px;letter-spacing:.6px;color:var(--red)">${_besc(s("fleet.badgeOverdue"))}</div>` : "")
       + `</div>`
       + (!staffView ? topBadge : "")
       + `</div>`
       + `<div style="font-size:11px;color:var(--muted);margin-top:3px">${subLine}</div>`
       + wxHtml + contactHtml + actionsHtml
       + `</div>`;
}

// ── Internal escape helper (not polluting global namespace) ────────────────────
function _besc(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Shared fleet-status renderer ──────────────────────────────────────────────
/*
  renderFleetStatus(containerId, boats, active, opts)

  Renders the unified fleet status section — category bars with expandable
  boat cards underneath. Used on both the staff hub and the member fleet tab.

  opts:
    onAvailClick  string of JS to call with boatId, e.g. "selectBoatForCheckout"
    collapsed     bool — start collapsed (default: true)
    toggleFn      name of the toggle function to call onclick (default: "toggleFleetCat")
*/
function renderFleetStatus(containerId, boats, active, opts) {
  opts = opts || {};
  const el         = document.getElementById(containerId);
  if (!el) return;
  const onAvail    = opts.onAvailClick || null;
  const collapsed  = opts.collapsed !== false;
  const toggleFn   = opts.toggleFn   || 'toggleFleetCat';

  if (!boats || !boats.length) {
    el.innerHTML = '<div class="empty-note"></div>';
    return;
  }

  // Group by category preserving insertion order (or sort alpha)
  const cats = [...new Set(boats.map(b => b.category).filter(Boolean))]
    .sort((a, b) => _boatCatLabel(a.toLowerCase()).localeCompare(_boatCatLabel(b.toLowerCase())));

  const activeByBoat = new Map();
  active.forEach(c => { activeByBoat.set(c.boatId, c); });

  var frag = document.createDocumentFragment();
  cats.forEach(function(cat) {
    var key      = cat.toLowerCase();
    var col      = boatCatColors(key);
    var emoji    = boatEmoji(key);
    var catBoats = boats.filter(function(b) { return (b.category||'').toLowerCase() === key; });
    var isStaffV = !!opts.staffView;
    var fleetUser = opts.currentUser || null;
    var avail    = catBoats.filter(function(b) { return !boolVal(b.oos) && !activeByBoat.has(b.id) && (isStaffV || canAccessBoat(b, fleetUser)); });
    var pct      = catBoats.length ? Math.round(avail.length / catBoats.length * 100) : 0;
    var catId    = containerId + '-fcat-' + encodeURIComponent(key);
    var onClickAct = opts.onClickAction || null;

    // Build boat cards into a fragment
    var gridFrag = document.createDocumentFragment();
    catBoats.forEach(function(b) {
      var co  = activeByBoat.get(b.id);
      var oos = boolVal(b.oos);
      var status = oos ? 'oos' : co ? (co.isOverdue ? 'overdue' : 'out') : 'avail';
      var clickOpts = {};
      if (onClickAct) {
        clickOpts = { onClickAction: onClickAct };
      } else if (status === 'avail' && onAvail && (isStaffV || canAccessBoat(b, fleetUser))) {
        clickOpts = { onAvailClick: onAvail };
      }
      var tmp = document.createElement('div');
      tmp.innerHTML = renderBoatCard(b, Object.assign({ status: status, checkoutData: co, staffView: isStaffV, currentUser: fleetUser }, clickOpts));
      while (tmp.firstChild) gridFrag.appendChild(tmp.firstChild);
    });

    var block = document.createElement('div');
    block.className = 'fleet-status-block';
    block.innerHTML =
      '<div class="fsb-header" data-boat-action="toggle-cat" data-boat-fn="' + toggleFn + '" data-target="' + catId + '" style="border-left:3px solid ' + col.color + '">'
      + '<span class="fsb-emoji">' + emoji + '</span>'
      + '<span class="fsb-label">' + _besc(_boatCatLabel(key)) + '</span>'
      + '<div class="fsb-bar-wrap"><div class="fsb-bar" style="width:' + pct + '%;background:' + col.color + '"></div></div>'
      + '<span class="fsb-count ' + (avail.length ? 'has-avail' : 'none-avail') + '" style="color:' + (avail.length ? col.color : 'var(--muted)') + '">' + avail.length + '/' + catBoats.length + '</span>'
      + '<span class="fsb-arrow">›</span>'
      + '</div>'
      + '<div class="fsb-body" id="' + catId + '" style="display:' + (collapsed ? 'none' : '') + '">'
      + '<div class="fleet-cat-grid"></div>'
      + '</div>';
    block.querySelector('.fleet-cat-grid').appendChild(gridFrag);
    frag.appendChild(block);
  });
  el.innerHTML = '';
  el.appendChild(frag);
}

// (boolVal defined in shared/api.js)

// Delegated click handler for [data-boat-action] elements. Replaces the
// inline onclicks in the boat/checkout/fleet-section templates above so
// strict-script-src CSP pages can use the shared renderer.
//
// Registered in the capture phase so that for button actions nested
// inside a wrapping card that has its own onclick (e.g. staff's
// openCoDetail on the checkout-card root), we can call stopPropagation
// BEFORE the card's bubble-phase handler runs. Without this the card's
// handler fires first — even with its own guard — which is racy.
if (typeof document !== 'undefined' && !document._boatsClickListener) {
  document._boatsClickListener = true;
  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-boat-action]');
    if (!el) return;
    var action = el.dataset.boatAction;
    var fn = el.dataset.boatFn;
    if (!fn || typeof window[fn] !== 'function') return;
    // Button-in-card actions must not bubble to a wrapping card click.
    if (action === 'check-in' || action === 'delete' || action === 'return') {
      e.stopPropagation();
    }
    switch (action) {
      case 'click':
        if (window.boatRegistry && typeof window.boatRegistry.getBoat === 'function') {
          window[fn](window.boatRegistry.getBoat(el.dataset.boatId));
        }
        break;
      case 'avail':
        window[fn](el.dataset.boatId);
        break;
      case 'check-in':
      case 'delete':
      case 'return':
        window[fn](el.dataset.coId);
        break;
      case 'toggle-cat':
        window[fn](el);
        break;
    }
  }, true);
}
