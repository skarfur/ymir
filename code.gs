// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR SAILING CLUB — Apps Script Backend   v6
// ═══════════════════════════════════════════════════════════════════════════════
//
// v6 changes:
//  • Boats and locations moved from dedicated sheets to config sheet JSON
//    (getConfig now returns boats + locations; saveConfig accepts them)
//  • Removed one-time setup functions (addLangColumnIfNeeded, addAlertColumnsIfNeeded,
//    createSheetStructure) — run these from v5 if needed
//  • Removed now-unused getBoats_, saveBoat_, deleteBoat_, getLocations_,
//    saveLocation_, deleteLocation_ sheet-based handlers
// ═══════════════════════════════════════════════════════════════════════════════

const SHEET_ID_ = 'REDACTED';
const API_TOKEN_ = 'REDACTED';

const TABS_ = {
  members: 'members',
  dailyLog: 'daily_log',
  maintenance: 'maintenance',
  checkouts: 'checkouts',
  actTypes: 'activity_types',
  dailyCL: 'daily_checklist',
  incidents: 'incidents',
  trips: 'trips',
  config: 'config',
  employees: 'employees',
  timeClock: 'time_clock',
  payroll: 'payroll',
};

const CLUB_LANG_ = 'IS';


// ─────────────────────────────────────────────────────────────────────────────
// BILINGUAL STRING TABLE
// ─────────────────────────────────────────────────────────────────────────────

const GS_STRINGS_ = {
  'alert.subject': { EN: '⚠ OVERDUE{minor}: {boat} — {overdue}', IS: '⚠ YFIRTÍMA{minor}: {boat} — {overdue}' },
  'alert.minor': { EN: ' MINOR', IS: ' BARN' },
  'alert.overdueMins': { EN: '{n} min overdue', IS: '{n} mín yfirtíma' },
  'alert.overdueHrs': { EN: '{h}h {m}min overdue', IS: '{h}klst {m}mín yfirtíma' },
  'alert.header': { EN: '⚠ OVERDUE BOAT ALERT', IS: '⚠ YFIRTÍMA BÁTARVIÐVÖRUN' },
  'alert.headerMinor': { EN: '⚠ OVERDUE BOAT ALERT — MINOR SAILOR', IS: '⚠ YFIRTÍMA BÁTARVIÐVÖRUN — BARN' },
  'alert.boat': { EN: 'Boat', IS: 'Bátur' },
  'alert.sailor': { EN: 'Sailor', IS: 'Siglingamaður' },
  'alert.phone': { EN: 'Phone', IS: 'Sími' },
  'alert.noPhone': { EN: 'no phone on record', IS: 'ekkert símanúmer skráð' },
  'alert.guardian': { EN: 'Guardian', IS: 'Forráðamaður' },
  'alert.location': { EN: 'Location', IS: 'Staðsetning' },
  'alert.expectedReturn': { EN: 'Expected return', IS: 'Áætlaður skilatími' },
  'alert.checkedOut': { EN: 'Checked out', IS: 'Skráð út' },
  'alert.overdue': { EN: 'Overdue by', IS: 'Yfirtíma um' },
  'alert.silence': { EN: '✓ Silence alert', IS: '✓ Þagga viðvörun' },
  'alert.snooze': { EN: '⏱ Snooze {n}m', IS: '⏱ Fresta {n}mín' },
  'alert.openPortal': { EN: 'Open staff portal →', IS: 'Opna starfsmannasvæðið →' },
  'alert.footNote': {
    EN: 'Silence permanently removes this alert. Snooze hides it for {n} minutes.\nThe alert is automatically cleared when the sailor checks in.',
    IS: 'Þagging fjarlægir viðvörunina varanlega. Frestun felur hana í {n} mínútur.\nViðvörunin hverfur sjálfkrafa þegar siglingamaðurinn skráir sig inn.'
  },
  'alert.txt.title': { EN: 'OVERDUE BOAT ALERT — ÝMIR SAILING CLUB', IS: 'YFIRTÍMA BÁTARVIÐVÖRUN — ÝMIR SIGLINGAFÉLAG' },
  'alert.txt.silence': { EN: 'Silence alert:', IS: 'Þagga viðvörun:' },
  'alert.txt.snooze': { EN: 'Snooze alert:', IS: 'Fresta viðvörun:' },
  'alert.txt.portal': { EN: 'Staff portal:', IS: 'Starfsmannasvæði:' },
  'alert.sms': {
    EN: 'ÝMIR ALERT: {boat} ({name}{minor}) overdue {overdue}. Expected {ret} at {loc}. Phone: {phone}. {guardian}Portal: {url}',
    IS: 'ÝMIR VIÐVÖRUN: {boat} ({name}{minor}) yfirtíma {overdue}. Áætlaður skilatími {ret} við {loc}. Sími: {phone}. {guardian}Starfsmannasvæði: {url}'
  },
  'alert.sms.minor': { EN: ', MINOR', IS: ', BARN' },
  'alert.sms.guardian': { EN: 'Guardian: {p}. ', IS: 'Forráðamaður: {p}. ' },
  'resolve.silenced': {
    EN: 'Alert silenced. It will clear automatically when the sailor checks in.',
    IS: 'Viðvörun þögguð. Hún hverfur sjálfkrafa þegar siglingamaðurinn skráir sig inn.'
  },
  'resolve.snoozed': {
    EN: 'Alert snoozed for {n} minutes. You will receive another alert if the sailor has not returned.',
    IS: 'Viðvörun frestað um {n} mínútur. Þú færð aðra viðvörun ef siglingamaðurinn hefur ekki komið til baka.'
  },
  'resolve.invalid': { EN: 'Invalid or expired link.', IS: 'Ógildur eða útrunninn hlekkur.' },
  'resolve.unknown': { EN: 'Unknown operation.', IS: 'Óþekkt aðgerð.' },
  'resolve.error': { EN: 'Error: {msg}', IS: 'Villa: {msg}' },
  'resolve.portal': { EN: '→ Open staff portal', IS: '→ Opna starfsmannasvæðið' },
};

function gs_(key, vars, lang) {
  const L = lang || CLUB_LANG_;
  const entry = GS_STRINGS_[key];
  if (!entry) return key;
  let str = entry[L] || entry['EN'] || key;
  if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
  return str;
}


// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function ss_() { return SpreadsheetApp.openById(SHEET_ID_); }
function now_() { return new Date().toISOString(); }
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }
function bool_(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; }
function okJ(data) { return jsonR_({ success: true, ...data }); }
function failJ(msg, code) { return jsonR_({ success: false, error: msg, code: code || 400 }); }
function jsonR_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }


// ─────────────────────────────────────────────────────────────────────────────
// SHEET HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getSheet_(tabKey) {
  const name = TABS_[tabKey] || tabKey;
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('Tab not found: ' + name);
  return s;
}

const TIME_COLS_ = new Set(['checkedOutAt', 'checkedInAt', 'expectedReturn', 'timeOut', 'timeIn', 'returnBy']);

function sanitizeCell_(col, val) {
  if (!(val instanceof Date)) return val;
  const iso = val.toISOString();
  if (iso.startsWith('1899-12-3') || iso.startsWith('1899-12-2')) {
    return String(val.getHours()).padStart(2, '0') + ':' + String(val.getMinutes()).padStart(2, '0');
  }
  return TIME_COLS_.has(col) ? iso.slice(11, 16) : iso.slice(0, 10);
}

function readAll_(tabKey) {
  const sheet = getSheet_(tabKey);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  return data.slice(1)
    .map(row => {
      const o = {};
      headers.forEach((h, i) => { o[h] = sanitizeCell_(h, row[i]); });
      return o;
    })
    .filter(r => r[headers[0]] !== '' && r[headers[0]] !== null);
}

function findOne_(tabKey, field, value) {
  return readAll_(tabKey).find(r => String(r[field]).trim() === String(value).trim()) || null;
}

function insertRow_(tabKey, obj) {
  const sheet = getSheet_(tabKey);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
}

function addColIfMissing_(tabKey, colName) {
  const sheet = getSheet_(tabKey);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  if (!headers.includes(colName)) {
    sheet.getRange(1, headers.length + 1).setValue(colName);
  }
}
function ensureGroupCols_() {
  ['isGroup','participants','staffNames','boatNames','boatIds','activityTypeId','activityTypeName'].forEach(c => addColIfMissing_('checkouts', c));
}

function updateRow_(tabKey, keyField, keyValue, updates) {
  const sheet = getSheet_(tabKey);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const keyCol = headers.indexOf(keyField);
  if (keyCol < 0) throw new Error('Field not found: ' + keyField);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyCol]).trim() === String(keyValue).trim()) {
      Object.entries(updates).forEach(([k, v]) => {
        const col = headers.indexOf(k);
        if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(v);
      });
      return true;
    }
  }
  return false;
}

function deleteRow_(tabKey, keyField, keyValue) {
  const sheet = getSheet_(tabKey);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const keyCol = headers.indexOf(keyField);
  if (keyCol < 0) throw new Error('Field not found: ' + keyField);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][keyCol]).trim() === String(keyValue).trim()) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}


// ─────────────────────────────────────────────────────────────────────────────
// CACHE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function cGet_(k) { try { const v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function cPut_(k, v) { try { CacheService.getScriptCache().put(k, JSON.stringify(v), 60); } catch (e) { } }
function cDel_(k) { try { CacheService.getScriptCache().remove(k); } catch (e) { } }


// ─────────────────────────────────────────────────────────────────────────────
// ROUTING
// ─────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const b = e.parameter?.p ? JSON.parse(e.parameter.p) : (e.parameter || {});
    if (b.action === 'resolveFromEmail') return resolveFromEmail_(b);
    if (!b.token || b.token !== API_TOKEN_) return failJ('Unauthorized', 401);
    if (!b.action) return okJ({ status: 'ok', ts: now_() });
    return route_(b.action, b);
  } catch (err) { return failJ('Server error: ' + err.message, 500); }
}

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (!b.token || b.token !== API_TOKEN_) return failJ('Unauthorized', 401);
    return route_(b.action, b);
  } catch (err) { return failJ('Server error: ' + err.message, 500); }
}

