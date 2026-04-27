// Handbook admin: contacts (people + free text), rules, org chart, docs.

var _hbAdmin = {
  info: [], roles: [], docs: [], contacts: [],
  editingInfoId: null, editingRoleId: null, editingDocId: null, editingContactId: null,
};

async function loadHandbookAdmin(force) {
  try {
    const res = await apiGet('getHandbook', force ? { _fresh: 1 } : {});
    _hbAdmin.info     = res.info     || [];
    _hbAdmin.roles    = res.roles    || [];
    _hbAdmin.docs     = res.docs     || [];
    _hbAdmin.contacts = res.contacts || [];
  } catch (e) {
    console.warn('loadHandbookAdmin failed:', e.message);
  }
}

async function renderHandbookAdmin() {
  await loadHandbookAdmin();
  renderHandbookContactsAdmin();
  renderHandbookRulesAdmin();
  renderHandbookRolesList();
  renderHandbookDocsList();
}

const _hbT = (row, key) => localizedField(row, key);

function _hbBySort(a, b) {
  return (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) ||
    String(a.title || a.label || '').localeCompare(String(b.title || b.label || ''));
}

function _hbAdminMemberName(kt) {
  if (typeof members === 'undefined' || !members) return '';
  const m = members.find(x => String(x.kennitala) === String(kt));
  return m ? (m.name || '') : '';
}

// Generic save: posts the payload, splices the result into the local array,
// closes the modal, re-renders, toasts. `render` may be a single fn or array.
async function _hbSave(action, payload, listKey, modalId, render) {
  try {
    const res = await apiPost(action, payload);
    payload.id = payload.id || res.id;
    payload.active = true;
    const arr = _hbAdmin[listKey];
    const idx = arr.findIndex(x => x.id === payload.id);
    if (idx >= 0) arr[idx] = { ...arr[idx], ...payload };
    else          arr.push(payload);
    closeModal(modalId, true);
    [].concat(render).forEach(fn => fn());
    toast(s('toast.saved'));
  } catch (e) { toast(s('toast.saveFailed') + ': ' + e.message, 'err'); }
}

async function _hbDelete(action, listKey, editingKey, modalId, render) {
  const id = _hbAdmin[editingKey];
  if (!id) return;
  if (!await ymConfirm(s('admin.handbookConfirmDelete'))) return;
  try {
    await apiPost(action, { id: id });
    _hbAdmin[listKey] = _hbAdmin[listKey].filter(x => x.id !== id);
    closeModal(modalId, true);
    [].concat(render).forEach(fn => fn());
    toast(s('toast.deleted'));
  } catch (e) { toast(s('toast.error') + ': ' + e.message, 'err'); }
}

// ── Contacts col-section: people + free-text ────────────────────────────────

function _hbInfoRowHtml(it) {
  return `
    <div class="list-row">
      <span class="list-name">${esc(_hbT(it, 'title'))}</span>
      <button class="row-edit" data-admin-click="openHandbookInfoModal" data-admin-arg="${it.id}">${s('btn.edit')}</button>
    </div>`;
}

function renderHandbookContactsAdmin() {
  const card = document.getElementById('hbAdminContactsCard');
  if (!card) return;
  const ppl  = (_hbAdmin.contacts || []).slice().sort(_hbBySort);
  const text = (_hbAdmin.info || []).filter(it => it.kind === 'contacts').sort(_hbBySort);

  let html = '';
  if (ppl.length) {
    html += `<div class="text-xs text-muted mb-4" style="text-transform:uppercase;letter-spacing:1px">${esc(s('admin.handbookContactsPeople'))}</div>`;
    html += ppl.map(c => {
      const lbl  = _hbT(c, 'label');
      const name = c.name || (c.memberId ? _hbAdminMemberName(c.memberId) : '');
      return `
        <div class="list-row">
          <span class="list-name">${esc(name || '—')}<span class="text-xs text-muted"> · ${esc(lbl)}</span></span>
          <button class="row-edit" data-admin-click="openHandbookContactModal" data-admin-arg="${c.id}">${s('btn.edit')}</button>
        </div>`;
    }).join('');
  }
  if (text.length) {
    html += `<div class="text-xs text-muted mt-8 mb-4" style="text-transform:uppercase;letter-spacing:1px">${esc(s('admin.handbookContactsText'))}</div>`;
    html += text.map(_hbInfoRowHtml).join('');
  }
  card.innerHTML = html || `<div class="empty-state">${s('admin.handbookEmptyInfo')}</div>`;
}

