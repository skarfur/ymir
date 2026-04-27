// ═══════════════════════════════════════════════════════════════════════════════
// admin/handbook.js — Handbook tab (info sections, org chart, documents)
// ═══════════════════════════════════════════════════════════════════════════════
// Mirrors the locations.js / certs.js pattern: render functions read from a
// module-local state object, mutations call apiPost and re-render. All entries
// are soft-deleted (active=false) on the backend.

var _hbAdmin = {
  info: [],
  roles: [],
  docs: [],
  editingInfoId: null,
  editingRoleId: null,
  editingDocId:  null,
};

async function loadHandbookAdmin(force) {
  if (_hbAdmin._loaded && !force) return;
  try {
    const res = await apiGet('getHandbook', force ? { _fresh: 1 } : {});
    _hbAdmin.info  = res.info  || [];
    _hbAdmin.roles = res.roles || [];
    _hbAdmin.docs  = res.docs  || [];
    _hbAdmin._loaded = true;
  } catch (e) {
    console.warn('loadHandbookAdmin failed:', e.message);
  }
}

async function renderHandbookAdmin() {
  await loadHandbookAdmin();
  renderHandbookInfoList();
  renderHandbookRolesList();
  renderHandbookDocsList();
}

function _hbLocalized(row, key) {
  return getLang() === 'IS'
    ? (row[key + 'IS'] || row[key] || '')
    : (row[key] || row[key + 'IS'] || '');
}

// ── Info sections ────────────────────────────────────────────────────────────

function renderHandbookInfoList() {
  const card = document.getElementById('hbAdminInfoCard');
  if (!card) return;
  if (!_hbAdmin.info.length) {
    card.innerHTML = `<div class="empty-state">${s('admin.handbookEmptyInfo')}</div>`;
    return;
  }
  card.innerHTML = _hbAdmin.info.map(it => `
    <div class="list-row">
      <span class="list-name">${esc(_hbLocalized(it, 'title'))}</span>
      <button class="row-edit" data-admin-click="openHandbookInfoModal" data-admin-arg="${it.id}">${s('btn.edit')}</button>
    </div>
  `).join('');
}

function openHandbookInfoModal(id) {
  _hbAdmin.editingInfoId = id || null;
  const row = id ? _hbAdmin.info.find(x => x.id === id) : null;
  document.getElementById('hbInfoModalTitle').textContent = row
    ? s('admin.handbook.info.modalEdit')
    : s('admin.handbook.info.modalAdd');
  document.getElementById('hbInfoTitle').value     = row ? (row.title || '')     : '';
  document.getElementById('hbInfoTitleIS').value   = row ? (row.titleIS || '')   : '';
  document.getElementById('hbInfoContent').value   = row ? (row.content || '')   : '';
  document.getElementById('hbInfoContentIS').value = row ? (row.contentIS || '') : '';
  document.getElementById('hbInfoSort').value      = row ? (row.sortOrder || 0)  : 0;
  document.getElementById('hbInfoDeleteBtn').classList.toggle('hidden', !row);
  applyStrings(document.getElementById('hbInfoModal'));
  openModal('hbInfoModal');
}

async function saveHandbookInfo() {
  const title   = document.getElementById('hbInfoTitle').value.trim();
  const titleIS = document.getElementById('hbInfoTitleIS').value.trim();
  if (!title && !titleIS) { toast(s('admin.nameRequired') || 'Title required', 'err'); return; }
  const payload = {
    id:        _hbAdmin.editingInfoId || undefined,
    title:     title,
    titleIS:   titleIS,
    content:   document.getElementById('hbInfoContent').value,
    contentIS: document.getElementById('hbInfoContentIS').value,
    sortOrder: Number(document.getElementById('hbInfoSort').value) || 0,
  };
  try {
    const res = await apiPost('saveHandbookInfo', payload);
    payload.id = payload.id || res.id;
    payload.active = true;
    const idx = _hbAdmin.info.findIndex(x => x.id === payload.id);
    if (idx >= 0) _hbAdmin.info[idx] = { ..._hbAdmin.info[idx], ...payload };
    else          _hbAdmin.info.push(payload);
    closeModal('hbInfoModal', true);
    renderHandbookInfoList();
    toast(s('toast.saved'));
  } catch (e) { toast(s('toast.saveFailed') + ': ' + e.message, 'err'); }
}

