// shared/payroll.js — punch clock widget + payslip renderer
// Requires: shared/api.js (apiGet/apiPost/getLang)

// ── Punch clock widget ───────────────────────────────────────────────────────
function punchClockWidget(el, employeeId) {
  if (!el || !employeeId) return;

  if (!document.getElementById('pcStyle')) {
    const style = document.createElement('style');
    style.id = 'pcStyle';
    style.textContent = [
      '.pc-btn{border:none;border-radius:24px;font-size:15px;font-weight:700;',
      'padding:13px 36px;cursor:pointer;transition:background .2s,transform .1s;letter-spacing:.3px;}',
      '.pc-btn:active{transform:scale(.97);}',
      '.pc-btn-in{background:var(--green);color:#fff;}',
      '.pc-btn-out{background:var(--red);color:#fff;}',
      '.pc-entry{display:flex;align-items:center;gap:8px;font-size:12px;',
      'padding:5px 0;border-bottom:1px solid var(--border);}',
      '.pc-entry:last-child{border-bottom:none;}',
      '.pc-timer{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;',
      'color:var(--brass);letter-spacing:.5px;}'
    ].join('');
    document.head.appendChild(style);
  }

  function fmtMs(ms) {
    const s = Math.floor(ms/1000);
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sc = s%60;
    return h > 0
      ? h + 'h ' + String(m).padStart(2,'0') + 'm'
      : m + 'm ' + String(sc).padStart(2,'0') + 's';
  }

  function fmtMins(mins) {
    const h = Math.floor(mins/60), m = Math.round(mins%60);
    return h > 0 ? h + 'h ' + String(m).padStart(2,'0') + 'm' : m + 'm';
  }

  function render(state) {
    const lang = (typeof getLang === 'function') ? getLang() : 'EN';
    const t = k => (typeof s === 'function') ? s(k) : k.split('.').pop();
    const clockedIn = state.clockedIn;
    const elapsed   = clockedIn ? Date.now() - new Date(state.since).getTime() : 0;

    const recentHtml = (state.recent||[]).slice(0,5).map(e => {
      const inT  = (e.inTime||'').slice(11,16);
      const outT = (e.outTime||'').slice(11,16);
      const date = (e.inTime||'').slice(0,10);
      const dur  = e.durationMinutes ? fmtMins(+e.durationMinutes) : '–';
      return '<div class="pc-entry">'
        + '<span style="min-width:90px">' + inT + '–' + outT + '</span>'
        + '<span style="flex:1;color:var(--muted);font-size:11px">' + date + '</span>'
        + '<span style="font-weight:600">' + dur + '</span>'
        + '</div>';
    }).join('');

    el.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px 16px 10px">'
      + (clockedIn
          ? '<div style="text-align:center">'
            + '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">' + t('payroll.currentShift') + '</div>'
            + '<div class="pc-timer" id="pcTimerDisplay">' + fmtMs(elapsed) + '</div>'
            + '</div>'
          : '')
      + '<button id="pcMainBtn" class="pc-btn ' + (clockedIn ? 'pc-btn-out' : 'pc-btn-in') + '">'
        + (clockedIn ? t('payroll.clockOut') : t('payroll.clockIn'))
        + '</button>'
      + (state.error ? '<div style="font-size:12px;color:var(--red);text-align:center">' + state.error + '</div>' : '')
      + '</div>'
      + (recentHtml
          ? '<div style="padding:0 16px 14px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">' + t('payroll.recentShifts') + '</div>'
            + recentHtml
            + '</div>'
          : '<div style="padding:0 16px 14px;font-size:12px;color:var(--muted);text-align:center">' + t('payroll.noShifts') + '</div>');

    document.getElementById('pcMainBtn').onclick = async () => {
      const btn = document.getElementById('pcMainBtn');
      if (btn) btn.disabled = true;
      try {
        if (clockedIn) {
          await apiPost('clockOut', { employeeId: employeeId });
        } else {
          await apiPost('clockIn',  { employeeId: employeeId });
        }
        await pcRefresh(el, employeeId);
      } catch(err) {
        render(Object.assign({}, state, { error: err.message || 'Error' }));
      }
    };

    // Live tick while clocked in
    clearInterval(el._pcTick);
    if (clockedIn) {
      el._pcTick = setInterval(function() {
        const d = document.getElementById('pcTimerDisplay');
        if (d) d.textContent = fmtMs(Date.now() - new Date(state.since).getTime());
        else clearInterval(el._pcTick);
      }, 1000);
    }
  }

  async function pcRefresh(container, empId) {
    try {
      const res     = await apiGet('getTimeEntries?employeeId=' + empId);
      const entries = (res.entries || []).slice().sort((a,b) => a.timestamp > b.timestamp ? 1 : -1);
      const ins     = entries.filter(e => e.type === 'in');
      const outs    = entries.filter(e => e.type === 'out');
      const lastIn  = ins[ins.length - 1];
      const lastOut = outs[outs.length - 1];
      const clockedIn = !!(lastIn && (!lastOut || lastIn.timestamp > lastOut.timestamp));

      // Build recent pairs (most recent first)
      const recent = [];
      outs.slice().reverse().forEach(function(out) {
        const matchIn = ins.slice().reverse().find(function(i){ return i.timestamp < out.timestamp; });
        if (matchIn) recent.push({ inTime: matchIn.timestamp, outTime: out.timestamp, durationMinutes: out.durationMinutes });
      });

      render({ clockedIn: clockedIn, since: clockedIn ? lastIn.timestamp : null, recent: recent });
    } catch(err) {
      render({ clockedIn: false, recent: [], error: 'Could not load shift data' });
    }
  }

  // Store refresh fn on element for external calls
  el._pcRefresh = function() { return pcRefresh(el, employeeId); };
  el._pcRefresh();
  clearInterval(el._pcAutoRefresh);
  el._pcAutoRefresh = setInterval(function() { el._pcRefresh(); }, 60000);
}

