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
  // Unified scheduled-events table. Replaces the `activities` JSON column in
  // daily_log and the config key `volunteer_events`. See migrateToScheduledEvents_
  // for the one-shot migration that populates this from the old locations.
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
    'members',
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

// ── One-shot: auto-populate googleEmail for existing members whose email
//    is provably a Google Account (personal Gmail or a Workspace domain
//    whose MX points to Google). Safe to re-run; never overwrites an
//    existing googleEmail value. Depends on resolveGoogleEmail_ in
//    members.gs. Run from the Apps Script editor after setupSpreadsheet().
function autoLinkGmailAddresses() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  var sheet = ss.getSheetByName('members');
  if (!sheet) { Logger.log('members tab not found'); return; }
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('no member rows'); return; }
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var emailIdx  = headers.indexOf('email');
  var googleIdx = headers.indexOf('googleEmail');
  if (emailIdx === -1) { Logger.log('email column missing'); return; }
  if (googleIdx === -1) {
    Logger.log('googleEmail column missing — run setupSpreadsheet() first');
    return;
  }
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var gmail = 0, workspace = 0;
  for (var i = 0; i < data.length; i++) {
    var existing = String(data[i][googleIdx] || '').trim();
    if (existing) continue;
    var email = String(data[i][emailIdx] || '').trim().toLowerCase();
    if (!email) continue;
    var resolved = resolveGoogleEmail_(email);
    if (!resolved) continue;
    sheet.getRange(i + 2, googleIdx + 1).setValue(resolved);
    if (isGmailAddress_(email)) gmail++; else workspace++;
  }
  cDel_('members');
  Logger.log('autoLinkGmailAddresses: ' + (gmail + workspace) +
             ' rows linked (personal gmail: ' + gmail +
             ', workspace: ' + workspace + ')');
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

// ── Scheduled-events migration ───────────────────────────────────────────────
// One-shot: move volunteer events out of config and activity rows out of the
// daily_log JSON blob into a unified `scheduled_events` sheet. Idempotent —
// skips any row whose `id` already exists in the target.
//
// This is the migration referenced in CHANGELOG "Unreleased — unified
// scheduled_events table". Run from the Apps Script editor once the new code
// is deployed:
//     migrateToScheduledEvents()
//
// After this runs, the old data sources (config key 'volunteer_events' and the
// daily_log.activities column) are no longer read by any code path, but remain
// populated so a `git revert` of the cutover can roll back without data loss.
function migrateToScheduledEvents() {
  var ss = SpreadsheetApp.openById(SHEET_ID_);
  ensureTab_(ss, 'scheduled_events', SCHEMA_.scheduled_events);

  var todayIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var existing = readAll_('scheduledEvents') || [];
  var seen = {};
  existing.forEach(function (r) { if (r && r.id) seen[r.id] = true; });

  var added = { volunteer: 0, activity: 0 };
  var skipped = 0;

  // 1) Volunteer events from config key 'volunteer_events'.
  var volRaw = '';
  try { volRaw = getConfigSheetValue_('volunteer_events') || '[]'; } catch (e) { volRaw = '[]'; }
  var volEvents = [];
  try { volEvents = JSON.parse(volRaw) || []; } catch (e) { volEvents = []; }
  volEvents.forEach(function (ev) {
    if (!ev || !ev.id) { skipped++; return; }
    if (seen[ev.id]) { skipped++; return; }
    insertRow_('scheduledEvents', _volEventToScheduledRow_(ev, todayIso));
    seen[ev.id] = true;
    added.volunteer++;
  });

  // 2) Daily-log activities from each dailyLog row's `activities` JSON blob.
  var logs = [];
  try { logs = readAll_('dailyLog') || []; } catch (e) { logs = []; }
  logs.forEach(function (log) {
    if (!log || !log.date) return;
    var acts = [];
    try { acts = JSON.parse(log.activities || '[]') || []; } catch (e) { acts = []; }
    if (!Array.isArray(acts)) return;
    acts.forEach(function (a) {
      if (!a || !a.id) { skipped++; return; }
      if (seen[a.id]) { skipped++; return; }
      insertRow_('scheduledEvents', _activityToScheduledRow_(a, log.date, todayIso));
      seen[a.id] = true;
      added.activity++;
    });
  });

  Logger.log('migrateToScheduledEvents: added ' + added.volunteer + ' volunteer + '
    + added.activity + ' activity rows (skipped ' + skipped + ')');
  return { addedVolunteer: added.volunteer, addedActivity: added.activity, skipped: skipped };
}

