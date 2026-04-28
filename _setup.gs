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
    'isGroup','participants','staffNames','boatNames','boatIds',
    'activityTypeId','activityTypeName','linkedActivityId',
    // overdue alerts
    'alertSilenced','alertSilencedBy','alertSilencedAt',
    'alertSnoozedUntil','alertFirstSent',
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
  payroll: [
    'id','employeeId','employeeName','kt','period',
    'periodFrom','periodTo','paymentDate','slipNumber',
    'bankAccount','orlofsreikningur','title','baseRateKr',
    'regularMinutes','regularHrs','otMinutes','ot1Hrs','ot2Hrs','totalHours',
    'dagvinna','eftirvinna1','eftirvinna2','otLines','manualLines','manualTotal',
    'hoursRegular','hoursOT133','hoursOT155',
    'grossWage','orlofslaun','orlofsRate','orlofsfe','grossTotal',
    'employeePension','pensionRate','lifeyrir','sereignarsjodur','sereignRate',
    'unionDues','otherWithholdings',
    'taxBase','taxGross','personalCredit','taxWithheld','taxAfterCredit',
    'stadgreidslaSkattur','netPay','orlofIBanki','totalDeductions',
    'tryggingagjald','motframlag','employerPension','endurhaefingarsjodur',
    'totalEmployerCost',
    'approved','configSnapshot','generatedBy',
  ],
  volunteer_signups: [
    'id','eventId','roleId','kennitala','name','signedUpAt',
  ],
  // Unified scheduled-events table — single source of truth for volunteer
  // events and daily-log activities.
  //   kind   ∈ 'volunteer' | 'activity'
  //   status ∈ 'upcoming' | 'completed' | 'cancelled' | 'orphaned'
  //   source ∈ 'bulk' | 'calendar' | 'manual' | 'daily-log'
  scheduled_events: [
    'id','kind','status','source',
    'date','endDate','startTime','endTime',
    'activityTypeId','subtypeId','subtypeName',
    'title','titleIS','notes','notesIS',
    'participants',
    'leaderMemberId','leaderName','leaderPhone','showLeaderPhone',
    'roles',
    'sourceActivityTypeId','sourceSubtypeId',
    'gcalEventId',
    'dailyLogDate',
    'createdAt','updatedAt','updatedBy',
  ],
  // Handbook (members- and staff-facing reference). See handbook.gs.
  handbook_roles: [
    'id','parentId','title','titleIS','name','kennitala',
    'phone','email','notes','notesIS','color','boatCategoryKey',
    'members','areas',
    'sortOrder','active','createdAt','updatedAt',
  ],
  handbook_docs: [
    'id','category','categoryIS','title','titleIS',
    'url','driveFileId','notes','notesIS',
    'sortOrder','active','createdAt','updatedAt',
  ],
  handbook_info: [
    'id','kind','title','titleIS','content','contentIS',
    'sortOrder','active','createdAt','updatedAt',
  ],
  handbook_contacts: [
    'id','memberId','label','labelIS','name','phone','email',
    'notes','notesIS','sortOrder','active','createdAt','updatedAt',
  ],
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
  // Tab exists — add any missing columns
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  cols.forEach(function(col) {
    if (!existing.includes(col)) {
      var nextCol = existing.length + 1;
      sheet.getRange(1, nextCol).setValue(col);
      existing.push(col);
      Logger.log('Added column "' + col + '" to tab "' + tabName + '"');
    }
  });
  return sheet;
}

// ── Main entry point ─────────────────────────────────────────────────────────

function setupSpreadsheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var results = [];

  Object.keys(SCHEMA_).forEach(function(tabName) {
    ensureTab_(ss, tabName, SCHEMA_[tabName]);
    results.push(tabName);
  });

  // Seed the config tab with default key rows if completely empty
  var cfgSheet = ss.getSheetByName('config');
  var cfgKeys = cfgSheet.getLastRow() >= 2
    ? cfgSheet.getRange(2, 1, cfgSheet.getLastRow()-1, 1).getValues().map(function(r){ return String(r[0]).trim(); })
    : [];
  var defaultCfgKeys = ['activity_types','overdueAlerts','flagConfig','staffStatus','boats','locations','launchChecklists','boatCategories','certDefs','certCategories','dailyChecklist'];
  defaultCfgKeys.forEach(function(k) {
    if (!cfgKeys.includes(k)) {
      cfgSheet.appendRow([k, '']);
      Logger.log('Seeded config key: ' + k);
    }
  });

  Logger.log('setupSpreadsheet complete. Tabs processed: ' + results.join(', '));
  return 'Done — tabs processed: ' + results.join(', ');
}
