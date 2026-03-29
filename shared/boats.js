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
  if (!c) return key;
  const lang = typeof getLang === 'function' ? getLang() : 'EN';
  return (lang === 'IS' && c.labelIS) ? c.labelIS : (c.labelEN || key);
}

// ── Category meta ──────────────────────────────────────────────────────────────

const BOAT_EMOJI = {
  dinghy:        "⛵",
  keelboat:      "⛵",
  kayak:         "🛶",
  "rowing shell":"🚣",
  rowboat:       "🚣",
  sup:           "🏄",
  wingfoil:      "🪁",
  other:         "🚤",
};

const BOAT_CAT_COLORS = {
  dinghy:        { bg:"#1a4a8a22", color:"#5b9bd5",  border:"#5b9bd544" },
  keelboat:      { bg:"#d4af3718", color:"#d4af37",  border:"#d4af3744" },
  kayak:         { bg:"#8e44ad18", color:"#9b59b6",  border:"#9b59b644" },
  "rowing shell":{ bg:"#0e6b9a18", color:"#3498db",  border:"#3498db44" },
  rowboat:       { bg:"#16a08518", color:"#1abc9c",  border:"#1abc9c44" },
  sup:           { bg:"#e67e2218", color:"#e67e22",  border:"#e67e2244" },
  wingfoil:      { bg:"#c0392b18", color:"#e74c3c",  border:"#e74c3c44" },
  other:         { bg:"#1e3f6e",   color:"#6b92b8",  border:"#2a5490"   },
};

function boatEmoji(cat) {
  return BOAT_EMOJI[(cat||"").toLowerCase()] || "⛵";
}

