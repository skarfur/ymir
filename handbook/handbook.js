prefetch({Handbook:['getHandbook']});

const user = requireAuth();
const L    = getLang();

let _hb = { roles: [], docs: [], info: [], staff: [] };
let _hbFilter = '';

document.addEventListener('DOMContentLoaded', async () => {
  buildHeader('handbook');
  applyStrings();
  document.getElementById('hbSearch').placeholder = s('handbook.searchPlaceholder');

  try {
    const res = await (window._earlyHandbook || apiGet('getHandbook'));
    _hb.roles = res.roles || [];
    _hb.docs  = res.docs  || [];
    _hb.info  = res.info  || [];
    _hb.staff = res.staff || [];
  } catch (e) {
    document.getElementById('hbLoading').innerHTML =
      `<div class="empty-note text-red">${s('toast.loadFailed')}: ${esc(e.message)}</div>`;
    return;
  }

  document.getElementById('hbLoading').classList.add('hidden');
  renderHandbook();
});

function _localized(row, key) {
  if (L === 'IS') return row[key + 'IS'] || row[key] || '';
  return row[key] || row[key + 'IS'] || '';
}

function _matchesFilter(text) {
  if (!_hbFilter) return true;
  return String(text || '').toLowerCase().indexOf(_hbFilter) >= 0;
}

function filterHandbook() {
  _hbFilter = (document.getElementById('hbSearch').value || '').trim().toLowerCase();
  renderHandbook();
}

function renderHandbook() {
  renderContactsSection();
  renderOrgChart();
  renderRulesSection();
  renderDocsList();

  const anyVisible =
    !document.getElementById('hbContactsSection').classList.contains('hidden') ||
    !document.getElementById('hbRolesSection').classList.contains('hidden') ||
    !document.getElementById('hbRulesSection').classList.contains('hidden') ||
    !document.getElementById('hbDocsSection').classList.contains('hidden');
  document.getElementById('hbEmpty').classList.toggle('hidden', anyVisible);
}

