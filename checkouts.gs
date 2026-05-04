// ═══════════════════════════════════════════════════════════════════════════════
// CHECKOUTS
// ═══════════════════════════════════════════════════════════════════════════════

function getActiveCheckouts_(b) {
  // Compare against createdAt's UTC date since createdAt is stored as UTC ISO
  // via now_(); both operands must share the same reference frame.
  const todayUtc = now_().slice(0, 10);
  const date = b && b.date ? String(b.date).slice(0, 10) : '';
  const all = readAll_('checkouts');
  // When a date is passed and it isn't today, return every checkout whose
  // createdAt falls on that date — the daily-log "Link group checkout"
  // picker uses this to allow post-facto linking on past daily logs. Today
  // (or no date) keeps the original "active" semantics: currently-out plus
  // anything checked back in earlier today.
  let result;
  if (date && date !== todayUtc) {
    result = all.filter(c => (c.createdAt || '').slice(0, 10) === date);
  } else {
    result = all.filter(c => c.status === 'out' || (c.status === 'in' && (c.createdAt || '').slice(0, 10) === todayUtc));
  }
  let memberMap = {};
  try { memberMap = getMemberMap_(); } catch (e) { }
  let labelMap = {};
  try { labelMap = buildGroupLabelMap_(); } catch (e) { labelMap = {}; }
  const enriched = result.map(c => {
    const m = memberMap[String(c.memberKennitala || '')] || {};
    const key = String(c.id);
    return {
      ...c,
      memberPhone: c.memberPhone || m.phone || '',
      memberIsMinor: c.memberIsMinor !== undefined && c.memberIsMinor !== '' ? bool_(c.memberIsMinor) : bool_(m.isMinor),
      guardianName: c.guardianName || m.guardianName || '',
      guardianPhone: c.guardianPhone || m.guardianPhone || '',
      groupLabel: key in labelMap ? labelMap[key] : '',
    };
  });
  return okJ({ checkouts: enriched });
}

// Build { checkoutId → activity-name } for every group-sail checkout. Every
// group checkout is present as a key — value is '' when no name resolves so
// callers can use map-key presence to mean "this is a group sail" and fall
// back to a generic "Group sail" label when the value is empty.
//
// Resolution order, per checkout:
//   1. checkout.linkedActivityId → activities.title  (Path A: link picker
//      shown right after launching the group sail)
//   2. activities.linkedGroupCheckoutIds[] contains checkout.id → that
//      activity's title  (Path B: link from the daily-log activity modal)
//   3. checkout.activityTypeName, when an actual activityTypeId is set
//      (gmActivity dropdown selection at launch time).
function buildGroupLabelMap_() {
  var labels = {};
  var sched = [];
  try { sched = (readAll_('activities') || []).filter(function (r) { return r && !(r.signupRequired === true || r.signupRequired === 'TRUE' || r.signupRequired === 'true'); }); } catch (e) { sched = []; }
  var schedById = {};
  sched.forEach(function (r) { if (r.id) schedById[String(r.id)] = r; });
  var checkouts = [];
  try { checkouts = (readAll_('checkouts') || []).filter(function (c) { return c && (c.isGroup === true || c.isGroup === 'true'); }); } catch (e) { checkouts = []; }
  // Seed every group checkout with '' so map presence carries the group flag
  // even when no link/type resolves.
  checkouts.forEach(function (c) { labels[String(c.id)] = ''; });
  // Path A
  checkouts.forEach(function (c) {
    if (!c.linkedActivityId) return;
    var ev = schedById[String(c.linkedActivityId)];
    if (ev && ev.title) labels[String(c.id)] = ev.title;
  });
  // Path B (Path A wins when both are set — explicit checkout-side link.)
  sched.forEach(function (r) {
    if (!r.linkedGroupCheckoutIds || !r.title) return;
    var arr;
    try { arr = JSON.parse(r.linkedGroupCheckoutIds); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) return;
    arr.forEach(function (coId) {
      var key = String(coId);
      if (key in labels && !labels[key]) labels[key] = r.title;
    });
  });
  // Fallback to activityTypeName when an actual type was picked at launch.
  // Skips rows where only the placeholder text leaked through (no id).
  checkouts.forEach(function (c) {
    var key = String(c.id);
    if (labels[key]) return;
    if (c.activityTypeId && c.activityTypeName) labels[key] = c.activityTypeName;
  });
  return labels;
}

