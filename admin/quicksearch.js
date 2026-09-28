// ═══════════════════════════════════════════════════════════════════════════════
// admin/quicksearch.js — ⌘K / Ctrl+K quick search across admin sections,
// members and boats. Opened from the sidebar button, the mobile search button,
// or the keyboard shortcut (wired in admin.js's delegated keydown listener).
// ═══════════════════════════════════════════════════════════════════════════════

var _cmdkItems = [];
var _cmdkIndex = 0;
var _CMDK_MAX_MEMBERS = 8;
var _CMDK_MAX_BOATS   = 5;

// Section entries mirror the sidebar; labels reuse the sidebar's string keys.
var _CMDK_SECTIONS = [
  { id: 'members',    key: 'admin.tabMembers' },
  { id: 'certs',      key: 'admin.tabCerts' },
  { id: 'passport',   key: 'passport.adminTitle' },
  { id: 'boats',      key: 'admin.tabBoats' },
  { id: 'locations',  key: 'admin.tabLocations' },
  { id: 'checklists', key: 'admin.tabChecklists' },
  { id: 'flags',      key: 'admin.tabFlags' },
  { id: 'alerts',     key: 'admin.tabAlerts' },
  { id: 'scheduling', key: 'admin.tabScheduling' },
  { id: 'handbook',   key: 'admin.tabHandbook' },
  { id: 'other',      key: 'admin.tabOther' },
  { id: 'payroll',    key: 'admin.tabPayroll' },
];

function openCmdK() {
  var modal = document.getElementById('cmdkModal');
  if (!modal) return;
  if (!modal.classList.contains('hidden')) { document.getElementById('cmdkInput').focus(); return; }
  document.getElementById('cmdkInput').value = '';
  renderCmdK();
  openModal('cmdkModal');
}

function _cmdkMatch(text, q) { return String(text || '').toLowerCase().includes(q); }

function renderCmdK() {
  var q = (document.getElementById('cmdkInput').value || '').toLowerCase().trim();
  var items = [];

  _CMDK_SECTIONS.forEach(function (sec) {
    var label = s(sec.key);
    if (!q || _cmdkMatch(label, q)) items.push({ kind: 'section', id: sec.id, label: label, sub: s('admin.cmdk.kindSection') });
  });

  if (q) {
    (members || [])
      .filter(function (m) { return _cmdkMatch(m.name, q) || String(m.kennitala || '').includes(q) || _cmdkMatch(m.email, q); })
      .slice(0, _CMDK_MAX_MEMBERS)
      .forEach(function (m) {
        items.push({ kind: 'member', id: m.id, label: m.name || m.kennitala,
          sub: s('admin.cmdk.kindMember') + (bool(m.active) ? '' : ' · ' + s('admin.mem.fInactive')) });
      });
    (_allBoats || [])
      .filter(function (b) { return _cmdkMatch(b.name, q); })
      .slice(0, _CMDK_MAX_BOATS)
      .forEach(function (b) { items.push({ kind: 'boat', id: b.id, label: b.name, sub: s('admin.cmdk.kindBoat') }); });
  }

  _cmdkItems = items;
  _cmdkIndex = 0;
  var list = document.getElementById('cmdkList');
  if (!items.length) {
    list.innerHTML = '<div class="cmdk-empty">' + esc(s('admin.cmdk.noResults')) + '</div>';
    document.getElementById('cmdkInput').removeAttribute('aria-activedescendant');
    return;
  }
  list.innerHTML = items.map(function (it, i) {
    return '<button type="button" tabindex="-1" class="cmdk-item" role="option" id="cmdk-opt-' + i + '"' +
      ' data-admin-click="runCmdK" data-admin-arg="' + i + '">' +
      '<span class="cmdk-item-label">' + esc(it.label) + '</span>' +
      '<span class="cmdk-item-kind">' + esc(it.sub) + '</span></button>';
  }).join('');
  _cmdkHighlight();
}

function _cmdkHighlight() {
  var opts = document.querySelectorAll('#cmdkList .cmdk-item');
  opts.forEach(function (o, i) {
    var on = i === _cmdkIndex;
    o.classList.toggle('active', on);
    o.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) o.scrollIntoView({ block: 'nearest' });
  });
  var input = document.getElementById('cmdkInput');
  if (opts.length) input.setAttribute('aria-activedescendant', 'cmdk-opt-' + _cmdkIndex);
}

function cmdkKey(e) {
  if (!_cmdkItems.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); _cmdkIndex = (_cmdkIndex + 1) % _cmdkItems.length; _cmdkHighlight(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _cmdkIndex = (_cmdkIndex - 1 + _cmdkItems.length) % _cmdkItems.length; _cmdkHighlight(); }
  else if (e.key === 'Enter') { e.preventDefault(); runCmdK(_cmdkIndex); }
}

function runCmdK(idx) {
  var it = _cmdkItems[+idx];
  if (!it) return;
  closeModal('cmdkModal', true);
  if (it.kind === 'section') { adminNav(it.id); return; }
  if (it.kind === 'boat') { adminNav('boats'); if (typeof openBoatModal === 'function') openBoatModal(it.id); return; }
  if (it.kind === 'member') {
    adminNav('members');
    showMemberSub('list');
    // Make sure the member is visible in the list: clear the search and show all.
    document.getElementById('memberSearch').value = '';
    _memberFilter = 'all';
    renderMembers();
    selectMember(it.id);
    var row = document.querySelector('#membersCard .mem-row.selected');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
}
