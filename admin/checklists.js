// ═══════════════════════════════════════════════════════════════════════════════
// admin/checklists.js — Daily checklists + pre-launch/landing checklists
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

function renderChecklists() {
  renderCLPhase("openingCLCard", "opening");
  renderCLPhase("closingCLCard", "closing");
}

function renderCLPhase(cardId, phase) {
  const card  = document.getElementById(cardId);
  const items = clItems
    .filter(i => String(i.phase).toLowerCase() === phase && bool(i.active))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  if (!items.length) { card.innerHTML = `<div class="empty-state">${s('admin.noItems')}</div>`; return; }
  const btnId = 'clUpdateOrder_' + phase;
  card.innerHTML = items.map(i => `
    <div class="cl-row">
      <input type="number" class="cl-sort-input" data-cl-id="${i.id}" data-cl-phase="${phase}"
        value="${i.sortOrder || 99}" min="0" data-admin-show-el="${btnId}">
      <span style="flex:1;color:var(--text)">${esc(i.textEN || "")}${i.textIS
        ? `<span style="color:var(--muted);font-size:11px;margin-left:6px">${esc(i.textIS)}</span>` : ""}</span>
      <button class="row-edit" data-admin-click="openCLModal" data-admin-arg="${i.id}">Edit</button>
      <button class="row-del"  data-admin-click="deleteCLItem" data-admin-arg="${i.id}">×</button>
    </div>`).join("") +
    `<button id="${btnId}" class="btn btn-primary cl-update-order hidden" data-admin-click="updateCLOrder" data-admin-arg="${phase}">Update Order</button>`;
}

function openCLModal(id) {
  editingId    = id || null;
  const item   = id ? clItems.find(x => x.id === id) : null;
  document.getElementById("clModalTitle").textContent = item ? s('admin.clModal.edit') : s('admin.clModal.add');
  document.getElementById("clPhase").value    = item ? (item.phase || 'opening') : "opening";
  document.getElementById("clTextEN").value   = item ? (item.textEN  || "") : "";
  document.getElementById("clTextIS").value   = item ? (item.textIS  || "") : "";
  document.getElementById("clSort").value     = item ? (item.sortOrder || 99) : 99;
  document.getElementById("clActive").checked = item ? bool(item.active) : true;
  document.getElementById("clDeleteBtn").classList.toggle("hidden", !item);
  openModal("clModal");
}

async function saveCLItem() {
  const textEN = document.getElementById("clTextEN").value.trim();
  if (!textEN) { toast(s("admin.textENRequired"), "err"); return; }
  const payload = {
    id:        editingId,
    phase:     document.getElementById("clPhase").value,   // "opening" or "closing"
    textEN,
    textIS:    document.getElementById("clTextIS").value.trim(),
    sortOrder: parseInt(document.getElementById("clSort").value) || 99,
    active:    document.getElementById("clActive").checked,
  };
  await saveEntity({
    apiAction: "saveChecklistItem",
    getArray:  () => clItems,
    setArray:  arr => { clItems = arr; },
    payload, modalId: "clModal",
    renderFn:  renderChecklists,
  });
}

