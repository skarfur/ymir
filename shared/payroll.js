// shared/payroll.js — calculation engine + punch clock widget + payslip renderer
// Requires: shared/api.js (apiGet/apiPost/getLang)

/* ══ PAYROLL_CONFIG ═══════════════════════════════════════════════════════════
   All rates configurable. 2025 Icelandic defaults.
   pensionFunds / unions are registries that employee records reference by id.
   personuafslattrUnit: the absolute kr amount that equals 1.0 in employee records.
   otRules: global overtime periods; per-employee otEligible flag enables/disables.
══════════════════════════════════════════════════════════════════════════════ */
window.PAYROLL_CONFIG = {
  orlofslaun:           0.1017,
  employerPension:      0.115,
  endurhaefingarsjodur: 0.001,
  eftirvinna1:          1.33,
  eftirvinna2:          1.55,
  personuafslattrUnit:  68681,
  taxBrackets: [
    { upTo: 583854,  rate: 0.3149 },
    { upTo: 1645733, rate: 0.3799 },
    { upTo: Infinity,rate: 0.4629 },
  ],
  otRules: {
    ot1: { label: 'Eftirvinna 1', labelEN: 'Overtime 1', multiplier: 1.33,
           periods: [{ days:[1,2,3,4], fromHour:17, toHour:24 }] },
    ot2: { label: 'Eftirvinna 2', labelEN: 'Overtime 2', multiplier: 1.55,
           periods: [{ days:[5,6,0], fromHour:0, toHour:24 },
                     { days:[1,2,3,4], fromHour:17, toHour:24, tier2:true }] },
  },
  pensionFunds: [
    { id:'fund_bru', name:'Brú lífeyrissjóður', nameEN:'Bru Pension Fund',
      lines:[
        { id:'line_emp',  label:'Iðgjald starfsmanns', labelEN:'Employee contribution', employeeRate:0.04, employerRate:0 },
        { id:'line_empr', label:'Mótframlag',          labelEN:'Employer match',         employeeRate:0,    employerRate:0.115 },
      ]
    },
  ],
  unions: [
    { id:'union_vr', name:'VR', nameEN:'VR',
      lines:[
        { id:'line_vr1', label:'Stéttarfélagsgjald', labelEN:'Union dues', employeeRate:0, employerRate:0 },
      ]
    },
  ],
};

/* ══ OT SPLITTER ═════════════════════════════════════════════════════════════
   Given an array of completed time entries (with clockIn / timestamp / durationMinutes)
   and the otRules config, returns {regularMins, ot1Mins, ot2Mins}.
   Days: 0=Sun, 1=Mon ... 6=Sat (JS getDay()).
══════════════════════════════════════════════════════════════════════════════ */
window.splitOTMinutes = function(entries, otRules) {
  var regularMins = 0, ot1Mins = 0, ot2Mins = 0;
  (entries||[]).forEach(function(entry) {
    if (!entry.clockIn || !+entry.durationMinutes) return;
    var start = new Date(entry.clockIn);
    var totalMins = +entry.durationMinutes;
    // Walk minute-by-minute would be slow; instead split at boundary points
    var cursor = new Date(start);
    var remaining = totalMins;
    while (remaining > 0) {
      var minuteClass = _classifyMinute(cursor, otRules);
      // Find how many consecutive minutes have same class
      var runMins = _runLength(cursor, remaining, minuteClass, otRules);
      if (minuteClass === 2) ot2Mins += runMins;
      else if (minuteClass === 1) ot1Mins += runMins;
      else regularMins += runMins;
      cursor = new Date(cursor.getTime() + runMins * 60000);
      remaining -= runMins;
    }
  });
  return { regularMins: Math.round(regularMins), ot1Mins: Math.round(ot1Mins), ot2Mins: Math.round(ot2Mins) };
};

