// ═══════════════════════════════════════════════════════════════════════════════
// admin/calendars.js — Club + slot calendar admin (charter + member-bookable slots)
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

var _slotWeekStart = null; // Monday of current week
var _slotData = [];        // loaded slots for current view
var _editingSlot = null;   // slot being edited in modal

function loadCharterCalendars(cc) {
  document.getElementById("charterRowingCalId").value = cc.rowingCalendarId || "";
  document.getElementById("charterRowingCalActive").checked = !!cc.rowingCalendarSyncActive;
  document.getElementById("charterKeelboatCalId").value = cc.keelboatCalendarId || "";
  document.getElementById("charterKeelboatCalActive").checked = !!cc.keelboatCalendarSyncActive;
}

async function saveCharterCalendars() {
  const msg = document.getElementById("charterCalSaveMsg");
  msg.textContent = "";
  try {
    await apiPost("saveCharterCalendars", {
      rowingCalendarId: document.getElementById("charterRowingCalId").value.trim(),
      rowingCalendarSyncActive: document.getElementById("charterRowingCalActive").checked,
      keelboatCalendarId: document.getElementById("charterKeelboatCalId").value.trim(),
      keelboatCalendarSyncActive: document.getElementById("charterKeelboatCalActive").checked,
    });
    msg.textContent = s("toast.saved") || "Saved";
    msg.style.color = "var(--green)";
  } catch (e) {
    msg.textContent = (s("toast.error") || "Error") + ": " + e.message;
    msg.style.color = "var(--red)";
  }
}

// ── Club Calendars ────────────────────────────────────────────────────────────
function loadClubCalendars(cals) {
  var list = document.getElementById("clubCalList");
  list.innerHTML = "";
  if (!cals.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--muted);margin:8px 0" data-s="admin.calEmpty"></div>';
    applyStrings(list);
    return;
  }
  cals.forEach(function(c) { addClubCalRow(c.name, c.calendarId); });
}

function addClubCalRow(name, calId) {
  var list = document.getElementById("clubCalList");
  // Remove empty-state message if present
  var empty = list.querySelector("[data-s='admin.calEmpty']");
  if (empty) empty.remove();
  var row = document.createElement("div");
  row.className = "grid2";
  row.style.cssText = "margin-bottom:8px;align-items:end";
  row.innerHTML =
    '<div class="field"><label data-s="admin.calName"></label><input type="text" class="ccName" value="' + esc(name) + '"></div>' +
    '<div style="display:flex;gap:6px;align-items:end"><div class="field" style="flex:1"><label data-s="admin.calId"></label><input type="text" class="ccId" value="' + esc(calId) + '" placeholder="' + (s("admin.calPlaceholder") || "") + '"></div>' +
    '<button class="btn btn-ghost btn-danger" style="margin-bottom:4px;font-size:10px" data-admin-click-el="removeClubCalRow" data-s="admin.calRemove"></button></div>';
  list.appendChild(row);
  applyStrings(row);
}

function removeClubCalRow(btn) {
  btn.closest(".grid2").remove();
}

async function saveClubCalendars() {
  var msg = document.getElementById("clubCalSaveMsg");
  msg.textContent = "";
  var rows = document.querySelectorAll("#clubCalList .grid2");
  var cals = [];
  rows.forEach(function(r) {
    var name = r.querySelector(".ccName").value.trim();
    var calId = r.querySelector(".ccId").value.trim();
    if (name && calId) cals.push({ name: name, calendarId: calId });
  });
  try {
    await apiPost("saveClubCalendars", { calendars: cals });
    msg.textContent = s("toast.saved") || "Saved";
    msg.style.color = "var(--green)";
  } catch (e) {
    msg.textContent = (s("toast.error") || "Error") + ": " + e.message;
    msg.style.color = "var(--red)";
  }
}

