// ═══════════════════════════════════════════════════════════════════════════════
// admin/act-types.js — Activity types, subtypes, roles, presets
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

function renderActTypes() {
  const card   = document.getElementById("actTypesCard");
  const locale = getLang() === 'IS' ? 'is' : 'en';
  const active = actTypes
    .filter(a => bool(a.active))
    .sort((a, b) => {
      // Sort by tag first, then by name within tag
      const ta = (a.classTag || '').toLowerCase();
      const tb = (b.classTag || '').toLowerCase();
      if (ta !== tb) return ta.localeCompare(tb, locale, { sensitivity: 'base' });
      const la = (getLang() === 'IS' && a.nameIS ? a.nameIS : a.name) || '';
      const lb = (getLang() === 'IS' && b.nameIS ? b.nameIS : b.name) || '';
      return la.localeCompare(lb, locale, { sensitivity: 'base' });
    });
  if (!active.length) { card.innerHTML = `<div class="empty-state">${s('admin.noActTypes')}</div>`; return; }
  card.innerHTML = active.map(a => {
    const roles = Array.isArray(a.roles) ? a.roles : tryParse_(a.roles, []);
    const isVol = bool(a.volunteer);
    const tag = a.classTag || '';
    const sched = a.bulkSchedule
      ? (Array.isArray(a.bulkSchedule.daysOfWeek) && a.bulkSchedule.daysOfWeek.length
          ? a.bulkSchedule.daysOfWeek.length + ' ' + s('admin.daysPerWeek')
          : '')
      : '';
    const times = (a.defaultStart || a.defaultEnd)
      ? esc(a.defaultStart || '?') + (a.defaultEnd ? '–' + esc(a.defaultEnd) : '') : '';
    return `<div class="list-row list-row-clickable" style="flex-direction:column;align-items:stretch;gap:2px" data-admin-click="openActTypeModal" data-admin-arg="${a.id}">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="list-name">${esc(a.name)}${a.nameIS
          ? `<span style="color:var(--muted);font-size:11px;margin-left:8px">${esc(a.nameIS)}</span>` : ""}${tag
          ? `<span class="class-tag-chip" style="margin-left:8px">${esc(tag)}</span>` : ""}${isVol
          ? `<span style="color:var(--accent-fg);font-size:9px;margin-left:8px;letter-spacing:.5px">${s('admin.volunteerType').toUpperCase()}</span>` : ""}</span>
        <button class="row-del" data-admin-click="deleteActType" data-admin-arg="${a.id}">×</button>
      </div>
      ${(times || sched) ? `<div style="font-size:10px;color:var(--muted);padding:1px 0 1px 12px">${times}${times && sched ? ' · ' : ''}${sched}</div>` : ''}
      ${isVol && roles.length ? roles.map(r=>`<div style="font-size:10px;color:var(--muted);padding:1px 0 1px 12px">⚑ ${esc(r.name||'')}${r.slots?' ('+r.slots+')':''}${r.requiredEndorsement?` <span style="color:var(--accent-fg)">[${esc(certDefName((certDefs||[]).find(d=>d.id===r.requiredEndorsement))||r.requiredEndorsement)}]</span>`:''}</div>`).join('') : ''}
    </div>`;
  }).join("");
}

