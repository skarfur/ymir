// ═══════════════════════════════════════════════════════════════════════════════
// CHECKOUTS
// ═══════════════════════════════════════════════════════════════════════════════

function getActiveCheckouts_() {
  // Compare against createdAt's UTC date since createdAt is stored as UTC ISO
  // via now_(); both operands must share the same reference frame.
  const todayUtc = now_().slice(0, 10);
  const all = readAll_('checkouts');
  const result = all.filter(c => c.status === 'out' || (c.status === 'in' && (c.createdAt || '').slice(0, 10) === todayUtc));
  let memberMap = {};
  try { memberMap = getMemberMap_(); } catch (e) { }
  const enriched = result.map(c => {
    const m = memberMap[String(c.memberKennitala || '')] || {};
    return {
      ...c,
      memberPhone: c.memberPhone || m.phone || '',
      memberIsMinor: c.memberIsMinor !== undefined && c.memberIsMinor !== '' ? bool_(c.memberIsMinor) : bool_(m.isMinor),
      guardianName: c.guardianName || m.guardianName || '',
      guardianPhone: c.guardianPhone || m.guardianPhone || '',
    };
  });
  return okJ({ checkouts: enriched });
}

function saveCheckout_(b) {
  ensureCheckoutContactCols_();
  // Access-control check for controlled-access boats
  if (b.boatId) {
    try {
      var cfgMap = getConfigMap_();
      var allBoats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]');
      var checkBoat = allBoats.find(function(x) { return x.id === b.boatId; });
      if (checkBoat && checkBoat.accessMode === 'controlled') {
        var checkKt = String(b.memberKennitala || b.memberKt || b.kennitala || '');
        var checkMember = checkKt ? (getMemberMap_()[checkKt] || null) : null;
        var isStaffRole = checkMember && (checkMember.role === 'staff' || checkMember.role === 'admin');
        if (!isStaffRole) {
          var hasAccess = false;
          // Owner check
          if (checkBoat.ownership === 'private' && String(checkBoat.ownerId || checkBoat.ownerKennitala || '') === checkKt) hasAccess = true;
          // Cert gate check (unified helper — honours expiry, rank, structured + legacy shapes)
          if (!hasAccess && checkMember) {
            var _coDefs = getCertDefsFromMap_(cfgMap);
            var _coGate = normalizeAccessGate_(checkBoat, _coDefs);
            if (_coGate) {
              var memberCerts = parseMemberCerts_(checkMember.certifications);
              if (memberHasGate_(memberCerts, _coGate, _coDefs)) hasAccess = true;
            }
          }
          // Allowlist check
          if (!hasAccess && checkBoat.accessAllowlist && Array.isArray(checkBoat.accessAllowlist) && checkBoat.accessAllowlist.indexOf(checkKt) !== -1) hasAccess = true;
          // Reservation check (date-range)
          if (!hasAccess && checkBoat.reservations && checkBoat.reservations.length) {
            var today = nowLocalDate_();
            hasAccess = checkBoat.reservations.some(function(r) { return String(r.memberKennitala) === checkKt && today >= r.startDate && today <= r.endDate; });
          }
          // Slot-based scheduling check
          if (!hasAccess && checkBoat.slotSchedulingEnabled) {
            var todayStr = nowLocalDate_();
            var nowTime = nowLocalTime_();
            try {
              var slots = readAll_('reservationSlots').filter(function(s) {
                return s.boatId === checkBoat.id && s.date === todayStr && s.startTime <= nowTime && s.endTime > nowTime && s.bookedByKennitala;
              });
              // Check if user booked a slot directly or via crew
              hasAccess = slots.some(function(s) {
                if (String(s.bookedByKennitala) === checkKt) return true;
                if (s.bookedByCrewId) {
                  var crew = findOne_('crews', 'id', s.bookedByCrewId);
                  if (crew) {
                    var pairs = typeof crew.pairs === 'string' ? JSON.parse(crew.pairs) : (crew.pairs || []);
                    return pairs.some(function(p) { return (p.members || []).some(function(m) { return String(m.kennitala) === checkKt; }); });
                  }
                }
                return false;
              });
            } catch (e) { /* don't block on slot check errors */ }
          }
          // If slot scheduling is enabled and boat is NOT available outside slots, enforce strictly
          if (!hasAccess && checkBoat.slotSchedulingEnabled && !checkBoat.availableOutsideSlots) {
            return failJ('Access denied: this boat requires a booked reservation slot');
          }
          if (!hasAccess) return failJ('Access denied: this boat requires authorization');
        }
      }
    } catch (e) { /* proceed — don't block checkout on validation errors */ }
  }
  const ts = now_(), id = uid_();
  const kt = String(b.memberKennitala || b.memberKt || b.kennitala || '');
  let memberPhone = '', memberIsMinor = false, guardianName = '', guardianPhone = '';
  if (kt) {
    try {
      const m = getMemberMap_()[kt] || {};
      memberPhone = m.phone || '';
      memberIsMinor = bool_(m.isMinor);
      guardianName = m.guardianName || '';
      guardianPhone = m.guardianPhone || '';
    } catch (e) {}
  }
  let wxSnap = '';
  if (b.wxSnapshot) {
    try {
      const w = typeof b.wxSnapshot === 'string' ? JSON.parse(b.wxSnapshot) : b.wxSnapshot;
      // ws may be a range string like "5.5-8.0" from Beaufort-only entries — preserve as-is
      var wsVal = (typeof w.ws === 'string' && w.ws.indexOf('-') !== -1) ? w.ws : (w.ws != null ? Math.round(w.ws) : 0);
      wxSnap = JSON.stringify({
        bft: Math.round(w.bft || 0), ws: wsVal, wg: Math.round(w.wg || 0),
        dir: w.dir || w.wDir || '',
        wv: w.wv != null ? parseFloat(w.wv.toFixed ? w.wv.toFixed(1) : w.wv) : (w.waveH != null ? parseFloat(parseFloat(w.waveH).toFixed(1)) : null),
        flag: w.flag || w.flagKey || '',
        tc: w.tc != null ? Math.round(w.tc) : (w.airT != null ? Math.round(w.airT) : null),
        ts: w.ts || nowLocalDateTime_(),
      });
    } catch (e) { wxSnap = ''; }
  }
  insertRow_('checkouts', {
    id, boatId: b.boatId || '', boatName: b.boatName || '', boatCategory: b.boatCategory || '',
    memberKennitala: kt,
    memberName: b.memberName || '', crew: b.crew || 1,
    locationId: b.locationId || '', locationName: b.locationName || '',
    checkedOutAt: b.checkedOutAt || b.timeOut || nowLocalTime_(),
    expectedReturn: b.expectedReturn || b.returnBy || '',
    checkedInAt: '', wxSnapshot: wxSnap,
    preLaunchChecklist: b.preLaunchChecklist || '', notes: b.notes || '',
    status: 'out', createdAt: ts, departurePort: b.departurePort || '',
    crewNames: b.crewNames || '',
    nonClub: b.nonClub || false,
    memberPhone, memberIsMinor, guardianName, guardianPhone,
  });
  cDel_('checkouts'); return okJ({ id, created: true });
}