function _classifyMinute(dt, rules) {
  var day = dt.getUTCDay(); // UTC+0 = Iceland always
  var hour = dt.getUTCHours() + dt.getUTCMinutes()/60;
  var r = rules || (window.PAYROLL_CONFIG||{}).otRules || {};
  // OT2 takes priority over OT1
  if (_inPeriods(day, hour, (r.ot2||{}).periods)) return 2;
  if (_inPeriods(day, hour, (r.ot1||{}).periods)) return 1;
  return 0;
}
function _inPeriods(day, hour, periods) {
  if (!periods) return false;
  return periods.some(function(p) {
    return p.days.indexOf(day) !== -1 && hour >= p.fromHour && hour < p.toHour;
  });
}
function _runLength(start, maxMins, cls, rules) {
  // Find minutes until the class changes (max 60 to keep it fast)
  var step = Math.min(maxMins, 60);
  for (var i = 1; i <= step; i++) {
    var next = new Date(start.getTime() + i * 60000);
    if (_classifyMinute(next, rules) !== cls) return i;
  }
  return step;
}

/* ══ CALCULATE PAYSLIP ════════════════════════════════════════════════════════
   emp fields used:
     baseRateKr, personuafslattr (fraction of personuafslattrUnit),
     pensionFundIds (array of fund ids), unionId,
     otEligible (bool), sereignarsjodur (legacy rate — kept for compat)
   Returns full breakdown for payslip rendering.
══════════════════════════════════════════════════════════════════════════════ */
window.calculatePayslip = function(emp, regularMinutes, ot1Minutes, ot2Minutes, manualLines, cfg) {
  cfg = Object.assign({}, window.PAYROLL_CONFIG, cfg || {});
  regularMinutes = +regularMinutes || 0;
  ot1Minutes     = +ot1Minutes    || 0;
  ot2Minutes     = +ot2Minutes    || 0;
  manualLines    = manualLines    || [];

  var baseRate    = +(emp.baseRateKr) || 0;
  var regularHrs  = regularMinutes / 60;
  var ot1Hrs      = ot1Minutes / 60;
  var ot2Hrs      = ot2Minutes / 60;
  var dagvinna    = Math.round(regularHrs * baseRate);
  var eftirvinna1 = Math.round(ot1Hrs * baseRate * (cfg.eftirvinna1 || 1.33));
  var eftirvinna2 = Math.round(ot2Hrs * baseRate * (cfg.eftirvinna2 || 1.55));
  var basePay     = dagvinna + eftirvinna1 + eftirvinna2;
  var manualTotal = manualLines.reduce(function(s,l){return s+(+l.amount||0);},0);
  var orlofslaun  = Math.round(basePay * (cfg.orlofslaun || 0.1017));
  var grossTotal  = basePay + manualTotal + orlofslaun;

  // ── Pension: resolve all lines across all assigned funds
  var pensionLines  = []; // {label, labelEN, employeeAmt, employerAmt}
  var totalEmpPension = 0, totalEmprPension = 0;
  var fundIds = emp.pensionFundIds || (emp.lifeyrir !== undefined ? ['__legacy__'] : []);
  if (fundIds.length === 0 && (cfg.pensionFunds||[]).length > 0) fundIds = [cfg.pensionFunds[0].id];

  fundIds.forEach(function(fid) {
    var fund;
    if (fid === '__legacy__') {
      // Legacy flat-rate compatibility
      var empRate  = +(emp.lifeyrir  !== undefined ? emp.lifeyrir  : 0.04);
      var emprRate = cfg.employerPension || 0.115;
      fund = { name:'Lífeyrissjóður', nameEN:'Pension Fund',
               lines:[{id:'leg_emp',  label:'Iðgjald', labelEN:'Contribution',    employeeRate:empRate, employerRate:0},
                      {id:'leg_empr', label:'Mótframlag',labelEN:'Employer match',employeeRate:0,       employerRate:emprRate}]};
    } else {
      fund = (cfg.pensionFunds||[]).find(function(f){return f.id===fid;});
    }
    if (!fund) return;
    fund.lines.forEach(function(line) {
      var eAmt  = Math.round(grossTotal * (line.employeeRate || 0));
      var erAmt = Math.round(grossTotal * (line.employerRate || 0));
      if (eAmt || erAmt) {
        pensionLines.push({fundName:fund.name, fundNameEN:fund.nameEN,
          label:line.label, labelEN:line.labelEN, employeeAmt:eAmt, employerAmt:erAmt});
        totalEmpPension  += eAmt;
        totalEmprPension += erAmt;
      }
    });
  });

  // Legacy séreign (kept for existing employee records)
  var sereignRate = +(emp.sereignarsjodur || 0);
  var sereignarsjodurAmt = Math.round(grossTotal * sereignRate);

  // ── Union: resolve lines
  var unionLines = [];
  var totalUnionEmp = 0;
  var unionId = emp.unionId || null;
  // Legacy: if emp.union is a string name and no unionId, try to find by name
  if (!unionId && emp.union) {
    var found = (cfg.unions||[]).find(function(u){return u.name===emp.union||u.nameEN===emp.union;});
    if (found) unionId = found.id;
  }
  if (unionId) {
    var union = (cfg.unions||[]).find(function(u){return u.id===unionId;});
    if (union) {
      union.lines.forEach(function(line) {
        var eAmt  = Math.round(grossTotal * (line.employeeRate || 0));
        var erAmt = Math.round(grossTotal * (line.employerRate || 0));
        unionLines.push({unionName:union.name, label:line.label, labelEN:line.labelEN,
          employeeAmt:eAmt, employerAmt:erAmt});
        totalUnionEmp += eAmt;
      });
    }
  }
  // Legacy flat unionDuesRate
  var legacyUnionRate = +(emp.unionDuesRate !== undefined ? emp.unionDuesRate : (cfg.unionDuesRate||0));
  if (legacyUnionRate > 0 && !unionId) {
    var legAmt = Math.round(grossTotal * legacyUnionRate);
    unionLines.push({label:'Stéttarfélag', labelEN:'Union dues', employeeAmt:legAmt, employerAmt:0});
    totalUnionEmp += legAmt;
  }

  // ── Tax
  var taxBase = grossTotal - totalEmpPension - sereignarsjodurAmt - totalUnionEmp;
  var tax = 0, remaining = taxBase, prevThreshold = 0;
  (cfg.taxBrackets||[]).forEach(function(b) {
    var bandTop   = b.upTo === null || b.upTo === Infinity ? Infinity : b.upTo;
    var bandWidth = Math.max(0, Math.min(remaining, bandTop - prevThreshold));
    tax     += bandWidth * b.rate;
    remaining    -= bandWidth;
    prevThreshold = bandTop;
  });
  tax = Math.round(tax);

  // ── Personal credit — emp.personuafslattr is a fraction of personuafslattrUnit
  var creditFraction  = emp.personuafslattr !== undefined ? +(emp.personuafslattr) : 1.0;
  var personalCredit  = Math.round(creditFraction * (cfg.personuafslattrUnit || 68681));
  var taxAfterCredit  = Math.max(0, tax - personalCredit);

  // ── Orlof í banki
  var orlofsHlutfall = grossTotal > 0 ? orlofslaun / grossTotal : 0;
  var orlofIBanki    = Math.round(orlofslaun - orlofsHlutfall * taxAfterCredit);

  // ── Totals
  var totalDeductions = totalEmpPension + sereignarsjodurAmt + taxAfterCredit + totalUnionEmp + orlofIBanki;
  var netPay          = grossTotal - totalDeductions;
  var endurhaefingarsjodur = Math.round(grossTotal * (cfg.endurhaefingarsjodur || 0.001));

  return {
    regularMinutes, ot1Minutes, ot2Minutes, regularHrs, ot1Hrs, ot2Hrs,
    dagvinna, eftirvinna1, eftirvinna2, basePay, manualLines, manualTotal,
    orlofslaun, grossTotal, orlofsRate: cfg.orlofslaun,
    pensionLines, totalEmpPension, totalEmprPension,
    sereignarsjodur: sereignarsjodurAmt, sereignRate,
    unionLines, totalUnionEmp,
    taxBase, taxGross: tax, personalCredit, creditFraction, taxAfterCredit,
    orlofIBanki, totalDeductions, netPay,
    employerPensionAmt: totalEmprPension,
    endurhaefingarsjodur,
    // legacy compat fields
    employeePension: totalEmpPension,
    pensionRate: totalEmpPension > 0 && grossTotal > 0 ? totalEmpPension/grossTotal : 0,
    unionDues: totalUnionEmp,
    unionRate: totalUnionEmp > 0 && grossTotal > 0 ? totalUnionEmp/grossTotal : 0,
  };
};

