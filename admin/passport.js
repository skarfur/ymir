// ═══════════════════════════════════════════════════════════════════════════════
// admin/passport.js — Rowing passport admin editor
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

let _passportDef = null;
let _passportDirty = false;
// Sort mode: 'cat-mod' = Category → Module, 'mod-cat' = Module → Category
let _passportSortMode = 'cat-mod';

async function renderPassportAdmin() {
  const card = document.getElementById('passportAdminPreview');
  card.innerHTML = '<div class="loading-state"><span class="spinner"></span></div>';
  try {
    const res = await apiGet('getRowingPassport', {});
    _passportDef = res.definition || { version: 1, passports: [] };
    _passportDirty = false;
    drawPassportEditor();
  } catch(e) { card.innerHTML = '<div style="color:var(--red)">' + esc(e.message) + '</div>'; }
}

// In-memory edit targets for passport modals.
let _ppEditing = { pi: null, ci: null, ii: null, mode: null };

// Renders a single item row in the admin preview (used by both sort modes).
// `pi, ci, ii` are the ORIGINAL indices into _passportDef so the edit/retire
// handlers operate on the real underlying item regardless of display order.
function _ppRenderItemRow(p, cat, it, pi, ci, ii) {
  const retired = !!it.retired;
  const assessment = it.assessment || 'practical';
  const itemNameEN = it.name?.EN || it.id;
  const itemNameIS = it.name?.IS || '';
  const descEN = (it.desc && it.desc.EN) || '';
  const descIS = (it.desc && it.desc.IS) || '';
  const descPreview = descEN || descIS || '';
  const assessmentLabel = assessment === 'theory' ? s('passport.theory') : s('passport.practical');
  const assessmentColor = assessment === 'theory' ? 'var(--accent)' : 'var(--muted)';
  const moduleNum = Number(it.module || 0);
  const moduleBadge = moduleNum > 0
    ? `<span style="font-size:9px;color:var(--accent);border:1px solid var(--accent);border-radius:3px;padding:1px 4px;margin-left:4px;text-transform:uppercase;letter-spacing:.5px">${esc(s('passport.moduleShort'))} ${moduleNum}</span>`
    : '';
  return `<div style="border-top:1px solid var(--border);padding:8px 0;display:flex;align-items:flex-start;gap:8px;${retired ? 'opacity:.5' : ''}">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:500">
        ${esc(itemNameEN)}${itemNameIS ? ` <span style="color:var(--muted);font-weight:400">/ ${esc(itemNameIS)}</span>` : ''}
        <span style="font-size:9px;color:${assessmentColor};border:1px solid ${assessmentColor};border-radius:3px;padding:1px 4px;margin-left:6px;text-transform:uppercase;letter-spacing:.5px">${esc(assessmentLabel)}</span>
        ${moduleBadge}
        ${retired ? `<span style="font-size:9px;color:var(--red);border:1px solid var(--red);border-radius:3px;padding:1px 4px;margin-left:4px;text-transform:uppercase;letter-spacing:.5px">${esc(s('passport.retiredBadge'))}</span>` : ''}
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${descPreview ? esc(descPreview) : `<em>${esc(s('passport.noDescription'))}</em>`}
      </div>
      <div style="font-size:9px;color:var(--faint);margin-top:2px">${esc(it.id)}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">
      <button class="btn btn-secondary btn-sm" data-admin-click="openPassportItemModal" data-admin-arg="${pi}" data-admin-arg2="${ci}" data-admin-arg3="${ii}" data-s="passport.editItem">Edit</button>
      <button class="btn btn-secondary btn-sm" data-admin-click="ppToggleRetire" data-admin-arg="${pi}" data-admin-arg2="${ci}" data-admin-arg3="${ii}">${retired ? esc(s('passport.unretire')) : esc(s('passport.retire'))}</button>
    </div>
  </div>`;
}

// Flatten all items of a passport, preserving original (ci, ii) coordinates.
function _ppFlattenItems(p) {
  const out = [];
  (p.categories || []).forEach((cat, ci) => {
    (cat.items || []).forEach((it, ii) => {
      out.push({ cat, ci, it, ii });
    });
  });
  return out;
}

