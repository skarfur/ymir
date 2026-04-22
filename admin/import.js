// ═══════════════════════════════════════════════════════════════════════════════
// admin/import.js — CSV member import (Abler)
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

function showImportStep(n) {
  [1,2,3].forEach(i => {
    document.getElementById("importStep" + i).classList.toggle("hidden", i !== n);
  });
}

function handleCSVUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      importResult = parseAblerCSV(e.target.result, members);
      renderImportPreview(importResult);
    } catch(err) {
      document.getElementById("importError").textContent = s("admin.parseError") + ": " + err.message;
      document.getElementById("importError").style.display = "block";
    }
  };
  reader.readAsText(file, "UTF-8");
}

function parseAblerCSV(text, existing) {
  const lines  = text.split(/\r?\n/).filter(l => l.trim());
  const header = lines[0].split(/[,;]/).map(h => h.trim().toLowerCase().replace(/\s+/g,'_'));
  const col    = k => header.indexOf(k);
  const rows   = lines.slice(1).map(l => {
    const vals = l.split(/[,;]/);
    const get  = k => (vals[col(k)] || "").trim().replace(/^"|"$/g,'');
    return {
      kennitala:      get('kennitala'),
      name:           get('name') || get('full_name') || get('nafn'),
      email:          get('email') || get('netfang'),
      phone:          get('phone') || get('simi'),
      dob:            get('dob') || get('date_of_birth'),
    };
  }).filter(r => r.kennitala && r.name);

  const added   = [], updated = [], unchanged = [], flagged = [], ambiguous = [];
  const existKt = new Map(existing.map(m => [m.kennitala, m]));
  const existNames = new Map();
  existing.forEach(m => {
    const norm = (m.name||'').trim().toLowerCase();
    if (norm) { if (!existNames.has(norm)) existNames.set(norm, []); existNames.get(norm).push(m); }
  });

  // Helper: count differing characters between two strings of same length
  function ktDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let d = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) d++; }
    return d;
  }

  rows.forEach(r => {
    const ex = existKt.get(r.kennitala);
    if (ex) {
      if (ex.name !== r.name || ex.email !== r.email) {
        updated.push({ ...r, id: ex.id, _prev: ex });
      } else { unchanged.push(r); }
    } else {
      // Check for possible duplicate: same name OR very similar kennitala
      const norm = r.name.trim().toLowerCase();
      const nameMatch = (existNames.get(norm) || []).find(m => m.kennitala !== r.kennitala);
      // Also check for kennitala off by 1-2 digits (typo detection)
      let ktMatch = null;
      if (!nameMatch && r.kennitala.length >= 6) {
        for (const m of existing) {
          if (m.kennitala === r.kennitala) continue;
          if (ktDistance(r.kennitala, m.kennitala) <= 2) { ktMatch = m; break; }
        }
      }
      const match = nameMatch || ktMatch;
      if (match) {
        const reason = nameMatch ? 'Same name, different kennitala' : 'Similar kennitala (possible typo)';
        ambiguous.push({ csvRow: r, existing: match, reason });
      } else {
        added.push(r);
      }
    }
  });
  const activeOnly = existing.filter(m => boolVal(m.active) !== false && m.active !== 'FALSE');
  activeOnly.forEach(m => {
    if (['admin','staff','guest','guardian'].includes(m.role)) return;
    if (!rows.find(r => r.kennitala === m.kennitala)) flagged.push(m);
  });
  return { added, updated, unchanged, flagged, ambiguous };
}

