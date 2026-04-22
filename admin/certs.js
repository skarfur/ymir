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

function renderCertDefs() {
  const el = document.getElementById("certDefsCard");
  if (!el) return;
  if (!certDefs.length) {
    el.innerHTML = `<div class="empty-state">${s('admin.noCertDefs')}</div>`;
    return;
  }
  const locale = getLang() === 'IS' ? 'is' : 'en';
  const sortedCertDefs = certDefs.slice().sort((a, b) =>
    certDefName(a).localeCompare(certDefName(b), locale, { sensitivity: 'base' })
  );
  const certifications = sortedCertDefs.filter(d => !d.clubEndorsement);
  const endorsements   = sortedCertDefs.filter(d => !!d.clubEndorsement);

  function certDefRow(d) {
    const authority = d.issuingAuthority
      ? `<span style="color:var(--muted)"> · ${esc(d.issuingAuthority)}</span>` : "";
    const catObj = d.category ? certCategoryByKey(certCategories, d.category) : null;
    const catLabel = catObj ? certCategoryLabel(catObj) : d.category;
    const catStr = d.category
      ? `<span style="color:var(--brass-fg);font-size:10px">[${esc(catLabel)}]</span> ` : "";
    const expiryStr = d.expires
      ? `<span style="color:var(--muted)"> · expires</span>` : "";
    const nameEN = d.nameEN || d.name || '';
    const nameIS = d.nameIS || '';
    const name   = certDefName(d);
    const altName = (getLang() === 'IS' && nameEN && nameEN !== name) ? nameEN
                    : (getLang() === 'EN' && nameIS && nameIS !== name) ? nameIS
                    : '';
    const altHtml = altName
      ? `<span style="color:var(--muted);font-size:11px;margin-left:6px">${esc(altName)}</span>` : '';
    const subcatStr = d.subcats?.length
      ? d.subcats.map(sc => {
          const parts = [certSubcatLabel(sc)];
          if (sc.rank != null) parts.push(`rank ${sc.rank}`);
          if (sc.issuingAuthority) parts.push(sc.issuingAuthority);
          return parts.join(" · ");
        }).join(", ")
      : s('admin.noSubcategories');
    const descStr = certDefDescription(d);
    return `<div class="list-row">
      <div style="flex:1">
        <div class="list-name">${catStr}${esc(name)}${altHtml}${authority}${expiryStr}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${esc(subcatStr)}</div>
        ${descStr ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;font-style:italic">${esc(descStr)}</div>` : ""}
      </div>
      <button class="row-edit" data-admin-click="openCertDefModal" data-admin-arg="${d.id}">Edit</button>
      <button class="row-del"  data-admin-click="deleteCertDefById" data-admin-arg="${d.id}" title="Delete">×</button>
    </div>`;
  }

  let html = '';
  if (certifications.length) {
    html += `<div style="font-size:9px;color:var(--muted);letter-spacing:1.2px;margin:8px 0 6px">${s('admin.certTypes')}</div>`;
    html += certifications.map(certDefRow).join('');
  }
  if (endorsements.length) {
    html += `<div style="font-size:9px;color:var(--muted);letter-spacing:1.2px;margin:${certifications.length ? '16' : '8'}px 0 6px">${s('cert.clubEndorsements')}</div>`;
    html += endorsements.map(certDefRow).join('');
  }
  el.innerHTML = html;
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