/* ══ PUNCH CLOCK WIDGET ══════════════════════════════════════════════════════ */
function punchClockWidget(el, employeeId) {
  if (!el || !employeeId) return;
  if (!document.getElementById('pcStyle')) {
    var style = document.createElement('style');
    style.id = 'pcStyle';
    style.textContent = '.pc-btn{border:none;border-radius:24px;font-size:15px;font-weight:700;padding:13px 36px;cursor:pointer;transition:background .2s,transform .1s;letter-spacing:.3px;}.pc-btn:active{transform:scale(.97);}.pc-btn-in{background:var(--green);color:#fff;}.pc-btn-out{background:var(--red);color:#fff;}.pc-entry{display:flex;align-items:center;gap:8px;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border);}.pc-entry:last-child{border-bottom:none;}.pc-timer{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--brass);letter-spacing:.5px;}';
    document.head.appendChild(style);
  }
  function fmtMs(ms){var s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;return h>0?h+'h '+String(m).padStart(2,'0')+'m':m+'m '+String(sc).padStart(2,'0')+'s';}
  function fmtMins(mins){var h=Math.floor(mins/60),m=Math.round(mins%60);return h>0?h+'h '+String(m).padStart(2,'0')+'m':m+'m';}
  function render(state){
    var t=function(k){return typeof s==='function'?s(k):k.split('.').pop();};
    var ci=state.clockedIn,el2=Date.now()-new Date(state.since||0).getTime();
    var rh=(state.recent||[]).slice(0,5).map(function(e){return '<div class="pc-entry"><span style="min-width:90px">'+e.inTime.slice(11,16)+'–'+e.outTime.slice(11,16)+'</span><span style="flex:1;color:var(--muted);font-size:11px">'+e.inTime.slice(0,10)+'</span><span style="font-weight:600">'+(e.durationMinutes?fmtMins(+e.durationMinutes):'–')+'</span></div>';}).join('');
    el.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px 16px 10px">'+(ci?'<div style="text-align:center"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">'+t('payroll.currentShift')+'</div><div class="pc-timer" id="pcTimerDisplay">'+fmtMs(el2)+'</div></div>':'')+'<button id="pcMainBtn" class="pc-btn '+(ci?'pc-btn-out':'pc-btn-in')+'">'+(ci?t('payroll.clockOut'):t('payroll.clockIn'))+'</button>'+(state.error?'<div style="font-size:12px;color:var(--red);text-align:center">'+state.error+'</div>':'')+'</div>'+(rh?'<div style="padding:0 16px 14px"><div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">'+t('payroll.recentShifts')+'</div>'+rh+'</div>':'<div style="padding:0 16px 14px;font-size:12px;color:var(--muted);text-align:center">'+t('payroll.noShifts')+'</div>');
    document.getElementById('pcMainBtn').onclick=async function(){var btn=document.getElementById('pcMainBtn');if(btn)btn.disabled=true;try{if(ci)await apiPost('clockOut',{employeeId});else await apiPost('clockIn',{employeeId});await pcRefresh(el,employeeId);}catch(err){render(Object.assign({},state,{error:err.message||'Error'}));}};
    clearInterval(el._pcTick);
    if(ci){el._pcTick=setInterval(function(){var d=document.getElementById('pcTimerDisplay');if(d)d.textContent=fmtMs(Date.now()-new Date(state.since).getTime());else clearInterval(el._pcTick);},1000);}
  }
  async function pcRefresh(container,empId){
    try{var res=await apiGet('getTimeEntries?employeeId='+empId);var entries=(res.entries||[]).slice().sort(function(a,b){return a.timestamp>b.timestamp?1:-1;});var ins=entries.filter(function(e){return e.type==='in';}),outs=entries.filter(function(e){return e.type==='out';});var lastIn=ins[ins.length-1],lastOut=outs[outs.length-1];var ci=!!(lastIn&&(!lastOut||lastIn.timestamp>lastOut.timestamp));var recent=[];outs.slice().reverse().forEach(function(out){var mi=ins.slice().reverse().find(function(i){return i.timestamp<out.timestamp;});if(mi)recent.push({inTime:mi.timestamp,outTime:out.timestamp,durationMinutes:out.durationMinutes});});render({clockedIn:ci,since:ci?lastIn.timestamp:null,recent});}
    catch(err){render({clockedIn:false,recent:[],error:'Could not load shift data'});}
  }
  el._pcRefresh=function(){return pcRefresh(el,employeeId);};el._pcRefresh();clearInterval(el._pcAutoRefresh);el._pcAutoRefresh=setInterval(function(){el._pcRefresh();},60000);
}

