// Race the network with the rest of init.
prefetch({ Maintenance: ['getMaintenance'], Config: ['getConfig'] });

// ── State ──────────────────────────────────────────────────────────────────────
let allRequests = [];
window.allRequests = allRequests;
let boats = [];
let selectedCat = "";
let selectedSev = "";
let photoDataUrl = "";
let pendingPhotoFile = null;
let pendingMaterials = [];
let isSaumaMode = false;
let editingId = "";

// Filter state lives inside _maintFilter (shared/list-filter.js). activeFilters
// is kept as an alias onto that state so the existing pill-update code keeps
// working without threading the controller through everything.
let _maintFilter = null;
let activeFilters = null;

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  buildHeader('maintenance');
  applyStrings();
  initMaintFilter();

  try {
    const [rRes, cfgRes] = await Promise.all([
      apiGet("getMaintenance"),
      apiGet("getConfig"),
    ]);
    allRequests = rRes.requests || [];
    window.allRequests = allRequests;
    window._maintUser = window.user;
    boats = (cfgRes.boats || []).filter(b => b.active !== false && b.active !== "false");
    populateBoatSelect();
    renderStats();
    updateFilterUI();
    _maintFilter.refresh();  // predicate + render in one shot
  } catch(e) {
    document.getElementById("reqList").innerHTML =
      `<div class="empty-wrap"><div class="empty-icon">${icon('triangle-alert')}</div><p>${esc(s('maint.loadFailed',{msg:e.message}))}</p></div>`;
  }

  // Wire filter pill clicks via delegation
  document.getElementById('filterBar').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn || btn.classList.contains('muted')) return;
    toggleFilter(btn.dataset.group, btn.dataset.value);
  });

  // Auto-open new request modal if navigated here with ?new=1 or ?prefillBoat=<id>
  const _qs = new URLSearchParams(window.location.search);
  if (_qs.get("new") === "1") {
    openNewRequest();
  } else if (_qs.get("prefillBoat")) {
    openNewRequest({ category: 'boat', boatId: _qs.get("prefillBoat") });
  }
});

// ── Boat select ────────────────────────────────────────────────────────────────
function populateBoatSelect() {
  const sel = document.getElementById("newBoat");
  boats.forEach(b => {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.name + (b.category ? " (" + b.category + ")" : "");
    sel.appendChild(o);
  });
}

// ── Stats ──────────────────────────────────────────────────────────────────────
function renderStats() {
  const open     = allRequests.filter(r => !boolVal(r.resolved));
  const critical = open.filter(r => r.severity === "critical");
  const oosBoatIds = new Set(
    open.filter(r => boolVal(r.markOos) && r.category === "boat" && r.boatId)
        .map(r => r.boatId)
  );
  const pending  = allRequests.filter(r => boolVal(r.saumaklubbur) && !boolVal(r.approved) && !boolVal(r.resolved));
  const resolved = allRequests.filter(r => boolVal(r.resolved));
  document.getElementById("statOpen").textContent     = open.length;
  document.getElementById("statCritical").textContent = critical.length;
  document.getElementById("statOos").textContent      = oosBoatIds.size;
  document.getElementById("statPending").textContent  = pending.length;
  document.getElementById("statResolved").textContent = resolved.length;

  // Pending review alert banner
  const alertEl = document.getElementById("pendingReviewAlert");
  if (alertEl) {
    if (pending.length > 0) {
      document.getElementById("pendingReviewAlertText").textContent =
        s('maint.pendingReviewAlert', { count: pending.length });
      alertEl.classList.remove("hidden");
    } else {
      alertEl.classList.add("hidden");
    }
  }
}

// Activate the "pending review" sauma filter so only awaiting-approval projects show
function showPendingReviews() {
  activeFilters.status = new Set(['open']);
  activeFilters.type   = new Set(['sauma']);
  activeFilters.sauma  = new Set(['pending']);
  updateFilterUI();
  // Reflect the active status pill in the DOM
  document.querySelectorAll('#filterBar .filter-btn').forEach(btn => {
    const g = btn.dataset.group, v = btn.dataset.value;
    btn.classList.toggle('active',
      (g==='status' && v==='open') ||
      (g==='type' && v==='sauma') ||
      (g==='sauma' && v==='pending'));
  });
  renderList();
  document.getElementById('reqList')?.scrollIntoView({behavior:'smooth',block:'start'});
}

