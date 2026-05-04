prefetch({Config:['getConfig'],Members:['getMembers']});

// ── Auth ───────────────────────────────────────────────────────────────────────
const user = requireAuth(isAdmin);

let members = [], boats = [], locations = [], clItems = [], actTypes = [], volunteerEvents = [];
let volunteerSignups = [];
let cancelledActivityOccurrences = [];
let _allBoats = [], _allLocations = [];
let editingId = null, importResult = null;
let certCategories = [];
const bool = v => v === true || v === 'true' || v === 1 || v === '1' || v === 'TRUE';

// ── Default boat categories (seeded if none in config) ────────────────────────
// Colors mirror BOAT_CAT_COLORS in shared/boats.js so fresh installs match the
// historical palette. Admin can override per-category via the category modal.
const DEFAULT_BOAT_CATS = [
  { key:'dinghy',        labelEN:'Dinghy',        labelIS:'Skíðbátur',    emoji:'⛵', color:'#5b9bd5', active:true },
  { key:'keelboat',      labelEN:'Keelboat',      labelIS:'Kjölbátur',    emoji:'⛵', color:'#d4af37', active:true },
  { key:'kayak',         labelEN:'Kayak',         labelIS:'Kajak',        emoji:'🛶', color:'#9b59b6', active:true },
  { key:'rowing-shell',  labelEN:'Rowing Shell',  labelIS:'Róðrarbátur',  emoji:'🚣', color:'#3498db', active:true },
  { key:'rowboat',       labelEN:'Rowboat',       labelIS:'Árabátur',     emoji:'🚣', color:'#1abc9c', active:true },
  { key:'sup',           labelEN:'SUP',           labelIS:'SUP',          emoji:'🏄', color:'#e67e22', active:true },
  { key:'wingfoil',      labelEN:'Wingfoil',      labelIS:'Wingfoil',     emoji:'🪁', color:'#e74c3c', active:true },
  { key:'other',         labelEN:'Other',         labelIS:'Annað',        emoji:'🚤', color:'#6b92b8', active:true },
];
let _allBoatCats = [];   // full list including inactive
let boatCats     = [];   // active only
let _bcEditingId = null;

// ── Init ───────────────────────────────────────────────────────────────────────
window.addEventListener('message', e => {
  if (e.data && e.data.type === 'payroll-resize') {
    const frame = document.getElementById('payrollFrame');
    if (frame) frame.style.height = e.data.height + 'px';
  }
});

document.addEventListener("DOMContentLoaded", () => {
  buildHeader('admin');
  injectBoatModalHtml();
  injectRecurringSlotModal({ showBoat: true, showNote: true,
    previewFn: 'previewRecurringSlots', saveFn: 'saveRecurringSlots', saveKey: 'slot.create' });
  injectSingleSlotModal({ showBoatName: true, showNote: true, showBookedInfo: true,
    saveFn: 'saveCurrentSlot', deleteFn: 'deleteCurrentSlot' });
  applyStrings();
  _adminWireStrings();
  // Enable unsaved-changes guard on all editable admin modals. The guard
  // snapshots input state when a modal opens and confirms before closing
  // if any field changed (bypassed when closeModal is called with force=true).
  [
    'memberModal', 'boatCatModal', 'boatModal', 'locationModal',
    'clModal', 'launchCLModal', 'actTypeModal', 'volEventModal',
    'certCatModal', 'certDefModal', 'recurSlotModal', 'slotModal',
    'passportSettingsModal', 'passportItemModal', 'passportCategoryModal',
    'memberCertModal',
    'hbInfoModal', 'hbRoleModal', 'hbDocModal', 'hbContactModal',
  ].forEach(id => { if (typeof guardUnsavedChanges === 'function') guardUnsavedChanges(id); });
  loadAll().then(() => {
    const p = new URLSearchParams(window.location.search);
    const top = p.get('top') || 'members';
    showTopTab(top);
    if (top === 'settings') showTab(p.get('tab') || 'boats');
  });

  document.getElementById("bOOS").addEventListener("change", e => {
    document.getElementById("oosReasonField").classList.toggle("hidden", !e.target.checked);
  });

  // Auto-generate key from EN label in category modal
  document.getElementById("bcLabelEN").addEventListener("input", e => {
    if (!_bcEditingId) {
      document.getElementById("bcKey").value = e.target.value.toLowerCase().trim().replace(/\s+/g, '-');
    }
    if (typeof updateBoatCatColorPreview === 'function') updateBoatCatColorPreview();
  });

  warmContainer();
});