// Legacy rows without a kind also surface here so pre-migration content edits.
function renderHandbookRulesAdmin() {
  const card = document.getElementById('hbAdminRulesCard');
  if (!card) return;
  const list = (_hbAdmin.info || []).filter(it => {
    const k = it.kind || 'info';
    return k === 'rules' || k === 'info';
  }).sort(_hbBySort);
  card.innerHTML = list.length
    ? list.map(_hbInfoRowHtml).join('')
    : `<div class="empty-state">${s('admin.handbookEmptyInfo')}</div>`;
}

function openHandbookInfoModal(id, kindHint) {
  _hbAdmin.editingInfoId = id || null;
  const row = id ? _hbAdmin.info.find(x => x.id === id) : null;
  document.getElementById('hbInfoModalTitle').textContent = row
    ? s('admin.handbook.info.modalEdit')
    : s('admin.handbook.info.modalAdd');
  let kind;
  if (row)            kind = row.kind === 'contacts' ? 'contacts' : 'rules';
  else if (kindHint)  kind = kindHint;
  else                kind = 'contacts';
  document.getElementById('hbInfoKind').value      = kind;
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
  return _hbSave('saveHandbookInfo', {
    id:        _hbAdmin.editingInfoId || undefined,
    kind:      document.getElementById('hbInfoKind').value,
    title:     title,
    titleIS:   titleIS,
    content:   document.getElementById('hbInfoContent').value,
    contentIS: document.getElementById('hbInfoContentIS').value,
    sortOrder: Number(document.getElementById('hbInfoSort').value) || 0,
  }, 'info', 'hbInfoModal', [renderHandbookContactsAdmin, renderHandbookRulesAdmin]);
}

async function deleteHandbookInfo() {
  return _hbDelete('deleteHandbookInfo', 'info', 'editingInfoId', 'hbInfoModal',
    [renderHandbookContactsAdmin, renderHandbookRulesAdmin]);
}

// ── Member-linked contacts ──────────────────────────────────────────────────

function openHandbookContactModal(id) {
  _hbAdmin.editingContactId = id || null;
  const row = id ? _hbAdmin.contacts.find(x => x.id === id) : null;
  document.getElementById('hbContactModalTitle').textContent = row
    ? s('admin.handbook.contact.modalEdit')
    : s('admin.handbook.contact.modalAdd');

  const sel = document.getElementById('hbContactMember');
  const opts = ['<option value="">' + esc(s('admin.handbook.contact.memberNone')) + '</option>'];
  if (typeof members !== 'undefined' && Array.isArray(members)) {
    members
      .filter(m => bool(m.active))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .forEach(m => {
        const sel2 = (row && String(row.memberId) === String(m.kennitala)) ? ' selected' : '';
        opts.push(`<option value="${esc(m.kennitala)}"${sel2}>${esc(m.name || m.kennitala)}</option>`);
      });
  }
  sel.innerHTML = opts.join('');

  document.getElementById('hbContactLabel').value     = row ? (row.label || '')     : '';
  document.getElementById('hbContactLabelIS').value   = row ? (row.labelIS || '')   : '';
  document.getElementById('hbContactName').value      = row ? (row.name || '')      : '';
  document.getElementById('hbContactPhone').value     = row ? (row.phone || '')     : '';
  document.getElementById('hbContactEmail').value     = row ? (row.email || '')     : '';
  document.getElementById('hbContactNotes').value     = row ? (row.notes || '')     : '';
  document.getElementById('hbContactNotesIS').value   = row ? (row.notesIS || '')   : '';
  document.getElementById('hbContactSort').value      = row ? (row.sortOrder || 0)  : 0;

  const usedEN = {}, usedIS = {};
  (_hbAdmin.contacts || []).forEach(c => {
    if (c.label) usedEN[c.label] = true;
    if (c.labelIS) usedIS[c.labelIS] = true;
  });
  document.getElementById('hbContactLabelList').innerHTML =
    Object.keys(usedEN).sort().map(l => `<option value="${esc(l)}">`).join('');
  document.getElementById('hbContactLabelListIS').innerHTML =
    Object.keys(usedIS).sort().map(l => `<option value="${esc(l)}">`).join('');

  // Surface the linked member's values as placeholders so the admin sees what
  // will render on the public page if they don't override.
  hbContactMemberPicked();

  document.getElementById('hbContactDeleteBtn').classList.toggle('hidden', !row);
  applyStrings(document.getElementById('hbContactModal'));
  openModal('hbContactModal');
}

