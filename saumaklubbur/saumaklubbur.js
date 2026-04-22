
let allProjects = [];
let currentFilter = "open";
let currentView = "list";
let currentUserName = "";
let currentUserKt = "";
let boats = [];

// Suggest modal state
let suggestCat = "";
let suggestPrio = "";
let suggestPhotoData = null;
let suggestMaterials = [];
let suggestEditingId = "";
let suggestExistingPhotoUrl = "";

document.addEventListener("DOMContentLoaded", async () => {
  const user = requireAuth();
  if (!user) return;
  currentUserName = user.name || "";
  currentUserKt = user.kennitala || "";
  window._maintUser = user;

  buildHeader('saumaklubbur');
  applyStrings();

  try {
    const [rRes, cfgRes] = await Promise.all([
      apiGet("getMaintenance"),
      apiGet("getConfig"),
    ]);
    const all = rRes.requests || [];
    // Members only see approved projects (or their own pending ones)
    allProjects = all.filter(r => boolVal(r.saumaklubbur) && (boolVal(r.approved) || r.reportedBy === currentUserName));
    boats = (cfgRes.boats || []).filter(b => b.active !== false && b.active !== "false");
    populateBoatSelect();
    renderList();
  } catch(e) {
    document.getElementById("projectList").innerHTML =
      `<div class="empty-wrap"><div class="empty-icon">⚠️</div><p>${esc(s('sauma.loadFailed',{msg:e.message}))}</p></div>`;
  }

  warmContainer();
});

function populateBoatSelect() {
  const sel = document.getElementById("suggestBoat");
  boats.forEach(b => {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.name + (b.category ? " (" + b.category + ")" : "");
    sel.appendChild(o);
  });
}

// ── Filters ──────────────────────────────────────────────────────────────────

