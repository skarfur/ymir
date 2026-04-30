// Handbook: org chart, contacts, docs, rules.
//
// Storage:
//   - roles    → JSON array under config key 'handbookRoles'
//   - docs     → JSON array under config key 'handbookDocs'
//   - contacts → JSON array under config key 'handbookContacts'
//   - info     → JSON array under config key 'handbookInfo'
//
// All four live alongside boats/locations/activity_types in the config sheet.
// getHandbook_ stays a dedicated endpoint (separate from getConfig) so
// non-handbook pages don't pay the bytes.
//
// Cell-size note: Sheets caps cells at 50,000 chars. Long-form info content
// (rules, harbor briefings) could plausibly approach that if a club
// accumulates many bilingual sections. If you hit it, split per-section into
// `handbookInfo_<id>` keys instead of one mega-blob.

function getHandbook_() {
  const rolesRaw    = readConfigList_('handbookRoles').filter(_hbActive_);
  const contactsRaw = readConfigList_('handbookContacts').filter(_hbActive_);
  const docs        = readConfigList_('handbookDocs').filter(_hbActive_);
  const info        = readConfigList_('handbookInfo').filter(_hbActive_);

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

// Reconcile the configured Drive folder into the `handbookDocs` config list.
// For each file not yet tracked by `driveFileId`, append a new entry with
// `title = file name (sans extension)`. Shortcuts are resolved to their target
// via the Drive Advanced Service (if enabled) so the stored URL points at the
// real file, not the shortcut. Existing rows are never touched — admins keep
// any title / category overrides they've set.
//
// Requires the Drive Advanced Service to be enabled in the Apps Script project
// for shortcut resolution. Without it, shortcuts are skipped and reported back.
function syncHandbookDocs_() {
  const folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID_HANDBOOK_DOCS');
  if (!folderId) return failJ('Drive folder not configured');
  let folder;
  try { folder = DriveApp.getFolderById(folderId); }
  catch (e) { return failJ('Drive folder not accessible: ' + e.message); }

  const existing = readConfigList_('handbookDocs');
  const trackedIds = {};
  existing.forEach(function (d) {
    if (d && d.driveFileId) trackedIds[String(d.driveFileId)] = true;
  });

  // Highest current sortOrder so newly added rows append cleanly to the end.
  let maxSort = 0;
  existing.forEach(function (d) {
    var n = Number(d && d.sortOrder || 0);
    if (n > maxSort) maxSort = n;
  });

  const driveAvailable = (typeof Drive !== 'undefined' && Drive && Drive.Files);
  let added = 0, skipped = 0, shortcutsUnresolved = 0;
  const skipped_reasons = [];

  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const id   = f.getId();
    const mime = f.getMimeType();
    const name = f.getName();

    let targetId = id;
    let url      = f.getUrl();
    let title    = name;

    if (mime === 'application/vnd.google-apps.shortcut') {
      if (!driveAvailable) {
        shortcutsUnresolved++;
        skipped_reasons.push(name + ' (shortcut — enable Drive Advanced Service)');
        continue;
      }
      try {
        const meta = Drive.Files.get(id, { fields: 'shortcutDetails,name' });
        const tid  = meta && meta.shortcutDetails && meta.shortcutDetails.targetId;
        if (!tid) { shortcutsUnresolved++; skipped_reasons.push(name + ' (shortcut target missing)'); continue; }
        targetId = tid;
        const target = Drive.Files.get(tid, { fields: 'name,webViewLink' });
        if (target) {
          if (target.webViewLink) url = target.webViewLink;
          if (target.name) title = target.name;
        }
      } catch (e) {
        shortcutsUnresolved++;
        skipped_reasons.push(name + ' (shortcut: ' + e.message + ')');
        continue;
      }
    }

    if (trackedIds[String(targetId)]) { skipped++; continue; }

    const cleanTitle = String(title || name).replace(/\.[^.]+$/, '') || 'Untitled';
    maxSort += 10;
    saveConfigListItem_('handbookDocs', {
      id:          '',
      category:    '',
      categoryIS:  '',
      title:       cleanTitle,
      titleIS:     '',
      url:         url,
      driveFileId: targetId,
      notes:       '',
      notesIS:     '',
      sortOrder:   maxSort,
      active:      true,
    });
    trackedIds[String(targetId)] = true;
    added++;
  }

  return okJ({
    ok: true,
    added: added,
    skipped: skipped,
    shortcutsUnresolved: shortcutsUnresolved,
    notes: skipped_reasons,
  });
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
  const res = saveConfigListItem_('handbookInfo', {
    id:        b.id || '',
    kind:      allowedKinds[b.kind] ? b.kind : 'info',
    title:     b.title || '',
    titleIS:   b.titleIS || '',
    content:   b.content || '',
    contentIS: b.contentIS || '',
    sortOrder: Number(b.sortOrder || 0),
    active:    b.active === false ? false : true,
  });
  return okJ({ id: res.id, saved: true });
}

function deleteHandbookInfo_(b) {
  if (!b.id) return failJ('id required');
  const res = deleteConfigListItem_('handbookInfo', b.id, { soft: true });
  if (!res.deactivated) return failJ('Info section not found', 404);
  return okJ({ ok: true });
}