async function deleteHandbookInfo() {
  if (!_hbAdmin.editingInfoId) return;
  if (!await ymConfirm(s('admin.handbookConfirmDelete'))) return;
  try {
    await apiPost('deleteHandbookInfo', { id: _hbAdmin.editingInfoId });
    _hbAdmin.info = _hbAdmin.info.filter(x => x.id !== _hbAdmin.editingInfoId);
    closeModal('hbInfoModal', true);
    renderHandbookInfoList();
    toast(s('toast.deleted'));
  } catch (e) { toast(s('toast.error') + ': ' + e.message, 'err'); }
}

// ── Roles (org chart) ────────────────────────────────────────────────────────

function renderHandbookRolesList() {
  const card = document.getElementById('hbAdminRolesCard');
  if (!card) return;
  if (!_hbAdmin.roles.length) {
    card.innerHTML = `<div class="empty-state">${s('admin.handbookEmptyRoles')}</div>`;
    return;
  }
  // Render as a flat sorted list with parent indent indicator. The read-side
  // /handbook/ portal renders the actual nested tree; admin only needs to
  // identify each row.
  const byId = {};
  _hbAdmin.roles.forEach(r => { byId[r.id] = r; });
  const rows = _hbAdmin.roles.slice().sort((a, b) => {
    return (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) ||
      String(_hbLocalized(a, 'title')).localeCompare(_hbLocalized(b, 'title'));
  });
  card.innerHTML = rows.map(r => {
    const parent = r.parentId && byId[r.parentId] ? _hbLocalized(byId[r.parentId], 'title') : '';
    const sub = parent ? `<span class="text-xs text-muted"> ↳ ${esc(parent)}</span>` : '';
    const who = r.name ? ` — <span class="text-muted">${esc(r.name)}</span>` : '';
    return `
      <div class="list-row">
        <span class="list-name">${esc(_hbLocalized(r, 'title'))}${who}${sub}</span>
        <button class="row-edit" data-admin-click="openHandbookRoleModal" data-admin-arg="${r.id}">${s('btn.edit')}</button>
      </div>`;
  }).join('');
}

function openHandbookRoleModal(id) {
  _hbAdmin.editingRoleId = id || null;
  const row = id ? _hbAdmin.roles.find(x => x.id === id) : null;
  document.getElementById('hbRoleModalTitle').textContent = row
    ? s('admin.handbook.role.modalEdit')
    : s('admin.handbook.role.modalAdd');
  document.getElementById('hbRoleTitle').value   = row ? (row.title || '')   : '';
  document.getElementById('hbRoleTitleIS').value = row ? (row.titleIS || '') : '';
  document.getElementById('hbRoleName').value    = row ? (row.name || '')    : '';
  document.getElementById('hbRoleKt').value      = row ? (row.kennitala || ''): '';
  document.getElementById('hbRolePhone').value   = row ? (row.phone || '')   : '';
  document.getElementById('hbRoleEmail').value   = row ? (row.email || '')   : '';
  document.getElementById('hbRoleNotes').value   = row ? (row.notes || '')   : '';
  document.getElementById('hbRoleNotesIS').value = row ? (row.notesIS || '') : '';
  document.getElementById('hbRoleSort').value    = row ? (row.sortOrder || 0): 0;

  // Populate parent dropdown — exclude self to avoid loops.
  const sel = document.getElementById('hbRoleParent');
  const opts = ['<option value="">' + esc(s('admin.handbook.role.parentNone')) + '</option>'];
  _hbAdmin.roles
    .filter(r => !id || r.id !== id)
    .sort((a, b) => String(_hbLocalized(a, 'title')).localeCompare(_hbLocalized(b, 'title')))
    .forEach(r => {
      const sel2 = (row && row.parentId === r.id) ? ' selected' : '';
      opts.push(`<option value="${esc(r.id)}"${sel2}>${esc(_hbLocalized(r, 'title'))}</option>`);
    });
  sel.innerHTML = opts.join('');

  document.getElementById('hbRoleDeleteBtn').classList.toggle('hidden', !row);
  applyStrings(document.getElementById('hbRoleModal'));
  openModal('hbRoleModal');
}

