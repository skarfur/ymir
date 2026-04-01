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
  tryggingagjaldRate:   0.0685,
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
// Explicit European integer formatter: period=thousands, no decimal (ISK amounts are always integers)
function _fmtEU(n) {
  var val = Math.round(n || 0), neg = val < 0;
  var s = Math.abs(val).toString(), out = '';
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += '.';
    out += s[i];
  }
  return neg ? '-' + out : out;
}
window.fmtKr  = function(n) { return _fmtEU(n); };
window.fmtPct = function(r) { return ((r || 0) * 100).toFixed(2).replace(/\.?0+$/, '') + '%'; };
window.fmtDurationMins = function(mins) {
  var h = Math.floor(+mins / 60), m = Math.round(+mins % 60);
  return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm';
};

/* PP OT SPLITTER ═════════════════════════════════════════════════════════════
   otRules is an ordered array of tier objects {id, label, labelEN, multiplier, periods}.
   Higher index = higher priority (checked first). Returns {regularMins, otMins}.
══════════════════════════════════════════════════════════════════════════════ */
function _otRulesToArray(rules) {
  if (!rules) return [];
  return Array.isArray(rules) ? rules : [];
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
  var tiersArr = _otRulesToArray(otRules || (window.PAYROLL_CONFIG || {}).otRules);
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
  return result;
};

