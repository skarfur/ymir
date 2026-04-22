// ═══════════════════════════════════════════════════════════════════════════════
// TRIPS
// ═══════════════════════════════════════════════════════════════════════════════

function getTrips_(kennitala, limit, p) {
  p = p || {};
  const all = readAll_('trips');
  const filtered = all.filter(t => (!kennitala || String(t.kennitala) === String(kennitala)) && (!p.date || (t.date || '').slice(0, 10) === p.date) && (!p.linkedCheckoutId || String(t.linkedCheckoutId) === String(p.linkedCheckoutId)) && (!p.category || (t.boatCategory || '').toLowerCase() === p.category.toLowerCase()));
  const sorted = filtered.sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);
  const offset = parseInt(p.offset) || 0;
  const lim    = limit || 100;
  const page   = sorted.slice(offset, offset + lim);
  return okJ({ trips: page, total: sorted.length, offset: offset, limit: lim });
}

function saveTrip_(b) {
  const ts = now_();

  // UPDATE path — patch only supplied fields, never ghost-insert on verify/unverify
  if (b.id && findOne_('trips', 'id', b.id)) {
    const updates = { updatedAt: ts };
    const UPDATABLE = [
      'kennitala','memberName','date','timeOut','timeIn','hoursDecimal',
      'boatId','boatName','boatCategory','locationId','locationName',
      'crew','role','beaufort','windDir','wxSnapshot','notes',
      'isLinked','linkedCheckoutId','linkedTripId',
      'verified','verifiedBy','verifiedAt','staffComment',
      'validationRequested','helm','student','skipperNote',
      'distanceNm','departurePort','arrivalPort',
      'trackFileUrl','trackSimplified','trackSource',
      'photoUrls','photoMeta','crewNames','nonClub',
    ];
    UPDATABLE.forEach(k => { if (b[k] !== undefined) updates[k] = b[k]; });
    updateRow_('trips', 'id', b.id, updates);
    return okJ({ id: b.id, updated: true });
  }

  // INSERT path
  const id = uid_();
  let boatCategory = b.boatCategory || '';
  if (!boatCategory && b.boatId) {
    try {
      const boat = getBoatMap_()[b.boatId];
      if (boat) boatCategory = boat.category || '';
    } catch (e) {}
  }
  insertRow_('trips', {
    id, kennitala: b.kennitala || '', memberName: b.memberName || '',
    date: b.date || nowLocalDate_(), timeOut: b.timeOut || '', timeIn: b.timeIn || '',
    hoursDecimal: b.hoursDecimal || 0,
    boatId: b.boatId || '', boatName: b.boatName || '', boatCategory: boatCategory,
    locationId: b.locationId || '', locationName: b.locationName || '',
    crew: b.crew || 1, role: b.role || 'skipper',
    beaufort: b.beaufort || '', windDir: b.windDir || '', wxSnapshot: b.wxSnapshot || '',
    notes: b.notes || '', isLinked: b.isLinked || false,
    linkedCheckoutId: b.linkedCheckoutId || '', linkedTripId: b.linkedTripId || '',
    verified: false, verifiedBy: '', verifiedAt: '', staffComment: '',
    validationRequested: b.validationRequested || false, helm: b.helm || false, student: b.student || false,
    skipperNote: b.skipperNote || '',
    distanceNm: b.distanceNm || '', departurePort: b.departurePort || '', arrivalPort: b.arrivalPort || '',
    nonClub: b.nonClub || false,
    trackFileUrl: b.trackFileUrl || '', trackSimplified: b.trackSimplified || '', trackSource: b.trackSource || '',
    photoUrls: b.photoUrls || '', photoMeta: b.photoMeta || '',
    crewNames: b.crewNames || '',
    createdAt: ts,
  });
  return okJ({ id, created: true });
}

function setHelm_(b) {
  if (!b.tripId) return failJ('tripId required');
  updateRow_('trips', 'id', b.tripId, { helm: !!b.helm, updatedAt: now_() });
  return okJ({ updated: true });
}

function deleteTrip_(id) {
  if (!id) return failJ('id required');
  return okJ({ deleted: deleteRow_('trips', 'id', id) });
}

function requestValidation_(b) {
  if (!b.tripId) return failJ('tripId required');
  updateRow_('trips', 'id', b.tripId, { validationRequested: true });
  return okJ({ requested: true });
}


// ═══════════════════════════════════════════════════════════════════════════════
// TRIP CONFIRMATIONS (handshake protocol)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Types:
//   'crew_assigned'  — skipper assigned a crew member → crew must confirm
//   'crew_join'      — member wants to join a trip    → skipper must confirm
//   'helm'           — helm toggle requested          → other party confirms
//   'student'        — skipper marks crew as student  → crew must confirm
//   'verify'         — member requests trip verification → any staff confirms
//
// Status: 'pending' | 'confirmed' | 'rejected'
// ═══════════════════════════════════════════════════════════════════════════════