function saveGroupCheckout_(b) {
  ensureGroupCols_();
  const ts = now_(), id = uid_();
  let wxSnap = '';
  if (b.wxSnapshot) {
    try {
      const w = typeof b.wxSnapshot === 'string' ? JSON.parse(b.wxSnapshot) : b.wxSnapshot;
      var wsVal2 = (typeof w.ws === 'string' && w.ws.indexOf('-') !== -1) ? w.ws : (w.ws != null ? Math.round(w.ws) : 0);
      wxSnap = JSON.stringify({
        bft: Math.round(w.bft||0), ws: wsVal2, wg: Math.round(w.wg||0),
        dir: w.dir||w.wDir||'',
        wv: w.wv != null ? parseFloat(parseFloat(w.wv).toFixed(1)) : null,
        flag: w.flag||'', tc: w.tc != null ? Math.round(w.tc) : null, ts: w.ts||nowLocalDateTime_(),
      });
    } catch(e) { wxSnap = ''; }
  }
  // Normalise arrays (frontend may send as JSON strings)
  const boatIds   = Array.isArray(b.boatIds)   ? b.boatIds   : tryParseArr_(b.boatIds);
  const boatNames = Array.isArray(b.boatNames)  ? b.boatNames : tryParseArr_(b.boatNames);
  const staffNames= Array.isArray(b.staffNames) ? b.staffNames: tryParseArr_(b.staffNames);
  insertRow_('checkouts', {
    id,
    boatId:          boatIds.join(','),
    boatName:        boatNames.join(','),
    boatCategory:    b.boatCategory || '',
    memberKennitala: '',
    memberName:      staffNames.length ? staffNames.join(', ') : 'Group',
    crew:            parseInt(b.crew) || (parseInt(b.participants)||0) + staffNames.length,
    locationId:      b.locationId || '',
    locationName:    b.locationName || '',
    checkedOutAt:    b.checkedOutAt || nowLocalTime_(),
    expectedReturn:  b.expectedReturn || '',
    checkedInAt:     '',
    wxSnapshot:      wxSnap,
    notes:           b.activityTypeName ? 'Activity: ' + b.activityTypeName : '',
    status:          'out',
    createdAt:       ts,
    isGroup:         true,
    participants:    parseInt(b.participants) || 0,
    staffNames:      JSON.stringify(staffNames),
    boatNames:       JSON.stringify(boatNames),
    boatIds:         JSON.stringify(boatIds),
    activityTypeId:  b.activityTypeId || '',
    activityTypeName:b.activityTypeName || '',
  });
  cDel_('checkouts');
  return okJ({ id, created: true });
}

function groupCheckIn_(b) {
  if (!b.id) return failJ('id required');
  const checkedInAt = b.timeIn || nowLocalTime_();
  updateRow_('checkouts', 'id', b.id, { status: 'in', checkedInAt });
  cDel_('checkouts');
  return okJ({ updated: true, checkedInAt });
}

function linkGroupCheckoutToActivity_(b) {
  if (!b.checkoutId || !b.activityId) return failJ('checkoutId and activityId required');
  // Mark the checkout with the linked activity id
  addColIfMissing_('checkouts', 'linkedActivityId');
  updateRow_('checkouts', 'id', b.checkoutId, { linkedActivityId: b.activityId });
  cDel_('checkouts');
  return okJ({ linked: true });
}

function tryParseArr_(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : [String(v)]; } catch(e) { return String(v).split(',').map(x=>x.trim()).filter(Boolean); }
}

function checkIn_(b) {
  if (!b.id) return failJ('id required');
  const checkedInAt = b.timeIn || nowLocalTime_();
  const updates = { status: 'in', checkedInAt };
  if (b.afterSailChecklist) updates.afterSailChecklist = b.afterSailChecklist;
  updateRow_('checkouts', 'id', b.id, updates);
  cDel_('checkouts'); return okJ({ updated: true, checkedInAt });
}

function deleteCheckout_(id) {
  if (!id) return failJ('id required');
  const deleted = deleteRow_('checkouts', 'id', id);
  cDel_('checkouts'); return okJ({ deleted });
}

// ── Boat OOS toggle ──────────────────────────────────────────────────────

function saveBoatOos_(b) {
  if (!b.id) return failJ('id required');
  const cfgMap = getConfigMap_();
  let boats = [];
  try { boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]'); } catch (e) { return failJ('Failed to parse boats'); }
  const idx = boats.findIndex(x => x.id === b.id);
  if (idx < 0) return failJ('Boat not found');
  if (b.oos !== undefined) boats[idx].oos = !!b.oos;
  if (b.oosReason !== undefined) boats[idx].oosReason = String(b.oosReason || '');
  setConfigSheetValue_('boats', JSON.stringify(boats));
  cDel_('config');
  return okJ({ updated: true, boat: boats[idx] });
}

// ── Boat access & reservations ────────────────────────────────────────────

function saveBoatAccess_(b) {
  if (!b.boatId) return failJ('boatId required');
  const cfgMap = getConfigMap_();
  let boats = [];
  try { boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]'); } catch (e) { return failJ('Failed to parse boats'); }
  const idx = boats.findIndex(x => x.id === b.boatId);
  if (idx < 0) return failJ('Boat not found');
  if (b.accessMode !== undefined) boats[idx].accessMode = b.accessMode === 'controlled' ? 'controlled' : 'free';
  // New structured gate wins. Also mirror a legacy accessGateCert string
  // (sub || certId) so older readers keep working until fully migrated.
  if (b.accessGate !== undefined) {
    if (b.accessGate && typeof b.accessGate === 'object' && b.accessGate.certId) {
      var _sg = {
        certId:  String(b.accessGate.certId),
        sub:     b.accessGate.sub     ? String(b.accessGate.sub)     : '',
        minRank: Number(b.accessGate.minRank || 0) || 0,
      };
      boats[idx].accessGate = _sg;
      boats[idx].accessGateCert = _sg.sub || _sg.certId;
    } else {
      boats[idx].accessGate = null;
      boats[idx].accessGateCert = '';
    }
  } else if (b.accessGateCert !== undefined) {
    // Legacy callers still work
    boats[idx].accessGateCert = String(b.accessGateCert || '');
    if (!b.accessGateCert) boats[idx].accessGate = null;
  }
  if (b.accessAllowlist !== undefined) boats[idx].accessAllowlist = Array.isArray(b.accessAllowlist) ? b.accessAllowlist.map(String) : [];
  setConfigSheetValue_('boats', JSON.stringify(boats));
  cDel_('config');
  return okJ({ updated: true, boat: boats[idx] });
}

