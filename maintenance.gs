// ═══════════════════════════════════════════════════════════════════════════════
// MAINTENANCE
// ═══════════════════════════════════════════════════════════════════════════════

function getMaintenance_() {
  const c = cGet_('maintenance'); if (c) return okJ({ requests: c });
  let requests = [];
  try { requests = readAll_('maintenance'); } catch (e) { requests = []; }
  cPut_('maintenance', requests);
  return okJ({ requests });
}

function saveMaintenance_(b) {
  ensureMaintCols_();

  // If an id is provided, update the existing row instead of creating a new one
  if (b.id) {
    var updates = {};
    if (b.severity    !== undefined) updates.severity    = b.severity;
    if (b.markOos     !== undefined) updates.markOos     = bool_(b.markOos);
    if (b.comments    !== undefined) updates.comments    = b.comments;
    if (b.onHold      !== undefined) updates.onHold      = bool_(b.onHold);
    if (b.verkstjori  !== undefined) updates.verkstjori  = b.verkstjori;
    if (b.materials   !== undefined) updates.materials   = b.materials;
    if (b.approved    !== undefined) updates.approved    = bool_(b.approved);
    if (b.category    !== undefined) updates.category    = b.category;
    if (b.boatId      !== undefined) updates.boatId      = b.boatId;
    if (b.boatName    !== undefined) updates.boatName    = b.boatName;
    if (b.part        !== undefined) updates.part        = b.part;
    if (b.description !== undefined) updates.description = b.description;
    if (b.photoUrl    !== undefined) updates.photoUrl    = b.photoUrl;
    if (Object.keys(updates).length) {
      updates.updatedAt = now_();
      updateRow_('maintenance', 'id', b.id, updates);
      cDel_('maintenance');
      return okJ({ id: b.id, updated: true });
    }
    return okJ({ id: b.id, noChanges: true });
  }

  const ts = now_(), id = uid_();
  const photoUrl = b.photoUrl || '';
  const isSauma = bool_(b.saumaklubbur) || false;
  const isStaffSource = (b.source || 'staff') === 'staff';
  insertRow_('maintenance', {
    id, category: b.category || 'boat', boatId: b.boatId || '', boatName: b.boatName || '',
    itemName: b.itemName || '', part: b.part || '', severity: b.severity || 'medium',
    description: b.description || '', photoUrl,
    markOos: bool_(b.markOos) || false, reportedBy: b.reportedBy || '',
    source: b.source || 'staff', createdAt: ts,
    resolved: false, resolvedBy: '', resolvedAt: '', comments: '[]',
    saumaklubbur: isSauma, verkstjori: b.verkstjori || '',
    materials: b.materials || '[]',
    approved: isSauma && !isStaffSource ? false : true,
    followers: '[]', updatedAt: ts,
  });
  cDel_('maintenance');
  return okJ({ id, created: true });
}

function resolveMaintenance_(b) {
  if (!b.id) return failJ('id required');
  ensureMaintCols_();
  updateRow_('maintenance', 'id', b.id, { resolved: true, resolvedBy: b.resolvedBy || '', resolvedAt: now_(), updatedAt: now_() });
  cDel_('maintenance');
  return okJ({ resolved: true });
}

function deleteMaintenance_(b) {
  if (!b.id) return failJ('id required');
  const deleted = deleteRow_('maintenance', 'id', b.id);
  cDel_('maintenance');
  return okJ({ deleted: deleted });
}

function ensureMaintCols_() {
  ['saumaklubbur','verkstjori','materials','approved','onHold','followers','updatedAt'].forEach(c => addColIfMissing_('maintenance', c));
}

function addMaintenanceComment_(b) {
  if (!b.id) return failJ('id required');
  if (!b.text) return failJ('text required');
  ensureMaintCols_();
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  let comments = [];
  try { comments = JSON.parse(ex.comments || '[]'); } catch (e) { comments = []; }
  const entry = { by: b.by || '', at: now_(), text: b.text };
  if (b.photoUrl) entry.photoUrl = b.photoUrl;
  comments.push(entry);
  updateRow_('maintenance', 'id', b.id, { comments: JSON.stringify(comments), updatedAt: now_() });
  cDel_('maintenance');
  return okJ({ commented: true });
}