async function saveHandbookRole() {
  const title   = document.getElementById('hbRoleTitle').value.trim();
  const titleIS = document.getElementById('hbRoleTitleIS').value.trim();
  if (!title && !titleIS) { toast(s('admin.nameRequired') || 'Title required', 'err'); return; }
  const payload = {
    id:        _hbAdmin.editingRoleId || undefined,
    parentId:  document.getElementById('hbRoleParent').value || '',
    title:     title,
    titleIS:   titleIS,
    name:      document.getElementById('hbRoleName').value.trim(),
    kennitala: document.getElementById('hbRoleKt').value.trim(),
    phone:     document.getElementById('hbRolePhone').value.trim(),
    email:     document.getElementById('hbRoleEmail').value.trim(),
    notes:     document.getElementById('hbRoleNotes').value,
    notesIS:   document.getElementById('hbRoleNotesIS').value,
    sortOrder: Number(document.getElementById('hbRoleSort').value) || 0,
  };
  try {
    const res = await apiPost('saveHandbookRole', payload);
    payload.id = payload.id || res.id;
    payload.active = true;
    const idx = _hbAdmin.roles.findIndex(x => x.id === payload.id);
    if (idx >= 0) _hbAdmin.roles[idx] = { ..._hbAdmin.roles[idx], ...payload };
    else          _hbAdmin.roles.push(payload);
    closeModal('hbRoleModal', true);
    renderHandbookRolesList();
    toast(s('toast.saved'));
  } catch (e) { toast(s('toast.saveFailed') + ': ' + e.message, 'err'); }
}

async function deleteHandbookRole() {
  if (!_hbAdmin.editingRoleId) return;
  if (!await ymConfirm(s('admin.handbookConfirmDelete'))) return;
  try {
    await apiPost('deleteHandbookRole', { id: _hbAdmin.editingRoleId });
    _hbAdmin.roles = _hbAdmin.roles.filter(x => x.id !== _hbAdmin.editingRoleId);
    closeModal('hbRoleModal', true);
    renderHandbookRolesList();
    toast(s('toast.deleted'));
  } catch (e) { toast(s('toast.error') + ': ' + e.message, 'err'); }
}

// ── Documents ────────────────────────────────────────────────────────────────

function renderHandbookDocsList() {
  const card = document.getElementById('hbAdminDocsCard');
  if (!card) return;
  if (!_hbAdmin.docs.length) {
    card.innerHTML = `<div class="empty-state">${s('admin.handbookEmptyDocs')}</div>`;
    return;
  }
  card.innerHTML = _hbAdmin.docs.slice().sort((a, b) => {
    return (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) ||
      String(_hbLocalized(a, 'title')).localeCompare(_hbLocalized(b, 'title'));
  }).map(d => {
    const cat = _hbLocalized(d, 'category');
    const catSpan = cat ? `<span class="text-xs text-muted"> · ${esc(cat)}</span>` : '';
    const icon = d.driveFileId ? '📄' : '🔗';
    return `
      <div class="list-row">
        <span class="list-name">${icon} ${esc(_hbLocalized(d, 'title'))}${catSpan}</span>
        <button class="row-edit" data-admin-click="openHandbookDocModal" data-admin-arg="${d.id}">${s('btn.edit')}</button>
      </div>`;
  }).join('');
}