function ensureConfirmationCols_() {
  var cols = [
    'id','type','status',
    'fromKennitala','fromName',
    'toKennitala','toName',
    'tripId','linkedCheckoutId',
    'boatId','boatName','boatCategory',
    'locationId','locationName',
    'date','timeOut','timeIn','hoursDecimal',
    'role','helm','crew','skipperNote',
    'beaufort','windDir','wxSnapshot',
    'rejectComment',
    'createdAt','respondedAt',
  ];
  cols.forEach(function(c) { addColIfMissing_('tripConfirmations', c); });
}

function getConfirmations_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  var kt = String(b.kennitala);
  var all;
  try { all = readAll_('tripConfirmations'); } catch(e) { all = []; }
  var incoming = all.filter(function(r) { return String(r.toKennitala) === kt && !r.dismissed; });
  var outgoing = all.filter(function(r) { return String(r.fromKennitala) === kt && !r.dismissed; });
  return okJ({ incoming: incoming, outgoing: outgoing });
}

function createConfirmation_(b) {
  ensureConfirmationCols_();
  if (!b.type) return failJ('type required');
  if (!b.toKennitala) return failJ('toKennitala required');
  var ts = now_(), id = uid_();
  insertRow_('tripConfirmations', {
    id: id, type: b.type || '', status: 'pending',
    fromKennitala: b.fromKennitala || '', fromName: b.fromName || '',
    toKennitala: b.toKennitala || '', toName: b.toName || '',
    tripId: b.tripId || '', linkedCheckoutId: b.linkedCheckoutId || '',
    boatId: b.boatId || '', boatName: b.boatName || '', boatCategory: b.boatCategory || '',
    locationId: b.locationId || '', locationName: b.locationName || '',
    date: b.date || '', timeOut: b.timeOut || '', timeIn: b.timeIn || '',
    hoursDecimal: b.hoursDecimal || '',
    role: b.role || '', helm: b.helm || false,
    crew: b.crew || 1, skipperNote: b.skipperNote || '',
    beaufort: b.beaufort || '', windDir: b.windDir || '', wxSnapshot: b.wxSnapshot || '',
    rejectComment: '',
    createdAt: ts, respondedAt: '',
  });
  return okJ({ id: id, created: true });
}

