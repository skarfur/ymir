// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG  —  getConfig bundles everything; boats + locations stored as JSON rows
// ═══════════════════════════════════════════════════════════════════════════════

function getConfig_() {
  const c = cGet_('config'); if (c) return okJ(c);
  // Read the config sheet ONCE and look up all keys from the in-memory map
  const cfgMap = getConfigMap_();
  let activityTypes = [], dailyChecklist = { opening: [], closing: [] };
  try {
    activityTypes = JSON.parse(getConfigValue_('activity_types', cfgMap) || '[]');
  } catch (e) { }
  try {
    const dcRaw = JSON.parse(getConfigValue_('dailyChecklist', cfgMap) || '{}');
    dailyChecklist.opening = (dcRaw.opening || []).filter(r => bool_(r.active));
    dailyChecklist.closing = (dcRaw.closing || []).filter(r => bool_(r.active));
  } catch (e) { }
  const overdueAlerts = getAlertConfigFromMap_(cfgMap);
  const flagConfig = getFlagConfigFromMap_(cfgMap);
  let staffStatus = null;
  try { staffStatus = JSON.parse(getConfigValue_('staffStatus', cfgMap) || 'null'); } catch (e) {}
  // Staff-set flag override — auto-clears when past `expiresAt` (set to next UTC
  // midnight by the staff page). Cleared by writing an empty value back so the
  // next getConfig build is clean, then bypassed for this response.
  let flagOverride = null;
  try {
    const fovRaw = getConfigValue_('flagOverride', cfgMap);
    if (fovRaw) {
      const ov = JSON.parse(fovRaw);
      if (ov && ov.active) {
        const exp = ov.expiresAt ? new Date(ov.expiresAt).getTime() : 0;
        if (exp && exp <= Date.now()) {
          setConfigSheetValue_('flagOverride', '');
        } else {
          flagOverride = ov;
        }
      }
    }
  } catch (e) {}
  const certDefs = getCertDefsFromMap_(cfgMap);
  const certCategories = getCertCategoriesFromMap_(cfgMap);
  let boats = [], locations = [];
  try { var bRaw = getConfigValue_('boats', cfgMap); if (bRaw) boats = JSON.parse(bRaw); } catch (e) { }
  var boatsMigrated = false;
  boats.forEach(function(bt) {
    if (!bt.accessMode) { bt.accessMode = 'free'; boatsMigrated = true; }
  });
  if (boatsMigrated) { try { setConfigSheetValue_('boats', JSON.stringify(boats)); } catch(e) {} }
  try { var lRaw = getConfigValue_('locations', cfgMap); if (lRaw) locations = JSON.parse(lRaw); } catch (e) { }
  let launchChecklists = {};
  try { var lRaw = getConfigValue_('launchChecklists', cfgMap); if (lRaw) launchChecklists = JSON.parse(lRaw); } catch (e) { }
  let boatCategories = [];
  try { var bcRaw = getConfigValue_('boatCategories', cfgMap); if (bcRaw) boatCategories = JSON.parse(bcRaw); } catch (e) { }
  const allowBreaks = getConfigValue_('allowBreaks', cfgMap) === 'true';
  const charterCalendars = {
    rowingCalendarId: getConfigValue_('rowingCalendarId', cfgMap) || '',
    rowingCalendarSyncActive: getConfigValue_('rowingCalendarSyncActive', cfgMap) === 'true',
    keelboatCalendarId: getConfigValue_('keelboatCalendarId', cfgMap) || '',
    keelboatCalendarSyncActive: getConfigValue_('keelboatCalendarSyncActive', cfgMap) === 'true',
  };
  let rowingPassport = null;
  try {
    const rpRaw = getConfigValue_('rowingPassport', cfgMap);
    if (rpRaw) rowingPassport = JSON.parse(rpRaw);
  } catch (e) {}
  var volunteerEvents = [];
  try { volunteerEvents = JSON.parse(getConfigValue_('volunteer_events', cfgMap) || '[]'); } catch (e) {}
  var clubCalendars = [];
  try {
    var ccRaw = getConfigValue_('clubCalendars', cfgMap);
    if (ccRaw) clubCalendars = JSON.parse(ccRaw);
  } catch (e) {}
  var config = { activityTypes, dailyChecklist, overdueAlerts, flagConfig, flagOverride, certDefs, certCategories, boats, locations, launchChecklists, boatCategories, staffStatus, allowBreaks, charterCalendars, rowingPassport, volunteerEvents, clubCalendars };
  cPut_('config', config);
  return okJ(config);
}