function toggleMaterial_(b) {
  if (!b.id) return failJ('id required');
  if (b.index === undefined) return failJ('index required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  let materials = [];
  try { materials = JSON.parse(ex.materials || '[]'); } catch(e) { materials = []; }
  const idx = parseInt(b.index);
  if (idx < 0 || idx >= materials.length) return failJ('Invalid index');
  materials[idx].purchased = !materials[idx].purchased;
  ensureMaintCols_();
  updateRow_('maintenance', 'id', b.id, { materials: JSON.stringify(materials), updatedAt: now_() });
  cDel_('maintenance');
  return okJ({ toggled: true, materials });
}

function addMaterial_(b) {
  if (!b.id) return failJ('id required');
  if (!b.name) return failJ('name required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  let materials = [];
  try { materials = JSON.parse(ex.materials || '[]'); } catch(e) { materials = []; }
  materials.push({ name: b.name, purchased: false });
  ensureMaintCols_();
  updateRow_('maintenance', 'id', b.id, { materials: JSON.stringify(materials), updatedAt: now_() });
  cDel_('maintenance');
  return okJ({ added: true, materials });
}

function removeMaterial_(b) {
  if (!b.id) return failJ('id required');
  if (b.index === undefined) return failJ('index required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  let materials = [];
  try { materials = JSON.parse(ex.materials || '[]'); } catch(e) { materials = []; }
  const idx = parseInt(b.index);
  if (idx < 0 || idx >= materials.length) return failJ('Invalid index');
  materials.splice(idx, 1);
  ensureMaintCols_();
  updateRow_('maintenance', 'id', b.id, { materials: JSON.stringify(materials), updatedAt: now_() });
  cDel_('maintenance');
  return okJ({ removed: true, materials });
}

function approveSaumaklubbur_(b) {
  if (!b.id) return failJ('id required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  if (!bool_(ex.saumaklubbur)) return failJ('Not a saumaklúbbur project');
  ensureMaintCols_();
  updateRow_('maintenance', 'id', b.id, { approved: true, updatedAt: now_() });
  cDel_('maintenance');
  return okJ({ approved: true });
}

function adoptSaumaklubbur_(b) {
  if (!b.id) return failJ('id required');
  if (!b.name) return failJ('name required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  if (!bool_(ex.saumaklubbur)) return failJ('Not a saumaklúbbur project');
  if (ex.verkstjori) return failJ('Already has a verkstjóri');
  ensureMaintCols_();
  updateRow_('maintenance', 'id', b.id, { verkstjori: b.name, updatedAt: now_() });
  cDel_('maintenance');
  return okJ({ adopted: true, verkstjori: b.name });
}

function holdSaumaklubbur_(b) {
  if (!b.id) return failJ('id required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  if (!bool_(ex.saumaklubbur)) return failJ('Not a saumaklúbbur project');
  const onHold = b.onHold !== false && b.onHold !== 'false';
  ensureMaintCols_();
  updateRow_('maintenance', 'id', b.id, { onHold: onHold, updatedAt: now_() });
  cDel_('maintenance');
  return okJ({ onHold: onHold });
}

// Staff-only: flip an existing request between maintenance and saumaklúbbur.
// Sauma-only fields (verkstjori, materials) are preserved across the flip so
// reassigning a project back doesn't lose accumulated work.
function reassignMaintenance_(b) {
  if (!b.id) return failJ('id required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  ensureMaintCols_();
  const toSauma = bool_(b.toSauma);
  const updates = { saumaklubbur: toSauma, updatedAt: now_() };
  if (toSauma) {
    // Maintenance → saumaklúbbur. Staff is initiating, so the project is
    // pre-approved; clear OOS since sauma projects don't take boats out.
    updates.approved = true;
    updates.onHold   = false;
    updates.markOos  = false;
  } else {
    // Saumaklúbbur → maintenance. Reset the sauma state-machine flags;
    // verkstjori and materials are intentionally preserved on the row.
    updates.approved = false;
    updates.onHold   = false;
  }
  updateRow_('maintenance', 'id', b.id, updates);
  cDel_('maintenance');
  return okJ({ reassigned: true, toSauma: toSauma });
}

function followProject_(b) {
  if (!b.id) return failJ('id required');
  if (!b.kennitala) return failJ('kennitala required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  if (!bool_(ex.saumaklubbur)) return failJ('Not a saumaklúbbur project');
  ensureMaintCols_();
  var followers = [];
  try { followers = JSON.parse(ex.followers || '[]'); } catch(e) { followers = []; }
  var kt = String(b.kennitala);
  if (followers.some(function(f) { return String(f.kt) === kt; })) return okJ({ already: true });
  followers.push({ kt: kt, at: now_() });
  updateRow_('maintenance', 'id', b.id, { followers: JSON.stringify(followers) });
  cDel_('maintenance');
  return okJ({ followed: true });
}

function unfollowProject_(b) {
  if (!b.id) return failJ('id required');
  if (!b.kennitala) return failJ('kennitala required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  ensureMaintCols_();
  var followers = [];
  try { followers = JSON.parse(ex.followers || '[]'); } catch(e) { followers = []; }
  var kt = String(b.kennitala);
  followers = followers.filter(function(f) { return String(f.kt) !== kt; });
  updateRow_('maintenance', 'id', b.id, { followers: JSON.stringify(followers) });
  cDel_('maintenance');
  return okJ({ unfollowed: true });
}

function markProjectSeen_(b) {
  if (!b.id) return failJ('id required');
  if (!b.kennitala) return failJ('kennitala required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  ensureMaintCols_();
  var followers = [];
  try { followers = JSON.parse(ex.followers || '[]'); } catch(e) { followers = []; }
  var kt = String(b.kennitala);
  var changed = false;
  followers.forEach(function(f) {
    if (String(f.kt) === kt) { f.at = now_(); changed = true; }
  });
  if (!changed) return okJ({ notFollowing: true });
  updateRow_('maintenance', 'id', b.id, { followers: JSON.stringify(followers) });
  cDel_('maintenance');
  return okJ({ seen: true });
}

// Script Property required: DRIVE_FOLDER_ID_MAINT_PHOTOS
function uploadMaintenancePhoto_(b) {
  if (!b.fileData) return failJ('fileData required');
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('DRIVE_FOLDER_ID_MAINT_PHOTOS');
  if (!folderId) return okJ({ ok: false, error: 'Drive folder not configured' });

  try {
    const ext      = (b.fileName || 'photo.jpg').split('.').pop().toLowerCase();
    const ts       = now_().replace(/[: ]/g, '-');
    const safeName = 'maint_' + ts + '_' + (b.fileName || 'photo.' + ext);
    const base64   = b.fileData.replace(/^data:[^;]+;base64,/, '');
    const bytes    = Utilities.base64Decode(base64);
    const mimeMap  = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', heic:'image/heic' };
    const mime     = b.mimeType || mimeMap[ext] || 'image/jpeg';
    const blob     = Utilities.newBlob(bytes, mime, safeName);
    const folder   = DriveApp.getFolderById(folderId);
    const file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return okJ({ ok: true, photoUrl: file.getUrl() });
  } catch (e) {
    return failJ('Photo upload error: ' + e.message);
  }
}
