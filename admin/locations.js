// ═══════════════════════════════════════════════════════════════════════════════
// admin/locations.js — Locations tab
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

function renderLocations() {
  const card   = document.getElementById("locationsCard");
  const locale = getLang() === 'IS' ? 'is' : 'en';
  const active = locations
    .filter(l => bool(l.active))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', locale, { sensitivity: 'base' }));
  if (!active.length) { card.innerHTML = `<div class="empty-state">${s('admin.noLocations')}</div>`; return; }
  card.innerHTML = active.map(l => `
    <div class="list-row">
      <span class="list-name">${esc(l.name)}${l.type==='port' ? ' <span style="font-size:9px;color:var(--accent-fg);border:1px solid var(--accent)44;border-radius:4px;padding:1px 5px;margin-left:4px">⚓️ PORT</span>' : ' <span style="font-size:9px;color:var(--ice);border:1px solid var(--ice)44;border-radius:4px;padding:1px 5px;margin-left:4px">⛵ SAILING AREA</span>'}</span>
      <button class="row-edit" data-admin-click="openLocationModal" data-admin-arg="${l.id}">Edit</button>
      <button class="row-del"  data-admin-click="deleteLocation" data-admin-arg="${l.id}">×</button>
    </div>`).join("");
}

function openLocationModal(id) {
  editingId = id || null;
  const l   = id ? _allLocations.find(x => x.id === id) : null;
  document.getElementById("locationModalTitle").textContent = l ? s('admin.locModal.edit') : s('admin.locModal.add');
  document.getElementById("lName").value     = l ? l.name              : "";
  document.getElementById("lType").value     = l ? (l.type || 'location') : 'location';
  var coords = (l && l.coordinates) ? l.coordinates.split(",") : [null, null];
  document.getElementById("lLat").value      = coords[0] || "";
  document.getElementById("lLng").value      = coords[1] || "";
  document.getElementById("lActive").checked = l ? bool(l.active)      : true;
  document.getElementById("lDeleteBtn").classList.toggle("hidden", !l);
  applyStrings(document.getElementById("locationModal"));
  openModal("locationModal");
}

async function saveLocation() {
  const name = document.getElementById("lName").value.trim();
  if (!name) { toast(s("admin.nameRequired"), "err"); return; }

  const id      = editingId || ("loc_" + Date.now().toString(36));
  var latVal = document.getElementById("lLat").value.trim();
  var lngVal = document.getElementById("lLng").value.trim();
  var coordinates = (latVal && lngVal) ? latVal + "," + lngVal : "";
  const payload = { id, name, type: document.getElementById("lType").value || 'location', active: document.getElementById("lActive").checked, coordinates: coordinates };

  const idx = _allLocations.findIndex(x => x.id === id);
  if (idx >= 0) _allLocations[idx] = { ..._allLocations[idx], ...payload };
  else          _allLocations.push(payload);

  try {
    await apiPost("saveConfig", { locations: _allLocations });
    locations = _allLocations.filter(l => l.active !== false && l.active !== 'false');
    closeModal("locationModal", true);
    renderLocations();
    toast(s("toast.saved"));
  } catch(e) { toast(s("toast.saveFailed") + ": " + e.message, "err"); }
}

async function deleteLocation(id) {
  const _id = id || editingId;
  if (!await ymConfirm(s("admin.confirmDeleteLocation"))) return;
  _allLocations = _allLocations.map(l => l.id === _id ? { ...l, active: false } : l);
  try {
    await apiPost("saveConfig", { locations: _allLocations });
    locations = _allLocations.filter(l => l.active !== false && l.active !== 'false');
    renderLocations();
    closeModal("locationModal", true);
    toast(s("toast.deleted"));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

// ══ OPENING / CLOSING CHECKLISTS ═════════════════════════════════════════════
// Items stored in dailyChecklist.opening[] and dailyChecklist.closing[] in config.
// Phase field on each item is "opening" or "closing".