function respondConfirmation_(b) {
  if (!b.id) return failJ('id required');
  if (!b.response || (b.response !== 'confirmed' && b.response !== 'rejected'))
    return failJ('response must be confirmed or rejected');
  var row = findOne_('tripConfirmations', 'id', b.id);
  if (!row) return failJ('Confirmation not found', 404);
  if (row.status !== 'pending') return failJ('Already responded');

  var ts = now_();
  var updates = { status: b.response, respondedAt: ts };
  if (b.response === 'rejected' && b.rejectComment) updates.rejectComment = b.rejectComment;
  updateRow_('tripConfirmations', 'id', b.id, updates);

  // On reject — undo any speculative state recorded by the skipper
  if (b.response === 'rejected') {
    applyRejectionCleanup_(row, ts);
    return okJ({ updated: true, status: b.response });
  }

  // On confirm — create the trip record
  if (b.response === 'confirmed') {
    var type = row.type;
    if (type === 'crew_assigned' || type === 'crew_join') {
      // Determine who the crew member is
      var crewKt, crewName, role;
      if (type === 'crew_assigned') {
        // Skipper assigned crew → the "to" person is the crew member
        crewKt = row.toKennitala; crewName = row.toName; role = 'crew';
      } else {
        // Member asked to join → the "from" person is the crew member
        crewKt = row.fromKennitala; crewName = row.fromName; role = 'crew';
      }
      // Check if trip already exists for this member + checkout
      var existing = readAll_('trips').filter(function(t) {
        return String(t.kennitala) === String(crewKt) &&
          (row.linkedCheckoutId ? String(t.linkedCheckoutId) === String(row.linkedCheckoutId) :
           String(t.linkedTripId) === String(row.tripId));
      });
      if (!existing.length) {
        // Get crew count, skipper note, and crewNames from the original trip
        var origCrew = row.crew || 1, origSkipperNote = row.skipperNote || '', origCrewNames = '';
        var origDistNm = '', origDepPort = '', origArrPort = '';
        if (row.tripId) {
          var origTrip = findOne_('trips', 'id', row.tripId);
          if (origTrip) {
            if (origCrew <= 1) origCrew = origTrip.crew || 1;
            if (!origSkipperNote) origSkipperNote = origTrip.skipperNote || '';
            origCrewNames = origTrip.crewNames || '';
            origDistNm = origTrip.distanceNm || '';
            origDepPort = origTrip.departurePort || '';
            origArrPort = origTrip.arrivalPort || '';
          }
        }
        var tripId = uid_();
        insertRow_('trips', {
          id: tripId, kennitala: crewKt, memberName: crewName,
          date: row.date || '', timeOut: row.timeOut || '', timeIn: row.timeIn || '',
          hoursDecimal: row.hoursDecimal || 0,
          boatId: row.boatId || '', boatName: row.boatName || '', boatCategory: row.boatCategory || '',
          locationId: row.locationId || '', locationName: row.locationName || '',
          crew: origCrew, role: role,
          beaufort: row.beaufort || '', windDir: row.windDir || '', wxSnapshot: row.wxSnapshot || '',
          notes: '', skipperNote: origSkipperNote, isLinked: true,
          linkedCheckoutId: row.linkedCheckoutId || '', linkedTripId: row.tripId || '',
          verified: false, verifiedBy: '', verifiedAt: '', staffComment: '',
          validationRequested: false, helm: false,
          distanceNm: origDistNm, departurePort: origDepPort, arrivalPort: origArrPort,
          trackFileUrl: '', trackSimplified: '', trackSource: '', photoUrls: '',
          crewNames: origCrewNames,
          createdAt: ts,
        });
      }
      // For crew_join: the skipper hadn't planned for this person, so the
      // skipper's original trip crew count may need to be bumped up so that
      // total crew never drops below the number of named/linked crew members.
      if (type === 'crew_join' && row.tripId) {
        var origSkipTrip = findOne_('trips', 'id', row.tripId);
        if (origSkipTrip) {
          var linkedCrewCount = readAll_('trips').filter(function(t) {
            return String(t.id) !== String(origSkipTrip.id) && (
              String(t.linkedTripId) === String(origSkipTrip.id) ||
              (row.linkedCheckoutId && String(t.linkedCheckoutId) === String(row.linkedCheckoutId))
            );
          }).length;
          var neededCrew = linkedCrewCount + 1; // +1 for the skipper
          var curCrew = parseInt(origSkipTrip.crew) || 1;
          if (curCrew < neededCrew) {
            updateRow_('trips', 'id', origSkipTrip.id, { crew: neededCrew, updatedAt: ts });
          }
        }
      }
    }
    if (type === 'helm') {
      // Set helm on the crew member's trip (by tripId or kennitala+checkout)
      if (row.tripId) {
        updateRow_('trips', 'id', row.tripId, { helm: true, updatedAt: ts });
      } else {
        var helmKt = row.toKennitala;
        var helmCoId = row.linkedCheckoutId;
        if (helmKt && helmCoId) {
          var helmTrips = readAll_('trips').filter(function(t) {
            return String(t.kennitala) === String(helmKt) && String(t.linkedCheckoutId) === String(helmCoId);
          });
          helmTrips.forEach(function(t) {
            updateRow_('trips', 'id', t.id, { helm: true, updatedAt: ts });
          });
        }
      }
    }
    if (type === 'student') {
      // Set student flag on the crew member's trip for this checkout
      var stuKt = row.toKennitala;
      var coId = row.linkedCheckoutId;
      if (stuKt && coId) {
        addColIfMissing_('trips', 'student');
        var stuTrips = readAll_('trips').filter(function(t) {
          return String(t.kennitala) === String(stuKt) && String(t.linkedCheckoutId) === String(coId);
        });
        stuTrips.forEach(function(t) {
          updateRow_('trips', 'id', t.id, { student: true, updatedAt: ts });
        });
      }
    }
    if (type === 'verify') {
      // Staff confirmed a verification request — mark trip as verified
      var verifyTripId = row.tripId;
      if (verifyTripId) {
        updateRow_('trips', 'id', verifyTripId, {
          verified: true, verifiedBy: b.responderName || row.toName || '', verifiedAt: ts, updatedAt: ts
        });
      }
    }

    // Auto-verify: when a crew/helm/student handshake is confirmed, check if the
    // trip's skipper is a keelboat captain and ALL handshakes for that checkout/trip
    // are now resolved — if so, mark all linked trips as verified automatically.
    if (type === 'crew_assigned' || type === 'crew_join' || type === 'helm' || type === 'student') {
      tryAutoVerify_(row, ts);
    }
  }
  return okJ({ updated: true, status: b.response });
}