function setView(view) {
  currentView = view;
  document.getElementById('viewListBtn').classList.toggle('active', view === 'list');
  document.getElementById('viewBoardBtn').classList.toggle('active', view === 'board');
  document.getElementById('projectList').classList.toggle('hidden', view === 'board');
  document.getElementById('kanbanBoard').classList.toggle('hidden', view === 'list');
  document.getElementById('filterBar').classList.toggle('hidden', view === 'board');
  document.getElementById('boardMyFilter').classList.toggle('hidden', view === 'list');
  document.querySelector('.page-wrap').classList.toggle('wide-board', view === 'board');
  if (view === 'board') renderBoard();
  else renderList();
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll(".filter-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.filter === f));
  renderList();
}

function getFiltered() {
  return allProjects.filter(r => {
    const resolved = boolVal(r.resolved);
    if (currentFilter === "open")       return !resolved;
    if (currentFilter === "completed")  return resolved;
    if (currentFilter === "unassigned") return !resolved && !r.verkstjori;
    if (currentFilter === "onhold")     return !resolved && boolVal(r.onHold);
    if (currentFilter === "my")         return isMyProject(r);
    return true;
  });
}

function _isFollowing(r) {
  var followers = parseJson(r.followers, []);
  return followers.some(function(f) { return String(f.kt || f) === String(currentUserKt); });
}

function isMyProject(r) {
  if (!currentUserName) return false;
  if (r.verkstjori && r.verkstjori === currentUserName) return true;
  if (_isFollowing(r)) return true;
  const comments = parseJson(r.comments, []);
  return comments.some(c => c.by === currentUserName);
}

function renderList() {
  const items = getFiltered();
  const el = document.getElementById("projectList");
  if (!items.length) {
    const key = currentFilter === "my" ? "sauma.emptyMy" : "sauma.emptyDefault";
    el.innerHTML = `<div class="empty-wrap"><div class="empty-icon">🧵</div><p data-s="${key}">No projects match this filter.</p></div>`;
    applyStrings();
    return;
  }

  // Sort: newest comment first, then by creation date
  items.sort((a,b) => {
    const ra = boolVal(a.resolved), rb = boolVal(b.resolved);
    if (!ra && rb) return -1;
    if (ra && !rb) return 1;
    const aComments = parseJson(a.comments, []);
    const bComments = parseJson(b.comments, []);
    const aLast = aComments.length ? (aComments[aComments.length-1].at || '') : '';
    const bLast = bComments.length ? (bComments[bComments.length-1].at || '') : '';
    if (aLast || bLast) {
      if (aLast > bLast) return -1;
      if (bLast > aLast) return 1;
    }
    return (b.createdAt||"") > (a.createdAt||"") ? 1 : -1;
  });

  el.innerHTML = items.map(r => renderProjectCard(r)).join("");
  el.onclick = e => {
    const card = e.target.closest('.sauma-card');
    if (!card) return;
    const r = allProjects.find(x => x.id === card.dataset.id);
    if (r) maintOpenDetail(r, currentUserName);
  };
  if (currentView === 'board') renderBoard();
}

function renderProjectCard(r) {
  const resolved  = boolVal(r.resolved);
  const sevClass  = 'sev-' + (r.severity||'low');
  const catIcon   = CAT_ICON[r.category] || '⚙️';
  const subjectLabel = r.category==='boat'
    ? esc(r.boatName||r.boatId||'')
    : '';
  const comments = parseJson(r.comments, []);
  const materials = parseJson(r.materials, []);
  const matDone = materials.filter(m=>m.purchased).length;
  const following = _isFollowing(r);
  const commentCount = comments.length;
  const lastComment = commentCount ? comments[commentCount-1] : null;

  return `<div class="sauma-card req-card ${sevClass}${resolved?' resolved':''}" data-id="${esc(r.id||'')}">
    <div class="req-header">
      <div class="flex-1" style="min-width:0">
        <div class="req-title">
          ${catIcon} ${subjectLabel ? subjectLabel : ''}${subjectLabel && r.part ? `<span class="text-muted text-md" style="font-weight:400"> · ${esc(r.part)}</span>` : ''}${!subjectLabel && r.part ? esc(r.part) : ''}${!subjectLabel && !r.part ? esc(maintTitleFallback_(r)) : ''}
        </div>
        <div class="req-meta">
          <span class="badge ${SEV_BADGE[r.severity]||'badge-green'}">${r.severity||'low'}</span>
          ${boolVal(r.onHold) && !resolved ? `<span class="badge badge-yellow">⏸ ${s('maint.onHoldBadge')}</span>` : ''}
          ${r.verkstjori
            ? `<span class="verk-tag">${s('sauma.verkstjoriLabel')} ${esc(r.verkstjori)}</span>`
            : `<span class="text-sm text-muted" style="font-style:italic">${s('sauma.needsVerkstjori')}</span>`}
          ${materials.length ? `<span>📦 ${matDone}/${materials.length}</span>` : ''}
          ${r.reportedBy ? `<span>${esc(r.reportedBy)}</span>` : ''}
          ${r.createdAt  ? `<span>${sstr(r.createdAt).slice(0,10)}</span>` : ''}
        </div>
      </div>
    </div>
    ${r.description ? `<div class="req-desc">${esc(r.description)}</div>` : ''}
    ${r.photoUrl ? `<img class="req-photo" src="${esc(driveImageUrl(r.photoUrl))}" data-sk-view-photo="${esc(driveImageUrl(r.photoUrl))}">` : ''}
    <div class="flex-center gap-8 mt-8 text-sm text-muted">
      ${following ? '<span style="color:var(--brass-fg)" title="' + s('sauma.unfollow') + '">★</span>' : ''}
      <span>💬 ${commentCount}</span>
      ${lastComment ? `<span>· ${esc(lastComment.by||'')} · ${sstr(lastComment.at).slice(0,16).replace('T',' ')}</span>` : ''}
    </div>
    ${!boolVal(r.approved) && !resolved ? `<div class="mt-8 text-sm text-brass" style="font-style:italic">${s('sauma.pendingReview')}</div>` : ''}
    ${resolved ? `<div class="mt-8 text-sm text-muted">${s('sauma.completedBy',{date:sstr(r.resolvedAt).slice(0,10),by:esc(r.resolvedBy||'')})}</div>` : ''}
  </div>`;
}

function viewPhoto(url) {
  document.getElementById("overlayImg").src = url;
  document.getElementById("photoOverlay").classList.remove("hidden");
}

// ── Kanban board ─────────────────────────────────────────────────────────────

function getProjectColumn(r) {
  if (boolVal(r.resolved))                        return 'done';
  if (boolVal(r.onHold))                           return 'onhold';
  if (r.verkstjori)                                return 'inprogress';
  return 'todo';
}

function renderBoard() {
  const myOnly = document.getElementById('boardMyOnly')?.checked;
  const projects = myOnly ? allProjects.filter(isMyProject) : allProjects;

  const columns = {
    todo:       { key: 'sauma.colTodo',       items: [] },
    inprogress: { key: 'sauma.colInProgress', items: [] },
    onhold:     { key: 'sauma.colOnHold',     items: [] },
    done:       { key: 'sauma.colDone',       items: [] },
  };

  projects.forEach(r => {
    const col = getProjectColumn(r);
    columns[col].items.push(r);
  });

  const sevOrder = { high: 0, medium: 1, low: 2 };
  Object.values(columns).forEach(col => {
    col.items.sort((a, b) =>
      (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2)
      || ((b.createdAt || '') > (a.createdAt || '') ? 1 : -1));
  });

  const board = document.getElementById('kanbanBoard');
  board.innerHTML = Object.entries(columns).map(([id, col]) => `
    <div class="kanban-col" data-col="${id}">
      <div class="kanban-col-header">
        <span data-s="${col.key}">${s(col.key)}</span>
        <span class="col-count">${col.items.length}</span>
      </div>
      <div class="kanban-col-body">
        ${col.items.length
          ? col.items.map(r => renderKanbanCard(r)).join('')
          : `<div class="kanban-empty" data-s="sauma.colEmpty">${s('sauma.colEmpty')}</div>`}
      </div>
    </div>
  `).join('');

  board.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('click', () => {
      const r = allProjects.find(x => x.id === card.dataset.id);
      if (r) maintOpenDetail(r, currentUserName);
    });
  });
}

