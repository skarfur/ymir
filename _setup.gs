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
  // Unified activities table — single source of truth for every concrete
  // occurrence at the club. One row per activity instance; an activity may
  // be templated from an `activity_templates` row or authored ad-hoc.
  //   signupRequired ∈ true | false  — true means signup-tracked (volunteer
  //                                    portal surfaces it with roles/leader);
  //                                    false means a plain activity (daily-log
  //                                    renderer + midnight materializer).
  //   status ∈ 'upcoming' | 'completed' | 'cancelled' | 'orphaned'
  //   source ∈ 'bulk' | 'calendar' | 'manual' | 'daily-log'
  // (Legacy `kind` column may still be present on rows from before the
  // vocabulary cleanup. New writes don't populate it; activity_parseRow_
  // falls back to it only if signupRequired is missing. Drop it manually
  // from the sheet once you're confident every row has signupRequired set.)
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
  // Self-healing rename: if the canonical tab is missing but a legacy alias
  // is present, rename so existing data is preserved.
  if (!sheet) sheet = _reconcileLegacyTab_(ss, tabName);
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
  var defaultCfgKeys = ['activity_templates','overdueAlerts','flagConfig','staffStatus','boats','locations','launchChecklists','boatCategories','certDefs','certCategories','dailyChecklist','handbookRoles','handbookDocs','handbookContacts','handbookInfo'];
  defaultCfgKeys.forEach(function(k) {
    if (!cfgKeys.includes(k)) {
      cfgSheet.appendRow([k, '']);
      Logger.log('Seeded config key: ' + k);
    }
  });

  // ── Migrations ─────────────────────────────────────────────────────────────
  // Backfill signupRequired on activities from the legacy `kind` column.
  // Idempotent: only writes when signupRequired is empty/missing on a row.
  // Safe to run repeatedly; no-op once every row carries the boolean.
  // Tab may still be named 'scheduled_events' on older deployments —
  // the SCHEMA_ loop above runs ensureTab_ which auto-renames via
  // _reconcileLegacyTab_, so by this point it's named 'activities'.
  try {
    var seSheet = ss.getSheetByName('activities');
    if (seSheet && seSheet.getLastRow() >= 2) {
      var headers = seSheet.getRange(1, 1, 1, seSheet.getLastColumn()).getValues()[0]
        .map(function (h) { return String(h).trim(); });
      var kindCol = headers.indexOf('kind');
      var sigCol  = headers.indexOf('signupRequired');
      if (kindCol >= 0 && sigCol >= 0) {
        var nRows = seSheet.getLastRow() - 1;
        var range = seSheet.getRange(2, 1, nRows, headers.length);
        var values = range.getValues();
        var changed = 0;
        for (var i = 0; i < values.length; i++) {
          var existing = values[i][sigCol];
          if (existing === true || existing === false) continue;
          if (existing === 'TRUE' || existing === 'FALSE') continue;
          var kindVal = String(values[i][kindCol] || '').trim().toLowerCase();
          values[i][sigCol] = (kindVal === 'volunteer');
          changed++;
        }
        if (changed > 0) {
          range.setValues(values);
          Logger.log('Migrated signupRequired on ' + changed + ' activities row(s).');
        }
      }
    }
  } catch (e) {
    Logger.log('signupRequired backfill skipped: ' + e.message);
  }

  // Drop the legacy `kind` column from the activities sheet once every row
  // carries the canonical `signupRequired` boolean. Safety-gated: if any
  // row still has signupRequired empty/missing, the migration logs a
  // warning and skips so no information is lost. Idempotent — once the
  // column is gone, getLastColumn no longer turns it up and this is a
  // no-op. Re-run safely.
  try {
    var actSheet = ss.getSheetByName('activities');
    if (actSheet && actSheet.getLastColumn() > 0) {
      var actHeaders = actSheet.getRange(1, 1, 1, actSheet.getLastColumn()).getValues()[0]
        .map(function (h) { return String(h).trim(); });
      var kindIdx = actHeaders.indexOf('kind');
      var sigIdx2 = actHeaders.indexOf('signupRequired');
      if (kindIdx >= 0) {
        var safe = true;
        if (actSheet.getLastRow() >= 2 && sigIdx2 >= 0) {
          var sigVals = actSheet.getRange(2, sigIdx2 + 1, actSheet.getLastRow() - 1, 1).getValues();
          for (var r = 0; r < sigVals.length; r++) {
            var v = sigVals[r][0];
            if (v === true || v === false) continue;
            if (v === 'TRUE' || v === 'true' || v === 'FALSE' || v === 'false') continue;
            safe = false; break;
          }
        } else if (sigIdx2 < 0) {
          safe = false;
        }
        if (safe) {
          actSheet.deleteColumn(kindIdx + 1);
          Logger.log('Dropped legacy `kind` column from activities sheet.');
        } else {
          Logger.log('⚠ Legacy `kind` column NOT dropped: some rows are missing signupRequired. ' +
            'Re-run setupSpreadsheet after the backfill completes, or fix those rows by hand.');
        }
      }
    }
  } catch (e) {
    Logger.log('Legacy kind-column drop skipped: ' + e.message);
  }

  // Copy legacy config keys into their canonical names. Idempotent — only
  // copies when the canonical row is missing/empty AND the legacy row has a
  // value. Leaves the legacy row in place for one cycle so a partial-deploy
  // rollback still has a working source. See LEGACY_CONFIG_KEY_ALIASES_ in
  // config.gs for the source of truth.
  try {
    var cfgSheet2 = ss.getSheetByName('config');
    if (cfgSheet2 && cfgSheet2.getLastRow() >= 2) {
      var cfgRows = cfgSheet2.getRange(2, 1, cfgSheet2.getLastRow() - 1, 2).getValues();
      var cfgKeyToRow = {};
      cfgRows.forEach(function (r, i) {
        cfgKeyToRow[String(r[0]).trim()] = { rowIndex: i + 2, value: String(r[1]).trim() };
      });
      Object.keys(LEGACY_CONFIG_KEY_ALIASES_).forEach(function (canonical) {
        var canonRow = cfgKeyToRow[canonical];
        if (canonRow && canonRow.value !== '') return; // canonical already populated
        var legacies = LEGACY_CONFIG_KEY_ALIASES_[canonical] || [];
        for (var j = 0; j < legacies.length; j++) {
          var legacyRow = cfgKeyToRow[legacies[j]];
          if (legacyRow && legacyRow.value !== '') {
            if (canonRow) {
              cfgSheet2.getRange(canonRow.rowIndex, 2).setValue(literalWrite_(legacyRow.value));
            } else {
              cfgSheet2.appendRow([canonical, literalWrite_(legacyRow.value)]);
            }
            Logger.log('Migrated config key: "' + legacies[j] + '" → "' + canonical + '"');
            break;
          }
        }
      });
    }
  } catch (e) {
    Logger.log('Config-key migration skipped: ' + e.message);
  }

  Logger.log('setupSpreadsheet complete. Tabs processed: ' + results.join(', '));
  return 'Done — tabs processed: ' + results.join(', ');
}