function saveReservation_(b) {
  if (!b.boatId) return failJ('boatId required');
  if (!b.memberKennitala || !b.memberName) return failJ('member required');
  if (!b.startDate || !b.endDate) return failJ('startDate and endDate required');
  const cfgMap = getConfigMap_();
  let boats = [];
  try { boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]'); } catch (e) { return failJ('Failed to parse boats'); }
  const idx = boats.findIndex(x => x.id === b.boatId);
  if (idx < 0) return failJ('Boat not found');
  if (!boats[idx].reservations) boats[idx].reservations = [];
  const resId = b.reservationId || ('res_' + uid_());
  const resIdx = boats[idx].reservations.findIndex(r => r.id === resId);
  const res = {
    id: resId,
    memberKennitala: String(b.memberKennitala),
    memberName: String(b.memberName),
    startDate: String(b.startDate),
    endDate: String(b.endDate),
    note: String(b.note || ''),
  };
  if (resIdx >= 0) boats[idx].reservations[resIdx] = res;
  else boats[idx].reservations.push(res);
  setConfigSheetValue_('boats', JSON.stringify(boats));
  cDel_('config');
  return okJ({ updated: true, boat: boats[idx], reservation: res });
}

function removeReservation_(b) {
  if (!b.boatId) return failJ('boatId required');
  if (!b.reservationId) return failJ('reservationId required');
  const cfgMap = getConfigMap_();
  let boats = [];
  try { boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]'); } catch (e) { return failJ('Failed to parse boats'); }
  const idx = boats.findIndex(x => x.id === b.boatId);
  if (idx < 0) return failJ('Boat not found');
  if (!boats[idx].reservations) boats[idx].reservations = [];
  boats[idx].reservations = boats[idx].reservations.filter(r => r.id !== b.reservationId);
  setConfigSheetValue_('boats', JSON.stringify(boats));
  cDel_('config');
  return okJ({ updated: true, boat: boats[idx] });
}


// ═══════════════════════════════════════════════════════════════════════════════
// RESERVATION SLOTS
// ═══════════════════════════════════════════════════════════════════════════════

function getSlots_(b) {
  var all = readAll_('reservationSlots');
  var catBoatSet = null;
  if (b.category) {
    var cfgMap = getConfigMap_();
    var boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]');
    catBoatSet = {};
    boats.forEach(function(bt) { if (bt.category === b.category) catBoatSet[bt.id] = true; });
  }
  var result = [];
  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    if (b.boatId && s.boatId !== b.boatId) continue;
    if (catBoatSet && !catBoatSet[s.boatId]) continue;
    if (b.fromDate && s.date < b.fromDate) continue;
    if (b.toDate && s.date > b.toDate) continue;
    result.push(s);
  }
  return okJ({ slots: result });
}

// ── Google Calendar sync helpers ─────────────────────────────────────────
function saveCharterCalendars_(b) {
  try {
    if (b.rowingCalendarId !== undefined)
      setConfigSheetValue_('rowingCalendarId', String(b.rowingCalendarId || ''));
    if (b.rowingCalendarSyncActive !== undefined)
      setConfigSheetValue_('rowingCalendarSyncActive', b.rowingCalendarSyncActive ? 'true' : 'false');
    if (b.keelboatCalendarId !== undefined)
      setConfigSheetValue_('keelboatCalendarId', String(b.keelboatCalendarId || ''));
    if (b.keelboatCalendarSyncActive !== undefined)
      setConfigSheetValue_('keelboatCalendarSyncActive', b.keelboatCalendarSyncActive ? 'true' : 'false');
    cDel_('config');
    return okJ({ saved: true });
  } catch (e) { return failJ('saveCharterCalendars failed: ' + e.message); }
}

function saveClubCalendars_(b) {
  try {
    var cals = (b.calendars || []).map(function(c) {
      return { name: String(c.name || '').trim(), calendarId: String(c.calendarId || '').trim() };
    }).filter(function(c) { return c.name && c.calendarId; });
    setConfigSheetValue_('clubCalendars', JSON.stringify(cals));
    cDel_('config');
    return okJ({ saved: true });
  } catch (e) { return failJ('saveClubCalendars failed: ' + e.message); }
}

function gcalParseDateTime_(dateStr, timeStr) {
  var parts = String(timeStr || '00:00').split(':');
  var d = new Date(String(dateStr) + 'T00:00:00');
  d.setHours(parseInt(parts[0] || '0', 10), parseInt(parts[1] || '0', 10), 0, 0);
  return d;
}

// Create/update/delete a single calendar event. Only touches events whose id
// was created by this codebase — never scans by title/time. Returns the
// resulting eventId (empty string on delete, unchanged on skip/failure).
function gcalUpsertEvent_(calendarId, existingEventId, title, start, end, description, action) {
  try {
    if (!calendarId) return existingEventId || '';
    var cal = CalendarApp.getCalendarById(calendarId);
    if (!cal) { Logger.log('gcal: calendar not found ' + calendarId); return existingEventId || ''; }
    if (action === 'delete') {
      if (existingEventId) {
        var ev = cal.getEventById(existingEventId);
        if (ev) ev.deleteEvent();
      }
      return '';
    }
    if (existingEventId) {
      var ev2 = cal.getEventById(existingEventId);
      if (ev2) {
        ev2.setTime(start, end);
        ev2.setTitle(title);
        ev2.setDescription(description || '');
        return existingEventId;
      }
    }
    var created = cal.createEvent(title, start, end, { description: description || '' });
    return created.getId();
  } catch (e) {
    Logger.log('gcalUpsertEvent_ failed: ' + e);
    return existingEventId || '';
  }
}