// ── Filter setup & render ─────────────────────────────────────────────────────
function initMaintFilter() {
  _maintFilter = createListFilter({
    source: () => allRequests || [],
    filters: {
      status:   new Set(['open']),
      type:     new Set(),
      category: new Set(),
      severity: new Set(),
      sauma:    new Set(),
    },
    predicate: (r, f) => {
      const resolved = boolVal(r.resolved);
      const isSauma  = boolVal(r.saumaklubbur);
      const anyActive = ['status','type','category','severity','sauma'].some(k => f[k] && f[k].size > 0);
      const userName = window._maintUser?.name || '';

      // Default: no selections = show open items.
      if (!anyActive) return !resolved;

      if (f.status.size > 0) {
        const ok = (f.status.has('open') && !resolved) || (f.status.has('resolved') && resolved);
        if (!ok) return false;
      }
      if (f.type.size > 0) {
        const ok = (f.type.has('sauma') && isSauma) || (f.type.has('maintenance') && !isSauma);
        if (!ok) return false;
      }
      if (f.category.size > 0 && !f.category.has(r.category)) return false;
      if (f.severity.size > 0 && !f.severity.has(r.severity)) return false;
      if (f.sauma.size > 0) {
        if (!isSauma) return false;
        const matchUn      = f.sauma.has('unassigned') && !r.verkstjori;
        const matchMy      = f.sauma.has('myprojects') && (r.verkstjori === userName || parseJson(r.comments,[]).some(c => c.by === userName));
        const matchPending = f.sauma.has('pending')    && !boolVal(r.approved);
        if (!matchUn && !matchMy && !matchPending) return false;
      }
      return true;
    },
    render: renderMaintList,
  });
  activeFilters = _maintFilter.state();  // live alias used by updateFilterUI()
}

function toggleFilter(group, value) {
  _maintFilter.toggleSetMember(group, value);  // triggers re-render
  updateFilterUI();
}

// Back-compat: anything that used to call renderList() now just re-runs the
// filter pipeline. New code should prefer _maintFilter.refresh().
function renderList() { if (_maintFilter) _maintFilter.refresh(); }

function updateFilterUI() {
  const tf = activeFilters.type;
  const onlySauma = tf.has('sauma') && !tf.has('maintenance');
  const onlyMaint = tf.has('maintenance') && !tf.has('sauma');

  document.querySelectorAll('#filterBar .filter-btn').forEach(btn => {
    const g = btn.dataset.group, v = btn.dataset.value;
    btn.classList.toggle('active', activeFilters[g].has(v));
    let muted = false;
    if (onlySauma && g === 'severity' && v === 'critical') muted = true;
    if (onlyMaint && g === 'sauma') muted = true;
    btn.classList.toggle('muted', muted);
    if (muted && activeFilters[g].has(v)) {
      activeFilters[g].delete(v);
      btn.classList.remove('active');
    }
  });
}

function renderMaintList(items) {
  const el = document.getElementById("reqList");
  if (!items.length) {
    el.innerHTML = `<div class="empty-wrap"><div class="empty-icon">${icon('wrench')}</div><p>${s('maint.noFilterMatch')}</p></div>`;
    return;
  }
  const sevOrder = { critical:0, high:1, medium:2, low:3 };
  items.sort((a,b) => {
    const ra = boolVal(a.resolved), rb = boolVal(b.resolved);
    if (!ra && rb) return -1;
    if (ra && !rb) return 1;
    const sa = sevOrder[a.severity]??9, sb = sevOrder[b.severity]??9;
    if (sa !== sb) return sa - sb;
    return (b.createdAt||"") > (a.createdAt||"") ? 1 : -1;
  });
  el.innerHTML = items.map(r => renderCard(r)).join("");
  el.onclick = e => {
    const card = e.target.closest('.maint-card-clickable');
    if (!card) return;
    const r = allRequests.find(x => x.id === card.dataset.id);
    if (r) maintOpenDetail(r, window._maintUser?.name);
  };
}

function renderCard(r) {
  return '<div class="maint-card-clickable" data-id="' + esc(r.id||'') + '">'
    + maintRenderCard(r)
    + '</div>';
}

