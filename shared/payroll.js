// shared/payroll.js  —  calculation engine + punch clock widget + payslip renderer
// Requires: shared/api.js (apiGet/apiPost/getLang)

/* PP PAYROLL_CONFIG ═══════════════════════════════════════════════════════════
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
  otRules: [
    { id:'ot1', label:'Eftirvinna 1', labelEN:'Overtime 1', multiplier:1.33,
      periods:[{ days:[1,2,3,4], fromHour:17, toHour:24 }] },
    { id:'ot2', label:'Eftirvinna 2', labelEN:'Overtime 2', multiplier:1.55,
      periods:[{ days:[5,6,0], fromHour:0, toHour:24 },
               { days:[1,2,3,4], fromHour:17, toHour:24 }] },
  ],
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

/* PP SHARED FORMATTING HELPERS ═══════════════════════════════════════════════ */
window.fmtKr  = function(n) { return Math.round(n || 0).toLocaleString('is-IS'); };
window.fmtPct = function(r) { return ((r || 0) * 100).toFixed(2).replace(/\.?0+$/, '') + '%'; };
window.fmtDurationMins = function(mins) {
  var h = Math.floor(+mins / 60), m = Math.round(+mins % 60);
  return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm';
};

/* PP OT SPLITTER ═════════════════════════════════════════════════════════════
   otRules is now an ordered array of tier objects {id, label, labelEN, multiplier, periods}.
   Higher index = higher priority (checked first). Returns {regularMins, otMins, ot1Mins, ot2Mins}.
   Backward-compat aliases ot1Mins/ot2Mins map to tiers[0]/tiers[1] by position.
══════════════════════════════════════════════════════════════════════════════ */
function _legacyOtRulesToArray(rules) {
  if (!rules) return [];
  if (Array.isArray(rules)) return rules;
  // Legacy object {ot1:{...}, ot2:{...}} → ordered array
  var arr = [];
  if (rules.ot1) arr.push(Object.assign({ id:'ot1' }, rules.ot1));
  if (rules.ot2) arr.push(Object.assign({ id:'ot2' }, rules.ot2));
  Object.keys(rules).forEach(function(k) {
    if (k !== 'ot1' && k !== 'ot2') arr.push(Object.assign({ id:k }, rules[k]));
  });
  return arr;
}

function _inPeriods(day, hour, periods) {
  if (!periods) return false;
  return periods.some(function(p) {
    return p.days.indexOf(day) !== -1 && hour >= p.fromHour && hour < p.toHour;
  });
}

function _classifyMinuteDynamic(dt, tiersArr) {
  var day  = dt.getUTCDay();
  var hour = dt.getUTCHours() + dt.getUTCMinutes() / 60;
  for (var i = tiersArr.length - 1; i >= 0; i--) {
    if (_inPeriods(day, hour, tiersArr[i].periods)) return i;
  }
  return -1;
}

function _runLengthDynamic(start, maxMins, cls, tiersArr) {
  var step = Math.min(maxMins, 60);
  for (var i = 1; i <= step; i++) {
    if (_classifyMinuteDynamic(new Date(start.getTime() + i * 60000), tiersArr) !== cls) return i;
  }
  return step;
}

window.splitOTMinutes = function(entries, otRules) {
  var tiersArr = _legacyOtRulesToArray(otRules || (window.PAYROLL_CONFIG || {}).otRules);
  var regularMins = 0;
  var otMins = {};
  tiersArr.forEach(function(t) { otMins[t.id] = 0; });

  (entries || []).forEach(function(entry) {
    if (!entry.clockIn || !+entry.durationMinutes) return;
    var cursor    = new Date(entry.clockIn);
    var remaining = +entry.durationMinutes;
    while (remaining > 0) {
      var cls     = _classifyMinuteDynamic(cursor, tiersArr);
      var runMins = _runLengthDynamic(cursor, remaining, cls, tiersArr);
      if (cls >= 0 && tiersArr[cls]) {
        otMins[tiersArr[cls].id] = (otMins[tiersArr[cls].id] || 0) + runMins;
      } else {
        regularMins += runMins;
      }
      cursor    = new Date(cursor.getTime() + runMins * 60000);
      remaining -= runMins;
    }
  });

  var result = { regularMins: Math.round(regularMins), otMins: {} };
  tiersArr.forEach(function(t) { result.otMins[t.id] = Math.round(otMins[t.id] || 0); });
  // Backward-compat aliases
  result.ot1Mins = result.otMins[tiersArr[0] && tiersArr[0].id] || 0;
  result.ot2Mins = result.otMins[tiersArr[1] && tiersArr[1].id] || 0;
  return result;
};