function saveCheckout_(b, caller) {
  ensureCheckoutContactCols_();
  ensureActorCols_('checkouts');
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
          var isOwner = checkBoat.ownership === 'private' && String(checkBoat.ownerId || checkBoat.ownerKennitala || '') === checkKt;
          if (isOwner) hasAccess = true;
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
          // Slot-based scheduling check — also feeds the slot-only override below.
          var hasActiveSlotNow = false;
          if (checkBoat.slotSchedulingEnabled) {
            var todayStr = nowLocalDate_();
            var nowTime = nowLocalTime_();
            try {
              var slots = readAll_('reservationSlots').filter(function(s) {
                return s.boatId === checkBoat.id && s.date === todayStr && s.startTime <= nowTime && s.endTime > nowTime && s.bookedByKennitala;
              });
              // Check if user booked a slot directly or via crew
              hasActiveSlotNow = slots.some(function(s) {
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
            if (hasActiveSlotNow) hasAccess = true;
          }
          // Slot-only override: cert gates and allowlists qualify a member to
          // BOOK a slot, but don't bypass the slot-only restriction itself.
          // Owner exempt (set above); staff exempt above.
          if (!isOwner && checkBoat.slotSchedulingEnabled && !checkBoat.availableOutsideSlots && !hasActiveSlotNow) {
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
    actorKennitala: actorKt_(caller),
    actorName:      actorName_(caller),
  });
  cDel_('checkouts'); return okJ({ id, created: true });
}

function saveGroupCheckout_(b, caller) {
  ensureGroupCols_();
  ensureActorCols_('checkouts');
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
  const boatIds        = Array.isArray(b.boatIds)         ? b.boatIds         : tryParseArr_(b.boatIds);
  const boatNames      = Array.isArray(b.boatNames)       ? b.boatNames       : tryParseArr_(b.boatNames);
  const staffNames     = Array.isArray(b.staffNames)      ? b.staffNames      : tryParseArr_(b.staffNames);
  const staffKennitalar= Array.isArray(b.staffKennitalar) ? b.staffKennitalar : tryParseArr_(b.staffKennitalar);

  // Activity association — three flavors:
  //   1. linkedActivityId (the group is part of an existing scheduled activity)
  //   2. classTag (no instance link, just a coarse category)
  //   3. newActivity (mint an ad-hoc activity for today, then link it)
  // The frontend picker normalizes its choice into one of these before POST.
  let linkedActivityId = String(b.linkedActivityId || '');
  let classTag         = String(b.classTag || '');
  if (b.newActivity && typeof b.newActivity === 'object' && (b.newActivity.name || b.newActivity.classTag)) {
    var na = b.newActivity;
    var todayIso = nowLocalDate_();
    var startTime = na.startTime || b.checkedOutAt || nowLocalTime_();
    var endTime   = na.endTime   || b.expectedReturn || '';
    var newAct = activity_upsert_({
      signupRequired: false,
      status:         'upcoming',
      source:         'manual',
      date:           todayIso,
      startTime:      startTime,
      endTime:        endTime,
      activityTypeId: String(na.activityTypeId || ''),
      title:          String(na.name || na.classTag || ''),
      updatedBy:      actorName_(caller),
    });
    linkedActivityId = newAct ? newAct.id : '';
    if (!classTag) classTag = String(na.classTag || '');
  }

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
    notes:           '',
    status:          'out',
    createdAt:       ts,
    isGroup:         true,
    participants:    parseInt(b.participants) || 0,
    staffNames:      JSON.stringify(staffNames),
    staffKennitalar: JSON.stringify(staffKennitalar),
    boatNames:       JSON.stringify(boatNames),
    boatIds:         JSON.stringify(boatIds),
    activityTypeId:  b.activityTypeId || '',
    activityTypeName:b.activityTypeName || '',
    linkedActivityId,
    classTag,
    actorKennitala:  actorKt_(caller),
    actorName:       actorName_(caller),
  });
  cDel_('checkouts');
  return okJ({ id, created: true, linkedActivityId, classTag });
}

function groupCheckIn_(b, caller) {
  if (!b.id) return failJ('id required');
  const checkedInAt = b.timeIn || nowLocalTime_();
  ensureActorCols_('checkouts');
  updateRow_('checkouts', 'id', b.id, {
    status: 'in', checkedInAt,
    actorKennitala: actorKt_(caller),
    actorName:      actorName_(caller),
  });
  // Create one trip row per named staff member with a kennitala so supervising
  // staff get sea-time credit and the group sail surfaces in logbook/passport
  // queries the same way an individual checkout does. Anonymous participants
  // remain off the trip ledger (mostly minors/guests with no kt on file).
  var tripsCreated = 0;
  try { tripsCreated = createSupervisorTripsForGroup_(b.id, checkedInAt, caller); }
  catch (e) { Logger.log('createSupervisorTripsForGroup_ failed: ' + e); }
  cDel_('checkouts');
  return okJ({ updated: true, checkedInAt, tripsCreated });
}