function getCharterCalendarForBoat_(boat, cfgMap) {
  var cat = String((boat && (boat.category || boat.boatCategory)) || '').toLowerCase();
  if (cat === 'rowing-shell' || cat === 'rowingshell' || cat === 'rowing' || cat === 'rowboat') {
    return {
      calendarId: getConfigValue_('rowingCalendarId', cfgMap) || '',
      enabled: getConfigValue_('rowingCalendarSyncActive', cfgMap) === 'true',
    };
  }
  if (cat === 'keelboat') {
    return {
      calendarId: getConfigValue_('keelboatCalendarId', cfgMap) || '',
      enabled: getConfigValue_('keelboatCalendarSyncActive', cfgMap) === 'true',
    };
  }
  return { calendarId: '', enabled: false };
}

// Sync a reservation slot to its category's charter calendar. Safe to call
// after any mutation; fails silently (logs) so slot writes are never blocked.
function syncSlotToCalendar_(slotId, action) {
  try {
    addColIfMissing_('reservationSlots', 'gcalEventId');
    var cfgMap = getConfigMap_();
    if (action === 'delete') {
      // caller must have read the slot before deleting; accept a slot-like
      // object passed as slotId when id isn't available.
      return;
    }
    var slot = findOne_('reservationSlots', 'id', slotId);
    if (!slot) return;
    var boats = [];
    try { boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]'); } catch (e) {}
    var boat = boats.find(function (bt) { return bt.id === slot.boatId; }) || {};
    var cal = getCharterCalendarForBoat_(boat, cfgMap);
    if (!cal.calendarId || !cal.enabled) return;
    var title = (boat.name || slot.boatId) + ' — ' + (slot.bookedByName || 'Open');
    var start = gcalParseDateTime_(slot.date, slot.startTime);
    var end = gcalParseDateTime_(slot.date, slot.endTime);
    var desc = 'slot:' + slot.id + (slot.note ? ('\n' + slot.note) : '');
    var newId = gcalUpsertEvent_(cal.calendarId, slot.gcalEventId || '', title, start, end, desc, 'upsert');
    if (newId && newId !== (slot.gcalEventId || '')) {
      updateRow_('reservationSlots', 'id', slotId, { gcalEventId: newId });
    }
  } catch (e) { Logger.log('syncSlotToCalendar_ failed: ' + e); }
}

// Delete the calendar event for a slot that's about to be (or has been)
// removed. Takes the slot row itself because the DB row may already be gone.
function deleteSlotCalendarEvent_(slotRow) {
  try {
    if (!slotRow || !slotRow.gcalEventId) return;
    var cfgMap = getConfigMap_();
    var boats = [];
    try { boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]'); } catch (e) {}
    var boat = boats.find(function (bt) { return bt.id === slotRow.boatId; }) || {};
    var cal = getCharterCalendarForBoat_(boat, cfgMap);
    if (!cal.calendarId) return; // no calendar configured → nothing to delete
    gcalUpsertEvent_(cal.calendarId, slotRow.gcalEventId, '', null, null, '', 'delete');
  } catch (e) { Logger.log('deleteSlotCalendarEvent_ failed: ' + e); }
}

// Sync the activities array of a daily log entry to per-activity-type
// calendars. Mutates newActs in place to store gcalEventId on each synced item.
function syncDailyLogActivities_(date, oldActs, newActs) {
  try {
    var cfgMap = getConfigMap_();
    var types = [];
    try { types = JSON.parse(getConfigValue_('activity_types', cfgMap) || '[]'); } catch (e) {}
    var typeMap = {};
    types.forEach(function (t) { typeMap[t.id] = t; });
    var oldMap = {};
    (oldActs || []).forEach(function (a) { if (a && a.id) oldMap[a.id] = a; });
    var seen = {};
    (newActs || []).forEach(function (a) {
      if (!a || !a.id) return;
      seen[a.id] = true;
      var t = typeMap[a.activityTypeId];
      var prevId = (oldMap[a.id] && oldMap[a.id].gcalEventId) || a.gcalEventId || '';
      if (!t || !t.calendarId) { if (prevId) a.gcalEventId = prevId; return; }
      var enabled = t.calendarSyncActive === true || t.calendarSyncActive === 'true';
      if (!enabled) { if (prevId) a.gcalEventId = prevId; return; }
      var start = gcalParseDateTime_(date, a.start || '00:00');
      var end = gcalParseDateTime_(date, a.end || a.start || '00:00');
      if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
      var classLabel = t.nameIS || t.name || '';
      var tagLabel   = t.classTag || '';
      var baseName   = a.name || classLabel;
      var title = baseName + (tagLabel ? (' [' + tagLabel + ']') : '');
      var desc = 'activity:' + a.id
        + (a.participants ? ('\nparticipants: ' + a.participants) : '')
        + (a.notes ? ('\n' + a.notes) : '');
      var newId = gcalUpsertEvent_(t.calendarId, prevId, title, start, end, desc, 'upsert');
      if (newId) a.gcalEventId = newId;
    });
    // Deletions: anything in oldMap that no longer appears
    Object.keys(oldMap).forEach(function (id) {
      if (seen[id]) return;
      var a = oldMap[id];
      if (!a || !a.gcalEventId) return;
      var t = typeMap[a.activityTypeId];
      if (!t || !t.calendarId) return;
      gcalUpsertEvent_(t.calendarId, a.gcalEventId, '', null, null, '', 'delete');
    });
  } catch (e) { Logger.log('syncDailyLogActivities_ failed: ' + e); }
}

// Returns true if [startTime, endTime) overlaps any existing slot on the same
// boat/date (excluding a specific slotId if provided). Times are "HH:MM" — pure
// string comparison is safe because the format is zero-padded.
function hasSlotConflict_(boatId, date, startTime, endTime, excludeSlotId) {
  if (endTime <= startTime) return false;
  var all = readAll_('reservationSlots');
  for (var i = 0; i < all.length; i++) {
    var sl = all[i];
    if (excludeSlotId && sl.id === excludeSlotId) continue;
    if (String(sl.boatId) !== String(boatId)) continue;
    if (String(sl.date) !== String(date)) continue;
    if (startTime < sl.endTime && endTime > sl.startTime) return true;
  }
  return false;
}

