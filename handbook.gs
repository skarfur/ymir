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
    out.areas   = _hbParseAreas_(r);
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
      // areaId pins a division-member to one of the parent role's `areas`
      // entries; '' (default) means "lead" / division-level.
      areaId:           a.areaId || '',
      sortOrder:        a.sortOrder == null ? i : Number(a.sortOrder),
      name:  m ? (m.name  || '') : (a.kennitala ? '' : (r.name  || '')),
      phone: m ? (m.phone || '') : (r.phone || ''),
      email: m ? (m.email || '') : (r.email || ''),
    };
  }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
}

// Each division row stores its own list of areas (sub-units like Námskeið /
// Iðkendur / Félagsstarf / Keppnisstarf) as JSON. Areas are per-division so
// a club can override the default taxonomy where needed.
function _hbParseAreas_(r) {
  let arr = [];
  try { arr = r.areas ? JSON.parse(r.areas) : []; } catch (e) { arr = []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(function (a) { return a && a.id; })
    .map(function (a, i) {
      return {
        id:        String(a.id),
        label:     a.label || '',
        labelIS:   a.labelIS || '',
        sortOrder: a.sortOrder == null ? i : Number(a.sortOrder),
      };
    })
    .sort(function (a, b) { return a.sortOrder - b.sortOrder; });
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
  // Lazy-add columns so a fresh deploy doesn't silently drop new fields
  // when admins haven't re-run setupSpreadsheet() yet.
  addColIfMissing_('handbookRoles', 'members');
  addColIfMissing_('handbookRoles', 'areas');
  addColIfMissing_('handbookRoles', 'boatCategoryKey');
  addColIfMissing_('handbookRoles', 'color');
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
            areaId:           a.areaId || '',
            sortOrder:        a.sortOrder == null ? i : Number(a.sortOrder),
          };
        });
      membersJson = JSON.stringify(arr);
    }
  }
  // Areas (per-division sub-units). Drop blank entries; allocate ids for
  // anything sent without one so member.areaId can resolve.
  let areasJson = '';
  if (b.areas != null) {
    let arr = [];
    try { arr = typeof b.areas === 'string' ? JSON.parse(b.areas) : b.areas; } catch (e) {}
    if (Array.isArray(arr)) {
      arr = arr
        .filter(function (a) { return a && (a.label || a.labelIS); })
        .map(function (a, i) {
          return {
            id:        a.id || ('area_' + uid_()),
            label:     a.label || '',
            labelIS:   a.labelIS || '',
            sortOrder: a.sortOrder == null ? i : Number(a.sortOrder),
          };
        });
      areasJson = JSON.stringify(arr);
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
    areas:           areasJson,
    sortOrder:       Number(b.sortOrder || 0),
  });
  return okJ({ id: r.id, saved: true });
}

function deleteHandbookRole_(b) {
  // Soft-delete leaves children's parentId intact so the admin can re-parent.
  const r = _hbSoftDelete_('handbookRoles', b.id, 'Role not found');
  return r.error || okJ({ ok: true });
}

// Bulk-update sortOrder on a set of role rows. Used by the admin reorder
// arrows: only the sortOrder column is touched, so the heavier members/areas
// JSON columns stay untouched even if they aren't in the payload.
function reorderHandbookRoles_(b) {
  let items = b.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch (e) { items = []; }
  }
  if (!Array.isArray(items)) return failJ('items required');
  let updated = 0;
  items.forEach(function (it) {
    if (!it || !it.id) return;
    const ok = updateRow_('handbookRoles', 'id', it.id, {
      sortOrder: Number(it.sortOrder || 0),
      updatedAt: now_(),
    });
    if (ok) updated++;
  });
  return okJ({ updated: updated });
}

function seedHandbookOrgChart_() {
  addColIfMissing_('handbookRoles', 'areas');
  const existing = (readAll_('handbookRoles') || []).filter(_hbActive_);
  // Dedupe key includes parentId so duplicate titles under different parents
  // are tolerated (legacy data may still have them pre-migration).
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
      members:         '',
      areas:           '',
      active:          true,
      createdAt:       now_(),
      updatedAt:       now_(),
    }, seed);
    insertRow_('handbookRoles', row);
    have[key] = row;
    added++;
    return row;
  }

  // Each division ships with the same four areas of responsibility by default;
  // admins can rename/add/remove per division afterwards.
  const defaultAreas = JSON.stringify([
    { id: 'area_courses',     label: 'Courses',           labelIS: 'Námskeið',     sortOrder: 1 },
    { id: 'area_participants',label: 'Members',           labelIS: 'Iðkendur',     sortOrder: 2 },
    { id: 'area_social',      label: 'Social activities', labelIS: 'Félagsstarf',  sortOrder: 3 },
    { id: 'area_competition', label: 'Competition',       labelIS: 'Keppnisstarf', sortOrder: 4 },
  ]);

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
  deildSeeds.forEach(function (d, i) {
    ensure(Object.assign({ parentId: stjorn.id, sortOrder: i + 1, areas: defaultAreas }, d));
  });
  return okJ({ ok: true, added: added });
}

