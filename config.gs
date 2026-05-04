// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG  —  getConfig bundles everything; boats + locations stored as JSON rows
// ═══════════════════════════════════════════════════════════════════════════════

// ── Config-sheet primitives ──────────────────────────────────────────────────
// The `config` sheet is a key/value store: column A holds the key, column B
// the (typically JSON) value. Most domain config (boats, locations, certDefs,
// activity templates, flagConfig, …) lives in here under one row per key.

// Self-healing config-key renames. Key = canonical config key; value = list
// of legacy keys to fall back to when the canonical key is missing/empty.
// Reads transparently fall through to the legacy key during the transition;
// setupSpreadsheet copies legacy → canonical once explicitly. Empty for
// now; populate when the next rename lands.
const LEGACY_CONFIG_KEY_ALIASES_ = {};

// Read the entire config sheet once and return a key→value map.
function getConfigMap_() {
  let sheet;
  try { sheet = getSheet_('config'); } catch (e) { return {}; }
  if (sheet.getLastRow() < 2) return {};
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const map = {};
  data.forEach(r => { map[String(r[0]).trim()] = String(r[1]).trim(); });
  return map;
}

function getConfigValue_(key, map) {
  const v = map[key];
  if (v !== undefined && v !== '') return v;
  const aliases = LEGACY_CONFIG_KEY_ALIASES_[key];
  if (aliases) {
    for (let i = 0; i < aliases.length; i++) {
      const alt = map[aliases[i]];
      if (alt !== undefined && alt !== '') return alt;
    }
  }
  return v !== undefined ? v : null;
}

// One-shot read of a single config key (re-reads the sheet — prefer
// getConfigMap_ + getConfigValue_ when reading several keys in one request).
function getConfigSheetValue_(key) {
  let sheet;
  try { sheet = getSheet_('config'); } catch (e) { return null; }
  if (sheet.getLastRow() < 2) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const findRow = function (k) {
    const r = data.find(row => String(row[0]).trim() === k);
    return r ? String(r[1]).trim() : null;
  };
  const v = findRow(key);
  if (v !== null && v !== '') return v;
  const aliases = LEGACY_CONFIG_KEY_ALIASES_[key];
  if (aliases) {
    for (let i = 0; i < aliases.length; i++) {
      const alt = findRow(aliases[i]);
      if (alt !== null && alt !== '') return alt;
    }
  }
  return v;
}

function setConfigSheetValue_(key, value) {
  let sheet;
  try { sheet = getSheet_('config'); } catch (e) {
    sheet = ss_().insertSheet('config');
    sheet.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => String(r[0]).trim());
    const idx = keys.indexOf(key);
    if (idx !== -1) { sheet.getRange(idx + 2, 2).setValue(literalWrite_(value)); return; }
  }
  sheet.appendRow([key, literalWrite_(value)]);
}

// ── Config-list CRUD helpers ──────────────────────────────────────────────────
// Many admin entities (activity types, cert defs, boat categories, locations,
// volunteer events, etc.) are stored as JSON arrays under a single config key.
// These helpers collapse the save/delete boilerplate: parse → find-by-id →
// merge-or-push → stringify → cache-clear.
//
//   saveConfigListItem_('activity_templates', { id, ...fields })
//     → inserts if id empty/missing; merges into existing row otherwise.
//       Returns { id, item, created|updated: true }.
//
//   deleteConfigListItem_('activity_templates', id, { soft: true })
//     → hard-removes by default. With { soft: true } sets active=false instead.
//       Returns { deleted: true } (or { deactivated: true } for soft delete).
function readConfigList_(key) {
  try { return JSON.parse(getConfigSheetValue_(key) || '[]') || []; }
  catch (e) { return []; }
}

function saveConfigListItem_(key, patch) {
  if (!key) throw new Error('saveConfigListItem_: key required');
  const arr = readConfigList_(key);
  const ts  = now_();
  const idx = patch && patch.id ? arr.findIndex(x => x && x.id === patch.id) : -1;
  let item, created = false;
  if (idx >= 0) {
    item = Object.assign(arr[idx], patch, { updatedAt: ts });
    arr[idx] = item;
  } else {
    // id last so an empty-string `patch.id` can't clobber the freshly-minted uid.
    var newId = (patch && patch.id) || uid_();
    item = Object.assign({}, patch || {}, { id: newId, createdAt: ts, updatedAt: ts });
    arr.push(item);
    created = true;
  }
  setConfigSheetValue_(key, JSON.stringify(arr));
  cDel_('config');
  return { id: item.id, item: item, created: created, updated: !created };
}

