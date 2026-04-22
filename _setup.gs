// ═══════════════════════════════════════════════════════════════════════════════
// SPREADSHEET SETUP  — run setupSpreadsheet() from the Apps Script editor
//
// Creates any missing tabs and adds any missing columns to existing tabs.
// Safe to run multiple times (fully idempotent).
//
// Run the focused helper addRecentTripColumns() if you only want to add
// the columns introduced in the keelboat Phase-1 update (v6):
//   distanceNm, departurePort, arrivalPort, trackFileUrl,
//   trackSimplified, trackSource, photoUrls
// ═══════════════════════════════════════════════════════════════════════════════

// ── Schema definition ────────────────────────────────────────────────────────

var SCHEMA_ = {
  members: [
    'id','kennitala','name','role','email','phone','birthYear',
    'isMinor','guardianName','guardianKennitala','guardianPhone',
    'active','certifications','initials','preferences',
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

// ── Focused helper: only the new keelboat Phase-1 trip columns ───────────────

function addRecentTripColumns() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var sheet = ss.getSheetByName('trips');
  if (!sheet) {
    Logger.log('trips tab not found — run setupSpreadsheet() first');
    return;
  }
  var newCols = ['distanceNm','departurePort','arrivalPort','trackFileUrl','trackSimplified','trackSource','photoUrls'];
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var added = [];
  newCols.forEach(function(col) {
    if (!existing.includes(col)) {
      sheet.getRange(1, existing.length + 1).setValue(col);
      existing.push(col);
      added.push(col);
    }
  });
  if (added.length) {
    Logger.log('Added to trips: ' + added.join(', '));
  } else {
    Logger.log('trips already has all keelboat Phase-1 columns — nothing to add');
  }
}

// ── Focused helper: add photoMeta column to trips ───────────────────────
function addPhotoMetaColumn() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var sheet = ss.getSheetByName('trips');
  if (!sheet) { Logger.log('trips tab not found'); return; }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  if (!existing.includes('photoMeta')) {
    sheet.getRange(1, existing.length + 1).setValue('photoMeta');
    Logger.log('Added photoMeta column to trips');
  } else {
    Logger.log('photoMeta column already exists');
  }
}

// ── Focused helper: add crewNames to checkouts + skipperNote to trips +
//    create trip_confirmations tab ────────────────────────────────────────
function addHandshakeColumns() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);

  // 1) checkouts → crewNames
  var coSheet = ss.getSheetByName('checkouts');
  if (coSheet) {
    var coHdr = coSheet.getRange(1, 1, 1, coSheet.getLastColumn()).getValues()[0].map(String);
    if (!coHdr.includes('crewNames')) {
      coSheet.getRange(1, coHdr.length + 1).setValue('crewNames');
      Logger.log('Added "crewNames" to checkouts');
    } else { Logger.log('checkouts already has crewNames'); }
  } else { Logger.log('checkouts tab not found — run setupSpreadsheet() first'); }

  // 2) trips → skipperNote
  var trSheet = ss.getSheetByName('trips');
  if (trSheet) {
    var trHdr = trSheet.getRange(1, 1, 1, trSheet.getLastColumn()).getValues()[0].map(String);
    if (!trHdr.includes('skipperNote')) {
      trSheet.getRange(1, trHdr.length + 1).setValue('skipperNote');
      Logger.log('Added "skipperNote" to trips');
    } else { Logger.log('trips already has skipperNote'); }
  } else { Logger.log('trips tab not found — run setupSpreadsheet() first'); }

  // 3) trip_confirmations tab (create if missing)
  var confCols = SCHEMA_.trip_confirmations;
  ensureTab_(ss, 'trip_confirmations', confCols);
  Logger.log('trip_confirmations tab ready');
}

function addPreferencesColumn() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var sheet = ss.getSheetByName('members');
  if (!sheet) { Logger.log('members tab not found'); return; }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('preferences') === -1) {
    var col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue('preferences');
    Logger.log('Added preferences column at col ' + col);
  } else {
    Logger.log('preferences column already exists');
  }
}

// Migration: move any existing members.lang values into preferences.lang
// and delete the lang column. Safe to run multiple times.
function migrateMemberLangIntoPreferences() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var sheet = ss.getSheetByName('members');
  if (!sheet) { Logger.log('members tab not found'); return; }
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var langIdx = headers.indexOf('lang');
  var prefIdx = headers.indexOf('preferences');
  if (prefIdx === -1) { Logger.log('preferences column missing; run addPreferencesColumn first'); return; }
  if (langIdx === -1) { Logger.log('lang column already removed'); return; }
  if (lastRow > 1) {
    var langVals = sheet.getRange(2, langIdx + 1, lastRow - 1, 1).getValues();
    var prefVals = sheet.getRange(2, prefIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < langVals.length; i++) {
      var l = String(langVals[i][0] || '').toUpperCase();
      if (l !== 'EN' && l !== 'IS') continue;
      var obj = {};
      try { obj = JSON.parse(prefVals[i][0] || '{}') || {}; } catch (e) { obj = {}; }
      if (!obj.lang) {
        obj.lang = l;
        prefVals[i][0] = JSON.stringify(obj);
      }
    }
    sheet.getRange(2, prefIdx + 1, lastRow - 1, 1).setValues(prefVals);
  }
  sheet.deleteColumn(langIdx + 1);
  cDel_('members');
  Logger.log('lang column migrated into preferences and removed');
}

// ── Focused helper: create reservation_slots, crews, crew_invites tabs ────
function addReservationAndCrewTabs() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  ensureTab_(ss, 'reservation_slots', SCHEMA_.reservation_slots);
  Logger.log('reservation_slots tab ready');
  ensureTab_(ss, 'crews', SCHEMA_.crews);
  Logger.log('crews tab ready');
  ensureTab_(ss, 'crew_invites', SCHEMA_.crew_invites);
  Logger.log('crew_invites tab ready');
}