function ppSetSortMode(mode) {
  _passportSortMode = (mode === 'mod-cat') ? 'mod-cat' : 'cat-mod';
  drawPassportEditor();
}
window.ppSetSortMode = ppSetSortMode;

function drawPassportEditor() {
  const card = document.getElementById('passportAdminPreview');
  const def = _passportDef;
  if (!def || !(def.passports || []).length) {
    card.innerHTML = `<div style="color:var(--muted);padding:12px 0">No passports configured. Import a CSV to get started.</div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary btn-sm" data-admin-click="ppSaveDef" data-s="passport.save">Save changes</button>
        <span id="ppDirtyMark" style="font-size:10px;color:var(--accent)">${_passportDirty ? '● unsaved' : ''}</span>
      </div>`;
    applyStrings(card);
    return;
  }
  const sortMode = _passportSortMode;
  const isCatMod = sortMode !== 'mod-cat';
  let html = '';

  // Sort-mode toggle (shared across all passports in the editor)
  html += `<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
    <span style="font-size:10px;color:var(--muted);letter-spacing:.5px;text-transform:uppercase" data-s="passport.sortBy">Sort by</span>
    <button class="btn ${isCatMod ? 'btn-primary' : 'btn-secondary'} btn-sm" data-admin-click="ppSetSortMode" data-admin-arg="cat-mod" data-s="passport.sortCatMod">Category → Module</button>
    <button class="btn ${!isCatMod ? 'btn-primary' : 'btn-secondary'} btn-sm" data-admin-click="ppSetSortMode" data-admin-arg="mod-cat" data-s="passport.sortModCat">Module → Category</button>
  </div>`;

  (def.passports || []).forEach((p, pi) => {
    const totalItems   = (p.categories || []).reduce((sum, c) => sum + (c.items || []).filter(i => !i.retired).length, 0);
    const retiredItems = (p.categories || []).reduce((sum, c) => sum + (c.items || []).filter(i =>  i.retired).length, 0);
    const reqSigs   = Number(p.requiredSigs || 2);
    const promoteId = p.promoteCertId || 'rowing_division';
    const nameEN = p.name?.EN || p.id;
    const nameIS = p.name?.IS || '';
    html += `<div style="border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px;background:var(--card)">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px;color:var(--text)">${esc(nameEN)} <span style="color:var(--muted);font-weight:400;font-size:10px">(${esc(p.id)})</span></div>
          ${nameIS ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(nameIS)}</div>` : ''}
          <div style="font-size:10px;color:var(--muted);margin-top:6px">
            v${def.version || 1} ·
            ${totalItems} ${s('passport.activeCount')}${retiredItems ? ' · ' + retiredItems + ' ' + s('passport.retiredBadge') : ''} ·
            ${s('passport.requiresSignatures', { n: reqSigs })} ·
            ${s('passport.promotesTo', { cert: esc(promoteId) })} (${esc(p.fromSub || 'restricted')} → ${esc(p.toSub || 'released')})
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" style="white-space:nowrap" data-admin-click="openPassportSettingsModal" data-admin-arg="${pi}" data-s="passport.editSettings">Edit passport settings</button>
      </div>`;

    if (isCatMod) {
      // Category → Module: preserve original category order; within each category
      // sort items by (module asc, name asc). Adds/edits stay anchored per-category.
      (p.categories || []).forEach((cat, ci) => {
        const catNameEN = cat.name?.EN || cat.id;
        const catNameIS = cat.name?.IS || '';
        html += `<div style="margin-top:10px;border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--surface)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:12px">${esc(catNameEN)}${catNameIS ? ` <span style="color:var(--muted);font-weight:400">/ ${esc(catNameIS)}</span>` : ''}</div>
              <div style="font-size:9px;color:var(--muted)">${esc(cat.id)}</div>
            </div>
            <button class="btn btn-secondary btn-sm" data-admin-click="openPassportCategoryModal" data-admin-arg="${pi}" data-admin-arg2="${ci}" data-s="passport.editCategory">Edit category</button>
          </div>`;

        const items = (cat.items || []).map((it, ii) => ({ it, ii }));
        if (!items.length) {
          html += `<div style="font-size:10px;color:var(--muted);padding:6px 0">— no items —</div>`;
        } else {
          items.sort((a, b) => {
            const ma = Number(a.it.module || 0);
            const mb = Number(b.it.module || 0);
            if (ma !== mb) return ma - mb;
            return String(a.it.name?.EN || '').localeCompare(String(b.it.name?.EN || ''));
          });
          items.forEach(({ it, ii }) => {
            html += _ppRenderItemRow(p, cat, it, pi, ci, ii);
          });
        }

        html += `<div style="margin-top:8px">
          <button class="btn btn-secondary btn-sm" data-admin-click="openPassportItemModal" data-admin-arg="${pi}" data-admin-arg2="${ci}" data-admin-arg3="null" data-s="passport.addItem">+ Add item</button>
        </div></div>`;
      });
    } else {
      // Module → Category: bucket all items by module; within each module bucket
      // group by their original category so edit handlers still line up. Module 0
      // (unassigned) is shown last as a dedicated bucket.
      const flat = _ppFlattenItems(p);
      const modKeys = {};
      flat.forEach(entry => {
        const m = Number(entry.it.module || 0);
        if (!modKeys[m]) modKeys[m] = [];
        modKeys[m].push(entry);
      });
      const orderedMods = Object.keys(modKeys).map(Number).sort((a, b) => {
        if (a === 0) return 1;  // unassigned last
        if (b === 0) return -1;
        return a - b;
      });

      if (!orderedMods.length) {
        html += `<div style="font-size:10px;color:var(--muted);padding:8px 0">— no items —</div>`;
      }

      orderedMods.forEach(modNum => {
        const bucket = modKeys[modNum];
        const modLabel = modNum > 0
          ? `${s('passport.moduleLabel')} ${modNum}`
          : s('passport.unassignedModule');
        html += `<div style="margin-top:10px;border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--surface)">
          <div style="font-weight:700;font-size:12px;color:var(--accent);letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px">${esc(modLabel)} <span style="color:var(--muted);font-weight:400;font-size:10px">· ${bucket.length}</span></div>`;

        // Sub-group by category (preserving the passport's category order)
        const byCat = {};
        bucket.forEach(entry => {
          if (!byCat[entry.ci]) byCat[entry.ci] = [];
          byCat[entry.ci].push(entry);
        });
        const catOrder = Object.keys(byCat).map(Number).sort((a, b) => a - b);
        catOrder.forEach(ci => {
          const cat = p.categories[ci];
          const catNameEN = cat.name?.EN || cat.id;
          const catNameIS = cat.name?.IS || '';
          html += `<div style="margin-top:8px;padding-left:8px;border-left:2px solid var(--border)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:11px">${esc(catNameEN)}${catNameIS ? ` <span style="color:var(--muted);font-weight:400">/ ${esc(catNameIS)}</span>` : ''}</div>
              </div>
              <button class="btn btn-secondary btn-sm" data-admin-click="openPassportCategoryModal" data-admin-arg="${pi}" data-admin-arg2="${ci}" data-s="passport.editCategory">Edit category</button>
            </div>`;
          const entries = byCat[ci].slice().sort((a, b) =>
            String(a.it.name?.EN || '').localeCompare(String(b.it.name?.EN || '')));
          entries.forEach(({ it, ii }) => {
            html += _ppRenderItemRow(p, cat, it, pi, ci, ii);
          });
          html += `</div>`;
        });

        html += `</div>`;
      });

      // In Module → Category mode, "+Add item" is shown per-category at the bottom
      // so authors can still create items (they'll be assigned a module via the modal).
      html += `<div style="margin-top:10px;border:1px dashed var(--border);border-radius:6px;padding:10px;background:var(--surface)">
        <div style="font-size:10px;color:var(--muted);margin-bottom:6px" data-s="passport.addItemHint">Add a new item to a category:</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">`;
      (p.categories || []).forEach((cat, ci) => {
        const catNameEN = cat.name?.EN || cat.id;
        html += `<button class="btn btn-secondary btn-sm" data-admin-click="openPassportItemModal" data-admin-arg="${pi}" data-admin-arg2="${ci}" data-admin-arg3="null">+ ${esc(catNameEN)}</button>`;
      });
      html += `</div></div>`;
    }

    html += `<div style="margin-top:12px">
      <button class="btn btn-secondary btn-sm" data-admin-click="openPassportCategoryModal" data-admin-arg="${pi}" data-admin-arg2="null" data-s="passport.addCategory">+ Add category</button>
    </div>`;
    html += '</div>';
  });

  html += `<div style="margin-top:14px;display:flex;gap:8px;align-items:center">
    <button class="btn btn-primary btn-sm" data-admin-click="ppSaveDef" data-s="passport.save">Save changes</button>
    <span id="ppDirtyMark" style="font-size:10px;color:var(--accent)">${_passportDirty ? '● unsaved' : ''}</span>
  </div>`;
  card.innerHTML = html;
  applyStrings(card);
}