async function loadAll() {
  const statusEl = document.getElementById("membersCard");
  let cfgRes = {};
  try {
    if (statusEl) statusEl.innerHTML = '<div class="spinner"></div>';
    const [mRes, cfgRes_] = await Promise.all([
      window._earlyMembers || apiGet("getMembers"),
      window._earlyConfig || apiGet("getConfig"),
    ]);
    members  = mRes.members || [];
    cfgRes   = cfgRes_;
  } catch(e) {
    console.error("loadAll failed:", e);
    if (statusEl) statusEl.innerHTML = `<div class="empty-state">${s('admin.loadFailed')}: ${e.message}</div>`;
    return;
  }

  // Load volunteer signups in the background so the volunteer tab can show
  // who signed up for each role (with phone if the member opted in).
  apiPost('getVolunteerSignups', {}).then(res => {
    volunteerSignups = (res && res.signups) || [];
    renderVolunteerEvents();
    // Refresh the upcoming-events card so signup counts show up after load.
    if (typeof renderUpcomingEvents === 'function') {
      try { renderUpcomingEvents(); } catch (e) {}
    }
  }).catch(e => { console.warn('getVolunteerSignups failed:', e.message); });

  // ── Assign data ───────────────────────────────────────────────────────────
  actTypes        = cfgRes.activityTemplates || cfgRes.activityTypes || [];
  volunteerEvents = cfgRes.volunteerEvents || [];
  cancelledActivityOccurrences = cfgRes.cancelledActivityOccurrences || [];
  clItems        = [ ...(cfgRes.dailyChecklist?.opening || []),
                     ...(cfgRes.dailyChecklist?.closing  || []) ];
  certDefs       = certDefsFromConfig(cfgRes.certDefs || []);
  certCategories = certCategoriesFromConfig(cfgRes.certCategories || []);
  _allBoats      = cfgRes.boats      || [];
  _allLocations  = cfgRes.locations  || [];
  _allBoatCats   = cfgRes.boatCategories?.length ? cfgRes.boatCategories : JSON.parse(JSON.stringify(DEFAULT_BOAT_CATS));
  boats          = _allBoats    .filter(b => b.active !== false && b.active !== 'false');
  locations      = _allLocations.filter(l => l.active !== false && l.active !== 'false');
  boatCats       = _allBoatCats .filter(c => c.active !== false && c.active !== 'false');
  registerBoatCats(boatCats);

  // Load club calendars first — the charter-sync selects + activity-type
  // modal calendar picker source their options from this registry.
  try { loadClubCalendars(cfgRes.clubCalendars || []); } catch(e) { console.warn("loadClubCalendars:", e.message); }
  try { loadCharterCalendars(cfgRes.charterCalendars || {}); } catch(e) { console.warn("loadCharterCalendars:", e.message); }
  try { loadAlertConfig(cfgRes.overdueAlerts); }   catch(e) { console.warn("loadAlertConfig:", e.message); }
  try { loadLaunchChecklists(cfgRes.launchChecklists || {}); } catch(e) { console.warn("loadLaunchChecklists:", e.message); }
  try { loadFlagConfigPanel(cfgRes.flagConfig); }  catch(e) { console.warn("loadFlagConfigPanel:", e.message); }

  renderMembers(); renderBoats(); renderLocations();
  renderChecklists(); renderActTypes(); renderVolunteerEvents();
  renderCertDefs(); renderCertCategories();
  populateCategorySelects();
}

