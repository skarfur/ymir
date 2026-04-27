// ═══════════════════════════════════════════════════════════════════════════════
// admin/volunteers.js — Volunteer events tab (signups, roles, leader picker)
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

let _veEditingId = null;

let _volSyncDone = false;
let _volShowPast = false;

// Kick the background materialization of bulk-scheduled volunteer events
// without rendering anything. Called from renderSchedulingTab so the
// timeline can pick up newly-persisted rows on the next refresh. Idempotent.
function syncVolunteerEventsBackground() {
  if (_volSyncDone) return;
  _volSyncDone = true;
  (async function () {
    try {
      const res = await apiPost('syncVolunteerEvents', {});
      if (res && res.added > 0) {
        try {
          const cfg = await apiGet('getConfig');
          volunteerEvents = cfg.volunteerEvents || [];
          if (typeof renderUpcomingEvents === 'function') renderUpcomingEvents();
        } catch (e) {}
      }
    } catch (e) { /* non-fatal */ }
  })();
}

function renderVolunteerEvents() {
  const card = document.getElementById("volEventsCard");
  // The standalone Volunteer events col-section has been folded into the
  // unified Upcoming events timeline. If the card is gone, fall back to
  // refreshing the timeline so callers that re-render after a save still
  // see updated state.
  if (!card) {
    if (typeof renderUpcomingEvents === 'function') {
      try { renderUpcomingEvents(); } catch (e) {}
    }
    return;
  }
  syncVolunteerEventsBackground();
  const L = getLang();
  const today = new Date().toISOString().slice(0, 10);
  // Defense-in-depth: hide materialized events whose source activity type is
  // missing, inactive, or no longer volunteer-flagged. Manually-created events
  // (no sourceActivityTypeId) are shown regardless.
  const activeAtIds = new Set((actTypes || [])
    .filter(a => bool(a.active) && bool(a.volunteer))
    .map(a => a.id));
  const saved = (volunteerEvents || []).filter(e => {
    if (!e || e.active === false) return false;
    if (e.sourceActivityTypeId) return activeAtIds.has(e.sourceActivityTypeId);
    return true;
  });
  // Expand virtual events from activity type bulk schedules so they appear
  // immediately after saving, before the background sync materializes them.
  // Use 365-day horizon to match the volunteer page.
  const rangeTo = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const virtual = (typeof expandVolunteerActivityTypes === 'function')
    ? expandVolunteerActivityTypes(actTypes || [], today, rangeTo)
    : [];
  const all = (typeof mergeVolunteerEvents === 'function')
    ? mergeVolunteerEvents(saved, virtual)
    : saved.concat(virtual);
  // Store merged events so openVolEventModal can find virtual events too.
  window._volMergedEvents = all;
  const sorted = all.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')
    || (a.startTime || '').localeCompare(b.startTime || ''));
  const upcoming = sorted.filter(e => (e.date || '') >= today);
  const past     = sorted.filter(e => (e.date || '') <  today);
  const shown    = _volShowPast ? sorted : upcoming;
  if (!shown.length) {
    card.innerHTML = '<div class="empty-state">' + s('admin.noVolEvents') + '</div>'
      + (past.length ? _volPastToggleHtml(past.length) : '');
    return;
  }
  const rowsHtml = shown.map(ev => _volRowHtml(ev, L)).join('');
  card.innerHTML = rowsHtml + (past.length ? _volPastToggleHtml(past.length) : '');
}

function _volPastToggleHtml(count) {
  const lbl = _volShowPast
    ? s('admin.volHidePast')
    : s('admin.volShowPast').replace('{n}', count);
  return '<div style="text-align:center;padding:10px 0 2px">'
    + '<button class="btn btn-secondary btn-sm" data-admin-click="_volTogglePast">' + esc(lbl) + '</button>'
    + '</div>';
}

function _volTogglePast() {
  _volShowPast = !_volShowPast;
  renderVolunteerEvents();
}

