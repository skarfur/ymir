// Handbook: org chart, contacts, docs, rules. Read endpoint hydrates
// kennitala-linked rows from members and resolves deild colors from boat
// categories so the chart stays in sync with the rest of the app.

function getHandbook_() {
  const rolesRaw    = (data_.readAll('handbookRoles')    || []).filter(_hbActive_);
  const contactsRaw = (data_.readAll('handbookContacts') || []).filter(_hbActive_);
  const docs        = (data_.readAll('handbookDocs')     || []).filter(_hbActive_);
  const info        = (data_.readAll('handbookInfo')     || []).filter(_hbActive_);

  const memberByKt = getMemberMap_();
  const needsCatMap = rolesRaw.some(function (r) { return r.boatCategoryKey && !r.color; });
  const catColorMap = needsCatMap ? _hbBoatCatColorMap_() : {};

  const roles = rolesRaw.map(function (r) {
    const out = Object.assign({}, r);
    if (!out.color && out.boatCategoryKey && catColorMap[out.boatCategoryKey]) {
      out.color = catColorMap[out.boatCategoryKey];
    }
    out.members = _hbHydrateMembers_(r, memberByKt);
    return out;
  });

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
    roles:    roles.sort(_hbByOrder_),
    contacts: contacts.sort(_hbByOrder_),
    docs:     docs.sort(_hbByOrder_),
    info:     info.sort(_hbByOrder_),
  });
}

function _hbActive_(r) { return r && bool_(r.active); }

function _hbByOrder_(a, b) {
  var ao = Number(a.sortOrder || 0), bo = Number(b.sortOrder || 0);
  if (ao !== bo) return ao - bo;
  return String(a.title || '').localeCompare(String(b.title || ''));
}

// Parse a role's `members` JSON array and hydrate name/phone/email from
// each linked member. Falls back to a single legacy entry if `members` is
// empty but the row has the older single-kennitala columns set, so any
// pre-multi-member rows keep displaying.
function _hbHydrateMembers_(r, memberByKt) {
  let arr = [];
  try { arr = r.members ? JSON.parse(r.members) : []; } catch (e) { arr = []; }
  if (!Array.isArray(arr) || !arr.length) {
    if (r.kennitala || r.name) {
      arr = [{ kennitala: r.kennitala || '', label: '', labelIS: '' }];
    } else {
      return [];
    }
  }
  return arr.map(function (a, i) {
    const m = a.kennitala ? memberByKt[String(a.kennitala).trim()] : null;
    return {
      kennitala:        a.kennitala || '',
      label:            a.label || '',
      labelIS:          a.labelIS || '',
      representsRoleId: a.representsRoleId || '',
      sortOrder:        a.sortOrder == null ? i : Number(a.sortOrder),
      name:  m ? (m.name  || '') : (a.kennitala ? '' : (r.name  || '')),
      phone: m ? (m.phone || '') : (r.phone || ''),
      email: m ? (m.email || '') : (r.email || ''),
    };
  }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
}

function _hbBoatCatColorMap_() {
  const out = {};
  try {
    const raw = getConfigValue_('boatCategories', getConfigMap_());
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) {
      list.forEach(function (c) {
        if (c && c.key && c.color) out[String(c.key)] = String(c.color);
      });
    }
  } catch (e) {}
  return out;
}

// ── Generic upsert / soft-delete helpers ─────────────────────────────────────

function _hbUpsert_(tabKey, idPrefix, b, fields) {
  const id = b.id || (idPrefix + uid_());
  const existing = findOne_(tabKey, 'id', id);
  const row = Object.assign({ id: id }, fields, {
    active:    b.active === false ? false : true,
    createdAt: existing ? (existing.createdAt || now_()) : now_(),
    updatedAt: now_(),
  });
  if (existing) updateRow_(tabKey, 'id', id, row);
  else          insertRow_(tabKey, row);
  return { id: id, existing: existing };
}

function _hbSoftDelete_(tabKey, id, notFoundMsg) {
  if (!id) return { error: failJ('id required') };
  const existing = findOne_(tabKey, 'id', id);
  if (!existing) return { error: failJ(notFoundMsg, 404) };
  updateRow_(tabKey, 'id', id, { active: false, updatedAt: now_() });
  return { existing: existing };
}

