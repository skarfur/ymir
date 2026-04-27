// ═══════════════════════════════════════════════════════════════════════════════
// HANDBOOK / HANDBÓK
// ═══════════════════════════════════════════════════════════════════════════════
//
// Members- and staff-facing reference: a visual org chart with contact data,
// quick links to PDFs (hosted on Drive), free-form bilingual info sections
// for emergency contacts and rules/best practices, plus an auto-populated
// staff contact list pulled from the members sheet. Editable from the admin
// portal.
//
// Four sheets back this:
//   handbook_roles    — org-chart entries with optional parentId for hierarchy
//                       and optional kennitala link to a member record. When
//                       kennitala is set, the read endpoint hydrates missing
//                       name / phone / email from the member's record so the
//                       handbook stays in sync without duplicate data entry.
//                       `color` is an optional hex string for the box accent.
//   handbook_contacts — manually curated people in the contact-numbers
//                       section. Each row has an optional `memberId`
//                       (kennitala) link plus a free-text `label` /
//                       `labelIS` (e.g. "Emergency contact",
//                       "Maintenance lead"). Member-linked rows hydrate
//                       missing name / phone / email from the member's
//                       record at read time.
//   handbook_docs     — PDF / URL entries grouped by category. driveFileId
//                       is set when the file was uploaded through the admin
//                       UI so deletes can also trash the Drive file.
//   handbook_info     — bilingual text sections, distinguished by `kind`:
//                       'contacts' (free-text emergency / external numbers),
//                       'rules'    (rules / best practices),
//                       other      (legacy / free-form).
//
// Soft-deletes via `active=false` so audit history survives.

// ── Reads ────────────────────────────────────────────────────────────────────

function getHandbook_() {
  const rolesRaw    = (data_.readAll('handbookRoles')    || []).filter(_handbookActive_);
  const contactsRaw = (data_.readAll('handbookContacts') || []).filter(_handbookActive_);
  const docs        = (data_.readAll('handbookDocs')     || []).filter(_handbookActive_);
  const info        = (data_.readAll('handbookInfo')     || []).filter(_handbookActive_);

  const memberByKt = _handbookMemberMap_();

  // Hydrate roles: when a role has a kennitala link, pull missing name /
  // phone / email from the member record. The role's own values still win
  // when they're set, so admins can override (e.g. publish a club extension
  // rather than the member's mobile).
  const roles = rolesRaw.map(function (r) {
    const m = r.kennitala ? memberByKt[String(r.kennitala).trim()] : null;
    if (!m) return r;
    return Object.assign({}, r, {
      name:  r.name  || m.name  || '',
      phone: r.phone || m.phone || '',
      email: r.email || m.email || '',
      _linkedMemberRole: m.role || '',
    });
  });

  // Hydrate contacts the same way; the row's own override wins. memberId
  // here holds a kennitala (matches the column name on the role rows).
  const contacts = contactsRaw.map(function (c) {
    const m = c.memberId ? memberByKt[String(c.memberId).trim()] : null;
    if (!m) return c;
    return Object.assign({}, c, {
      name:  c.name  || m.name  || '',
      phone: c.phone || m.phone || '',
      email: c.email || m.email || '',
    });
  });

  return okJ({
    roles:    roles.sort(_byOrder_),
    contacts: contacts.sort(_byOrder_),
    docs:     docs.sort(_byOrder_),
    info:     info.sort(_byOrder_),
  });
}

function _handbookActive_(r) { return r && r.active !== false && r.active !== 'false'; }
function _byOrder_(a, b) {
  var ao = Number(a.sortOrder || 0), bo = Number(b.sortOrder || 0);
  if (ao !== bo) return ao - bo;
  return String(a.title || '').localeCompare(String(b.title || ''));
}

function _handbookMemberMap_() {
  const map = {};
  try {
    (readAll_('members') || []).forEach(function (m) {
      if (m && m.kennitala) map[String(m.kennitala).trim()] = m;
    });
  } catch (e) {}
  return map;
}