function initSlotCalendar() {
  // Set week start to this Monday
  var d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  d.setHours(0,0,0,0);
  _slotWeekStart = d;
  // Populate category filter
  var sel = document.getElementById("slotCatFilter");
  sel.innerHTML = '';
  var cats = (boatCats || []).filter(function(c) {
    return (_allBoats || []).some(function(b) { return b.category === c.key && b.accessMode === 'controlled' && boolVal(b.slotSchedulingEnabled); });
  });
  if (!cats.length) {
    sel.innerHTML = '<option value="">(' + s('slot.noSlotBoats') + ')</option>';
    return;
  }
  cats.forEach(function(c) {
    sel.innerHTML += '<option value="' + esc(c.key) + '">' + esc(c.label || c.key) + '</option>';
  });
  loadSlotCalendar();
}

async function loadSlotCalendar() {
  var cat = document.getElementById("slotCatFilter").value;
  if (!cat) { document.getElementById("slotCalGrid").innerHTML = ''; return; }
  var fromDate = _slotWeekStart.toISOString().slice(0, 10);
  var toD = new Date(_slotWeekStart); toD.setDate(toD.getDate() + 6);
  var toDate = toD.toISOString().slice(0, 10);
  try {
    var res = await apiGet("getSlots", { category: cat, fromDate: fromDate, toDate: toDate });
    _slotData = res.slots || [];
  } catch(e) { _slotData = []; }
  // Populate boat filter
  var boatSel = document.getElementById("slotBoatFilter");
  var catBoats = (_allBoats || []).filter(function(b) { return b.category === cat && boolVal(b.slotSchedulingEnabled); });
  boatSel.innerHTML = '<option value="">' + s('slot.allBoats') + '</option>';
  catBoats.forEach(function(b) { boatSel.innerHTML += '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>'; });
  renderSlotCalendar();
  // Warm adjacent weeks so prev/next navigation hits the cache.
  _adminPrefetchAdjacentSlots(cat);
}

function _adminPrefetchAdjacentSlots(cat) {
  [-7, 7].forEach(function(offset) {
    var ws = new Date(_slotWeekStart); ws.setDate(ws.getDate() + offset);
    var we = new Date(ws); we.setDate(we.getDate() + 6);
    apiGet("getSlots", {
      category: cat,
      fromDate: ws.toISOString().slice(0, 10),
      toDate: we.toISOString().slice(0, 10),
    }).catch(function() {});
  });
}

var _adminCalendars = {};

function _resolveSlotColor(sl) {
  if (!sl || !sl.bookedByKennitala) return null;
  if (sl.bookingColor) return sl.bookingColor;
  if (sl.bookedByCrewId && Array.isArray(window._allCrews)) {
    var crew = window._allCrews.find(function(c) { return c.id === sl.bookedByCrewId; });
    if (crew && crew.color) return crew.color;
  }
  return null;
}

function renderSlotCalendar() {
  var cat = document.getElementById("slotCatFilter").value;
  var boatFilter = document.getElementById("slotBoatFilter").value;
  var catBoats = (_allBoats || []).filter(function(b) {
    return b.category === cat && boolVal(b.slotSchedulingEnabled) && (!boatFilter || b.id === boatFilter);
  });
  var container = document.getElementById("slotCalGrid");
  if (!catBoats.length) {
    container.innerHTML = '<div style="font-size:11px;color:var(--muted)">' + s('slot.noSlotBoats') + '</div>';
    _adminCalendars = {};
    return;
  }
  // Update week label
  var d0 = new Date(_slotWeekStart);
  var d6 = new Date(_slotWeekStart); d6.setDate(d6.getDate() + 6);
  document.getElementById("slotWeekLabel").textContent = fmtWeekRange(d0.toISOString(), d6.toISOString());

  // One SlotCalendar per boat (to match captain/rowing calendar styling)
  container.innerHTML = '';
  var newCals = {};
  catBoats.forEach(function(boat) {
    var boatSlots = _slotData.filter(function(sl) { return sl.boatId === boat.id; });
    // Enrich with crew name so the calendar identifies bookings by crew.
    if (Array.isArray(window._allCrews)) {
      boatSlots.forEach(function(sl) {
        if (sl.bookedByCrewId && !sl.bookedByCrewName) {
          var crew = window._allCrews.find(function(c) { return c.id === sl.bookedByCrewId; });
          if (crew) sl.bookedByCrewName = crew.name;
        }
      });
    }
    var wrap = document.createElement('div');
    wrap.style.marginBottom = '16px';
    var hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:11px;font-weight:500;letter-spacing:.5px;margin-bottom:6px;color:var(--text)';
    hdr.textContent = boat.name;
    wrap.appendChild(hdr);
    var gridEl = document.createElement('div');
    wrap.appendChild(gridEl);
    container.appendChild(wrap);

    var cal = new SlotCalendar(gridEl, {
      isMine: function() { return false; },
      onBook: function(slotId) { openSlotModal(slotId); },
      onUnbook: function(slotId) { openSlotModal(slotId); },
      getSlotColor: _resolveSlotColor,
    });
    cal.setWeekStart(_slotWeekStart);
    cal.setSlots(boatSlots);
    newCals[boat.id] = cal;
  });
  _adminCalendars = newCals;
}