function renderImportPreview(res) {
  const chips = [
    { label: `${res.added.length} new`,         cls: 'chip-green'  },
    { label: `${res.updated.length} updated`,   cls: 'chip-accent'  },
    { label: `${res.unchanged.length} unchanged`,cls: 'chip-muted' },
    { label: `${res.flagged.length} not in import`, cls: 'chip-orange' },
  ];
  if (res.ambiguous.length) chips.push({ label: `${res.ambiguous.length} needs review`, cls: 'chip-red' });
  document.getElementById("importSummary").innerHTML = chips.map(c =>
    `<span class="import-chip ${c.cls}">${c.label}</span>`).join("");

  let html = "";
  // Ambiguous matches — admin must review before anything happens
  if (res.ambiguous.length) {
    html += `<div style="font-size:11px;color:#9b59b6;margin:10px 0 4px;font-weight:500">NEEDS REVIEW — possible duplicates (${res.ambiguous.length})</div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:6px">These rows are skipped by default. Only change if you are sure.</div>`;
    res.ambiguous.forEach((a, idx) => {
      html += `<div class="import-ambig" data-ambig-idx="${idx}">
        <div style="flex:1">
          <div><strong>CSV:</strong> ${esc(a.csvRow.name)} <span style="color:var(--muted)">(${esc(a.csvRow.kennitala)})</span></div>
          <div><strong>Existing:</strong> ${esc(a.existing.name)} <span style="color:var(--muted)">(${esc(a.existing.kennitala)})</span></div>
          <div style="color:#9b59b6;font-size:10px;margin-top:2px">${esc(a.reason || 'Possible match')}</div>
        </div>
        <div class="import-ambig-btns">
          <button data-admin-click="resolveAmbig" data-admin-arg="${idx}" data-admin-arg2="same" title="Same person — update existing record with CSV kennitala &amp; data">Update existing</button>
          <button data-admin-click="resolveAmbig" data-admin-arg="${idx}" data-admin-arg2="new" title="Different person — add CSV row as a separate new member">Add as new</button>
          <button data-admin-click="resolveAmbig" data-admin-arg="${idx}" data-admin-arg2="skip" class="selected" title="Do nothing with this row">Skip</button>
        </div>
      </div>`;
    });
  }
  if (res.added.length) {
    html += `<div style="font-size:11px;color:var(--green);margin:10px 0 4px;font-weight:500">NEW (${res.added.length})</div>
      <div class="import-list">${res.added.map(m => `
        <div class="import-row">
          <span style="color:var(--muted);width:80px">${esc(m.kennitala)}</span>
          <span style="flex:1">${esc(m.name)}</span>
          ${m.dob && (new Date().getFullYear() - parseInt(sstr(m.dob).slice(0,4))) < 18
            ? `<span class="minor-badge">minor</span>` : ""}
        </div>`).join("")}</div>`;
  }
  if (res.updated.length) {
    html += `<div style="font-size:11px;color:var(--accent-fg);margin:10px 0 4px;font-weight:500">UPDATED (${res.updated.length})</div>
      <div class="import-list">${res.updated.map(m => `
        <div class="import-row">
          <span style="color:var(--muted);width:80px">${esc(m.kennitala)}</span>
          <span style="flex:1">${esc(m.name)}</span>
          <span style="color:var(--muted);font-size:11px">was: ${esc(m._prev.name)}</span>
        </div>`).join("")}</div>`;
  }
  if (res.flagged.length) {
    html += `<div style="font-size:11px;color:var(--orange);margin:10px 0 4px;font-weight:500">NOT IN THIS IMPORT (${res.flagged.length})
      <span style="font-weight:400;opacity:.7"> — check to deactivate</span></div>
      <div style="margin-bottom:4px">
        <label style="font-size:10px;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:4px">
          <input type="checkbox" id="flagSelectAll" data-admin-change-check="toggleFlagAll"> Select all
        </label>
      </div>
      <div class="import-list">${res.flagged.map(m => `
        <div class="import-row">
          <label>
            <input type="checkbox" class="flag-cb" value="${esc(m.id)}" data-kt="${esc(m.kennitala)}">
            <span style="color:var(--muted);width:80px">${esc(m.kennitala)}</span>
            <span style="flex:1">${esc(m.name)}</span>
            <span style="color:var(--muted);font-size:10px">${esc(m.role||'member')}</span>
          </label>
        </div>`).join("")}</div>`;
  }

  document.getElementById("importLists").innerHTML = html;
  document.getElementById("importError").style.display = "none";
  showImportStep(2);
}