function saveSlot_(b) {
  if (!b.boatId) return failJ('boatId required');
  if (!b.date || !b.startTime || !b.endTime) return failJ('date, startTime, endTime required');
  if (String(b.endTime) <= String(b.startTime)) return failJ('endTime must be after startTime');
  var id = b.slotId || ('slot_' + uid_());
  var existing = findOne_('reservationSlots', 'id', id);
  if (hasSlotConflict_(b.boatId, b.date, String(b.startTime), String(b.endTime), existing ? id : null)) {
    return failJ('Slot conflicts with an existing slot on this boat');
  }
  if (existing) {
    updateRow_('reservationSlots', 'id', id, {
      date: String(b.date), startTime: String(b.startTime), endTime: String(b.endTime),
      note: String(b.note || ''),
    });
  } else {
    insertRow_('reservationSlots', {
      id: id, boatId: String(b.boatId), date: String(b.date),
      startTime: String(b.startTime), endTime: String(b.endTime),
      recurrenceGroupId: String(b.recurrenceGroupId || ''),
      bookedByKennitala: '', bookedByName: '', bookedByCrewId: '',
      note: String(b.note || ''), createdAt: now_(),
    });
  }
  syncSlotToCalendar_(id, 'upsert');
  return okJ({ saved: true, slotId: id });
}

function saveRecurringSlots_(b) {
  if (!b.boatId) return failJ('boatId required');
  if (!b.startTime || !b.endTime) return failJ('startTime and endTime required');
  if (!b.fromDate || !b.toDate) return failJ('fromDate and toDate required');
  if (String(b.endTime) <= String(b.startTime)) return failJ('endTime must be after startTime');
  if (!b.daysOfWeek || !Array.isArray(b.daysOfWeek) || !b.daysOfWeek.length) return failJ('daysOfWeek required (array of 0-6)');
  var recId = 'recur_' + uid_();
  var days = b.daysOfWeek.map(Number);
  var created = [];
  var skipped = 0;
  var d = new Date(b.fromDate + 'T00:00:00');
  var end = new Date(b.toDate + 'T00:00:00');
  while (d <= end) {
    if (days.indexOf(d.getDay()) !== -1) {
      var dateStr = d.toISOString().slice(0, 10);
      if (hasSlotConflict_(b.boatId, dateStr, String(b.startTime), String(b.endTime), null)) {
        skipped++;
      } else {
        var slotId = 'slot_' + uid_();
        insertRow_('reservationSlots', {
          id: slotId, boatId: String(b.boatId), date: dateStr,
          startTime: String(b.startTime), endTime: String(b.endTime),
          recurrenceGroupId: recId,
          bookedByKennitala: '', bookedByName: '', bookedByCrewId: '',
          note: String(b.note || ''), createdAt: now_(),
        });
        created.push(slotId);
      }
    }
    d.setDate(d.getDate() + 1);
  }
  created.forEach(function (sid) { syncSlotToCalendar_(sid, 'upsert'); });
  return okJ({ saved: true, recurrenceGroupId: recId, count: created.length, skipped: skipped, slotIds: created });
}

function deleteSlot_(b) {
  if (!b.slotId) return failJ('slotId required');
  var existing = findOne_('reservationSlots', 'id', b.slotId);
  deleteRow_('reservationSlots', 'id', b.slotId);
  if (existing) deleteSlotCalendarEvent_(existing);
  return okJ({ deleted: true });
}

function deleteRecurrenceGroup_(b) {
  if (!b.recurrenceGroupId) return failJ('recurrenceGroupId required');
  var all = readAll_('reservationSlots');
  var toDelete = all.filter(function(s) { return s.recurrenceGroupId === b.recurrenceGroupId; });
  toDelete.forEach(function(s) { deleteRow_('reservationSlots', 'id', s.id); deleteSlotCalendarEvent_(s); });
  return okJ({ deleted: true, count: toDelete.length });
}

function bookSlot_(b) {
  if (!b.slotId) return failJ('slotId required');
  var slot = findOne_('reservationSlots', 'id', b.slotId);
  if (!slot) return failJ('Slot not found');
  if (slot.bookedByKennitala) return failJ('Slot already booked');
  // Validate booker
  var cfgMap = getConfigMap_();
  var boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]');
  var boat = boats.find(function(bt) { return bt.id === slot.boatId; });
  if (!boat) return failJ('Boat not found');
  var updates = { bookedByKennitala: '', bookedByName: '', bookedByCrewId: '', bookingColor: String(b.bookingColor || '') };
  if (b.crewId) {
    // Crew booking (rowing shells) — active or forming (tentative)
    var crew = findOne_('crews', 'id', b.crewId);
    if (!crew || crew.status === 'disbanded') return failJ('Crew not found or disbanded');
    if (crew.status !== 'active' && crew.status !== 'forming') return failJ('Crew not found or not active');
    var pairs = typeof crew.pairs === 'string' ? JSON.parse(crew.pairs) : (crew.pairs || []);
    var isMember = pairs.some(function(p) { return (p.members || []).some(function(m) { return m && String(m.kennitala) === String(b.kennitala); }); });
    if (!isMember) return failJ('You are not a member of this crew');
    updates.bookedByCrewId = String(b.crewId);
    updates.bookedByName = String(crew.name || b.memberName || '');
    updates.bookedByKennitala = String(b.kennitala || '');
    if (crew.status === 'forming') updates.tentative = 'true';
  } else {
    // Individual booking (keelboats — captain required)
    if (!b.kennitala) return failJ('kennitala required');
    // Keelboat-only gate: rowing shells enforce cert access via their own
    // released-rower path. For keelboats, honour the boat's access gate
    // (structured or legacy) via the unified helper — blocks expired certs.
    if (boat.category === 'keelboat') {
      var _bsDefs = getCertDefsFromMap_(cfgMap);
      var _bsGate = normalizeAccessGate_(boat, _bsDefs);
      if (_bsGate) {
        var member = findOne_('members', 'kennitala', String(b.kennitala).trim());
        if (!member) return failJ('Member not found');
        var isStaffRole = member.role === 'staff' || member.role === 'admin';
        if (!isStaffRole) {
          var certs = parseMemberCerts_(member.certifications);
          if (!memberHasGate_(certs, _bsGate, _bsDefs)) {
            return failJ('You do not have the required certification to book this boat');
          }
        }
      }
    }
    updates.bookedByKennitala = String(b.kennitala);
    updates.bookedByName = String(b.memberName || '');
  }
  updateRow_('reservationSlots', 'id', b.slotId, updates);
  syncSlotToCalendar_(b.slotId, 'upsert');
  return okJ({ booked: true, slotId: b.slotId });
}