function shiftSlotWeek(dir) {
  _slotWeekStart.setDate(_slotWeekStart.getDate() + dir * 7);
  loadSlotCalendar();
}

function slotWeekToday() {
  var d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0,0,0,0);
  _slotWeekStart = d;
  loadSlotCalendar();
}

// Open slot modal for a cell (create new)
function openSlotCell(boatId, date) {
  _editingSlot = null;
  var boat = (_allBoats || []).find(function(b) { return b.id === boatId; });
  document.getElementById("slotModalTitle").textContent = s('slot.newTitle');
  document.getElementById("slotModalBoatName").textContent = boat ? boat.name : boatId;
  document.getElementById("smDate").value = date;
  document.getElementById("smStartTime").value = '18:00';
  document.getElementById("smEndTime").value = '21:00';
  document.getElementById("smNote").value = '';
  document.getElementById("smDeleteBtn").classList.add("hidden");
  document.getElementById("slotBookedInfo").classList.add("hidden");
  _editingSlot = { boatId: boatId };
  applyStrings(document.getElementById("slotModal"));
  openModal("slotModal");
}

// Open slot modal for existing slot (edit)
function openSlotModal(slotId) {
  var sl = _slotData.find(function(s) { return s.id === slotId; });
  if (!sl) return;
  var boat = (_allBoats || []).find(function(b) { return b.id === sl.boatId; });
  var title = document.getElementById("slotModalTitle");
  title.setAttribute('data-s', 'slot.editTitle');
  title.textContent = s('slot.editTitle');
  document.getElementById("slotModalBoatName").textContent = boat ? boat.name : sl.boatId;
  document.getElementById("smDate").value = sl.date;
  document.getElementById("smStartTime").value = sl.startTime;
  document.getElementById("smEndTime").value = sl.endTime;
  document.getElementById("smNote").value = sl.note || '';
  document.getElementById("smDeleteBtn").classList.remove("hidden");
  if (sl.bookedByKennitala) {
    document.getElementById("slotBookedInfo").classList.remove("hidden");
    document.getElementById("slotBookedInfo").textContent = s('slot.bookedBy') + ': ' + (sl.bookedByName || sl.bookedByKennitala);
  } else {
    document.getElementById("slotBookedInfo").classList.add("hidden");
  }
  _editingSlot = { boatId: sl.boatId, slotId: sl.id };
  applyStrings(document.getElementById("slotModal"));
  openModal("slotModal");
}