// ── Auto-verify: keelboat-captain trips where all handshakes are resolved ────
function tryAutoVerify_(conf, ts) {
  // Find the skipper's trip via tripId or linkedCheckoutId
  var tripId = conf.tripId, coId = conf.linkedCheckoutId;
  var skipperTrip = tripId ? findOne_('trips', 'id', tripId) : null;
  if (!skipperTrip && coId) {
    var coTrips = readAll_('trips').filter(function(t) {
      return String(t.linkedCheckoutId) === String(coId) && (t.role === 'skipper' || t.role === 'captain');
    });
    skipperTrip = coTrips[0] || null;
  }
  if (!skipperTrip) return;

  // Check if the skipper is a keelboat division captain
  var member = findOne_('members', 'kennitala', String(skipperTrip.kennitala));
  if (!member) return;
  var certs = [];
  try { certs = JSON.parse(member.certifications || '[]'); } catch (e) { return; }
  var isCaptain = certs.some(function(c) {
    return c.sub === 'captain';
  });
  if (!isCaptain) return;

  // Check if boat is a keelboat
  var boatCat = (skipperTrip.boatCategory || '').toLowerCase();
  if (boatCat !== 'keelboat') return;

  // Check ALL confirmations for this trip/checkout are resolved (none pending)
  var lookupId = coId || tripId;
  var allConfs;
  try { allConfs = readAll_('tripConfirmations'); } catch (e) { return; }
  var related = allConfs.filter(function(c) {
    return (coId && String(c.linkedCheckoutId) === String(coId)) ||
           (tripId && String(c.tripId) === String(tripId));
  });
  var hasPending = related.some(function(c) { return c.status === 'pending'; });
  if (hasPending) return;

  // All resolved — auto-verify skipper trip + all linked crew trips
  var allTrips = readAll_('trips');
  var linkedTrips = allTrips.filter(function(t) {
    return String(t.id) === String(skipperTrip.id) ||
      (coId && String(t.linkedCheckoutId) === String(coId)) ||
      (String(t.linkedTripId) === String(skipperTrip.id));
  });
  linkedTrips.forEach(function(t) {
    if (!t.verified || t.verified === 'false') {
      updateRow_('trips', 'id', t.id, {
        verified: true, verifiedBy: '(auto)', verifiedAt: ts, updatedAt: ts
      });
    }
  });
}

// ── Reject cleanup: roll back skipper-side state when a handshake is rejected
//
// helm     → clear the helm flag from the skipper's crewNames entry for the
//            rejecting member, and from the crew member's own trip row.
// student  → same, but for the student flag.
// crew_assigned → the rejecting member never agreed to come along: drop them
//            from the skipper's crewNames JSON and decrement the trip's crew
//            count (never below 1, and never below the number of remaining
//            named/linked crew members).  The rejection record itself stays
//            visible in the skipper's outgoing list so the skipper can review
//            and acknowledge the new "number on board" before it's dismissed.
// crew_join → the skipper said no to a join request: nothing to undo, since
//            no trip row was created yet.
// helm/student rejections silently roll back the metadata; nothing else for
// the skipper to confirm.
function applyRejectionCleanup_(row, ts) {
  var type = row.type;
  if (type === 'helm' || type === 'student') {
    var flag = type;          // 'helm' or 'student'
    var memberKt = row.toKennitala; // the rejecting crew member
    // 1) Clear the flag on the skipper's trip crewNames JSON
    var skipperTrip = findSkipperTripForConf_(row);
    if (skipperTrip) {
      clearCrewNamesFlag_(skipperTrip, memberKt, flag, ts);
    }
    // 2) Clear the flag on the crew member's own trip row, if one exists
    var crewTrips = findCrewMemberTrips_(memberKt, row);
    crewTrips.forEach(function(t) {
      if (t[flag] && String(t[flag]) !== 'false') {
        var u = { updatedAt: ts };
        u[flag] = false;
        updateRow_('trips', 'id', t.id, u);
      }
    });
    return;
  }

  if (type === 'crew_assigned') {
    // Skipper had added this person; they declined.  Pull them out of the
    // skipper's crewNames JSON and drop the crew count by one (within bounds).
    // The skipper's trip may not exist yet (rejection arrived before check-in)
    // — in that case, update the checkout row instead so the skipper sees the
    // adjusted count when they return.
    var rejectingKt = row.toKennitala;
    var skipperTrip2 = findSkipperTripForConf_(row);
    if (skipperTrip2) {
      // Count crew members that still have a linked trip row, so we never drop
      // the trip's crew count below the number of people actually on board.
      var linkedCrewCount = readAll_('trips').filter(function(t) {
        if (String(t.id) === String(skipperTrip2.id)) return false;
        return (String(t.linkedTripId) === String(skipperTrip2.id)) ||
          (skipperTrip2.linkedCheckoutId && String(t.linkedCheckoutId) === String(skipperTrip2.linkedCheckoutId));
      }).length;
      var minCrew = Math.max(1, linkedCrewCount + 1); // +1 for the skipper
      removeFromCrewNamesAndDecrement_('trips', skipperTrip2, rejectingKt, minCrew, ts);
    }
    if (row.linkedCheckoutId) {
      var co = findOne_('checkouts', 'id', row.linkedCheckoutId);
      if (co && (co.status === 'out' || !co.status)) {
        // Pre-checkin: bring the checkout row into sync as well.
        removeFromCrewNamesAndDecrement_('checkouts', co, rejectingKt, 1, ts);
      }
    }
    return;
  }

  // crew_join / verify rejection: nothing to roll back.
}