function route_(action, b) {
  switch (action) {
    case 'validateMember': return validateMember_(b.kennitala);
    case 'getMembers': return getMembers_();
    case 'saveMember': return saveMember_(b);
    case 'deleteMember': return deleteMember_(b.id);
    case 'importMembers': return importMembers_(b.rows);
    case 'setLang': return setLang_(b.kennitala, b.lang);
    case 'getDailyLog': return getDailyLog_(b.date);
    case 'saveDailyLog': return saveDailyLog_(b);
    case 'getMaintenance': return getMaintenance_();
    case 'saveMaintenance': return saveMaintenance_(b);
    case 'resolveMaintenance': return resolveMaintenance_(b);
    case 'addMaintenanceComment': return addMaintenanceComment_(b);
    case 'deleteMaintenance':       return deleteMaintenance_(b);
    // ── PAYROLL ────────────────────────────────────────────────────────────────────
    case 'clockIn':             return clockIn_(b);
    case 'clockOut':            return clockOut_(b);
    case 'getTimeEntries':      return getTimeEntries_(b);
    case 'adminEditTime':       return adminEditTime_(b);
    case 'adminAddTime':    return adminAddTime_(b);
    case 'adminDeleteTime': return adminDeleteTime_(b);
    case 'getEmployees':        return getEmployees_();
    case 'saveEmployee':        return saveEmployee_(b);
    case 'closePayPeriod':      return closePayPeriod_(b);
    case 'getPayroll':          return getPayroll_(b);
    case 'generatePayslipData': return generatePayslipData_(b);
    case 'generateLaunamidlar': return generateLaunamidlar_(b);
    case 'getConfig': return getConfig_();
    case 'saveConfig': return saveConfig_(b);
    case 'saveActivityType': return saveActivityType_(b);
    case 'deleteActivityType': return deleteActivityType_(b.id);
    case 'saveChecklistItem': return saveChecklistItem_(b);
    case 'deleteChecklistItem': return deleteChecklistItem_(b.id);
    case 'saveCertDef': return saveCertDef_(b);
    case 'deleteCertDef': return deleteCertDef_(b.id);
    case 'saveMemberCert': return saveMemberCert_(b);
    case 'getIncidents': return getIncidents_();
    case 'createIncident': return createIncident_(b);
    case 'resolveIncident': return resolveIncident_(b);
    case 'addIncidentNote': return addIncidentNote_(b);
    case 'getActiveCheckouts': return getActiveCheckouts_();
    case 'saveCheckout': return saveCheckout_(b);
    case 'checkIn': return checkIn_(b);
    case 'deleteCheckout': return deleteCheckout_(b.id);
    case 'saveGroupCheckout': return saveGroupCheckout_(b);
    case 'groupCheckIn': return groupCheckIn_(b);
    case 'linkGroupCheckoutToActivity': return linkGroupCheckoutToActivity_(b);
    case 'getTrips': return getTrips_(b.kennitala, parseInt(b.limit) || 100, b);
    case 'saveTrip': return saveTrip_(b);
    case 'deleteTrip': return deleteTrip_(b.id);
    case 'requestValidation': return requestValidation_(b);
    case 'getWeather': return getWeather_();
    case 'getOverdueAlerts': return getOverdueAlerts_(b);
    case 'silenceAlert': return silenceAlert_(b);
    case 'handleAlertAction': return handleAlertAction_(b);
    case 'snoozeAlert': return snoozeAlert_(b);
    case 'resolveAlert':  return resolveAlert_(b);
    case 'saveAlertConfig': return saveAlertConfig_(b);
    default: return failJ('Unknown action: ' + action, 404);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MEMBERS
// ═══════════════════════════════════════════════════════════════════════════════

function validateMember_(kennitala) {
  if (!kennitala) return failJ('kennitala required');
  const m = findOne_('members', 'kennitala', String(kennitala).trim());
  if (!m) return failJ('Not found', 404);
  if (!bool_(m.active)) return failJ('Inactive account', 403);
  return okJ({
    member: {
      id: m.id, kennitala: m.kennitala, name: m.name, role: m.role,
      email: m.email || '', phone: m.phone || '',
      birthYear: m.birthYear || '', isMinor: bool_(m.isMinor),
      guardianName: m.guardianName || '', guardianKennitala: m.guardianKennitala || '',
      guardianPhone: m.guardianPhone || '',
      certifications: m.certifications || '',
      lang: m.lang || 'EN',
    }
  });
}

function getMembers_() {
  const c = cGet_('members'); if (c) return okJ({ members: c });
  const members = readAll_('members'); cPut_('members', members); return okJ({ members });
}

function saveMember_(b) {
  const ts = now_(), ex = b.id ? findOne_('members', 'id', b.id) : null;
  if (ex) {
    updateRow_('members', 'id', b.id, {
      name: b.name || ex.name, role: b.role || ex.role, email: b.email || '',
      phone: b.phone || '', birthYear: b.birthYear || '',
      isMinor: b.isMinor !== undefined ? bool_(b.isMinor) : ex.isMinor,
      guardianName: b.guardianName || '', guardianKennitala: b.guardianKennitala || '',
      guardianPhone: b.guardianPhone || '',
      active: b.active !== undefined ? bool_(b.active) : ex.active,
      updatedAt: ts,
    });
    cDel_('members'); return okJ({ id: b.id, updated: true });
  } else {
    const id = uid_();
    insertRow_('members', {
      id, kennitala: b.kennitala, name: b.name, role: b.role || 'member',
      email: b.email || '', phone: b.phone || '', birthYear: b.birthYear || '',
      isMinor: bool_(b.isMinor) || false,
      guardianName: b.guardianName || '', guardianKennitala: b.guardianKennitala || '',
      guardianPhone: b.guardianPhone || '', active: true,
      certifications: '', lang: b.lang || 'EN',
      createdAt: ts, updatedAt: ts,
    });
    cDel_('members'); return okJ({ id, created: true });
  }
}

function deleteMember_(id) {
  if (!id) return failJ('id required');
  updateRow_('members', 'id', id, { active: false, updatedAt: now_() });
  cDel_('members'); return okJ({ deleted: true });
}

function importMembers_(rows) {
  if (!Array.isArray(rows)) return failJ('rows array required');
  const ts = now_(); let created = 0, updated = 0;
  rows.forEach(r => {
    const ex = findOne_('members', 'kennitala', String(r.kennitala || '').trim());
    if (ex) {
      updateRow_('members', 'kennitala', ex.kennitala, {
        name: r.name || ex.name, email: r.email || ex.email || '',
        phone: r.phone || ex.phone || '', role: r.role || ex.role || 'member',
        birthYear: r.birthYear || ex.birthYear || '',
        isMinor: r.isMinor !== undefined ? bool_(r.isMinor) : ex.isMinor,
        guardianName: r.guardianName || ex.guardianName || '',
        guardianKennitala: r.guardianKennitala || ex.guardianKennitala || '',
        guardianPhone: r.guardianPhone || ex.guardianPhone || '',
        active: r.active !== undefined ? bool_(r.active) : ex.active,
        updatedAt: ts,
      });
      updated++;
    } else {
      insertRow_('members', {
        id: uid_(), kennitala: String(r.kennitala).trim(), name: r.name || '',
        role: r.role || 'member', email: r.email || '', phone: r.phone || '',
        birthYear: r.birthYear || '', isMinor: bool_(r.isMinor) || false,
        guardianName: r.guardianName || '', guardianKennitala: r.guardianKennitala || '',
        guardianPhone: r.guardianPhone || '', active: true,
        certifications: '', lang: 'EN',
        createdAt: ts, updatedAt: ts,
      });
      created++;
    }
  });
  cDel_('members'); return okJ({ created, updated });
}

function setLang_(kennitala, lang) {
  if (!kennitala) return failJ('kennitala required');
  const l = String(lang || '').toUpperCase();
  if (!['EN', 'IS'].includes(l)) return failJ('lang must be EN or IS');
  const updated = updateRow_('members', 'kennitala', String(kennitala).trim(), { lang: l, updatedAt: now_() });
  if (!updated) return failJ('Member not found', 404);
  cDel_('members');
  return okJ({ lang: l });
}


// ═══════════════════════════════════════════════════════════════════════════════
// DAILY LOG
// ═══════════════════════════════════════════════════════════════════════════════

function getDailyLog_(date) {
  const d = date || now_().slice(0, 10);
  const log = findOne_('dailyLog', 'date', d);
  return okJ({ log: log || null, date: d });
}

function saveDailyLog_(b) {
  const ts = now_(), date = b.date || ts.slice(0, 10);
  const ex = findOne_('dailyLog', 'date', date);
  if (ex) {
    updateRow_('dailyLog', 'date', date, {
      openingChecks: b.openingChecks !== undefined ? JSON.stringify(b.openingChecks) : ex.openingChecks,
      closingChecks: b.closingChecks !== undefined ? JSON.stringify(b.closingChecks) : ex.closingChecks,
      activities: b.activities !== undefined ? JSON.stringify(b.activities) : ex.activities,
      weatherLog: b.weatherLog !== undefined ? b.weatherLog : ex.weatherLog,
      narrative: b.narrative !== undefined ? b.narrative : ex.narrative,
      tideData: b.tideData !== undefined ? JSON.stringify(b.tideData) : ex.tideData,
      signedOffBy: b.signedOffBy || ex.signedOffBy || '',
      signedOffAt: b.signedOffAt || ex.signedOffAt || '',
      updatedBy: b.updatedBy || '', updatedAt: ts,
    });
    return okJ({ date, updated: true });
  } else {
    insertRow_('dailyLog', {
      id: uid_(), date,
      openingChecks: JSON.stringify(b.openingChecks || []),
      closingChecks: JSON.stringify(b.closingChecks || []),
      activities: JSON.stringify(b.activities || []),
      weatherLog: b.weatherLog || '', narrative: b.narrative || '',
      tideData: JSON.stringify(b.tideData || {}),
      signedOffBy: b.signedOffBy || '', signedOffAt: b.signedOffAt || '',
      updatedBy: b.updatedBy || '', createdAt: ts, updatedAt: ts,
    });
    return okJ({ date, created: true });
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAINTENANCE
// ═══════════════════════════════════════════════════════════════════════════════

function getMaintenance_() {
  const c = cGet_('maintenance'); if (c) return okJ({ requests: c });
  let requests = [];
  try { requests = readAll_('maintenance'); } catch (e) { requests = []; }
  cPut_('maintenance', requests);
  return okJ({ requests });
}

function saveMaintenance_(b) {
  const ts = now_(), id = uid_();
  let photoUrl = '';
  if (b.photoData && String(b.photoData).length < 200000) photoUrl = b.photoData;
  insertRow_('maintenance', {
    id, category: b.category || 'boat', boatId: b.boatId || '', boatName: b.boatName || '',
    itemName: b.itemName || '', part: b.part || '', severity: b.severity || 'medium',
    description: b.description || '', photoUrl,
    markOos: bool_(b.markOos) || false, reportedBy: b.reportedBy || '',
    source: b.source || 'staff', createdAt: ts,
    resolved: false, resolvedBy: '', resolvedAt: '', comments: '[]',
  });
  cDel_('maintenance');
  return okJ({ id, created: true });
}

function resolveMaintenance_(b) {
  if (!b.id) return failJ('id required');
  updateRow_('maintenance', 'id', b.id, { resolved: true, resolvedBy: b.resolvedBy || '', resolvedAt: now_() });
  cDel_('maintenance');
  return okJ({ resolved: true });
}
// ═══════════════════════════════════════════════════════════════════════════════
// PAYROLL  —  punch clock, employee records, pay calculation, launamiðar XML
// 2026 RSK constants; configurable via config.payroll
// ═══════════════════════════════════════════════════════════════════════════════

const TAX_2026_ = {
  bracketBase1: 498122, bracketBase2: 1398450,
  rate1: 0.3149, rate2: 0.3799, rate3: 0.4629,
  personalCredit: 72492, tryggingagjald: 0.0635,
  motframlag: 0.115, orlofsfe: 0.1017, lifeyrir: 0.04,
};

function seedEmployees_() {
  const sheet = getSheet_(TABS_.employees);
  if (sheet.getLastRow() > 1) return;
  const h = ['id','kt','name','title','bankAccount','orlofsreikningur',
    'baseRateKr','union','lifeyrir','sereignarsjodur','otherWithholdings',
    'active','startDate','memberId','payrollEnabled'];
  sheet.getRange(1,1,1,h.length).setValues([h]);
  const seed = [
    [uid_(),'2811062010','Stefania Agnes Benjaminsdottir','Fristundaleidbeinandi','0130-26-013131','0537-18-020866',3310,'VR',0.04,0.02,'[]',true,'2026-01-01','',true],
    [uid_(),'1504881209','Gunnar Thor Sigurdsson','Skipstjori','0101-26-045678','0101-18-045679',3800,'SGS',0.04,0.02,'[]',true,'2026-01-01','',true],
    [uid_(),'0703952479','Helga Run Magnusdottir','Leidbeinandi','0133-26-078901','0133-18-078902',3310,'VR',0.04,0.00,'[]',true,'2026-01-01','',true],
    [uid_(),'2209901539','Arni Mar Jonsson','Taeknimaður','0156-26-112233','0156-18-112234',3600,'VR',0.04,0.02,'[]',false,'2026-01-01','',false],
  ];
  seed.forEach(function(row,i){ sheet.getRange(i+2,1,1,row.length).setValues([row]); });
}

function initPayrollSheets_() {
  const ss = SpreadsheetApp.openById(SHEET_ID_);
  if (!ss.getSheetByName(TABS_.employees)) {
    const s = ss.insertSheet(TABS_.employees);
    s.getRange(1,1,1,15).setValues([['id','kt','name','title','bankAccount',
      'orlofsreikningur','baseRateKr','union','lifeyrir','sereignarsjodur',
      'otherWithholdings','active','startDate','memberId','payrollEnabled']]);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(TABS_.timeClock)) {
    const s = ss.insertSheet(TABS_.timeClock);
    s.getRange(1,1,1,9).setValues([['id','employeeId','type','timestamp',
      'source','originalTimestamp','note','periodKey','durationMinutes']]);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(TABS_.payroll)) {
    const s = ss.insertSheet(TABS_.payroll);
    s.getRange(1,1,1,18).setValues([['id','employeeId','period','hoursRegular',
      'hoursOT133','hoursOT155','grossWage','orlofsfe','grossTotal','lifeyrir',
      'sereignarsjodur','otherWithholdings','stadgreidslaSkattur','netPay',
      'tryggingagjald','motframlag','totalEmployerCost','generatedBy']]);
    s.setFrozenRows(1);
  }
  seedEmployees_();
  cDel_('employees'); cDel_('time_clock'); cDel_('payroll');
  return okJ({ initialised: true });
}

function payrollCfg_() {
  const raw = getConfig_();
  const p   = raw.payroll || {};
  return {
    baseRateKr:        p.baseRateKr        || 3310,
    ot133multiplier:   p.ot133multiplier   || 1.33,
    ot155multiplier:   p.ot155multiplier   || 1.55,
    otThreshold133:    p.otThreshold133    || 173,
    otThreshold155:    p.otThreshold155    || 200,
    payPeriodStartDay: p.payPeriodStartDay || 1,
    payPeriodEndDay:   p.payPeriodEndDay   || 31,
    employerKt:        p.employerKt        || '4705760659',
    employerName:      p.employerName      || 'Siglingafelagid Ymir',
    employerAddress:   p.employerAddress   || 'Reykjavik',
  };
}

function periodKey_(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

function clockIn_(b) {
  if (!b.employeeId) return failJ('employeeId required');
  const entries = readAll_(TABS_.timeClock).filter(function(r){ return r.employeeId === b.employeeId; });
  const ins  = entries.filter(function(r){ return r.type === 'in'; });
  const outs = entries.filter(function(r){ return r.type === 'out'; });
  const lastIn  = ins[ins.length-1];
  const lastOut = outs[outs.length-1];
  if (lastIn && (!lastOut || lastIn.timestamp > lastOut.timestamp))
    return failJ('Already clocked in since ' + lastIn.timestamp);
  const now = new Date().toISOString();
  insertRow_(TABS_.timeClock, { id:uid_(), employeeId:b.employeeId, type:'in',
    timestamp:now, source:b.source||'staff', originalTimestamp:'',
    note:b.note||'', periodKey:periodKey_(), durationMinutes:0 });
  cDel_('time_clock');
  return okJ({ clocked:'in', timestamp:now });
}

function clockOut_(b) {
  if (!b.employeeId) return failJ('employeeId required');
  const entries = readAll_(TABS_.timeClock).filter(function(r){ return r.employeeId === b.employeeId; });
  const ins  = entries.filter(function(r){ return r.type === 'in'; });
  const outs = entries.filter(function(r){ return r.type === 'out'; });
  const lastIn  = ins[ins.length-1];
  const lastOut = outs[outs.length-1];
  if (!lastIn || (lastOut && lastOut.timestamp > lastIn.timestamp))
    return failJ('Not clocked in');
  const now = new Date().toISOString();
  const dur = Math.round((new Date(now) - new Date(lastIn.timestamp)) / 60000);
  insertRow_(TABS_.timeClock, { id:uid_(), employeeId:b.employeeId, type:'out',
    timestamp:now, source:b.source||'staff', originalTimestamp:'',
    note:b.note||'', periodKey:periodKey_(), durationMinutes:dur });
  cDel_('time_clock');
  return okJ({ clocked:'out', timestamp:now, durationMinutes:dur });
}

function getTimeEntries_(b) {
  var rows = readAll_(TABS_.timeClock);
  if (b.employeeId) rows = rows.filter(function(r){ return r.employeeId === b.employeeId; });
  if (b.period)     rows = rows.filter(function(r){ return r.periodKey  === b.period; });
  return okJ({ entries:rows });
}

function adminEditTime_(b) {
  if (!b.id || !b.timestamp) return failJ('id and timestamp required');
  const row = readAll_(TABS_.timeClock).find(function(r){ return r.id === b.id; });
  if (!row) return failJ('Entry not found');
  updateRow_(TABS_.timeClock,'id',b.id,{
    timestamp:b.timestamp, originalTimestamp:row.originalTimestamp||row.timestamp,
    note:b.note||row.note||'admin edit', source:'admin',
    durationMinutes:b.durationMinutes!==undefined?b.durationMinutes:row.durationMinutes,
  });
  cDel_('time_clock');
  return okJ({ updated:true });
}

function adminAddTime_(b) {
  try {
    var sh = SpreadsheetApp.openById(SHEET_ID_).getSheetByName(TABS_.timeClock);
    var id = 'entry_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    // Column order matches sheet: id, employeeId, type, timestamp(clockOut), source, originalTimestamp(clockIn), note, periodKey, durationMinutes
    var periodKey = b.clockIn ? b.clockIn.slice(0,7) + '-01' : new Date().toISOString().slice(0,7) + '-01';
    sh.appendRow([id, b.employeeId, '', b.timestamp, 'admin', b.clockIn, b.note || 'admin entry', periodKey, b.durationMinutes]);
    return okJ({ success: true, id: id });
  } catch(e) {
    return failJ(e.message);
  }
}

function adminDeleteTime_(b) {
  try {
    var sh = SpreadsheetApp.openById(SHEET_ID_).getSheetByName(TABS_.timeClock);
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === String(b.id)) {
        sh.deleteRow(i + 1);
        return okJ({ success: true });
      }
    }
    return failJ('Entry not found');
  } catch(e) {
    return failJ(e.message);
  }
}

function getEmployees_() {
  initPayrollSheets_();
  return okJ({ employees:readAll_(TABS_.employees) });
}

function saveEmployee_(b) {
  if (!b.id) return failJ('id required');
  const existing = readAll_(TABS_.employees).find(function(r){ return r.id === b.id; });
  if (existing) {
    const fields = ['kt','name','title','bankAccount','orlofsreikningur','baseRateKr',
      'union','lifeyrir','sereignarsjodur','otherWithholdings','active','startDate',
      'memberId','payrollEnabled'];
    const u = {};
    fields.forEach(function(f){ if (b[f]!==undefined) u[f]=b[f]; });
    updateRow_(TABS_.employees,'id',b.id,u);
  } else {
    insertRow_(TABS_.employees,b);
  }
  cDel_('employees');
  return okJ({ saved:true });
}

function calcTax_(gross, lif, ser) {
  const t = TAX_2026_;
  const base = Math.max(0, gross*(1-lif-ser));
  var tax = base<=t.bracketBase1 ? base*t.rate1
    : base<=t.bracketBase2 ? t.bracketBase1*t.rate1+(base-t.bracketBase1)*t.rate2
    : t.bracketBase1*t.rate1+(t.bracketBase2-t.bracketBase1)*t.rate2+(base-t.bracketBase2)*t.rate3;
  return Math.max(0, Math.round(tax - t.personalCredit));
}

function closePayPeriod_(b) {
  // Frontend sends pre-calculated rows — store them directly so the committed
  // payslip always reflects the config values that were in effect at approval time.
  const rows = b.rows;
  if (!rows || !rows.length) return failJ('rows array required');
  const results = [];
  rows.forEach(function(r) {
    const row = Object.assign({}, r, { id: uid_(), generatedBy: b.by || 'admin' });
    insertRow_(TABS_.payroll, row);
    results.push(row);
  });
  cDel_('payroll');
  return okJ({ periodFrom: b.periodFrom, periodTo: b.periodTo, rows: results.length });
}

function getPayroll_(b) {
  var rows = readAll_(TABS_.payroll);
  if (b.period)     rows = rows.filter(function(r){ return r.period===b.period; });
  if (b.employeeId) rows = rows.filter(function(r){ return r.employeeId===b.employeeId; });
  const allRows = readAll_(TABS_.payroll);
  const fields  = ['grossWage','orlofsfe','grossTotal','lifeyrir','sereignarsjodur',
    'stadgreidslaSkattur','netPay','tryggingagjald','motframlag','totalEmployerCost',
    'hoursRegular','hoursOT133','hoursOT155'];
  rows.forEach(function(row) {
    const yr  = (row.period||'').slice(0,4);
    const ytd = allRows.filter(function(r){ return r.employeeId===row.employeeId && (r.period||'').startsWith(yr) && r.period<=row.period; });
    const tot = {};
    fields.forEach(function(f){ tot[f]=ytd.reduce(function(s,r){ return s+Number(r[f]||0); },0); });
    row._ytd = tot;
  });
  return okJ({ payroll:rows });
}

function generatePayslipData_(b) {
  if (!b.employeeId||!b.period) return failJ('employeeId and period required');
  const payRows = readAll_(TABS_.payroll).filter(function(r){ return r.employeeId===b.employeeId&&r.period===b.period; });
  if (!payRows.length) return failJ('No payroll record for this period');
  const emp = readAll_(TABS_.employees).find(function(r){ return r.id===b.employeeId; });
  if (!emp) return failJ('Employee not found');
  const yr  = b.period.slice(0,4);
  const all = readAll_(TABS_.payroll);
  const ytd = all.filter(function(r){ return r.employeeId===b.employeeId&&(r.period||'').startsWith(yr)&&r.period<=b.period; });
  const fields = ['grossWage','orlofsfe','grossTotal','lifeyrir','sereignarsjodur','stadgreidslaSkattur','netPay','hoursRegular','hoursOT133','hoursOT155'];
  const tot={};
  fields.forEach(function(f){ tot[f]=ytd.reduce(function(s,r){ return s+Number(r[f]||0); },0); });
  return okJ({ payslip:{ employee:emp, period:b.period, pay:payRows[0], ytd:tot, employer:payrollCfg_() } });
}

function generateLaunamidlar_(b) {
  var year = b.year || String(new Date().getFullYear());
  var cfg  = payrollCfg_();
  var emps = readAll_(TABS_.employees).filter(function(e){ return e.payrollEnabled===true||e.payrollEnabled==='true'; });
  var rows = readAll_(TABS_.payroll).filter(function(r){ return (r.period||'').indexOf(year)===0; });

  var byEmp = {};
  rows.forEach(function(r){
    if (!byEmp[r.employeeId]) byEmp[r.employeeId]={grossTotal:0,lifeyrir:0,sereignarsjodur:0,orlofsfe:0,stadgreidslaSkattur:0,tryggingagjald:0,motframlag:0};
    var e=byEmp[r.employeeId];
    ['grossTotal','lifeyrir','sereignarsjodur','orlofsfe','stadgreidslaSkattur','tryggingagjald','motframlag'].forEach(function(f){
      e[f]+=Number(r[f]||0);
    });
  });

  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<LS year="'+year+'" kt="'+xmlEsc_(cfg.employerKt)+'" name="'+xmlEsc_(cfg.employerName)+'">\n';

  emps.forEach(function(emp){
    var agg = byEmp[emp.id];
    if (!agg) return;
    var r02 = Math.round(agg.grossTotal);
    var r03 = Math.round(agg.lifeyrir+agg.sereignarsjodur);
    var r07 = Math.round(agg.orlofsfe);
    var r71 = Math.round(agg.stadgreidslaSkattur);
    xml += '  <launamidi>\n';
    xml += '    <kt>'+xmlEsc_(emp.kt)+'</kt>\n';
    xml += '    <n>'+xmlEsc_(emp.name)+'</n>\n';
    xml += '    <title>'+xmlEsc_(emp.title||'')+'</title>\n';
    xml += '    <r02>'+r02+'</r02>\n';
    xml += '    <r03>'+r03+'</r03>\n';
    xml += '    <r07>'+r07+'</r07>\n';
    xml += '    <r08>'+xmlEsc_(emp.union||'')+'</r08>\n';
    xml += '    <r70>'+r02+'</r70>\n';
    xml += '    <r71>'+r71+'</r71>\n';
    xml += '    <motframlag>'+Math.round(agg.motframlag)+'</motframlag>\n';
    xml += '    <tryggingagjald>'+Math.round(agg.tryggingagjald)+'</tryggingagjald>\n';
    xml += '  </launamidi>\n';
  });

  xml += '</LS>';
  return okJ({ xml:xml, year:year, employerKt:cfg.employerKt });
}
function xmlEsc_(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


function addMaintenanceComment_(b) {
  if (!b.id) return failJ('id required');
  if (!b.text) return failJ('text required');
  const ex = findOne_('maintenance', 'id', b.id);
  if (!ex) return failJ('Request not found', 404);
  let comments = [];
  try { comments = JSON.parse(ex.comments || '[]'); } catch (e) { comments = []; }
  comments.push({ by: b.by || '', at: now_(), text: b.text });
  updateRow_('maintenance', 'id', b.id, { comments: JSON.stringify(comments) });
  cDel_('maintenance');
  return okJ({ commented: true });
}

function deleteMaintenance_(b) {
  if (!b.id) return failJ('id required');
  const deleted = deleteRow_('maintenance', 'id', b.id);
  cDel_('maintenance');
  return okJ({ deleted: deleted });
}



// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG  —  getConfig bundles everything; boats + locations stored as JSON rows
// ═══════════════════════════════════════════════════════════════════════════════

function getConfig_() {
  const c = cGet_('config'); if (c) return okJ(c);
  let activityTypes = [], dailyChecklist = { am: [], pm: [] };
  try {
    activityTypes = JSON.parse(getConfigSheetValue_('activity_types') || '[]');
    // Ensure each type has a subtypes array (for backwards compat)
    activityTypes = activityTypes.map(function(t) {
      if (!t.subtypes) t.subtypes = [];
      else if (typeof t.subtypes === 'string') { try { t.subtypes = JSON.parse(t.subtypes); } catch(e) { t.subtypes = []; } }
      return t;
    });
  } catch (e) { }
  try {
    readAll_('dailyCL').filter(r => bool_(r.active)).forEach(r => {
      const phase = String(r.phase).toLowerCase();
      if (dailyChecklist[phase]) dailyChecklist[phase].push(r);
    });
  } catch (e) { }
  const overdueAlerts = getAlertConfig_();
  const flagConfig = getFlagConfig_();
  const staffStatus   = jsonR_(getConfigSheetValue_('staffStatus'));
  const certDefs = getCertDefs_();
  let boats = [], locations = [];
  try { var bRaw = getConfigSheetValue_('boats'); if (bRaw) boats = JSON.parse(bRaw); } catch (e) { }
  try { var lRaw = getConfigSheetValue_('locations'); if (lRaw) locations = JSON.parse(lRaw); } catch (e) { }
  let launchChecklists = {};
  try { var lRaw = getConfigSheetValue_('launchChecklists'); if (lRaw) launchChecklists = JSON.parse(lRaw); } catch (e) { }
  let boatCategories = [];
  try { var bcRaw = getConfigSheetValue_('boatCategories'); if (bcRaw) boatCategories = JSON.parse(bcRaw); } catch (e) { }
  const config = { activityTypes, dailyChecklist, overdueAlerts, flagConfig, certDefs, boats, locations, launchChecklists, boatCategories, staffStatus };
  cPut_('config', config);
  return okJ(config);
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

  if (b.boats !== undefined) {
    setConfigSheetValue_('boats', JSON.stringify(b.boats));
    saved.boats = true;
  }

  if (b.locations !== undefined) {
    setConfigSheetValue_('locations', JSON.stringify(b.locations));
  if (b.launchChecklists)  { setConfigSheetValue_('launchChecklists',  JSON.stringify(b.launchChecklists));  }
    saved.locations = true;
  }
  if (b.boatCategories)    { setConfigSheetValue_('boatCategories',    JSON.stringify(b.boatCategories));    }

  if (b.activityTypes) { setConfigSheetValue_('activity_types', JSON.stringify(b.activityTypes)); saved.activityTypes = true; }
  cDel_('config');
  return okJ({ saved });
}

function getFlagConfig_() {
  const raw = getConfigSheetValue_('flagConfig');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function saveActivityType_(b) {
  try {
    let arr = JSON.parse(getConfigSheetValue_('activity_types') || '[]');
    const ts  = now_();
    const idx = b.id ? arr.findIndex(a => a.id === b.id) : -1;
    // Parse subtypes safely — frontend sends as JSON string
    let subtypes = [];
    try { subtypes = b.subtypes ? (Array.isArray(b.subtypes) ? b.subtypes : JSON.parse(b.subtypes)) : []; } catch(e) { subtypes = []; }
    const item = { id: b.id || uid_(), name: b.name, nameIS: b.nameIS || '', active: b.active !== false, subtypes, updatedAt: ts };
    if (idx >= 0) arr[idx] = Object.assign(arr[idx], item);
    else arr.push(Object.assign(item, { createdAt: ts }));
    setConfigSheetValue_('activity_types', JSON.stringify(arr));
    cDel_('config');
    return okJ({ id: item.id, item });
  } catch(e) { return failJ('saveActivityType failed: ' + e.message); }
}

function deleteActivityType_(b) {
  try {
    let arr = JSON.parse(getConfigSheetValue_('activity_types') || '[]');
    arr = arr.filter(a => a.id !== b.id);
    setConfigSheetValue_('activity_types', JSON.stringify(arr));
    cDel_('config');
    return okJ({ deleted: true });
  } catch(e) { return failJ('deleteActivityType failed: ' + e.message); }
}

function saveChecklistItem_(b) {
  const ts = now_(), ex = b.id ? findOne_('dailyCL', 'id', b.id) : null;
  if (ex) {
    updateRow_('dailyCL', 'id', b.id, {
      phase: b.phase || ex.phase, textEN: b.textEN || ex.textEN, textIS: b.textIS || ex.textIS,
      active: b.active !== undefined ? b.active : ex.active,
      sortOrder: b.sortOrder || ex.sortOrder,
    });
    cDel_('config'); return okJ({ id: b.id, updated: true });
  } else {
    const id = uid_();
    insertRow_('dailyCL', {
      id, phase: b.phase || 'am', textEN: b.textEN, textIS: b.textIS || '',
      active: true, sortOrder: b.sortOrder || 99, createdAt: ts,
    });
    cDel_('config'); return okJ({ id, created: true });
  }
}

function deleteChecklistItem_(id) {
  if (!id) return failJ('id required');
  updateRow_('dailyCL', 'id', id, { active: false });
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
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function saveCertDef_(b) {
  if (!b.name) return failJ('name required');
  const defs = getCertDefs_();
  const payload = {
    id: b.id || ('cert_' + uid_()),
    name: String(b.name).trim(),
    description: String(b.description || '').trim(),
    renewalDays: Number(b.renewalDays) || 0,
    subcats: Array.isArray(b.subcats) ? b.subcats.map(s => ({
      key: String(s.key || s.label || '').toLowerCase().replace(/\s+/g, '_'),
      label: String(s.label || '').trim(),
      description: String(s.description || '').trim(),
      rank: s.rank != null ? Number(s.rank) : null,
    })).filter(s => s.label) : [],
  };
  const idx = defs.findIndex(d => d.id === payload.id);
  if (idx >= 0) defs[idx] = payload; else defs.push(payload);
  setConfigSheetValue_('certDefs', JSON.stringify(defs));
  cDel_('config');
  return okJ({ id: payload.id, saved: true });
}

function deleteCertDef_(id) {
  if (!id) return failJ('id required');
  const defs = getCertDefs_();
  const updated = defs.filter(d => d.id !== id);
  if (updated.length === defs.length) return failJ('Cert def not found', 404);
  setConfigSheetValue_('certDefs', JSON.stringify(updated));
  cDel_('config');
  return okJ({ deleted: true });
}

function saveMemberCert_(b) {
  if (!b.memberId) return failJ('memberId required');
  if (!Array.isArray(b.certifications)) return failJ('certifications array required');
  const defs = getCertDefs_();
  const byDef = {};
  b.certifications.forEach(c => {
    if (!byDef[c.certId]) byDef[c.certId] = [];
    byDef[c.certId].push(c);
  });
  const cleaned = [];
  Object.entries(byDef).forEach(([certId, entries]) => {
    const def = defs.find(d => d.id === certId);
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


// ═══════════════════════════════════════════════════════════════════════════════
// INCIDENTS
// ═══════════════════════════════════════════════════════════════════════════════

function getIncidents_() {
  const c = cGet_('incidents'); if (c) return okJ({ incidents: c });
  const incidents = readAll_('incidents'); cPut_('incidents', incidents); return okJ({ incidents });
}

function createIncident_(b) {
  const ts = now_(), id = uid_();
  insertRow_('incidents', {
    id, types: JSON.stringify(b.types || []), severity: b.severity || 'minor',
    date: b.date || ts.slice(0, 10), time: b.time || ts.slice(11, 16),
    locationId: b.locationId || '', locationName: b.locationName || '',
    boatId: b.boatId || '', boatName: b.boatName || '',
    description: b.description || '', involved: b.involved || '',
    witnesses: b.witnesses || '', immediateAction: b.immediateAction || '',
    followUp: b.followUp || '', handOffTo: b.handOffTo || '',
    handOffName: b.handOffName || '', handOffNotes: b.handOffNotes || '',
    photoUrls: '', filedBy: b.filedBy || '', filedAt: ts,
    resolved: false, resolvedAt: '', staffNotes: '',
  });
  cDel_('incidents'); return okJ({ id, created: true });
}

function resolveIncident_(b) {
  if (!b.id) return failJ('id required');
  updateRow_('incidents', 'id', b.id, { resolved: b.resolved, resolvedAt: b.resolvedAt || '' });
  cDel_('incidents'); return okJ({ updated: true });
}

function addIncidentNote_(b) {
  if (!b.id) return failJ('id required');
  const ex = findOne_('incidents', 'id', b.id);
  const notes = ex ? JSON.parse(ex.staffNotes || '[]') : [];
  notes.push({ by: b.by || '', at: now_(), text: b.text || '' });
  updateRow_('incidents', 'id', b.id, { staffNotes: JSON.stringify(notes) });
  cDel_('incidents'); return okJ({ updated: true });
}


// ═══════════════════════════════════════════════════════════════════════════════
// CHECKOUTS
// ═══════════════════════════════════════════════════════════════════════════════

function getActiveCheckouts_() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const all = readAll_('checkouts');
  const result = all.filter(c => c.status === 'out' || (c.status === 'in' && (c.createdAt || '') > cutoff));
  let memberMap = {};
  try { readAll_('members').forEach(m => { memberMap[String(m.kennitala)] = m; }); } catch (e) { }
  const enriched = result.map(c => {
    const m = memberMap[String(c.memberKennitala || '')] || {};
    return {
      ...c, memberPhone: m.phone || '', memberIsMinor: bool_(m.isMinor),
      guardianName: m.guardianName || '', guardianPhone: m.guardianPhone || ''
    };
  });
  cDel_('checkouts');
  return okJ({ checkouts: enriched });
}

function saveCheckout_(b) {
  const ts = now_(), id = uid_();
  let wxSnap = '';
  if (b.wxSnapshot) {
    try {
      const w = typeof b.wxSnapshot === 'string' ? JSON.parse(b.wxSnapshot) : b.wxSnapshot;
      wxSnap = JSON.stringify({
        bft: Math.round(w.bft || 0), ws: Math.round(w.ws || 0), wg: Math.round(w.wg || 0),
        dir: w.dir || w.wDir || '',
        wv: w.wv != null ? parseFloat(w.wv.toFixed ? w.wv.toFixed(1) : w.wv) : (w.waveH != null ? parseFloat(parseFloat(w.waveH).toFixed(1)) : null),
        flag: w.flag || w.flagKey || '',
        tc: w.tc != null ? Math.round(w.tc) : (w.airT != null ? Math.round(w.airT) : null),
        ts: w.ts || ts.slice(0, 16),
      });
    } catch (e) { wxSnap = ''; }
  }
  insertRow_('checkouts', {
    id, boatId: b.boatId || '', boatName: b.boatName || '', boatCategory: b.boatCategory || '',
    memberKennitala: b.memberKennitala || b.memberKt || b.kennitala || '',
    memberName: b.memberName || '', crew: b.crew || 1,
    locationId: b.locationId || '', locationName: b.locationName || '',
    checkedOutAt: b.checkedOutAt || b.timeOut || ts.slice(11, 16),
    expectedReturn: b.expectedReturn || b.returnBy || '',
    checkedInAt: '', wxSnapshot: wxSnap,
    preLaunchChecklist: b.preLaunchChecklist || '', notes: b.notes || '',
    status: 'out', createdAt: ts,
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
      wxSnap = JSON.stringify({
        bft: Math.round(w.bft||0), ws: Math.round(w.ws||0), wg: Math.round(w.wg||0),
        dir: w.dir||w.wDir||'',
        wv: w.wv != null ? parseFloat(parseFloat(w.wv).toFixed(1)) : null,
        flag: w.flag||'', tc: w.tc != null ? Math.round(w.tc) : null, ts: w.ts||ts.slice(0,16),
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
    checkedOutAt:    b.checkedOutAt || ts.slice(11,16),
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
  const checkedInAt = b.timeIn || now_().slice(11, 16);
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
  const checkedInAt = b.timeIn || now_().slice(11, 16);
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


// ═══════════════════════════════════════════════════════════════════════════════
// TRIPS
// ═══════════════════════════════════════════════════════════════════════════════

function getTrips_(kennitala, limit, p) {
  p = p || {};
  const all = readAll_('trips');
  const filtered = all.filter(t => (!kennitala || String(t.kennitala) === String(kennitala)) && (!p.date || (t.timeIn || t.date || '').slice(0, 10) === p.date));
  const sorted = filtered.sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);
  return okJ({ trips: sorted.slice(0, limit || 100) });
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
      'validationRequested',
    ];
    UPDATABLE.forEach(k => { if (b[k] !== undefined) updates[k] = b[k]; });
    updateRow_('trips', 'id', b.id, updates);
    return okJ({ id: b.id, updated: true });
  }

  // INSERT path
  const id = uid_();
  insertRow_('trips', {
    id, kennitala: b.kennitala || '', memberName: b.memberName || '',
    date: b.date || ts.slice(0, 10), timeOut: b.timeOut || '', timeIn: b.timeIn || '',
    hoursDecimal: b.hoursDecimal || 0,
    boatId: b.boatId || '', boatName: b.boatName || '', boatCategory: b.boatCategory || '',
    locationId: b.locationId || '', locationName: b.locationName || '',
    crew: b.crew || 1, role: b.role || 'skipper',
    beaufort: b.beaufort || '', windDir: b.windDir || '', wxSnapshot: b.wxSnapshot || '',
    notes: b.notes || '', isLinked: b.isLinked || false,
    linkedCheckoutId: b.linkedCheckoutId || '', linkedTripId: b.linkedTripId || '',
    verified: false, verifiedBy: '', verifiedAt: '', staffComment: '',
    validationRequested: b.validationRequested || false,
    createdAt: ts,
  });
  return okJ({ id, created: true });
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
// WEATHER
// ═══════════════════════════════════════════════════════════════════════════════

function getWeather_() {
  try {
    const res = UrlFetchApp.fetch('https://aviationweather.gov/api/data/metar?ids=BIRK&format=json', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return failJ('BIRK fetch failed: HTTP ' + res.getResponseCode());
    const data = JSON.parse(res.getContentText());
    const obs = Array.isArray(data) ? data[0] : null;
    if (!obs) return failJ('No BIRK METAR returned');
    return okJ({ obs });
  } catch (e) { return failJ('getWeather error: ' + e.message); }
}


// ═══════════════════════════════════════════════════════════════════════════════
// OVERDUE ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

function getAlertConfig_() {
  const raw = getConfigSheetValue_('overdueAlerts');
  const defaults = {
    enabled: true, firstAlertMins: 15, repeatMins: 30, snoozeMins: 30,
    channels: { web: true, email: false, sms: false },
    staffEmailList: [], staffSmsList: [],
  };
  if (!raw) return defaults;
  try {
    const p = JSON.parse(raw);
    return { ...defaults, ...p, channels: { ...defaults.channels, ...(p.channels || {}) } };
  } catch (e) { return defaults; }
}

function getConfigSheetValue_(key) {
  let sheet;
  try { sheet = getSheet_('config'); } catch (e) { return null; }
  if (sheet.getLastRow() < 2) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const row = data.find(r => String(r[0]).trim() === key);
  return row ? String(row[1]).trim() : null;
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
    if (idx !== -1) { sheet.getRange(idx + 2, 2).setValue(value); return; }
  }
  sheet.appendRow([key, value]);
}

function getOverdueAlerts_(b) {
  if (!b._serverSide && (!b || b.token !== API_TOKEN_)) throw new Error('Unauthorized');
  const cfg = getAlertConfig_();
  if (!cfg.enabled) { const ep = { success: true, alerts: [], snoozeMins: cfg.snoozeMins }; return b && b._serverSide ? ep : okJ(ep); }
  const sheet = getSheet_('checkouts');
  if (sheet.getLastRow() < 2) return okJ({ alerts: [], snoozeMins: cfg.snoozeMins });
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = name => headers.indexOf(name);
  const now_ms = Date.now();
  const now_dt = new Date();
  const todayStr = Utilities.formatDate(now_dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const nowMins = now_dt.getHours() * 60 + now_dt.getMinutes();
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  let memberMap = {};
  try { readAll_('members').forEach(m => { memberMap[String(m.kennitala)] = m; }); } catch (e) { }
  const alerts = [];
  data.forEach(row => {
    const status = String(row[col('status')] || '').trim();
    // date column doesn't exist — derive from checkedOutAt (may be a Date object or string)
    const coAtRaw  = row[col('checkedOutAt')];
    const date     = coAtRaw instanceof Date ? Utilities.formatDate(coAtRaw, Session.getScriptTimeZone(), 'yyyy-MM-dd')
                   : String(coAtRaw || '').slice(0, 10);
    // expectedReturn may be a Sheets Date object (1899 epoch for time values)
    const retByRaw  = row[col('expectedReturn')] || row[col('returnBy')];
    let   retBy     = '';
    if (retByRaw instanceof Date) {
      retBy = String(retByRaw.getHours()).padStart(2,'0') + ':' + String(retByRaw.getMinutes()).padStart(2,'0');
    } else {
      retBy = String(retByRaw || '').trim();
    }
    const silenced = row[col('alertSilenced')];
    if (status !== 'out') return;
    if (!retBy) return;
    // Parse retBy (HH:MM or 4-digit HHMM number)
    let retByStr = String(retBy).trim().replace(/[^0-9:]/g, '');
    if (retByStr.length === 4 && !retByStr.includes(':')) retByStr = retByStr.slice(0,2) + ':' + retByStr.slice(2);
    const [retH, retM] = retByStr.split(':').map(Number);
    if (isNaN(retH) || isNaN(retM)) return;
    // Build expected return as a full Date using today as base
    // (no reliable date stored in sheet for active checkouts)
    const retDt = new Date(todayStr + 'T' + String(retH).padStart(2,'0') + ':' + String(retM).padStart(2,'0') + ':00');
    // If retBy < checkedOutAt time (overnight), return is the following day
    const coAtVal  = row[col('checkedOutAt')];
    const coH      = coAtVal instanceof Date ? coAtVal.getHours() : parseInt((String(coAtVal||'').split(':')[0]||'0'), 10);
    if (!isNaN(coH) && retH < coH) retDt.setDate(retDt.getDate() + 1);
    const overdueMin = Math.round((now_ms - retDt.getTime()) / 60000);
    if (overdueMin < cfg.firstAlertMins) return;
    let snoozedUntil = null;
    const snoozeRaw = row[col('alertSnoozedUntil')];
    if (snoozeRaw) {
      const snoozeDate = new Date(snoozeRaw);
      if (!isNaN(snoozeDate) && snoozeDate.getTime() > now_ms) snoozedUntil = snoozeDate.toISOString();
    }
    const kt = String(row[col('memberKennitala')] || row[col('kennitala')] || '');
    const m = memberMap[kt] || {};
    const phone = String(row[col('memberPhone')] || m.phone || '');
    const isMinor = !!(m.isMinor === true || m.isMinor === 'true' || m.isMinor === 'TRUE');
    const guardianName = String(m.guardianName || '');
    const guardianPhone = String(m.guardianPhone || '');
    alerts.push({
      checkoutId: String(row[col('id')] || ''),
      boatName: String(row[col('boatName')] || '—'),
      memberName: String(row[col('memberName')] || '—'),
      memberPhone: phone, isMinor, guardianName, guardianPhone,
      locationName: String(row[col('locationName')] || '—'),
      expectedReturn: retBy, minutesOverdue: overdueMin,  checkoutDate: todayStr, launchTime: (function(){ var v=row[col('checkedOutAt')]; return v instanceof Date ? (String(v.getHours()).padStart(2,'0')+':'+String(v.getMinutes()).padStart(2,'0')) : String(v||''); })(),
      firstAlertSent: !!row[col('alertFirstSent')],
      snoozedUntil,
    });
  });
  alerts.sort((a, b) => b.minutesOverdue - a.minutesOverdue);
  const payload = { success: true, alerts, snoozeMins: cfg.snoozeMins };
  return b && b._serverSide ? payload : okJ(payload);
}

function silenceAlert_(b) {
  if (!b._serverSide && (!b || b.token !== API_TOKEN_)) throw new Error('Unauthorized');
  if (!b.id) throw new Error('id required');
  const row = getCheckoutRow_(b.id);
  if (!row) throw new Error('Checkout not found: ' + b.id);
  row._sheet.getRange(row._sheetRow, row._col1('alertSilenced')).setValue(true);
  row._sheet.getRange(row._sheetRow, row._col1('alertSilencedBy')).setValue(b.silencedBy || '');
  row._sheet.getRange(row._sheetRow, row._col1('alertSilencedAt')).setValue(now_());
  return okJ({ id: b.id });
}

function snoozeAlert_(b) {
  if (!b._serverSide && (!b || b.token !== API_TOKEN_)) throw new Error('Unauthorized');
  if (!b.id) throw new Error('id required');
  const cfg = getAlertConfig_();
  const mins = Number(b.snoozeMins) || cfg.snoozeMins || 30;
  const until = new Date(Date.now() + mins * 60000).toISOString();
  const row = getCheckoutRow_(b.id);
  if (!row) throw new Error('Checkout not found: ' + b.id);
  row._sheet.getRange(row._sheetRow, row._col1('alertSnoozedUntil')).setValue(until);
  return okJ({ id: b.id, snoozedUntil: until });
}

function getCheckoutRow_(id) {
  const sheet = getSheet_('checkouts');
  if (sheet.getLastRow() < 2) return null;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const col1 = name => headers.indexOf(name) + 1;
  const ids = sheet.getRange(2, col1('id'), sheet.getLastRow() - 1, 1).getValues().map(r => String(r[0]));
  const rowIdx = ids.indexOf(String(id));
  if (rowIdx === -1) return null;
  const sheetRow = rowIdx + 2;
  const values = sheet.getRange(sheetRow, 1, 1, lastCol).getValues()[0];
  const row = {};
  headers.forEach((h, i) => { row[h] = values[i]; });
  row._sheetRow = sheetRow; row._col1 = col1; row._sheet = sheet;
  return row;
}

function checkAndSendOverdueAlerts() {
  const cfg = getAlertConfig_();
  const result = getOverdueAlerts_({ _serverSide: true });
  const alerts = (result.success ? (result.alerts || []) : []);
  const props = PropertiesService.getScriptProperties();
  const now_ms = Date.now();
  const repeatMs = (cfg.repeatMins || 30) * 60000;
  alerts.forEach(alert => {
    if (alert.snoozedUntil && new Date(alert.snoozedUntil).getTime() > now_ms) return;
    const propKey = 'lastAlert_' + alert.checkoutId;
    const lastAlert = parseInt(props.getProperty(propKey) || '0', 10);
    const shouldSend = (lastAlert === 0) || (cfg.repeatMins > 0 && (now_ms - lastAlert) >= repeatMs);
    if (!shouldSend) return;
    let sent = false;
    if (cfg.channels.email && cfg.staffEmailList.length) {
      try { sendEmailAlert_(alert, cfg); sent = true; } catch (e) { Logger.log('Email failed: ' + e.message); }
    }
    if (cfg.channels.sms && cfg.staffSmsList.length) {
      try { sendSmsAlert_(alert, cfg); sent = true; } catch (e) { Logger.log('SMS failed: ' + e.message); }
    }
    if (sent || (!cfg.channels.email && !cfg.channels.sms)) props.setProperty(propKey, String(now_ms));
    if (!alert.firstAlertSent) {
      try {
        const row = getCheckoutRow_(alert.checkoutId);
        if (row) row._sheet.getRange(row._sheetRow, row._col1('alertFirstSent')).setValue(new Date().toISOString());
      } catch (e) { }
    }
  });
  const activeKeys = new Set(alerts.map(a => 'lastAlert_' + a.checkoutId));
  Object.keys(props.getProperties()).forEach(k => {
    if (k.startsWith('lastAlert_') && !activeKeys.has(k)) props.deleteProperty(k);
  });
}

function resolveFromEmail_(b) {
  try {
    const id = b.id || b.checkoutId;
    const action = b.op || b.action || 'silence';
    if (!b.token || b.token !== API_TOKEN_) return HtmlService.createHtmlOutput('<h2>Unauthorized.</h2>');
    // Find the checkout row
    const sheet = getSheet_('checkouts');
    const data  = sheet.getDataRange().getValues();
    const headers = data[0];
    const col = h => headers.indexOf(h);
    const rowIdx = data.findIndex((r, i) => i > 0 && String(r[col('id')]) === String(id));
    if (rowIdx > 0) {
      // Silence the alert
      sheet.getRange(rowIdx+1, col('alertSilenced')+1).setValue(true);
      if (action === 'checkInAndClose') {
        const L = CLUB_LANG_;
        const now = now_();
        const note = L === 'IS' ? 'Skráð inn sjálfvirkt í gegnum tölvupóstviðvörun.' : 'Checked in automatically via email alert.';
        sheet.getRange(rowIdx+1, col('status')+1).setValue('in');
        sheet.getRange(rowIdx+1, col('checkedInAt')+1).setValue(now);
        sheet.getRange(rowIdx+1, col('notes')+1).setValue(note);
        cDel_('checkouts');
        const L2 = CLUB_LANG_;
        return HtmlService.createHtmlOutput(`<h2 style="font-family:sans-serif;color:#27ae60">${L2==='IS'?'Bát skráður inn.':'Boat checked in.'}</h2><p>${note}</p>`);
      } else if (action === 'snooze') {
        const cfg = getAlertConfig_();
        const snoozeUntil = new Date(Date.now() + (cfg.snoozeMins||30)*60000).toISOString();
        sheet.getRange(rowIdx+1, col('snoozedUntil')+1).setValue(snoozeUntil);
        cDel_('checkouts');
        const L2 = CLUB_LANG_;
        return HtmlService.createHtmlOutput(`<h2 style="font-family:sans-serif;color:#e67e22">${L2==='IS'?'Viðvörun frestað.':'Alert snoozed.'}</h2>`);
      }
    }
    const L = CLUB_LANG_;
    return HtmlService.createHtmlOutput(`<h2 style="font-family:sans-serif">${L==='IS'?'Lokið.':'Done.'}</h2>`);
  } catch(e) {
    return HtmlService.createHtmlOutput('<h2>Error: ' + e.message + '</h2>');
  }
}

function handleAlertAction_(b) {
  // Web-based alert action — token-authenticated, no HMAC needed
  try {
    const id = b.id, action = b.action || 'silence';
    if (!id) return failJ('Missing id');
    const sheet   = getSheet_('checkouts');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const col     = h => headers.indexOf(h);
    const rowIdx  = data.findIndex((r, i) => i > 0 && String(r[col('id')]) === String(id));
    if (rowIdx < 1) return failJ('Checkout not found');
    const L = CLUB_LANG_;
    sheet.getRange(rowIdx+1, col('alertSilenced')+1).setValue(true);
    if (action === 'checkInAndClose') {
      const now = now_();
      const note = L === 'IS' ? 'Skráð inn af starfsmanni í gegnum vefalert.' : 'Checked in by staff via web alert.';
      sheet.getRange(rowIdx+1, col('status')+1).setValue('in');
      sheet.getRange(rowIdx+1, col('checkedInAt')+1).setValue(now);
      sheet.getRange(rowIdx+1, col('notes')+1).setValue(note);
      cDel_('checkouts');
      return okJ({ action, done: true, note });
    } else if (action === 'snooze') {
      const cfg = getAlertConfig_();
      const snoozeUntil = new Date(Date.now() + (cfg.snoozeMins||30)*60000).toISOString();
      sheet.getRange(rowIdx+1, col('alertSnoozedUntil')+1).setValue(snoozeUntil);
      cDel_('checkouts');
      return okJ({ action, done: true, snoozedUntil: snoozeUntil });
    }
    cDel_('checkouts');
    return okJ({ action, done: true });
  } catch(e) { return failJ('handleAlertAction failed: ' + e.message); }
}

function emailResponseHtml_(message, ok, lang) {
  const L = lang || CLUB_LANG_;
  const color = ok ? '#27ae60' : '#e74c3c';
  const icon = ok ? '✓' : '⚠';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ÝMIR</title>
<style>body{font-family:monospace;background:#071526;color:#d6e4f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#0b1f38;border:1px solid #1e3a5a;border-radius:12px;padding:36px 40px;max-width:420px;text-align:center}
.icon{font-size:32px;color:${color};margin-bottom:16px}.msg{font-size:14px;line-height:1.6}
.sub{font-size:11px;color:#6b92b8;margin-top:16px}a{color:#d4af37}</style></head>
<body><div class="card"><div class="icon">${icon}</div><div class="msg">${message}</div>
<div class="sub"><a href="https://skarfur.github.io/ymir/staff/">${htmlEsc_(gs_('resolve.portal', null, L))}</a></div>
</div></body></html>`;
}

function htmlEsc_(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sendEmailAlert_(alert, cfg) {
  const L = CLUB_LANG_;
  const secret   = API_TOKEN_;  // used as tok param in action URLs
  const staffUrl = 'https://skarfur.github.io/ymir/staff/';
  function actionUrl(op) {
    return staffUrl + '?alertAction=' + op + '&id=' + encodeURIComponent(alert.checkoutId) + '&tok=' + encodeURIComponent(secret);
  }
  const hrs = Math.floor(alert.minutesOverdue / 60);
  const min = alert.minutesOverdue % 60;
  const overdueDisplay = hrs > 0
    ? gs_('alert.overdueHrs', { h: hrs, m: min }, L)
    : gs_('alert.overdueHrs', { h: 0, m: min }, L).replace(L === 'IS' ? /^0klst\s/ : /^0h\s/, '');
  const minorSuffix = alert.isMinor ? gs_('alert.minor', null, L) : '';
  const subject = gs_('alert.subject', {
    minor: minorSuffix, boat: alert.boatName,
    overdue: hrs > 0 ? gs_('alert.overdueHrs', { h: hrs, m: min }, L) : gs_('alert.overdueMins', { n: min }, L)
  }, L);
  const guardianHtml = alert.isMinor && (alert.guardianName || alert.guardianPhone)
    ? `<tr><td style="color:#6b92b8;padding:5px 0;vertical-align:top;width:160px">${gs_('alert.guardian', null, L)}</td>
       <td style="color:#f5d76e">${htmlEsc_(alert.guardianName || '—')}${alert.guardianPhone ? '<br><a href="tel:' + htmlEsc_(alert.guardianPhone) + '" style="color:#d4af37">' + htmlEsc_(alert.guardianPhone) + '</a>' : ''}</td></tr>` : '';
  const guardianText = alert.isMinor && (alert.guardianName || alert.guardianPhone)
    ? '\n' + gs_('alert.guardian', null, L) + ':  ' + (alert.guardianName || '—') + (alert.guardianPhone ? ' · ' + alert.guardianPhone : '') : '';
  const body = [
    gs_('alert.txt.title', null, L), '',
    gs_('alert.boat', null, L) + ':  ' + alert.boatName,
    gs_('alert.sailor', null, L) + ':  ' + alert.memberName + (alert.isMinor ? gs_('alert.minor', null, L) : ''),
    gs_('alert.phone', null, L) + ':  ' + (alert.memberPhone || gs_('alert.noPhone', null, L)),
    guardianText,
    gs_('alert.location', null, L) + ':  ' + alert.locationName,
    gs_('alert.expectedReturn', null, L) + ':  ' + alert.expectedReturn,
    gs_('alert.overdue', null, L) + ':  ' + overdueDisplay, '',
    gs_('alert.txt.silence', null, L) + '  ' + actionUrl('silence'),
    gs_('alert.txt.snooze', null, L) + '  ' + actionUrl('snooze'), '',
    gs_('alert.txt.portal', null, L) + '  https://skarfur.github.io/ymir/staff/', '',
    '— ÝMIR',
  ].filter(l => l !== null).join('\n');
  const footNote = gs_('alert.footNote', { n: cfg.snoozeMins }, L);
  const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#071526;font-family:'Courier New',monospace">
<div style="max-width:560px;margin:0 auto">
  <div style="background:#e74c3c;color:#fff;padding:14px 20px;border-radius:6px 6px 0 0;font-size:16px;font-weight:bold">
    ${L==='IS'?'⚠️ Bátur er tímaseinaður':'⚠️ Boat Overdue'}
  </div>
  <div style="background:#0b1f38;border:1px solid #1e3a5a;border-top:none;padding:20px 24px">
    <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="color:#7a9cbe;padding:5px 0;width:40%">${L==='IS'?'Félagi':'Member'}</td><td style="color:#fff;padding:5px 0">${alert.memberName}${minorSuffix}</td></tr>
      <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Bátur':'Boat'}</td><td style="color:#fff;padding:5px 0">${alert.boatName}</td></tr>
      <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Siglingasvæði':'Sailing area'}</td><td style="color:#fff;padding:5px 0">${alert.locationName}</td></tr>
      <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Lagði af stað':'Launched'}</td><td style="color:#fff;padding:5px 0">${alert.launchTime||'—'}</td></tr>
      <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Áætlaður skilatími':'Expected return'}</td><td style="color:#fff;padding:5px 0">${alert.expectedReturn}</td></tr>
      <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Seinkun':'Overdue by'}</td><td style="color:#e74c3c;padding:5px 0;font-weight:bold">${overdueDisplay}</td></tr>
      ${alert.isMinor
        ? `<tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Forráðamaður':'Guardian'}</td><td style="color:#fff;padding:5px 0">${alert.guardianName||'—'}</td></tr>
           <tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Sími forráðamanns':'Guardian phone'}</td><td style="color:#fff;padding:5px 0">${alert.guardianPhone||'—'}</td></tr>`
        : `<tr><td style="color:#7a9cbe;padding:5px 0">${L==='IS'?'Sími':'Phone'}</td><td style="color:#fff;padding:5px 0">${alert.memberPhone||'—'}</td></tr>`
      }
    </table>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <a href="${actionUrl('checkInAndClose')}" style="flex:1;min-width:160px;display:block;background:#27ae60;color:#fff;text-align:center;padding:12px 16px;border-radius:5px;text-decoration:none;font-weight:bold;font-size:13px">
        ${L==='IS'?'✓ Skrá inn &amp; loka viðvörun':'✓ Check in &amp; close alert'}
      </a>
      <a href="${actionUrl('snooze')}" style="flex:1;min-width:120px;display:block;background:#e67e22;color:#fff;text-align:center;padding:12px 16px;border-radius:5px;text-decoration:none;font-weight:bold;font-size:13px">
        ${L==='IS'?'⏱ Fresta ('+cfg.snoozeMins+' mín)':'⏱ Snooze ('+cfg.snoozeMins+' min)'}
      </a>
    </div>
  </div>
</div>
</body></html>` ;
  MailApp.sendEmail({
    to: cfg.staffEmailList.join(','), subject, body, htmlBody,
    name: 'ÝMIR Siglingafélag — Öryggisviðvörun', replyTo: cfg.staffEmailList[0] || ''
  });
  Logger.log('Alert email sent for ' + alert.checkoutId + ' (' + alert.boatName + ')');
}

function sendSmsAlert_(alert, cfg) {
  const L = CLUB_LANG_;
  const hrs = Math.floor(alert.minutesOverdue / 60);
  const min = alert.minutesOverdue % 60;
  const overdueStr = hrs > 0
    ? gs_('alert.overdueHrs', { h: hrs, m: min }, L)
    : gs_('alert.overdueHrs', { h: 0, m: min }, L).replace(L === 'IS' ? /^0klst\s/ : /^0h\s/, '');
  const message = gs_('alert.sms', {
    boat: alert.boatName, name: alert.memberName,
    minor: alert.isMinor ? gs_('alert.sms.minor', null, L) : '',
    overdue: overdueStr, ret: alert.expectedReturn, loc: alert.locationName,
    phone: alert.memberPhone || gs_('alert.noPhone', null, L),
    guardian: (alert.isMinor && alert.guardianPhone) ? gs_('alert.sms.guardian', { p: alert.guardianPhone }, L) : '',
    url: 'https://skarfur.github.io/ymir/staff/',
  }, L);
  cfg.staffSmsList.forEach(to => {
    Logger.log('[SMS] to=' + to + ' | ' + message);
  });
}

// ── One-time migration — run from Apps Script editor ───────────────────────
function migrateTripColumns() {
  var ss    = SpreadsheetApp.openById(SHEET_ID_);
  var sheet = ss.getSheetByName("trips");
  if (!sheet) { Logger.log("trips sheet not found"); return; }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log("Current headers: " + headers.join(", "));

  // Columns to remove
  var toRemove = ["windMs","seaState","precip","waveHeight","launchBeaufort","launchWindDir","launchWaveHeight"];

  // Add wxSnapshot if missing
  if (headers.indexOf("wxSnapshot") === -1) {
    sheet.getRange(1, headers.length + 1).setValue("wxSnapshot");
    headers.push("wxSnapshot");
    Logger.log("Added wxSnapshot column");
  }

  // Remove redundant columns (work right-to-left so indices stay valid)
  var removeIndices = [];
  toRemove.forEach(function(name) {
    var idx = headers.indexOf(name);
    if (idx !== -1) removeIndices.push(idx + 1);  // 1-based
  });
  removeIndices.sort(function(a,b){return b-a;});
  removeIndices.forEach(function(col) {
    sheet.deleteColumn(col);
    Logger.log("Deleted column " + col);
  });

  Logger.log("Migration complete. New headers: " + 
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].join(", "));
}

// ── resolveAlert: called by the email relay page ────────────────────────────
function resolveAlert_(b) {
  try {
    if (!b.token || b.token !== API_TOKEN_) return failJ('Unauthorized', 401);
    const id  = b.checkoutId || b.id;
    const op  = b.op || 'silence';
    if (!id) return failJ('Missing id');
    const sheet  = getSheet_('checkouts');
    const data   = sheet.getDataRange().getValues();
    const headers = data[0];
    const col    = h => headers.indexOf(h);
    const rowIdx = data.findIndex((r, i) => i > 0 && String(r[col('id')]) === String(id));
    if (rowIdx < 1) return failJ('Checkout not found');
    // Silence the alert in all cases
    sheet.getRange(rowIdx+1, col('alertSilenced')+1).setValue(true);
    if (op === 'checkInAndClose') {
      const L            = CLUB_LANG_;
      const checkedInAt  = now_().slice(11, 16);
      const note         = L === 'IS' ? 'Skráð inn í gegnum viðvörun á vef.' : 'Checked in via web alert.';
      sheet.getRange(rowIdx+1, col('status')+1).setValue('in');
      sheet.getRange(rowIdx+1, col('checkedInAt')+1).setValue(checkedInAt);
      sheet.getRange(rowIdx+1, col('notes')+1).setValue(note);
    } else if (op === 'snooze') {
      const cfg = getAlertConfig_();
      const until = new Date(Date.now() + (cfg.snoozeMins||30)*60000).toISOString();
      sheet.getRange(rowIdx+1, col('alertSnoozedUntil')+1).setValue(until);
      // Un-silence so repeat alerts fire after snooze
      sheet.getRange(rowIdx+1, col('alertSilenced')+1).setValue(false);
    }
    cDel_('checkouts');
    return okJ({ ok: true, op });
  } catch(e) { return failJ('resolveAlert failed: ' + e.message); }
}

// ── Overdue alert trigger setup ─────────────────────────────────────────────
// Run setupOverdueTrigger() once from the Apps Script editor to register
// the 10-minute time-based trigger for checkAndSendOverdueAlerts.
function setupOverdueTrigger() {
  // Delete any existing triggers for this function to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'checkAndSendOverdueAlerts') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('checkAndSendOverdueAlerts')
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log('Overdue alert trigger registered: every 10 minutes');
}

// ── Diagnostic: show current alert state ────────────────────────────────────
function diagOverdueState() {
  const props  = PropertiesService.getScriptProperties().getProperties();
  const alerts = Object.keys(props).filter(k => k.startsWith('lastAlert_'));
  alerts.forEach(k => Logger.log(k + ' = ' + props[k] + ' (' + Math.round((Date.now()-parseInt(props[k]))/60000) + 'min ago)'));
  const result = getOverdueAlerts_({ _serverSide: true });
  Logger.log('alerts found: ' + (result.alerts||[]).length);
  (result.alerts||[]).forEach(a => Logger.log('  ' + a.memberName + ' ' + a.boatName + ' overdue=' + a.minutesOverdue + 'min silenced=' + a.silenced));
}