function unbookSlot_(b) {
  if (!b.slotId) return failJ('slotId required');
  var slot = findOne_('reservationSlots', 'id', b.slotId);
  if (!slot) return failJ('Slot not found');
  if (!slot.bookedByKennitala) return failJ('Slot is not booked');
  // Allow the booker, any crew member, or staff to unbook
  var kt = String(b.kennitala || '');
  var isBooker = String(slot.bookedByKennitala) === kt;
  var isCrewMember = false;
  if (slot.bookedByCrewId) {
    var crew = findOne_('crews', 'id', slot.bookedByCrewId);
    if (crew) {
      var pairs = typeof crew.pairs === 'string' ? JSON.parse(crew.pairs) : (crew.pairs || []);
      isCrewMember = pairs.some(function(p) { return (p.members || []).some(function(m) { return m && String(m.kennitala) === kt; }); });
    }
  }
  var member = kt ? findOne_('members', 'kennitala', kt) : null;
  var isStaff = member && (member.role === 'staff' || member.role === 'admin');
  if (!isBooker && !isCrewMember && !isStaff) return failJ('Only the booker, a crew member, or staff can cancel');
  updateRow_('reservationSlots', 'id', b.slotId, { bookedByKennitala: '', bookedByName: '', bookedByCrewId: '', bookingColor: '' });
  syncSlotToCalendar_(b.slotId, 'upsert');
  return okJ({ unbooked: true });
}

function bulkBookSlots_(b) {
  if (!b.boatId) return failJ('boatId required');
  if (!b.fromDate || !b.toDate) return failJ('fromDate and toDate required');
  if (!b.daysOfWeek || !Array.isArray(b.daysOfWeek) || !b.daysOfWeek.length) return failJ('daysOfWeek required (array of 0-6)');
  if (!b.kennitala) return failJ('kennitala required');

  var cfgMap = getConfigMap_();
  var boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]');
  var boat = boats.find(function(bt) { return bt.id === b.boatId; });
  if (!boat) return failJ('Boat not found');

  // Validate once: crew or individual certification
  var updates = { bookedByKennitala: '', bookedByName: '', bookedByCrewId: '', bookingColor: String(b.bookingColor || '') };
  if (b.crewId) {
    var crew = findOne_('crews', 'id', b.crewId);
    if (!crew || crew.status === 'disbanded') return failJ('Crew not found or disbanded');
    if (crew.status !== 'active' && crew.status !== 'forming') return failJ('Crew not found or not active');
    var pairs = typeof crew.pairs === 'string' ? JSON.parse(crew.pairs) : (crew.pairs || []);
    var isMember = pairs.some(function(p) { return (p.members || []).some(function(m) { return m && String(m.kennitala) === String(b.kennitala); }); });
    if (!isMember) return failJ('You are not a member of this crew');
    updates.bookedByCrewId = String(b.crewId);
    updates.bookedByName = String(crew.name || b.memberName || '');
    updates.bookedByKennitala = String(b.kennitala);
    if (crew.status === 'forming') updates.tentative = 'true';
  } else {
    // Keelboat-only gate (same rationale as bookSlot_): use unified helper so
    // structured, legacy, and rank-based gates all agree and expiry blocks.
    if (boat.category === 'keelboat') {
      var _bbDefs = getCertDefsFromMap_(cfgMap);
      var _bbGate = normalizeAccessGate_(boat, _bbDefs);
      if (_bbGate) {
        var member = findOne_('members', 'kennitala', String(b.kennitala).trim());
        if (!member) return failJ('Member not found');
        var isStaffRole = member.role === 'staff' || member.role === 'admin';
        if (!isStaffRole) {
          var certs = parseMemberCerts_(member.certifications);
          if (!memberHasGate_(certs, _bbGate, _bbDefs)) {
            return failJ('You do not have the required certification to book this boat');
          }
        }
      }
    }
    updates.bookedByKennitala = String(b.kennitala);
    updates.bookedByName = String(b.memberName || '');
  }

  // Fetch all slots for this boat in the date range
  var days = b.daysOfWeek.map(Number);
  var filterStart = b.startTime || '';
  var filterEnd = b.endTime || '';
  var all = readAll_('reservationSlots');
  var booked = 0;
  var skipped = 0;
  for (var i = 0; i < all.length; i++) {
    var sl = all[i];
    if (sl.boatId !== b.boatId) continue;
    if (sl.date < b.fromDate || sl.date > b.toDate) continue;
    var slDate = new Date(sl.date + 'T00:00:00');
    if (days.indexOf(slDate.getDay()) === -1) continue;
    if (filterStart && sl.startTime < filterStart) continue;
    if (filterEnd && sl.endTime > filterEnd) continue;
    if (sl.bookedByKennitala) { skipped++; continue; }
    updateRow_('reservationSlots', 'id', sl.id, updates);
    syncSlotToCalendar_(sl.id, 'upsert');
    booked++;
  }
  return okJ({ success: true, booked: booked, skipped: skipped });
}


// ═══════════════════════════════════════════════════════════════════════════════
// CREWS
// ═══════════════════════════════════════════════════════════════════════════════

function getCrews_(b) {
  var all = readAll_('crews');
  // Parse pairs JSON once upfront
  all.forEach(function(c) {
    c.pairs = typeof c.pairs === 'string' ? JSON.parse(c.pairs || '[]') : (c.pairs || []);
  });
  if (b.kennitala) {
    var kt = String(b.kennitala);
    all = all.filter(function(c) {
      if (c.status === 'disbanded') return false;
      return c.pairs.some(function(p) { return (p.members || []).some(function(m) { return m && String(m.kennitala) === kt; }); });
    });
  }
  return okJ({ crews: all });
}

function getCrewBoard_(b) {
  var all = readAll_('crews');
  all.forEach(function(c) {
    c.pairs = typeof c.pairs === 'string' ? JSON.parse(c.pairs || '[]') : (c.pairs || []);
  });
  // Return all non-disbanded crews that have open seats or are active
  all = all.filter(function(c) { return c.status !== 'disbanded'; });
  return okJ({ crews: all });
}