/* PP CALCULATE PAYSLIP ════════════════════════════════════════════════════════
   calculatePayslip(emp, regularMinutes, otMinutes, manualLines, cfg)
     otMinutes: object {[tierId]: minutes}
   Returns full breakdown including otLines[] array.
══════════════════════════════════════════════════════════════════════════════ */
window.calculatePayslip = function(emp, regularMinutes, otMinutes, manualLines, cfg) {
  var otMins      = otMinutes || {};
  cfg            = Object.assign({}, window.PAYROLL_CONFIG, cfg || {});
  regularMinutes = +regularMinutes || 0;
  manualLines    = manualLines || [];

  var tiersArr = _otRulesToArray(cfg.otRules);
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

/* PP PUNCH CLOCK WIDGET ══════════════════════════════════════════════════════
   punchClockWidget(el, employeeId, opts)
   opts.allowBreaks — show start/end break button when true
══════════════════════════════════════════════════════════════════════════════ */
function punchClockWidget(el, employeeId, opts) {
  if (!el || !employeeId) return;
  opts = opts || {};

  if (!document.getElementById('pcStyle')) {
    var st = document.createElement('style');
    st.id  = 'pcStyle';
    st.textContent =
      '.pc-wrap{padding:14px 16px 10px;display:flex;flex-direction:column;gap:10px}' +
      '.pc-btns{display:flex;gap:8px;flex-wrap:wrap}' +
      '.pc-btn{flex:1;min-width:110px;border:none;border-radius:6px;font-size:13px;font-weight:600;padding:10px 18px;cursor:pointer;transition:background .15s,opacity .15s;font-family:inherit;letter-spacing:.2px}' +
      '.pc-btn:active{opacity:.85}' +
      '.pc-btn:disabled{opacity:.45;cursor:default}' +
      '.pc-btn-in{background:var(--green);color:#fff}' +
      '.pc-btn-out{background:var(--red);color:#fff}' +
      '.pc-btn-brk{background:var(--surface);border:1px solid var(--brass);color:var(--brass)}' +
      '.pc-btn-brk-end{background:var(--brass);color:#0b1f38}' +
      '.pc-status{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px}' +
      '.pc-recent{border-top:1px solid var(--border);padding:10px 16px 12px;display:flex;flex-direction:column;gap:0}' +
      '.pc-recent-toggle{font-size:9px;letter-spacing:1.2px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;cursor:pointer;display:flex;align-items:center;gap:4px;background:none;border:none;padding:0;font-family:inherit}' +
      '.pc-recent-toggle .pc-chevron{display:inline-block;transition:transform .2s;font-size:8px}' +
      '.pc-recent-toggle.open .pc-chevron{transform:rotate(90deg)}' +
      '.pc-recent-body{display:none}' +
      '.pc-recent-body.open{display:block}' +
      '.pc-recent-lbl{font-size:9px;letter-spacing:1.2px;color:var(--muted);text-transform:uppercase;margin-bottom:6px}' +
      '.pc-row{display:flex;align-items:center;gap:8px;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)}' +
      '.pc-row:last-child{border-bottom:none}' +
      // End-of-shift modal
      '.pc-modal-bg{position:fixed;inset:0;background:#00000088;z-index:600;display:flex;align-items:flex-end;justify-content:center}' +
      '.pc-modal{background:var(--bg);border-radius:16px 16px 0 0;padding:20px 20px 36px;width:100%;max-width:520px;max-height:80vh;overflow-y:auto}' +
      '.pc-modal-title{font-size:14px;font-weight:600;color:var(--brass);margin-bottom:4px;letter-spacing:.3px}' +
      '.pc-modal-sub{font-size:11px;color:var(--muted);margin-bottom:16px}' +
      '.pc-summary-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px}' +
      '.pc-summary-row:last-child{border-bottom:none}' +
      '.pc-summary-lbl{color:var(--muted);font-size:11px}' +
      '.pc-summary-val{font-weight:600;color:var(--text)}' +
      '.pc-entry-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px}' +
      '.pc-entry-row:last-child{border-bottom:none}' +
      '.pc-edit-row{background:var(--surface);border-radius:6px;padding:8px;margin:4px 0;font-size:12px;display:flex;flex-direction:column;gap:6px}' +
      '.pc-edit-row input{background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:12px;padding:4px 6px;width:100%;box-sizing:border-box}';
    document.head.appendChild(st);
  }

  function t(k) { return typeof s === 'function' ? s(k) : k.split('.').pop(); }
  function _esc(v) { return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function fmtTime(iso) { return iso ? String(iso).slice(11,16) : '--:--'; }
  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0,10).split('-');
    return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : String(iso).slice(0,10);
  }

  // ── State: { clockedIn, onBreak, clockedInAt, breakStartedAt, recent, todayEntries }
  function render(state) {
    var ci    = state.clockedIn;
    var onBrk = state.onBreak;
    var allowBreaks = opts.allowBreaks;

    // ── Status line
    var statusHTML = '';
    if (ci && !onBrk) {
      statusHTML = '<div class="pc-status">'
        + t('payroll.clockedInAt') + ' <strong>' + fmtTime(state.clockedInAt) + '</strong>'
        + '</div>';
    } else if (onBrk) {
      statusHTML = '<div class="pc-status">'
        + t('payroll.onBreak') + ' <strong>' + fmtTime(state.breakStartedAt) + '</strong>'
        + '</div>';
    }

    // ── Buttons
    var mainLabel = ci ? t('payroll.clockOut') : t('payroll.clockIn');
    var mainCls   = ci ? 'pc-btn-out' : 'pc-btn-in';
    var brkLabel  = onBrk ? t('payroll.endBreak') : t('payroll.startBreak');
    var brkCls    = onBrk ? 'pc-btn-brk-end' : 'pc-btn-brk';

    var btnsHTML = '<div class="pc-btns">'
      + '<button id="pcMainBtn" class="pc-btn ' + mainCls + '">' + mainLabel + '</button>'
      + (allowBreaks && ci
          ? '<button id="pcBrkBtn" class="pc-btn ' + brkCls + '">' + brkLabel + '</button>'
          : '')
      + '</div>';

    // ── Recent shifts (current week, collapsible, default hidden)
    var recentHTML = '';
    var recent = state.recent || [];
    // Filter to current week (Monday–Sunday)
    var now = new Date();
    var day = now.getDay();
    var mondayOffset = day === 0 ? -6 : 1 - day;
    var weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
    var weekStartISO = weekStart.toISOString().slice(0,10);
    recent = recent.filter(function(r) { return (r.inTime || '').slice(0,10) >= weekStartISO; });
    if (recent.length) {
      var isOpen = el._pcRecentOpen || false;
      recentHTML = '<div class="pc-recent">'
        + '<button class="pc-recent-toggle' + (isOpen ? ' open' : '') + '" id="pcRecentToggle">'
        + '<span class="pc-chevron">\u25b6</span> ' + t('payroll.recentShifts') + ' (' + recent.length + ')'
        + '</button>'
        + '<div class="pc-recent-body' + (isOpen ? ' open' : '') + '" id="pcRecentBody">'
        + recent.map(function(r) {
            return '<div class="pc-row">'
              + '<span style="min-width:80px;font-variant-numeric:tabular-nums">' + fmtTime(r.inTime) + '\u2013' + fmtTime(r.outTime) + '</span>'
              + '<span style="flex:1;color:var(--muted)">' + fmtDate(r.inTime) + '</span>'
              + '<span style="font-weight:600">' + (r.durationMinutes ? fmtDurationMins(+r.durationMinutes) : '\u2013') + '</span>'
              + '</div>';
          }).join('')
        + '</div></div>';
    } else if (!ci) {
      recentHTML = '<div class="pc-recent"><span style="font-size:12px;color:var(--muted)">' + t('payroll.noShifts') + '</span></div>';
    }

    el.innerHTML = '<div class="pc-wrap">' + btnsHTML + statusHTML
      + (state.error ? '<div style="font-size:12px;color:var(--red)">' + _esc(state.error) + '</div>' : '')
      + '</div>' + recentHTML;

    // ── Button handlers
    document.getElementById('pcMainBtn').onclick = async function() {
      this.disabled = true;
      try {
        if (ci) {
          await apiPost('clockOut', { employeeId: employeeId });
          var res = await apiGet('getTimeEntries', { employeeId: employeeId });
          pcShowSummaryModal(res.entries || [], employeeId);
        } else {
          await apiPost('clockIn', { employeeId: employeeId });
        }
        await pcRefresh(el, employeeId);
      } catch(err) { render(Object.assign({}, state, { error: err.message || 'Error' })); }
    };
    var brkBtn = document.getElementById('pcBrkBtn');
    if (brkBtn) {
      brkBtn.onclick = async function() {
        this.disabled = true;
        try {
          if (onBrk) await apiPost('breakEnd',   { employeeId: employeeId });
          else       await apiPost('breakStart', { employeeId: employeeId });
          await pcRefresh(el, employeeId);
        } catch(err) { render(Object.assign({}, state, { error: err.message || 'Error' })); }
      };
    }

    // ── Recent shifts toggle
    var toggleBtn = document.getElementById('pcRecentToggle');
    if (toggleBtn) {
      toggleBtn.onclick = function() {
        el._pcRecentOpen = !el._pcRecentOpen;
        toggleBtn.classList.toggle('open');
        document.getElementById('pcRecentBody').classList.toggle('open');
      };
    }

  }

  // ── End-of-shift summary modal
  function pcShowSummaryModal(allEntries, empId) {
    var today = new Date().toISOString().slice(0,10);
    var todayEntries = allEntries.filter(function(e) {
      return (e.timestamp || '').slice(0,10) === today || (e.originalTimestamp || '').slice(0,10) === today;
    }).sort(function(a,b) { return a.timestamp > b.timestamp ? 1 : -1; });

    var ins   = todayEntries.filter(function(e) { return e.type === 'in'; });
    var outs  = todayEntries.filter(function(e) { return e.type === 'out'; });
    var brks  = todayEntries.filter(function(e) { return e.type === 'break_start'; });
    var brkEs = todayEntries.filter(function(e) { return e.type === 'break_end'; });

    // Calculate totals
    var totalWorkedMins = outs.reduce(function(s,o) { return s + (+o.durationMinutes || 0); }, 0);
    var totalBreakMins  = brkEs.reduce(function(s,e) { return s + (+e.durationMinutes || 0); }, 0);

    // Build entry rows
    function entryRow(e, label) {
      return '<div class="pc-entry-row" id="pcERow_' + e.id + '">'
        + '<span style="min-width:60px;color:var(--muted);font-size:10px;text-transform:uppercase">' + label + '</span>'
        + '<span style="flex:1;font-variant-numeric:tabular-nums">' + fmtTime(e.timestamp) + '</span>'
        + '<span style="color:var(--muted)">' + (e.durationMinutes ? fmtDurationMins(+e.durationMinutes) : '') + '</span>'
        + '<button onclick="pcEditEntry(\'' + e.id + '\',\'' + e.timestamp + '\',' + empId + ')" style="background:none;border:none;color:var(--muted);font-size:10px;cursor:pointer;padding:2px 6px;letter-spacing:.3px">' + t('payroll.editEntry') + '</button>'
        + '</div>';
    }

    var rows = '';
    todayEntries.forEach(function(e) {
      var label = e.type === 'in' ? 'IN' : e.type === 'out' ? 'OUT' : e.type === 'break_start' ? 'BRK\u25b6' : e.type === 'break_end' ? 'BRK\u25a0' : e.type;
      rows += entryRow(e, label);
    });

    var html = '<div class="pc-modal-bg" id="pcSummaryBg" onclick="if(event.target===this)this.remove()">'
      + '<div class="pc-modal">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'
      + '<div class="pc-modal-title" style="margin:0">' + t('payroll.shiftSummary') + '</div>'
      + '<button class="modal-close-x" onclick="document.getElementById(\'pcSummaryBg\').remove()">&times;</button>'
      + '</div>'
      + '<div class="pc-modal-sub">' + today + '</div>'
      + '<div style="margin-bottom:14px">'
      + '<div class="pc-summary-row"><span class="pc-summary-lbl">' + t('payroll.totalWorked') + '</span><span class="pc-summary-val">' + fmtDurationMins(totalWorkedMins) + '</span></div>'
      + (totalBreakMins ? '<div class="pc-summary-row"><span class="pc-summary-lbl">' + t('payroll.totalBreak') + '</span><span class="pc-summary-val">' + fmtDurationMins(totalBreakMins) + '</span></div>' : '')
      + '</div>'
      + (rows ? '<div style="margin-bottom:16px">' + rows + '</div>' : '')
      + '<div id="pcEditArea"></div>'
      + '<button class="btn btn-primary" style="width:100%" onclick="document.getElementById(\'pcSummaryBg\').remove()">' + t('payroll.confirmShift') + '</button>'
      + '</div></div>';

    var div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
  }

  // ── Inline entry edit (injected into modal)
  window.pcEditEntry = function(id, currentTs, empId) {
    var area = document.getElementById('pcEditArea');
    if (!area) return;
    var localDt = currentTs ? new Date(currentTs).toISOString().slice(0,16) : '';
    area.innerHTML = '<div class="pc-edit-row">'
      + '<label style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.5px">Edit time for entry</label>'
      + '<input type="datetime-local" id="pcEditTs" value="' + localDt + '">'
      + '<input type="text" id="pcEditNote" placeholder="Note (optional)">'
      + '<div style="display:flex;gap:6px">'
      + '<button class="btn btn-primary" style="flex:1;font-size:11px" onclick="pcSaveEdit(\'' + id + '\',' + empId + ')">Save</button>'
      + '<button class="btn btn-secondary" style="font-size:11px" onclick="document.getElementById(\'pcEditArea\').innerHTML=\'\'">Cancel</button>'
      + '</div></div>';
  };

  window.pcSaveEdit = async function(id, empId) {
    var tsEl   = document.getElementById('pcEditTs');
    var noteEl = document.getElementById('pcEditNote');
    if (!tsEl || !tsEl.value) return;
    var iso = new Date(tsEl.value).toISOString();
    try {
      await apiPost('adminEditTime', { id: id, timestamp: iso, note: noteEl ? noteEl.value : '' });
      document.getElementById('pcEditArea').innerHTML = '<span style="color:var(--green);font-size:12px">\u2713 Saved</span>';
      var row = document.getElementById('pcERow_' + id);
      if (row) {
        var timeSpan = row.querySelectorAll('span')[1];
        if (timeSpan) timeSpan.textContent = iso.slice(11,16);
      }
    } catch(e) {
      document.getElementById('pcEditArea').innerHTML = '<span style="color:var(--red);font-size:12px">' + _esc(e.message) + '</span>';
    }
  };

  async function pcRefresh(container, empId) {
    try {
      var res     = await apiGet('getTimeEntries', { employeeId: empId });
      var entries = (res.entries || []).slice().sort(function(a,b) { return a.timestamp > b.timestamp ? 1 : -1; });
      var ins     = entries.filter(function(e) { return e.type === 'in'; });
      var outs    = entries.filter(function(e) { return e.type === 'out'; });
      var brkStarts = entries.filter(function(e) { return e.type === 'break_start'; });
      var brkEnds   = entries.filter(function(e) { return e.type === 'break_end'; });
      var lastIn    = ins[ins.length-1];
      var lastOut   = outs[outs.length-1];
      var lastBrkS  = brkStarts[brkStarts.length-1];
      var lastBrkE  = brkEnds[brkEnds.length-1];
      var ci    = !!(lastIn  && (!lastOut  || lastIn.timestamp  > lastOut.timestamp));
      var onBrk = !!(lastBrkS && (!lastBrkE || lastBrkS.timestamp > lastBrkE.timestamp));
      // Build recent completed shifts
      var recent = [];
      outs.slice().reverse().forEach(function(out) {
        var mi = ins.slice().reverse().find(function(i) { return i.timestamp < out.timestamp; });
        if (mi) recent.push({ inTime: mi.timestamp, outTime: out.timestamp, durationMinutes: out.durationMinutes });
      });
      render({ clockedIn: ci, onBreak: onBrk,
               clockedInAt: ci ? lastIn.timestamp : null,
               breakStartedAt: onBrk ? lastBrkS.timestamp : null,
               recent: recent });
    } catch(err) {
      render({ clockedIn: false, onBreak: false, recent: [], error: err.message || 'Could not load shift data' });
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
  function kr(n)  { return _fmtEU(n); }
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