function saveConfig_(b) {
  let saved = {};

  if (b.overdueAlerts !== undefined) {
    const cur = getAlertConfig_();
    const oa = b.overdueAlerts;
    const updated = {
      enabled: oa.enabled !== undefined ? !!oa.enabled : cur.enabled,
      firstAlertMins: oa.firstAlertMins !== undefined ? Number(oa.firstAlertMins) : cur.firstAlertMins,
      repeatMins: oa.repeatMins !== undefined ? Number(oa.repeatMins) : cur.repeatMins,
      snoozeMins: oa.snoozeMins !== undefined ? Number(oa.snoozeMins) : cur.snoozeMins,
      channels: {
        web: oa.channels?.web !== undefined ? !!oa.channels.web : cur.channels.web,
        email: oa.channels?.email !== undefined ? !!oa.channels.email : cur.channels.email,
        sms: oa.channels?.sms !== undefined ? !!oa.channels.sms : cur.channels.sms,
      },
      staffEmailList: Array.isArray(oa.staffEmailList) ? oa.staffEmailList.filter(e => String(e).includes('@')) : cur.staffEmailList,
      staffSmsList: Array.isArray(oa.staffSmsList) ? oa.staffSmsList : cur.staffSmsList,
    };
    setConfigSheetValue_('overdueAlerts', JSON.stringify(updated));
    saved.overdueAlerts = true;
  }

  if (b.flagConfig !== undefined) {
    // Accept full SCORE_CONFIG shape (points-based) — no validation on the backend,
    // client already validates before saving.
    setConfigSheetValue_('flagConfig', JSON.stringify(b.flagConfig));
    saved.flagConfig = true;
  }
  if (b.staffStatus !== undefined) {
    setConfigSheetValue_('staffStatus', JSON.stringify(b.staffStatus));
    saved.staffStatus = true;
  }
  if (b.flagOverride !== undefined) {
    // Null or { active:false } clears the override; otherwise persist the
    // full { active, flagKey, notes, notesIS, setAt, setByName, expiresAt } shape.
    if (!b.flagOverride || b.flagOverride.active === false) {
      setConfigSheetValue_('flagOverride', '');
    } else {
      setConfigSheetValue_('flagOverride', JSON.stringify(b.flagOverride));
    }
    saved.flagOverride = true;
  }

  if (b.boats !== undefined) {
    setConfigSheetValue_('boats', JSON.stringify(b.boats));
    saved.boats = true;
  }

  if (b.locations !== undefined) {
    setConfigSheetValue_('locations', JSON.stringify(b.locations));
    saved.locations = true;
  }
  if (b.launchChecklists)  { setConfigSheetValue_('launchChecklists',  JSON.stringify(b.launchChecklists));  }
  if (b.boatCategories)    { setConfigSheetValue_('boatCategories',    JSON.stringify(b.boatCategories));    }

  if (b.rowingPassport !== undefined) {
    setConfigSheetValue_('rowingPassport', JSON.stringify(b.rowingPassport));
    saved.rowingPassport = true;
  }
  if (b.activityTypes) { setConfigSheetValue_('activity_types', JSON.stringify(b.activityTypes)); saved.activityTypes = true; }
  if (b.allowBreaks !== undefined) { setConfigSheetValue_('allowBreaks', b.allowBreaks ? 'true' : 'false'); saved.allowBreaks = true; }
  cDel_('config');
  return okJ({ saved });
}

