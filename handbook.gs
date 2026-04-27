// ═══════════════════════════════════════════════════════════════════════════════
// HANDBOOK / HANDBÓK
// ═══════════════════════════════════════════════════════════════════════════════
//
// Members- and staff-facing reference: org chart with contact data, quick links
// to PDFs (hosted on Drive), and free-form info sections (emergency numbers,
// opening hours, harbor info, club rules, …). Editable from the admin portal.
//
// Three sheets back this:
//   handbook_roles  — org-chart entries with optional parentId for hierarchy
//                     and optional kennitala link to a member record.
//   handbook_docs   — PDF / URL entries grouped by category. driveFileId is set
//                     when the file was uploaded through the admin UI so
//                     deletes can also trash the Drive file.
//   handbook_info   — free-form bilingual text sections (rich text or plain).
//
// Soft-deletes via `active=false` so audit history survives.

// ── Reads ────────────────────────────────────────────────────────────────────

function getHandbook_() {
  const roles = (data_.readAll('handbookRoles') || []).filter(_handbookActive_);
  const docs  = (data_.readAll('handbookDocs')  || []).filter(_handbookActive_);
  const info  = (data_.readAll('handbookInfo')  || []).filter(_handbookActive_);
  return okJ({
    roles: roles.sort(_byOrder_),
    docs:  docs.sort(_byOrder_),
    info:  info.sort(_byOrder_),
  });
}

function _handbookActive_(r) { return r && r.active !== false && r.active !== 'false'; }
function _byOrder_(a, b) {
  var ao = Number(a.sortOrder || 0), bo = Number(b.sortOrder || 0);
  if (ao !== bo) return ao - bo;
  return String(a.title || '').localeCompare(String(b.title || ''));
}

// ── Roles (org chart) ────────────────────────────────────────────────────────

function saveHandbookRole_(b) {
  if (!b.title) return failJ('title required');
  const id = b.id || ('role_' + uid_());
  const existing = findOne_('handbookRoles', 'id', id);
  const row = {
    id:         id,
    parentId:   b.parentId || '',
    title:      b.title || '',
    titleIS:    b.titleIS || '',
    name:       b.name || '',
    kennitala:  b.kennitala || '',
    phone:      b.phone || '',
    email:      b.email || '',
    notes:      b.notes || '',
    notesIS:    b.notesIS || '',
    sortOrder:  Number(b.sortOrder || 0),
    active:     b.active === false ? false : true,
    createdAt:  existing ? (existing.createdAt || now_()) : now_(),
    updatedAt:  now_(),
  };
  if (existing) updateRow_('handbookRoles', 'id', id, row);
  else          insertRow_('handbookRoles', row);
  return okJ({ id: id, saved: true });
}

function deleteHandbookRole_(b) {
  if (!b.id) return failJ('id required');
  const existing = findOne_('handbookRoles', 'id', b.id);
  if (!existing) return failJ('Role not found', 404);
  // Soft-delete so any sub-roles can be re-parented later if the admin
  // changes their mind. Children keep their parentId pointing at this row.
  updateRow_('handbookRoles', 'id', b.id, { active: false, updatedAt: now_() });
  return okJ({ ok: true });
}

// ── Docs (PDFs + URLs) ───────────────────────────────────────────────────────

function saveHandbookDoc_(b) {
  if (!b.title) return failJ('title required');
  if (!b.url)   return failJ('url required');
  const id = b.id || ('doc_' + uid_());
  const existing = findOne_('handbookDocs', 'id', id);
  const row = {
    id:          id,
    category:    b.category || '',
    categoryIS:  b.categoryIS || '',
    title:       b.title || '',
    titleIS:     b.titleIS || '',
    url:         b.url || '',
    driveFileId: b.driveFileId || '',
    notes:       b.notes || '',
    notesIS:     b.notesIS || '',
    sortOrder:   Number(b.sortOrder || 0),
    active:      b.active === false ? false : true,
    createdAt:   existing ? (existing.createdAt || now_()) : now_(),
    updatedAt:   now_(),
  };
  if (existing) updateRow_('handbookDocs', 'id', id, row);
  else          insertRow_('handbookDocs', row);
  return okJ({ id: id, saved: true });
}

function deleteHandbookDoc_(b) {
  if (!b.id) return failJ('id required');
  const existing = findOne_('handbookDocs', 'id', b.id);
  if (!existing) return failJ('Doc not found', 404);
  // Trash the Drive file if we own it. Plain external URLs (driveFileId
  // unset) are left alone.
  if (existing.driveFileId) {
    try { DriveApp.getFileById(existing.driveFileId).setTrashed(true); }
    catch (e) { /* file may already be gone */ }
  } else if (existing.url) {
    // Best effort: if the URL points at a Drive file we can extract the id.
    try {
      var m = String(existing.url).match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (m) DriveApp.getFileById(m[1]).setTrashed(true);
    } catch (e) {}
  }
  updateRow_('handbookDocs', 'id', b.id, { active: false, updatedAt: now_() });
  return okJ({ ok: true });
}

// Script Property required: DRIVE_FOLDER_ID_HANDBOOK_DOCS
function uploadHandbookDoc_(b) {
  if (!b.fileData) return failJ('fileData required');
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('DRIVE_FOLDER_ID_HANDBOOK_DOCS');
  if (!folderId) return okJ({ ok: false, error: 'Drive folder not configured' });

  try {
    const ext      = (b.fileName || 'doc.pdf').split('.').pop().toLowerCase();
    const ts       = now_().replace(/[: ]/g, '-');
    const safeName = 'handbook_' + ts + '_' + (b.fileName || 'doc.' + ext);
    const base64   = b.fileData.replace(/^data:[^;]+;base64,/, '');
    const bytes    = Utilities.base64Decode(base64);
    const mimeMap  = {
      pdf: 'application/pdf', doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      txt: 'text/plain',
    };
    const mime     = b.mimeType || mimeMap[ext] || 'application/octet-stream';
    const blob     = Utilities.newBlob(bytes, mime, safeName);
    const folder   = DriveApp.getFolderById(folderId);
    const file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return okJ({ ok: true, url: file.getUrl(), driveFileId: file.getId(), fileName: safeName });
  } catch (e) {
    return failJ('File upload error: ' + e.message);
  }
}

// ── Info (free-form bilingual text sections) ─────────────────────────────────

function saveHandbookInfo_(b) {
  if (!b.title && !b.titleIS) return failJ('title required');
  const id = b.id || ('info_' + uid_());
  const existing = findOne_('handbookInfo', 'id', id);
  const row = {
    id:         id,
    title:      b.title || '',
    titleIS:    b.titleIS || '',
    content:    b.content || '',
    contentIS:  b.contentIS || '',
    sortOrder:  Number(b.sortOrder || 0),
    active:     b.active === false ? false : true,
    createdAt:  existing ? (existing.createdAt || now_()) : now_(),
    updatedAt:  now_(),
  };
  if (existing) updateRow_('handbookInfo', 'id', id, row);
  else          insertRow_('handbookInfo', row);
  return okJ({ id: id, saved: true });
}

function deleteHandbookInfo_(b) {
  if (!b.id) return failJ('id required');
  const existing = findOne_('handbookInfo', 'id', b.id);
  if (!existing) return failJ('Info section not found', 404);
  updateRow_('handbookInfo', 'id', b.id, { active: false, updatedAt: now_() });
  return okJ({ ok: true });
}