// Shared helper used by crew_assigned rejection cleanup: remove a crew member
// from a row's crewNames JSON and decrement its crew count (subject to a
// minimum so we never drop below the number of crew already on board).
function removeFromCrewNamesAndDecrement_(table, rowObj, rejectingKt, minCrew, ts) {
  var cn = parseCrewNames_(rowObj.crewNames);
  var nextCn = cn.filter(function(entry) {
    return !(entry.kennitala && String(entry.kennitala) === String(rejectingKt));
  });
  var changed = nextCn.length !== cn.length;
  var curCrew = parseInt(rowObj.crew) || 1;
  var newCrew = Math.max(minCrew || 1, curCrew - 1);
  var updates = {};
  if (changed) updates.crewNames = JSON.stringify(nextCn);
  if (newCrew !== curCrew) updates.crew = newCrew;
  if (table === 'trips' && (changed || newCrew !== curCrew)) updates.updatedAt = ts;
  if (Object.keys(updates).length) {
    updateRow_(table, 'id', rowObj.id, updates);
  }
}

// Find the skipper's trip row for a confirmation: prefer the explicit tripId
// (which always points at the skipper trip), then fall back to looking up the
// captain/skipper trip linked to the same checkout.
function findSkipperTripForConf_(row) {
  if (row.tripId) {
    var byId = findOne_('trips', 'id', row.tripId);
    if (byId) return byId;
  }
  if (row.linkedCheckoutId) {
    var coTrips = readAll_('trips').filter(function(t) {
      return String(t.linkedCheckoutId) === String(row.linkedCheckoutId) &&
        (t.role === 'skipper' || t.role === 'captain');
    });
    if (coTrips.length) return coTrips[0];
  }
  // crew_join: row.fromKennitala is the joiner, row.toKennitala is the skipper
  if (row.type === 'crew_join' && row.toKennitala) {
    var byKt = readAll_('trips').filter(function(t) {
      return String(t.kennitala) === String(row.toKennitala) &&
        (row.linkedCheckoutId ? String(t.linkedCheckoutId) === String(row.linkedCheckoutId)
                              : (row.tripId && String(t.id) === String(row.tripId)));
    });
    if (byKt.length) return byKt[0];
  }
  return null;
}

// Find any trip rows belonging to the rejecting crew member that are linked
// to the same checkout/trip as the confirmation.
function findCrewMemberTrips_(kt, row) {
  if (!kt) return [];
  return readAll_('trips').filter(function(t) {
    if (String(t.kennitala) !== String(kt)) return false;
    if (row.linkedCheckoutId && String(t.linkedCheckoutId) === String(row.linkedCheckoutId)) return true;
    if (row.tripId && String(t.linkedTripId) === String(row.tripId)) return true;
    return false;
  });
}

