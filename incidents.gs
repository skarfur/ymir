// ═══════════════════════════════════════════════════════════════════════════════
// INCIDENTS
// ═══════════════════════════════════════════════════════════════════════════════

function getIncidents_(b) {
  b = b || {};
  const c = cGet_('incidents');
  const all = c || readAll_('incidents');
  if (!c) cPut_('incidents', all);
  if (b.date) {
    // Filter by the actual event date (i.date), not the filing timestamp.
    // Slice both sides to 10 chars so a Date-object cell that round-tripped
    // through sanitizeCell_ (yyyy-MM-dd) matches cleanly, and also tolerates
    // rows where the cell held extra trailing content. Legacy rows without
    // an event date fall back to filedAt/createdAt.
    const target = String(b.date).slice(0, 10);
    const incidents = all.filter(function(i) {
      var ev = String(i.date || '').slice(0, 10)
            || String(i.filedAt || i.createdAt || '').slice(0, 10);
      return ev === target;
    });
    return okJ({ incidents });
  }
  return okJ({ incidents: all });
}

function createIncident_(b) {
  const ts = now_(), id = uid_();
  // Normalize `types` to a single-level JSON string. The client already sends
  // it as a JSON-encoded array (JSON.stringify(['injury', ...])), so calling
  // JSON.stringify again would double-encode and leave a string — not an
  // array — sitting in the sheet. Parse/re-stringify to keep storage clean.
  let typesJson = '[]';
  if (Array.isArray(b.types)) {
    typesJson = JSON.stringify(b.types);
  } else if (typeof b.types === 'string' && b.types) {
    try {
      const parsed = JSON.parse(b.types);
      typesJson = JSON.stringify(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
      typesJson = '[]';
    }
  }
  insertRow_('incidents', {
    id, types: typesJson, severity: b.severity || 'minor',
    date: b.date || ts.slice(0, 10), time: b.time || ts.slice(11, 16),
    locationId: b.locationId || '', locationName: b.locationName || '',
    boatId: b.boatId || '', boatName: b.boatName || '',
    description: String(b.description == null ? '' : b.description), involved: b.involved || '',
    witnesses: b.witnesses || '', immediateAction: b.immediateAction || '',
    followUp: b.followUp || '', handOffTo: b.handOffTo || '',
    handOffName: b.handOffName || '', handOffNotes: b.handOffNotes || '',
    photoUrls: '', filedBy: b.filedBy || '', filedAt: ts,
    resolved: !!b.resolved, resolvedAt: b.resolved ? ts : '',
    staffNotes: '', reviewerNotes: '',
    status: b.status === 'review' ? 'review' : 'closed',
  });
  cDel_('incidents'); return okJ({ id, created: true });
}

function resolveIncident_(b) {
  if (!b.id) return failJ('id required');
  const patch = { resolved: b.resolved, resolvedAt: b.resolvedAt || '' };
  if (b.status !== undefined) patch.status = b.status;
  updateRow_('incidents', 'id', b.id, patch);
  cDel_('incidents'); return okJ({ updated: true });
}

function addIncidentNote_(b) {
  if (!b.id) return failJ('id required');
  const ex = findOne_('incidents', 'id', b.id);
  const field = b.kind === 'reviewer' ? 'reviewerNotes' : 'staffNotes';
  const notes = ex ? JSON.parse(ex[field] || '[]') : [];
  notes.push({ by: b.by || '', at: now_(), text: b.text || '' });
  const patch = {}; patch[field] = JSON.stringify(notes);
  updateRow_('incidents', 'id', b.id, patch);
  cDel_('incidents'); return okJ({ updated: true });
}