// Localized "Wed, 15 Apr" / "Wed 15 Apr – Fri 17 Apr" for a volunteer event.
function _volFormatDayLabel(ev) {
  const startIso = ev && ev.date ? ev.date : '';
  if (!startIso) return '';
  const endIso = (ev && ev.endDate && ev.endDate !== startIso) ? ev.endDate : '';
  const dows = ['day.sun','day.mon','day.tue','day.wed','day.thu','day.fri','day.sat'];
  const months = ['month.jan','month.feb','month.mar','month.apr','month.may','month.jun',
                  'month.jul','month.aug','month.sep','month.oct','month.nov','month.dec'];
  const a = new Date(startIso + 'T00:00:00');
  const left = s(dows[a.getDay()]) + ', ' + a.getDate() + ' ' + s(months[a.getMonth()]);
  if (!endIso) return left;
  const b = new Date(endIso + 'T00:00:00');
  const right = s(dows[b.getDay()]) + ' ' + b.getDate() + ' ' + s(months[b.getMonth()]);
  return left + ' – ' + right;
}

function _volFormatTimeRange(ev) {
  const a = (ev && ev.startTime || '').slice(0, 5);
  const b = (ev && ev.endTime   || '').slice(0, 5);
  if (a && b) return a + '–' + b;
  if (a) return a;
  return '';
}

// Admin volunteer row — reuses the shared /volunteer/ card renderer so the
// two views stay visually identical. Adds an Edit button that opens the
// full volunteer-event modal and a Delete button for destructive removal.
function _volRowHtml(ev, L) {
  if (typeof renderVolunteerCard !== 'function') return '';
  return renderVolunteerCard(ev, {
    mode: 'admin',
    lang: L || getLang(),
    signups: volunteerSignups,
    members: members,
    certDefs: certDefs,
    certDefName: (typeof certDefName === 'function') ? certDefName : function(d) { return d && (d.name || d.id) || ''; },
    esc: esc,
    s: s,
    formatDay: _volFormatDayLabel,
    formatTime: _volFormatTimeRange,
    onCardClick:   "openVolEventModal",
    onEditClick:   "openVolEventModal",
    onDeleteClick: "deleteVolEvent",
  });
}