function parseCrewNames_(raw) {
  if (!raw) return [];
  if (typeof raw !== 'string') return Array.isArray(raw) ? raw : [];
  try { var p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}

// Clear a flag (helm/student) from the skipper's crewNames JSON entry that
// matches the given kennitala.  No-op if the entry isn't there or already false.
function clearCrewNamesFlag_(trip, kt, flag, ts) {
  if (!kt || !trip) return;
  var cn = parseCrewNames_(trip.crewNames);
  var changed = false;
  cn.forEach(function(entry) {
    if (entry.kennitala && String(entry.kennitala) === String(kt) && entry[flag]) {
      entry[flag] = false;
      changed = true;
    }
  });
  if (changed) {
    updateRow_('trips', 'id', trip.id, {
      crewNames: JSON.stringify(cn),
      updatedAt: ts,
    });
  }
}

// ── Request verification (creates a 'verify' handshake to staff) ────────────
function requestVerification_(b) {
  if (!b.tripId) return failJ('tripId required');
  var trip = findOne_('trips', 'id', b.tripId);
  if (!trip) return failJ('Trip not found', 404);
  if (trip.verified && trip.verified !== 'false') return failJ('Already verified');

  ensureConfirmationCols_();
  var ts = now_(), id = uid_();
  insertRow_('tripConfirmations', {
    id: id, type: 'verify', status: 'pending',
    fromKennitala: b.fromKennitala || trip.kennitala || '',
    fromName: b.fromName || trip.memberName || '',
    toKennitala: 'staff', toName: 'Staff',
    tripId: b.tripId, linkedCheckoutId: trip.linkedCheckoutId || '',
    boatId: trip.boatId || '', boatName: trip.boatName || '', boatCategory: trip.boatCategory || '',
    locationId: trip.locationId || '', locationName: trip.locationName || '',
    date: trip.date || '', timeOut: trip.timeOut || '', timeIn: trip.timeIn || '',
    hoursDecimal: trip.hoursDecimal || '',
    role: trip.role || '', helm: trip.helm || false,
    crew: trip.crew || 1, skipperNote: trip.skipperNote || '',
    beaufort: trip.beaufort || '', windDir: trip.windDir || '', wxSnapshot: trip.wxSnapshot || '',
    rejectComment: '',
    createdAt: ts, respondedAt: '',
  });
  return okJ({ id: id, created: true, requested: true });
}

// ── Get pending verification requests (for staff) ───────────────────────────
function getVerificationRequests_() {
  var all;
  try { all = readAll_('tripConfirmations'); } catch(e) { all = []; }
  var pending = all.filter(function(r) {
    return r.type === 'verify' && r.status === 'pending' && !r.dismissed;
  });
  return okJ({ requests: pending });
}

// ── Notification counts for member hub badges ────────────────────────────────
function getNotifications_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  ensureMaintCols_();
  var kt = String(b.kennitala);
  var counts = { confirmations: 0, crewInvites: 0, saumaklubbur: 0, captainQ: 0 };

  // Trip confirmations: pending incoming (non-verify) + captain pending (crew handshakes + verify)
  var allConf;
  try { allConf = readAll_('tripConfirmations'); } catch(e) { allConf = []; }
  var pendingIncoming = allConf.filter(function(r) {
    return String(r.toKennitala) === kt && r.status === 'pending' && !r.dismissed && r.type !== 'verify';
  });
  counts.confirmations = pendingIncoming.length;
  // Captain queue: crew handshakes directed at me + verify requests (for staff role, counted separately)
  var captainPending = allConf.filter(function(r) {
    return String(r.toKennitala) === kt && r.status === 'pending' && !r.dismissed;
  });
  counts.captainQ = captainPending.length;

  // Crew invites: pending invites directed at this user
  var allInv;
  try { allInv = readAll_('crewInvites'); } catch(e) { allInv = []; }
  counts.crewInvites = allInv.filter(function(inv) {
    return String(inv.toKennitala) === kt && inv.status === 'pending';
  }).length;

  // Saumaklubbur: unresolved unassigned projects + followed projects with updates since follow
  var allMaint;
  try { allMaint = readAll_('maintenance'); } catch(e) { allMaint = []; }
  var saumaCount = 0;
  allMaint.forEach(function(r) {
    if (!bool_(r.saumaklubbur) || bool_(r.resolved)) return;
    if (!bool_(r.approved)) return;
    // Unassigned projects needing verkstjóri
    if (!r.verkstjori) { saumaCount++; return; }
    // Followed projects with updates since follow
    var followers = [];
    try { followers = JSON.parse(r.followers || '[]'); } catch(e) { followers = []; }
    var myFollow = null;
    for (var i = 0; i < followers.length; i++) {
      if (String(followers[i].kt) === kt) { myFollow = followers[i]; break; }
    }
    if (myFollow && r.updatedAt && myFollow.at && r.updatedAt > myFollow.at) {
      saumaCount++;
    }
  });
  counts.saumaklubbur = saumaCount;

  return okJ({ counts: counts });
}

function dismissConfirmation_(b) {
  if (!b.id) return failJ('id required');
  var row = findOne_('tripConfirmations', 'id', b.id);
  if (!row) return failJ('Confirmation not found', 404);
  if (row.status === 'pending') return failJ('Cannot dismiss pending confirmations');
  updateRow_('tripConfirmations', 'id', b.id, { dismissed: true, dismissedAt: now_() });
  return okJ({ dismissed: true });
}

function dismissAllConfirmations_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  var kt = String(b.kennitala);
  var all;
  try { all = readAll_('tripConfirmations'); } catch(e) { all = []; }
  var toDismiss = all.filter(function(r) {
    return (String(r.toKennitala) === kt || String(r.fromKennitala) === kt)
      && r.status !== 'pending' && !r.dismissed;
  });
  toDismiss.forEach(function(r) {
    updateRow_('tripConfirmations', 'id', r.id, { dismissed: true, dismissedAt: now_() });
  });
  return okJ({ dismissed: toDismiss.length });
}


// ═══════════════════════════════════════════════════════════════════════════════
// TRIP FILE UPLOADS  (GPS tracks + photos → Google Drive)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Script Properties required:
//   DRIVE_FOLDER_ID_TRACKS — folder ID for raw GPX/KML/KMZ files
//   DRIVE_FOLDER_ID_PHOTOS — folder ID for trip photos
//
// If a property is not set the function returns ok:false so the frontend
// can warn the user and save the trip without the attachment.
// ═══════════════════════════════════════════════════════════════════════════════

function uploadTripFile_(b) {
  if (!b.fileType) return failJ('fileType required');
  if (b.fileType === 'track') return saveTripTrack_(b);
  if (b.fileType === 'photo') return saveTripPhoto_(b);
  return failJ('Unknown fileType: ' + b.fileType);
}