function _volEventToScheduledRow_(ev, todayIso) {
  var active = ev.active !== false && ev.active !== 'false';
  var orphaned = ev.orphaned === true || ev.orphaned === 'true';
  var status = !active ? (orphaned ? 'orphaned' : 'cancelled')
             : ((ev.date || '') < todayIso ? 'completed' : 'upcoming');
  var source = ev.sourceActivityTypeId ? 'bulk' : 'manual';
  return {
    id:                    ev.id || '',
    kind:                  'volunteer',
    status:                status,
    source:                source,
    date:                  ev.date || '',
    endDate:               ev.endDate || '',
    startTime:             ev.startTime || '',
    endTime:               ev.endTime || '',
    activityTypeId:        ev.activityTypeId || ev.sourceActivityTypeId || '',
    subtypeId:             ev.sourceSubtypeId || '',
    subtypeName:           ev.subtitle || '',
    title:                 ev.title || '',
    titleIS:               ev.titleIS || '',
    notes:                 ev.notes || '',
    notesIS:               ev.notesIS || '',
    participants:          '',
    leaderMemberId:        ev.leaderMemberId || '',
    leaderName:            ev.leaderName || '',
    leaderPhone:           ev.leaderPhone || '',
    showLeaderPhone:       ev.showLeaderPhone === true || ev.showLeaderPhone === 'true',
    roles:                 JSON.stringify(Array.isArray(ev.roles) ? ev.roles : []),
    sourceActivityTypeId:  ev.sourceActivityTypeId || '',
    sourceSubtypeId:       ev.sourceSubtypeId || '',
    gcalEventId:           ev.gcalEventId || '',
    dailyLogDate:          '',
    createdAt:             ev.createdAt || '',
    updatedAt:             ev.updatedAt || '',
    updatedBy:             '',
  };
}

function _activityToScheduledRow_(a, logDateIso, todayIso) {
  var source = 'daily-log';
  if (a.scheduled === true || a.scheduled === 'true') {
    if (String(a.id || '').indexOf('gcal-')  === 0) source = 'calendar';
    else if (String(a.id || '').indexOf('sched-') === 0) source = 'bulk';
  }
  var status = (logDateIso || '') < todayIso ? 'completed' : 'upcoming';
  return {
    id:                    a.id || '',
    kind:                  'activity',
    status:                status,
    source:                source,
    date:                  logDateIso || '',
    endDate:               '',
    startTime:             a.start || a.startTime || '',
    endTime:               a.end   || a.endTime   || '',
    activityTypeId:        a.activityTypeId || '',
    subtypeId:             a.subtypeId || '',
    subtypeName:           a.subtypeName || '',
    title:                 a.name || a.title || '',
    titleIS:               a.titleIS || '',
    notes:                 a.notes || '',
    notesIS:               '',
    participants:          a.participants || '',
    leaderMemberId:        '',
    leaderName:            '',
    leaderPhone:           '',
    showLeaderPhone:       false,
    roles:                 '[]',
    sourceActivityTypeId:  '',
    sourceSubtypeId:       '',
    gcalEventId:           a.gcalEventId || '',
    dailyLogDate:          logDateIso || '',
    createdAt:             '',
    updatedAt:             '',
    updatedBy:             '',
  };
}