// ── Contacts (member-linked phone book) ─────────────────────────────────────
// `memberId` holds a kennitala (mirrors the column name used on roles).
// Free-text label per entry — bilingual EN + IS. The read endpoint hydrates
// missing name / phone / email from the linked member record.

function saveHandbookContact_(b) {
  if (!b.label && !b.labelIS) return failJ('label required');
  const id = b.id || ('contact_' + uid_());
  const existing = findOne_('handbookContacts', 'id', id);
  const row = {
    id:         id,
    memberId:   b.memberId || '',
    label:      b.label || '',
    labelIS:    b.labelIS || '',
    name:       b.name || '',
    phone:      b.phone || '',
    email:      b.email || '',
    notes:      b.notes || '',
    notesIS:    b.notesIS || '',
    sortOrder:  Number(b.sortOrder || 0),
    active:     b.active === false ? false : true,
    createdAt:  existing ? (existing.createdAt || now_()) : now_(),
    updatedAt:  now_(),
  };
  if (existing) updateRow_('handbookContacts', 'id', id, row);
  else          insertRow_('handbookContacts', row);
  return okJ({ id: id, saved: true });
}

function deleteHandbookContact_(b) {
  if (!b.id) return failJ('id required');
  const existing = findOne_('handbookContacts', 'id', b.id);
  if (!existing) return failJ('Contact not found', 404);
  updateRow_('handbookContacts', 'id', b.id, { active: false, updatedAt: now_() });
  return okJ({ ok: true });
}

// ── Roles (org chart) ────────────────────────────────────────────────────────

function saveHandbookRole_(b) {
  if (!b.title && !b.titleIS) return failJ('title required');
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
    color:      b.color || '',
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

// One-shot scaffolding: seed a Stjórn root + the five deildir if the chart
// is empty (or if the named entries are missing). Idempotent — never
// overwrites existing entries, and silently skips deildir whose title
// already appears.
function seedHandbookOrgChart_() {
  const existing = (readAll_('handbookRoles') || []).filter(_handbookActive_);
  const have = {};
  existing.forEach(function (r) {
    have[String(r.titleIS || r.title).toLowerCase()] = r;
  });

  function ensure(seed) {
    const key = String(seed.titleIS || seed.title).toLowerCase();
    if (have[key]) return have[key];
    const row = Object.assign({
      id:        'role_' + uid_(),
      parentId:  '',
      name:      '',
      kennitala: '',
      phone:     '',
      email:     '',
      notes:     '',
      notesIS:   '',
      color:     '',
      active:    true,
      createdAt: now_(),
      updatedAt: now_(),
    }, seed);
    insertRow_('handbookRoles', row);
    have[key] = row;
    return row;
  }

  const stjorn = ensure({
    title:     'Board',
    titleIS:   'Stjórn',
    sortOrder: 0,
    color:     '#d4af37',
  });
  const deildir = [
    { title: 'Keelboat division',  titleIS: 'Kjölbátadeild',  color: '#5b9bd5' },
    { title: 'Dinghy division',    titleIS: 'Kænudeild',      color: '#a3cb3e' },
    { title: 'Rowing division',    titleIS: 'Róðrardeild',    color: '#d9b441' },
    { title: 'Kayak division',     titleIS: 'Kajakadeild',    color: '#9b59b6' },
    { title: 'Wingfoiling division', titleIS: 'Bævængjudeild', color: '#e67e22' },
  ];
  let added = 0;
  deildir.forEach(function (d, i) {
    const before = have[String(d.titleIS).toLowerCase()];
    ensure(Object.assign({ parentId: stjorn.id, sortOrder: i + 1 }, d));
    if (!before) added++;
  });
  return okJ({ ok: true, added: added });
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
  // 'contacts' = important phone numbers (emergency, external orgs, …),
  // 'rules'    = rules / best practices, anything else falls into the
  // legacy bucket and renders below the named sections.
  const allowedKinds = { contacts: 1, rules: 1, info: 1 };
  const kind = allowedKinds[b.kind] ? b.kind : 'info';
  const row = {
    id:         id,
    kind:       kind,
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