function renderKanbanCard(r) {
  const sevClass = 'sev-' + (r.severity || 'low');
  const onHold   = boolVal(r.onHold) && !boolVal(r.resolved);
  const catIcon  = CAT_ICON[r.category] || '⚙️';
  const subject  = r.category === 'boat'
    ? esc(r.boatName || r.boatId || '')
    : '';
  const comments  = parseJson(r.comments, []);
  const materials = parseJson(r.materials, []);
  const matDone   = materials.filter(m => m.purchased).length;

  return `<div class="kanban-card ${sevClass}${onHold ? ' on-hold' : ''}" data-id="${esc(r.id || '')}">
    <div class="kc-title">${catIcon} ${subject ? subject + (r.part ? ' · ' + esc(r.part) : '') : (r.part ? esc(r.part) : esc(maintTitleFallback_(r)))}</div>
    <div class="kc-meta">
      <span class="badge ${SEV_BADGE[r.severity] || 'badge-green'}" style="font-size:9px;padding:1px 5px">${r.severity || 'low'}</span>
      ${onHold ? `<span class="badge badge-yellow" style="font-size:9px;padding:1px 5px">⏸</span>` : ''}
      ${r.verkstjori ? `<span class="verk-tag" style="font-size:10px">${esc(r.verkstjori)}</span>` : ''}
      ${materials.length ? `<span>📦 ${matDone}/${materials.length}</span>` : ''}
      ${comments.length ? `<span>💬 ${comments.length}</span>` : ''}
      ${_isFollowing(r) ? '<span style="color:var(--brass-fg)">★</span>' : ''}
    </div>
  </div>`;
}

// ── Suggest modal ──────────────────────────────────────────────────────────────