// Staff-accessible override save. saveConfig_ is admin-only, but the flag
// override is designed for on-duty staff — persist just that field here so
// the staff page can actually save (otherwise optimistic UI hides a 403 and
// the override vanishes on the next config refresh).
function saveFlagOverride_(b) {
  if (!b.flagOverride || b.flagOverride.active === false) {
    setConfigSheetValue_('flagOverride', '');
  } else {
    setConfigSheetValue_('flagOverride', JSON.stringify(b.flagOverride));
  }
  cDel_('config');
  return okJ({ saved: { flagOverride: true } });
}

// Same rationale as saveFlagOverride_: the on-duty / support-boat toggle is
// a staff control, so it needs its own staff-gated endpoint.
function saveStaffStatus_(b) {
  if (b.staffStatus !== undefined) {
    setConfigSheetValue_('staffStatus', JSON.stringify(b.staffStatus));
  }
  cDel_('config');
  return okJ({ saved: { staffStatus: true } });
}

function getFlagConfig_() {
  const raw = getConfigSheetValue_('flagConfig');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function saveActivityType_(b) {
  try {
    // Parse JSON-string payloads defensively (frontend may send arrays or strings).
    let subtypes = [];
    try { subtypes = b.subtypes ? (Array.isArray(b.subtypes) ? b.subtypes : JSON.parse(b.subtypes)) : []; } catch(e) { subtypes = []; }
    let roles = [];
    try { roles = b.roles ? (Array.isArray(b.roles) ? b.roles : JSON.parse(b.roles)) : []; } catch(e) { roles = []; }
    const isVol = b.volunteer === true || b.volunteer === 'true';
    const res = saveConfigListItem_('activity_types', {
      id: b.id || '',
      name: b.name,
      nameIS: b.nameIS || '',
      active: b.active !== false,
      calendarId: b.calendarId || '',
      calendarSyncActive: b.calendarSyncActive === true || b.calendarSyncActive === 'true',
      volunteer: isVol,
      roles: isVol ? roles : [],
      subtypes,
    });
    // Drop any legacy top-level schedule left on existing rows. Bulk schedules
    // now live per-subtype (migrated in-line during merge).
    if (res.item && res.item.bulkSchedule !== undefined) {
      const arr = readConfigList_('activity_types');
      const idx = arr.findIndex(a => a && a.id === res.id);
      if (idx >= 0) { delete arr[idx].bulkSchedule; setConfigSheetValue_('activity_types', JSON.stringify(arr)); cDel_('config'); }
    }
    // Volunteer event materialization runs in the background via syncVolunteerEvents_
    // when the admin Volunteer tab renders, to avoid execution timeouts here.
    return okJ({ id: res.id, item: res.item });
  } catch(e) { return failJ('saveActivityType failed: ' + e.message); }
}

function deleteActivityType_(id) {
  try {
    let arr = JSON.parse(getConfigSheetValue_('activity_types') || '[]');
    arr = arr.filter(a => a.id !== id);
    setConfigSheetValue_('activity_types', JSON.stringify(arr));
    // Cascade: remove volunteer events linked to this activity type and any
    // signups attached to them. Materialized events (sourceActivityTypeId ===
    // id) are always removed. Manually-created events that also reference this
    // type via activityTypeId are removed too, since from the admin's point of
    // view they belonged to the type being deleted.
    var removedEvents = 0;
    var removedSignups = 0;
    try {
      var events = JSON.parse(getConfigSheetValue_('volunteer_events') || '[]');
      var toRemove = events.filter(function(e) {
        if (!e) return false;
        return (e.sourceActivityTypeId && String(e.sourceActivityTypeId) === String(id))
            || (e.activityTypeId       && String(e.activityTypeId)       === String(id));
      });
      if (toRemove.length) {
        var removedIds = {};
        toRemove.forEach(function(e) { if (e.id) removedIds[e.id] = true; });
        var kept = events.filter(function(e) { return !(e && e.id && removedIds[e.id]); });
        setConfigSheetValue_('volunteer_events', JSON.stringify(kept));
        removedEvents = toRemove.length;
        // Cascade signups for each removed event (mirrors deleteVolunteerEvent_).
        try {
          ensureVolunteerSignupsTab_();
          var signups = readAll_('volunteerSignups') || [];
          signups.forEach(function(s) {
            if (s && s.eventId && removedIds[s.eventId]) {
              try { deleteRow_('volunteerSignups', 'id', s.id); removedSignups++; } catch(e) {}
            }
          });
        } catch(e) { /* signups tab may not exist yet */ }
      }
    } catch(e) { /* volunteer_events may not exist yet */ }
    cDel_('config');
    return okJ({ deleted: true, removedEvents: removedEvents, removedSignups: removedSignups });
  } catch(e) { return failJ('deleteActivityType failed: ' + e.message); }
}

function saveChecklistItem_(b) {
  const ts = now_();
  const dc = JSON.parse(getConfigValue_('dailyChecklist', getConfigMap_()) || '{"opening":[],"closing":[]}');
  const phase = String(b.phase || 'opening').toLowerCase();
  if (!dc[phase]) dc[phase] = [];

  if (b.id) {
    // Update existing item (search both phases in case phase changed)
    let found = false;
    ['opening','closing'].forEach(function(p) {
      const idx = (dc[p] || []).findIndex(function(x) { return x.id === b.id; });
      if (idx >= 0) {
        dc[p].splice(idx, 1); // remove from old phase
        found = true;
      }
    });
    if (!found) return failJ('Item not found', 404);
    dc[phase].push({
      id: b.id, phase: phase,
      textEN: b.textEN !== undefined ? b.textEN : '', textIS: b.textIS !== undefined ? b.textIS : '',
      active: b.active !== undefined ? b.active : true,
      sortOrder: b.sortOrder || 99,
    });
    setConfigSheetValue_('dailyChecklist', JSON.stringify(dc));
    cDel_('config'); return okJ({ id: b.id, updated: true });
  } else {
    const id = uid_();
    dc[phase].push({
      id: id, phase: phase,
      textEN: b.textEN || '', textIS: b.textIS || '',
      active: true, sortOrder: b.sortOrder || 99, createdAt: ts,
    });
    setConfigSheetValue_('dailyChecklist', JSON.stringify(dc));
    cDel_('config'); return okJ({ id: id, created: true });
  }
}

function deleteChecklistItem_(id) {
  if (!id) return failJ('id required');
  const dc = JSON.parse(getConfigValue_('dailyChecklist', getConfigMap_()) || '{"opening":[],"closing":[]}');
  ['opening','closing'].forEach(function(p) {
    var idx = (dc[p] || []).findIndex(function(x) { return x.id === id; });
    if (idx >= 0) dc[p][idx].active = false;
  });
  setConfigSheetValue_('dailyChecklist', JSON.stringify(dc));
  cDel_('config'); return okJ({ deleted: true });
}

function saveAlertConfig_(b) {
  if (!b._serverSide && (!b || b.token !== API_TOKEN_)) throw new Error('Unauthorized');
  const cur = getAlertConfig_();
  const updated = {
    enabled: b.enabled !== undefined ? !!b.enabled : cur.enabled,
    firstAlertMins: b.firstAlertMins !== undefined ? Number(b.firstAlertMins) : cur.firstAlertMins,
    repeatMins: b.repeatMins !== undefined ? Number(b.repeatMins) : cur.repeatMins,
    snoozeMins: b.snoozeMins !== undefined ? Number(b.snoozeMins) : cur.snoozeMins,
    channels: {
      web: b.channels?.web !== undefined ? !!b.channels.web : cur.channels.web,
      email: b.channels?.email !== undefined ? !!b.channels.email : cur.channels.email,
      sms: b.channels?.sms !== undefined ? !!b.channels.sms : cur.channels.sms,
    },
    staffEmailList: Array.isArray(b.staffEmailList) ? b.staffEmailList.filter(e => e.includes('@')) : cur.staffEmailList,
    staffSmsList: Array.isArray(b.staffSmsList) ? b.staffSmsList : cur.staffSmsList,
  };
  setConfigSheetValue_('overdueAlerts', JSON.stringify(updated));
  cDel_('config');
  return okJ({ success: true, config: updated });
}


// ═══════════════════════════════════════════════════════════════════════════════
// CERTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getCertDefs_() {
  const raw = getConfigSheetValue_('certDefs');
  if (!raw) return [];
  try { return normalizeCertDefsRaw_(JSON.parse(raw)); } catch (e) { return []; }
}