// ── Actions ────────────────────────────────────────────────────────────────────
async function resolveRequest(id) {
  if (!await ymConfirm(s('maint.resolveConfirm'))) return;
  const r = allRequests.find(x => x.id === id);
  if (!r) return;
  try {
    await apiPost("resolveMaintenance", { id, resolvedBy: (window._maintUser?.name||'Staff') });
    r.resolved = true; r.resolvedBy = (window._maintUser?.name||'Staff'); r.resolvedAt = new Date().toISOString();
    if (boolVal(r.markOos) && r.boatId) {
      try {
        const cfgR = await apiGet("getConfig");
        const allBoats = cfgR.boats || [];
        const bi = allBoats.findIndex(b => b.id === r.boatId);
        if (bi >= 0) allBoats[bi] = { ...allBoats[bi], oos: false, oosReason: "" };
        await apiPost("saveConfig", { boats: allBoats });
        boats = allBoats.filter(b => b.active !== false && b.active !== "false");
      } catch(e2) { console.warn("Could not clear OOS:", e2.message); }
    }
    renderStats(); renderList(); toast(s('maint.resolvedToast'));
  } catch(e) { ymAlert(s('logbook.errGeneric',{msg:e.message})); }
}

async function addComment(id) {
  const input = document.getElementById("ci-" + id);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  try {
    await apiPost("addMaintenanceComment", { id, by: (window._maintUser?.name || 'Staff'), text });
    const r = allRequests.find(x => x.id === id);
    if (r) {
      const comments = parseJson(r.comments, []);
      comments.push({ by: (window._maintUser?.name || 'Staff'), at: new Date().toISOString(), text });
      r.comments = JSON.stringify(comments);
    }
    renderList(); toast(s('maint.commentAdded'));
  } catch(e) { ymAlert(s('logbook.errGeneric',{msg:e.message})); }
}

function viewPhoto(url) {
  document.getElementById("overlayImg").src = url;
  document.getElementById("photoOverlay").classList.remove("hidden");
}

// ── New request modal ──────────────────────────────────────────────────────────
function openNewRequest(prefill) {
  selectedCat = ""; selectedSev = ""; photoDataUrl = ""; pendingPhotoFile = null;
  editingId = "";
  isSaumaMode = !!(prefill && prefill.saumaklubbur);
  ["newPart","newDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("newBoat").value = "";
  document.getElementById("newOos").checked = false;
  document.getElementById("newPhoto").value = "";
  document.getElementById("photoPreview").className = "photo-preview";
  document.getElementById("photoErr").textContent = "";
  document.getElementById("newErr").classList.add("hidden");
  document.querySelectorAll(".sev-btn").forEach(b => b.classList.remove("selected"));
  document.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("selected"));
  document.getElementById("sevHint").textContent = "";
  document.getElementById("boatField").classList.add("hidden");
  document.getElementById("newVerkstjori").value = "";
  document.getElementById("materialsList").innerHTML = "";
  document.getElementById("newMaterialInput").value = "";
  pendingMaterials = [];

  // Two-mode modal
  document.getElementById("newSaumaklubbur").value = isSaumaMode ? "true" : "false";
  document.getElementById("modalTitle").textContent = isSaumaMode
    ? s('sauma.suggestTitle') : s('maint.newTitle');
  document.getElementById("sevLabel").textContent = isSaumaMode ? s('maint.priority') : s('maint.severity');
  document.querySelector('.sev-btn[data-sev="critical"]').classList.toggle("hidden", isSaumaMode);
  document.getElementById("oosField").classList.toggle("hidden", isSaumaMode);
  document.getElementById("verkstjoriField").classList.toggle("hidden", !isSaumaMode);
  document.getElementById("materialsField").classList.toggle("hidden", !isSaumaMode);

  if (prefill) {
    if (prefill.category)    selectCat(prefill.category);
    if (prefill.boatId)      document.getElementById("newBoat").value = prefill.boatId;
    if (prefill.severity)    selectSev(prefill.severity);
    if (prefill.description) document.getElementById("newDesc").value = prefill.description;
  }
  openModal("newModal");
}

function closeNewModal() {
  closeModal("newModal");
  editingId = "";
}