async function deleteCLItem(id) {
  const _id = id || editingId;
  if (!await ymConfirm(s("admin.confirmDeleteItem"))) return;
  try {
    await apiPost("deleteChecklistItem", { id: _id });
    clItems = clItems.filter(i => i.id !== _id);
    renderChecklists();
    closeModal("clModal", true);
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

async function updateCLOrder(phase) {
  const inputs = document.querySelectorAll(`input.cl-sort-input[data-cl-phase="${phase}"]`);
  const updates = [];
  inputs.forEach(inp => {
    const id = inp.dataset.clId;
    const val = parseInt(inp.value) || 99;
    const item = clItems.find(x => x.id === id);
    if (item && item.sortOrder !== val) { item.sortOrder = val; updates.push(item); }
  });
  if (!updates.length) { document.getElementById('clUpdateOrder_' + phase)?.classList.add('hidden'); return; }
  try {
    for (const item of updates) {
      await apiPost("saveChecklistItem", { id: item.id, phase: item.phase, textEN: item.textEN, textIS: item.textIS || "", sortOrder: item.sortOrder, active: item.active });
    }
    renderChecklists();
    toast(s("toast.saved"));
  } catch(e) { toast(s("toast.saveFailed") + ": " + e.message, "err"); }
}

// ══ LAUNCH / LANDING CHECKLISTS ══════════════════════════════════════════════
// Stored in config as: launchChecklists = {
//   dinghy: { launch:[{id,text,textIS,sort}], landing:[...] }, ...
// }
let _launchCLs   = {};
let _lcEditingId = null;

function loadLaunchChecklists(cfgLaunchChecklists) {
  _launchCLs = cfgLaunchChecklists || {};
  populateCategorySelects();   // filter may not be populated yet on first load
  renderLaunchCLSections();
}

function renderLaunchCLSections() {
  const cat     = document.getElementById("launchCLCatFilter")?.value || boatCats[0]?.key || "dinghy";
  const catData = _launchCLs[cat] || { launch:[], landing:[] };
  ["launch", "landing"].forEach(phase => {
    const el    = document.getElementById(phase === "launch" ? "launchCLLaunchList" : "launchCLLandingList");
    if (!el) return;
    const items = (catData[phase] || []).slice().sort((a, b) => (a.sort || 99) - (b.sort || 99));
    if (!items.length) { el.innerHTML = '<div class="empty-state">' + s('admin.noItems') + '</div>'; return; }
    const btnId = 'lcUpdateOrder_' + cat + '_' + phase;
    el.innerHTML = items.map(i => `
      <div class="cl-row">
        <input type="number" class="cl-sort-input" data-lc-cat="${esc(cat)}" data-lc-phase="${phase}" data-lc-id="${esc(i.id)}"
          value="${i.sort || 99}" min="0" data-admin-show-el="${btnId}">
        <span style="flex:1;color:var(--text)">${esc(i.text || "")}${i.textIS
          ? `<span style="color:var(--muted);font-size:11px;margin-left:6px">${esc(i.textIS)}</span>` : ""}</span>
        <button class="row-edit" data-admin-click="openLaunchCLModal" data-admin-arg="${esc(cat)}" data-admin-arg2="${phase}" data-admin-arg3="${esc(i.id)}">Edit</button>
        <button class="row-del"  data-admin-click="deleteLaunchCLItem" data-admin-arg="${esc(cat)}" data-admin-arg2="${phase}" data-admin-arg3="${esc(i.id)}">×</button>
      </div>`).join("") +
      `<button id="${btnId}" class="btn btn-primary cl-update-order hidden" data-admin-click="updateLaunchCLOrder" data-admin-arg="${esc(cat)}" data-admin-arg2="${phase}">Update Order</button>`;
  });
}

function openLaunchCLModal(cat, phase, id) {
  _lcEditingId  = id || null;
  const curCat  = cat   || document.getElementById("launchCLCatFilter")?.value || boatCats[0]?.key || "dinghy";
  const curPhase = phase || "launch";
  let item = null;
  if (id && _launchCLs[curCat]?.[curPhase]) {
    item = _launchCLs[curCat][curPhase].find(x => x.id === id);
  }
  // Pre-check every category that already has this id under the same phase, so an
  // edit propagates across all of them. New items just pre-check the active filter.
  const checkedCats = new Set();
  if (id) {
    Object.keys(_launchCLs).forEach(k => {
      if ((_launchCLs[k]?.[curPhase] || []).some(x => x.id === id)) checkedCats.add(k);
    });
  } else {
    checkedCats.add(curCat);
  }
  populateCategorySelects();
  document.querySelectorAll('#lcCats input.lc-cat-cb').forEach(cb => {
    cb.checked = checkedCats.has(cb.value);
  });
  document.getElementById("launchCLModalTitle").textContent = item ? s('admin.lcModal.edit') : s('admin.lcModal.add');
  document.getElementById("lcPhase").value  = curPhase;
  document.getElementById("lcText").value   = item ? (item.text   || "") : "";
  document.getElementById("lcTextIS").value = item ? (item.textIS || "") : "";
  document.getElementById("lcSort").value   = item ? (item.sort   || 99) : 99;
  document.getElementById("lcDeleteBtn").classList.toggle("hidden", !item);
  openModal("launchCLModal");
}

async function saveLaunchCLItem() {
  const phase  = document.getElementById("lcPhase").value;
  const text   = document.getElementById("lcText").value.trim();
  const textIS = document.getElementById("lcTextIS").value.trim();
  const sort   = parseInt(document.getElementById("lcSort").value) || 99;
  const checkedCats = Array.from(document.querySelectorAll('#lcCats input.lc-cat-cb:checked'))
    .map(cb => cb.value);
  if (!text) { toast(s("admin.textENRequired"), "err"); return; }
  if (!checkedCats.length) { toast(s("admin.selectAtLeastOneCategory"), "err"); return; }

  const id      = _lcEditingId || ("lc_" + Date.now().toString(36));
  const checked = new Set(checkedCats);

  // Upsert into every checked category under the same id; remove from any
  // category that previously held this id but is no longer checked.
  checked.forEach(cat => {
    if (!_launchCLs[cat])        _launchCLs[cat] = { launch:[], landing:[] };
    if (!_launchCLs[cat][phase]) _launchCLs[cat][phase] = [];
    const list = _launchCLs[cat][phase];
    const idx  = list.findIndex(x => x.id === id);
    const item = { id, text, textIS, sort };
    if (idx >= 0) list[idx] = item; else list.push(item);
  });
  if (_lcEditingId) {
    Object.keys(_launchCLs).forEach(cat => {
      if (checked.has(cat)) return;
      const list = _launchCLs[cat]?.[phase];
      if (list) _launchCLs[cat][phase] = list.filter(x => x.id !== id);
    });
  }

  try {
    await apiPost("saveConfig", { launchChecklists: _launchCLs });
    closeModal("launchCLModal", true);
    renderLaunchCLSections();
    toast(s("toast.saved"));
  } catch(e) { toast(s("toast.saveFailed") + ": " + e.message, "err"); }
}

async function updateLaunchCLOrder(cat, phase) {
  const inputs = document.querySelectorAll(`input.cl-sort-input[data-lc-cat="${cat}"][data-lc-phase="${phase}"]`);
  let changed = false;
  inputs.forEach(inp => {
    const id = inp.dataset.lcId;
    const val = parseInt(inp.value) || 99;
    const list = _launchCLs[cat]?.[phase] || [];
    const item = list.find(x => x.id === id);
    if (item && item.sort !== val) { item.sort = val; changed = true; }
  });
  if (!changed) { document.getElementById('lcUpdateOrder_' + cat + '_' + phase)?.classList.add('hidden'); return; }
  try {
    await apiPost("saveConfig", { launchChecklists: _launchCLs });
    renderLaunchCLSections();
    toast(s("toast.saved"));
  } catch(e) { toast(s("toast.saveFailed") + ": " + e.message, "err"); }
}

async function deleteLaunchCLItem(cat, phase, id) {
  // Row button (× on a specific category's list) → remove from just that bucket.
  // Modal delete (no args) → remove from every category that shares the id under
  // the current phase, since the modal represents the item across all of them.
  const fromModal = !cat;
  if (fromModal) {
    phase = document.getElementById("lcPhase").value;
    id    = _lcEditingId;
  }
  if (!await ymConfirm(s("admin.confirmDeleteItem"))) return;
  if (fromModal) {
    Object.keys(_launchCLs).forEach(k => {
      const list = _launchCLs[k]?.[phase];
      if (list) _launchCLs[k][phase] = list.filter(x => x.id !== id);
    });
  } else if (_launchCLs[cat]?.[phase]) {
    _launchCLs[cat][phase] = _launchCLs[cat][phase].filter(x => x.id !== id);
  }
  try {
    await apiPost("saveConfig", { launchChecklists: _launchCLs });
    closeModal("launchCLModal", true);
    renderLaunchCLSections();
    toast(s("toast.deleted"));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

// ══ ACTIVITY TYPES ════════════════════════════════════════════════════════════