async function saveCurrentSlot() {
  if (!_editingSlot) return;
  var date = document.getElementById("smDate").value;
  var startTime = document.getElementById("smStartTime").value;
  var endTime = document.getElementById("smEndTime").value;
  if (!date || !startTime || !endTime) { toast(s('slot.missingFields'), 'err'); return; }
  try {
    await apiPost("saveSlot", {
      boatId: _editingSlot.boatId,
      slotId: _editingSlot.slotId || '',
      date: date, startTime: startTime, endTime: endTime,
      note: document.getElementById("smNote").value || '',
    });
    closeModal("slotModal", true);
    toast(s('toast.saved'));
    loadSlotCalendar();
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

async function deleteCurrentSlot() {
  if (!_editingSlot || !_editingSlot.slotId) return;
  if (!(await ymConfirm(s('slot.confirmDelete')))) return;
  try {
    await apiPost("deleteSlot", { slotId: _editingSlot.slotId });
    closeModal("slotModal", true);
    toast(s('toast.deleted'));
    loadSlotCalendar();
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

// Open slot modal for NEW slot creation (requires a specific boat selected in filter)
function openNewSlotModal() {
  var boatId = document.getElementById("slotBoatFilter").value;
  if (!boatId) { toast(s('slot.selectBoatFirst'), 'err'); return; }
  var boat = (_allBoats || []).find(function(b) { return b.id === boatId; });
  if (!boat) return;
  var title = document.getElementById("slotModalTitle");
  title.setAttribute('data-s', 'slot.newTitle');
  title.textContent = s('slot.newTitle');
  document.getElementById("slotModalBoatName").textContent = boat.name;
  document.getElementById("smDate").value = new Date().toISOString().slice(0, 10);
  document.getElementById("smStartTime").value = '18:00';
  document.getElementById("smEndTime").value = '21:00';
  document.getElementById("smNote").value = '';
  document.getElementById("smDeleteBtn").classList.add("hidden");
  document.getElementById("slotBookedInfo").classList.add("hidden");
  _editingSlot = { boatId: boatId, slotId: '' };
  applyStrings(document.getElementById("slotModal"));
  openModal("slotModal");
}

// Recurring slot creation
function openRecurringSlotModal() {
  var cat = document.getElementById("slotCatFilter").value;
  var catBoats = (_allBoats || []).filter(function(b) { return b.category === cat && boolVal(b.slotSchedulingEnabled); });
  var sel = document.getElementById("rsBoat");
  sel.innerHTML = '';
  catBoats.forEach(function(b) { sel.innerHTML += '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>'; });
  // Reset checkboxes
  document.querySelectorAll('#rsDays input').forEach(function(cb) { cb.checked = false; });
  document.getElementById("rsStartTime").value = '18:00';
  document.getElementById("rsEndTime").value = '21:00';
  var today = new Date().toISOString().slice(0, 10);
  document.getElementById("rsFromDate").value = today;
  var endD = new Date(); endD.setMonth(endD.getMonth() + 3);
  document.getElementById("rsToDate").value = endD.toISOString().slice(0, 10);
  document.getElementById("rsNote").value = '';
  document.getElementById("rsPreview").textContent = '';
  applyStrings(document.getElementById("recurSlotModal"));
  openModal("recurSlotModal");
}

function previewRecurringSlots() {
  var days = [];
  document.querySelectorAll('#rsDays input:checked').forEach(function(cb) { days.push(parseInt(cb.value)); });
  var from = document.getElementById("rsFromDate").value;
  var to = document.getElementById("rsToDate").value;
  if (!days.length || !from || !to) { document.getElementById("rsPreview").textContent = s('slot.selectDays'); return; }
  var count = 0;
  var d = new Date(from + 'T00:00:00');
  var end = new Date(to + 'T00:00:00');
  while (d <= end) {
    if (days.indexOf(d.getDay()) !== -1) count++;
    d.setDate(d.getDate() + 1);
  }
  document.getElementById("rsPreview").textContent = s('slot.previewCount', { count: count });
}

async function saveRecurringSlots() {
  var boatId = document.getElementById("rsBoat").value;
  var days = [];
  document.querySelectorAll('#rsDays input:checked').forEach(function(cb) { days.push(parseInt(cb.value)); });
  var startTime = document.getElementById("rsStartTime").value;
  var endTime = document.getElementById("rsEndTime").value;
  var fromDate = document.getElementById("rsFromDate").value;
  var toDate = document.getElementById("rsToDate").value;
  if (!boatId || !days.length || !startTime || !endTime || !fromDate || !toDate) {
    toast(s('slot.missingFields'), 'err'); return;
  }
  try {
    var res = await apiPost("saveRecurringSlots", {
      boatId: boatId, daysOfWeek: days,
      startTime: startTime, endTime: endTime,
      fromDate: fromDate, toDate: toDate,
      note: document.getElementById("rsNote").value || '',
    });
    closeModal("recurSlotModal", true);
    toast(s('slot.created', { count: res.count || 0 }));
    loadSlotCalendar();
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}