// Plain text → safe HTML. Linkifies URLs, escapes everything else, preserves
// paragraph breaks. Intentionally narrow so admins can paste raw text without
// fearing malformed HTML on the read side.
function _renderContent(text) {
  if (!text) return '';
  const escaped = esc(String(text));
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return linked.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// ── 1. Contacts (manual entries + auto-populated staff) ──────────────────────

function renderContactsSection() {
  // Manual contacts: handbook_info rows where kind === 'contacts'.
  const contactInfo = _hb.info.filter(it => (it.kind || 'info') === 'contacts');
  const filtered = contactInfo.filter(it => {
    const title = _localized(it, 'title');
    const body  = _localized(it, 'content');
    return _matchesFilter(title) || _matchesFilter(body);
  });

  // Staff: filter by name/phone/email so the search bar prunes the auto-list too.
  const staff = (_hb.staff || []).filter(p => {
    return _matchesFilter(p.name) || _matchesFilter(p.phone) || _matchesFilter(p.email);
  });

  const wrap = document.getElementById('hbContactsSection');
  const numList = document.getElementById('hbContactsList');
  const staffList = document.getElementById('hbStaffList');

  if (!filtered.length && !staff.length) {
    wrap.classList.add('hidden');
    numList.innerHTML = '';
    staffList.innerHTML = '';
    return;
  }
  wrap.classList.remove('hidden');

  numList.innerHTML = filtered.map(it => `
    <div class="hb-info-card">
      <div class="hb-info-title">${esc(_localized(it, 'title'))}</div>
      <div class="hb-info-body">${_renderContent(_localized(it, 'content'))}</div>
    </div>
  `).join('');

  if (staff.length) {
    staffList.innerHTML = `
      <div class="hb-staff-hdr text-xs text-muted">${esc(s('handbook.staffAuto'))}</div>
      <div class="hb-staff-grid">
        ${staff.map(p => `
          <div class="hb-staff-card">
            <div class="hb-staff-name">${esc(p.name || '')}</div>
            <div class="hb-staff-role">${esc(p.role || '')}</div>
            <div class="hb-staff-contact">
              ${p.phone ? `<a href="tel:${esc(p.phone)}" class="hb-link">${esc(p.phone)}</a>` : ''}
              ${p.phone && p.email ? '<span class="hb-sep"> · </span>' : ''}
              ${p.email ? `<a href="mailto:${esc(p.email)}" class="hb-link">${esc(p.email)}</a>` : ''}
            </div>
          </div>
        `).join('')}
      </div>`;
  } else {
    staffList.innerHTML = '';
  }
}

// ── 2. Org chart (visual tree) ───────────────────────────────────────────────

function renderOrgChart() {
  const byId = {};
  _hb.roles.forEach(r => { byId[r.id] = Object.assign({ children: [] }, r); });
  const roots = [];
  Object.values(byId).forEach(r => {
    if (r.parentId && byId[r.parentId]) byId[r.parentId].children.push(r);
    else roots.push(r);
  });
  const sorter = (a, b) => (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) ||
                           String(_localized(a, 'title')).localeCompare(_localized(b, 'title'));
  roots.sort(sorter);
  Object.values(byId).forEach(r => r.children.sort(sorter));

  function visible(r) {
    const childMatches = r.children.some(visible);
    const self = _matchesFilter(_localized(r, 'title')) ||
                 _matchesFilter(r.name) ||
                 _matchesFilter(r.phone) ||
                 _matchesFilter(r.email) ||
                 _matchesFilter(_localized(r, 'notes'));
    return self || childMatches;
  }

  const visibleRoots = roots.filter(visible);
  const wrap = document.getElementById('hbRolesSection');
  const target = document.getElementById('hbOrgChart');
  if (!visibleRoots.length) { wrap.classList.add('hidden'); target.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  target.innerHTML = `<div class="hb-orgchart-row hb-orgchart-roots">${
    visibleRoots.map(r => _renderOrgNode(r, visible)).join('')
  }</div>`;
}

function _renderOrgNode(r, visiblePred) {
  const visibleChildren = (r.children || []).filter(visiblePred);
  const title = esc(_localized(r, 'title'));
  const name  = esc(r.name || '');
  const phone = r.phone ? `<a href="tel:${esc(r.phone)}" class="hb-link">${esc(r.phone)}</a>` : '';
  const email = r.email ? `<a href="mailto:${esc(r.email)}" class="hb-link">${esc(r.email)}</a>` : '';
  const notes = esc(_localized(r, 'notes'));
  const contactRow = (phone || email)
    ? `<div class="hb-orgnode-contact">${phone}${phone && email ? ' · ' : ''}${email}</div>`
    : '';
  const notesRow = notes ? `<div class="hb-orgnode-notes">${notes}</div>` : '';
  const accent = r.color ? ` style="--hb-accent:${esc(r.color)}"` : '';
  const hasChildren = visibleChildren.length > 0;
  return `
    <div class="hb-orgnode-wrap">
      <div class="hb-orgnode${hasChildren ? ' hb-orgnode--has-children' : ''}"${accent}>
        <div class="hb-orgnode-title">${title}</div>
        ${name ? `<div class="hb-orgnode-name">${name}</div>` : ''}
        ${contactRow}
        ${notesRow}
      </div>
      ${hasChildren ? `
        <div class="hb-orgchart-row">
          ${visibleChildren.map(c => _renderOrgNode(c, visiblePred)).join('')}
        </div>` : ''}
    </div>`;
}

// ── 3. Rules / best practices ────────────────────────────────────────────────

function renderRulesSection() {
  // 'rules' kind explicitly, plus legacy entries with no kind set so existing
  // content keeps showing up after the schema migration.
  const list = _hb.info
    .filter(it => {
      const k = it.kind || 'info';
      return k === 'rules' || k === 'info';
    })
    .filter(it => {
      const title = _localized(it, 'title');
      const body  = _localized(it, 'content');
      return _matchesFilter(title) || _matchesFilter(body);
    });
  const wrap = document.getElementById('hbRulesSection');
  const target = document.getElementById('hbRulesList');
  if (!list.length) { wrap.classList.add('hidden'); target.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  target.innerHTML = list.map(it => `
    <div class="hb-info-card">
      <div class="hb-info-title">${esc(_localized(it, 'title'))}</div>
      <div class="hb-info-body">${_renderContent(_localized(it, 'content'))}</div>
    </div>
  `).join('');
}

// ── 4. Docs (PDFs + URLs) ────────────────────────────────────────────────────

function renderDocsList() {
  const list = _hb.docs.filter(d => {
    const title = _localized(d, 'title');
    const cat   = _localized(d, 'category');
    const notes = _localized(d, 'notes');
    return _matchesFilter(title) || _matchesFilter(cat) || _matchesFilter(notes);
  });
  const wrap = document.getElementById('hbDocsSection');
  const target = document.getElementById('hbDocsList');
  if (!list.length) { wrap.classList.add('hidden'); target.innerHTML = ''; return; }
  wrap.classList.remove('hidden');

  const groups = {};
  list.forEach(d => {
    const cat = _localized(d, 'category') || s('handbook.docCatOther');
    (groups[cat] = groups[cat] || []).push(d);
  });
  const catNames = Object.keys(groups).sort();
  target.innerHTML = catNames.map(cat => `
    <div class="hb-doc-group">
      <div class="hb-doc-cat">${esc(cat)}</div>
      <ul class="hb-doc-list">
        ${groups[cat].map(d => `
          <li>
            <a class="hb-doc-link" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">
              <span class="hb-doc-icon" aria-hidden="true">${d.driveFileId ? '📄' : '🔗'}</span>
              <span class="hb-doc-title">${esc(_localized(d, 'title'))}</span>
            </a>
            ${_localized(d, 'notes') ? `<div class="hb-doc-notes">${esc(_localized(d, 'notes'))}</div>` : ''}
          </li>
        `).join('')}
      </ul>
    </div>
  `).join('');
}

// ── Delegated event listeners ────────────────────────────────────────────────
(function () {
  if (typeof document === 'undefined' || document._hbListeners) return;
  document._hbListeners = true;
  document.addEventListener('input', function (e) {
    var i = e.target.closest('[data-hb-input]');
    if (i && typeof window[i.dataset.hbInput] === 'function') {
      window[i.dataset.hbInput]();
    }
  });
})();
