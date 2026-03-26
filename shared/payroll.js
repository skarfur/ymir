// shared/payroll.js — punch clock widget + payroll calculation engine + payslip renderer
// Requires: shared/api.js (apiGet/apiPost/getLang)

// ── PAYROLL CONFIG (all rates configurable — 2025 Icelandic defaults) ────────
window.PAYROLL_CONFIG = {
  orlofslaun:            0.1017,
  employeePension:       0.04,
  employerPension:       0.115,
  endurhaefingarsjodur:  0.001,
  eftirvinna1:           1.33,
  eftirvinna2:           1.55,
  taxBrackets: [
    { upTo: 583854,   rate: 0.3149 },
    { upTo: 1645733,  rate: 0.3799 },
    { upTo: Infinity, rate: 0.4629 },
  ],
  personuafslattr: 68681,
  unionDuesRate:   0,
};

// ── Payroll calculation engine ────────────────────────────────────────────────
window.calculatePayslip = function(emp, regularMinutes, ot1Minutes, ot2Minutes, manualLines, cfg) {
  cfg = Object.assign({}, window.PAYROLL_CONFIG, cfg || {});
  regularMinutes = +regularMinutes || 0;
  ot1Minutes     = +ot1Minutes     || 0;
  ot2Minutes     = +ot2Minutes     || 0;
  manualLines    = manualLines     || [];
  var baseRate    = +(emp.baseRateKr) || 0;
  var regularHrs  = regularMinutes / 60;
  var ot1Hrs      = ot1Minutes / 60;
  var ot2Hrs      = ot2Minutes / 60;
  var dagvinna    = Math.round(regularHrs * baseRate);
  var eftirvinna1 = Math.round(ot1Hrs * baseRate * cfg.eftirvinna1);
  var eftirvinna2 = Math.round(ot2Hrs * baseRate * cfg.eftirvinna2);
  var basePay     = dagvinna + eftirvinna1 + eftirvinna2;
  var manualTotal = manualLines.reduce(function(s,l){return s+(+l.amount||0);},0);
  var orlofslaun  = Math.round(basePay * cfg.orlofslaun);
  var grossTotal  = basePay + manualTotal + orlofslaun;
  var pensionRate  = +(emp.lifeyrir !== undefined ? emp.lifeyrir : cfg.employeePension);
  var sereignRate  = +(emp.sereignarsjodur || 0);
  var unionRate    = +(emp.unionDuesRate !== undefined ? emp.unionDuesRate : cfg.unionDuesRate);
  var employeePension    = Math.round(grossTotal * pensionRate);
  var sereignarsjodurAmt = Math.round(grossTotal * sereignRate);
  var unionDues          = Math.round(grossTotal * unionRate);
  var taxBase = grossTotal - employeePension - sereignarsjodurAmt;
  var tax = 0, remaining = taxBase, prevThreshold = 0;
  for (var i = 0; i < cfg.taxBrackets.length; i++) {
    var bandTop   = cfg.taxBrackets[i].upTo;
    var bandWidth = Math.max(0, Math.min(remaining, bandTop - prevThreshold));
    tax += bandWidth * cfg.taxBrackets[i].rate;
    remaining -= bandWidth; prevThreshold = bandTop;
    if (remaining <= 0) break;
  }
  tax = Math.round(tax);
  var personalCredit = +(emp.personuafslattr !== undefined ? emp.personuafslattr : cfg.personuafslattr);
  var taxAfterCredit = Math.max(0, tax - personalCredit);
  var orlofsHlutfall = grossTotal > 0 ? orlofslaun / grossTotal : 0;
  var orlofIBanki    = Math.round(orlofslaun - orlofsHlutfall * taxAfterCredit);
  var totalDeductions = employeePension + sereignarsjodurAmt + taxAfterCredit + unionDues + orlofIBanki;
  var netPay          = grossTotal - totalDeductions;
  var employerPensionAmt   = Math.round(grossTotal * cfg.employerPension);
  var endurhaefingarsjodur = Math.round(grossTotal * cfg.endurhaefingarsjodur);
  return {
    regularMinutes,ot1Minutes,ot2Minutes,regularHrs,ot1Hrs,ot2Hrs,
    dagvinna,eftirvinna1,eftirvinna2,basePay,manualLines,manualTotal,
    orlofslaun,grossTotal,orlofsRate:cfg.orlofslaun,
    employeePension,sereignarsjodur:sereignarsjodurAmt,unionDues,
    taxBase,taxGross:tax,personalCredit,taxAfterCredit,
    orlofIBanki,totalDeductions,netPay,
    employerPensionAmt,endurhaefingarsjodur,
    pensionRate,sereignRate,unionRate,
  };
};

