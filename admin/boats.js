// ═══════════════════════════════════════════════════════════════════════════════
// admin/boats.js — Boat categories, boat modal, ownership, allowlist, reservations
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

function openBoatCatModal(key) {
  _bcEditingId = key || null;
  const c = key ? _allBoatCats.find(x => x.key === key) : null;
  document.getElementById("boatCatModalTitle").textContent = c ? s('admin.boatCatModal.edit') : s('admin.boatCatModal.add');
  document.getElementById("bcLabelEN").value   = c ? (c.labelEN || "") : "";
  document.getElementById("bcLabelIS").value   = c ? (c.labelIS || "") : "";
  document.getElementById("bcEmoji").value     = c ? (c.emoji   || "") : "";
  document.getElementById("bcKey").value       = c ? c.key : "";
  document.getElementById("bcKey").readOnly    = !!c;  // key immutable after creation
  document.getElementById("bcActive").checked  = c ? bool(c.active) : true;
  // Color: use saved override if valid, else fall back to the resolved color
  // (built-in default for known keys, or "other" color for custom keys).
  const rawColor = c && typeof c.color === 'string' ? c.color.trim() : '';
  const color = /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : boatCatDefaultColor(c ? c.key : 'other');
  document.getElementById("bcColor").value = color;
  updateBoatCatColorPreview();
  if (typeof renderColorSwatches === 'function') renderColorSwatches('bcColor', 'bcColorSwatches');
  document.getElementById("bcDeleteBtn").classList.toggle("hidden", !c);
  openModal("boatCatModal");
}

function updateBoatCatColorPreview() {
  const hex = document.getElementById("bcColor").value;
  const preview = document.getElementById("bcColorPreview");
  if (!preview) return;
  const label = document.getElementById("bcLabelEN").value.trim() || s('admin.boatCatModal.colorPreviewLabel');
  const border = hex + '44';
  const bg     = hex + '18';
  preview.innerHTML = `<span style="font-size:10px;font-weight:600;letter-spacing:.5px;padding:2px 7px;border-radius:10px;`
    + `border:1px solid ${border};background:${bg};color:${hex};display:inline-block">${esc(label)}</span>`;
}

function resetBoatCatColor() {
  const key = document.getElementById("bcKey").value.trim().toLowerCase();
  document.getElementById("bcColor").value = boatCatDefaultColor(key);
  updateBoatCatColorPreview();
}

async function saveBoatCat() {
  const labelEN = document.getElementById("bcLabelEN").value.trim();
  const key     = document.getElementById("bcKey").value.trim().toLowerCase().replace(/\s+/g,'-');
  if (!labelEN || !key) { toast(s("admin.nameKeyRequired"), "err"); return; }

  const rawColor = document.getElementById("bcColor").value.trim();
  const payload = {
    key,
    labelEN,
    labelIS:  document.getElementById("bcLabelIS").value.trim(),
    emoji:    document.getElementById("bcEmoji").value.trim(),
    color:    /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor.toLowerCase() : '',
    active:   document.getElementById("bcActive").checked,
  };

  const idx = _allBoatCats.findIndex(x => x.key === key);
  if (idx >= 0) _allBoatCats[idx] = { ..._allBoatCats[idx], ...payload };
  else          _allBoatCats.push(payload);

  try {
    await apiPost("saveConfig", { boatCategories: _allBoatCats });
    boatCats = _allBoatCats.filter(c => c.active !== false && c.active !== 'false');
    registerBoatCats(boatCats);
    closeModal("boatCatModal", true);
    renderBoats();
    populateCategorySelects();
    toast(s("toast.saved"));
  } catch(e) { toast(s("toast.saveFailed") + ": " + e.message, "err"); }
}