function openSuggestModal() {
  suggestCat = ""; suggestPrio = ""; suggestPhotoData = null; suggestMaterials = [];
  suggestEditingId = ""; suggestExistingPhotoUrl = "";
  ["suggestPart","suggestDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("suggestBoat").value = "";
  document.getElementById("suggestPhoto").value = "";
  document.getElementById("suggestPhotoPreview").className = "photo-preview";
  document.getElementById("suggestPhotoErr").textContent = "";
  document.getElementById("suggestErr").classList.add("hidden");
  document.getElementById("suggestMaterialsList").innerHTML = "";
  document.getElementById("suggestMaterialInput").value = "";
  document.querySelectorAll(".prio-btn").forEach(b => b.classList.remove("selected"));
  document.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("selected"));
  document.getElementById("boatField").classList.add("hidden");
  const titleEl = document.querySelector('#suggestModal h3');
  if (titleEl) titleEl.textContent = s('sauma.suggestTitle');
  openModal("suggestModal");
}

function closeSuggestModal() { closeModal("suggestModal"); suggestEditingId = ""; }

// ── Edit mode ─ reuses #suggestModal, prefilled from an existing record
function openEditProject(r) {
  if (!r || !r.id) return;
  openSuggestModal();
  suggestEditingId = r.id;
  selectCat(r.category || '');
  if (r.boatId) document.getElementById("suggestBoat").value = r.boatId;
  document.getElementById("suggestPart").value = r.part || '';
  document.getElementById("suggestDesc").value = r.description || '';
  if (r.severity) selectPrio(r.severity);
  suggestMaterials = parseJson(r.materials, []);
  renderSuggestMaterials();
  if (r.photoUrl) {
    suggestExistingPhotoUrl = r.photoUrl;
    const preview = document.getElementById("suggestPhotoPreview");
    preview.src = driveImageUrl(r.photoUrl);
    preview.className = "photo-preview show";
  }
  const titleEl = document.querySelector('#suggestModal h3');
  if (titleEl) titleEl.textContent = s('maint.editTitle');
}

// Expose for the shared detail modal's Edit button
window.maintOpenEdit = openEditProject;

function selectCat(cat) {
  suggestCat = cat;
  document.querySelectorAll(".cat-btn").forEach(b => b.classList.toggle("selected", b.dataset.cat === cat));
  document.getElementById("boatField").classList.toggle("hidden", cat !== "boat");
}

function selectPrio(sev) {
  suggestPrio = sev;
  document.querySelectorAll(".prio-btn").forEach(b => b.classList.toggle("selected", b.dataset.sev === sev));
}

function addSuggestMaterial() {
  const input = document.getElementById("suggestMaterialInput");
  const name = (input.value || "").trim();
  if (!name) return;
  suggestMaterials.push({ name, purchased: false });
  input.value = "";
  renderSuggestMaterials();
}
function removeSuggestMaterial(idx) {
  suggestMaterials.splice(idx, 1);
  renderSuggestMaterials();
}
function renderSuggestMaterials() {
  document.getElementById("suggestMaterialsList").innerHTML = suggestMaterials.map((m,i) =>
    `<div class="flex-center gap-6 text-md" style="padding:4px 0">
      <span class="flex-1">${esc(m.name)}</span>
      <button type="button" class="btn-dismiss" data-sk-click="removeSuggestMaterial" data-sk-arg="${i}">&times;</button>
    </div>`
  ).join("");
}