// ── Edit request modal ─ reuses #newModal, prefilled from an existing record
function openEditRequest(r) {
  if (!r || !r.id) return;
  openNewRequest({
    saumaklubbur: boolVal(r.saumaklubbur),
    category:     r.category || '',
    boatId:       r.boatId || '',
    severity:     r.severity || '',
    description:  r.description || '',
  });
  editingId = r.id;
  document.getElementById("modalTitle").textContent = s('maint.editTitle');
  document.getElementById("newPart").value = r.part || '';
  document.getElementById("newOos").checked = boolVal(r.markOos);
  if (isSaumaMode) {
    document.getElementById("newVerkstjori").value = r.verkstjori || '';
    pendingMaterials = parseJson(r.materials, []);
    renderMaterialsList();
  }
  if (r.photoUrl) {
    photoDataUrl = r.photoUrl;
    const preview = document.getElementById("photoPreview");
    preview.src = driveImageUrl(r.photoUrl);
    preview.className = "photo-preview show";
  }
}

// Expose for the shared detail modal's Edit button
window.maintOpenEdit = openEditRequest;

function selectCat(cat) {
  selectedCat = cat;
  document.querySelectorAll(".cat-btn").forEach(b => b.classList.toggle("selected", b.dataset.cat === cat));
  document.getElementById("boatField").classList.toggle("hidden", cat !== "boat");
}

function selectSev(sev) {
  selectedSev = sev;
  document.querySelectorAll(".sev-btn").forEach(b => b.classList.toggle("selected", b.dataset.sev === sev));
  document.getElementById("sevHint").textContent = SEV_HINTS[sev] || "";
  if (sev === "critical" && selectedCat === "boat") {
    document.getElementById("newOos").checked = true;
  }
}