/* PP CALCULATE PAYSLIP ════════════════════════════════════════════════════════
   New signature: calculatePayslip(emp, regularMinutes, otMinutes, manualLines, cfg)
     otMinutes: object {[tierId]: minutes}  — OR —
   Legacy:     calculatePayslip(emp, regularMinutes, ot1Min, ot2Min, manualLines, cfg)
     (detected when 3rd arg is a number)
   Returns full breakdown; includes otLines[] array + backward-compat ot1/ot2 aliases.
══════════════════════════════════════════════════════════════════════════════ */
window.calculatePayslip = function(emp, regularMinutes, otMinutesOrOt1, manualLinesOrOt2, cfgOrManual, cfgLegacy) {
  var otMins, manualLines, cfg;
  if (typeof otMinutesOrOt1 === 'object' && !Array.isArray(otMinutesOrOt1) && otMinutesOrOt1 !== null) {
    // New call: (emp, regular, {ot1:x,...}, manual, cfg)
    otMins      = otMinutesOrOt1 || {};
    manualLines = manualLinesOrOt2 || [];
    cfg         = cfgOrManual;
  } else {
    // Legacy call: (emp, regular, ot1, ot2, manual, cfg)
    var _tiers = _legacyOtRulesToArray((window.PAYROLL_CONFIG || {}).otRules);
    otMins = {};
    if (_tiers[0]) otMins[_tiers[0].id] = +otMinutesOrOt1  || 0;
    if (_tiers[1]) otMins[_tiers[1].id] = +manualLinesOrOt2 || 0;
    manualLines = cfgOrManual || [];
    cfg         = cfgLegacy;
  }
  cfg            = Object.assign({}, window.PAYROLL_CONFIG, cfg || {});
  regularMinutes = +regularMinutes || 0;
  manualLines    = manualLines || [];

  var tiersArr = _legacyOtRulesToArray(cfg.otRules);
  var baseRate  = +(emp.baseRateKr) || 0;
  var regularHrs = regularMinutes / 60;
  var dagvinna   = Math.round(regularHrs * baseRate);

  // Dynamic OT lines
  var otLines = tiersArr.map(function(tier) {
    var mins     = +(otMins[tier.id] || 0);
    var hrs      = mins / 60;
    var earnings = Math.round(hrs * baseRate * (tier.multiplier || 1));
    return { id:tier.id, label:tier.label, labelEN:tier.labelEN,
             multiplier:tier.multiplier, hrs:hrs, mins:mins, earnings:earnings };
  });
  var otEarnings = otLines.reduce(function(s, l) { return s + l.earnings; }, 0);
  var basePay    = dagvinna + otEarnings;

  // Backward-compat aliases (first two tiers)
  var ot1Line = otLines[0] || { hrs:0, mins:0, earnings:0 };
  var ot2Line = otLines[1] || { hrs:0, mins:0, earnings:0 };
  var ot1Minutes  = ot1Line.mins;
  var ot2Minutes  = ot2Line.mins;
  var ot1Hrs      = ot1Line.hrs;
  var ot2Hrs      = ot2Line.hrs;
  var eftirvinna1 = ot1Line.earnings;
  var eftirvinna2 = ot2Line.earnings;
  var manualTotal = manualLines.reduce(function(s, l) { return s + (+l.amount || 0); }, 0);
  var orlofslaun  = Math.round(basePay * cfg.orlofslaun);
  var grossTotal  = basePay + manualTotal + orlofslaun;

  // ── Pension: resolve all lines across assigned funds
  var pensionLines = [], totalEmpPension = 0, totalEmprPension = 0;
  var fundIds = emp.pensionFundIds || [];
  if (fundIds.length === 0 && (cfg.pensionFunds || []).length > 0) {
    fundIds = [cfg.pensionFunds[0].id];
  }
  fundIds.forEach(function(fid) {
    var fund = (cfg.pensionFunds || []).find(function(f) { return f.id === fid; });
    if (!fund) return;
    fund.lines.forEach(function(line) {
      var eAmt  = Math.round(grossTotal * (line.employeeRate || 0));
      var erAmt = Math.round(grossTotal * (line.employerRate || 0));
      if (eAmt || erAmt) {
        pensionLines.push({
          fundName: fund.name, fundNameEN: fund.nameEN,
          label: line.label, labelEN: line.labelEN,
          employeeAmt: eAmt, employerAmt: erAmt,
        });
        totalEmpPension  += eAmt;
        totalEmprPension += erAmt;
      }
    });
  });

  // ── Union: resolve lines
  var unionLines = [], totalUnionEmp = 0;
  var union = emp.unionId ? (cfg.unions || []).find(function(u) { return u.id === emp.unionId; }) : null;
  if (union) {
    union.lines.forEach(function(line) {
      var eAmt  = Math.round(grossTotal * (line.employeeRate || 0));
      var erAmt = Math.round(grossTotal * (line.employerRate || 0));
      unionLines.push({
        unionName: union.name, label: line.label, labelEN: line.labelEN,
        employeeAmt: eAmt, employerAmt: erAmt,
      });
      totalUnionEmp += eAmt;
    });
  }

  // ── Tax (progressive brackets)
  var taxBase = grossTotal - totalEmpPension - totalUnionEmp;
  var tax = 0, remaining = taxBase, prevThreshold = 0;
  (cfg.taxBrackets || []).forEach(function(b) {
    var bandTop   = b.upTo === null || b.upTo === Infinity ? Infinity : b.upTo;
    var bandWidth = Math.max(0, Math.min(remaining, bandTop - prevThreshold));
    tax          += bandWidth * b.rate;
    remaining    -= bandWidth;
    prevThreshold = bandTop;
  });
  tax = Math.round(tax);

  // ── Personal tax credit
  var creditFraction = emp.personuafslattr !== undefined ? +(emp.personuafslattr) : 1.0;
  var personalCredit = Math.round(creditFraction * cfg.personuafslattrUnit);
  var taxAfterCredit = Math.max(0, tax - personalCredit);

  // ── Holiday savings routed to orlofsreikningur (tax-proportional share)
  var orlofsHlutfall = grossTotal > 0 ? orlofslaun / grossTotal : 0;
  var orlofIBanki    = Math.round(orlofslaun - orlofsHlutfall * taxAfterCredit);

  // ── Totals
  var totalDeductions      = totalEmpPension + taxAfterCredit + totalUnionEmp + orlofIBanki;
  var netPay               = grossTotal - totalDeductions;
  var endurhaefingarsjodur = Math.round(grossTotal * cfg.endurhaefingarsjodur);

  return {
    regularMinutes, ot1Minutes, ot2Minutes,
    regularHrs, ot1Hrs, ot2Hrs,
    otLines, otMins,
    dagvinna, eftirvinna1, eftirvinna2, basePay,
    manualLines, manualTotal,
    orlofslaun, grossTotal, orlofsRate: cfg.orlofslaun,
    pensionLines, totalEmpPension, totalEmprPension,
    unionLines, totalUnionEmp,
    taxBase, taxGross: tax, personalCredit, creditFraction, taxAfterCredit,
    orlofIBanki, totalDeductions, netPay,
    employerPensionAmt: totalEmprPension,
    endurhaefingarsjodur,
    // Convenience aliases used by payslip card UI
    employeePension: totalEmpPension,
    pensionRate: grossTotal > 0 ? totalEmpPension / grossTotal : 0,
    unionDues: totalUnionEmp,
    unionRate: grossTotal > 0 ? totalUnionEmp / grossTotal : 0,
  };
};