// One trip row per named staff member with a kennitala. Idempotent — finds
// existing trips for this checkout id (any role) and skips kennitalar that
// already have one. Returns the number of trips actually inserted.
function createSupervisorTripsForGroup_(checkoutId, checkedInAt, caller) {
  var co = findOne_('checkouts', 'id', checkoutId);
  if (!co) return 0;
  var staffNames     = tryParseArr_(co.staffNames);
  var staffKennitalar= tryParseArr_(co.staffKennitalar);
  if (!staffKennitalar.length) return 0;
  ensureActorCols_('trips');
  var existing = readAll_('trips').filter(function (t) {
    return String(t.linkedCheckoutId || '') === String(checkoutId);
  });
  var seenKt = {};
  existing.forEach(function (t) { if (t.kennitala) seenKt[String(t.kennitala)] = true; });
  var timeOut = sstr_(co.checkedOutAt).slice(0, 5);
  var timeIn  = sstr_(checkedInAt).slice(0, 5);
  var hoursDecimal = 0;
  if (timeOut && timeIn) {
    var oh = parseInt(timeOut.slice(0, 2), 10), om = parseInt(timeOut.slice(3, 5), 10);
    var ih = parseInt(timeIn.slice(0, 2), 10),  im = parseInt(timeIn.slice(3, 5), 10);
    var mins = (ih * 60 + im) - (oh * 60 + om);
    if (mins < 0) mins += 1440;
    hoursDecimal = Math.round((mins / 60) * 100) / 100;
  }
  var date = nowLocalDate_();
  var ts = now_();
  var n = 0;
  staffKennitalar.forEach(function (kt, i) {
    kt = String(kt || '').trim();
    if (!kt || seenKt[kt]) return;
    var name = staffNames[i] || '';
    insertRow_('trips', {
      id: uid_(), kennitala: kt, memberName: name,
      date: date, timeOut: timeOut, timeIn: timeIn, hoursDecimal: hoursDecimal,
      boatId: co.boatId || '', boatName: co.boatName || '', boatCategory: co.boatCategory || '',
      locationId: co.locationId || '', locationName: co.locationName || '',
      crew: parseInt(co.crew) || 0, role: 'supervisor',
      wxSnapshot: co.wxSnapshot || '',
      notes: '',
      isLinked: true, linkedCheckoutId: String(checkoutId),
      departurePort: co.departurePort || '',
      actorKennitala: actorKt_(caller), actorName: actorName_(caller),
      createdAt: ts, updatedAt: ts,
    });
    n++;
  });
  return n;
}

function sstr_(v) { return String(v == null ? '' : v); }

function tryParseArr_(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : [String(v)]; } catch(e) { return String(v).split(',').map(x=>x.trim()).filter(Boolean); }
}

function checkIn_(b, caller) {
  if (!b.id) return failJ('id required');
  ensureActorCols_('checkouts');
  const checkedInAt = b.timeIn || nowLocalTime_();
  const updates = {
    status: 'in', checkedInAt,
    actorKennitala: actorKt_(caller),
    actorName:      actorName_(caller),
  };
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
  // Defensively ensure the sourceActivityClassId column exists — it's added
  // when a captain books a virtual class-slot for the first time, but can be
  // missing on fresh deploys where no booking has happened yet.
  addColIfMissing_('reservationSlots', 'sourceActivityClassId');
  var all = readAll_('reservationSlots');
  var catBoatSet = null;
  if (b.category) {
    var cfgMap = getConfigMap_();
    var boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]');
    catBoatSet = {};
    boats.forEach(function(bt) { if (bt.category === b.category) catBoatSet[bt.id] = true; });
  }
  // Build the set of virtual ids that have already been materialized so the
  // projection doesn't double-count them. A real row carrying
  // sourceActivityClassId IS a class-slot booking — its virtual counterpart
  // must drop out of the merge.
  var materialized = {};
  var result = [];
  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    if (s.sourceActivityClassId) {
      materialized['vslot-' + s.sourceActivityClassId + '-' + s.boatId + '-' + s.date] = true;
    }
    if (b.boatId && s.boatId !== b.boatId) continue;
    if (catBoatSet && !catBoatSet[s.boatId]) continue;
    if (b.fromDate && s.date < b.fromDate) continue;
    if (b.toDate && s.date > b.toDate) continue;
    result.push(s);
  }
  // Merge in virtual slots projected from activity classes that reserve boats.
  // Virtuals aren't persisted — they're computed on read so changing a class
  // schedule doesn't rewrite old rows. Any virtual whose materialization
  // already exists in the real table is suppressed (the real one carries the
  // current booking state).
  if (b.fromDate && b.toDate) {
    var virt = projectSlotsForRange_(b.fromDate, b.toDate);
    for (var j = 0; j < virt.length; j++) {
      var vs = virt[j];
      if (materialized[vs.id]) continue;
      if (b.boatId && vs.boatId !== b.boatId) continue;
      if (catBoatSet && !catBoatSet[vs.boatId]) continue;
      result.push(vs);
    }
  }
  return okJ({ slots: result });
}