function saveTripTrack_(b) {
  if (!b.fileData) return failJ('fileData required');
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('DRIVE_FOLDER_ID_TRACKS');
  if (!folderId) return okJ({ ok: false, error: 'Drive folder not configured' });

  try {
    const ext = (b.fileName || 'track.gpx').split('.').pop().toLowerCase();
    const ts  = now_().replace(/[: ]/g, '-');
    const safeName = ts + '_' + (b.fileName || 'track.' + ext);

    let contentBytes = Utilities.base64Decode(b.fileData.replace(/^data:[^;]+;base64,/, ''));
    let parseFormat  = ext;

    // KMZ = zipped KML — decompress and extract .kml entry
    if (ext === 'kmz') {
      const blobs = Utilities.unzip(Utilities.newBlob(contentBytes, 'application/zip', safeName));
      const kmlBlob = blobs.find(bl => bl.getName().toLowerCase().endsWith('.kml'));
      if (!kmlBlob) return failJ('No .kml found inside KMZ');
      contentBytes = kmlBlob.getBytes();
      parseFormat  = 'kml';
    }

    // Save raw file to Drive
    const folder  = DriveApp.getFolderById(folderId);
    const mimeMap = { gpx:'application/gpx+xml', kml:'application/vnd.google-earth.kml+xml', kmz:'application/vnd.google-earth.kmz' };
    const blob    = Utilities.newBlob(contentBytes, mimeMap[ext] || 'application/octet-stream', safeName);
    const file    = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const trackFileUrl = file.getUrl();

    // Parse GPS content
    const contentStr = Utilities.newBlob(contentBytes).getDataAsString('UTF-8');
    const parsed = parseGpsTrack_(contentStr, parseFormat);

    return okJ({
      ok: true,
      trackFileUrl,
      trackSource: ext.toUpperCase(),
      distanceNm:      parsed.distanceNm,
      departureTime:   parsed.departureTime,
      arrivalTime:     parsed.arrivalTime,
      trackSimplified: JSON.stringify(parsed.simplifiedTrack),
      pointCount:      parsed.pointCount,
    });
  } catch (e) {
    return failJ('Track upload error: ' + e.message);
  }
}