function openHandbookDocModal(id) {
  _hbAdmin.editingDocId = id || null;
  const row = id ? _hbAdmin.docs.find(x => x.id === id) : null;
  document.getElementById('hbDocModalTitle').textContent = row
    ? s('admin.handbook.doc.modalEdit')
    : s('admin.handbook.doc.modalAdd');
  document.getElementById('hbDocTitle').value      = row ? (row.title || '')       : '';
  document.getElementById('hbDocTitleIS').value    = row ? (row.titleIS || '')     : '';
  document.getElementById('hbDocCat').value        = row ? (row.category || '')    : '';
  document.getElementById('hbDocCatIS').value      = row ? (row.categoryIS || '')  : '';
  document.getElementById('hbDocUrl').value        = row ? (row.url || '')         : '';
  document.getElementById('hbDocDriveFileId').value= row ? (row.driveFileId || '') : '';
  document.getElementById('hbDocNotes').value      = row ? (row.notes || '')       : '';
  document.getElementById('hbDocNotesIS').value    = row ? (row.notesIS || '')     : '';
  document.getElementById('hbDocSort').value       = row ? (row.sortOrder || 0)    : 0;
  document.getElementById('hbDocFile').value       = '';
  document.getElementById('hbDocUploadStatus').textContent = '';

  // Populate category datalist with distinct existing categories so the admin
  // can reuse them.
  const seen = {};
  const cats = [];
  _hbAdmin.docs.forEach(d => {
    if (d.category && !seen[d.category]) { seen[d.category] = true; cats.push(d.category); }
  });
  document.getElementById('hbDocCatList').innerHTML = cats
    .sort()
    .map(c => `<option value="${esc(c)}">`).join('');

  document.getElementById('hbDocDeleteBtn').classList.toggle('hidden', !row);
  applyStrings(document.getElementById('hbDocModal'));
  openModal('hbDocModal');
}

async function handleHandbookDocUpload(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const status = document.getElementById('hbDocUploadStatus');
  status.textContent = s('admin.handbook.doc.uploading');
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(file);
    });
    const res = await apiPost('uploadHandbookDoc', {
      fileData: dataUrl,
      fileName: file.name,
      mimeType: file.type,
    });
    if (!res.ok) throw new Error(res.error || 'upload failed');
    document.getElementById('hbDocUrl').value = res.url || '';
    document.getElementById('hbDocDriveFileId').value = res.driveFileId || '';
    if (!document.getElementById('hbDocTitle').value.trim()) {
      document.getElementById('hbDocTitle').value = file.name.replace(/\.[^.]+$/, '');
    }
    status.textContent = s('admin.handbook.doc.uploaded');
  } catch (e) {
    status.textContent = s('toast.error') + ': ' + e.message;
  }
}

async function saveHandbookDoc() {
  const title = document.getElementById('hbDocTitle').value.trim();
  const url   = document.getElementById('hbDocUrl').value.trim();
  if (!title) { toast(s('admin.nameRequired') || 'Title required', 'err'); return; }
  if (!url)   { toast('URL required', 'err'); return; }
  const payload = {
    id:          _hbAdmin.editingDocId || undefined,
    title:       title,
    titleIS:     document.getElementById('hbDocTitleIS').value.trim(),
    category:    document.getElementById('hbDocCat').value.trim(),
    categoryIS:  document.getElementById('hbDocCatIS').value.trim(),
    url:         url,
    driveFileId: document.getElementById('hbDocDriveFileId').value.trim(),
    notes:       document.getElementById('hbDocNotes').value,
    notesIS:     document.getElementById('hbDocNotesIS').value,
    sortOrder:   Number(document.getElementById('hbDocSort').value) || 0,
  };
  try {
    const res = await apiPost('saveHandbookDoc', payload);
    payload.id = payload.id || res.id;
    payload.active = true;
    const idx = _hbAdmin.docs.findIndex(x => x.id === payload.id);
    if (idx >= 0) _hbAdmin.docs[idx] = { ..._hbAdmin.docs[idx], ...payload };
    else          _hbAdmin.docs.push(payload);
    closeModal('hbDocModal', true);
    renderHandbookDocsList();
    toast(s('toast.saved'));
  } catch (e) { toast(s('toast.saveFailed') + ': ' + e.message, 'err'); }
}

async function deleteHandbookDoc() {
  if (!_hbAdmin.editingDocId) return;
  if (!await ymConfirm(s('admin.handbookConfirmDelete'))) return;
  try {
    await apiPost('deleteHandbookDoc', { id: _hbAdmin.editingDocId });
    _hbAdmin.docs = _hbAdmin.docs.filter(x => x.id !== _hbAdmin.editingDocId);
    closeModal('hbDocModal', true);
    renderHandbookDocsList();
    toast(s('toast.deleted'));
  } catch (e) { toast(s('toast.error') + ': ' + e.message, 'err'); }
}