function openActTypeModal(id) {
  editingId = id || null;
  const a   = id ? actTypes.find(x => x.id === id) : null;
  document.getElementById("actTypeModalTitle").textContent = a ? s('admin.actTypeModal.edit') : s('admin.actTypeModal.add');
  document.getElementById("atName").value     = a ? a.name            : "";
  document.getElementById("atNameIS").value   = a ? (a.nameIS || "")  : "";
  document.getElementById("atClassTag").value = a ? (a.classTag || "") : "";
  document.getElementById("atActive").checked = a ? bool(a.active)    : true;
  document.getElementById("atVolunteer").checked = a ? bool(a.volunteer) : false;
  document.getElementById("atCalendarId").value = a ? (a.calendarId || "") : "";
  document.getElementById("atCalendarSyncActive").checked = a ? bool(a.calendarSyncActive) : false;
  document.getElementById("atDefaultStart").value = a ? (a.defaultStart || "") : "";
  document.getElementById("atDefaultEnd").value   = a ? (a.defaultEnd   || "") : "";
  // Bulk schedule (flat — lives on the class itself now)
  var bs = a && a.bulkSchedule
    ? (typeof a.bulkSchedule === 'string' ? tryParse_(a.bulkSchedule, null) : a.bulkSchedule)
    : null;
  window._atBulkSchedule = bs ? JSON.parse(JSON.stringify(bs))
    : { fromDate:'', toDate:'', daysOfWeek:[], startTime:'', endTime:'' };
  if (!Array.isArray(window._atBulkSchedule.daysOfWeek)) window._atBulkSchedule.daysOfWeek = [];
  document.getElementById("atBsFromDate").value = window._atBulkSchedule.fromDate || '';
  document.getElementById("atBsToDate").value   = window._atBulkSchedule.toDate   || '';
  // Reserved boats: each class can hold N boats for the duration of each
  // occurrence. Empty = no resource reservation (classroom, land work, etc.).
  window._atReservedBoatIds = a && Array.isArray(a.reservedBoatIds)
    ? a.reservedBoatIds.slice().map(String) : [];
  // Refresh datalist of existing class tags so the input autocompletes
  refreshClassTagOptions();
  renderAtDayBtns();
  renderAtBoatPicker();
  // Schedule source: default 'bulk' for legacy rows and new types.
  var schedSrc = (a && a.scheduleSource === 'calendar') ? 'calendar' : 'bulk';
  document.getElementById("atSchedSrcBulk").checked     = schedSrc === 'bulk';
  document.getElementById("atSchedSrcCalendar").checked = schedSrc === 'calendar';
  updateAtScheduleSource();
  document.getElementById("atDeleteBtn").classList.toggle("hidden", !a);
  // Load volunteer roles
  window._atRoles = a && a.roles ? JSON.parse(JSON.stringify(
    Array.isArray(a.roles) ? a.roles : tryParse_(a.roles, [])
  )) : [];
  toggleAtVolunteerSection();
  renderAtRoles();
  openModal("actTypeModal");
}

async function saveActType() {
  const name = document.getElementById("atName").value.trim();
  if (!name) { toast(s("admin.nameRequired"), "err"); return; }
  const isVol = document.getElementById("atVolunteer").checked;
  // Pull current bulk-schedule edits back from the form before save
  var bs = window._atBulkSchedule || { fromDate:'', toDate:'', daysOfWeek:[], startTime:'', endTime:'' };
  bs.fromDate = document.getElementById("atBsFromDate").value || '';
  bs.toDate   = document.getElementById("atBsToDate").value   || '';
  // Empty schedule (no fromDate/toDate AND no days) is normalized to null so
  // projection skips this class cleanly.
  var hasSchedule = (bs.fromDate || bs.toDate || (Array.isArray(bs.daysOfWeek) && bs.daysOfWeek.length));
  const schedSrc = document.getElementById("atSchedSrcCalendar").checked ? 'calendar' : 'bulk';
  const payload = {
    id: editingId, name,
    nameIS:   document.getElementById("atNameIS").value.trim(),
    classTag: document.getElementById("atClassTag").value.trim(),
    active:   document.getElementById("atActive").checked,
    volunteer: isVol,
    calendarId: document.getElementById("atCalendarId").value.trim(),
    calendarSyncActive: document.getElementById("atCalendarSyncActive").checked,
    defaultStart: document.getElementById("atDefaultStart").value.trim(),
    defaultEnd:   document.getElementById("atDefaultEnd").value.trim(),
    bulkSchedule: hasSchedule ? JSON.stringify(bs) : null,
    reservedBoatIds: JSON.stringify(window._atReservedBoatIds || []),
    scheduleSource: schedSrc,
    subtypes: JSON.stringify(window._atSubtypes || []),
    roles: isVol ? JSON.stringify(window._atRoles || []) : JSON.stringify([]),
  };
  await saveEntity({
    apiAction: "saveActivityType",
    getArray:  () => actTypes,
    setArray:  arr => { actTypes = arr; },
    payload, modalId: "actTypeModal",
    renderFn:  renderActTypes,
  });
  // Volunteer event materialization is deferred to syncVolunteerEvents.
  // Trigger it in the background after a successful save so new events
  // appear on the Volunteer tab without a manual refresh.
  if (isVol) {
    _volSyncDone = false;
    apiPost('syncVolunteerEvents', {}).then(function(res) {
      if (res && res.added > 0) {
        apiGet('getConfig', { _fresh: true }).then(function(cfg) {
          volunteerEvents = cfg.volunteerEvents || [];
          renderVolunteerEvents();
        }).catch(function() {});
      }
    }).catch(function() {});
  }
}