function handleSuggestPhoto(input) {
  const file = input.files[0];
  const errEl = document.getElementById("suggestPhotoErr");
  const preview = document.getElementById("suggestPhotoPreview");
  if (!file) { suggestPhotoData = null; preview.className = "photo-preview"; return; }
  if (file.size > 5*1024*1024) {
    errEl.textContent = s("sauma.imgTooLarge");
    input.value = ""; suggestPhotoData = null; preview.className = "photo-preview"; return;
  }
  errEl.textContent = "";
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1400; let data;
      if (img.width <= maxW) { data = e.target.result; }
      else {
        const c = document.createElement("canvas"); const ratio = maxW/img.width;
        c.width = maxW; c.height = Math.round(img.height*ratio);
        c.getContext("2d").drawImage(img,0,0,c.width,c.height);
        data = c.toDataURL("image/jpeg",0.82);
      }
      suggestPhotoData = { fileName: file.name, fileData: data, mimeType: file.type||'image/jpeg' };
      preview.src = data; preview.className = "photo-preview show";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function submitSuggestion() {
  const btn = document.getElementById("suggestSubmitBtn");
  document.getElementById("suggestErr").classList.add("hidden");

  if (!suggestCat) { showSuggestErr(s("sauma.selectCategory")); return; }
  if (!suggestPrio) { showSuggestErr(s("sauma.selectPriority")); return; }
  const desc = document.getElementById("suggestDesc").value.trim();
  if (!desc) { showSuggestErr(s("sauma.describeProject")); return; }

  let boatId = "", boatName = "";
  if (suggestCat === "boat") {
    const sel = document.getElementById("suggestBoat");
    boatId = sel.value; boatName = sel.selectedOptions[0]?.text?.split(" (")[0] || "";
    if (!boatId) { showSuggestErr(s("sauma.selectBoat")); return; }
  }

  btn.disabled = true; btn.textContent = s("sauma.submitting");
  try {
    let photoUrl = suggestExistingPhotoUrl || "";
    if (suggestPhotoData) {
      btn.textContent = s("sauma.uploadingPhoto");
      const upRes = await apiPost("uploadMaintenancePhoto", suggestPhotoData);
      if (upRes.ok) photoUrl = upRes.photoUrl;
    }
    const partVal = document.getElementById("suggestPart").value.trim();
    if (suggestEditingId) {
      const payload = {
        id: suggestEditingId,
        category: suggestCat, boatId, boatName,
        part:        partVal,
        severity:    suggestPrio,
        description: desc,
        materials:   JSON.stringify(suggestMaterials || []),
      };
      if (photoUrl) payload.photoUrl = photoUrl;
      await apiPost("saveMaintenance", payload);
    } else {
      await apiPost("saveMaintenance", {
        category: suggestCat, boatId, boatName, itemName: '',
        part:        partVal,
        severity:    suggestPrio,
        description: desc,
        markOos:     false,
        photoUrl,
        reportedBy:  currentUserName || 'Member',
        source:      "member",
        saumaklubbur: true,
        verkstjori:  '',
        materials:   suggestMaterials.length ? JSON.stringify(suggestMaterials) : '[]',
      });
    }
    const wasEditing = suggestEditingId;
    closeSuggestModal();
    const rRes = await apiGet("getMaintenance");
    allProjects = (rRes.requests || []).filter(r => boolVal(r.saumaklubbur));
    renderList();
    toast("✓ " + s(wasEditing ? "maint.updated" : "sauma.submitted"));
  } catch(e) {
    showSuggestErr(s('logbook.errGeneric',{msg:e.message}));
  } finally {
    btn.disabled = false; btn.textContent = s("btn.submit");
  }
}

function showSuggestErr(msg) {
  const el = document.getElementById("suggestErr");
  el.textContent = msg; el.classList.remove("hidden");
}


(function () {
  if (typeof document === 'undefined' || document._skListeners) return;
  document._skListeners = true;
  document.addEventListener('click', function (e) {
    var hs = e.target.closest('[data-sk-hide-self]');
    if (hs) { hs.classList.add('hidden'); return; }
    var cs = e.target.closest('[data-sk-close-self]');
    if (cs && e.target === cs) { closeSuggestModal(); return; }
    var vp = e.target.closest('[data-sk-view-photo]');
    if (vp && typeof window.viewPhoto === 'function') {
      e.stopPropagation();
      window.viewPhoto(vp.dataset.skViewPhoto);
      return;
    }
    var c = e.target.closest('[data-sk-click]');
    if (c && typeof window[c.dataset.skClick] === 'function') {
      window[c.dataset.skClick](c.dataset.skArg);
    }
  });
  document.addEventListener('change', function (e) {
    var ce = e.target.closest('[data-sk-change-el]');
    if (ce && typeof window[ce.dataset.skChangeEl] === 'function') { window[ce.dataset.skChangeEl](ce); return; }
    var c = e.target.closest('[data-sk-change]');
    if (c && typeof window[c.dataset.skChange] === 'function') window[c.dataset.skChange]();
  });
})();