function saveTripPhoto_(b) {
  if (!b.fileData) return failJ('fileData required');
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('DRIVE_FOLDER_ID_PHOTOS');
  if (!folderId) return okJ({ ok: false, error: 'Drive folder not configured' });

  try {
    const ext      = (b.fileName || 'photo.jpg').split('.').pop().toLowerCase();
    const ts       = now_().replace(/[: ]/g, '-');
    // Prefix marks the member's sharing choice so admins browsing the Drive
    // folder can tell shared/club-use photos apart from private uploads.
    let prefix = 'PRIVATE_';
    if (b.shared && b.clubUse)      prefix = 'SHARED_CLUB_';
    else if (b.shared)              prefix = 'SHARED_';
    else if (b.clubUse)             prefix = 'CLUB_';
    const safeName = prefix + ts + '_' + (b.fileName || 'photo.' + ext);
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

// ── Delete trip file (track or individual photo) ─────────────────────────

function deleteTripFile_(b) {
  if (!b.tripId) return failJ('tripId required');
  if (!b.fileType) return failJ('fileType required (track or photo)');

  const trip = findOne_('trips', 'id', b.tripId);
  if (!trip) return failJ('Trip not found');

  // Only the trip owner may delete uploads
  if (String(trip.kennitala) !== String(b.kennitala)) return failJ('Not authorised');

  if (b.fileType === 'track') {
    // Try to trash the Drive file
    tryTrashDriveUrl_(trip.trackFileUrl);
    updateRow_('trips', 'id', b.tripId, {
      trackFileUrl: '', trackSimplified: '', trackSource: '',
      updatedAt: now_(),
    });
    return okJ({ ok: true, deleted: 'track' });
  }

  if (b.fileType === 'photo') {
    if (!b.photoUrl) return failJ('photoUrl required');
    tryTrashDriveUrl_(b.photoUrl);
    let urls = [];
    try { urls = JSON.parse(trip.photoUrls || '[]'); } catch(e) {}
    urls = urls.filter(function(u) { return u !== b.photoUrl; });
    updateRow_('trips', 'id', b.tripId, {
      photoUrls: urls.length ? JSON.stringify(urls) : '',
      updatedAt: now_(),
    });
    return okJ({ ok: true, deleted: 'photo', remaining: urls.length });
  }

  return failJ('Unknown fileType: ' + b.fileType);
}

function tryTrashDriveUrl_(url) {
  if (!url) return;
  try {
    const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) DriveApp.getFileById(m[1]).setTrashed(true);
  } catch(e) { /* file may already be gone */ }
}

// ── GPS track parser ──────────────────────────────────────────────────────────

function parseGpsTrack_(content, format) {
  const doc = XmlService.parse(content);
  const root = doc.getRootElement();
  let points = [];   // [{lat, lng, time}]

  if (format === 'gpx') {
    // Support GPX 1.0 and 1.1 namespaces
    const ns0 = XmlService.getNamespace('http://www.topografix.com/GPX/1/0');
    const ns1 = XmlService.getNamespace('http://www.topografix.com/GPX/1/1');
    [ns0, ns1].forEach(function(ns) {
      try {
        root.getChildren('trk', ns).forEach(function(trk) {
          trk.getChildren('trkseg', ns).forEach(function(seg) {
            seg.getChildren('trkpt', ns).forEach(function(pt) {
              const lat  = parseFloat(pt.getAttribute('lat').getValue());
              const lng  = parseFloat(pt.getAttribute('lon').getValue());
              const timeEl = pt.getChild('time', ns);
              const time = timeEl ? timeEl.getText() : null;
              if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, time });
            });
          });
        });
      } catch(e) {}
    });
    // Fallback: try without namespace
    if (!points.length) {
      root.getDescendants().forEach(function(cNode) {
        try {
          const el = cNode.asElement();
          if (el && el.getName() === 'trkpt') {
            const lat = parseFloat(el.getAttribute('lat').getValue());
            const lng = parseFloat(el.getAttribute('lon').getValue());
            const timeEl = el.getChildren().find(function(c){ return c.getName()==='time'; });
            const time = timeEl ? timeEl.getText() : null;
            if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, time });
          }
        } catch(e) {}
      });
    }
  } else {
    // KML: look for LineString coordinates or gx:Track when/coord pairs
    const kmlNs  = XmlService.getNamespace('http://www.opengis.net/kml/2.2');
    const gxNs   = XmlService.getNamespace('http://www.google.com/kml/ext/2.2');

    // Try gx:Track first (has timestamps)
    const allEls = root.getDescendants();
    let gxTrackFound = false;
    for (let i = 0; i < allEls.length; i++) {
      let el; try { el = allEls[i].asElement(); } catch(e) { continue; }
      if (!el || el.getName() !== 'Track') continue;
      gxTrackFound = true;
      const whens  = el.getChildren('when', gxNs);
      const coords = el.getChildren('coord', gxNs);
      const len    = Math.min(whens.length, coords.length);
      for (let j = 0; j < len; j++) {
        const parts = coords[j].getText().trim().split(/\s+/);
        const lng = parseFloat(parts[0]), lat = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, time: whens[j].getText() });
      }
      break;
    }

    // Fall back to LineString coordinates (no timestamps)
    if (!gxTrackFound || !points.length) {
      for (let i = 0; i < allEls.length; i++) {
        let el; try { el = allEls[i].asElement(); } catch(e) { continue; }
        if (!el || el.getName() !== 'coordinates') continue;
        const raw = el.getText().trim();
        raw.split(/\s+/).forEach(function(token) {
          const parts = token.split(',');
          const lng = parseFloat(parts[0]), lat = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, time: null });
        });
      }
    }
  }

  if (!points.length) return { distanceNm: 0, departureTime: null, arrivalTime: null, simplifiedTrack: [], pointCount: 0 };

  // Sort by timestamp where available
  points.sort(function(a, b) { return a.time && b.time ? a.time < b.time ? -1 : 1 : 0; });

  // Compute total distance (Haversine)
  let totalM = 0;
  for (let i = 1; i < points.length; i++) {
    totalM += haversineM_(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
  }
  const distanceNm = Math.round((totalM / 1852) * 10) / 10;

  // RDP simplification → target ~50-100 representative points
  const simplified = rdpSimplify_(points.map(function(p){ return {lat:p.lat,lng:p.lng}; }), 0.0005);

  return {
    distanceNm,
    departureTime: points[0].time || null,
    arrivalTime:   points[points.length - 1].time || null,
    simplifiedTrack: simplified,
    pointCount: points.length,
  };
}

function haversineM_(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
  const df = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(df/2)*Math.sin(df/2) + Math.cos(f1)*Math.cos(f2)*Math.sin(dl/2)*Math.sin(dl/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function rdpSimplify_(points, epsilon) {
  if (points.length < 3) return points;
  // Find point farthest from the line between first and last
  const first = points[0], last = points[points.length - 1];
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist_(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left  = rdpSimplify_(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify_(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function perpendicularDist_(p, a, b) {
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) {
    return Math.sqrt(Math.pow(p.lng - a.lng, 2) + Math.pow(p.lat - a.lat, 2));
  }
  const t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx*dx + dy*dy);
  return Math.sqrt(Math.pow(p.lng - (a.lng + t*dx), 2) + Math.pow(p.lat - (a.lat + t*dy), 2));
}