function _ppMarkDirty() { _passportDirty = true; const m = document.getElementById('ppDirtyMark'); if (m) m.textContent = '● unsaved'; }
function _ppSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || ('item-' + Date.now().toString(36)); }

// Existing items flagged with __new were added in this session and can be
// spliced on delete; without the flag we soft-delete (retire) instead so
// any backend sign-offs referencing the id remain valid.
function _ppIsNewItem(it) { return !!(it && it.__new); }

// ── Passport settings modal ────────────────────────────────────────────────
function openPassportSettingsModal(pi) {
  const p = _passportDef && _passportDef.passports[pi];
  if (!p) return;
  _ppEditing = { pi, ci: null, ii: null, mode: 'settings' };
  document.getElementById('ppsId').value             = p.id || '';
  document.getElementById('ppsNameEN').value         = (p.name && p.name.EN) || '';
  document.getElementById('ppsNameIS').value         = (p.name && p.name.IS) || '';
  document.getElementById('ppsRequiredSigs').value   = Number(p.requiredSigs || 2);
  document.getElementById('ppsPromoteCertId').value  = p.promoteCertId || 'rowing_division';
  document.getElementById('ppsFromSub').value        = p.fromSub || 'restricted';
  document.getElementById('ppsToSub').value          = p.toSub || 'released';
  openModal('passportSettingsModal');
}