// Expand each active class's bulkSchedule × reservedBoatIds into virtual
// reservationSlot rows across a date range. Used by getSlots_ to block out
// captain-bookable windows without persisting anything. Callers receive each
// virtual with `virtual: true` and `sourceActivityClassId` set so the UI can
// distinguish them from real bookings and refuse to book over them.
function projectSlotsForDate_(dateISO, classes) {
  if (!dateISO) return [];
  var arr = classes;
  if (!arr) {
    try { arr = JSON.parse(getConfigValue_('activity_templates', getConfigMap_()) || '[]'); } catch (e) { return []; }
  }
  if (!Array.isArray(arr) || !arr.length) return [];
  var dow = String(new Date(dateISO + 'T12:00:00').getDay());
  var out = [];
  arr.forEach(function(cls) {
    if (!cls || cls.active === false) return;
    if (!cls.bulkSchedule) return;
    var boats = Array.isArray(cls.reservedBoatIds) ? cls.reservedBoatIds : [];
    if (!boats.length) return;
    var bs = cls.bulkSchedule;
    if (bs.fromDate && dateISO < bs.fromDate) return;
    if (bs.toDate   && dateISO > bs.toDate)   return;
    var days = Array.isArray(bs.daysOfWeek) ? bs.daysOfWeek.map(String) : [];
    if (!days.length || days.indexOf(dow) === -1) return;
    var startT = bs.startTime || cls.defaultStart || '';
    var endT   = bs.endTime   || cls.defaultEnd   || '';
    if (!startT || !endT) return;
    boats.forEach(function(boatId) {
      out.push({
        id: 'vslot-' + cls.id + '-' + boatId + '-' + dateISO,
        boatId: String(boatId),
        date: dateISO,
        startTime: startT,
        endTime: endT,
        recurrenceGroupId: '',
        gcalEventId: '',
        note: '',
        createdAt: '',
        bookedByKennitala: '',
        bookedByName: '',
        bookedByCrewId: '',
        bookingColor: '',
        tentative: '',
        virtual: true,
        sourceActivityClassId: cls.id,
        sourceClassName:   cls.name   || '',
        sourceClassNameIS: cls.nameIS || '',
        sourceClassTag:    cls.classTag || '',
      });
    });
  });
  return out;
}