// ── Contacts (member-linked phone book) ──────────────────────────────────────
// `memberId` holds a kennitala (mirrors the column name on roles).

function saveHandbookContact_(b) {
  if (!b.label && !b.labelIS) return failJ('label required');
  const r = _hbUpsert_('handbookContacts', 'contact_', b, {
    memberId:   b.memberId || '',
    label:      b.label || '',
    labelIS:    b.labelIS || '',
    name:       b.name || '',
    phone:      b.phone || '',
    email:      b.email || '',
    notes:      b.notes || '',
    notesIS:    b.notesIS || '',
    sortOrder:  Number(b.sortOrder || 0),
  });
  return okJ({ id: r.id, saved: true });
}

function deleteHandbookContact_(b) {
  const r = _hbSoftDelete_('handbookContacts', b.id, 'Contact not found');
  return r.error || okJ({ ok: true });
}

// ── Roles (org chart) ────────────────────────────────────────────────────────

function saveHandbookRole_(b) {
  if (!b.title && !b.titleIS) return failJ('title required');
  // Normalize members: drop blank rows, keep only the persisted fields so
  // hydrated name/phone/email don't round-trip back into the sheet.
  let membersJson = '';
  if (b.members != null) {
    let arr = [];
    try { arr = typeof b.members === 'string' ? JSON.parse(b.members) : b.members; } catch (e) {}
    if (Array.isArray(arr)) {
      arr = arr
        .filter(function (a) { return a && (a.kennitala || a.label || a.labelIS); })
        .map(function (a, i) {
          return {
            kennitala:        String(a.kennitala || '').trim(),
            label:            a.label || '',
            labelIS:          a.labelIS || '',
            representsRoleId: a.representsRoleId || '',
            sortOrder:        a.sortOrder == null ? i : Number(a.sortOrder),
          };
        });
      membersJson = JSON.stringify(arr);
    }
  }
  const r = _hbUpsert_('handbookRoles', 'role_', b, {
    parentId:        b.parentId || '',
    title:           b.title || '',
    titleIS:         b.titleIS || '',
    name:            b.name || '',
    kennitala:       b.kennitala || '',
    phone:           b.phone || '',
    email:           b.email || '',
    notes:           b.notes || '',
    notesIS:         b.notesIS || '',
    color:           b.color || '',
    boatCategoryKey: b.boatCategoryKey || '',
    members:         membersJson,
    sortOrder:       Number(b.sortOrder || 0),
  });
  return okJ({ id: r.id, saved: true });
}

function deleteHandbookRole_(b) {
  // Soft-delete leaves children's parentId intact so the admin can re-parent.
  const r = _hbSoftDelete_('handbookRoles', b.id, 'Role not found');
  return r.error || okJ({ ok: true });
}

function seedHandbookOrgChart_() {
  const existing = (readAll_('handbookRoles') || []).filter(_hbActive_);
  // Dedupe key includes parentId so the same titleIS can coexist under
  // different parents (e.g. "Námskeið" appears under every deild).
  const have = {};
  existing.forEach(function (r) {
    have[_hbSeedKey_(r)] = r;
  });

  let added = 0;
  function ensure(seed) {
    const key = _hbSeedKey_(seed);
    if (have[key]) return have[key];
    const row = Object.assign({
      id:              'role_' + uid_(),
      parentId:        '',
      name:            '',
      kennitala:       '',
      phone:           '',
      email:           '',
      notes:           '',
      notesIS:         '',
      color:           '',
      boatCategoryKey: '',
      active:          true,
      createdAt:       now_(),
      updatedAt:       now_(),
    }, seed);
    insertRow_('handbookRoles', row);
    have[key] = row;
    added++;
    return row;
  }

  // Stjórn isn't a boat category, so it carries an explicit color; deildir
  // resolve theirs from the linked boatCategoryKey at read time.
  const stjorn = ensure({
    title: 'Board', titleIS: 'Stjórn', sortOrder: 0, color: '#d4af37',
  });
  const deildSeeds = [
    { title: 'Keelboat division',    titleIS: 'Kjölbátadeild',  boatCategoryKey: 'keelboat' },
    { title: 'Dinghy division',      titleIS: 'Kænudeild',      boatCategoryKey: 'dinghy' },
    { title: 'Rowing division',      titleIS: 'Róðrardeild',    boatCategoryKey: 'rowing-shell' },
    { title: 'Kayak division',       titleIS: 'Kajakadeild',    boatCategoryKey: 'kayak' },
    { title: 'Wingfoiling division', titleIS: 'Bævængjudeild',  boatCategoryKey: 'wingfoil' },
  ];
  // Each deild has the same four areas of responsibility. Sub-roles are seeded
  // empty (no kennitala) so admins can assign people; deild color cascades
  // visually via CSS so sub-roles don't need their own color.
  const subroles = [
    { title: 'Courses',           titleIS: 'Námskeið',     sortOrder: 1 },
    { title: 'Members',           titleIS: 'Iðkendur',     sortOrder: 2 },
    { title: 'Social activities', titleIS: 'Félagsstarf',  sortOrder: 3 },
    { title: 'Competition',       titleIS: 'Keppnisstarf', sortOrder: 4 },
  ];
  deildSeeds.forEach(function (d, i) {
    const deild = ensure(Object.assign({ parentId: stjorn.id, sortOrder: i + 1 }, d));
    subroles.forEach(function (sr) {
      ensure(Object.assign({ parentId: deild.id }, sr));
    });
  });
  return okJ({ ok: true, added: added });
}

