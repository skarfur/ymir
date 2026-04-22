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
  insertRow_(TABS_.timeClock, { id:uid_(), employeeId:b.employeeId, type:'break_start',
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
  insertRow_(TABS_.timeClock, { id:uid_(), employeeId:b.employeeId, type:'break_end',
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

  // Ensure newer columns exist in the payroll sheet
  ['periodFrom','periodTo','paymentDate','slipNumber','employeeName','kt',
   'bankAccount','orlofsreikningur','title','baseRateKr','regularMinutes',
   'otMinutes','manualLines','dagvinna','eftirvinna1','eftirvinna2','otLines',
   'orlofslaun','orlofsRate','manualTotal','employeePension','sereignarsjodur',
   'sereignRate','unionDues','taxBase','taxGross','personalCredit',
   'taxWithheld','taxAfterCredit','orlofIBanki','totalDeductions',
   'employerPension','endurhaefingarsjodur','regularHrs','ot1Hrs','ot2Hrs',
   'pensionRate','configSnapshot','approved','totalHours'
  ].forEach(function(c) { addColIfMissing_(TABS_.payroll, c); });

  // Generate slip numbers: YY0M0x based on payment date month
  var payDate = b.paymentDate || '';
  var yy = payDate.slice(2, 4) || '00';
  var mm = payDate.slice(5, 7) || '01';
  var prefix = yy + mm;
  // Find the highest existing counter for this prefix
  var existing = readAll_(TABS_.payroll);
  var maxCounter = 0;
  existing.forEach(function(r) {
    var sn = String(r.slipNumber || '');
    if (sn.indexOf(prefix) === 0) {
      var num = parseInt(sn.slice(prefix.length), 10);
      if (num > maxCounter) maxCounter = num;
    }
  });

  var results = [];
  rows.forEach(function(r, i) {
    var counter = String(maxCounter + i + 1).padStart(2, '0');
    var slipNumber = prefix + counter;
    var row = Object.assign({}, r, {
      id: uid_(),
      generatedBy: b.by || 'admin',
      slipNumber: slipNumber
    });
    insertRow_(TABS_.payroll, row);
    results.push(row);
  });
  cDel_('payroll');
  return okJ({ periodFrom: b.periodFrom, periodTo: b.periodTo, rows: results.length });
}

function getPayroll_(b) {
  var rows = readAll_(TABS_.payroll);
  if (b.period)     rows = rows.filter(function(r){ return r.period===b.period || r.periodFrom===b.period; });
  if (b.employeeId) rows = rows.filter(function(r){ return r.employeeId===b.employeeId; });
  const allRows = readAll_(TABS_.payroll);
  const fields  = ['grossWage','orlofsfe','grossTotal','lifeyrir','sereignarsjodur',
    'stadgreidslaSkattur','netPay','tryggingagjald','motframlag','totalEmployerCost',
    'hoursRegular','hoursOT133','hoursOT155'];
  rows.forEach(function(row) {
    const pKey = row.period || row.periodFrom || '';
    const yr  = pKey.slice(0,4);
    const ytd = allRows.filter(function(r){
      var rk = r.period || r.periodFrom || '';
      return r.employeeId===row.employeeId && rk.startsWith(yr) && rk<=pKey;
    });
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
