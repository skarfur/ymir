// Handbook: org chart, contacts, docs, rules.
//
// Storage:
//   - roles    → JSON array under config key 'handbookRoles'
//   - docs     → JSON array under config key 'handbookDocs'
//   - contacts → JSON array under config key 'handbookContacts'
//   - info     → its own sheet ('handbook_info'), because bilingual rich-text
//                content can blow the 50,000-char per-cell limit when packed
//                into one JSON blob.
//
// The first three pieces are tiny taxonomies that fit naturally alongside
// boats/locations/activity_types in the config sheet. getHandbook_ stays a
// dedicated endpoint (separate from getConfig) so non-handbook pages don't
// pay the bytes.

function getHandbook_() {
  // One-shot migration from the legacy per-handbook tabs. Runs at most once
  // per config key — only triggers when the config key is empty AND the old
  // sheet still has data. Idempotent on re-entry.
  try { _hbAutoMigrateSheetsToConfig_(); } catch (e) { Logger.log('handbook auto-migrate: ' + e); }

  const rolesRaw    = readConfigList_('handbookRoles').filter(_hbActive_);
  const contactsRaw = readConfigList_('handbookContacts').filter(_hbActive_);
  const docs        = readConfigList_('handbookDocs').filter(_hbActive_);
  const info        = (data_.readAll('handbookInfo') || []).filter(_hbActive_);

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

// Coerce a raw `members` field — either a JSON string (legacy sheet rows) or
// an array (new config-list shape) — into a plain array.
function _hbCoerceArray_(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try { var p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}

// Parse a role's `members` array and hydrate name/phone/email from each
// linked member. Falls back to a single legacy entry if `members` is empty
// but the row has the older single-kennitala columns set, so any pre-multi-
// member rows keep displaying.
function _hbHydrateMembers_(r, memberByKt) {
  var arr = _hbCoerceArray_(r.members);
  if (!arr.length) {
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
// Iðkendur / Félagsstarf / Keppnisstarf). Areas are per-division so a club
// can override the default taxonomy where needed.
function _hbParseAreas_(r) {
  var arr = _hbCoerceArray_(r.areas);
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

// ── Contacts (member-linked phone book) ──────────────────────────────────────
// `memberId` holds a kennitala (mirrors the column name on roles).

function saveHandbookContact_(b) {
  if (!b.label && !b.labelIS) return failJ('label required');
  const res = saveConfigListItem_('handbookContacts', {
    id:         b.id || '',
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
  });
  return okJ({ id: res.id, saved: true });
}

function deleteHandbookContact_(b) {
  if (!b.id) return failJ('id required');
  const res = deleteConfigListItem_('handbookContacts', b.id, { soft: true });
  if (!res.deactivated) return failJ('Contact not found', 404);
  return okJ({ ok: true });
}

// ── Roles (org chart) ────────────────────────────────────────────────────────

function saveHandbookRole_(b) {
  if (!b.title && !b.titleIS) return failJ('title required');
  // Normalize members: drop blank rows, keep only the persisted fields so
  // hydrated name/phone/email don't round-trip back into storage.
  var members = [];
  if (b.members != null) {
    var arr = typeof b.members === 'string' ? _hbCoerceArray_(b.members) : (Array.isArray(b.members) ? b.members : []);
    members = arr
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
  }
  // Areas (per-division sub-units). Drop blank entries; allocate ids for
  // anything sent without one so member.areaId can resolve.
  var areas = [];
  if (b.areas != null) {
    var aarr = typeof b.areas === 'string' ? _hbCoerceArray_(b.areas) : (Array.isArray(b.areas) ? b.areas : []);
    areas = aarr
      .filter(function (a) { return a && (a.label || a.labelIS); })
      .map(function (a, i) {
        return {
          id:        a.id || ('area_' + uid_()),
          label:     a.label || '',
          labelIS:   a.labelIS || '',
          sortOrder: a.sortOrder == null ? i : Number(a.sortOrder),
        };
      });
  }
  const res = saveConfigListItem_('handbookRoles', {
    id:              b.id || '',
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
    members:         members,
    areas:           areas,
    sortOrder:       Number(b.sortOrder || 0),
    active:          b.active === false ? false : true,
  });
  return okJ({ id: res.id, saved: true });
}

function deleteHandbookRole_(b) {
  if (!b.id) return failJ('id required');
  // Soft-delete leaves children's parentId intact so the admin can re-parent.
  const res = deleteConfigListItem_('handbookRoles', b.id, { soft: true });
  if (!res.deactivated) return failJ('Role not found', 404);
  return okJ({ ok: true });
}

// Bulk-update sortOrder on a set of roles. Used by the admin reorder arrows:
// only sortOrder changes, members/areas stay untouched.
function reorderHandbookRoles_(b) {
  let items = b.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch (e) { items = []; }
  }
  if (!Array.isArray(items)) return failJ('items required');
  const arr = readConfigList_('handbookRoles');
  let updated = 0;
  items.forEach(function (it) {
    if (!it || !it.id) return;
    const idx = arr.findIndex(function (x) { return x && x.id === it.id; });
    if (idx < 0) return;
    arr[idx].sortOrder = Number(it.sortOrder || 0);
    arr[idx].updatedAt = now_();
    updated++;
  });
  if (updated) {
    setConfigSheetValue_('handbookRoles', JSON.stringify(arr));
    cDel_('config');
  }
  return okJ({ updated: updated });
}

function seedHandbookOrgChart_() {
  const existing = readConfigList_('handbookRoles').filter(_hbActive_);
  // Dedupe key includes parentId so duplicate titles under different parents
  // are tolerated (legacy data may still have them pre-migration).
  const have = {};
  existing.forEach(function (r) { have[_hbSeedKey_(r)] = r; });

  let added = 0;
  function ensure(seed) {
    const key = _hbSeedKey_(seed);
    if (have[key]) return have[key];
    const res = saveConfigListItem_('handbookRoles', Object.assign({
      parentId:        '',
      name:            '',
      kennitala:       '',
      phone:           '',
      email:           '',
      notes:           '',
      notesIS:         '',
      color:           '',
      boatCategoryKey: '',
      members:         [],
      areas:           [],
      active:          true,
    }, seed));
    have[key] = res.item;
    added++;
    return res.item;
  }

  // Each division ships with the same four areas of responsibility by default;
  // admins can rename/add/remove per division afterwards.
  const defaultAreas = [
    { id: 'area_courses',     label: 'Courses',           labelIS: 'Námskeið',     sortOrder: 1 },
    { id: 'area_participants',label: 'Members',           labelIS: 'Iðkendur',     sortOrder: 2 },
    { id: 'area_social',      label: 'Social activities', labelIS: 'Félagsstarf',  sortOrder: 3 },
    { id: 'area_competition', label: 'Competition',       labelIS: 'Keppnisstarf', sortOrder: 4 },
  ];

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
    ensure(Object.assign({ parentId: stjorn.id, sortOrder: i + 1, areas: defaultAreas.slice() }, d));
  });
  return okJ({ ok: true, added: added });
}

function _hbSeedKey_(r) {
  return String(r.titleIS || r.title || '').toLowerCase() + '|' + (r.parentId || '');
}

// One-shot migration: collapse level-3 sub-role rows into per-division `areas`
// + member.areaId. Idempotent — re-running on already-migrated data is a no-op.
function migrateHandbookOrgChartToAreas_() {
  const all = readConfigList_('handbookRoles').filter(_hbActive_);
  const byId = {};
  all.forEach(function (r) { byId[r.id] = r; });

  // Identify level-3 rows: parent has a parent. Roots have no parent (level
  // 1); divisions have a root parent (level 2); anything deeper is a sub-role.
  const subRoles = all.filter(function (r) {
    const p = r.parentId ? byId[r.parentId] : null;
    return !!(p && p.parentId);
  });
  if (!subRoles.length) return okJ({ ok: true, migrated: 0, note: 'nothing to migrate' });

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
    var existingAreas = _hbCoerceArray_(parent.areas);
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

    var parentMembers = _hbCoerceArray_(parent.members);

    subs.forEach(function (sr) {
      var srMembers = _hbCoerceArray_(sr.members);
      srMembers.forEach(function (m) {
        parentMembers.push(Object.assign({}, m, { areaId: sr.id }));
      });
    });

    parentMembers.forEach(function (m) {
      if (m.representsRoleId && haveArea[m.representsRoleId]) {
        if (!m.areaId) m.areaId = m.representsRoleId;
        m.representsRoleId = '';
      }
    });

    saveConfigListItem_('handbookRoles', {
      id:      parent.id,
      areas:   existingAreas,
      members: parentMembers,
    });

    subs.forEach(function (sr) {
      saveConfigListItem_('handbookRoles', { id: sr.id, active: false });
      migrated++;
    });
  });

  return okJ({ ok: true, migrated: migrated });
}