function deleteConfigListItem_(key, id, opts) {
  if (!key || !id) throw new Error('deleteConfigListItem_: key and id required');
  const soft = !!(opts && opts.soft);
  let arr = readConfigList_(key);
  if (soft) {
    const idx = arr.findIndex(x => x && x.id === id);
    if (idx < 0) return { deleted: false };
    arr[idx].active = false;
    arr[idx].updatedAt = now_();
  } else {
    const before = arr.length;
    arr = arr.filter(x => !x || x.id !== id);
    if (arr.length === before) return { deleted: false };
  }
  setConfigSheetValue_(key, JSON.stringify(arr));
  cDel_('config');
  return soft ? { deactivated: true } : { deleted: true };
}

// ── Config-bundle parsers ─────────────────────────────────────────────────────
// Pull a specific section out of an already-fetched cfgMap. Used by
// getConfig_ to assemble its bundle without re-reading the config sheet for
// each section, and by domain endpoints (checkouts.gs, public.gs) that need
// one section without paying for the full bundle.

function getFlagConfigFromMap_(cfgMap) {
  const raw = getConfigValue_('flagConfig', cfgMap);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function getCertDefsFromMap_(cfgMap) {
  const raw = getConfigValue_('certDefs', cfgMap);
  if (!raw) return [];
  try { return normalizeCertDefsRaw_(JSON.parse(raw)); } catch (e) { return []; }
}

function getCertCategoriesFromMap_(cfgMap) {
  const raw = getConfigValue_('certCategories', cfgMap);
  if (!raw) return [];
  try { return normalizeCertCategoriesRaw_(JSON.parse(raw)); } catch (e) { return []; }
}

// Cached projection of the activities sheet into the two slices getConfig_ needs:
// volunteer rows (for the volunteerEvents DTO list) and cancelled-activity ids
// (for the daily-log virtual-suppression list). The 60s getConfig cache covers
// the hot path; this cache survives many config rebuilds (5min TTL) so plain
// config writes — flagConfig, staffStatus, etc. — don't pay for a fresh
// the activities sheet read. Invalidated by activity_upsert_ / activity_cancel_ /
// activity_hardDelete_ so any actual scheduled-events write rebuilds it.
//
// We cache parsed rows, not DTOs, so changes to activity_types (which feed the
// volunteer-event subtitle) don't need to clear this cache — getConfig_
// rebuilds DTOs on the fly from the in-scope cfgMap.
function _activitiesForConfig_() {
  var cached = cGet_('activities_for_config');
  if (cached) return cached;
  var volunteerRows = [];
  var cancelledActivityIds = [];
  try {
    (readAll_('activities') || []).forEach(function (r) {
      if (!r) return;
      var ev = activity_parseRow_(r);
      if (!ev) return;
      if (ev.signupRequired && ev.status !== 'cancelled') {
        volunteerRows.push(ev);
      } else if (!ev.signupRequired && ev.status === 'cancelled' && ev.id) {
        cancelledActivityIds.push(String(ev.id));
      }
    });
  } catch (e) {}
  var out = { volunteerRows: volunteerRows, cancelledActivityIds: cancelledActivityIds };
  cPut_('activities_for_config', out, 300);
  return out;
}

function getConfig_() {
  const c = cGet_('config'); if (c) return okJ(c);
  // Read the config sheet ONCE and look up all keys from the in-memory map
  const cfgMap = getConfigMap_();
  let activityTypes = [], dailyChecklist = { opening: [], closing: [] };
  try {
    activityTypes = JSON.parse(getConfigValue_('activity_templates', cfgMap) || '[]');
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
  // Single pass over the activities sheet: derive volunteerEvents (DTO shape) +
  // cancelled-activity tombstones. The parsed-row projection is cached
  // (see _activitiesForConfig_) so plain config writes don't pay for a
  // fresh sheet read; DTO conversion happens here using the in-scope
  // activityTypes so subtitle changes are picked up immediately.
  var classMap = {};
  (activityTypes || []).forEach(function (t) {
    if (t && t.id) classMap[t.id] = { classTag: t.classTag || '', classTagIS: t.classTagIS || '' };
  });
  var schedProj = _activitiesForConfig_();
  var volunteerEvents = [];
  (schedProj.volunteerRows || []).forEach(function (ev) {
    var dto = _schedToVolDto_(ev, classMap);
    if (dto) volunteerEvents.push(dto);
  });
  var cancelledActivityOccurrences = (schedProj.cancelledActivityIds || []).slice();
  var clubCalendars = [];
  try {
    var ccRaw = getConfigValue_('clubCalendars', cfgMap);
    if (ccRaw) clubCalendars = JSON.parse(ccRaw);
  } catch (e) {}
  // `activityTemplates` is the canonical name (an activity template defines
  // a recurring activity class).
  var activityTemplates = activityTypes;
  var config = { activityTemplates, dailyChecklist, overdueAlerts, flagConfig, flagOverride, certDefs, certCategories, boats, locations, launchChecklists, boatCategories, staffStatus, allowBreaks, charterCalendars, rowingPassport, volunteerEvents, clubCalendars, cancelledActivityOccurrences };
  cPut_('config', config);
  return okJ(config);
}

// ── Schedule projection ──────────────────────────────────────────────────────
// Produce activity items for a given local date. Used by getDailyLog_ to
// pre-populate today's/future days' activities without writing to the sheet
// until the row is actually saved or materialized at midnight.
//
// Each activity class picks its own schedule source:
//   - 'bulk' (default, legacy): expand the class's own bulkSchedule blob.
//   - 'calendar': read events from the class's Google Calendar for the date.
//     The read is cached briefly in projectActivitiesFromCalendar_.
//
// Each returned item mirrors the shape stored under dailyLog.activities so the
// frontend can treat scheduled + user-added activities uniformly:
//   { id, activityTypeId, classTag, name, start, end,
//     participants, notes, scheduled: true }
function projectActivitiesForDate_(dateISO) {
  if (!dateISO) return [];
  var classes = [];
  try { classes = JSON.parse(getConfigValue_('activity_templates', getConfigMap_()) || '[]'); } catch (e) { return []; }
  if (!Array.isArray(classes) || !classes.length) return [];
  var dow = String(new Date(dateISO + 'T12:00:00').getDay()); // '0'..'6'
  var out = [];
  classes.forEach(function(cls) {
    if (!cls || cls.active === false) return;
    // Calendar-sourced classes delegate to the gcal projection helper.
    if (String(cls.scheduleSource || 'bulk') === 'calendar') {
      try {
        var fromCal = projectActivitiesFromCalendar_(cls, dateISO);
        if (fromCal && fromCal.length) Array.prototype.push.apply(out, fromCal);
      } catch (e) { /* fall through silently — never block daily-log render */ }
      return;
    }
    // Bulk-scheduled classes expand the class's own bulkSchedule blob.
    if (!cls.bulkSchedule) return;
    var bs = cls.bulkSchedule;
    if (bs.fromDate && dateISO < bs.fromDate) return;
    if (bs.toDate   && dateISO > bs.toDate)   return;
    var days = Array.isArray(bs.daysOfWeek) ? bs.daysOfWeek.map(String) : [];
    if (!days.length || days.indexOf(dow) === -1) return;
    out.push({
      id:              'sched-' + cls.id + '-' + dateISO,
      activityTypeId:  cls.id,
      classTag:        cls.classTag   || '',
      classTagIS:      cls.classTagIS || '',
      name:            cls.name || '',
      start:           bs.startTime || cls.defaultStart || '',
      end:             bs.endTime   || cls.defaultEnd   || '',
      participants:    '',
      notes:           '',
      leaderMemberId:  cls.leaderMemberId || '',
      leaderName:      cls.leaderName || '',
      leaderPhone:     cls.leaderPhone || '',
      showLeaderPhone: cls.showLeaderPhone === true || cls.showLeaderPhone === 'true',
      scheduled:       true,
    });
  });
  return out;
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
  if (b.activityTypes) { setConfigSheetValue_('activity_templates', JSON.stringify(b.activityTypes)); saved.activityTypes = true; }
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
    // Flat activity-class shape. Each row in `activity_types` is now a
    // self-contained activity (no nested subtypes). The old "type" concept
    // collapses into the optional free-form `classTag` for grouping/filtering.
    let roles = [];
    try { roles = b.roles ? (Array.isArray(b.roles) ? b.roles : JSON.parse(b.roles)) : []; } catch(e) { roles = []; }
    let bulkSchedule = null;
    try {
      bulkSchedule = b.bulkSchedule
        ? (typeof b.bulkSchedule === 'string' ? JSON.parse(b.bulkSchedule) : b.bulkSchedule)
        : null;
    } catch(e) { bulkSchedule = null; }
    if (bulkSchedule && typeof bulkSchedule === 'object') {
      if (!Array.isArray(bulkSchedule.daysOfWeek)) bulkSchedule.daysOfWeek = [];
      bulkSchedule.daysOfWeek = bulkSchedule.daysOfWeek.map(String);
    }
    const isVol = b.volunteer === true || b.volunteer === 'true';
    let reservedBoatIds = [];
    try {
      var rb = b.reservedBoatIds
        ? (Array.isArray(b.reservedBoatIds) ? b.reservedBoatIds : JSON.parse(b.reservedBoatIds))
        : [];
      reservedBoatIds = (rb || []).map(String).filter(Boolean);
    } catch (e) { reservedBoatIds = []; }
    // Schedule source: 'bulk' (per-subtype bulkSchedule) or 'calendar' (read
    // from Google Calendar). Anything unrecognized falls back to 'bulk' so
    // legacy rows keep working.
    var scheduleSource = String(b.scheduleSource || 'bulk');
    if (scheduleSource !== 'calendar') scheduleSource = 'bulk';
    // Leader is now mandatory on every activity type — instances inherit it
    // at materialization time. leaderMemberId is the canonical key; leaderName
    // is the display fallback for free-text leaders or members whose names
    // change after the type was authored.
    var leaderMemberId  = String(b.leaderMemberId || '').trim();
    var leaderName      = String(b.leaderName || '').trim();
    var leaderPhone     = String(b.leaderPhone || '').trim();
    var showLeaderPhone = b.showLeaderPhone === true || b.showLeaderPhone === 'true';
    if (!leaderMemberId && !leaderName) {
      return failJ('saveActivityType failed: leader is required');
    }
    const res = saveConfigListItem_('activity_templates', {
      id: b.id || '',
      name: b.name,
      nameIS: b.nameIS || '',
      active: b.active !== false,
      classTag:   b.classTag   || '',
      classTagIS: b.classTagIS || '',
      calendarId: b.calendarId || '',
      calendarSyncActive: b.calendarSyncActive === true || b.calendarSyncActive === 'true',
      scheduleSource: scheduleSource,
      volunteer: isVol,
      roles: isVol ? roles : [],
      leaderMemberId: leaderMemberId,
      leaderName: leaderName,
      leaderPhone: leaderPhone,
      showLeaderPhone: showLeaderPhone,
      defaultStart: b.defaultStart || '',
      defaultEnd:   b.defaultEnd   || '',
      bulkSchedule: bulkSchedule || null,
      reservedBoatIds: reservedBoatIds,
      gcalSeriesEventId: b.gcalSeriesEventId || '',
    });
    // Master GCal recurring event lifecycle. syncClassRecurringEvent_ creates
    // the series the first time, updates it when the schedule/title changes,
    // or removes it when the class is deactivated / sync is turned off /
    // schedule is cleared. The returned id is persisted back so subsequent
    // saves point at the same series.
    var gcalId = '';
    try { gcalId = syncClassRecurringEvent_(res.item); } catch (e) { Logger.log('class gcal sync: ' + e); }
    if (gcalId !== (res.item.gcalSeriesEventId || '')) {
      saveConfigListItem_('activity_templates', { id: res.id, gcalSeriesEventId: gcalId || '' });
      res.item.gcalSeriesEventId = gcalId;
    }
    return okJ({ id: res.id, item: res.item });
  } catch(e) { return failJ('saveActivityType failed: ' + e.message); }
}

function deleteActivityType_(id) {
  try {
    let arr = JSON.parse(getConfigSheetValue_('activity_templates') || '[]');
    var deletedCls = arr.find(function(a) { return a && a.id === id; }) || null;
    arr = arr.filter(a => a.id !== id);
    setConfigSheetValue_('activity_templates', JSON.stringify(arr));
    // Master GCal recurring event tear-down. Per-instance exceptions stored
    // as activity rows are pruned by the cascade below.
    if (deletedCls && deletedCls.calendarId && deletedCls.gcalSeriesEventId) {
      try { Calendar.Events.remove(deletedCls.calendarId, deletedCls.gcalSeriesEventId); } catch (e) {}
    }
    // Cascade: remove volunteer events linked to this activity type and any
    // signups attached to them. Both bulk-materialized and manually-created
    // events are removed — from the admin's POV, everything that referenced
    // the type goes away.
    var removedEvents = 0;
    var removedSignups = 0;
    try {
      var linked = activity_listVolunteerEvents_().filter(function (ev) {
        if (!ev) return false;
        return (ev.sourceActivityTypeId && String(ev.sourceActivityTypeId) === String(id))
            || (ev.activityTypeId       && String(ev.activityTypeId)       === String(id));
      });
      if (linked.length) {
        var removedIds = {};
        linked.forEach(function (ev) { if (ev.id) removedIds[ev.id] = true; });
        // Tear down GCal twins BEFORE deleting the activity type row — the
        // GCal helper looks up the parent type to find the calendar.
        linked.forEach(function (ev) {
          try { deleteVolunteerEventCalendarEvent_(ev); } catch (err) {}
        });
        linked.forEach(function (ev) {
          try { activity_hardDelete_(ev.id); removedEvents++; } catch (err) {}
        });
        try {
          ensureVolunteerSignupsTab_();
          var signups = readAll_('volunteerSignups') || [];
          signups.forEach(function (s) {
            if (s && s.eventId && removedIds[s.eventId]) {
              try { deleteRow_('volunteerSignups', 'id', s.id); removedSignups++; } catch (e) {}
            }
          });
        } catch (e) { /* signups tab may not exist yet */ }
      }
    } catch (e) { Logger.log('deleteActivityType_ cascade failed: ' + e); }
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