// ── Unified boat access-gate helpers ──────────────────────────────────────────
// Mirrors normalizeAccessGate / memberHasGate in shared/boats.js. Keep the two
// in sync: any semantic change here (shape, rank handling, expiry) must also
// land in shared/boats.js so frontend and backend never disagree.
function normalizeAccessGate_(boat, certDefs) {
  if (!boat) return null;
  var defs = Array.isArray(certDefs) ? certDefs : [];
  if (boat.accessGate && typeof boat.accessGate === 'object' && boat.accessGate.certId) {
    var minRank = Number(boat.accessGate.minRank || 0) || 0;
    return {
      certId:  String(boat.accessGate.certId),
      sub:     boat.accessGate.sub ? String(boat.accessGate.sub) : '',
      minRank: minRank > 0 ? minRank : 0,
    };
  }
  var raw = boat.accessGateCert;
  if (!raw || typeof raw !== 'string') return null;
  if (defs.length) {
    for (var i = 0; i < defs.length; i++) {
      var def = defs[i];
      if (def && Array.isArray(def.subcats)) {
        for (var j = 0; j < def.subcats.length; j++) {
          if (def.subcats[j] && def.subcats[j].key === raw) {
            return { certId: def.id, sub: raw, minRank: 0 };
          }
        }
      }
    }
    for (var k = 0; k < defs.length; k++) {
      if (defs[k] && defs[k].id === raw) return { certId: raw, sub: '', minRank: 0 };
    }
  }
  return { certId: '', sub: raw, minRank: 0 };
}