function boatCatBadge(cat) {
  const key = (cat||"other").toLowerCase();
  const col = BOAT_CAT_COLORS[key] || BOAT_CAT_COLORS.other;
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
    ║  [cat-badge]  location if avail          ║
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
  const accentMap = { out:"var(--brass)", overdue:"var(--red)", oos:"var(--border)", avail:"transparent" };
  const accent    = accentMap[status] || "transparent";

  // Badge
  const badgeMap = {
    avail:   { text:s("fleet.badgeAvail"),   style:"color:#2ecc71;border-color:#2ecc7155;background:#2ecc7111" },
    out:     { text:s("fleet.badgeOut"),      style:"color:var(--brass);border-color:var(--brass)55;background:var(--brass)11" },
    overdue: { text:s("fleet.badgeOverdue"),  style:"color:var(--red);border-color:var(--red)55;background:var(--red)11" },
    oos:     { text:s("fleet.badgeOos"),      style:"color:var(--muted);border-color:var(--border);background:var(--surface)" },
  };
  const badge  = badgeMap[status] || badgeMap.avail;
  const bdgHtml = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;${badge.style}">${badge.text}</span>`;

  // Checkout info line (when out / overdue)
  let infoLine = "";
  if (co && (status==="out"||status==="overdue")) {
    const tout  = (co.checkedOutAt||co.timeOut||"").slice(0,5);
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

  // Use registry-based onclick to avoid JSON-in-attribute encoding problems
  const boatId = _besc(boat.id || "");
  const clickAttr = opts.onClickAction
    ? ` style="cursor:pointer" onclick="${opts.onClickAction}(boatRegistry.getBoat('${boatId}'))"`
    : opts.onClick
    ? ` style="cursor:pointer" onclick="${opts.onClick}"`
    : "";

  return `<div class="bc-card bc-${status}"${clickAttr}>`
       + `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px">`
       + `<div style="font-size:14px;font-weight:500;color:var(--text)">${emoji} ${name}</div>`
       + bdgHtml
       + `</div>`
       + boatCatBadge(cat)
       + locLine + infoLine + oosLine
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
  const overdue   = retBy && retBy < now;
  const tout      = (co.checkedOutAt||co.timeOut||"").slice(0,5);

  // Top badge (member view only — staff don't need it, they see all)
  let topBadge = "";
  if (!staffView) {
    if      (overdue) topBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--red);border-color:var(--red)55;background:var(--red)11">${_besc(s("fleet.badgeOverdue"))}</span>`;
    else if (isMe)    topBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:#2ecc71;border-color:#2ecc7155;background:#2ecc7111">${_besc(s("fleet.badgeYours"))}</span>`;
    else              topBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--brass);border-color:var(--brass)55;background:var(--brass)11">${_besc(s("fleet.badgeOut"))}</span>`;
  } else if (overdue) {
    topBadge = `<span style="font-size:9px;letter-spacing:.8px;padding:2px 7px;border-radius:10px;border:1px solid;color:var(--red);border-color:var(--red)55;background:var(--red)11">⚠ ${_besc(s("fleet.badgeOverdue"))}</span>`;
  }

  // Sub-line
  const isKeel  = cat === 'keelboat';
  const portInfo = isKeel && co.departurePort ? ` · ⚓ ${_besc(co.departurePort)}` : '';
  const subLine = `${_besc(co.locationName||"")}${portInfo} · ${_besc(s("fleet.outTime",{t:tout}))}`;

  // Wx snapshot (staff)
  let wxHtml = "";
  if (staffView && co.wxSnapshot) {
    try {
      const w = typeof co.wxSnapshot==="string" ? JSON.parse(co.wxSnapshot) : co.wxSnapshot;
      wxHtml = `<div style="font-size:10px;color:var(--muted);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap">`
             + `· Bft ${w.bft} · ${w.ws} m/s ${w.dir||""}`
             + `${w.wv!=null?" · < "+w.wv+"m":""}`
             + `</div>`;
    } catch(e) {}
  }

  // Contact row (staff only)
  let contactHtml = "";
  if (staffView) {
    const isMinor = co.memberIsMinor===true || co.memberIsMinor==="true";
    if (isMinor && co.guardianName) {
      contactHtml = `<div style="font-size:11px;color:var(--muted);background:var(--card);border:1px solid var(--brass)44;border-radius:6px;padding:7px 10px;margin-top:8px;display:flex;align-items:center;gap:8px">`
                  + `<span>· Minor — guardian: <strong style="color:var(--text)">${_besc(co.guardianName)}</strong></span>`
                  + `${co.guardianPhone?`<a href="tel:${_besc(co.guardianPhone)}" style="color:var(--brass);text-decoration:none">${_besc(co.guardianPhone)}</a>`:""}`
                  + `</div>`;
    } else if (co.memberPhone) {
      contactHtml = `<div style="font-size:11px;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:6px;padding:7px 10px;margin-top:8px;display:flex;align-items:center;gap:8px">`
                  + `<span>=</span><a href="tel:${_besc(co.memberPhone)}" style="color:var(--brass);text-decoration:none">${_besc(co.memberPhone)}</a>`
                  + `</div>`;
    }
  }

  // Action buttons
  let actionsHtml = "";
  if (staffView && (opts.onCheckIn || opts.onDelete)) {
    actionsHtml = `<div style="display:flex;gap:6px;margin-top:10px">`
                + (opts.onCheckIn ? `<button class="btn btn-primary" style="font-size:11px;flex:1" onclick="${opts.onCheckIn}">✓ ${_besc(s("fleet.checkIn"))}</button>` : "")
                + (opts.onDelete  ? `<button class="btn btn-secondary" style="font-size:11px;padding:6px 12px;color:var(--muted)" onclick="${opts.onDelete}">× ${_besc(s("fleet.delete"))}</button>` : "")
                + `</div>`;
  } else if (!staffView && isMe && (opts.onReturn || opts.onDelete)) {
    actionsHtml = `<div style="display:flex;gap:6px;margin-top:8px">`
                + (opts.onReturn ? `<button class="btn btn-secondary" style="font-size:10px;padding:4px 9px" onclick="${opts.onReturn}">${_besc(s("fleet.checkIn"))}</button>` : "")
                + (opts.onDelete ? `<button class="btn-ghost" style="font-size:10px;padding:4px 6px;color:var(--muted)" title="${_besc(s("fleet.delete"))}" onclick="${opts.onDelete}">×</button>` : "")
                + `</div>`;
  }

  // Card border accent — brass for individual staff checkouts, red for overdue
  const borderStyle = overdue
    ? "border-left:4px solid var(--red)"
    : staffView
    ? "border-left:4px solid var(--brass)"
    : (isMe ? "border-left:4px solid var(--brass)" : "border-left:4px solid var(--border)");

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
  const cats = [...new Set(boats.map(b => b.category).filter(Boolean))].sort();

  const activeByBoat = new Map();
  active.forEach(c => { activeByBoat.set(c.boatId, c); });

  el.innerHTML = cats.map(cat => {
    const key      = cat.toLowerCase();
    const col      = BOAT_CAT_COLORS[key] || BOAT_CAT_COLORS.other;
    const emoji    = boatEmoji(key);
    const catBoats = boats.filter(b => (b.category||'').toLowerCase() === key);
    const avail    = catBoats.filter(b => !boolVal(b.oos) && !activeByBoat.has(b.id));
    const pct      = catBoats.length ? Math.round(avail.length / catBoats.length * 100) : 0;
    const catId    = containerId + '-fcat-' + encodeURIComponent(key);

    const cards = catBoats.map(b => {
      const co  = activeByBoat.get(b.id);
      const oos = boolVal(b.oos);
      const status = oos ? 'oos' : co ? (co.isOverdue ? 'overdue' : 'out') : 'avail';
      const clickOpts = (status === 'avail' && onAvail)
        ? { onClick: onAvail + "('${b.id}')".replace('${b.id}', _besc(b.id)) }
        : {};
      return renderBoatCard(b, Object.assign({ status, checkoutData: co }, clickOpts));
    }).join('');

    return `<div class="fleet-status-block">
      <div class="fsb-header" onclick="${toggleFn}(this)" data-target="${catId}" style="border-left:3px solid ${col.color}">
        <span class="fsb-emoji">${emoji}</span>
        <span class="fsb-label">${_besc(_boatCatLabel(cat.toLowerCase()))}</span>
        <div class="fsb-bar-wrap"><div class="fsb-bar" style="width:${pct}%;background:${col.color}"></div></div>
        <span class="fsb-count ${avail.length?'has-avail':'none-avail'}" style="color:${avail.length?col.color:'var(--muted)'}">${avail.length}/${catBoats.length}</span>
        <span class="fsb-arrow">›</span>
      </div>
      <div class="fsb-body" id="${catId}" style="display:${collapsed?'none':''}">
        <div class="fleet-cat-grid">${cards}</div>
      </div>
    </div>`;
  }).join('');
}

// (boolVal defined in shared/api.js)
