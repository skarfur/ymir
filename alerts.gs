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

// Read the entire config sheet once and return a key→value map
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
  return v !== undefined ? v : null;
}

function getAlertConfigFromMap_(cfgMap) {
  const raw = getConfigValue_('overdueAlerts', cfgMap);
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
//   saveConfigListItem_('activity_types', { id, ...fields })
//     → inserts if id empty/missing; merges into existing row otherwise.
//       Returns { id, item, created|updated: true }.
//
//   deleteConfigListItem_('activity_types', id, { soft: true })
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
  // Handbook tabs read this same store via getHandbook_, which keeps its
  // own derived cache. Drop it here so handbook* writes invalidate both.
  if (String(key).indexOf('handbook') === 0) cDel_('handbook');
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
  if (String(key).indexOf('handbook') === 0) cDel_('handbook');
  return soft ? { deactivated: true } : { deleted: true };
}

// ── Validation helpers ────────────────────────────────────────────────────────
// Throw-based validators meant to be wrapped by the handler's own try/catch
// (which converts the error into a failJ response). Terse enough at call site
// that using them is usually shorter than an explicit if/return.
//
//   const mid = requireField_(b, 'memberId');             // throws if missing
//   const m   = requireMember_(mid);                      // 404 if no row
function requireField_(b, field, msg) {
  var v = b && b[field];
  if (v == null || v === '') throw new Error(msg || (field + ' required'));
  return v;
}

function requireMember_(id) {
  if (!id) throw new Error('memberId required');
  var m = findOne_('members', 'id', id);
  if (!m) throw new Error('Member not found');
  return m;
}

function getOverdueAlerts_(b) {
  if (!b._serverSide && (!b || b.token !== API_TOKEN_)) throw new Error('Unauthorized');
  const cfg = getAlertConfig_();
  if (!cfg.enabled) { const ep = { success: true, alerts: [], snoozeMins: cfg.snoozeMins }; return b && b._serverSide ? ep : okJ(ep); }
  const sheet = getSheet_('checkouts');
  if (sheet.getLastRow() < 2) return okJ({ alerts: [], snoozeMins: cfg.snoozeMins });
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = name => requiredCol_(headers, name);
  const now_ms = Date.now();
  const now_dt = new Date();
  const todayStr = Utilities.formatDate(now_dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const nowMins = now_dt.getHours() * 60 + now_dt.getMinutes();
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  let memberMap = {};
  try { memberMap = getMemberMap_(); } catch (e) { }
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
    // Build expected return relative to the actual checkout date (createdAt is a full ISO
    // timestamp set on insert). Anchoring on today breaks once the wall clock crosses midnight
    // for an overnight checkout — the alert would never fire.
    const createdRaw = row[col('createdAt')];
    const createdDt  = createdRaw instanceof Date ? createdRaw
                     : (createdRaw ? new Date(createdRaw) : null);
    const baseDateStr = (createdDt && !isNaN(createdDt.getTime()))
      ? Utilities.formatDate(createdDt, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : todayStr;
    const retDt = new Date(baseDateStr + 'T' + String(retH).padStart(2,'0') + ':' + String(retM).padStart(2,'0') + ':00');
    // If retBy < checkedOutAt time (overnight), return is the day after the checkout
    const coAtVal  = row[col('checkedOutAt')];
    const coH      = coAtVal instanceof Date ? coAtVal.getHours()
                   : parseInt((String(coAtVal||'').split(':')[0]||'0'), 10);
    const coM      = coAtVal instanceof Date ? coAtVal.getMinutes()
                   : parseInt((String(coAtVal||'').split(':')[1]||'0'), 10);
    if (!isNaN(coH) && (retH * 60 + retM) < ((coH || 0) * 60 + (coM || 0))) {
      retDt.setDate(retDt.getDate() + 1);
    }
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
    const isMinor = row[col('memberIsMinor')] !== undefined && row[col('memberIsMinor')] !== ''
      ? bool_(row[col('memberIsMinor')])
      : !!(m.isMinor === true || m.isMinor === 'true' || m.isMinor === 'TRUE');
    const guardianName = String(row[col('guardianName')] || m.guardianName || '');
    const guardianPhone = String(row[col('guardianPhone')] || m.guardianPhone || '');
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
  row._sheet.getRange(row._sheetRow, row._col1('alertSilencedBy')).setValue(literalWrite_(b.silencedBy || ''));
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
  const col1 = name => requiredCol_(headers, name) + 1;
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
  clearSheetCache_();
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
    const col = h => requiredCol_(headers, h);
    const rowIdx = data.findIndex((r, i) => i > 0 && String(r[col('id')]) === String(id));
    if (rowIdx > 0) {
      // Silence the alert
      sheet.getRange(rowIdx+1, col('alertSilenced')+1).setValue(true);
      if (action === 'checkInAndClose') {
        const L = CLUB_LANG_;
        const note = L === 'IS' ? 'Skráð inn sjálfvirkt í gegnum tölvupóstviðvörun.' : 'Checked in automatically via email alert.';
        sheet.getRange(rowIdx+1, col('status')+1).setValue('in');
        sheet.getRange(rowIdx+1, col('checkedInAt')+1).setValue(nowLocalTime_());
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
    const col     = h => requiredCol_(headers, h);
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
  const icon = ok ? '✓' : '⚠️';
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
    const col    = h => requiredCol_(headers, h);
    const rowIdx = data.findIndex((r, i) => i > 0 && String(r[col('id')]) === String(id));
    if (rowIdx < 1) return failJ('Checkout not found');
    // Silence the alert in all cases
    sheet.getRange(rowIdx+1, col('alertSilenced')+1).setValue(true);
    if (op === 'checkInAndClose') {
      const L            = CLUB_LANG_;
      const checkedInAt  = nowLocalTime_();
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

