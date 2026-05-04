// ═══════════════════════════════════════════════════════════════════════════════
// PAYROLL  —  punch clock, employee records
// ═══════════════════════════════════════════════════════════════════════════════

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
  seedEmployees_();
  cDel_('employees'); cDel_('time_clock');
  return okJ({ initialised: true });
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
  insertRow_('timeClock', { id:uid_(), employeeId:b.employeeId, type:'in',
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
  insertRow_('timeClock', { id:uid_(), employeeId:b.employeeId, type:'out',
    timestamp:now, source:b.source||'staff', originalTimestamp:'',
    note:b.note||'', periodKey:periodKey_(), durationMinutes:dur });
  cDel_('time_clock');
  return okJ({ clocked:'out', timestamp:now, durationMinutes:dur });
}

function breakStart_(b) {
  if (!b.employeeId) return failJ('employeeId required');
  const entries = readAll_(TABS_.timeClock).filter(function(r){ return r.employeeId === b.employeeId; });
  const ins   = entries.filter(function(r){ return r.type === 'in'; });
  const outs  = entries.filter(function(r){ return r.type === 'out'; });
  const lastIn  = ins[ins.length-1];
  const lastOut = outs[outs.length-1];
  if (!lastIn || (lastOut && lastOut.timestamp > lastIn.timestamp))
    return failJ('Not clocked in');
  const brks  = entries.filter(function(r){ return r.type === 'break_start'; });
  const brkEs = entries.filter(function(r){ return r.type === 'break_end'; });
  const lastBrk  = brks[brks.length-1];
  const lastBrkE = brkEs[brkEs.length-1];
  if (lastBrk && (!lastBrkE || lastBrk.timestamp > lastBrkE.timestamp))
    return failJ('Already on break');
  const now = new Date().toISOString();
  insertRow_('timeClock', { id:uid_(), employeeId:b.employeeId, type:'break_start',
    timestamp:now, source:'staff', originalTimestamp:'', note:b.note||'', periodKey:periodKey_(), durationMinutes:0 });
  cDel_('time_clock');
  return okJ({ type:'break_start', timestamp:now });
}

function breakEnd_(b) {
  if (!b.employeeId) return failJ('employeeId required');
  const entries = readAll_(TABS_.timeClock).filter(function(r){ return r.employeeId === b.employeeId; });
  const brks  = entries.filter(function(r){ return r.type === 'break_start'; });
  const brkEs = entries.filter(function(r){ return r.type === 'break_end'; });
  const lastBrk  = brks[brks.length-1];
  const lastBrkE = brkEs[brkEs.length-1];
  if (!lastBrk || (lastBrkE && lastBrkE.timestamp > lastBrk.timestamp))
    return failJ('Not on break');
  const now = new Date().toISOString();
  const dur = Math.round((new Date(now) - new Date(lastBrk.timestamp)) / 60000);
  insertRow_('timeClock', { id:uid_(), employeeId:b.employeeId, type:'break_end',
    timestamp:now, source:'staff', originalTimestamp:'', note:b.note||'', periodKey:periodKey_(), durationMinutes:dur });
  cDel_('time_clock');
  return okJ({ type:'break_end', timestamp:now, durationMinutes:dur });
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
  updateRow_('timeClock','id',b.id,{
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
    sh.appendRow([id, b.employeeId, '', b.timestamp, 'admin', b.clockIn, literalWrite_(b.note || 'admin entry'), periodKey, b.durationMinutes]);
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