// ── Punch clock widget ────────────────────────────────────────────────────────
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

// ── Duration helper ───────────────────────────────────────────────────────────
function fmtDurationMins(mins){var h=Math.floor(+mins/60),m=Math.round(+mins%60);return h>0?h+'h '+String(m).padStart(2,'0')+'m':m+'m';}

// ── Payslip HTML renderer ─────────────────────────────────────────────────────
function renderPayslip(data) {
  var emp=data.employee||{},calc=data.calc||{},ytd=data.ytd||{},period=data.period||'',employer=data.employer||{};
  var IS=(typeof getLang==='function')?getLang()==='IS':true;
  var parts=(period||'').split('-'),yr=parts[0],mo=parts[1];
  var months_IS=['janúar','febrúar','mars','apríl','maí','júní','júlí','ágúst','september','október','nóvember','desember'];
  var months_EN=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function kr(n){return Math.round(n||0).toLocaleString('is-IS');}
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function row(en,is,pv,yv,o){o=o||{};var lbl=IS?is:en,b=o.bold?'font-weight:700;':'',ng=o.neg?'color:#c0392b;':'',bg=o.bold?'background:#f0f0f0;':'';return '<tr style="'+bg+'"><td colspan="4" style="padding:4px 8px;border-bottom:1px solid #e0e0e0;'+b+'">'+esc(lbl)+'</td><td style="padding:4px 8px;border-bottom:1px solid #e0e0e0;text-align:right;'+b+ng+'">'+(o.blank?'':kr(pv))+'</td><td style="padding:4px 8px;border-bottom:1px solid #e0e0e0;text-align:right;color:#888;'+b+'">'+(o.yb?'':kr(yv))+'</td></tr>';}
  var mRows=(calc.manualLines||[]).map(function(l){return row(l.label||'',l.labelIS||l.label||'',l.amount||0,0);}).join('');
  var uRow=calc.unionDues>0?row('Union dues','Stéttarfélag',-calc.unionDues,-(ytd.unionDues||0),{neg:true}):'';
  var sRow=calc.sereignarsjodur>0?row('Private pension ('+((calc.sereignRate||0)*100).toFixed(1)+'%)','Séreignarsjóður ('+((calc.sereignRate||0)*100).toFixed(1)+'%)',-calc.sereignarsjodur,-(ytd.sereignarsjodur||0),{neg:true}):'';
  var css='body{font-family:Calibri,Arial,sans-serif;font-size:12px;color:#000;background:#fff;margin:0;padding:20px 24px}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}.emp-box{border:1px solid #aaa;padding:8px 12px;margin-bottom:10px;display:flex;justify-content:space-between;font-size:11px}.sum-box{border:1px solid #000;padding:8px 12px;margin-bottom:12px;background:#fafafa;font-size:11px}.sum-box table{width:100%;border-collapse:collapse}.sum-box td{padding:1px 4px}.sum-box td:nth-child(2),.sum-box td:nth-child(4){text-align:right;font-weight:700}table.det{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px}table.det th{padding:4px 8px;border-bottom:2px solid #000;font-size:10px;color:#555;font-weight:700;letter-spacing:.4px;text-align:right}table.det th:first-child{text-align:left}.efooter{margin-top:14px;font-size:10px;color:#666;border-top:1px solid #ccc;padding-top:6px}';
  return '<!DOCTYPE html><html lang="'+(IS?'is':'en')+'"><head><meta charset="UTF-8"><style>'+css+'</style></head><body>'
    +'<div class="hdr"><div style="font-size:22px;font-weight:700;color:#c0392b">'+(IS?'Launaseðill':'Payslip')+'</div>'
    +'<div style="text-align:right;font-size:11px"><div style="font-weight:700;font-size:14px">'+esc(employer.employerName||'')+'</div><div>kt. '+esc(employer.employerKt||'')+'</div></div></div>'
    +'<div class="emp-box"><div><div style="font-weight:700;font-size:13px">'+esc(emp.name||'')+'</div><div>'+esc(emp.title||'')+'</div><div>'+esc(emp.kt||'')+'</div></div>'
    +'<div style="text-align:right"><div>'+(IS?'Seðilnúmer':'Slip no.')+': '+esc(data.slipNumber||'')+'</div><div>'+(IS?'Greiðsludagur':'Payment date')+': '+esc(data.paymentDate||'')+'</div><div>'+(IS?'Launareikningur':'Bank')+': '+esc(emp.bankAccount||'')+'</div><div>'+(IS?'Orlofsreikningur':'Holiday acct')+': '+esc(emp.orlofsreikningur||'')+'</div></div></div>'
    +'<div style="font-size:11px;margin-bottom:8px">'+(IS?'Starfsheiti':'Title')+': <strong>'+esc(emp.title||'')+'</strong></div>'
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
    +row('Pension ('+((calc.pensionRate||0)*100).toFixed(2)+'%)','Lífeyrissjóður ('+((calc.pensionRate||0)*100).toFixed(2)+'%)',-calc.employeePension,-(ytd.employeePension||0),{neg:true})
    +sRow+uRow
    +row('Computed tax (base: '+kr(calc.taxBase||0)+')','Reiknuð staðgreiðsla (stofn: '+kr(calc.taxBase||0)+')',-calc.taxGross,0,{neg:true,yb:true})
    +row('Personal tax credit','Persónuafsláttur',calc.personalCredit,ytd.personalCredit||0)
    +row('Tax withheld','Staðgreiðsla skatta alls',-calc.taxAfterCredit,-(ytd.taxAfterCredit||0),{neg:true})
    +row('Holiday savings → orlofsreikningur','Orlof í banki',-calc.orlofIBanki,-(ytd.orlofIBanki||0),{neg:true})
    +row('Total deductions','Frádráttur samtals',-calc.totalDeductions,-(ytd.totalDeductions||0),{bold:true,neg:true})
    +'</tbody></table>'
    +'<table class="det"><thead><tr><th style="text-align:left" colspan="4">'+(IS?'Framlag launagreiðanda':'Employer contributions')+'</th><th>'+(IS?'Tímabil':'Period')+'</th><th>'+(IS?'Frá áramótum':'YTD')+'</th></tr></thead><tbody>'
    +row('Employer pension ('+((window.PAYROLL_CONFIG||{employerPension:0.115}).employerPension*100).toFixed(1)+'%)','Mótframlag lífeyrissjóður ('+((window.PAYROLL_CONFIG||{employerPension:0.115}).employerPension*100).toFixed(1)+'%)',calc.employerPensionAmt,ytd.employerPensionAmt||0)
    +row('Rehabilitation fund (0.1%)','Endurhæfingarsjóður (0.1%)',calc.endurhaefingarsjodur,ytd.endurhaefingarsjodur||0)
    +'</tbody></table>'
    +'<table class="det"><thead><tr><th style="text-align:left" colspan="4">'+(IS?'Til uppsöfnunar á orlofsárinu':'Accrued holiday')+'</th><th>'+(IS?'Nú':'Now')+'</th><th>'+(IS?'Samtals':'Total')+'</th></tr></thead><tbody>'
    +row('Holiday pay to custodian','Orlofslaun til vörsluaðila',calc.orlofIBanki,ytd.orlofIBanki||0)
    +'</tbody></table>'
    +'<div class="efooter"><strong>'+esc(employer.employerName||'')+'</strong> &nbsp;·&nbsp; '+esc(employer.employerAddress||'')+' &nbsp;·&nbsp; kt. '+esc(employer.employerKt||'')+'</div>'
    +'</body></html>';
}