function createCrew_(b) {
  if (!b.name) return failJ('Crew name required');
  if (!b.kennitala || !b.memberName) return failJ('Creator kennitala and name required');
  var numPairs = parseInt(b.numPairs) || 2;
  if (numPairs < 2 || numPairs > 3) return failJ('numPairs must be 2 or 3');
  var pairs = [];
  for (var i = 0; i < numPairs; i++) {
    pairs.push({ pairId: 'pair_' + (i + 1), members: [null, null] });
  }
  // Assign creator to chosen seat: pairIndex + seatIndex (0=bow, 1=stern)
  var creatorPair = parseInt(b.creatorPairIndex) || 0;
  if (creatorPair >= pairs.length) creatorPair = 0;
  var creatorSeat = parseInt(b.creatorSeatIndex) || 0;
  if (creatorSeat > 1) creatorSeat = 0;
  pairs[creatorPair].members[creatorSeat] = { kennitala: String(b.kennitala), name: String(b.memberName) };
  var id = 'crew_' + uid_();
  var visibility = (b.visibility === 'invite_only') ? 'invite_only' : 'open';
  // Accept any hex color or auto-assign from palette
  var CREW_COLORS = ['#e74c3c','#e67e22','#f1c40f','#27ae60','#2980b9','#8e44ad','#d4af37','#a78bfa'];
  var color = '';
  if (b.color && /^#[0-9a-fA-F]{6}$/.test(b.color)) {
    color = b.color;
  } else {
    var existingCount = readAll_('crews').filter(function(c) { return c.status !== 'disbanded'; }).length;
    color = CREW_COLORS[existingCount % CREW_COLORS.length];
  }
  insertRow_('crews', {
    id: id, name: String(b.name), pairs: JSON.stringify(pairs),
    description: String(b.description || ''),
    visibility: visibility, color: color,
    status: 'forming', createdAt: now_(), updatedAt: now_(),
  });
  return okJ({ created: true, crewId: id, crew: { id: id, name: b.name, pairs: pairs, status: 'forming', description: b.description || '', visibility: visibility, color: color } });
}

function updateCrew_(b) {
  if (!b.crewId) return failJ('crewId required');
  var crew = findOne_('crews', 'id', b.crewId);
  if (!crew) return failJ('Crew not found');
  if (crew.status === 'disbanded') return failJ('Crew is disbanded');
  var updates = { updatedAt: now_() };
  if (b.name !== undefined) updates.name = String(b.name);
  if (b.description !== undefined) updates.description = String(b.description);
  if (b.visibility !== undefined) updates.visibility = (b.visibility === 'invite_only') ? 'invite_only' : 'open';
  if (b.color !== undefined) updates.color = String(b.color);
  updateRow_('crews', 'id', b.crewId, updates);
  return okJ({ updated: true });
}

function disbandCrew_(b) {
  if (!b.crewId) return failJ('crewId required');
  var crew = findOne_('crews', 'id', b.crewId);
  if (!crew) return failJ('Crew not found');
  updateRow_('crews', 'id', b.crewId, { status: 'disbanded', updatedAt: now_() });
  // Reject any pending invites for this crew
  var invites = readAll_('crewInvites').filter(function(inv) { return inv.crewId === b.crewId && inv.status === 'pending'; });
  invites.forEach(function(inv) { updateRow_('crewInvites', 'id', inv.id, { status: 'rejected', respondedAt: now_() }); });
  return okJ({ disbanded: true });
}

function joinCrew_(b) {
  if (!b.crewId) return failJ('crewId required');
  if (!b.kennitala || !b.memberName) return failJ('kennitala and memberName required');
  if (!b.pairId) return failJ('pairId required');
  var seatIndex = parseInt(b.seatIndex);
  if (isNaN(seatIndex) || seatIndex < 0 || seatIndex > 1) return failJ('seatIndex must be 0 (bow) or 1 (stern)');
  var crew = findOne_('crews', 'id', b.crewId);
  if (!crew) return failJ('Crew not found');
  if (crew.status === 'disbanded') return failJ('Crew is disbanded');
  if ((crew.visibility || 'open') === 'invite_only') return failJ('This crew is invite-only');
  var pairs = typeof crew.pairs === 'string' ? JSON.parse(crew.pairs) : (crew.pairs || []);
  // Check not already a member
  var alreadyMember = pairs.some(function(p) { return (p.members || []).some(function(m) { return m && String(m.kennitala) === String(b.kennitala); }); });
  if (alreadyMember) return failJ('You are already in this crew');
  var pair = pairs.find(function(p) { return p.pairId === b.pairId; });
  if (!pair) return failJ('Pair not found');
  // Ensure members array has 2 slots
  if (!pair.members) pair.members = [null, null];
  while (pair.members.length < 2) pair.members.push(null);
  if (pair.members[seatIndex] !== null) return failJ('This seat is taken');
  pair.members[seatIndex] = { kennitala: String(b.kennitala), name: String(b.memberName) };
  // Check if crew is now fully formed
  var totalMembers = pairs.reduce(function(sum, p) { return sum + (p.members || []).filter(function(m) { return m !== null; }).length; }, 0);
  var totalSlots = pairs.length * 2;
  var newStatus = totalMembers >= totalSlots ? 'active' : 'forming';
  updateRow_('crews', 'id', b.crewId, { pairs: JSON.stringify(pairs), status: newStatus, updatedAt: now_() });
  return okJ({ joined: true, status: newStatus });
}

function leaveCrew_(b) {
  if (!b.crewId) return failJ('crewId required');
  if (!b.kennitala) return failJ('kennitala required');
  var crew = findOne_('crews', 'id', b.crewId);
  if (!crew) return failJ('Crew not found');
  if (crew.status === 'disbanded') return failJ('Crew is disbanded');
  var pairs = typeof crew.pairs === 'string' ? JSON.parse(crew.pairs) : (crew.pairs || []);
  var found = false;
  pairs.forEach(function(p) {
    if (!p.members) return;
    for (var i = 0; i < p.members.length; i++) {
      if (p.members[i] && String(p.members[i].kennitala) === String(b.kennitala)) {
        p.members[i] = null;
        found = true;
      }
    }
  });
  if (!found) return failJ('You are not in this crew');
  // Check if crew is now empty (all seats null)
  var totalMembers = pairs.reduce(function(sum, p) { return sum + (p.members || []).filter(function(m) { return m !== null; }).length; }, 0);
  if (totalMembers === 0) {
    updateRow_('crews', 'id', b.crewId, { status: 'disbanded', updatedAt: now_() });
    return okJ({ left: true, disbanded: true });
  }
  // If was active, revert to forming
  var newStatus = totalMembers >= pairs.length * 2 ? 'active' : 'forming';
  updateRow_('crews', 'id', b.crewId, { pairs: JSON.stringify(pairs), status: newStatus, updatedAt: now_() });
  return okJ({ left: true, status: newStatus });
}