function savePassportSettings() {
  const pi = _ppEditing.pi;
  const p  = _passportDef && _passportDef.passports[pi];
  if (!p) return;
  const nameEN = document.getElementById('ppsNameEN').value.trim();
  if (!nameEN) { toast(s('passport.nameRequired'), 'err'); return; }
  let req = parseInt(document.getElementById('ppsRequiredSigs').value, 10);
  if (!(req >= 1)) req = 1;
  p.name = p.name || {};
  p.name.EN = nameEN;
  p.name.IS = document.getElementById('ppsNameIS').value.trim();
  p.requiredSigs  = req;
  p.promoteCertId = document.getElementById('ppsPromoteCertId').value.trim() || 'rowing_division';
  p.fromSub       = document.getElementById('ppsFromSub').value.trim() || 'restricted';
  p.toSub         = document.getElementById('ppsToSub').value.trim() || 'released';
  _ppMarkDirty();
  closeModal('passportSettingsModal', true);
  drawPassportEditor();
}

// ── Passport item modal (add + edit) ───────────────────────────────────────
function openPassportItemModal(pi, ci, ii) {
  const cat = _passportDef && _passportDef.passports[pi] && _passportDef.passports[pi].categories[ci];
  if (!cat) return;
  const adding = (ii === null || ii === undefined);
  _ppEditing = { pi, ci, ii: adding ? null : ii, mode: adding ? 'item-add' : 'item-edit' };
  const it = adding ? { id: '', name: { EN: '', IS: '' }, desc: { EN: '', IS: '' }, assessment: 'practical', module: 0, retired: false } : cat.items[ii];
  document.getElementById('passportItemModalTitle').textContent =
    adding ? s('passport.newItem') : s('passport.itemTitle');
  document.getElementById('ppiId').value        = it.id || '';
  document.getElementById('ppiNameEN').value    = (it.name && it.name.EN) || '';
  document.getElementById('ppiNameIS').value    = (it.name && it.name.IS) || '';
  document.getElementById('ppiDescEN').value    = (it.desc && it.desc.EN) || '';
  document.getElementById('ppiDescIS').value    = (it.desc && it.desc.IS) || '';
  document.getElementById('ppiAssessment').value = it.assessment || 'practical';
  document.getElementById('ppiModule').value    = Number(it.module || 0) || '';
  document.getElementById('ppiRetired').checked = !!it.retired;
  document.getElementById('ppiDeleteBtn').classList.toggle('hidden', adding);
  openModal('passportItemModal');
}

