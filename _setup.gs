// ═══════════════════════════════════════════════════════════════════════════════
// SPREADSHEET SETUP  — run setupSpreadsheet() from the Apps Script editor
//
// Creates any missing tabs and adds any missing columns to existing tabs.
// Safe to run multiple times (fully idempotent).
// ═══════════════════════════════════════════════════════════════════════════════

// ── Schema definition ────────────────────────────────────────────────────────

var SCHEMA_ = {
  members: [
    'id','kennitala','name','role','email','phone','birthYear',
    'isMinor','guardianName','guardianKennitala','guardianPhone',
    'active','certifications','initials','preferences',
    'googleEmail',
    'createdAt','updatedAt',
  ],
  daily_log: [
    'id','date','openingChecks','closingChecks','activities',
    'weatherLog','narrative','tideData',
    'signedOffBy','signedOffAt','updatedBy','createdAt','updatedAt',
    // Authoritative actor identity stamped from the session caller. updatedBy
    // is a free-text display name (client-supplied, spoofable); these are the
    // audit trail.
    'actorKennitala','actorName',
  ],
  maintenance: [
    'id','category','boatId','boatName','itemName','part','severity',
    'description','photoUrl','markOos','reportedBy','source','createdAt',
    'resolved','resolvedBy','resolvedAt','comments',
    'saumaklubbur','verkstjori','materials','approved','onHold',
  ],
  checkouts: [
    // core
    'id','boatId','boatName','boatCategory',
    'memberKennitala','memberName','crew',
    'memberPhone','memberIsMinor','guardianName','guardianPhone',
    'locationId','locationName',
    'checkedOutAt','expectedReturn','checkedInAt',
    'wxSnapshot','preLaunchChecklist','afterSailChecklist','notes',
    'status','nonClub','createdAt','departurePort','crewNames',
    // group checkouts
    'isGroup','participants','staffNames','staffKennitalar','boatNames','boatIds',
    'activityTypeId','activityTypeName','linkedActivityId',
    // overdue alerts
    'alertSilenced','alertSilencedBy','alertSilencedAt',
    'alertSnoozedUntil','alertFirstSent',
    // Authoritative actor (session caller) for any staff-initiated write.
    'actorKennitala','actorName',
  ],
  // daily_checklist removed — now stored as JSON in config key 'dailyChecklist'
  incidents: [
    'id','types','severity','date','time',
    'locationId','locationName','boatId','boatName',
    'description','involved','witnesses',
    'immediateAction','followUp',
    'handOffTo','handOffName','handOffNotes',
    'photoUrls','filedBy','filedAt',
    'resolved','resolvedAt','staffNotes','reviewerNotes','status',
  ],
  trips: [
    'id','kennitala','memberName',
    'date','timeOut','timeIn','hoursDecimal',
    'boatId','boatName','boatCategory',
    'locationId','locationName',
    'crew','role','beaufort','windDir','wxSnapshot','notes',
    'isLinked','linkedCheckoutId','linkedTripId',
    'verified','verifiedBy','verifiedAt','staffComment',
    'validationRequested','helm','student','skipperNote',
    'nonClub','crewNames',
    // keelboat Phase-1 (v6)
    'distanceNm','departurePort','arrivalPort',
    'trackFileUrl','trackSimplified','trackSource',
    'photoUrls','photoMeta',
    'createdAt','updatedAt',
    // Authoritative actor (session caller) for staff-initiated inserts
    // (e.g. supervisor trips materialized at group check-in).
    'actorKennitala','actorName',
  ],
  trip_confirmations: [
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
    'dismissed','dismissedAt',
    'createdAt','respondedAt',
  ],
  reservation_slots: [
    'id','boatId','date','startTime','endTime',
    'recurrenceGroupId','bookedByKennitala','bookedByName','bookedByCrewId',
    'bookingColor','note','createdAt',
    // Set when a row was materialized from a virtual class-slot (i.e. a
    // captain/crew booked into a slot that came from an activity class's
    // reservedBoatIds projection). Lets getSlots_ suppress the matching
    // virtual on subsequent reads, and unbookSlot_ delete the row entirely
    // so the projection takes back over.
    'sourceActivityClassId',
  ],
  crews: [
    'id','name','pairs','status','createdAt','updatedAt',
  ],
  crew_invites: [
    'id','crewId','crewName','pairId',
    'fromKennitala','fromName',
    'toKennitala','toName',
    'status','createdAt','respondedAt',
  ],
  passport_signoffs: [
    'id','memberId','passportId','itemId',
    'signerId','signerName','signerRole',
    'timestamp','note',
    'revokedBy','revokedAt','revokeReason',
  ],
  config: ['key','value'],
  employees: [
    'id','kt','name','title','bankAccount','orlofsreikningur',
    'baseRateKr','union','lifeyrir','sereignarsjodur',
    'otherWithholdings','active','startDate','memberId','payrollEnabled',
  ],
  time_clock: [
    'id','employeeId','type','timestamp','source',
    'originalTimestamp','note','periodKey','durationMinutes',
  ],
  share_tokens: [
    'id','memberId','memberKennitala','cutOffDate',
    'createdAt','revokedAt','accessCount','lastAccessedAt',
    'includePhotos','includeTracks','categories',
  ],
  volunteer_signups: [
    'id','eventId','roleId','kennitala','name','signedUpAt',
  ],
  // Unified activities table — single source of truth for every concrete
  // occurrence at the club. One row per activity instance; an activity may
  // be templated from an `activity_templates` row or authored ad-hoc.
  //   signupRequired ∈ true | false  — true means signup-tracked (volunteer
  //                                    portal surfaces it with roles/leader);
  //                                    false means a plain activity (daily-log
  //                                    renderer + midnight materializer).
  //   status ∈ 'upcoming' | 'completed' | 'cancelled' | 'orphaned'
  //   source ∈ 'bulk' | 'calendar' | 'manual' | 'daily-log'
  activities: [
    'id','signupRequired','status','source',
    'date','endDate','startTime','endTime',
    'activityTypeId','subtypeId','subtypeName',
    'title','titleIS','notes','notesIS',
    'participants',
    'leaderMemberId','leaderName','leaderPhone','showLeaderPhone',
    'roles',
    'sourceActivityTypeId','sourceSubtypeId',
    'gcalEventId',
    // Per-event calendar push override. When calendarSyncActive=true and
    // calendarId is set, the event syncs to its own calendar; otherwise the
    // sync function falls through to the parent activity-type's calendarId.
    'calendarId','calendarSyncActive',
    'dailyLogDate',
    'createdAt','updatedAt','updatedBy',
    // Plain-activity (signupRequired=false) extras saved from the daily-log
    // modal. Live alongside notes/runNotes so a single activity_upsert_
    // round-trips everything the modal captures.
    'ablerRegistered','linkedGroupCheckoutIds','editedBy','editedAt',
  ],
  // Handbook (members- and staff-facing reference). See handbook.gs.
  // All four sections (roles, docs, contacts, info) now live as JSON arrays
  // under config keys 'handbookRoles' / 'handbookDocs' / 'handbookContacts' /
  // 'handbookInfo' (seeded below).
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureTab_(ss, tabName, cols) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    sheet.setFrozenRows(1);
    Logger.log('Created tab: ' + tabName + ' (' + cols.length + ' columns)');
    return sheet;
  }
  // Tab exists — add any missing columns. Trim existing headers so a stray
  // whitespace edit doesn't trick us into appending a duplicate column with
  // the same logical name (writes go to indexOf-first, reads to last —
  // silent divergence). Same trim applied to runtime reads in
  // getSheetData_, so this stays in sync.
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  // Loud-warn duplicates so a recurrence is visible in the migration log.
  var seen = {}, dupes = [];
  existing.forEach(function (h) {
    if (!h) return;
    if (seen[h]) { if (dupes.indexOf(h) === -1) dupes.push(h); }
    else seen[h] = true;
  });
  if (dupes.length) {
    Logger.log('⚠ Duplicate headers in tab "' + tabName + '": ' + dupes.join(', ')
      + ' — writes hit indexOf(first), reads keep last; clean the sheet manually.');
  }
  cols.forEach(function(col) {
    var c = String(col == null ? '' : col).trim();
    if (!c) return;
    if (!existing.includes(c)) {
      var nextCol = existing.length + 1;
      sheet.getRange(1, nextCol).setValue(c);
      existing.push(c);
      Logger.log('Added column "' + c + '" to tab "' + tabName + '"');
    }
  });
  return sheet;
}