function refreshClassTagOptions() {
  var dl = document.getElementById('atClassTagOptions');
  if (!dl) return;
  var seen = {};
  var tags = (actTypes || []).map(function(a) { return (a && a.classTag) || ''; })
    .filter(function(t) { if (!t || seen[t]) return false; seen[t] = true; return true; })
    .sort();
  dl.innerHTML = tags.map(function(t) { return '<option value="' + esc(t) + '">'; }).join('');
}

function renderAtDayBtns() {
  var wrap = document.getElementById('atDayBtns');
  if (!wrap) return;
  var bs = window._atBulkSchedule;
  var labels = [
    { v:'1', k:'day.mon' }, { v:'2', k:'day.tue' }, { v:'3', k:'day.wed' },
    { v:'4', k:'day.thu' }, { v:'5', k:'day.fri' }, { v:'6', k:'day.sat' },
    { v:'0', k:'day.sun' },
  ];
  var sel = (bs && Array.isArray(bs.daysOfWeek)) ? bs.daysOfWeek.map(String) : [];
  wrap.innerHTML = labels.map(function(d) {
    var on = sel.indexOf(d.v) !== -1;
    return '<button type="button" class="day-pill' + (on ? ' on' : '') + '"'
      + ' data-admin-click="toggleAtDay" data-admin-arg="' + d.v + '">'
      + '<span data-s="' + d.k + '">' + d.v + '</span></button>';
  }).join('');
  if (window.applyStrings) window.applyStrings(wrap);
}

function renderAtBoatPicker() {
  var wrap = document.getElementById('atBoatPicker');
  if (!wrap) return;
  var sel = new Set((window._atReservedBoatIds || []).map(String));
  var list = (typeof boats !== 'undefined' && Array.isArray(boats)) ? boats : [];
  if (!list.length) {
    wrap.innerHTML = '<div class="text-10 text-muted" data-s="admin.noBoatsConfigured"></div>';
    if (window.applyStrings) window.applyStrings(wrap);
    return;
  }
  // Group chips by category so admins pick from a readable list
  var byCat = {};
  list.forEach(function(bt) {
    if (!bt || bt.active === false) return;
    var cat = bt.category || 'other';
    (byCat[cat] = byCat[cat] || []).push(bt);
  });
  var cats = Object.keys(byCat).sort();
  wrap.innerHTML = cats.map(function(cat) {
    var chips = byCat[cat].map(function(bt) {
      var on = sel.has(String(bt.id));
      return '<button type="button" class="boat-chip' + (on ? ' on' : '') + '"'
        + ' data-admin-click="toggleAtReservedBoat" data-admin-arg="' + esc(bt.id) + '">'
        + esc(bt.name || bt.id) + '</button>';
    }).join('');
    return '<div class="boat-chip-group"><div class="boat-chip-cat">' + esc(cat) + '</div>' + chips + '</div>';
  }).join('');
}

function toggleAtReservedBoat(boatId) {
  if (!window._atReservedBoatIds) window._atReservedBoatIds = [];
  var id = String(boatId);
  var idx = window._atReservedBoatIds.indexOf(id);
  if (idx === -1) window._atReservedBoatIds.push(id);
  else window._atReservedBoatIds.splice(idx, 1);
  renderAtBoatPicker();
}

function toggleAtDay(dayVal) {
  if (!window._atBulkSchedule) {
    window._atBulkSchedule = { fromDate:'', toDate:'', daysOfWeek:[], startTime:'', endTime:'' };
  }
  if (!Array.isArray(window._atBulkSchedule.daysOfWeek)) window._atBulkSchedule.daysOfWeek = [];
  var arr = window._atBulkSchedule.daysOfWeek.map(String);
  var idx = arr.indexOf(String(dayVal));
  if (idx === -1) arr.push(String(dayVal)); else arr.splice(idx, 1);
  window._atBulkSchedule.daysOfWeek = arr;
  renderAtDayBtns();
}