function gateSubcatRank_(certDefs, certId, subKey) {
  if (!Array.isArray(certDefs) || !certDefs.length || !certId || !subKey) return 0;
  var def = null;
  for (var i = 0; i < certDefs.length; i++) { if (certDefs[i] && certDefs[i].id === certId) { def = certDefs[i]; break; } }
  if (!def || !Array.isArray(def.subcats)) return 0;
  for (var j = 0; j < def.subcats.length; j++) {
    var sc = def.subcats[j];
    if (sc && sc.key === subKey) return Number(sc.rank || 0) || 0;
  }
  return 0;
}

function memberHasGate_(certs, gate, certDefs) {
  if (!gate || (!gate.certId && !gate.sub)) return true;
  if (!Array.isArray(certs)) return false;
  var today = new Date().toISOString().slice(0, 10);
  return certs.some(function(c) {
    if (!c) return false;
    if (c.expiresAt && c.expiresAt < today) return false;
    if (!gate.certId) return gate.sub && c.sub === gate.sub;
    if (c.certId !== gate.certId) return false;
    if (gate.minRank > 0) {
      return gateSubcatRank_(certDefs, gate.certId, c.sub) >= gate.minRank;
    }
    if (gate.sub) return c.sub === gate.sub;
    return true;
  });
}