function _adminWireStrings() {
  const search = document.getElementById('memberSearch');
  if (search) search.placeholder = s('admin.searchMembers');
  const bOwnerSearch = document.getElementById('bOwnerSearch');
  if (bOwnerSearch) bOwnerSearch.placeholder = s('admin.searchMember');
  const mInitials = document.getElementById('mInitials');
  if (mInitials) mInitials.placeholder = s('admin.initialsPlaceholder');
}

// ── Collapsible sections ───────────────────────────────────────────────────────
function toggleSection(head) {
  const body   = head.nextElementSibling;
  const toggle = head.querySelector(".col-toggle");
  const isOpen = !body.classList.contains("hidden");
  body.classList.toggle("hidden",  isOpen);
  head.classList.toggle("open",   !isOpen);
  toggle.classList.toggle("open", !isOpen);
}

// ── Top-level tab switching ────────────────────────────────────────────────────
function showTopTab(top) {
  document.querySelectorAll('#topTabBar .tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.top === top);
  });
  document.getElementById('top-members').classList.toggle('hidden', top !== 'members');
  document.getElementById('top-settings').classList.toggle('hidden', top !== 'settings');
  document.getElementById('top-payroll').classList.toggle('hidden', top !== 'payroll');
  if (top === 'settings') {
    const active = document.querySelector('#settingsTabBar .tab-btn.active');
    showTab(active ? active.dataset.tab : 'boats');
  }
  if (top === 'payroll') {
    const frame = document.getElementById('payrollFrame');
    if (frame.src === 'about:blank' || !frame.src.includes('payroll/')) {
      frame.src = 'payroll/?embed=1';
    }
  }
  const url = new URL(window.location.href);
  url.searchParams.set('top', top);
  if (top !== 'settings') url.searchParams.delete('tab');
  history.replaceState(null, '', url);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Settings sub-tab switching ─────────────────────────────────────────────────