function projectSlotsForRange_(fromISO, toISO) {
  if (!fromISO || !toISO) return [];
  var classes = [];
  try { classes = JSON.parse(getConfigValue_('activity_templates', getConfigMap_()) || '[]'); } catch (e) { return []; }
  if (!Array.isArray(classes) || !classes.length) return [];
  var out = [];
  var d = new Date(fromISO + 'T00:00:00');
  var end = new Date(toISO + 'T00:00:00');
  // Cap at a reasonable horizon so an accidental huge range doesn't runaway.
  var MAX_DAYS = 400;
  var count = 0;
  for (; d <= end && count < MAX_DAYS; d.setDate(d.getDate() + 1), count++) {
    var y = d.getFullYear(), mo = d.getMonth() + 1, da = d.getDate();
    var iso = y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (da < 10 ? '0' : '') + da;
    var day = projectSlotsForDate_(iso, classes);
    for (var i = 0; i < day.length; i++) out.push(day[i]);
  }
  return out;
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

// ── Class recurring-event lifecycle (master + per-occurrence exceptions) ────
// One Google Calendar recurring event per active activity class; the class
// stores its `gcalSeriesEventId`. Members see the standing schedule as a
// single recurring entry on their phones. Per-occurrence cancellations and
// overrides are GCal exception PATCHes paired with local `activities`
// tombstone/override rows so the daily log + the calendar stay in sync.

function syncClassRecurringEvent_(cls) {
  if (!cls) return '';
  var calId  = cls.calendarId || '';
  var syncOn = cls.calendarSyncActive === true || cls.calendarSyncActive === 'true';
  var bs     = cls.bulkSchedule || null;
  var days   = (bs && Array.isArray(bs.daysOfWeek))
    ? bs.daysOfWeek.map(Number).filter(function(n){ return n >= 0 && n <= 6; })
    : [];
  var startT = (bs && bs.startTime) || cls.defaultStart || '';
  var endT   = (bs && bs.endTime)   || cls.defaultEnd   || '';
  var fromDate = (bs && bs.fromDate) || '';
  var toDate   = (bs && bs.toDate)   || '';
  var active   = cls.active !== false && cls.active !== 'false';
  var canSync  = active && calId && syncOn && bs && days.length && startT && endT && fromDate;
  if (!canSync) {
    // Tear down any master event the class no longer warrants — deactivated,
    // schedule cleared, calendar sync turned off, or required fields missing.
    if (cls.gcalSeriesEventId && calId) {
      try { Calendar.Events.remove(calId, cls.gcalSeriesEventId); } catch (e) {}
    }
    return '';
  }
  var firstDate = _firstClassOccurrenceDate_(fromDate, days);
  if (!firstDate) return '';
  var resource = {
    summary:     cls.nameIS || cls.name || 'Activity',
    description: cls.classTag ? '[' + cls.classTag + ']' : '',
    start: { dateTime: firstDate + 'T' + startT + ':00', timeZone: getSheetTz_() },
    end:   { dateTime: firstDate + 'T' + endT   + ':00', timeZone: getSheetTz_() },
    recurrence: [_buildClassRRule_(days, toDate)],
  };
  try {
    if (cls.gcalSeriesEventId) {
      var updated = Calendar.Events.update(resource, calId, cls.gcalSeriesEventId);
      return updated.id;
    }
    var created = Calendar.Events.insert(resource, calId);
    return created.id;
  } catch (e) {
    Logger.log('syncClassRecurringEvent_ failed: ' + e);
    return cls.gcalSeriesEventId || '';
  }
}

// Find the first day on/after fromDateISO whose weekday is in dowList.
// fromDateISO is a YYYY-MM-DD string; dowList is JS getDay() values
// (0=Sun..6=Sat). Returns ISO YYYY-MM-DD or '' if none in the next 7 days.
function _firstClassOccurrenceDate_(fromDateISO, dowList) {
  if (!fromDateISO || !dowList.length) return '';
  var d = new Date(fromDateISO + 'T12:00:00');
  for (var i = 0; i < 7; i++) {
    if (dowList.indexOf(d.getDay()) !== -1) {
      var y = d.getFullYear(), mo = d.getMonth() + 1, da = d.getDate();
      return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (da < 10 ? '0' : '') + da;
    }
    d.setDate(d.getDate() + 1);
  }
  return '';
}

function _buildClassRRule_(dowList, toDateISO) {
  var byDay = ['SU','MO','TU','WE','TH','FR','SA'];
  var days = dowList.map(function(n){ return byDay[n]; }).join(',');
  var rule = 'RRULE:FREQ=WEEKLY;BYDAY=' + days;
  if (toDateISO) {
    rule += ';UNTIL=' + toDateISO.replace(/-/g, '') + 'T235959Z';
  }
  return rule;
}

// Cancel one occurrence of a class on a given date. Writes a local tombstone
// row so the projection skips that date AND PATCHes the GCal master's
// instance to status='cancelled' so members' calendars reflect it. Both
// sides need the record to stay in sync — pure-GCal cancellation would leave
// the daily log still showing the activity.
function cancelClassOccurrence_(b) {
  if (!b || !b.classId || !b.date) return failJ('classId and date required');
  var classId = String(b.classId);
  var dateISO = String(b.date).slice(0, 10);
  var cls = _activityClassById_(classId);
  // 1. Local tombstone — projection's `sched-{classId}-{date}` virtual is
  //    suppressed by getSlots/projectActivitiesForDate when a real row with
  //    the same id exists. A status=cancelled row carries the suppression
  //    plus history.
  activity_upsert_({
    id:                   'sched-' + classId + '-' + dateISO,
    signupRequired:       false,
    status:               'cancelled',
    sourceActivityTypeId: classId,
    activityTypeId:       classId,
    date:                 dateISO,
    title:                cls ? (cls.name   || '') : '',
    titleIS:              cls ? (cls.nameIS || '') : '',
    updatedBy:            b.updatedBy || '',
  });
  // 2. GCal exception — PATCH the matching instance.
  if (cls && cls.calendarId && cls.gcalSeriesEventId) {
    try {
      var startTime = (cls.bulkSchedule && cls.bulkSchedule.startTime)
                   || cls.defaultStart || '00:00';
      _patchGcalInstanceStatus_(cls.calendarId, cls.gcalSeriesEventId,
                                dateISO, startTime, 'cancelled');
    } catch (e) { Logger.log('cancelClassOccurrence_ gcal: ' + e); }
  }
  cDel_('config');
  return okJ({ cancelled: true });
}

function _patchGcalInstanceStatus_(calId, seriesId, dateISO, startTime, newStatus) {
  var instance = _findGcalInstance_(calId, seriesId, dateISO, startTime);
  if (!instance) return;
  instance.status = newStatus;
  Calendar.Events.update(instance, calId, instance.id);
}

function _patchGcalInstanceTime_(calId, seriesId, dateISO, oldStart, newStart, newEnd) {
  var instance = _findGcalInstance_(calId, seriesId, dateISO, oldStart);
  if (!instance) return;
  instance.start = { dateTime: dateISO + 'T' + newStart + ':00', timeZone: getSheetTz_() };
  instance.end   = { dateTime: dateISO + 'T' + newEnd   + ':00', timeZone: getSheetTz_() };
  // If the instance was previously cancelled (e.g., overriding a restore-
  // and-shift in one step), make sure it's confirmed too.
  instance.status = 'confirmed';
  Calendar.Events.update(instance, calId, instance.id);
}

// Search for the instance whose start lands within ±1h of the expected start.
// The window covers DST transitions and any local-vs-script TZ skew without
// falsely matching neighbouring occurrences (the recurring pattern is at
// least 24h apart). Returns null if no instance is found.
function _findGcalInstance_(calId, seriesId, dateISO, startTime) {
  var startMs = new Date(dateISO + 'T' + (startTime || '00:00') + ':00').getTime();
  var window = 60 * 60 * 1000;
  var resp = Calendar.Events.instances(calId, seriesId, {
    timeMin: new Date(startMs - window).toISOString(),
    timeMax: new Date(startMs + window).toISOString(),
    showDeleted: true,
  });
  if (!resp || !resp.items || !resp.items.length) return null;
  return resp.items[0];
}

// Reschedule one occurrence to new times. Writes a status='upcoming' override
// row (same id as the projection's virtual, so it's preferred on read) and
// PATCHes the GCal master instance. If the date previously had a cancelled
// tombstone, the upsert flips status back to 'upcoming' and the GCal patch
// flips the instance back to 'confirmed' — so override doubles as restore.
function overrideClassOccurrence_(b) {
  if (!b || !b.classId || !b.date) return failJ('classId and date required');
  if (!b.startTime || !b.endTime) return failJ('startTime and endTime required');
  var classId = String(b.classId);
  var dateISO = String(b.date).slice(0, 10);
  var newStart = String(b.startTime).slice(0, 5);
  var newEnd   = String(b.endTime).slice(0, 5);
  if (newEnd <= newStart) return failJ('endTime must be after startTime');
  var cls = _activityClassById_(classId);
  activity_upsert_({
    id:                   'sched-' + classId + '-' + dateISO,
    signupRequired:       false,
    status:               'upcoming',
    sourceActivityTypeId: classId,
    activityTypeId:       classId,
    date:                 dateISO,
    startTime:            newStart,
    endTime:              newEnd,
    title:                cls ? (cls.name   || '') : '',
    titleIS:              cls ? (cls.nameIS || '') : '',
    updatedBy:            b.updatedBy || '',
  });
  if (cls && cls.calendarId && cls.gcalSeriesEventId) {
    try {
      var origStart = (cls.bulkSchedule && cls.bulkSchedule.startTime)
                   || cls.defaultStart || '00:00';
      _patchGcalInstanceTime_(cls.calendarId, cls.gcalSeriesEventId,
                              dateISO, origStart, newStart, newEnd);
    } catch (e) { Logger.log('overrideClassOccurrence_ gcal: ' + e); }
  }
  cDel_('config');
  return okJ({ overridden: true });
}

// Undo a previous cancellation: drop the local tombstone so the projection
// re-emits the virtual, and flip the GCal instance back to 'confirmed'.
function restoreClassOccurrence_(b) {
  if (!b || !b.classId || !b.date) return failJ('classId and date required');
  var classId = String(b.classId);
  var dateISO = String(b.date).slice(0, 10);
  var tombId  = 'sched-' + classId + '-' + dateISO;
  // Only act if the row is actually a cancelled tombstone — don't blow away
  // an override row that happens to share the deterministic id.
  var existing = activity_getById_(tombId);
  if (existing && existing.status === 'cancelled') {
    activity_hardDelete_(tombId);
  }
  var cls = _activityClassById_(classId);
  if (cls && cls.calendarId && cls.gcalSeriesEventId) {
    try {
      var startTime = (cls.bulkSchedule && cls.bulkSchedule.startTime)
                   || cls.defaultStart || '00:00';
      _patchGcalInstanceStatus_(cls.calendarId, cls.gcalSeriesEventId,
                                dateISO, startTime, 'confirmed');
    } catch (e) { Logger.log('restoreClassOccurrence_ gcal: ' + e); }
  }
  cDel_('config');
  return okJ({ restored: true });
}

function _activityClassById_(id) {
  try {
    var arr = JSON.parse(getConfigValue_('activity_templates', getConfigMap_()) || '[]');
    return arr.find(function(c) { return c && c.id === id; }) || null;
  } catch (e) { return null; }
}

// ── Single-event GCal upsert helper ──────────────────────────────────────────
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
// Preset class-tag values carry an Icelandic translation so GCal exports
// (which Icelandic members consume natively) render in IS even when the
// admin who saved the class authored it in English. Custom tags fall through.
var CLASS_TAG_LABELS_IS_ = {
  'Lesson':      'Kennsla',
  'Race':        'Keppni',
  'Training':    'Þjálfun',
  'Club event':  'Félagsviðburður',
  'Maintenance': 'Viðhald',
  'Meeting':     'Fundur',
  'Social':      'Samvera',
  'Other':       'Annað',
};
function classTagLabelIS_(cls) {
  if (!cls) return '';
  if (cls.classTagIS) return cls.classTagIS;
  if (CLASS_TAG_LABELS_IS_[cls.classTag]) return CLASS_TAG_LABELS_IS_[cls.classTag];
  return cls.classTag || '';
}

function syncDailyLogActivities_(date, oldActs, newActs) {
  try {
    var cfgMap = getConfigMap_();
    var types = [];
    try { types = JSON.parse(getConfigValue_('activity_templates', cfgMap) || '[]'); } catch (e) {}
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
      // If the class has a recurring master event AND this activity's id
      // matches the projection's deterministic shape, the master already
      // covers this occurrence on the calendar — overrides PATCH the
      // master's instance, not a separate per-row event. Skip the
      // standalone sync to avoid duplicate calendar entries.
      if (t.gcalSeriesEventId && String(a.id || '').indexOf('sched-' + t.id + '-') === 0) {
        if (prevId) {
          // Clean up any orphan standalone event from the pre-master era.
          gcalUpsertEvent_(t.calendarId, prevId, '', null, null, '', 'delete');
          a.gcalEventId = '';
        }
        return;
      }
      var start = gcalParseDateTime_(date, a.start || '00:00');
      var end = gcalParseDateTime_(date, a.end || a.start || '00:00');
      if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
      var classLabel = t.nameIS || t.name || '';
      var tagLabel   = classTagLabelIS_(t);
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

// ── Calendar-sourced scheduling ──────────────────────────────────────────────
// When an activity class sets scheduleSource='calendar' and points at a
// calendarId, daily-log projections for that class come from Google Calendar
// instead of the class's bulkSchedule. Each calendar event becomes a
// scheduled activity named after the event title. Results are cached briefly
// (CacheService) to avoid hammering the Calendar API on every getDailyLog.
function projectActivitiesFromCalendar_(cls, dateISO) {
  if (!cls || !cls.calendarId || !dateISO) return [];
  var cacheKey = 'gcal_activity_' + cls.calendarId + '_' + dateISO;
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache) {
    var cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
  }
  var out = [];
  try {
    var cal = CalendarApp.getCalendarById(cls.calendarId);
    if (!cal) return [];
    var start = new Date(dateISO + 'T00:00:00');
    var end   = new Date(dateISO + 'T23:59:59');
    var events = cal.getEvents(start, end) || [];
    events.forEach(function (ev) {
      try {
        if (ev.isAllDayEvent && ev.isAllDayEvent()) return; // skip all-day blockers
        var s = ev.getStartTime();
        var e = ev.getEndTime();
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        var fmt = function (d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
        // Stable id: hash the GCal event id into the sched- namespace so the
        // frontend treats the row like any other scheduled activity.
        var rawId = String(ev.getId() || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
        out.push({
          id:              'gcal-' + cls.id + '-' + rawId + '-' + dateISO,
          activityTypeId:  cls.id,
          classTag:        cls.classTag   || '',
          classTagIS:      cls.classTagIS || '',
          name:            ev.getTitle() || cls.name || '',
          start:           fmt(s),
          end:             fmt(e),
          participants:    '',
          notes:           ev.getDescription ? (ev.getDescription() || '') : '',
          leaderMemberId:  cls.leaderMemberId || '',
          leaderName:      cls.leaderName || '',
          leaderPhone:     cls.leaderPhone || '',
          showLeaderPhone: cls.showLeaderPhone === true || cls.showLeaderPhone === 'true',
          scheduled:       true,
          gcalEventId:     ev.getId(),
        });
      } catch (e) { /* skip bad event */ }
    });
    if (cache) {
      try { cache.put(cacheKey, JSON.stringify(out), 300); } catch (e) {}
    }
  } catch (e) {
    Logger.log('projectActivitiesFromCalendar_ failed: ' + e);
  }
  return out;
}

// ── Volunteer event → Google Calendar sync ───────────────────────────────────
// Mirrors syncDailyLogActivities_ but operates on a single volunteer event row
// in config key 'volunteer_events'. Persists the assigned gcalEventId back to
// config so subsequent upserts are idempotent. Never throws — fails silently
// so volunteer signup/save flows aren't blocked on a calendar outage.
function syncVolunteerEventToCalendar_(eventId) {
  try {
    if (!eventId) return;
    var ev = activity_getById_(eventId);
    if (!ev || !ev.signupRequired) return;
    var cfgMap = getConfigMap_();
    var types = [];
    try { types = JSON.parse(getConfigValue_('activity_templates', cfgMap) || '[]'); } catch (e) {}
    var atId = ev.activityTypeId || ev.sourceActivityTypeId || '';
    var at = null;
    for (var j = 0; j < types.length; j++) {
      if (types[j] && types[j].id === atId) { at = types[j]; break; }
    }
    // Resolve the destination calendar. Per-event override wins when the
    // event has its own calendarSyncActive=true + calendarId set; otherwise
    // fall through to the parent activity-type's calendarId (existing
    // behavior — pre-feature events with no per-event calendarId stay
    // synced via their parent type).
    var calId = '';
    var enabled = false;
    if (ev.calendarSyncActive && ev.calendarId) {
      calId = ev.calendarId;
      enabled = true;
    } else if (at && at.calendarId) {
      var atEnabled = at.calendarSyncActive === true || at.calendarSyncActive === 'true';
      if (atEnabled) { calId = at.calendarId; enabled = true; }
    }
    if (!enabled || !calId) return;
    // If the parent class carries a recurring master event AND this volunteer
    // event is a bulk-projected occurrence (deterministic vae- id), the
    // master already covers it — skip the standalone sync to avoid double
    // entries. Manually-created volunteer events (no vae- prefix) still get
    // their own calendar entry as before. The skip only applies when the
    // event is inheriting the parent's calendar; per-event override wins.
    var inheritingFromParent = !(ev.calendarSyncActive && ev.calendarId);
    var bulkProjected = inheritingFromParent
      && at && at.gcalSeriesEventId
      && String(ev.id || '').indexOf('vae-' + at.id + '-') === 0;
    if (bulkProjected) {
      if (ev.gcalEventId) {
        gcalUpsertEvent_(calId, ev.gcalEventId, '', null, null, '', 'delete');
        activity_upsert_({ id: ev.id, gcalEventId: '' });
        cDel_('config');
      }
      return;
    }
    // Cancelled/orphaned events lose their calendar entry.
    if (ev.status === 'cancelled' || ev.status === 'orphaned') {
      if (ev.gcalEventId) {
        gcalUpsertEvent_(calId, ev.gcalEventId, '', null, null, '', 'delete');
        activity_upsert_({ id: ev.id, gcalEventId: '' });
        cDel_('config');
      }
      return;
    }
    var start = gcalParseDateTime_(ev.date, ev.startTime || '00:00');
    var end   = gcalParseDateTime_(ev.endDate || ev.date, ev.endTime || ev.startTime || '00:00');
    if (end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
    var typeLabel = at ? (at.nameIS || at.name || '') : '';
    var titleBase = ev.title || typeLabel;
    var title = titleBase + (typeLabel && titleBase !== typeLabel ? ' (' + typeLabel + ')' : '');
    var roleLines = (Array.isArray(ev.roles) ? ev.roles : []).map(function (r) {
      return '• ' + (r.name || '') + (r.slots ? (' (' + r.slots + ')') : '');
    }).join('\n');
    var desc = 'volunteer-event:' + ev.id
      + (ev.leaderName ? ('\nLeader: ' + ev.leaderName) : '')
      + (ev.notes ? ('\n' + ev.notes) : '')
      + (roleLines ? ('\n\nRoles:\n' + roleLines) : '');
    var newId = gcalUpsertEvent_(calId, ev.gcalEventId || '', title, start, end, desc, 'upsert');
    if (newId && newId !== (ev.gcalEventId || '')) {
      activity_upsert_({ id: ev.id, gcalEventId: newId });
      cDel_('config');
    }
  } catch (e) { Logger.log('syncVolunteerEventToCalendar_ failed: ' + e); }
}

// Delete the calendar event for a volunteer event that's about to be (or has
// been) removed. Takes the event row itself because it may already be gone
// from config. Looks up the parent activity type's calendarId to find the
// right calendar.
function deleteVolunteerEventCalendarEvent_(evRow) {
  try {
    if (!evRow || !evRow.gcalEventId) return;
    // Per-event override wins when set; otherwise look up the parent
    // activity type's calendarId — the same precedence as
    // syncVolunteerEventToCalendar_ so the right calendar is targeted.
    var calId = (evRow.calendarSyncActive && evRow.calendarId) ? evRow.calendarId : '';
    if (!calId) {
      var atId = evRow.activityTypeId || evRow.sourceActivityTypeId || '';
      if (!atId) return;
      var types = [];
      try { types = JSON.parse(getConfigSheetValue_('activity_templates') || '[]'); } catch (e) {}
      for (var i = 0; i < types.length; i++) {
        if (types[i] && types[i].id === atId && types[i].calendarId) {
          calId = types[i].calendarId;
          break;
        }
      }
    }
    if (!calId) return;
    gcalUpsertEvent_(calId, evRow.gcalEventId, '', null, null, '', 'delete');
  } catch (e) { Logger.log('deleteVolunteerEventCalendarEvent_ failed: ' + e); }
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
  // Virtual slots (vslot-*) are projected from an activity class's reserved
  // boats + schedule. The captain/crew booking IS what fills the activity:
  // materialize a real reservationSlots row carrying sourceActivityClassId
  // so the projection stops emitting the virtual on subsequent reads, then
  // fall through to the normal book flow against the new id.
  if (String(b.slotId).indexOf('vslot-') === 0) {
    var dateISO = String(b.slotId).slice(-10);
    var projected = projectSlotsForDate_(dateISO);
    var virt = null;
    for (var pi = 0; pi < projected.length; pi++) {
      if (projected[pi].id === b.slotId) { virt = projected[pi]; break; }
    }
    if (!virt) return failJ('Virtual slot no longer scheduled');
    addColIfMissing_('reservationSlots', 'sourceActivityClassId');
    var newId = uid_();
    insertRow_('reservationSlots', {
      id:                    newId,
      boatId:                virt.boatId,
      date:                  virt.date,
      startTime:             virt.startTime,
      endTime:               virt.endTime,
      recurrenceGroupId:     '',
      bookedByKennitala:     '',
      bookedByName:          '',
      bookedByCrewId:        '',
      bookingColor:          '',
      note:                  '',
      createdAt:             now_(),
      sourceActivityClassId: virt.sourceActivityClassId,
    });
    b.slotId = newId;
  }
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
  if (String(b.slotId).indexOf('vslot-') === 0) {
    return failJ('Virtual class slot — nothing to unbook');
  }
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
  // Class-slot bookings (materialized from a virtual): delete the row so the
  // projection takes back over and the virtual reappears for the next
  // captain/crew. Regular slots just clear the booker fields.
  if (slot.sourceActivityClassId) {
    syncSlotToCalendar_(b.slotId, 'delete');
    deleteRow_('reservationSlots', 'id', b.slotId);
    return okJ({ unbooked: true, dematerialized: true });
  }
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