// ── Main entry point ─────────────────────────────────────────────────────────

// Tabs that used to be in SCHEMA_ but were removed and should be deleted
// from any spreadsheet still carrying them. Each entry is the literal sheet
// name. setupSpreadsheet() drops empty/header-only sheets silently and
// preserves anything with data while warning loudly so the operator can
// archive and remove it manually.
var LEGACY_TABS_ = ['payroll'];

function dropLegacyTabs_(ss) {
  LEGACY_TABS_.forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    if (sh.getLastRow() <= 1) {
      ss.deleteSheet(sh);
      Logger.log('Dropped legacy tab: ' + name);
    } else {
      Logger.log('⚠ Legacy tab "' + name + '" has '
        + (sh.getLastRow() - 1) + ' data row(s); leaving in place — archive and delete manually.');
    }
  });
}

function setupSpreadsheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var results = [];

  dropLegacyTabs_(ss);

  Object.keys(SCHEMA_).forEach(function(tabName) {
    ensureTab_(ss, tabName, SCHEMA_[tabName]);
    results.push(tabName);
  });

  // Seed the config tab with default key rows if completely empty
  var cfgSheet = ss.getSheetByName('config');
  var cfgKeys = cfgSheet.getLastRow() >= 2
    ? cfgSheet.getRange(2, 1, cfgSheet.getLastRow()-1, 1).getValues().map(function(r){ return String(r[0]).trim(); })
    : [];
  var defaultCfgKeys = ['activity_templates','overdueAlerts','flagConfig','staffStatus','boats','locations','launchChecklists','boatCategories','certDefs','certCategories','dailyChecklist','handbookRoles','handbookDocs','handbookContacts','handbookInfo'];
  defaultCfgKeys.forEach(function(k) {
    if (!cfgKeys.includes(k)) {
      cfgSheet.appendRow([k, '']);
      Logger.log('Seeded config key: ' + k);
    }
  });

  Logger.log('setupSpreadsheet complete. Tabs processed: ' + results.join(', '));
  return 'Done — tabs processed: ' + results.join(', ');
}