/* PP PUNCH CLOCK WIDGET ══════════════════════════════════════════════════════ */
function punchClockWidget(el, employeeId) {
  if (!el || !employeeId) return;

  if (!document.getElementById('pcStyle')) {
    var style = document.createElement('style');
    style.id  = 'pcStyle';
    style.textContent = [
      '.pc-btn{border:none;border-radius:24px;font-size:15px;font-weight:700;padding:13px 36px;cursor:pointer;transition:background .2s,transform .1s;letter-spacing:.3px;}',
      '.pc-btn:active{transform:scale(.97);}',
      '.pc-btn-in{background:var(--green);color:#fff;}',
      '.pc-btn-out{background:var(--red);color:#fff;}',
      '.pc-entry{display:flex;align-items:center;gap:8px;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border);}',
      '.pc-entry:last-child{border-bottom:none;}',
      '.pc-timer{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--brass);letter-spacing:.5px;}',
    ].join('');
    document.head.appendChild(style);
  }

  function fmtMs(ms) {
    var sec = Math.floor(ms / 1000);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), sc = sec % 60;
    return h > 0
      ? h + 'h ' + String(m).padStart(2, '0') + 'm'
      : m + 'm ' + String(sc).padStart(2, '0') + 's';
  }

  function t(k) { return typeof s === 'function' ? s(k) : k.split('.').pop(); }

  function render(state) {
    var ci      = state.clockedIn;
    var elapsed = Date.now() - new Date(state.since || 0).getTime();
    var recentHTML = (state.recent || []).slice(0, 5).map(function(e) {
      return '<div class="pc-entry">'
        + '<span style="min-width:90px">' + e.inTime.slice(11, 16) + '\u2013' + e.outTime.slice(11, 16) + '</span>'
        + '<span style="flex:1;color:var(--muted);font-size:11px">' + e.inTime.slice(0, 10) + '</span>'
        + '<span style="font-weight:600">' + (e.durationMinutes ? fmtDurationMins(+e.durationMinutes) : '\u2013') + '</span>'
        + '</div>';
    }).join('');

    el.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px 16px 10px">'
      + (ci
        ? '<div style="text-align:center">'
          + '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">' + t('payroll.currentShift') + '</div>'
          + '<div class="pc-timer" id="pcTimerDisplay">' + fmtMs(elapsed) + '</div>'
          + '</div>'
        : '')
      + '<button id="pcMainBtn" class="pc-btn ' + (ci ? 'pc-btn-out' : 'pc-btn-in') + '">'
        + (ci ? t('payroll.clockOut') : t('payroll.clockIn'))
        + '</button>'
      + (state.error ? '<div style="font-size:12px;color:var(--red);text-align:center">' + state.error + '</div>' : '')
      + '</div>'
      + (recentHTML
        ? '<div style="padding:0 16px 14px"><div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">'
          + t('payroll.recentShifts') + '</div>' + recentHTML + '</div>'
        : '<div style="padding:0 16px 14px;font-size:12px;color:var(--muted);text-align:center">' + t('payroll.noShifts') + '</div>');

    document.getElementById('pcMainBtn').onclick = async function() {
      var btn = document.getElementById('pcMainBtn');
      if (btn) btn.disabled = true;
      try {
        if (ci) await apiPost('clockOut', { employeeId });
        else    await apiPost('clockIn',  { employeeId });
        await pcRefresh(el, employeeId);
      } catch(err) {
        render(Object.assign({}, state, { error: err.message || 'Error' }));
      }
    };

    clearInterval(el._pcTick);
    if (ci) {
      el._pcTick = setInterval(function() {
        var d = document.getElementById('pcTimerDisplay');
        if (d) d.textContent = fmtMs(Date.now() - new Date(state.since).getTime());
        else   clearInterval(el._pcTick);
      }, 1000);
    }
  }

  async function pcRefresh(container, empId) {
    try {
      var res     = await apiGet('getTimeEntries?employeeId=' + empId);
      var entries = (res.entries || []).slice().sort(function(a, b) { return a.timestamp > b.timestamp ? 1 : -1; });
      var ins     = entries.filter(function(e) { return e.type === 'in'; });
      var outs    = entries.filter(function(e) { return e.type === 'out'; });
      var lastIn  = ins[ins.length - 1], lastOut = outs[outs.length - 1];
      var ci      = !!(lastIn && (!lastOut || lastIn.timestamp > lastOut.timestamp));
      var recent  = [];
      outs.slice().reverse().forEach(function(out) {
        var mi = ins.slice().reverse().find(function(i) { return i.timestamp < out.timestamp; });
        if (mi) recent.push({ inTime: mi.timestamp, outTime: out.timestamp, durationMinutes: out.durationMinutes });
      });
      render({ clockedIn: ci, since: ci ? lastIn.timestamp : null, recent });
    } catch(err) {
      render({ clockedIn: false, recent: [], error: 'Could not load shift data' });
    }
  }

  el._pcRefresh = function() { return pcRefresh(el, employeeId); };
  el._pcRefresh();
  clearInterval(el._pcAutoRefresh);
  el._pcAutoRefresh = setInterval(function() { el._pcRefresh(); }, 60000);
}