function _hbSeedKey_(r) {
  return String(r.titleIS || r.title || '').toLowerCase() + '|' + (r.parentId || '');
}

// One-shot migration: collapse level-3 sub-role rows into per-division `areas`
// + member.areaId. Idempotent — re-running on already-migrated data is a no-op
// (no level-3 rows left to collapse). Triggered manually via the admin UI or
// from the Apps Script editor.
function migrateHandbookOrgChartToAreas_() {
  addColIfMissing_('handbookRoles', 'areas');
  const all = (readAll_('handbookRoles') || []).filter(_hbActive_);
  const byId = {};
  all.forEach(function (r) { byId[r.id] = r; });

  // Identify level-3 rows: parent has a parent. Roots have no parent (level
  // 1); divisions have a root parent (level 2); anything deeper is a sub-role.
  const subRoles = all.filter(function (r) {
    const p = r.parentId ? byId[r.parentId] : null;
    return !!(p && p.parentId);
  });
  if (!subRoles.length) return okJ({ ok: true, migrated: 0, note: 'nothing to migrate' });

  // Group sub-roles by their parent (the division).
  const byParent = {};
  subRoles.forEach(function (sr) {
    (byParent[sr.parentId] = byParent[sr.parentId] || []).push(sr);
  });

  let migrated = 0;
  Object.keys(byParent).forEach(function (parentId) {
    const parent = byId[parentId];
    if (!parent) return;
    const subs = byParent[parentId].slice().sort(function (a, b) {
      return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    });

    // Build the parent's area list, reusing each sub-role's id so any
    // existing member.representsRoleId pointers resolve to an areaId.
    let existingAreas = [];
    try { existingAreas = parent.areas ? JSON.parse(parent.areas) : []; } catch (e) {}
    if (!Array.isArray(existingAreas)) existingAreas = [];
    const haveArea = {};
    existingAreas.forEach(function (a) { if (a && a.id) haveArea[a.id] = true; });

    subs.forEach(function (sr, i) {
      if (!haveArea[sr.id]) {
        existingAreas.push({
          id:        sr.id,
          label:     sr.title   || '',
          labelIS:   sr.titleIS || '',
          sortOrder: Number(sr.sortOrder || (i + 1)),
        });
        haveArea[sr.id] = true;
      }
    });

    // Move sub-role members up to the parent, tagging each with areaId.
    let parentMembers = [];
    try { parentMembers = parent.members ? JSON.parse(parent.members) : []; } catch (e) {}
    if (!Array.isArray(parentMembers)) parentMembers = [];

    subs.forEach(function (sr) {
      let srMembers = [];
      try { srMembers = sr.members ? JSON.parse(sr.members) : []; } catch (e) {}
      if (!Array.isArray(srMembers)) return;
      srMembers.forEach(function (m) {
        parentMembers.push(Object.assign({}, m, { areaId: sr.id }));
      });
    });

    // Convert any level-2 representsRoleId references into areaId now that
    // the represented sub-role is an area on the same row.
    parentMembers.forEach(function (m) {
      if (m.representsRoleId && haveArea[m.representsRoleId]) {
        if (!m.areaId) m.areaId = m.representsRoleId;
        m.representsRoleId = '';
      }
    });

    updateRow_('handbookRoles', 'id', parent.id, {
      areas:     JSON.stringify(existingAreas),
      members:   JSON.stringify(parentMembers),
      updatedAt: now_(),
    });

    // Soft-delete the level-3 rows.
    subs.forEach(function (sr) {
      updateRow_('handbookRoles', 'id', sr.id, { active: false, updatedAt: now_() });
      migrated++;
    });
  });

  return okJ({ ok: true, migrated: migrated });
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
  addColIfMissing_('handbookInfo', 'kind');
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