function parseMemberCerts_(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { var p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}

// Pad legacy cert-def entries with the new bilingual fields so server-side
// consumers (public record page, captain report, getConfig) always see the
// extended shape. Mirrors new fields onto legacy fields too.
function normalizeCertDefsRaw_(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(function (d) {
    if (!d) return d;
    var nameEN        = d.nameEN        || d.name        || '';
    var nameIS        = d.nameIS        || '';
    var descriptionEN = d.descriptionEN || d.description || '';
    var descriptionIS = d.descriptionIS || '';
    var subcats = Array.isArray(d.subcats) ? d.subcats.map(function (sc) {
      var labelEN  = sc.labelEN       || sc.label       || '';
      var labelIS  = sc.labelIS       || '';
      var scDescEN = sc.descriptionEN || sc.description || '';
      var scDescIS = sc.descriptionIS || '';
      var out = Object.assign({}, sc, {
        labelEN: labelEN, labelIS: labelIS, label: labelEN,
        descriptionEN: scDescEN, descriptionIS: scDescIS, description: scDescEN,
      });
      return out;
    }) : [];
    return Object.assign({}, d, {
      nameEN: nameEN, nameIS: nameIS, name: nameEN,
      descriptionEN: descriptionEN, descriptionIS: descriptionIS, description: descriptionEN,
      subcats: subcats,
    });
  });
}

// Coerce a legacy string-array of cert categories into the new object form.
function normalizeCertCategoriesRaw_(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(function (c) {
    if (c == null) return { key: '', labelEN: '', labelIS: '' };
    if (typeof c === 'string') {
      var s = String(c).trim();
      return { key: s, labelEN: s, labelIS: '' };
    }
    var labelEN = String(c.labelEN || c.label || c.key || '').trim();
    var key     = String(c.key || labelEN).trim();
    return { key: key, labelEN: labelEN, labelIS: String(c.labelIS || '').trim() };
  }).filter(function (c) { return c.key; });
}

function saveCertDef_(b) {
  // Accept new bilingual fields, fall back to legacy single-field inputs.
  var nameEN = String(b.nameEN || b.name || '').trim();
  if (!nameEN) return failJ('name required');
  var nameIS        = String(b.nameIS || '').trim();
  var descriptionEN = String(b.descriptionEN || b.description || '').trim();
  var descriptionIS = String(b.descriptionIS || '').trim();
  const defs = getCertDefs_();
  const payload = {
    id: b.id || ('cert_' + uid_()),
    // New bilingual fields:
    nameEN: nameEN,
    nameIS: nameIS,
    descriptionEN: descriptionEN,
    descriptionIS: descriptionIS,
    // Legacy mirrors — keep any half-upgraded caller happy:
    name: nameEN,
    description: descriptionEN,
    category: String(b.category || '').trim(),
    issuingAuthority: String(b.issuingAuthority || '').trim(),
    color: String(b.color || '').trim(),
    expires: !!b.expires,
    hasIdNumber: !!b.hasIdNumber,
    clubEndorsement: !!b.clubEndorsement,
    subcats: Array.isArray(b.subcats) ? b.subcats.map(function (s) {
      var labelEN  = String(s.labelEN || s.label || '').trim();
      var labelIS  = String(s.labelIS || '').trim();
      var scDescEN = String(s.descriptionEN || s.description || '').trim();
      var scDescIS = String(s.descriptionIS || '').trim();
      return {
        key: String(s.key || labelEN || '').toLowerCase().replace(/\s+/g, '_'),
        // New:
        labelEN: labelEN,
        labelIS: labelIS,
        descriptionEN: scDescEN,
        descriptionIS: scDescIS,
        // Legacy mirrors:
        label: labelEN,
        description: scDescEN,
        rank: s.rank != null ? Number(s.rank) : null,
        issuingAuthority: String(s.issuingAuthority || '').trim(),
      };
    }).filter(function (s) { return s.labelEN; }) : [],
  };
  const idx = defs.findIndex(d => d.id === payload.id);
  if (idx >= 0) defs[idx] = payload; else defs.push(payload);
  setConfigSheetValue_('certDefs', JSON.stringify(defs));
  cDel_('config');
  return okJ({ id: payload.id, saved: true });
}

function deleteCertDef_(id) {
  if (!id) return failJ('id required');
  const res = deleteConfigListItem_('certDefs', id);
  if (!res.deleted) return failJ('Cert def not found', 404);
  return okJ(res);
}

function saveMemberCert_(b) {
  if (!b.memberId) return failJ('memberId required');
  if (!Array.isArray(b.certifications)) return failJ('certifications array required');
  const defs = getCertDefs_();
  // Normalize each credential entry to include new fields
  const normalized = b.certifications.map(c => ({
    certId:           c.certId || null,
    sub:              c.sub || null,
    category:         c.category || '',
    title:            c.title || '',
    idNumber:         c.idNumber || c.licenceNumber || '',
    issuingAuthority: c.issuingAuthority || '',
    issueDate:        c.issueDate || '',
    expires:          !!c.expires,
    expiresAt:        c.expiresAt || c.expiryDate || '',
    description:      c.description || '',
    assignedBy:       c.assignedBy || '',
    assignedAt:       c.assignedAt || '',
    verifiedBy:       c.verifiedBy || c.assignedBy || '',
    verifiedAt:       c.verifiedAt || c.assignedAt || '',
    licenceNumber:    c.licenceNumber || c.idNumber || '',
  }));
  const byDef = {};
  normalized.forEach(c => {
    const key = c.certId || ('_custom_' + (c.title || ''));
    if (!byDef[key]) byDef[key] = [];
    byDef[key].push(c);
  });
  const cleaned = [];
  Object.entries(byDef).forEach(([key, entries]) => {
    if (key.startsWith('_custom_')) { cleaned.push(...entries); return; }
    const def = defs.find(d => d.id === key);
    const hasRanks = def?.subcats?.some(s => s.rank != null);
    if (!hasRanks) { cleaned.push(...entries); return; }
    let best = null, bestRank = -1;
    entries.forEach(c => {
      const sub = def.subcats.find(s => s.key === c.sub);
      const rank = sub?.rank ?? 0;
      if (rank > bestRank) { best = c; bestRank = rank; }
    });
    if (best) cleaned.push(best);
  });
  const written = updateRow_('members', 'id', b.memberId, { certifications: JSON.stringify(cleaned), updatedAt: now_() });
  if (!written) return failJ('Member not found', 404);
  cDel_('members');
  return okJ({ saved: true, count: cleaned.length });
}

function saveCertCategories_(b) {
  if (!Array.isArray(b.categories)) return failJ('categories array required');
  // Accept either legacy Array<string> or new Array<{key,labelEN,labelIS}>.
  // Normalize to object form with stable key (no slugification — see stable-key
  // rule in shared/certs.js: key stays equal to labelEN to preserve legacy
  // member-cert category references).
  var seen = {};
  var categories = b.categories.map(function (c) {
    if (c == null) return null;
    if (typeof c === 'string') {
      var s = String(c).trim();
      return s ? { key: s, labelEN: s, labelIS: '' } : null;
    }
    var labelEN = String(c.labelEN || c.label || c.key || '').trim();
    var key     = String(c.key || labelEN).trim();
    if (!key) return null;
    return { key: key, labelEN: labelEN || key, labelIS: String(c.labelIS || '').trim() };
  }).filter(function (c) {
    if (!c || !c.key) return false;
    if (seen[c.key]) return false;
    seen[c.key] = true;
    return true;
  });
  setConfigSheetValue_('certCategories', JSON.stringify(categories));
  cDel_('config');
  return okJ({ saved: true, count: categories.length });
}