function hbContactMemberPicked() {
  const kt = document.getElementById('hbContactMember').value;
  const m = (typeof members !== 'undefined' && Array.isArray(members))
    ? members.find(x => String(x.kennitala) === String(kt))
    : null;
  document.getElementById('hbContactName').placeholder  = m ? (m.name || '')  : '';
  document.getElementById('hbContactPhone').placeholder = m ? (m.phone || '') : '';
  document.getElementById('hbContactEmail').placeholder = m ? (m.email || '') : '';
}

async function saveHandbookContact() {
  const label   = document.getElementById('hbContactLabel').value.trim();
  const labelIS = document.getElementById('hbContactLabelIS').value.trim();
  if (!label && !labelIS) { toast(s('admin.handbookLabelRequired'), 'err'); return; }
  return _hbSave('saveHandbookContact', {
    id:        _hbAdmin.editingContactId || undefined,
    memberId:  document.getElementById('hbContactMember').value || '',
    label:     label,
    labelIS:   labelIS,
    name:      document.getElementById('hbContactName').value.trim(),
    phone:     document.getElementById('hbContactPhone').value.trim(),
    email:     document.getElementById('hbContactEmail').value.trim(),
    notes:     document.getElementById('hbContactNotes').value,
    notesIS:   document.getElementById('hbContactNotesIS').value,
    sortOrder: Number(document.getElementById('hbContactSort').value) || 0,
  }, 'contacts', 'hbContactModal', renderHandbookContactsAdmin);
}

async function deleteHandbookContact() {
  return _hbDelete('deleteHandbookContact', 'contacts', 'editingContactId',
    'hbContactModal', renderHandbookContactsAdmin);
}

// ── Roles (org chart) ───────────────────────────────────────────────────────