// ── Docs (PDFs + URLs) ───────────────────────────────────────────────────────

function saveHandbookDoc_(b) {
  if (!b.title) return failJ('title required');
  if (!b.url)   return failJ('url required');
  const res = saveConfigListItem_('handbookDocs', {
    id:          b.id || '',
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
  });
  return okJ({ id: res.id, saved: true });
}

function deleteHandbookDoc_(b) {
  if (!b.id) return failJ('id required');
  const arr = readConfigList_('handbookDocs');
  const existing = arr.find(function (x) { return x && x.id === b.id; });
  if (!existing) return failJ('Doc not found', 404);
  // Trash the Drive file if we own it; plain external URLs are left alone.
  if (existing.driveFileId) {
    try { DriveApp.getFileById(existing.driveFileId).setTrashed(true); } catch (e) {}
  } else if (existing.url) {
    try {
      var m = String(existing.url).match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (m) DriveApp.getFileById(m[1]).setTrashed(true);
    } catch (e) {}
  }
  deleteConfigListItem_('handbookDocs', b.id, { soft: true });
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
// Stays on its own sheet because the bilingual `content`/`contentIS` columns
// can hold long-form rich text; packing many of them into one config cell
// risks the 50,000-char per-cell limit.

function saveHandbookInfo_(b) {
  if (!b.title && !b.titleIS) return failJ('title required');
  addColIfMissing_('handbookInfo', 'kind');
  // 'info' is the legacy fallback bucket so old rows without an explicit
  // kind still round-trip through the editor; admin UI only writes
  // 'contacts' or 'rules'.
  const allowedKinds = { contacts: 1, rules: 1, info: 1 };
  const id = b.id || ('info_' + uid_());
  const existing = findOne_('handbookInfo', 'id', id);
  const row = {
    id:        id,
    kind:      allowedKinds[b.kind] ? b.kind : 'info',
    title:     b.title || '',
    titleIS:   b.titleIS || '',
    content:   b.content || '',
    contentIS: b.contentIS || '',
    sortOrder: Number(b.sortOrder || 0),
    active:    b.active === false ? false : true,
    createdAt: existing ? (existing.createdAt || now_()) : now_(),
    updatedAt: now_(),
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

// ── One-shot migration: legacy per-handbook tabs → config keys ───────────────
// Reads the old `handbook_roles`, `handbook_docs`, `handbook_contacts` tabs
// (if they still exist) and copies their rows into the corresponding config
// keys. Idempotent: skips any key that's already populated.
//
// Called automatically from getHandbook_ on first read, but also exposed as
// `migrateHandbookSheetsToConfig` for manual invocation from the admin UI.
function _hbAutoMigrateSheetsToConfig_() {
  const targets = [
    { tab: 'handbook_roles',    key: 'handbookRoles',    type: 'roles'    },
    { tab: 'handbook_docs',     key: 'handbookDocs',     type: 'docs'     },
    { tab: 'handbook_contacts', key: 'handbookContacts', type: 'contacts' },
  ];
  var ss = null;
  var migrated = { roles: 0, docs: 0, contacts: 0 };
  var notes    = { roles: '', docs: '', contacts: '' };
  targets.forEach(function (t) {
    try {
      // Already migrated? Skip.
      if (readConfigList_(t.key).length) {
        notes[t.type] = 'skip:already-populated';
        return;
      }
      if (!ss) ss = ss_();
      const sheet = ss.getSheetByName(t.tab);
      if (!sheet) {
        notes[t.type] = 'skip:no-tab';
        return;
      }
      if (sheet.getLastRow() < 2) {
        notes[t.type] = 'skip:no-rows';
        return;
      }
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      const data    = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
      const items = data.map(function (r) {
        var obj = {};
        headers.forEach(function (h, i) {
          var v = r[i];
          if (h === 'active')         obj.active    = bool_(v);
          else if (h === 'sortOrder') obj.sortOrder = Number(v || 0);
          else                        obj[h]        = v == null ? '' : String(v);
        });
        // Roles store members/areas as JSON-stringified cells in the legacy
        // schema; lift them up into native arrays for the new shape.
        if (t.type === 'roles') {
          obj.members = _hbCoerceArray_(obj.members);
          obj.areas   = _hbCoerceArray_(obj.areas);
        }
        return obj;
      }).filter(function (obj) { return obj.id; });
      if (items.length) {
        setConfigSheetValue_(t.key, JSON.stringify(items));
        // Force a flush before the next target reads the config sheet.
        // Apps Script otherwise batches writes, so the next iteration's
        // readConfigList_ check could see stale state.
        SpreadsheetApp.flush();
        migrated[t.type] = items.length;
        notes[t.type]    = 'migrated';
      } else {
        notes[t.type] = 'skip:no-id-rows';
      }
    } catch (err) {
      notes[t.type] = 'error:' + (err && err.message ? err.message : String(err));
    }
  });
  if (migrated.roles || migrated.docs || migrated.contacts) {
    cDel_('config');
  }
  Logger.log('handbook auto-migrate: counts=' + JSON.stringify(migrated) + ' notes=' + JSON.stringify(notes));
  return { counts: migrated, notes: notes };
}

function migrateHandbookSheetsToConfig_() {
  var result = _hbAutoMigrateSheetsToConfig_();
  return okJ({ ok: true, migrated: result.counts, notes: result.notes });
}
