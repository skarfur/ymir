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