function _hbSeedKey_(r) {
  return String(r.titleIS || r.title || '').toLowerCase() + '|' + (r.parentId || '');
}

// ── Docs (PDFs + URLs) ───────────────────────────────────────────────────────

function saveHandbookDoc_(b) {
  if (!b.title) return failJ('title required');
  if (!b.url)   return failJ('url required');
  const r = _hbUpsert_('handbookDocs', 'doc_', b, {
    category:    b.category || '',
    categoryIS:  b.categoryIS || '',
    title:       b.title || '',
    titleIS:     b.titleIS || '',
    url:         b.url || '',
    driveFileId: b.driveFileId || '',
    notes:       b.notes || '',
    notesIS:     b.notesIS || '',
    sortOrder:   Number(b.sortOrder || 0),
  });
  return okJ({ id: r.id, saved: true });
}

function deleteHandbookDoc_(b) {
  const r = _hbSoftDelete_('handbookDocs', b.id, 'Doc not found');
  if (r.error) return r.error;
  // Trash the Drive file if we own it; plain external URLs are left alone.
  const existing = r.existing;
  if (existing.driveFileId) {
    try { DriveApp.getFileById(existing.driveFileId).setTrashed(true); } catch (e) {}
  } else if (existing.url) {
    try {
      var m = String(existing.url).match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (m) DriveApp.getFileById(m[1]).setTrashed(true);
    } catch (e) {}
  }
  return okJ({ ok: true });
}

// Script Property required: DRIVE_FOLDER_ID_HANDBOOK_DOCS
function uploadHandbookDoc_(b) {
  if (!b.fileData) return failJ('fileData required');
  const folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID_HANDBOOK_DOCS');
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
    const mime  = b.mimeType || mimeMap[ext] || 'application/octet-stream';
    const blob  = Utilities.newBlob(bytes, mime, safeName);
    const file  = DriveApp.getFolderById(folderId).createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return okJ({ ok: true, url: file.getUrl(), driveFileId: file.getId(), fileName: safeName });
  } catch (e) {
    return failJ('File upload error: ' + e.message);
  }
}

// ── Info (free-form bilingual text sections) ─────────────────────────────────

function saveHandbookInfo_(b) {
  if (!b.title && !b.titleIS) return failJ('title required');
  // 'info' is the legacy fallback bucket so old rows without an explicit
  // kind still round-trip through the editor; admin UI only writes
  // 'contacts' or 'rules'.
  const allowedKinds = { contacts: 1, rules: 1, info: 1 };
  const r = _hbUpsert_('handbookInfo', 'info_', b, {
    kind:       allowedKinds[b.kind] ? b.kind : 'info',
    title:      b.title || '',
    titleIS:    b.titleIS || '',
    content:    b.content || '',
    contentIS:  b.contentIS || '',
    sortOrder:  Number(b.sortOrder || 0),
  });
  return okJ({ id: r.id, saved: true });
}

function deleteHandbookInfo_(b) {
  const r = _hbSoftDelete_('handbookInfo', b.id, 'Info section not found');
  return r.error || okJ({ ok: true });
}