function showTab(tab) {
  // Legacy tab aliases — old standalone tabs now live as col-sections inside
  // Scheduling. Keep old bookmarks (?tab=slotCal etc.) working.
  if (tab === 'actTypes' || tab === 'volunteers' || tab === 'clubCal' || tab === 'slotCal') tab = 'scheduling';
  document.querySelectorAll('#top-settings > [id^="tab-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('#settingsTabBar .tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  const sel = document.getElementById('settingsTabSelect');
  if (sel) sel.value = tab;
  const el = document.getElementById('tab-' + tab);
  if (el) el.classList.remove('hidden');

  if (tab === 'certs') renderCertDefs();
  if (tab === 'scheduling') { renderSchedulingTab(); initSlotCalendar(); }
  if (tab === 'passport') renderPassportAdmin();
  if (tab === 'handbook') renderHandbookAdmin();

  const url = new URL(window.location.href);
  url.searchParams.set('tab', tab);
  history.replaceState(null, '', url);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Member sub-navigation ──────────────────────────────────────────────────────
function showMemberSub(sub) {
  document.getElementById('memberSubList').classList.toggle('hidden', sub === 'import');
  document.getElementById('memberSubImport').classList.toggle('hidden', sub !== 'import');
}

// ── Generic entity save ────────────────────────────────────────────────────────
async function saveEntity({ apiAction, getArray, setArray, payload, modalId, renderFn, btn }) {
  if (btn) btn.disabled = true;
  try {
    const res = await apiPost(apiAction, payload);
    const arr = getArray();
    if (!payload.id && res.id) {
      setArray([...arr, { ...payload, id: res.id }]);
    } else {
      setArray(arr.map(x => x.id === payload.id ? { ...x, ...payload } : x));
      if (!arr.find(x => x.id === payload.id)) setArray([...arr, payload]);
    }
    if (modalId) closeModal(modalId, true);
    if (renderFn) renderFn();
    toast(s("toast.saved"));
  } catch(e) {
    toast(s("toast.saveFailed") + ": " + e.message, "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Populate selects driven by boatCats ───────────────────────────────────────
function populateCategorySelects() {
  const L      = getLang();
  const locale = L === 'IS' ? 'is' : 'en';
  const sorted = boatCats.slice().sort((a, b) => {
    const la = (L === 'IS' && a.labelIS ? a.labelIS : a.labelEN) || '';
    const lb = (L === 'IS' && b.labelIS ? b.labelIS : b.labelEN) || '';
    return la.localeCompare(lb, locale, { sensitivity: 'base' });
  });
  const opts = sorted.map(c =>
    `<option value="${esc(c.key)}">${esc(c.emoji || '')} ${esc(L === 'IS' && c.labelIS ? c.labelIS : c.labelEN)}</option>`
  ).join('');

  // Boat modal category select
  const bCat = document.getElementById("bCategory");
  if (bCat) bCat.innerHTML = opts;

  // Launch CL category filter
  const lcFilter = document.getElementById("launchCLCatFilter");
  if (lcFilter) {
    const prev = lcFilter.value;
    lcFilter.innerHTML = opts;
    if (boatCats.find(c => c.key === prev)) lcFilter.value = prev;
  }

  // Launch CL modal: multi-category checkbox list (preserves existing checked state)
  const lcCats = document.getElementById("lcCats");
  if (lcCats) {
    const prev = new Set(
      Array.from(lcCats.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value)
    );
    lcCats.innerHTML = sorted.map(c => {
      const label = (L === 'IS' && c.labelIS ? c.labelIS : c.labelEN) || c.key;
      return `<label><input type="checkbox" class="lc-cat-cb" value="${esc(c.key)}"${
        prev.has(c.key) ? ' checked' : ''
      }> <span>${esc(c.emoji || '')} ${esc(label)}</span></label>`;
    }).join('');
  }
}

// ══ MEMBERS ══════════════════════════════════════════════════════════════════

// ── ROWING PASSPORT ADMIN ─────────────────────────────────────────────────────

// ── Utilities ──────────────────────────────────────────────────────────────────
// bool, esc, parseJson, toast, chunk, openModal, closeModal, todayISO
// all come from shared/api.js and shared/ui.js — no local redefinitions needed.

// ─── Named helpers for state-mutation handlers ───────────────────────────────
function _setArrField(arrName, idx, field, value, asInt) {
  var a = window[arrName]; if (!a || !a[idx]) return;
  a[idx][field] = asInt ? (parseInt(value) || 0) : value;
}
function _setAtRoleField(idx, field, value) {
  _setArrField('_atRoles', idx, field, value, field === 'slots');
}
function _setVolRoleField(idx, field, value) {
  _setArrField('_volRoles', idx, field, value, field === 'slots');
}
function _removeAtRole(idx)  { window._atRoles.splice(+idx, 1); renderAtRoles(); }
function _removeVolRole(idx) { window._volRoles.splice(+idx, 1); renderVolRoles(); }
function _showElement(id)       { var e = document.getElementById(id); if (e) e.classList.remove('hidden'); }
function _removeElementById(id) { var e = document.getElementById(id); if (e) e.remove(); }

// ─── Delegated handlers for data-admin-* attrs ──────────────────────────────
(function () {
  if (typeof document === 'undefined' || document._adminListeners) return;
  document._adminListeners = true;

  function argsFrom(el) {
    var a = [];
    if ('adminArg'  in el.dataset) a.push(el.dataset.adminArg);
    if ('adminArg2' in el.dataset) a.push(el.dataset.adminArg2);
    if ('adminArg3' in el.dataset) a.push(el.dataset.adminArg3);
    // 'null' string → JS null (for openPassport* handlers)
    return a.map(function (v) { return v === 'null' ? null : v; });
  }

  document.addEventListener('click', function (e) {
    // Modal close-self (click on the overlay element itself)
    var cs = e.target.closest('[data-admin-close-self]');
    if (cs && e.target === cs) { closeModal(cs.id); return; }

    // Explicit close target
    var cl = e.target.closest('[data-admin-close]');
    if (cl) { closeModal(cl.dataset.adminClose); return; }

    // Toggle section (expandable panels) — skip when the click originates from a
    // nobubble region inside the section (buttons, inputs, etc.)
    var ts = e.target.closest('[data-admin-toggle-section]');
    if (ts) {
      var nb = e.target.closest('[data-admin-nobubble]');
      if (!(nb && ts.contains(nb))) {
        if (typeof toggleSection === 'function') toggleSection(ts);
        return;
      }
      // fall through so data-admin-click on nested buttons still fires
    }

    // Show element by id
    var se = e.target.closest('[data-admin-show-el]');
    if (se) { _showElement(se.dataset.adminShowEl); return; }

    // Remove element by id
    var re = e.target.closest('[data-admin-remove-el]');
    if (re) { _removeElementById(re.dataset.adminRemoveEl); return; }

    // Click handler that needs the element (e.g. removeClubCalRow(this))
    var cle = e.target.closest('[data-admin-click-el]');
    if (cle && typeof window[cle.dataset.adminClickEl] === 'function') {
      window[cle.dataset.adminClickEl](cle);
      return;
    }

    // Generic click with 0-3 args
    var clk = e.target.closest('[data-admin-click]');
    if (clk && typeof window[clk.dataset.adminClick] === 'function') {
      window[clk.dataset.adminClick].apply(null, argsFrom(clk));
    }
  });

  document.addEventListener('change', function (e) {
    // Preset-change: calls fn(value) then resets the select
    var p = e.target.closest('[data-admin-preset-change]');
    if (p && typeof window[p.dataset.adminPresetChange] === 'function') {
      window[p.dataset.adminPresetChange](p.value);
      p.value = '';
      return;
    }

    // State-mutation setters on array+idx+field
    var ar = e.target.closest('[data-admin-set-at-role]');
    if (ar) { _setAtRoleField(ar.dataset.adminIdx, ar.dataset.adminSetAtRole, ar.value); return; }
    var vr = e.target.closest('[data-admin-set-vol-role]');
    if (vr) { _setVolRoleField(vr.dataset.adminIdx, vr.dataset.adminSetVolRole, vr.value); return; }
    // change-check (checkbox → fn(checked))
    var cc = e.target.closest('[data-admin-change-check]');
    if (cc && typeof window[cc.dataset.adminChangeCheck] === 'function') {
      window[cc.dataset.adminChangeCheck](cc.checked);
      return;
    }

    // change-val (fn(value))
    var cv = e.target.closest('[data-admin-change-val]');
    if (cv && typeof window[cv.dataset.adminChangeVal] === 'function') {
      window[cv.dataset.adminChangeVal](cv.value);
      return;
    }

    // change-el (fn(element))
    var ce = e.target.closest('[data-admin-change-el]');
    if (ce && typeof window[ce.dataset.adminChangeEl] === 'function') {
      window[ce.dataset.adminChangeEl](ce);
      return;
    }

    // No-arg change
    var c = e.target.closest('[data-admin-change]');
    if (c && typeof window[c.dataset.adminChange] === 'function') {
      window[c.dataset.adminChange]();
    }
  });

  document.addEventListener('input', function (e) {
    // input-val (fn(value))
    var iv = e.target.closest('[data-admin-input-val]');
    if (iv && typeof window[iv.dataset.adminInputVal] === 'function') {
      window[iv.dataset.adminInputVal](iv.value);
      return;
    }

    // No-arg input
    var i = e.target.closest('[data-admin-input]');
    if (i && typeof window[i.dataset.adminInput] === 'function') {
      window[i.dataset.adminInput]();
    }
  });
})();