async function deleteActType(id) {
  const _id = id || editingId;
  if (!await ymConfirm(s("admin.confirmDeleteActType"))) return;
  // Count linked volunteer events and signups so we can warn the admin
  // before cascading through real signup data.
  var linkedEventIds = (volunteerEvents || [])
    .filter(function(e) {
      if (!e) return false;
      return (e.sourceActivityTypeId && String(e.sourceActivityTypeId) === String(_id))
          || (e.activityTypeId       && String(e.activityTypeId)       === String(_id));
    })
    .map(function(e) { return e.id; });
  var linkedSignups = (volunteerSignups || [])
    .filter(function(su) { return su && linkedEventIds.indexOf(su.eventId) !== -1; }).length;
  if (linkedSignups > 0) {
    var warn = s("admin.confirmDeleteActTypeCascade")
      .replace("{n}", linkedEventIds.length)
      .replace("{m}", linkedSignups);
    if (!await ymConfirm(warn)) return;
  }
  try {
    const res = await apiPost("deleteActivityType", { id: _id });
    actTypes = actTypes.filter(a => a.id !== _id);
    var removedE = (res && res.removedEvents) || 0;
    var removedS = (res && res.removedSignups) || 0;
    if (removedE > 0) {
      // Drop cascaded events + signups from the in-memory arrays so the
      // volunteer tab reflects the backend state without a full reload.
      var droppedIds = {};
      (volunteerEvents || []).forEach(function(e) {
        if (!e) return;
        var belongs = (e.sourceActivityTypeId && String(e.sourceActivityTypeId) === String(_id))
                   || (e.activityTypeId       && String(e.activityTypeId)       === String(_id));
        if (belongs) droppedIds[e.id] = true;
      });
      volunteerEvents = (volunteerEvents || []).filter(function(e) { return !(e && droppedIds[e.id]); });
      volunteerSignups = (volunteerSignups || []).filter(function(su) { return !(su && droppedIds[su.eventId]); });
      if (typeof renderVolunteerEvents === 'function') {
        try { renderVolunteerEvents(); } catch(e) {}
      }
      toast(
        s("admin.actTypeDeletedCascade")
          .replace("{n}", removedE)
          .replace("{m}", removedS),
        "ok"
      );
    } else {
      toast(s("toast.deleted"), "ok");
    }
    renderActTypes();
    closeModal("actTypeModal", true);
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

function tryParse_(v, fallback) { try { return JSON.parse(v); } catch(e) { return fallback; } }

// ── Activity class: volunteer roles ───────────────────────────────────────────
function renderAtSubtypes() {
  const list = document.getElementById("atSubtypesList");
  if (!list) return;
  if (!window._atSubtypes.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">' + s('admin.noSubtypes') + '</div>';
    return;
  }
  const dayLabels = [
    { v:'1', k:'day.mon', d:'Mon' }, { v:'2', k:'day.tue', d:'Tue' },
    { v:'3', k:'day.wed', d:'Wed' }, { v:'4', k:'day.thu', d:'Thu' },
    { v:'5', k:'day.fri', d:'Fri' }, { v:'6', k:'day.sat', d:'Sat' },
    { v:'0', k:'day.sun', d:'Sun' },
  ];
  list.innerHTML = window._atSubtypes.map((st, i) => {
    const bs = st.bulkSchedule || {};
    const bsDays = Array.isArray(bs.daysOfWeek) ? bs.daysOfWeek.map(String) : [];
    const daysHtml = dayLabels.map(d =>
      `<label style="font-size:11px"><input type="checkbox" value="${d.v}" ${bsDays.indexOf(d.v)!==-1?'checked':''}
        data-admin-toggle-atstbs-day data-admin-idx="${i}" data-admin-dayv="${d.v}"> <span data-s="${d.k}">${d.d}</span></label>`
    ).join('');
    return `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
        <div><label style="font-size:9px;color:var(--muted);letter-spacing:.6px;display:block;margin-bottom:2px">NAME (EN)</label>
          <input type="text" value="${esc(st.name||"")}" style="width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 7px"
            data-admin-set-at-subtype="name" data-admin-idx="${i}"></div>
        <div><label style="font-size:9px;color:var(--muted);letter-spacing:.6px;display:block;margin-bottom:2px">NAME (IS)</label>
          <input type="text" value="${esc(st.nameIS||"")}" style="width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 7px"
            data-admin-set-at-subtype="nameIS" data-admin-idx="${i}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
        <div><label style="font-size:9px;color:var(--muted);letter-spacing:.6px;display:block;margin-bottom:2px">DEFAULT START</label>
          <input type="text" value="${esc(st.defaultStart||"")}" placeholder="HH:MM" maxlength="5" style="width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 7px"
            data-admin-time-format-subtype="defaultStart" data-admin-idx="${i}"></div>
        <div><label style="font-size:9px;color:var(--muted);letter-spacing:.6px;display:block;margin-bottom:2px">DEFAULT END</label>
          <input type="text" value="${esc(st.defaultEnd||"")}" placeholder="HH:MM" maxlength="5" style="width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 7px"
            data-admin-time-format-subtype="defaultEnd" data-admin-idx="${i}"></div>
        <button data-admin-click="_removeAtSubtype" data-admin-arg="${i}" title="Remove" style="background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:0 4px;line-height:1">✕</button>
      </div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)">
        <label style="font-size:9px;color:var(--muted);letter-spacing:.6px;display:block;margin-bottom:4px" data-s="admin.bulkSchedule">BULK SCHEDULE</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
          <div><label style="font-size:9px;color:var(--muted)" data-s="slot.fromDate">From date</label>
            <input type="date" value="${esc(bs.fromDate||'')}" style="width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:11px;padding:5px 7px"
              data-admin-set-at-stbs="fromDate" data-admin-idx="${i}"></div>
          <div><label style="font-size:9px;color:var(--muted)" data-s="slot.toDate">To date</label>
            <input type="date" value="${esc(bs.toDate||'')}" style="width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:11px;padding:5px 7px"
              data-admin-set-at-stbs="toDate" data-admin-idx="${i}"></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${daysHtml}</div>
        ${(st.defaultStart || st.defaultEnd) ? '<div style="font-size:10px;color:var(--muted);margin-top:4px">' + s('admin.bulkUsesDefaultTimes') + ': ' + esc(st.defaultStart || '?') + '–' + esc(st.defaultEnd || '?') + '</div>' : '<div style="font-size:10px;color:var(--muted);margin-top:4px;font-style:italic">' + s('admin.bulkSetDefaultTimes') + '</div>'}
      </div>
    </div>`;
  }).join("");
}

// Keeps the subtype/bulk section visible only when the admin picked the bulk
// schedule source. Under 'calendar', subtypes are still used (for title-based
// matching and volunteer-event templates) but per-subtype bulkSchedule blocks
// become irrelevant — fade the whole section to avoid mixed-authoring confusion.
function updateAtScheduleSource() {
  var isCal = !!document.getElementById("atSchedSrcCalendar") && document.getElementById("atSchedSrcCalendar").checked;
  var section = document.getElementById("atSubtypesSection");
  if (!section) return;
  section.style.opacity = isCal ? '0.45' : '';
  section.title = isCal ? (typeof s === 'function' ? s('admin.scheduleSourceCalendarBulkNote') : '') : '';
}

function ensureAtStBs(i) {
  if (!window._atSubtypes[i].bulkSchedule) {
    window._atSubtypes[i].bulkSchedule = { fromDate:'', toDate:'', daysOfWeek:[], startTime:'', endTime:'' };
  }
  return window._atSubtypes[i].bulkSchedule;
}

function toggleAtStBsDay(i, day, checked) {
  var bs = ensureAtStBs(i);
  if (!Array.isArray(bs.daysOfWeek)) bs.daysOfWeek = [];
  var idx = bs.daysOfWeek.indexOf(day);
  if (checked && idx === -1) bs.daysOfWeek.push(day);
  else if (!checked && idx !== -1) bs.daysOfWeek.splice(idx, 1);
}

function addAtSubtypeRow() {
  if (!window._atSubtypes) window._atSubtypes = [];
  window._atSubtypes.push({ id: "st-"+Date.now(), name: "", nameIS: "", defaultStart: "", defaultEnd: "" });
  renderAtSubtypes();
}

// ── Activity type: volunteer roles ────────────────────────────────────────────

function toggleAtVolunteerSection() {
  var show = document.getElementById("atVolunteer").checked;
  document.getElementById("atRolesSection").classList.toggle("hidden", !show);
}

function renderAtRoles() {
  var list = document.getElementById("atRolesList");
  if (!list) return;
  populateRolePresetPicker("atRolePresetPicker");
  if (!window._atRoles || !window._atRoles.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">' + s('admin.noRoles') + '</div>';
    return;
  }
  var endorsements = (certDefs || []).filter(function(d) { return !!d.clubEndorsement; });
  var inputStyle = 'width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 7px';
  var labelStyle = 'font-size:9px;color:var(--muted);letter-spacing:.6px;display:block;margin-bottom:2px';
  list.innerHTML = window._atRoles.map(function(r, i) {
    var endorseOpts = '<option value="">' + s('admin.roleNoRestriction') + '</option>'
      + endorsements.map(function(e) {
        return '<option value="' + esc(e.id) + '"' + (r.requiredEndorsement === e.id ? ' selected' : '') + '>' + esc(certDefName(e)) + '</option>';
      }).join('');
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">'
      + '<div><label style="' + labelStyle + '">' + s('admin.volRoleName') + '</label>'
      + '<input type="text" value="' + esc(r.name || '') + '" style="' + inputStyle + '" data-admin-set-at-role="name" data-admin-idx="' + i + '"></div>'
      + '<div><label style="' + labelStyle + '">' + s('admin.volRoleNameIS') + '</label>'
      + '<input type="text" value="' + esc(r.nameIS || '') + '" style="' + inputStyle + '" data-admin-set-at-role="nameIS" data-admin-idx="' + i + '"></div>'
      + '<button data-admin-click="_removeAtRole" data-admin-arg="' + i + '" title="Remove" style="background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:0 4px;line-height:1">✕</button>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">'
      + '<div><label style="' + labelStyle + '">' + s('admin.volRoleDescEN') + '</label>'
      + '<textarea rows="2" style="' + inputStyle + ';resize:vertical" data-admin-set-at-role="description" data-admin-idx="' + i + '">' + esc(r.description || '') + '</textarea></div>'
      + '<div><label style="' + labelStyle + '">' + s('admin.volRoleDescIS') + '</label>'
      + '<textarea rows="2" style="' + inputStyle + ';resize:vertical" data-admin-set-at-role="descriptionIS" data-admin-idx="' + i + '">' + esc(r.descriptionIS || '') + '</textarea></div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:80px 1fr;gap:8px;margin-top:6px;align-items:end">'
      + '<div><label style="' + labelStyle + '">' + s('admin.volSlots') + '</label>'
      + '<input type="number" min="1" value="' + (r.slots || '') + '" style="' + inputStyle + '" data-admin-set-at-role="slots" data-admin-idx="' + i + '"></div>'
      + '<div><label style="' + labelStyle + '">' + s('admin.roleEndorsement') + '</label>'
      + '<select style="' + inputStyle + '" data-admin-set-at-role="requiredEndorsement" data-admin-idx="' + i + '">' + endorseOpts + '</select></div>'
      + '</div>'
      + '</div>';
  }).join('');
}

function addAtRoleRow() {
  if (!window._atRoles) window._atRoles = [];
  window._atRoles.push({ id: "r-" + Date.now(), name: "", nameIS: "", description: "", descriptionIS: "", slots: 1, requiredEndorsement: "" });
  renderAtRoles();
}

function addAtRoleFromPreset(presetId) {
  var preset = (typeof getVolunteerRolePreset === 'function') ? getVolunteerRolePreset(presetId) : null;
  if (!preset) return;
  if (!window._atRoles) window._atRoles = [];
  window._atRoles.push({
    id: "r-" + Date.now(),
    name: preset.name || '',
    nameIS: preset.nameIS || '',
    description: preset.description || '',
    descriptionIS: preset.descriptionIS || '',
    slots: preset.slots || 1,
    requiredEndorsement: '',
  });
  renderAtRoles();
}

// Populates a <select> element with a list of standard volunteer role presets.
// First option is a placeholder; the rest come from shared/volunteer-role-presets.js.
// Safe to call repeatedly — idempotent when called with the same language.
function populateRolePresetPicker(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  if (typeof listVolunteerRolePresets !== 'function') return;
  var L = getLang();
  var presets = listVolunteerRolePresets(L);
  var placeholder = '<option value="">' + s('admin.volRolePickPreset') + '</option>';
  sel.innerHTML = placeholder + presets.map(function(p) {
    var label = (L === 'IS' && p.nameIS ? p.nameIS : p.name) || p.name || p.id;
    return '<option value="' + esc(p.id) + '">' + esc(label) + '</option>';
  }).join('');
}

// ══ VOLUNTEER EVENTS ═════════════════════════════════════════════════════════