function savePassportItem() {
  const { pi, ci, mode } = _ppEditing;
  const cat = _passportDef && _passportDef.passports[pi] && _passportDef.passports[pi].categories[ci];
  if (!cat) return;
  const nameEN = document.getElementById('ppiNameEN').value.trim();
  if (!nameEN) { toast(s('passport.nameRequired'), 'err'); return; }
  let modNum = parseInt(document.getElementById('ppiModule').value, 10);
  if (!(modNum >= 0)) modNum = 0;
  const payload = {
    name: {
      EN: nameEN,
      IS: document.getElementById('ppiNameIS').value.trim(),
    },
    desc: {
      EN: document.getElementById('ppiDescEN').value.trim(),
      IS: document.getElementById('ppiDescIS').value.trim(),
    },
    assessment: document.getElementById('ppiAssessment').value || 'practical',
    module: modNum,
    retired: document.getElementById('ppiRetired').checked,
  };
  if (mode === 'item-add') {
    const id = _ppSlug(nameEN);
    cat.items = cat.items || [];
    cat.items.push({ id, __new: true, ...payload });
  } else {
    const it = cat.items[_ppEditing.ii];
    if (!it) return;
    it.name = payload.name;
    it.desc = payload.desc;
    it.assessment = payload.assessment;
    it.module = payload.module;
    it.retired = payload.retired;
  }
  _ppMarkDirty();
  closeModal('passportItemModal', true);
  drawPassportEditor();
}

async function deletePassportItem() {
  const { pi, ci, ii } = _ppEditing;
  const cat = _passportDef && _passportDef.passports[pi] && _passportDef.passports[pi].categories[ci];
  if (!cat || ii === null || ii === undefined) return;
  const it = cat.items[ii];
  if (!it) return;
  if (!await ymConfirm(s('passport.confirmDeleteItem'))) return;
  if (_ppIsNewItem(it)) {
    cat.items.splice(ii, 1);
    toast(s('passport.itemDeleted'));
  } else {
    it.retired = true;
    toast(s('passport.itemRetiredSoft'));
  }
  _ppMarkDirty();
  closeModal('passportItemModal', true);
  drawPassportEditor();
}

// ── Passport category modal (add + edit) ───────────────────────────────────
function openPassportCategoryModal(pi, ci) {
  const p = _passportDef && _passportDef.passports[pi];
  if (!p) return;
  const adding = (ci === null || ci === undefined);
  _ppEditing = { pi, ci: adding ? null : ci, ii: null, mode: adding ? 'cat-add' : 'cat-edit' };
  const cat = adding ? { id: '', name: { EN: '', IS: '' } } : p.categories[ci];
  document.getElementById('passportCategoryModalTitle').textContent =
    adding ? s('passport.newCategory') : s('passport.categoryTitle');
  document.getElementById('ppcId').value     = cat.id || '';
  document.getElementById('ppcNameEN').value = (cat.name && cat.name.EN) || '';
  document.getElementById('ppcNameIS').value = (cat.name && cat.name.IS) || '';
  document.getElementById('ppcDeleteBtn').classList.toggle('hidden', adding);
  openModal('passportCategoryModal');
}

