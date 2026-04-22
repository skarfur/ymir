// ═══════════════════════════════════════════════════════════════════════════════
// admin/certs.js — Certification categories, definitions, subcats
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

var certDefs     = [];
let certEditId   = null;
// Credential modal — uses shared/mcm.js
window.mcmGetMembers        = function() { return members; };
window.mcmGetCertDefs       = function() { return certDefs; };
window.mcmGetCertCategories = function() { return certCategories; };

// ── Credential categories ─────────────────────────────────────────────────────
let _ccEditingKey = null;

function renderCertCategories() {
  const el = document.getElementById("certCatsCard");
  const addWrap = document.getElementById("certCatsAddWrap");
  if (!el) return;
  if (!certCategories.length) {
    el.innerHTML = `<div class="empty-state">${s('admin.noCertCategories')}</div>`;
  } else {
    el.innerHTML = certCategories.map((c) => {
      const key     = certCategoryKey(c);
      const labelEN = (c && c.labelEN) || key;
      const labelIS = (c && c.labelIS) || '';
      const safeKey = String(key).replace(/'/g, "\\'");
      return `<div class="list-row">
        <div style="flex:1;font-size:12px">
          <strong>${esc(labelEN)}</strong>
          ${labelIS ? `<span style="color:var(--muted);font-size:11px;margin-left:8px">${esc(labelIS)}</span>` : ''}
        </div>
        <button class="row-edit" data-admin-click="openCertCatModal" data-admin-arg="${safeKey}">Edit</button>
        <button class="row-del" data-admin-click="removeCertCategory" data-admin-arg="${safeKey}" title="Remove">×</button>
      </div>`;
    }).join('');
  }
  if (addWrap) addWrap.classList.remove("hidden");
}

async function addCertCategory() {
  const inEN = document.getElementById("newCatInputEN");
  const inIS = document.getElementById("newCatInputIS");
  const labelEN = inEN.value.trim();
  const labelIS = inIS ? inIS.value.trim() : '';
  if (!labelEN) return;
  // Stable key = labelEN unchanged, to keep legacy member-cert category
  // references working. Dedupe by key.
  const key = labelEN;
  if (certCategories.some(c => certCategoryKey(c) === key)) {
    toast(s("admin.categoryExists"), "err"); return;
  }
  certCategories.push({ key, labelEN, labelIS });
  inEN.value = "";
  if (inIS) inIS.value = "";
  try {
    await apiPost("saveCertCategories", { categories: certCategories });
    renderCertCategories();
    toast(s("admin.categoryAdded"));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

function openCertCatModal(key) {
  _ccEditingKey = key;
  const cat = certCategoryByKey(certCategories, key) || { key, labelEN: key, labelIS: '' };
  document.getElementById("certCatModalTitle").textContent = s('admin.certCatModal.edit');
  document.getElementById("ccLabelEN").value = cat.labelEN || key;
  document.getElementById("ccLabelIS").value = cat.labelIS || '';
  document.getElementById("ccKey").value     = cat.key || key;
  openModal("certCatModal");
}

async function saveCertCat() {
  const key     = _ccEditingKey;
  const labelEN = document.getElementById("ccLabelEN").value.trim();
  const labelIS = document.getElementById("ccLabelIS").value.trim();
  if (!key || !labelEN) { toast(s("admin.nameRequired"), "err"); return; }
  const idx = certCategories.findIndex(c => certCategoryKey(c) === key);
  if (idx < 0) { toast(s("toast.error"), "err"); return; }
  // Update labels but keep key stable — member-cert records reference `key`.
  const existing = certCategories[idx];
  certCategories[idx] = Object.assign({}, (typeof existing === 'string' ? { key: existing } : existing), {
    key, labelEN, labelIS,
  });
  try {
    await apiPost("saveCertCategories", { categories: certCategories });
    closeModal("certCatModal", true);
    renderCertCategories();
    renderCertDefs();
    toast(s("toast.saved"));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

async function removeCertCategory(key) {
  if (!await ymConfirm(s("admin.confirmRemoveCategory"))) return;
  const next = certCategories.filter(c => certCategoryKey(c) !== key);
  if (next.length === certCategories.length) return;
  certCategories = next;
  try {
    await apiPost("saveCertCategories", { categories: certCategories });
    renderCertCategories();
    toast(s("admin.categoryRemoved"));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

// Remember which rows are expanded so re-renders preserve the state.
const _certDefExpanded = new Set();

function renderCertDefs() {
  const el = document.getElementById("certDefsCard");
  if (!el) return;
  if (!certDefs.length) {
    el.innerHTML = `<div class="empty-state">${s('admin.noCertDefs')}</div>`;
    return;
  }
  const isIS   = getLang() === 'IS';
  const locale = isIS ? 'is' : 'en';

  const certifications = certDefs.filter(d => !d.clubEndorsement);
  const endorsements   = certDefs.filter(d => !!d.clubEndorsement);

  // Group certifications by category key (active-language sorted).
  const groups = new Map();
  certifications.forEach(d => {
    const key = d.category || '';
    if (!groups.has(key)) {
      groups.set(key, { key, catObj: key ? certCategoryByKey(certCategories, key) : null, items: [] });
    }
    groups.get(key).items.push(d);
  });
  const groupList = [...groups.values()].sort((a, b) => {
    // Uncategorized sinks to the bottom.
    if (!a.key && b.key) return 1;
    if (a.key && !b.key) return -1;
    const la = a.catObj ? certCategoryLabel(a.catObj) : a.key;
    const lb = b.catObj ? certCategoryLabel(b.catObj) : b.key;
    return la.localeCompare(lb, locale, { sensitivity: 'base' });
  });
  groupList.forEach(g => g.items.sort((a, b) =>
    certDefName(a).localeCompare(certDefName(b), locale, { sensitivity: 'base' })
  ));
  endorsements.sort((a, b) =>
    certDefName(a).localeCompare(certDefName(b), locale, { sensitivity: 'base' })
  );

  function certDefRow(d) {
    const nameEN = d.nameEN || d.name || '';
    const nameIS = d.nameIS || '';
    // Active language on top, the other language faint beneath (skip if identical/empty).
    const namePrimary   = isIS ? (nameIS || nameEN) : (nameEN || nameIS);
    const nameSecondary = isIS
      ? (nameEN && nameEN !== namePrimary ? nameEN : '')
      : (nameIS && nameIS !== namePrimary ? nameIS : '');
    const authority = d.issuingAuthority ? esc(d.issuingAuthority) : '';

    // Expanded-only detail strings.
    const catObj   = d.category ? certCategoryByKey(certCategories, d.category) : null;
    const catLabel = catObj ? certCategoryLabel(catObj) : d.category;
    const descEN   = d.descriptionEN || d.description || '';
    const descIS   = d.descriptionIS || '';
    const subcats  = (d.subcats || []).map(sc => {
      const parts = [certSubcatLabel(sc)];
      if (sc.rank != null) parts.push(`rank ${sc.rank}`);
      if (sc.issuingAuthority) parts.push(sc.issuingAuthority);
      return parts.join(' · ');
    });
    const flags = [];
    if (d.expires)     flags.push('expires');
    if (d.hasIdNumber) flags.push('ID number');
    if (d.color)       flags.push(`color ${d.color}`);

    const isOpen = _certDefExpanded.has(d.id);
    const detailRow = (label, value) => value
      ? `<div><span style="color:var(--faint)">${esc(label)}:</span> ${value}</div>` : '';
    const descHtml = (descEN || descIS)
      ? [descEN ? esc(descEN) : '', descIS ? `<em style="color:var(--muted)">${esc(descIS)}</em>` : '']
          .filter(Boolean).join('<br>')
      : '';

    return `<div class="list-row cd-row" style="align-items:flex-start">
      <div class="cd-summary flex-1 pos-relative cursor-pointer" data-admin-click="toggleCertDefRow" data-admin-arg="${esc(d.id)}" style="min-width:0">
        <div style="display:flex;align-items:flex-start;gap:6px">
          <span class="cd-caret" style="color:var(--muted);font-size:10px;line-height:1.4;user-select:none">${isOpen ? '▾' : '▸'}</span>
          <div style="flex:1;min-width:0">
            <div class="list-name" style="font-weight:600">${esc(namePrimary)}</div>
            ${nameSecondary ? `<div style="color:var(--muted);font-size:11px">${esc(nameSecondary)}</div>` : ''}
            ${authority ? `<div style="color:var(--muted);font-size:11px;margin-top:2px">${authority}</div>` : ''}
          </div>
        </div>
        <div class="cd-expanded ${isOpen ? '' : 'hidden'}" style="font-size:11px;color:var(--muted);margin:8px 0 2px 16px;line-height:1.55">
          ${detailRow('Category', catLabel ? `<span style="color:var(--accent-fg)">${esc(catLabel)}</span>` : '')}
          ${detailRow('Description', descHtml)}
          ${subcats.length
            ? detailRow('Subcategories', subcats.map(esc).join(', '))
            : `<div style="font-style:italic">${esc(s('admin.noSubcategories'))}</div>`}
          ${detailRow('Flags', flags.length ? esc(flags.join(', ')) : '')}
        </div>
      </div>
      <button class="row-edit" data-admin-click="openCertDefModal"  data-admin-arg="${esc(d.id)}">Edit</button>
      <button class="row-del"  data-admin-click="deleteCertDefById" data-admin-arg="${esc(d.id)}" title="Delete">×</button>
    </div>`;
  }

  const sectionHeader = (label, extraMargin) =>
    `<div style="font-size:9px;color:var(--muted);letter-spacing:1.2px;margin:${extraMargin}px 0 6px">${esc(label)}</div>`;
  const groupHeader = (label) =>
    `<div style="font-size:11px;color:var(--accent-fg);letter-spacing:.5px;margin:10px 0 4px;text-transform:uppercase">${esc(label)}</div>`;

  let html = '';
  if (groupList.length) {
    html += sectionHeader(s('admin.certTypes'), 8);
    groupList.forEach(g => {
      const label = g.catObj ? certCategoryLabel(g.catObj) : (g.key || '—');
      html += groupHeader(label);
      html += g.items.map(certDefRow).join('');
    });
  }
  if (endorsements.length) {
    html += sectionHeader(s('cert.clubEndorsements'), groupList.length ? 16 : 8);
    html += endorsements.map(certDefRow).join('');
  }
  el.innerHTML = html;
}

function toggleCertDefRow(id) {
  if (!id) return;
  if (_certDefExpanded.has(id)) _certDefExpanded.delete(id);
  else                          _certDefExpanded.add(id);
  // Swap caret + toggle visibility without a full re-render.
  const row = document.querySelector(`.cd-summary[data-admin-arg="${CSS.escape(id)}"]`);
  if (!row) return;
  const expanded = _certDefExpanded.has(id);
  const caret    = row.querySelector('.cd-caret');
  const detail   = row.querySelector('.cd-expanded');
  if (caret)  caret.textContent = expanded ? '▾' : '▸';
  if (detail) detail.classList.toggle('hidden', !expanded);
}

function openCertDefModal(id) {
  certEditId = id || null;
  const d    = id ? certDefs.find(x => x.id === id) : null;
  document.getElementById("certDefModalTitle").textContent = d ? s('admin.certEditModal') : s('admin.certAddModal');
  // Prefer new bilingual fields, fall back to legacy single-string fields.
  document.getElementById("cdNameEN").value            = d ? (d.nameEN || d.name || "") : "";
  document.getElementById("cdNameIS").value            = d ? (d.nameIS || "") : "";
  document.getElementById("cdDescEN").value            = d ? (d.descriptionEN || d.description || "") : "";
  document.getElementById("cdDescIS").value            = d ? (d.descriptionIS || "") : "";
  document.getElementById("cdIssuingAuthority").value = d ? (d.issuingAuthority || "") : "";
  document.getElementById("cdClubEndorsement").checked = d ? !!d.clubEndorsement : false;
  document.getElementById("cdColor").value            = d?.color || "#b5890a";
  document.getElementById("cdHasIdNumber").checked     = d ? !!d.hasIdNumber : false;
  document.getElementById("cdExpires").checked        = d ? !!d.expires : false;
  document.getElementById("certDefDeleteBtn").classList.toggle("hidden", !d);
  // Category dropdown
  populateCdCategorySelect(d?.category || '');
  toggleCdEndorsement();
  document.getElementById("subcatRows").innerHTML = "";
  (d?.subcats || []).forEach(sc => addSubcatRow(sc));
  openModal("certDefModal");
}

function populateCdCategorySelect(selected) {
  const sel = document.getElementById("cdCategory");
  sel.innerHTML = '<option value="">' + s('admin.certCategoryNone') + '</option>';
  certCategories.forEach(c => {
    const key   = certCategoryKey(c);
    const label = certCategoryLabel(c);
    if (!key) return;
    const o = document.createElement("option");
    o.value = key; o.textContent = label;
    if (key === selected) o.selected = true;
    sel.appendChild(o);
  });
}

function toggleCdEndorsement() {
  const isEndorsement = document.getElementById("cdClubEndorsement").checked;
  document.getElementById("cdCategoryField").style.display = isEndorsement ? "none" : "";
}

async function saveCertDef() {
  const btn    = document.getElementById("saveCertDefBtn");
  const nameEN = document.getElementById("cdNameEN").value.trim();
  const nameIS = document.getElementById("cdNameIS").value.trim();
  if (!nameEN) { toast(s("admin.nameRequired"), "err"); return; }

  const newId   = certEditId || ("cert_" + Date.now().toString(36));
  const expires = document.getElementById("cdExpires").checked;
  const isEndorsement = document.getElementById("cdClubEndorsement").checked;
  const descEN  = document.getElementById("cdDescEN").value.trim();
  const descIS  = document.getElementById("cdDescIS").value.trim();
  const payload = {
    id:               newId,
    // New bilingual fields:
    nameEN,
    nameIS,
    descriptionEN:    descEN,
    descriptionIS:    descIS,
    // Legacy mirrors for any half-upgraded consumer:
    name:             nameEN,
    description:      descEN,
    category:         isEndorsement ? '' : document.getElementById("cdCategory").value.trim(),
    issuingAuthority: document.getElementById("cdIssuingAuthority").value.trim(),
    subcats:          gatherSubcats(),
    clubEndorsement:  isEndorsement,
    color:            document.getElementById("cdColor").value,
    hasIdNumber:      document.getElementById("cdHasIdNumber").checked,
    expires,
  };

  btn.disabled = true;
  try {
    const res     = await apiPost("saveCertDef", payload);
    const savedId = res?.id || newId;
    const saved   = { ...payload, id: savedId };
    if (certEditId) {
      certDefs = certDefs.map(d => d.id === certEditId ? saved : d);
    } else {
      certDefs = [...certDefs, saved];
    }
    certEditId = savedId;
    renderCertDefs();

    closeModal("certDefModal", true);
    toast(s("admin.certDefSaved"));
  } catch(e) {
    toast(s("toast.saveFailed") + ": " + e.message, "err");
  } finally {
    btn.disabled = false;
  }
}

async function deleteCertDef() {
  if (!certEditId || !await ymConfirm(s("admin.confirmDeleteCertDef"))) return;
  try {
    await apiPost("deleteCertDef", { id: certEditId });
    certDefs = certDefs.filter(d => d.id !== certEditId);
    renderCertDefs();

    closeModal("certDefModal", true);
    toast(s("toast.deleted"));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

async function deleteCertDefById(id) {
  if (!await ymConfirm(s("admin.confirmDeleteCertDef"))) return;
  try {
    await apiPost("deleteCertDef", { id });
    certDefs = certDefs.filter(d => d.id !== id);
    renderCertDefs();

    toast(s("toast.deleted"));
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

// Subcat row — bilingual label & description inputs. Key is still derived
// from labelEN so existing data keeps matching.
let _subcatCounter = 0;
function addSubcatRow(sc) {
  const i   = _subcatCounter++;
  const row = document.createElement("div");
  row.className = "list-row";
  row.id = `scrow_${i}`;
  row.style.cssText = "flex-direction:column;align-items:stretch;gap:6px;padding:10px 0;border-bottom:1px solid var(--border)44";
  const labelEN = sc?.labelEN ?? sc?.label ?? "";
  const labelIS = sc?.labelIS ?? "";
  const descEN  = sc?.descriptionEN ?? sc?.description ?? "";
  const descIS  = sc?.descriptionIS ?? "";
  row.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 60px auto;gap:8px;align-items:center">
      <input type="text"   placeholder="${esc(s('admin.subcatLabelEN') || 'Label (EN)')}" value="${esc(labelEN)}"
        style="font-size:12px" data-field="labelEN">
      <input type="text"   placeholder="${esc(s('admin.subcatLabelIS') || 'Label (IS)')}" value="${esc(labelIS)}"
        style="font-size:12px" data-field="labelIS">
      <input type="number" placeholder="Rank" min="1" max="99" value="${sc?.rank ?? ""}"
        style="font-size:12px" data-field="rank" title="Rank (higher replaces lower on assign)">
      <button class="row-del" data-admin-remove-el="scrow_${i}" title="Remove" style="font-size:16px;padding:2px 6px">×</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <input type="text" placeholder="${esc(s('admin.subcatDescEN') || 'Description (EN)')}" value="${esc(descEN)}"
        style="font-size:12px" data-field="descEN">
      <input type="text" placeholder="${esc(s('admin.subcatDescIS') || 'Description (IS)')}" value="${esc(descIS)}"
        style="font-size:12px" data-field="descIS">
    </div>
    <div>
      <label style="font-size:9px;color:var(--muted);letter-spacing:.6px;display:block;margin-bottom:2px">ISSUING AUTHORITY</label>
      <input type="text" placeholder="e.g. World Sailing" value="${esc(sc?.issuingAuthority || "")}"
        style="width:100%;box-sizing:border-box;font-size:12px" data-field="issuingAuthority">
    </div>`;
  document.getElementById("subcatRows").appendChild(row);
}

function gatherSubcats() {
  return [...document.querySelectorAll("#subcatRows .list-row")].map(row => {
    const labelEN = row.querySelector('[data-field="labelEN"]').value.trim();
    const labelIS = row.querySelector('[data-field="labelIS"]').value.trim();
    const descEN  = row.querySelector('[data-field="descEN"]').value.trim();
    const descIS  = row.querySelector('[data-field="descIS"]').value.trim();
    return {
      key:              labelEN.toLowerCase().replace(/\s+/g, "_"),
      // New bilingual fields:
      labelEN,
      labelIS,
      descriptionEN:    descEN,
      descriptionIS:    descIS,
      // Legacy mirrors:
      label:            labelEN,
      description:      descEN,
      rank:             parseInt(row.querySelector('[data-field="rank"]').value) || null,
      issuingAuthority: row.querySelector('[data-field="issuingAuthority"]').value.trim(),
    };
  }).filter(sc => sc.labelEN);
}

// ══ ALERT SETTINGS ════════════════════════════════════════════════════════════