// ── Duration helpers (exported for admin use) ─────────────────────────────────
function fmtDurationMins(mins) {
  const h = Math.floor(+mins/60), m = Math.round(+mins%60);
  return h > 0 ? h + 'h ' + String(m).padStart(2,'0') + 'm' : m + 'm';
}

// ── Payslip HTML renderer ─────────────────────────────────────────────────────
function renderPayslip(data) {
  const emp = data.employee, pay = data.pay, ytd = data.ytd, period = data.period;
  const employer = data.employer || {};
  const lang = (typeof getLang === 'function') ? getLang() : 'EN';
  const IS = lang === 'IS';
  const kr = function(n){ return Math.round(n).toLocaleString('is-IS') + ' kr.'; };
  const parts = (period||'').split('-');
  const yr = parts[0], mo = parts[1];
  const months_IS = ['jan','feb','mar','apr','maí','jún','júl','ágú','sep','okt','nóv','des'];
  const months_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthName = IS ? months_IS[+mo-1] : months_EN[+mo-1];

  function row(label, val, ytdVal, bold) {
    var bg = bold ? 'background:var(--surface);font-weight:600' : '';
    return '<tr style="' + bg + '">'
      + '<td style="padding:5px 8px;border-bottom:1px solid var(--border)">' + label + '</td>'
      + '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right">' + kr(val) + '</td>'
      + '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted)">' + kr(ytdVal) + '</td>'
      + '</tr>';
  }

  return '<div style="font-family:var(--font,sans-serif);max-width:520px;margin:0 auto;padding:24px">'
    + '<div style="display:flex;justify-content:space-between;margin-bottom:20px">'
      + '<div><div style="font-weight:700;font-size:16px">' + (employer.employerName||'') + '</div>'
      + '<div style="font-size:12px;color:var(--muted)">kt. ' + (employer.employerKt||'') + '</div></div>'
      + '<div style="text-align:right"><div style="font-weight:700">' + (IS?'Launaseðill':'Payslip') + '</div>'
      + '<div style="font-size:13px">' + (monthName||mo) + ' ' + yr + '</div></div>'
    + '</div>'
    + '<div style="margin-bottom:16px;padding:12px;background:var(--surface);border-radius:8px">'
      + '<div style="font-weight:600">' + (emp.name||'') + '</div>'
      + '<div style="font-size:12px;color:var(--muted)">' + (emp.title||'') + ' &nbsp;·&nbsp; kt. ' + (emp.kt||'') + '</div>'
      + '<div style="font-size:12px;color:var(--muted)">' + (IS?'Banki':'Bank') + ': ' + (emp.bankAccount||'') + '</div>'
    + '</div>'
    + '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px"><thead>'
      + '<tr style="font-size:11px;color:var(--muted)">'
      + '<th style="padding:4px 8px;text-align:left">' + (IS?'Liður':'Item') + '</th>'
      + '<th style="padding:4px 8px;text-align:right">' + (IS?'Tímabil':'Period') + '</th>'
      + '<th style="padding:4px 8px;text-align:right">' + (IS?'Frá áramótum':'YTD') + '</th>'
      + '</tr></thead><tbody>'
      + row(IS?'Dagvinna':'Regular hrs', pay.grossWage||0, ytd.grossWage||0)
      + (pay.orlofsfe ? row(IS?'Orlofsfé (10.17%)':'Holiday pay (10.17%)', pay.orlofsfe, ytd.orlofsfe||0) : '')
      + row(IS?'Heildarlaunagreiðsla':'Gross total', pay.grossTotal||0, ytd.grossTotal||0, true)
      + '<tr><td colspan="3" style="padding:3px"></td></tr>'
      + row(IS?('Lífeyrissjóður'):'Pension', -(pay.lifeyrir||0), -(ytd.lifeyrir||0))
      + (pay.sereignarsjodur ? row(IS?'Séreignarsjóður':'Private pension', -(pay.sereignarsjodur||0), -(ytd.sereignarsjodur||0)) : '')
      + row(IS?'Staðgreiðsla':'Tax withheld', -(pay.stadgreidslaSkattur||0), -(ytd.stadgreidslaSkattur||0))
      + row(IS?'Nettó til útgreiðslu':'Net pay', pay.netPay||0, ytd.netPay||0, true)
    + '</tbody></table>'
    + '<div style="font-size:11px;color:var(--muted);border-top:1px solid var(--border);padding-top:8px">'
      + (IS?'Orlof greiðist á':'Holiday pay to') + ': ' + (emp.orlofsreikningur||'')
    + '</div></div>';
}