/* PP PAYSLIP HTML RENDERER ════════════════════════════════════════════════════
   Returns a self-contained HTML document string suitable for print/iframe.
   Uses hardcoded print-safe styles  —  intentionally independent of site CSS.
══════════════════════════════════════════════════════════════════════════════ */
function renderPayslip(data) {
  var emp = data.employee || {}, calc = data.calc || {}, ytd = data.ytd || {};
  var period = data.period || '', employer = data.employer || {};
  var IS = (typeof getLang === 'function') ? getLang() === 'IS' : true;

  // Print-safe helpers (self-contained  —  no site deps)
  function kr(n)  { return Math.round(n || 0).toLocaleString('is-IS'); }
  function esc(v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function pct(r) { return ((r || 0) * 100).toFixed(2).replace(/\.?0+$/, '') + '%'; }

  function row(en, is, pv, yv, o) {
    o = o || {};
    var lbl  = IS ? is : en;
    var bold = o.bold ? 'font-weight:700;' : '';
    var neg  = o.neg  ? 'color:#c0392b;'  : '';
    var bg   = o.bold ? 'background:#f0f0f0;' : '';
    return '<tr style="' + bg + '">'
      + '<td colspan="4" style="padding:4px 8px;border-bottom:1px solid #e0e0e0;' + bold + '">' + esc(lbl) + '</td>'
      + '<td style="padding:4px 8px;border-bottom:1px solid #e0e0e0;text-align:right;' + bold + neg + '">' + (o.blank ? '' : kr(pv)) + '</td>'
      + '<td style="padding:4px 8px;border-bottom:1px solid #e0e0e0;text-align:right;color:#888;' + bold + '">' + (o.yb ? '' : kr(yv)) + '</td>'
      + '</tr>';
  }

  var mRows = (calc.manualLines || []).map(function(l) {
    return row(l.label || '', l.labelIS || l.label || '', l.amount || 0, 0);
  }).join('');

  var pensionRows = (calc.pensionLines || []).filter(function(l) { return l.employeeAmt > 0; }).map(function(l) {
    var nm   = IS ? (l.fundName  || l.label)  : (l.fundNameEN || l.labelEN || l.label);
    var lbl2 = IS ?  l.label : l.labelEN;
    return row(nm + ' \u2013 ' + lbl2, nm + ' \u2013 ' + lbl2, -l.employeeAmt, 0, { neg: true });
  }).join('');

  var unionRows = (calc.unionLines || []).filter(function(l) { return l.employeeAmt > 0; }).map(function(l) {
    var nm  = IS ? (l.unionName || l.label) : (l.unionNameEN || l.labelEN || l.label);
    var lbl = IS ?  l.label : l.labelEN;
    return row(nm + ' \u2013 ' + lbl, nm + ' \u2013 ' + lbl, -l.employeeAmt, 0, { neg: true });
  }).join('');

  var empPensionRows = (calc.pensionLines || []).filter(function(l) { return l.employerAmt > 0; }).map(function(l) {
    var nm  = IS ? (l.fundName  || l.label)  : (l.fundNameEN || l.labelEN || l.label);
    var lbl = IS ?  l.label : l.labelEN;
    return row(nm + ' \u2013 ' + lbl, nm + ' \u2013 ' + lbl, l.employerAmt, ytd.employerPensionAmt || 0);
  }).join('');

  var css = [
    'body{font-family:Calibri,Arial,sans-serif;font-size:12px;color:#000;background:#fff;margin:0;padding:20px 24px}',
    '.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}',
    '.emp-box{border:1px solid #aaa;padding:8px 12px;margin-bottom:10px;display:flex;justify-content:space-between;font-size:11px}',
    '.sum-box{border:1px solid #000;padding:8px 12px;margin-bottom:12px;background:#fafafa;font-size:11px}',
    '.sum-box table{width:100%;border-collapse:collapse}',
    '.sum-box td{padding:1px 4px}',
    '.sum-box td:nth-child(2),.sum-box td:nth-child(4){text-align:right;font-weight:700}',
    'table.det{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px}',
    'table.det th{padding:4px 8px;border-bottom:2px solid #000;font-size:10px;color:#555;font-weight:700;letter-spacing:.4px;text-align:right}',
    'table.det th:first-child{text-align:left}',
    '.efooter{margin-top:14px;font-size:10px;color:#666;border-top:1px solid #ccc;padding-top:6px}',
  ].join('');

  var lang = IS ? 'is' : 'en';
  var T = {
    payslip:    IS ? 'Launase\u00f0ill'        : 'Payslip',
    slipNo:     IS ? 'Se\u00f0iln\u00famer'   : 'Slip no.',
    payDate:    IS ? 'Grei\u00f0sludagur'      : 'Payment date',
    bank:       IS ? 'Launareikningur'           : 'Bank',
    holAcct:    IS ? 'Orlofsreikningur'          : 'Holiday acct',
    summary:    IS ? 'Samt\u00f6lur launase\u00f0ils' : 'Payslip summary',
    ytd:        IS ? 'Fr\u00e1 \u00e1ram\u00f3tum'   : 'YTD',
    gross:      IS ? 'Laun'                      : 'Gross',
    ded:        IS ? 'Fr\u00e1dr\u00e1ttur'   : 'Deductions',
    net:        IS ? 'Útborgað'            : 'Net pay',
    earnings:   IS ? 'Laun'                      : 'Earnings',
    deductions: IS ? 'Fr\u00e1dr\u00e1ttur'   : 'Deductions',
    employer:   IS ? 'Framlag launagrei\u00f0anda' : 'Employer contributions',
    holiday:    IS ? 'Til uppst\u00f6fnunar \u00e1 orlofsárinu' : 'Accrued holiday',
    period:     IS ? 'T\u00edmabil'             : 'Period',
    rehab:      IS ? 'Endurh\u00e6fingarsj\u00f3\u00f0ur (0.1%)' : 'Rehabilitation fund (0.1%)',
    taxBase:    IS ? 'Reiknuð sta\u00f0grei\u00f0sla (stofn: ' : 'Computed tax (base: ',
    credit:     IS ? 'Persónuafsláttur'         : 'Personal tax credit',
    taxWh:      IS ? 'Sta\u00f0grei\u00f0sla skatta alls' : 'Tax withheld',
    orlofBank:  IS ? 'Orlof \u00ed banka'       : 'Holiday savings \u2192 orlofsreikningur',
    totalDed:   IS ? 'Fr\u00e1dr\u00e1ttur samtals' : 'Total deductions',
    grossTot:   IS ? 'Laun samtals'              : 'Gross total',
    holCust:    IS ? 'Orlofslaun til v\u00f6rslua\u00f0ila' : 'Holiday pay to custodian',
    now:        IS ? 'N\u00fa'                  : 'Now',
    total:      IS ? 'Samtals'                   : 'Total',
  };

  return '<!DOCTYPE html><html lang="' + lang + '"><head><meta charset="UTF-8"><style>' + css + '</style></head><body>'
    + '<div class="hdr">'
    +   '<div style="font-size:22px;font-weight:700;color:#c0392b">' + T.payslip + '</div>'
    +   '<div style="text-align:right;font-size:11px"><div style="font-weight:700;font-size:14px">' + esc(employer.employerName || '') + '</div><div>kt. ' + esc(employer.employerKt || '') + '</div></div>'
    + '</div>'
    + '<div class="emp-box">'
    +   '<div><div style="font-weight:700;font-size:13px">' + esc(emp.name || '') + '</div><div>' + esc(emp.title || '') + '</div><div>' + esc(emp.kt || '') + '</div></div>'
    +   '<div style="text-align:right">'
    +     '<div>' + T.slipNo  + ': ' + esc(data.slipNumber  || '') + '</div>'
    +     '<div>' + T.payDate + ': ' + esc(data.paymentDate || '') + '</div>'
    +     '<div>' + T.bank    + ': ' + esc(emp.bankAccount  || '') + '</div>'
    +     '<div>' + T.holAcct + ': ' + esc(emp.orlofsreikningur || '') + '</div>'
    +   '</div>'
    + '</div>'
    + '<div class="sum-box">'
    +   '<div style="font-weight:700;font-size:10px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">'
    +     T.summary + '&nbsp;&nbsp;<span style="color:#888;font-weight:400">' + T.ytd + '</span></div>'
    +   '<table>'
    +     '<tr><td>' + T.gross + '</td><td>' + kr(calc.grossTotal || 0) + '</td><td style="color:#888;padding-left:16px">' + T.ytd + '</td><td style="color:#888">' + kr(ytd.grossTotal || 0) + '</td></tr>'
    +     '<tr><td>' + T.ded + '</td><td>' + kr(calc.totalDeductions || 0) + '</td><td></td><td style="color:#888">' + kr(ytd.totalDeductions || 0) + '</td></tr>'
    +     '<tr style="border-top:1px solid #000"><td style="font-weight:700">' + T.net + '</td><td>' + kr(calc.netPay || 0) + '</td><td></td><td style="color:#888;font-weight:700">' + kr(ytd.netPay || 0) + '</td></tr>'
    +   '</table>'
    + '</div>'
    + '<table class="det"><thead><tr><th style="text-align:left" colspan="4">' + T.earnings + '</th><th>' + T.period + '</th><th>' + T.ytd + '</th></tr></thead><tbody>'
    + row('Regular (' + calc.regularHrs.toFixed(2) + 'h \u00d7 ' + kr(emp.baseRateKr || 0) + ' kr/h)', 'Dagvinna (' + calc.regularHrs.toFixed(2) + 'klst \u00d7 ' + kr(emp.baseRateKr || 0) + ' kr)', calc.dagvinna, ytd.dagvinna || 0)
    + (calc.otLines || []).filter(function(l) { return l.earnings > 0; }).map(function(l) {
        var en = (l.labelEN || l.label) + ' ' + (l.multiplier || '') + '\u00d7 (' + l.hrs.toFixed(2) + 'h)';
        var is = (l.label || l.labelEN) + ' (' + l.hrs.toFixed(2) + 'klst)';
        return row(en, is, l.earnings, 0);
      }).join('')
    + mRows
    + row('Holiday pay (' + pct(calc.orlofsRate || 0) + ')', 'Orlofslaun (' + pct(calc.orlofsRate || 0) + ')', calc.orlofslaun, ytd.orlofslaun || 0)
    + row('Gross total', T.grossTot, calc.grossTotal, ytd.grossTotal || 0, { bold: true })
    + '</tbody></table>'
    + '<table class="det"><thead><tr><th style="text-align:left" colspan="4">' + T.deductions + '</th><th>' + T.period + '</th><th>' + T.ytd + '</th></tr></thead><tbody>'
    + pensionRows + unionRows
    + row(T.taxBase + kr(calc.taxBase || 0) + ')', T.taxBase + kr(calc.taxBase || 0) + ')', -calc.taxGross, 0, { neg: true, yb: true })
    + row(T.credit,   T.credit,  calc.personalCredit,  ytd.personalCredit  || 0)
    + row(T.taxWh,    T.taxWh,  -calc.taxAfterCredit, -(ytd.taxAfterCredit || 0), { neg: true })
    + row(T.orlofBank, T.orlofBank, -calc.orlofIBanki, -(ytd.orlofIBanki || 0), { neg: true })
    + row(T.totalDed,  T.totalDed, -calc.totalDeductions, -(ytd.totalDeductions || 0), { bold: true, neg: true })
    + '</tbody></table>'
    + '<table class="det"><thead><tr><th style="text-align:left" colspan="4">' + T.employer + '</th><th>' + T.period + '</th><th>' + T.ytd + '</th></tr></thead><tbody>'
    + empPensionRows
    + row(T.rehab, T.rehab, calc.endurhaefingarsjodur, ytd.endurhaefingarsjodur || 0)
    + '</tbody></table>'
    + '<table class="det"><thead><tr><th style="text-align:left" colspan="4">' + T.holiday + '</th><th>' + T.now + '</th><th>' + T.total + '</th></tr></thead><tbody>'
    + row(T.holCust, T.holCust, calc.orlofIBanki, ytd.orlofIBanki || 0)
    + '</tbody></table>'
    + '<div class="efooter"><strong>' + esc(employer.employerName || '') + '</strong>'
    + ' \u00b7 ' + esc(employer.employerAddress || '')
    + ' \u00b7 kt. ' + esc(employer.employerKt || '') + '</div>'
    + '</body></html>';
}