function fmtDurationMins(mins){var h=Math.floor(+mins/60),m=Math.round(+mins%60);return h>0?h+'h '+String(m).padStart(2,'0')+'m':m+'m';}

/* ══ PAYSLIP HTML RENDERER ═══════════════════════════════════════════════════ */
function renderPayslip(data) {
  var emp=data.employee||{},calc=data.calc||{},ytd=data.ytd||{},period=data.period||'',employer=data.employer||{};
  var IS=(typeof getLang==='function')?getLang()==='IS':true;
  function kr(n){return Math.round(n||0).toLocaleString('is-IS');}
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function pct(r){return ((r||0)*100).toFixed(2).replace(/\.?0+$/,'')+'%';}
  function row(en,is,pv,yv,o){
    o=o||{};var lbl=IS?is:en,b=o.bold?'font-weight:700;':'',ng=o.neg?'color:#c0392b;':'',bg=o.bold?'background:#f0f0f0;':'';
    return '<tr style="'+bg+'"><td colspan="4" style="padding:4px 8px;border-bottom:1px solid #e0e0e0;'+b+'">'+esc(lbl)+'</td>'
      +'<td style="padding:4px 8px;border-bottom:1px solid #e0e0e0;text-align:right;'+b+ng+'">'+(o.blank?'':kr(pv))+'</td>'
      +'<td style="padding:4px 8px;border-bottom:1px solid #e0e0e0;text-align:right;color:#888;'+b+'">'+(o.yb?'':kr(yv))+'</td></tr>';
  }
  var mRows=(calc.manualLines||[]).map(function(l){return row(l.label||'',l.labelIS||l.label||'',l.amount||0,0);}).join('');
  // Pension lines
  var pensionRows=(calc.pensionLines||[]).filter(function(l){return l.employeeAmt>0;}).map(function(l){
    var nm=IS?(l.fundName||l.label):(l.fundNameEN||l.labelEN||l.label);
    var lbl2=IS?l.label:l.labelEN;
    return row(nm+' – '+lbl2,nm+' – '+lbl2,-l.employeeAmt,0,{neg:true});
  }).join('');
  if(!pensionRows&&(calc.employeePension||0)>0){
    pensionRows=row('Pension ('+(pct(calc.pensionRate))+')','Lífeyrissjóður ('+pct(calc.pensionRate)+')',-calc.employeePension,-(ytd.employeePension||0),{neg:true});
  }
  var sereignRow=calc.sereignarsjodur>0?row('Private pension ('+pct(calc.sereignRate)+')','Séreign ('+pct(calc.sereignRate)+')',-calc.sereignarsjodur,-(ytd.sereignarsjodur||0),{neg:true}):'';
  var unionRows=(calc.unionLines||[]).filter(function(l){return l.employeeAmt>0;}).map(function(l){
    var nm=IS?(l.unionName||l.label):(l.unionNameEN||l.labelEN||l.label);
    return row(nm+' – '+(IS?l.label:l.labelEN),nm+' – '+(IS?l.label:l.labelEN),-l.employeeAmt,0,{neg:true});
  }).join('');
  if(!unionRows&&(calc.unionDues||0)>0){
    unionRows=row('Union dues','Stéttarfélag',-calc.unionDues,-(ytd.unionDues||0),{neg:true});
  }
  // Employer pension lines
  var empPensionRows=(calc.pensionLines||[]).filter(function(l){return l.employerAmt>0;}).map(function(l){
    var nm=IS?(l.fundName||l.label):(l.fundNameEN||l.labelEN||l.label);
    return row(nm+' – '+(IS?l.label:l.labelEN),nm+' – '+(IS?l.label:l.labelEN),l.employerAmt,ytd.employerPensionAmt||0);
  }).join('');
  if(!empPensionRows&&(calc.employerPensionAmt||0)>0){
    empPensionRows=row('Employer pension ('+pct((window.PAYROLL_CONFIG||{}).employerPension||0.115)+')','Mótframlag lífeyrissjóðs ('+pct((window.PAYROLL_CONFIG||{}).employerPension||0.115)+')',calc.employerPensionAmt,ytd.employerPensionAmt||0);
  }
  var css='body{font-family:Calibri,Arial,sans-serif;font-size:12px;color:#000;background:#fff;margin:0;padding:20px 24px}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}.emp-box{border:1px solid #aaa;padding:8px 12px;margin-bottom:10px;display:flex;justify-content:space-between;font-size:11px}.sum-box{border:1px solid #000;padding:8px 12px;margin-bottom:12px;background:#fafafa;font-size:11px}.sum-box table{width:100%;border-collapse:collapse}.sum-box td{padding:1px 4px}.sum-box td:nth-child(2),.sum-box td:nth-child(4){text-align:right;font-weight:700}table.det{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px}table.det th{padding:4px 8px;border-bottom:2px solid #000;font-size:10px;color:#555;font-weight:700;letter-spacing:.4px;text-align:right}table.det th:first-child{text-align:left}.efooter{margin-top:14px;font-size:10px;color:#666;border-top:1px solid #ccc;padding-top:6px}';
  return '<!DOCTYPE html><html lang="'+(IS?'is':'en')+'"><head><meta charset="UTF-8"><style>'+css+'</style></head><body>'
    +'<div class="hdr"><div style="font-size:22px;font-weight:700;color:#c0392b">'+(IS?'Launaseðill':'Payslip')+'</div>'
    +'<div style="text-align:right;font-size:11px"><div style="font-weight:700;font-size:14px">'+esc(employer.employerName||'')+'</div><div>kt. '+esc(employer.employerKt||'')+'</div></div></div>'
    +'<div class="emp-box"><div><div style="font-weight:700;font-size:13px">'+esc(emp.name||'')+'</div><div>'+esc(emp.title||'')+'</div><div>'+esc(emp.kt||'')+'</div></div>'
    +'<div style="text-align:right"><div>'+(IS?'Seðilnúmer':'Slip no.')+': '+esc(data.slipNumber||'')+'</div><div>'+(IS?'Greiðsludagur':'Payment date')+': '+esc(data.paymentDate||'')+'</div><div>'+(IS?'Launareikningur':'Bank')+': '+esc(emp.bankAccount||'')+'</div><div>'+(IS?'Orlofsreikningur':'Holiday acct')+': '+esc(emp.orlofsreikningur||'')+'</div></div></div>'
    +'<div class="sum-box"><div style="font-weight:700;font-size:10px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">'+(IS?'Samtölur launaseðils':'Payslip summary')+'&nbsp;&nbsp;<span style="color:#888;font-weight:400">'+(IS?'Frá áramótum':'YTD')+'</span></div>'
    +'<table><tr><td>'+(IS?'Laun':'Gross')+'</td><td>'+kr(calc.grossTotal||0)+'</td><td style="color:#888;padding-left:16px">'+(IS?'Frá áramótum':'YTD')+'</td><td style="color:#888">'+kr(ytd.grossTotal||0)+'</td></tr>'
    +'<tr><td>'+(IS?'Frádráttur':'Deductions')+'</td><td>'+kr(calc.totalDeductions||0)+'</td><td></td><td style="color:#888">'+kr(ytd.totalDeductions||0)+'</td></tr>'
    +'<tr style="border-top:1px solid #000"><td style="font-weight:700">'+(IS?'Útborgað':'Net pay')+'</td><td>'+kr(calc.netPay||0)+'</td><td></td><td style="color:#888;font-weight:700">'+kr(ytd.netPay||0)+'</td></tr></table></div>'
    +'<table class="det"><thead><tr><th style="text-align:left" colspan="4">'+(IS?'Laun':'Earnings')+'</th><th>'+(IS?'Tímabil':'Period')+'</th><th>'+(IS?'Frá áramótum':'YTD')+'</th></tr></thead><tbody>'
    +row('Regular ('+calc.regularHrs.toFixed(2)+'h × '+kr(emp.baseRateKr||0)+' kr/h)','Dagvinna ('+calc.regularHrs.toFixed(2)+'klst × '+kr(emp.baseRateKr||0)+' kr)',calc.dagvinna,ytd.dagvinna||0)
    +(calc.eftirvinna1>0?row('Overtime 1.33× ('+calc.ot1Hrs.toFixed(2)+'h)','Eftirvinna 1,33 ('+calc.ot1Hrs.toFixed(2)+'klst)',calc.eftirvinna1,ytd.eftirvinna1||0):'')
    +(calc.eftirvinna2>0?row('Overtime 1.55× ('+calc.ot2Hrs.toFixed(2)+'h)','Eftirvinna 1,55 ('+calc.ot2Hrs.toFixed(2)+'klst)',calc.eftirvinna2,ytd.eftirvinna2||0):'')
    +mRows
    +row('Holiday pay ('+((calc.orlofsRate||0)*100).toFixed(2)+'%)','Orlofslaun ('+((calc.orlofsRate||0)*100).toFixed(2)+'%)',calc.orlofslaun,ytd.orlofslaun||0)
    +row('Gross total','Laun samtals',calc.grossTotal,ytd.grossTotal||0,{bold:true})
    +'</tbody></table>'
    +'<table class="det"><thead><tr><th style="text-align:left" colspan="4">'+(IS?'Frádráttur':'Deductions')+'</th><th>'+(IS?'Tímabil':'Period')+'</th><th>'+(IS?'Frá áramótum':'YTD')+'</th></tr></thead><tbody>'
    +pensionRows+sereignRow+unionRows
    +row('Computed tax (base: '+kr(calc.taxBase||0)+')','Reiknuð staðgreiðsla (stofn: '+kr(calc.taxBase||0)+')',-calc.taxGross,0,{neg:true,yb:true})
    +row('Personal tax credit','Persónuafsláttur',calc.personalCredit,ytd.personalCredit||0)
    +row('Tax withheld','Staðgreiðsla skatta alls',-calc.taxAfterCredit,-(ytd.taxAfterCredit||0),{neg:true})
    +row('Holiday savings → orlofsreikningur','Orlof í banka',-calc.orlofIBanki,-(ytd.orlofIBanki||0),{neg:true})
    +row('Total deductions','Frádráttur samtals',-calc.totalDeductions,-(ytd.totalDeductions||0),{bold:true,neg:true})
    +'</tbody></table>'
    +'<table class="det"><thead><tr><th style="text-align:left" colspan="4">'+(IS?'Framlag launagreiðanda':'Employer contributions')+'</th><th>'+(IS?'Tímabil':'Period')+'</th><th>'+(IS?'Frá áramótum':'YTD')+'</th></tr></thead><tbody>'
    +empPensionRows
    +row('Rehabilitation fund (0.1%)','Endurhæfingarsjóður (0.1%)',calc.endurhaefingarsjodur,ytd.endurhaefingarsjodur||0)
    +'</tbody></table>'
    +'<table class="det"><thead><tr><th style="text-align:left" colspan="4">'+(IS?'Til uppstöfnunar á orlofsárinu':'Accrued holiday')+'</th><th>'+(IS?'Nú':'Now')+'</th><th>'+(IS?'Samtals':'Total')+'</th></tr></thead><tbody>'
    +row('Holiday pay to custodian','Orlofslaun til vörsluáðila',calc.orlofIBanki,ytd.orlofIBanki||0)
    +'</tbody></table>'
    +'<div class="efooter"><strong>'+esc(employer.employerName||'')+'</strong> · '+esc(employer.employerAddress||'')+' · kt. '+esc(employer.employerKt||'')+'</div>'
    +'</body></html>';
}