function openVolEventModal(id) {
  _veEditingId = id || null;
  // Search saved events first, then the merged list (which includes virtual events).
  const ev = id
    ? (volunteerEvents.find(x => x.id === id) || (window._volMergedEvents || []).find(x => x.id === id))
    : null;
  document.getElementById("volEventModalTitle").textContent = ev ? s('admin.volEventModal.edit') : s('admin.volEventModal.add');
  document.getElementById("veTitle").value = ev ? (ev.title || '') : '';
  document.getElementById("veTitleIS").value = ev ? (ev.titleIS || '') : '';
  document.getElementById("veDate").value = ev ? (ev.date || '') : '';
  document.getElementById("veEndDate").value = ev ? (ev.endDate || '') : '';
  document.getElementById("veStartTime").value = ev ? (ev.startTime || '') : '';
  document.getElementById("veEndTime").value = ev ? (ev.endTime || '') : '';
  // Leader member lookup
  document.getElementById("veLeaderMemberId").value = ev ? (ev.leaderMemberId || '') : '';
  document.getElementById("veLeaderPhone").value = ev ? (ev.leaderPhone || '') : '';
  document.getElementById("veShowPhone").checked = ev ? (ev.showLeaderPhone === true || ev.showLeaderPhone === 'true') : false;
  // Show leader chip or search
  var leaderM = ev && ev.leaderMemberId ? members.find(function(m){ return m.id === ev.leaderMemberId || m.kennitala === ev.leaderMemberId; }) : null;
  if (!leaderM && ev && ev.leaderName) {
    leaderM = members.find(function(m){ return (m.name||'') === ev.leaderName; });
  }
  if (leaderM) {
    showVolLeaderChip(leaderM);
  } else {
    clearVolLeaderChip();
    document.getElementById("veLeaderSearch").value = ev ? (ev.leaderName || '') : '';
  }
  document.getElementById("veNotes").value = ev ? (ev.notes || '') : '';
  document.getElementById("veNotesIS").value = ev ? (ev.notesIS || '') : '';
  document.getElementById("veDeleteBtn").classList.toggle("hidden", !ev);
  // Populate activity type select (only volunteer-flagged types)
  const sel = document.getElementById("veActType");
  const L = getLang();
  sel.innerHTML = '<option value="">' + s('admin.volActTypeNone') + '</option>'
    + actTypes.filter(a => bool(a.volunteer) && bool(a.active)).map(a => {
      const label = (L === 'IS' && a.nameIS ? a.nameIS : a.name) || a.name;
      return '<option value="' + a.id + '"' + (ev && ev.activityTypeId === a.id ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  // Roles — inherit from activity type for new events, use saved roles for existing
  if (ev && ev.roles && (Array.isArray(ev.roles) ? ev.roles.length : true)) {
    window._volRoles = JSON.parse(JSON.stringify(Array.isArray(ev.roles) ? ev.roles : []));
  } else {
    window._volRoles = loadRolesFromActType(sel.value);
  }
  renderVolRoles();
  openModal("volEventModal");
}

async function saveVolEvent() {
  const title = document.getElementById("veTitle").value.trim();
  if (!title) { toast(s("admin.nameRequired"), "err"); return; }
  var memberId = document.getElementById("veLeaderMemberId").value.trim();
  var leaderM = memberId ? members.find(function(m){ return m.id === memberId || m.kennitala === memberId; }) : null;
  const payload = {
    id: _veEditingId,
    title,
    titleIS: document.getElementById("veTitleIS").value.trim(),
    activityTypeId: document.getElementById("veActType").value,
    date: document.getElementById("veDate").value,
    endDate: document.getElementById("veEndDate").value,
    startTime: document.getElementById("veStartTime").value,
    endTime: document.getElementById("veEndTime").value,
    leaderMemberId: memberId,
    leaderName: leaderM ? leaderM.name : document.getElementById("veLeaderSearch").value.trim(),
    leaderPhone: document.getElementById("veLeaderPhone").value.trim(),
    showLeaderPhone: document.getElementById("veShowPhone").checked,
    notes: document.getElementById("veNotes").value.trim(),
    notesIS: document.getElementById("veNotesIS").value.trim(),
    roles: JSON.stringify(window._volRoles || []),
    active: true,
  };
  await saveEntity({
    apiAction: "saveVolunteerEvent",
    getArray:  () => volunteerEvents,
    setArray:  arr => { volunteerEvents = arr; },
    payload, modalId: "volEventModal",
    renderFn:  renderVolunteerEvents,
  });
}

async function deleteVolEvent(id) {
  const _id = id || _veEditingId;
  if (!await ymConfirm(s("admin.confirmDeleteVolEvent"))) return;
  try {
    await apiPost("deleteVolunteerEvent", { id: _id });
    volunteerEvents = volunteerEvents.filter(a => a.id !== _id);
    renderVolunteerEvents();
    // Inline delete from the Scheduling timeline triggers this without the
    // edit modal being open. closeModal is a no-op when the modal is hidden,
    // and renderUpcomingEvents needs to re-run so the deleted row drops
    // out of the timeline immediately.
    closeModal("volEventModal", true);
    if (typeof renderUpcomingEvents === 'function') {
      try { renderUpcomingEvents(); } catch (e) {}
    }
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

function renderVolRoles() {
  const list = document.getElementById("volRolesList");
  if (!list) return;
  populateRolePresetPicker("veRolePresetPicker");
  if (!window._volRoles || !window._volRoles.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">' + s('admin.noRoles') + '</div>';
    return;
  }
  var inputStyle = 'width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 7px';
  var labelStyle = 'font-size:9px;color:var(--muted);letter-spacing:.6px;display:block;margin-bottom:2px';
  list.innerHTML = window._volRoles.map(function(r, i) {
    var endorseLabel = '';
    if (r.requiredEndorsement) {
      var eDef = (certDefs || []).find(function(d){ return d.id === r.requiredEndorsement; });
      endorseLabel = '<div style="font-size:10px;color:var(--accent-fg);margin-top:4px">' + s('admin.roleEndorsement') + ': ' + esc(eDef ? certDefName(eDef) : r.requiredEndorsement) + '</div>';
    }
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">'
      + '<div><label style="' + labelStyle + '">' + s('admin.volRoleName') + '</label>'
      + '<input type="text" value="' + esc(r.name || '') + '" style="' + inputStyle + '" data-admin-set-vol-role="name" data-admin-idx="' + i + '"></div>'
      + '<div><label style="' + labelStyle + '">' + s('admin.volRoleNameIS') + '</label>'
      + '<input type="text" value="' + esc(r.nameIS || '') + '" style="' + inputStyle + '" data-admin-set-vol-role="nameIS" data-admin-idx="' + i + '"></div>'
      + '<button data-admin-click="_removeVolRole" data-admin-arg="' + i + '" title="Remove" style="background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:0 4px;line-height:1">✕</button>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">'
      + '<div><label style="' + labelStyle + '">' + s('admin.volRoleDescEN') + '</label>'
      + '<textarea rows="2" style="' + inputStyle + ';resize:vertical" data-admin-set-vol-role="description" data-admin-idx="' + i + '">' + esc(r.description || '') + '</textarea></div>'
      + '<div><label style="' + labelStyle + '">' + s('admin.volRoleDescIS') + '</label>'
      + '<textarea rows="2" style="' + inputStyle + ';resize:vertical" data-admin-set-vol-role="descriptionIS" data-admin-idx="' + i + '">' + esc(r.descriptionIS || '') + '</textarea></div>'
      + '</div>'
      + '<div style="margin-top:6px"><label style="' + labelStyle + '">' + s('admin.volSlots') + '</label>'
      + '<input type="number" min="1" value="' + (r.slots || '') + '" style="width:80px;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:inherit;font-size:11px;padding:5px 7px" data-admin-set-vol-role="slots" data-admin-idx="' + i + '"></div>'
      + endorseLabel
      + '</div>';
  }).join('');
}

function addVolRoleRow() {
  if (!window._volRoles) window._volRoles = [];
  window._volRoles.push({ id: "r-" + Date.now(), name: "", nameIS: "", description: "", descriptionIS: "", slots: 1, requiredEndorsement: "" });
  renderVolRoles();
}

function addVolRoleFromPreset(presetId) {
  var preset = (typeof getVolunteerRolePreset === 'function') ? getVolunteerRolePreset(presetId) : null;
  if (!preset) return;
  if (!window._volRoles) window._volRoles = [];
  window._volRoles.push({
    id: "r-" + Date.now(),
    name: preset.name || '',
    nameIS: preset.nameIS || '',
    description: preset.description || '',
    descriptionIS: preset.descriptionIS || '',
    slots: preset.slots || 1,
    requiredEndorsement: '',
  });
  renderVolRoles();
}

// ── Volunteer event: leader member autocomplete ──────────────────────────────

function searchVolLeader(q) {
  var drop = document.getElementById("veLeaderSuggestions");
  if (!q || q.length < 2) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
  var ql = q.toLowerCase();
  var hits = members.filter(function(m) { return bool(m.active) && (m.name || '').toLowerCase().includes(ql); }).slice(0, 8);
  if (!hits.length) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
  drop.innerHTML = hits.map(function(m) {
    return '<div class="suggest-item" style="padding:6px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)"'
      + ' data-admin-click="selectVolLeader" data-admin-arg="'+esc(m.id || m.kennitala)+'">' + esc(memberDisplayName(m, members))
      + (m.phone ? '<span style="color:var(--muted);margin-left:8px;font-size:10px">' + esc(m.phone) + '</span>' : '') + '</div>';
  }).join('');
  drop.style.display = 'block';
}

function selectVolLeader(id) {
  var m = members.find(function(x) { return x.id === id || x.kennitala === id; });
  if (!m) return;
  document.getElementById("veLeaderMemberId").value = m.id || m.kennitala;
  document.getElementById("veLeaderPhone").value = m.phone || '';
  document.getElementById("veLeaderSuggestions").innerHTML = '';
  document.getElementById("veLeaderSuggestions").style.display = 'none';
  showVolLeaderChip(m);
}

function showVolLeaderChip(m) {
  var chip = document.getElementById("veLeaderChip");
  var search = document.getElementById("veLeaderSearch");
  chip.innerHTML = '<span style="font-size:11px;padding:4px 10px;border-radius:12px;background:var(--surface);border:1px solid var(--border);color:var(--text);display:inline-flex;align-items:center;gap:6px">'
    + esc(memberDisplayName(m, members))
    + '<span style="cursor:pointer;color:var(--red);font-size:13px" data-admin-click="clearVolLeaderChip">&times;</span></span>';
  chip.style.display = 'block';
  search.style.display = 'none';
}

function clearVolLeaderChip() {
  document.getElementById("veLeaderChip").style.display = 'none';
  document.getElementById("veLeaderChip").innerHTML = '';
  document.getElementById("veLeaderMemberId").value = '';
  document.getElementById("veLeaderPhone").value = '';
  var search = document.getElementById("veLeaderSearch");
  search.value = '';
  search.style.display = '';
}

// ── Volunteer event: inherit roles from activity type ────────────────────────

function loadRolesFromActType(atId) {
  if (!atId) return [];
  var at = actTypes.find(function(a) { return a.id === atId; });
  if (!at || !at.roles) return [];
  var roles = Array.isArray(at.roles) ? at.roles : tryParse_(at.roles, []);
  return roles.map(function(r) {
    return {
      id: "r-" + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      name: r.name || '',
      nameIS: r.nameIS || '',
      description: r.description || '',
      descriptionIS: r.descriptionIS || '',
      slots: r.slots || 1,
      requiredEndorsement: r.requiredEndorsement || '',
    };
  });
}

function onVeActTypeChange() {
  var atId = document.getElementById("veActType").value;
  var newRoles = loadRolesFromActType(atId);
  if (newRoles.length) {
    window._volRoles = newRoles;
    renderVolRoles();
  }
  // Inherit leader from the picked type only when the leader fields are still
  // empty — preserves any in-progress per-instance override the admin typed.
  var at = atId ? actTypes.find(function (a) { return a.id === atId; }) : null;
  if (!at) return;
  var leaderIdEl = document.getElementById("veLeaderMemberId");
  var leaderSearchEl = document.getElementById("veLeaderSearch");
  var leaderPhoneEl = document.getElementById("veLeaderPhone");
  var showPhoneEl = document.getElementById("veShowPhone");
  if (!leaderIdEl.value && !(leaderSearchEl.value || '').trim()) {
    leaderPhoneEl.value = at.leaderPhone || '';
    showPhoneEl.checked = !!(at.showLeaderPhone === true || at.showLeaderPhone === 'true');
    if (at.leaderMemberId) {
      var leaderM = members.find(function (m) { return m.id === at.leaderMemberId || m.kennitala === at.leaderMemberId; });
      if (leaderM) { showVolLeaderChip(leaderM); leaderIdEl.value = leaderM.id || leaderM.kennitala; return; }
    }
    if (at.leaderName) leaderSearchEl.value = at.leaderName;
  }
}

// ══ CERTIFICATIONS ════════════════════════════════════════════════════════════
// Top-level cert def has `expires` (bool) and `expiryDate` (absolute date).
// Subcats supercede the parent: the most specific expiry shown/used is the subcat's.