async function deleteBoatCat() {
  const key = _bcEditingId;
  if (!key || !await ymConfirm(s("admin.confirmRemoveBoatCat"))) return;
  _allBoatCats = _allBoatCats.map(c => c.key === key ? { ...c, active: false } : c);
  try {
    await apiPost("saveConfig", { boatCategories: _allBoatCats });
    boatCats = _allBoatCats.filter(c => c.active !== false && c.active !== 'false');
    registerBoatCats(boatCats);
    closeModal("boatCatModal", true);
    renderBoats();
    populateCategorySelects();
    toast(s("toast.deleted"));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

// ══ BOATS ═════════════════════════════════════════════════════════════════════

function renderBoats() {
  const el     = document.getElementById("boatSections");
  const active = boats.filter(b => bool(b.active));
  if (!active.length) { el.innerHTML = `<div class="empty-state">${s('admin.noBoats')}</div>`; return; }

  const groups = {};
  boatCats.forEach(c => { groups[c.key] = []; });
  groups['other'] = groups['other'] || [];
  active.forEach(b => {
    const k = (b.category || 'other').toLowerCase();
    if (groups[k]) groups[k].push(b); else groups['other'].push(b);
  });

  const L      = getLang();
  const locale = L === 'IS' ? 'is' : 'en';
  const sortedCats = boatCats.slice().sort((a, b) => {
    const la = (L === 'IS' && a.labelIS ? a.labelIS : a.labelEN) || '';
    const lb = (L === 'IS' && b.labelIS ? b.labelIS : b.labelEN) || '';
    return la.localeCompare(lb, locale, { sensitivity: 'base' });
  });
  el.innerHTML = sortedCats
    .map(cat => {
      const col = (typeof boatCatColors === 'function') ? boatCatColors(cat.key) : null;
      const cardStyle = col ? `background:${col.bg};border-color:${col.border}` : '';
      const cards = (groups[cat.key] || []).map(b => `
        <div class="boat-card${bool(b.oos) ? " oos" : ""}" style="${cardStyle}">
          <div class="boat-card-head">
            <div class="boat-card-name">${cat.emoji || boatEmoji(cat.key)} ${esc(b.name)}</div>
            <div class="boat-card-badges">
              ${b.accessMode === 'controlled' ? `<span class="boat-card-badge boat-card-badge-controlled">${esc(s('fleet.badgeControlled'))}</span>` : ""}
              ${bool(b.oos) ? `<span class="oos-badge">OOS</span>` : ""}
            </div>
          </div>
          ${b.oosReason ? `<div class="boat-card-meta">${esc(b.oosReason)}</div>` : ""}
          ${(b.registrationNo || b.typeModel) ? `<div class="boat-card-meta">${[b.registrationNo, b.typeModel].filter(Boolean).map(esc).join(' · ')}</div>` : ""}
          <div class="boat-card-actions">
            <button class="row-edit flex-1" data-admin-click="openBoatModal" data-admin-arg="${b.id}">Edit</button>
            <button class="row-edit icon-btn" data-admin-click="showBoatQR" data-admin-arg="${b.id}" title="Show QR code" aria-label="Show QR code">${icon('qr-code')}</button>
            <button class="row-del"  data-admin-click="deleteBoat" data-admin-arg="${b.id}" title="Delete">×</button>
          </div>
        </div>`).join("");

      return `<div class="col-section">
        <div class="col-head" data-admin-toggle-section>
          <div class="col-title">${cat.emoji || boatEmoji(cat.key)} ${boatCatBadge(cat.key)}</div>
          <div class="col-head-actions">
            <span class="col-head-btns" data-admin-nobubble>
              <button class="row-edit" data-admin-click="openBoatModalForCat" data-admin-arg="${cat.key}">+ Add boat</button>
              <button class="row-edit" data-admin-click="openBoatCatModal" data-admin-arg="${cat.key}">Edit</button>
            </span>
            <span class="col-toggle">▼</span>
          </div>
        </div>
        <div class="col-body hidden">
          <div class="boat-grid">${cards}</div>
        </div>
      </div>`;
    }).join("");
}
  
function openBoatModalForCat(catKey) {
  openBoatModal();
  const sel = document.getElementById('bCategory');
  if (sel) sel.value = catKey;
}
  
function populateDefaultPortSelect(selectedId) {
  const sel = document.getElementById("bDefaultPortId");
  if (!sel) return;
  const ports = _allLocations.filter(l => l.type === 'port' && (l.active !== false && l.active !== 'false'));
  sel.innerHTML = `<option value="">${s('admin.optionNone')}</option>` +
    ports.map(p => `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
}

function updateBoatModalFields() {
  const cat = document.getElementById("bCategory").value;
  const isKeelboat = cat === 'keelboat';
  const lbl = document.getElementById("bRegNoLabel");
  const inp = document.getElementById("bRegNo");
  lbl.setAttribute("data-s", isKeelboat ? "boat.registrationNo" : "boat.sailNo");
  lbl.textContent = s(isKeelboat ? 'boat.registrationNo' : 'boat.sailNo');
  inp.placeholder = isKeelboat ? "e.g. ÍS-342" : "e.g. 1234";
}

function openBoatModal(id) {
  editingId = id || null;
  const b   = id ? _allBoats.find(x => x.id === id) : null;
  document.getElementById("boatModalTitle").textContent = b ? s('admin.boatModal.edit') : s('admin.boatModal.add');
  populateCategorySelects();  // ensure select is fresh
  document.getElementById("bName").value      = b ? b.name                     : "";
  document.getElementById("bCategory").value  = b ? (b.category || boatCats[0]?.key || "dinghy") : (boatCats[0]?.key || "dinghy");
  document.getElementById("bOOS").checked     = b ? bool(b.oos)                : false;
  document.getElementById("bOOSReason").value = b ? (b.oosReason || "")       : "";
  document.getElementById("oosReasonField").classList.toggle("hidden", !b || !bool(b.oos));
  document.getElementById("bActive").checked  = b ? bool(b.active)            : true;
  document.getElementById("bDeleteBtn").classList.toggle("hidden", !b);
  // Keelboat-only fields
  document.getElementById("bRegNo").value      = b ? (b.registrationNo || "") : "";
  document.getElementById("bLoa").value        = b ? (b.loa || "")            : "";
  document.getElementById("bTypeModel").value  = b ? (b.typeModel || "")      : "";
  populateDefaultPortSelect(b ? (b.defaultPortId || "") : "");
  // Ownership
  document.getElementById("bOwnership").value = b && b.ownership === 'private' ? 'private' : 'club';
  document.getElementById("bOwnerId").value   = b ? (b.ownerId || '') : '';
  document.getElementById("bOwnerSearch").value = '';
  document.getElementById("bOwnerName").textContent = b && b.ownerName ? b.ownerName : '';
  document.getElementById("bOwnerSuggestions").innerHTML = '';
  // Access mode
  document.getElementById("bAccessMode").value = b && b.accessMode === 'controlled' ? 'controlled' : 'free';
  populateGateCertSelect(_currentGateFor(b));
  _editAllowlist = b && Array.isArray(b.accessAllowlist) ? b.accessAllowlist.slice() : [];
  renderAllowlistChips();
  updateAccessFields();
  // Slot scheduling
  document.getElementById("bSlotScheduling").checked = b && boolVal(b.slotSchedulingEnabled);
  document.getElementById("bAvailOutside").checked = b ? (b.availableOutsideSlots === undefined || b.availableOutsideSlots === null || boolVal(b.availableOutsideSlots)) : true;
  updateSlotFields();
  // Reservations
  document.getElementById("bReservationForm").classList.add("hidden");
  document.getElementById("bResMemberKt").value = '';
  document.getElementById("bResMemberSearch").value = '';
  document.getElementById("bResMemberName").textContent = '';
  document.getElementById("bResStart").value = '';
  document.getElementById("bResEnd").value = '';
  document.getElementById("bResNote").value = '';
  renderReservationList(b);
  updateOwnershipFields();
  updateBoatModalFields();
  applyStrings(document.getElementById("boatModal"));
  openModal("boatModal");
}

// ── Ownership helpers ──────────────────────────────────────────────────────────
function updateOwnershipFields() {
  const isPrivate = document.getElementById("bOwnership").value === 'private';
  document.getElementById("bOwnerField").classList.toggle("hidden", !isPrivate);
}

function searchBoatOwner(q) {
  const drop = document.getElementById("bOwnerSuggestions");
  if (!q || q.length < 2) { drop.innerHTML=''; drop.style.display='none'; return; }
  const ql = q.toLowerCase();
  const hits = members.filter(m => (m.name||'').toLowerCase().includes(ql)).slice(0, 8);
  if (!hits.length) { drop.innerHTML=''; drop.style.display='none'; return; }
  drop.innerHTML = hits.map(m => `<div class="suggest-item" style="padding:6px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)"
    data-admin-click="selectBoatOwner" data-admin-arg="${esc(m.kennitala)}" data-admin-arg2="${esc(memberDisplayName(m, members))}">${esc(memberDisplayName(m, members))}</div>`).join('');
  drop.style.display = 'block';
}

function selectBoatOwner(kt, name) {
  document.getElementById("bOwnerId").value = kt;
  document.getElementById("bOwnerSearch").value = '';
  document.getElementById("bOwnerName").textContent = name;
  document.getElementById("bOwnerSuggestions").innerHTML = '';
  document.getElementById("bOwnerSuggestions").style.display = 'none';
}

// ── Access control helpers ────────────────────────────────────────────────────
var _editAllowlist = [];

function updateAccessFields() {
  var isControlled = document.getElementById("bAccessMode").value === 'controlled';
  document.getElementById("bAccessControlledSection").classList.toggle("hidden", !isControlled);
  document.getElementById("bSlotSchedulingSection").classList.toggle("hidden", !isControlled);
}

function updateSlotFields() {
  var enabled = document.getElementById("bSlotScheduling").checked;
  document.getElementById("bSlotOptions").classList.toggle("hidden", !enabled);
}

// Encode a gate descriptor as a stable option value. Empty fields are omitted
// and the result is a compact JSON string. Decoded by _decodeGateValue().
function _encodeGateValue(gate) {
  if (!gate || !gate.certId) return '';
  var out = { certId: gate.certId };
  if (gate.sub) out.sub = gate.sub;
  if (gate.minRank) out.minRank = Number(gate.minRank);
  return JSON.stringify(out);
}
function _decodeGateValue(v) {
  if (!v) return null;
  try { var o = JSON.parse(v); return (o && o.certId) ? o : null; } catch (e) { return null; }
}
// Return the stored gate for a boat as a {certId, sub, minRank} object, or
// null. Uses normalizeAccessGate (from shared/boats.js) so legacy boats with
// just accessGateCert still resolve to the correct {certId, sub} pair.
function _currentGateFor(boat) {
  if (!boat) return null;
  if (typeof normalizeAccessGate === 'function') {
    return normalizeAccessGate(boat, certDefs);
  }
  // Defensive fallback — should not trigger in practice.
  if (boat.accessGate && boat.accessGate.certId) return boat.accessGate;
  return null;
}

function populateGateCertSelect(currentGate) {
  var sel = document.getElementById("bGateCert");
  sel.innerHTML = '<option value="">' + esc(s('boat.gateCertNone')) + '</option>';
  var selectedVal = _encodeGateValue(currentGate);
  // Build options: one entry per credential "grade".
  //   Flat defs (no subcats) → a single def-level entry.
  //   Defs with subcats → a def-level "(any level)" entry, one exact-match
  //     entry per subcat, plus a "… or higher" entry for each ranked subcat.
  var anyLbl   = s('boat.gateCertAny');
  var orHigher = s('boat.gateCertOrHigher');
  (certDefs || []).forEach(function(def) {
    if (!def || !def.id) return;
    var defName = certDefName(def);
    var subs    = Array.isArray(def.subcats) ? def.subcats : [];
    if (!subs.length) {
      var v0 = _encodeGateValue({ certId: def.id });
      sel.innerHTML += '<option value="' + esc(v0) + '"' + (v0 === selectedVal ? ' selected' : '') + '>'
        + esc(defName) + '</option>';
      return;
    }
    // def-level "(any level)" option
    var vAny = _encodeGateValue({ certId: def.id });
    sel.innerHTML += '<option value="' + esc(vAny) + '"' + (vAny === selectedVal ? ' selected' : '') + '>'
      + esc(defName + ' — ' + anyLbl) + '</option>';
    // exact-match subcat options
    subs.forEach(function(sc) {
      if (!sc || !sc.key) return;
      var vExact = _encodeGateValue({ certId: def.id, sub: sc.key });
      sel.innerHTML += '<option value="' + esc(vExact) + '"' + (vExact === selectedVal ? ' selected' : '') + '>'
        + esc(defName + ' — ' + certSubcatLabel(sc)) + '</option>';
    });
    // rank-or-higher options (only for subcats with a numeric rank)
    subs.forEach(function(sc) {
      if (!sc || !sc.key || !sc.rank) return;
      var vRank = _encodeGateValue({ certId: def.id, minRank: Number(sc.rank) });
      sel.innerHTML += '<option value="' + esc(vRank) + '"' + (vRank === selectedVal ? ' selected' : '') + '>'
        + esc(defName + ' — ' + certSubcatLabel(sc) + ' ' + orHigher) + '</option>';
    });
  });
}

function renderAllowlistChips() {
  var el = document.getElementById("bAllowlistChips");
  if (!_editAllowlist.length) { el.innerHTML = ''; return; }
  el.innerHTML = _editAllowlist.map(function(kt) {
    var m = members.find(function(x) { return x.kennitala === kt; });
    var name = m ? memberDisplayName(m, members) : kt;
    return '<span style="font-size:10px;padding:3px 8px;border-radius:12px;background:var(--surface);border:1px solid var(--border);color:var(--text);display:inline-flex;align-items:center;gap:4px">'
      + esc(name)
      + '<span style="cursor:pointer;color:var(--red);font-size:12px" data-admin-click="removeFromAllowlist" data-admin-arg="'+esc(kt)+'">&times;</span>'
      + '</span>';
  }).join('');
}

function searchAllowlistMember(q) {
  var drop = document.getElementById("bAllowlistSuggestions");
  if (!q || q.length < 2) { drop.innerHTML=''; drop.style.display='none'; return; }
  var ql = q.toLowerCase();
  var hits = members.filter(function(m) { return (m.name||'').toLowerCase().includes(ql) && _editAllowlist.indexOf(m.kennitala) === -1; }).slice(0, 8);
  if (!hits.length) { drop.innerHTML=''; drop.style.display='none'; return; }
  drop.innerHTML = hits.map(function(m) {
    return '<div class="suggest-item" style="padding:6px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)" '
      + 'data-admin-click="addToAllowlist" data-admin-arg="'+esc(m.kennitala)+'">' + esc(memberDisplayName(m, members)) + '</div>';
  }).join('');
  drop.style.display = 'block';
}

function addToAllowlist(kt) {
  if (_editAllowlist.indexOf(kt) === -1) _editAllowlist.push(kt);
  document.getElementById("bAllowlistSearch").value = '';
  document.getElementById("bAllowlistSuggestions").innerHTML = '';
  document.getElementById("bAllowlistSuggestions").style.display = 'none';
  renderAllowlistChips();
}

function removeFromAllowlist(kt) {
  _editAllowlist = _editAllowlist.filter(function(k) { return k !== kt; });
  renderAllowlistChips();
}

// ── Reservation helpers ───────────────────────────────────────────────────────
function renderReservationList(boat) {
  var el = document.getElementById("bReservationList");
  var actEl = document.getElementById("bReservationActions");
  if (!boat || !boat.reservations || !boat.reservations.length) {
    el.innerHTML = '';
    actEl.innerHTML = '<button class="btn btn-secondary btn-sm" data-admin-click="showResForm">' + esc(s('boat.addReservation')) + '</button>';
    return;
  }
  el.innerHTML = boat.reservations.map(function(r) {
    return '<div style="font-size:11px;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">'
      + '<div><strong>' + esc(r.memberName) + '</strong> · ' + esc(r.startDate) + ' → ' + esc(r.endDate)
      + (r.note ? ' · <span style="color:var(--muted)">' + esc(r.note) + '</span>' : '') + '</div>'
      + '<button style="font-size:10px;background:none;border:none;color:var(--red);cursor:pointer" data-admin-click="removeResFromModal" data-admin-arg="'+esc(r.id)+'">&times;</button>'
      + '</div>';
  }).join('');
  actEl.innerHTML = '<button class="btn btn-secondary btn-sm" data-admin-click="showResForm">' + esc(s('boat.addReservation')) + '</button>';
}

function showResForm() {
  document.getElementById("bReservationForm").classList.remove("hidden");
}

function cancelResForm() {
  document.getElementById("bReservationForm").classList.add("hidden");
}

function searchResMember(q) {
  var drop = document.getElementById("bResMemberSuggestions");
  if (!q || q.length < 2) { drop.innerHTML=''; drop.style.display='none'; return; }
  var ql = q.toLowerCase();
  var hits = members.filter(function(m) { return (m.name||'').toLowerCase().includes(ql); }).slice(0, 8);
  if (!hits.length) { drop.innerHTML=''; drop.style.display='none'; return; }
  drop.innerHTML = hits.map(function(m) {
    return '<div class="suggest-item" style="padding:6px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)" '
      + 'data-admin-click="selectResMember" data-admin-arg="'+esc(m.kennitala)+'" data-admin-arg2="'+esc(memberDisplayName(m, members))+'">' + esc(memberDisplayName(m, members)) + '</div>';
  }).join('');
  drop.style.display = 'block';
}

function selectResMember(kt, name) {
  document.getElementById("bResMemberKt").value = kt;
  document.getElementById("bResMemberSearch").value = '';
  document.getElementById("bResMemberName").textContent = name;
  document.getElementById("bResMemberSuggestions").innerHTML = '';
  document.getElementById("bResMemberSuggestions").style.display = 'none';
}

async function saveResFromModal() {
  var boatId = editingId;
  if (!boatId) return;
  var kt   = document.getElementById("bResMemberKt").value;
  var name = document.getElementById("bResMemberName").textContent;
  var start = document.getElementById("bResStart").value;
  var end   = document.getElementById("bResEnd").value;
  var note  = document.getElementById("bResNote").value.trim();
  if (!kt || !name || !start || !end) { toast(s("admin.memberDatesRequired"), "err"); return; }
  try {
    var res = await apiPost('saveReservation', { boatId: boatId, memberKennitala: kt, memberName: name, startDate: start, endDate: end, note: note });
    var b = _allBoats.find(function(x) { return x.id === boatId; });
    if (b && res.boat) { b.reservations = res.boat.reservations; }
    // Clear sub-form fields so the boat modal's dirty check doesn't flag
    // the stale reservation inputs after a successful save.
    document.getElementById("bResMemberKt").value = '';
    document.getElementById("bResMemberSearch").value = '';
    document.getElementById("bResMemberName").textContent = '';
    document.getElementById("bResStart").value = '';
    document.getElementById("bResEnd").value = '';
    document.getElementById("bResNote").value = '';
    cancelResForm();
    renderReservationList(b);
    if (typeof resnapshotModal === 'function') resnapshotModal('boatModal');
    toast(s('boat.reservationSaved'));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

async function removeResFromModal(resId) {
  var boatId = editingId;
  if (!boatId) return;
  if (!(await ymConfirm(s('boat.removeReservation') + '?'))) return;
  try {
    var res = await apiPost('removeReservation', { boatId: boatId, reservationId: resId });
    var b = _allBoats.find(function(x) { return x.id === boatId; });
    if (b && res.boat) { b.reservations = res.boat.reservations; }
    renderReservationList(b);
    toast(s('boat.reservationRemoved'));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

async function saveBoat() {
  const name = document.getElementById("bName").value.trim();
  if (!name) { toast(s("admin.nameRequired"), "err"); return; }

  const id  = editingId || ("boat_" + Date.now().toString(36));
  const cat = document.getElementById("bCategory").value;
  const ownershipVal = document.getElementById("bOwnership").value;
  const accessModeVal = document.getElementById("bAccessMode").value;
  const payload = {
    id, name,
    category:      cat,
    defaultPortId: document.getElementById("bDefaultPortId").value || "",
    oos:           document.getElementById("bOOS").checked,
    oosReason:     document.getElementById("bOOSReason").value.trim(),
    active:        document.getElementById("bActive").checked,
    registrationNo: document.getElementById("bRegNo").value.trim(),
    // all boats
    typeModel:      document.getElementById("bTypeModel").value.trim(),
    loa:            parseFloat(document.getElementById("bLoa").value) || '',
    // ownership
    ownership:      ownershipVal,
    ownerId:        ownershipVal === 'private' ? (document.getElementById("bOwnerId").value || '') : '',
    ownerName:      ownershipVal === 'private' ? (document.getElementById("bOwnerName").textContent || '') : '',
    // access control — new structured gate, plus legacy mirror for older readers
    accessMode:     accessModeVal,
    accessGate:     accessModeVal === 'controlled' ? _decodeGateValue(document.getElementById("bGateCert").value) : null,
    accessGateCert: accessModeVal === 'controlled' ? (function() {
      var _g = _decodeGateValue(document.getElementById("bGateCert").value);
      return _g ? (_g.sub || _g.certId) : '';
    })() : '',
    accessAllowlist: accessModeVal === 'controlled' ? _editAllowlist.slice() : [],
    // slot scheduling
    slotSchedulingEnabled: accessModeVal === 'controlled' && document.getElementById("bSlotScheduling").checked,
    availableOutsideSlots: accessModeVal === 'controlled' && document.getElementById("bSlotScheduling").checked ? document.getElementById("bAvailOutside").checked : true,
  };

  const idx = _allBoats.findIndex(x => x.id === id);
  if (idx >= 0) {
    // Preserve reservations (managed via separate endpoints)
    payload.reservations = _allBoats[idx].reservations || [];
    _allBoats[idx] = { ..._allBoats[idx], ...payload };
  } else {
    payload.reservations = [];
    _allBoats.push(payload);
  }

  try {
    await apiPost("saveConfig", { boats: _allBoats });
    boats = _allBoats.filter(b => b.active !== false && b.active !== 'false');
    closeModal("boatModal", true);
    renderBoats();
    toast(s("toast.saved"));
  } catch(e) { toast(s("toast.saveFailed") + ": " + e.message, "err"); }
}

async function deleteBoat(id) {
  const _id = id || editingId;
  if (!await ymConfirm(s("admin.confirmDeleteBoat"))) return;
  _allBoats = _allBoats.map(b => b.id === _id ? { ...b, active: false } : b);
  try {
    await apiPost("saveConfig", { boats: _allBoats });
    boats = _allBoats.filter(b => b.active !== false && b.active !== 'false');
    renderBoats();
    closeModal("boatModal", true);
    toast(s("toast.deleted"));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

function showBoatQR(id) {
  const b = boats.find(x => x.id === id);
  if (!b) return;
  const url = `${BASE_URL}/member/?boat=${id}`;
  document.getElementById("qrBoatName").textContent = b.name;
  document.getElementById("qrCategory").textContent = b.category || "";
  document.getElementById("qrUrl").textContent = url;
  document.getElementById("qrBoatId").textContent = id;
  document.getElementById("qrImg").src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
  openModal("qrModal");
}

function printQR() {
  const img = document.getElementById("qrImg").src;
  const name = document.getElementById("qrBoatName").textContent;
  const w = window.open("", "_blank");
  w.document.write(`<html><body style="text-align:center;font-family:monospace;padding:20px">
    <h2>${name}</h2><img src="${img}" style="width:200px"><br>
    <small>${document.getElementById("qrUrl").textContent}</small>
    <script>window.print();window.close();<\/script></body></html>`);
}

// ══ LOCATIONS ════════════════════════════════════════════════════════════════