function toggleFlagAll(checked) {
  document.querySelectorAll('.flag-cb').forEach(cb => { cb.checked = checked; });
}

// Ambiguous resolution: track decisions per index
let _ambigDecisions = {};
function resolveAmbig(idx, decision) {
  _ambigDecisions[idx] = decision;
  const row = document.querySelector(`[data-ambig-idx="${idx}"]`);
  if (!row) return;
  row.querySelectorAll('.import-ambig-btns button').forEach(btn => btn.classList.remove('selected'));
  const labels = { same: 'Update existing', new: 'Add as new', skip: 'Skip' };
  row.querySelectorAll('.import-ambig-btns button').forEach(btn => {
    if (btn.textContent === labels[decision]) btn.classList.add('selected');
  });
}

async function confirmImport() {
  if (!importResult) return;
  const btn = document.getElementById("confirmImportBtn");
  btn.disabled = true; btn.textContent = s("admin.importing");
  try {
    // Resolve ambiguous entries based on admin decisions
    const extraAdded = [], extraUpdated = [];
    (importResult.ambiguous || []).forEach((a, idx) => {
      const decision = _ambigDecisions[idx] || 'skip';
      if (decision === 'new') { extraAdded.push(a.csvRow); }
      else if (decision === 'same') { extraUpdated.push({ ...a.csvRow, id: a.existing.id, kennitala: a.existing.kennitala, _prev: a.existing }); }
    });

    const toSend = [...importResult.added, ...extraAdded, ...importResult.updated, ...extraUpdated].map(m => {
      const c = { ...m }; delete c._s; delete c._prev; return c;
    });
    const importTemps = [];
    if (toSend.length) {
      const results = await Promise.all(chunk(toSend, 10).map(rows => apiPost("importMembers", { rows })));
      results.forEach(r => {
        if (r && Array.isArray(r.tempPasswords)) importTemps.push(...r.tempPasswords);
      });
    }

    // Deactivate checked flagged members
    const deactivateIds = Array.from(document.querySelectorAll('.flag-cb:checked')).map(cb => cb.value).filter(Boolean);
    let deactivated = 0;
    if (deactivateIds.length) {
      const res = await apiPost("deactivateMembers", { ids: deactivateIds });
      deactivated = res.deactivated || 0;
      deactivateIds.forEach(id => {
        const m = members.find(x => x.id === id);
        if (m) m.active = false;
      });
    }

    importResult.updated.forEach(u => {
      members = members.map(m => m.kennitala === u.kennitala ? { ...m, ...u } : m);
    });
    extraUpdated.forEach(u => {
      members = members.map(m => m.id === u.id ? { ...m, ...u } : m);
    });
    importResult.added.forEach(a => {
      const c = { ...a }; delete c._s; members.push(c);
    });
    extraAdded.forEach(a => {
      const c = { ...a }; delete c._s; members.push(c);
    });

    const totalAdded = importResult.added.length + extraAdded.length;
    const totalUpdated = importResult.updated.length + extraUpdated.length;
    let msg = s('admin.importComplete', { added: totalAdded, updated: totalUpdated });
    if (deactivated) msg += ' ' + s('admin.importDeactivated', { count: deactivated });
    document.getElementById("importDoneMsg").textContent = msg;
    showImportStep(3);
    if (importTemps.length) showTempPasswordDialog(importTemps);
  } catch(e) {
    document.getElementById("importError").textContent = s("admin.importFailed") + ": " + e.message;
    document.getElementById("importError").style.display = "block";
    btn.disabled = false; btn.textContent = s("admin.confirmImport");
  }
}

function resetImport() {
  importResult = null;
  _ambigDecisions = {};
  document.getElementById("csvFile").value = "";
  showImportStep(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESERVATION SLOT CALENDAR
// ═══════════════════════════════════════════════════════════════════════════════

