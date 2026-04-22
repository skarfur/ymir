// ═══════════════════════════════════════════════════════════════════════════════
// DATA ACCESS LAYER
// ═══════════════════════════════════════════════════════════════════════════════
//
// Thin domain-oriented wrappers over the sheet primitives in code.gs
// (readAll_, findOne_, insertRow_, updateRow_, deleteRow_, invalidateSheetCache_).
//
// Goals:
//  • Give business logic a higher-level vocabulary than raw tab names
//    ("readMembers({active:true})" vs "readAll_('members').filter(...)").
//  • Centralize the most common filter predicates and key lookups so future
//    changes (e.g. soft-delete semantics, cache invalidation rules) have
//    exactly one place to edit.
//  • Remain 100% additive — existing call sites in members.gs / trips.gs /
//    checkouts.gs / etc. keep working as-is. New code can prefer data_.*.
//
// Nothing here opens SpreadsheetApp directly; all reads go through readAll_
// (which is request-scoped cached) and all writes delegate to insertRow_ /
// updateRow_ / deleteRow_ so per-tab cache invariants are preserved.
// ═══════════════════════════════════════════════════════════════════════════════

var data_ = (function () {

  // ── Generic query helpers ────────────────────────────────────────────────
  function _applyFilter(rows, pred) {
    if (!pred) return rows;
    if (typeof pred === 'function') return rows.filter(pred);
    // Object form: every key must match (shallow equality, case-sensitive).
    var keys = Object.keys(pred);
    if (!keys.length) return rows;
    return rows.filter(function (r) {
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (String(r[k] == null ? '' : r[k]) !== String(pred[k] == null ? '' : pred[k])) return false;
      }
      return true;
    });
  }

  function _byField(tabKey, field, value) {
    return findOne_(tabKey, field, value);
  }

  // ── Members ──────────────────────────────────────────────────────────────
  function readMembers(filter) {
    var rows = readAll_('members');
    if (filter && filter.active === true) rows = rows.filter(function (m) { return !bool_(m.inactive); });
    if (filter && filter.active === false) rows = rows.filter(function (m) { return bool_(m.inactive); });
    if (filter && filter.role) rows = rows.filter(function (m) { return m.role === filter.role; });
    if (filter && filter.kennitala) rows = rows.filter(function (m) { return m.kennitala === filter.kennitala; });
    return rows;
  }
  function getMember(id)              { return _byField('members', 'id', id); }
  function getMemberByKennitala(kt)   { return _byField('members', 'kennitala', kt); }
  function updateMember(id, patch)    { return updateRow_('members', 'id', id, patch); }
  function insertMember(obj)          { insertRow_('members', obj); }

  // ── Trips ────────────────────────────────────────────────────────────────
  function readTrips(filter) {
    var rows = readAll_('trips');
    if (filter && filter.kennitala) rows = rows.filter(function (t) { return t.kennitala === filter.kennitala; });
    if (filter && filter.boatId)    rows = rows.filter(function (t) { return t.boatId === filter.boatId; });
    if (filter && filter.fromDate)  rows = rows.filter(function (t) { return (t.date || '') >= filter.fromDate; });
    if (filter && filter.toDate)    rows = rows.filter(function (t) { return (t.date || '') <= filter.toDate; });
    return rows;
  }
  function getTrip(id)             { return _byField('trips', 'id', id); }
  function updateTrip(id, patch)   { return updateRow_('trips', 'id', id, patch); }
  function insertTrip(obj)         { insertRow_('trips', obj); }
  function deleteTrip(id)          { return deleteRow_('trips', 'id', id); }

  // ── Checkouts ────────────────────────────────────────────────────────────
  function readCheckouts(filter) {
    var rows = readAll_('checkouts');
    if (filter && filter.active === true)  rows = rows.filter(function (c) { return !c.checkedInAt; });
    if (filter && filter.active === false) rows = rows.filter(function (c) { return !!c.checkedInAt; });
    if (filter && filter.kennitala)        rows = rows.filter(function (c) { return c.kennitala === filter.kennitala; });
    if (filter && filter.boatId)           rows = rows.filter(function (c) { return c.boatId === filter.boatId; });
    return rows;
  }
  function getCheckout(id)           { return _byField('checkouts', 'id', id); }
  function updateCheckout(id, patch) { return updateRow_('checkouts', 'id', id, patch); }
  function insertCheckout(obj)       { insertRow_('checkouts', obj); }

  // ── Reservation slots ────────────────────────────────────────────────────
  function readSlots(filter) {
    var rows = readAll_('reservationSlots');
    if (filter && filter.boatId)   rows = rows.filter(function (s) { return s.boatId === filter.boatId; });
    if (filter && filter.date)     rows = rows.filter(function (s) { return s.date === filter.date; });
    if (filter && filter.fromDate) rows = rows.filter(function (s) { return (s.date || '') >= filter.fromDate; });
    if (filter && filter.toDate)   rows = rows.filter(function (s) { return (s.date || '') <= filter.toDate; });
    return rows;
  }
  function getSlot(id)            { return _byField('reservationSlots', 'id', id); }
  function updateSlot(id, patch)  { return updateRow_('reservationSlots', 'id', id, patch); }
  function insertSlot(obj)        { insertRow_('reservationSlots', obj); }

  // ── Incidents ────────────────────────────────────────────────────────────
  function readIncidents(filter) {
    var rows = readAll_('incidents');
    if (filter && filter.resolved === true)  rows = rows.filter(function (i) { return !!i.resolvedAt; });
    if (filter && filter.resolved === false) rows = rows.filter(function (i) { return !i.resolvedAt; });
    return rows;
  }
  function getIncident(id)           { return _byField('incidents', 'id', id); }
  function updateIncident(id, patch) { return updateRow_('incidents', 'id', id, patch); }
  function insertIncident(obj)       { insertRow_('incidents', obj); }

  // ── Maintenance ──────────────────────────────────────────────────────────
  function readMaintenance(filter) {
    var rows = readAll_('maintenance');
    if (filter && filter.resolved === true)  rows = rows.filter(function (m) { return !!m.resolvedAt; });
    if (filter && filter.resolved === false) rows = rows.filter(function (m) { return !m.resolvedAt; });
    if (filter && filter.saumaklubbur === true) rows = rows.filter(function (m) { return bool_(m.saumaklubbur); });
    return rows;
  }
  function getMaintenance(id)           { return _byField('maintenance', 'id', id); }
  function updateMaintenance(id, patch) { return updateRow_('maintenance', 'id', id, patch); }
  function insertMaintenance(obj)       { insertRow_('maintenance', obj); }

  // ── Trip confirmations ───────────────────────────────────────────────────
  function readConfirmations(filter) {
    var rows = readAll_('tripConfirmations');
    return _applyFilter(rows, filter);
  }
  function getConfirmation(id)           { return _byField('tripConfirmations', 'id', id); }
  function updateConfirmation(id, patch) { return updateRow_('tripConfirmations', 'id', id, patch); }

  // ── Volunteer signups ────────────────────────────────────────────────────
  function readVolunteerSignups(filter) {
    var rows = readAll_('volunteerSignups');
    return _applyFilter(rows, filter);
  }

  // ── Passport sign-offs ───────────────────────────────────────────────────
  function readPassportSignoffs(filter) {
    var rows = readAll_('passportSignoffs');
    return _applyFilter(rows, filter);
  }

  // ── Generic escape hatch ─────────────────────────────────────────────────
  // For ad-hoc reads not covered above. Prefer a named accessor when possible.
  function readAll(tabKey, filter) { return _applyFilter(readAll_(tabKey), filter); }
  function findOne(tabKey, field, value) { return _byField(tabKey, field, value); }
  function invalidate(tabKey) { invalidateSheetCache_(tabKey); }

  return {
    // members
    readMembers: readMembers,
    getMember: getMember,
    getMemberByKennitala: getMemberByKennitala,
    updateMember: updateMember,
    insertMember: insertMember,
    // trips
    readTrips: readTrips,
    getTrip: getTrip,
    updateTrip: updateTrip,
    insertTrip: insertTrip,
    deleteTrip: deleteTrip,
    // checkouts
    readCheckouts: readCheckouts,
    getCheckout: getCheckout,
    updateCheckout: updateCheckout,
    insertCheckout: insertCheckout,
    // slots
    readSlots: readSlots,
    getSlot: getSlot,
    updateSlot: updateSlot,
    insertSlot: insertSlot,
    // incidents
    readIncidents: readIncidents,
    getIncident: getIncident,
    updateIncident: updateIncident,
    insertIncident: insertIncident,
    // maintenance
    readMaintenance: readMaintenance,
    getMaintenance: getMaintenance,
    updateMaintenance: updateMaintenance,
    insertMaintenance: insertMaintenance,
    // confirmations
    readConfirmations: readConfirmations,
    getConfirmation: getConfirmation,
    updateConfirmation: updateConfirmation,
    // volunteer
    readVolunteerSignups: readVolunteerSignups,
    // passport
    readPassportSignoffs: readPassportSignoffs,
    // generic
    readAll: readAll,
    findOne: findOne,
    invalidate: invalidate,
  };
})();