function savePassportCategory() {
  const { pi, mode } = _ppEditing;
  const p = _passportDef && _passportDef.passports[pi];
  if (!p) return;
  const nameEN = document.getElementById('ppcNameEN').value.trim();
  if (!nameEN) { toast(s('passport.nameRequired'), 'err'); return; }
  const nameIS = document.getElementById('ppcNameIS').value.trim();
  if (mode === 'cat-add') {
    const id = _ppSlug(nameEN);
    p.categories = p.categories || [];
    p.categories.push({ id, name: { EN: nameEN, IS: nameIS }, items: [] });
  } else {
    const cat = p.categories[_ppEditing.ci];
    if (!cat) return;
    cat.name = cat.name || {};
    cat.name.EN = nameEN;
    cat.name.IS = nameIS;
  }
  _ppMarkDirty();
  closeModal('passportCategoryModal', true);
  drawPassportEditor();
}

async function deletePassportCategory() {
  const { pi, ci } = _ppEditing;
  const p = _passportDef && _passportDef.passports[pi];
  if (!p || ci === null || ci === undefined) return;
  if (!await ymConfirm(s('passport.confirmDeleteCategory'))) return;
  p.categories.splice(ci, 1);
  _ppMarkDirty();
  toast(s('passport.categoryDeleted'));
  closeModal('passportCategoryModal', true);
  drawPassportEditor();
}

function ppToggleRetire(pi, ci, ii) {
  const it = _passportDef.passports[pi].categories[ci].items[ii];
  it.retired = !it.retired;
  _ppMarkDirty();
  drawPassportEditor();
}

async function ppSaveDef() {
  if (!_passportDef) return;
  // Bump version on save
  _passportDef.version = (_passportDef.version || 0) + 1;
  // Strip transient __new flags before sending to backend
  (_passportDef.passports || []).forEach(p => {
    (p.categories || []).forEach(c => {
      (c.items || []).forEach(it => { if (it.__new) delete it.__new; });
    });
  });
  try {
    await apiPost('saveRowingPassportDef', { definition: _passportDef });
    _passportDirty = false;
    toast(s('passport.saved'));
    renderPassportAdmin();
  } catch(e) { toast(e.message, 'err'); }
}

window.openPassportSettingsModal = openPassportSettingsModal;
window.savePassportSettings      = savePassportSettings;
window.openPassportItemModal     = openPassportItemModal;
window.savePassportItem          = savePassportItem;
window.deletePassportItem        = deletePassportItem;
window.openPassportCategoryModal = openPassportCategoryModal;
window.savePassportCategory      = savePassportCategory;
window.deletePassportCategory    = deletePassportCategory;
window.ppToggleRetire            = ppToggleRetire;
window.ppSaveDef                 = ppSaveDef;

async function passportImportCsv() {
  const file = document.getElementById('passportCsvFile').files[0];
  if (!file) { toast('Choose a CSV file first', 'err'); return; }
  const text = await file.text();
  if (!(await ymConfirm('Import this CSV? Items missing from the CSV will be marked retired (not deleted).'))) return;
  try {
    await apiPost('importRowingPassportCsv', { csv: text });
    toast('Passport imported.');
    renderPassportAdmin();
  } catch(e) { toast(e.message, 'err'); }
}

async function passportExportCsv() {
  try {
    const res = await apiGet('getRowingPassport', {});
    const def = res.definition || { passports: [] };
    const lines = ['passport_id,category_id,category_label_en,category_label_is,item_id,assessment,module,item_label_en,item_label_is,description_en,description_is'];
    const q = v => '"' + String(v || '').replace(/"/g,'""') + '"';
    (def.passports || []).forEach(p => {
      (p.categories || []).forEach(cat => {
        (cat.items || []).forEach(it => {
          if (it.retired) return;
          const mod = Number(it.module || 0) || '';
          lines.push([p.id, cat.id, cat.name?.EN || '', cat.name?.IS || '', it.id, it.assessment || 'practical', mod, it.name?.EN || '', it.name?.IS || '', it.desc?.EN || '', it.desc?.IS || ''].map(q).join(','));
        });
      });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'rowing-passport.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) { toast(e.message, 'err'); }
}