function handlePhotoChange(input) {
  const file = input.files[0];
  const errEl = document.getElementById("photoErr");
  const preview = document.getElementById("photoPreview");
  if (!file) { photoDataUrl = ""; pendingPhotoFile = null; preview.className = "photo-preview"; return; }
  if (file.size > 5 * 1024 * 1024) {
    errEl.textContent = s('maint.imgTooLarge',{size:(file.size/1024/1024).toFixed(1)});
    input.value = ""; photoDataUrl = ""; pendingPhotoFile = null; preview.className = "photo-preview"; return;
  }
  errEl.textContent = "";
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1400;
      if (img.width <= maxW) { photoDataUrl = e.target.result; }
      else {
        const canvas = document.createElement("canvas");
        const ratio = maxW / img.width;
        canvas.width = maxW; canvas.height = Math.round(img.height * ratio);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        photoDataUrl = canvas.toDataURL("image/jpeg", 0.82);
      }
      pendingPhotoFile = { fileName: file.name, fileData: photoDataUrl, mimeType: file.type || 'image/jpeg' };
      preview.src = photoDataUrl;
      preview.className = "photo-preview show";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function addMaterialToList() {
  const input = document.getElementById("newMaterialInput");
  const name = (input.value || "").trim();
  if (!name) return;
  pendingMaterials.push({ name, purchased: false });
  input.value = "";
  renderMaterialsList();
}
function removeMaterial(idx) {
  pendingMaterials.splice(idx, 1);
  renderMaterialsList();
}
function renderMaterialsList() {
  const el = document.getElementById("materialsList");
  el.innerHTML = pendingMaterials.map((m,i) =>
    `<div class="flex-center gap-6 text-md" style="padding:4px 0">
      <span class="flex-1">${esc(m.name)}</span>
      <button type="button" class="btn-dismiss" data-mt-click="removeMaterial" data-mt-arg="${i}">&times;</button>
    </div>`
  ).join("");
}

async function submitRequest() {
  const btn = document.getElementById("submitBtn");
  document.getElementById("newErr").classList.add("hidden");

  if (!selectedCat) { showErr(s('maint.errCategory')); return; }
  if (!selectedSev) { showErr(s('maint.errSeverity')); return; }
  const desc = document.getElementById("newDesc").value.trim();
  if (!desc) { showErr(s('maint.errDescription')); return; }

  let boatId = "", boatName = "", markOos = false;
  if (selectedCat === "boat") {
    const sel = document.getElementById("newBoat");
    boatId = sel.value;
    boatName = sel.selectedOptions[0]?.text?.split(" (")[0] || "";
    if (!boatId) { showErr(s('maint.errBoat')); return; }
    markOos = document.getElementById("newOos").checked;
  }

  btn.disabled = true; btn.textContent = s('maint.submitting');
  try {
    let photoUrl = photoDataUrl && photoDataUrl.indexOf('data:') !== 0 ? photoDataUrl : "";
    if (pendingPhotoFile) {
      btn.textContent = s('maint.uploadingPhoto');
      const upRes = await apiPost("uploadMaintenancePhoto", pendingPhotoFile);
      if (upRes.ok) photoUrl = upRes.photoUrl;
      else console.warn("Photo upload skipped:", upRes.error);
    }
    const partVal = document.getElementById("newPart").value.trim();
    if (editingId) {
      const updatePayload = {
        id: editingId,
        category: selectedCat, boatId, boatName,
        part:        partVal,
        severity:    selectedSev,
        description: desc,
        markOos,
        verkstjori:  isSaumaMode ? document.getElementById("newVerkstjori").value.trim() : '',
        materials:   isSaumaMode ? JSON.stringify(pendingMaterials || []) : '',
      };
      if (photoUrl) updatePayload.photoUrl = photoUrl;
      await apiPost("saveMaintenance", updatePayload);
    } else {
      await apiPost("saveMaintenance", {
        category: selectedCat, boatId, boatName, itemName: '',
        part:        partVal,
        severity:    selectedSev,
        description: desc,
        markOos,
        photoUrl,
        reportedBy:  (window._maintUser?.name||'Staff'),
        source:      "staff",
        saumaklubbur: isSaumaMode,
        verkstjori:  isSaumaMode ? document.getElementById("newVerkstjori").value.trim() : '',
        materials:   isSaumaMode && pendingMaterials.length ? JSON.stringify(pendingMaterials) : '',
      });
    }
    if (markOos && boatId) {
      try {
        const cfgR2 = await apiGet("getConfig");
        const allB2 = cfgR2.boats || [];
        const bi2 = allB2.findIndex(function(b) { return b.id === boatId; });
        if (bi2 >= 0) { allB2[bi2] = Object.assign({}, allB2[bi2], { oos: true, oosReason: desc.slice(0,80) }); }
        await apiPost("saveConfig", { boats: allB2 });
        boats = allB2.filter(function(b) { return b.active !== false && b.active !== "false"; });
      } catch(e3) { console.warn("Could not set OOS:", e3.message); }
    }
    const wasEditing = editingId;
    closeNewModal();
    const rRes = await apiGet("getMaintenance");
    allRequests = rRes.requests || [];
    window.allRequests = allRequests;
    renderStats(); renderList();
    toast(s(wasEditing ? 'maint.updated' : 'maint.submitted'));
  } catch(e) {
    showErr(s('logbook.errGeneric',{msg:e.message}));
  } finally {
    btn.disabled = false; btn.textContent = s('maint.submitBtn');
  }
}

function showErr(msg) {
  const el = document.getElementById("newErr");
  el.textContent = msg; el.classList.remove("hidden");
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "msg msg-ok";
  el.textContent = msg;
  el.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);min-width:200px;text-align:center;z-index:9999;font-size:12px;padding:10px 16px;border-radius:8px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function boolVal(v) { return v===true||v==="true"||v==="TRUE"||v===1||v==="1"; }
function parseJson(v, fallback) { if(!v) return fallback; try { return typeof v==="string"?JSON.parse(v):v; } catch(e){ return fallback; } }
function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function _openSaumaRequest() { openNewRequest({ saumaklubbur: true }); }

(function () {
  if (typeof document === 'undefined' || document._mtListeners) return;
  document._mtListeners = true;
  document.addEventListener('click', function (e) {
    var hs = e.target.closest('[data-mt-hide-self]');
    if (hs) { hs.classList.add('hidden'); return; }
    var cs = e.target.closest('[data-mt-close-self]');
    if (cs && e.target === cs) { closeNewModal(); return; }
    var c = e.target.closest('[data-mt-click]');
    if (c && typeof window[c.dataset.mtClick] === 'function') {
      window[c.dataset.mtClick](c.dataset.mtArg);
    }
  });
  document.addEventListener('change', function (e) {
    var ce = e.target.closest('[data-mt-change-el]');
    if (ce && typeof window[ce.dataset.mtChangeEl] === 'function') window[ce.dataset.mtChangeEl](ce);
  });
})();