function renderHandbookRolesList() {
  const card = document.getElementById('hbAdminRolesCard');
  if (!card) return;
  if (!_hbAdmin.roles.length) {
    card.innerHTML = `<div class="empty-state">${s('admin.handbookEmptyRoles')}</div>`;
    return;
  }
  // Flat list (the read portal handles the tree).
  const byId = {};
  _hbAdmin.roles.forEach(r => { byId[r.id] = r; });
  const rows = _hbAdmin.roles.slice().sort((a, b) =>
    (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) ||
    String(_hbT(a, 'title')).localeCompare(_hbT(b, 'title'))
  );
  card.innerHTML = rows.map(r => {
    const parent = r.parentId && byId[r.parentId] ? _hbT(byId[r.parentId], 'title') : '';
    const sub = parent ? `<span class="text-xs text-muted"> ↳ ${esc(parent)}</span>` : '';
    const who = r.name ? ` — <span class="text-muted">${esc(r.name)}</span>` : '';
    return `
      <div class="list-row">
        <span class="list-name">${esc(_hbT(r, 'title'))}${who}${sub}</span>
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
  document.getElementById('hbRolePhone').value   = row ? (row.phone || '')   : '';
  document.getElementById('hbRoleEmail').value   = row ? (row.email || '')   : '';
  document.getElementById('hbRoleNotes').value   = row ? (row.notes || '')   : '';
  document.getElementById('hbRoleNotesIS').value = row ? (row.notesIS || '') : '';
  document.getElementById('hbRoleColor').value   = (row && row.color) ? row.color : '#d4af37';
  // userSet flag distinguishes "admin picked this color" from "default
  // shown in the swatch but not chosen" so save can persist '' for default.
  document.getElementById('hbRoleColor').dataset.userSet = (row && row.color) ? '1' : '';
  document.getElementById('hbRoleSort').value    = row ? (row.sortOrder || 0): 0;

  // Member dropdown — pick one to link, leave blank for category roles
  // (Stjórn, deildir) that aren't tied to a single person.
  const memSel = document.getElementById('hbRoleKt');
  const memOpts = ['<option value="">' + esc(s('admin.handbook.role.kennitalaNone')) + '</option>'];
  if (typeof members !== 'undefined' && Array.isArray(members)) {
    members
      .filter(m => bool(m.active))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .forEach(m => {
        const sel2 = (row && String(row.kennitala) === String(m.kennitala)) ? ' selected' : '';
        memOpts.push(`<option value="${esc(m.kennitala)}"${sel2}>${esc(m.name || m.kennitala)}</option>`);
      });
  }
  memSel.innerHTML = memOpts.join('');

  // Title datalist — seeded sub-roles plus any titles already in use, so
  // admins can keep terminology consistent without typing from scratch.
  const titlesEN = new Set(['Courses', 'Members', 'Social activities', 'Competition']);
  const titlesIS = new Set(['Námskeið', 'Iðkendur', 'Félagsstarf', 'Keppnisstarf']);
  _hbAdmin.roles.forEach(r => {
    if (r.title)   titlesEN.add(r.title);
    if (r.titleIS) titlesIS.add(r.titleIS);
  });
  document.getElementById('hbRoleTitleList').innerHTML =
    [...titlesEN].sort().map(t => `<option value="${esc(t)}">`).join('');
  document.getElementById('hbRoleTitleListIS').innerHTML =
    [...titlesIS].sort().map(t => `<option value="${esc(t)}">`).join('');

  // Refresh placeholders for name/phone/email from the linked member.
  hbRoleMemberPicked();

  const catSel = document.getElementById('hbRoleBoatCat');
  const catOpts = ['<option value="">' + esc(s('admin.handbook.role.boatCatNone')) + '</option>'];
  if (typeof boatCats !== 'undefined' && Array.isArray(boatCats)) {
    boatCats.slice().sort((a, b) =>
      String(a.labelEN || a.key || '').localeCompare(String(b.labelEN || b.key || ''))
    ).forEach(c => {
      const sel2 = (row && row.boatCategoryKey === c.key) ? ' selected' : '';
      const lbl  = (getLang() === 'IS' ? (c.labelIS || c.labelEN) : (c.labelEN || c.labelIS)) || c.key;
      catOpts.push(`<option value="${esc(c.key)}"${sel2}>${esc((c.emoji || '') + ' ' + lbl).trim()}</option>`);
    });
  }
  catSel.innerHTML = catOpts.join('');

  // Exclude self from parent options to avoid loops.
  const sel = document.getElementById('hbRoleParent');
  const opts = ['<option value="">' + esc(s('admin.handbook.role.parentNone')) + '</option>'];
  _hbAdmin.roles
    .filter(r => !id || r.id !== id)
    .sort((a, b) => String(_hbT(a, 'title')).localeCompare(_hbT(b, 'title')))
    .forEach(r => {
      const sel2 = (row && row.parentId === r.id) ? ' selected' : '';
      opts.push(`<option value="${esc(r.id)}"${sel2}>${esc(_hbT(r, 'title'))}</option>`);
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
  return _hbSave('saveHandbookRole', {
    id:              _hbAdmin.editingRoleId || undefined,
    parentId:        document.getElementById('hbRoleParent').value || '',
    title:           title,
    titleIS:         titleIS,
    name:            document.getElementById('hbRoleName').value.trim(),
    kennitala:       document.getElementById('hbRoleKt').value.trim(),
    phone:           document.getElementById('hbRolePhone').value.trim(),
    email:           document.getElementById('hbRoleEmail').value.trim(),
    notes:           document.getElementById('hbRoleNotes').value,
    notesIS:         document.getElementById('hbRoleNotesIS').value,
    color:           document.getElementById('hbRoleColor').dataset.userSet
                       ? document.getElementById('hbRoleColor').value : '',
    boatCategoryKey: document.getElementById('hbRoleBoatCat').value || '',
    sortOrder:       Number(document.getElementById('hbRoleSort').value) || 0,
  }, 'roles', 'hbRoleModal', renderHandbookRolesList);
}

async function deleteHandbookRole() {
  return _hbDelete('deleteHandbookRole', 'roles', 'editingRoleId',
    'hbRoleModal', renderHandbookRolesList);
}

function hbRoleMemberPicked() {
  const kt = document.getElementById('hbRoleKt').value;
  const m = (typeof members !== 'undefined' && Array.isArray(members))
    ? members.find(x => String(x.kennitala) === String(kt))
    : null;
  document.getElementById('hbRoleName').placeholder  = m ? (m.name || '')  : '';
  document.getElementById('hbRolePhone').placeholder = m ? (m.phone || '') : '';
  document.getElementById('hbRoleEmail').placeholder = m ? (m.email || '') : '';
}

function hbRoleColorPicked() {
  document.getElementById('hbRoleColor').dataset.userSet = '1';
}

function clearHandbookRoleColor() {
  // Empty userSet flag tells save to persist '' so the read-side falls back
  // to the boat-category color (or --brass if none).
  const el = document.getElementById('hbRoleColor');
  el.value = '#d4af37';
  el.dataset.userSet = '';
}

async function seedHandbookOrgChart() {
  if (!await ymConfirm(s('admin.handbookSeedConfirm'))) return;
  try {
    const res = await apiPost('seedHandbookOrgChart', {});
    await loadHandbookAdmin(true);
    renderHandbookRolesList();
    toast(s('toast.saved') + (res.added ? ' (+' + res.added + ')' : ''));
  } catch (e) { toast(s('toast.error') + ': ' + e.message, 'err'); }
}

// ── Documents ───────────────────────────────────────────────────────────────

function renderHandbookDocsList() {
  const card = document.getElementById('hbAdminDocsCard');
  if (!card) return;
  if (!_hbAdmin.docs.length) {
    card.innerHTML = `<div class="empty-state">${s('admin.handbookEmptyDocs')}</div>`;
    return;
  }
  card.innerHTML = _hbAdmin.docs.slice().sort(_hbBySort).map(d => {
    const cat = _hbT(d, 'category');
    const catSpan = cat ? `<span class="text-xs text-muted"> · ${esc(cat)}</span>` : '';
    const icon = d.driveFileId ? '📄' : '🔗';
    return `
      <div class="list-row">
        <span class="list-name">${icon} ${esc(_hbT(d, 'title'))}${catSpan}</span>
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
  return _hbSave('saveHandbookDoc', {
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
  }, 'docs', 'hbDocModal', renderHandbookDocsList);
}

async function deleteHandbookDoc() {
  return _hbDelete('deleteHandbookDoc', 'docs', 'editingDocId',
    'hbDocModal', renderHandbookDocsList);
}