function inviteToCrew_(b) {
  if (!b.crewId) return failJ('crewId required');
  if (!b.toKennitala || !b.toName) return failJ('Invitee kennitala and name required');
  if (!b.fromKennitala || !b.fromName) return failJ('Inviter kennitala and name required');
  if (!b.pairId) return failJ('pairId required');
  var crew = findOne_('crews', 'id', b.crewId);
  if (!crew) return failJ('Crew not found');
  if (crew.status === 'disbanded') return failJ('Crew is disbanded');
  // Check pair exists and has room
  var pairs = typeof crew.pairs === 'string' ? JSON.parse(crew.pairs) : (crew.pairs || []);
  var pair = pairs.find(function(p) { return p.pairId === b.pairId; });
  if (!pair) return failJ('Pair not found');
  if (!pair.members) pair.members = [null, null];
  while (pair.members.length < 2) pair.members.push(null);
  var openSeats = pair.members.filter(function(m) { return m === null; }).length;
  if (openSeats === 0) return failJ('This pair is full');
  // Check not already a member
  var alreadyMember = pairs.some(function(p) { return (p.members || []).some(function(m) { return m && String(m.kennitala) === String(b.toKennitala); }); });
  if (alreadyMember) return failJ('This person is already in the crew');
  // Check no duplicate pending invite
  var existing = readAll_('crewInvites').find(function(inv) {
    return inv.crewId === b.crewId && String(inv.toKennitala) === String(b.toKennitala) && inv.status === 'pending';
  });
  if (existing) return failJ('An invite is already pending for this person');
  var id = 'cinv_' + uid_();
  insertRow_('crewInvites', {
    id: id, crewId: String(b.crewId), crewName: String(crew.name),
    pairId: String(b.pairId),
    fromKennitala: String(b.fromKennitala), fromName: String(b.fromName),
    toKennitala: String(b.toKennitala), toName: String(b.toName),
    status: 'pending', createdAt: now_(), respondedAt: '',
  });
  return okJ({ invited: true, inviteId: id });
}

function respondCrewInvite_(b) {
  if (!b.inviteId) return failJ('inviteId required');
  if (!b.response || (b.response !== 'accepted' && b.response !== 'rejected')) return failJ('response must be accepted or rejected');
  var inv = findOne_('crewInvites', 'id', b.inviteId);
  if (!inv) return failJ('Invite not found');
  if (inv.status !== 'pending') return failJ('Invite already responded to');
  updateRow_('crewInvites', 'id', b.inviteId, { status: b.response, respondedAt: now_() });
  if (b.response === 'accepted') {
    // Add member to the crew's pair (first empty seat)
    var crew = findOne_('crews', 'id', inv.crewId);
    if (crew) {
      var pairs = typeof crew.pairs === 'string' ? JSON.parse(crew.pairs) : (crew.pairs || []);
      var pair = pairs.find(function(p) { return p.pairId === inv.pairId; });
      if (pair) {
        if (!pair.members) pair.members = [null, null];
        while (pair.members.length < 2) pair.members.push(null);
        // Place in the specified seat or first empty seat
        var seatIdx = -1;
        if (b.seatIndex !== undefined) seatIdx = parseInt(b.seatIndex);
        if (seatIdx < 0 || seatIdx > 1 || pair.members[seatIdx] !== null) {
          // Fallback to first empty seat
          seatIdx = pair.members[0] === null ? 0 : (pair.members[1] === null ? 1 : -1);
        }
        if (seatIdx >= 0 && pair.members[seatIdx] === null) {
          pair.members[seatIdx] = { kennitala: String(inv.toKennitala), name: String(inv.toName) };
          var totalMembers = pairs.reduce(function(sum, p) { return sum + (p.members || []).filter(function(m) { return m !== null; }).length; }, 0);
          var totalSlots = pairs.length * 2;
          var newStatus = totalMembers >= totalSlots ? 'active' : 'forming';
          updateRow_('crews', 'id', inv.crewId, { pairs: JSON.stringify(pairs), status: newStatus, updatedAt: now_() });
        }
      }
    }
  }
  return okJ({ responded: true, status: b.response });
}

function getCrewInvites_(b) {
  var all = readAll_('crewInvites');
  if (b.kennitala) {
    var kt = String(b.kennitala);
    all = all.filter(function(inv) { return String(inv.toKennitala) === kt && inv.status === 'pending'; });
  }
  if (b.crewId) {
    all = all.filter(function(inv) { return inv.crewId === b.crewId; });
  }
  return okJ({ invites: all });
}


// ── Captain bio & headshot ──────────────────────────────────────────────────

function saveCaptainBio_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  var m = findOne_('members', 'kennitala', String(b.kennitala).trim());
  if (!m) return failJ('Member not found', 404);
  var updates = { updatedAt: now_() };
  if (b.bio !== undefined) updates.bio = String(b.bio || '');
  if (b.headshotUrl !== undefined) updates.headshotUrl = String(b.headshotUrl || '');
  updateRow_('members', 'kennitala', String(b.kennitala).trim(), updates);
  cDel_('members');
  return okJ({ saved: true });
}

function uploadHeadshot_(b) {
  if (!b.fileData) return failJ('fileData required');
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('DRIVE_FOLDER_ID_PHOTOS');
  if (!folderId) folderId = props.getProperty('DRIVE_FOLDER_ID_MAINT_PHOTOS');
  if (!folderId) return okJ({ ok: false, error: 'Drive folder not configured' });
  try {
    var ext      = (b.fileName || 'headshot.jpg').split('.').pop().toLowerCase();
    var ts       = now_().replace(/[: ]/g, '-');
    var safeName = 'headshot_' + (b.kennitala || 'unknown') + '_' + ts + '.' + ext;
    var base64   = b.fileData.replace(/^data:[^;]+;base64,/, '');
    var bytes    = Utilities.base64Decode(base64);
    var mimeMap  = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', heic:'image/heic' };
    var mime     = b.mimeType || mimeMap[ext] || 'image/jpeg';
    var blob     = Utilities.newBlob(bytes, mime, safeName);
    var folder   = DriveApp.getFolderById(folderId);
    var file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = file.getUrl();
    // Auto-save to member record if kennitala provided
    if (b.kennitala) {
      updateRow_('members', 'kennitala', String(b.kennitala).trim(), { headshotUrl: url, updatedAt: now_() });
      cDel_('members');
    }
    return okJ({ ok: true, headshotUrl: url });
  } catch (e) {
    return failJ('Headshot upload error: ' + e.message);
  }
}


