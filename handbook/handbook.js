prefetch({Handbook:['getHandbook']});

const user = requireAuth();
const L    = getLang();

let _hb = { roles: [], docs: [], info: [] };
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
  } catch (e) {
    document.getElementById('hbLoading').innerHTML =
      `<div class="empty-note text-red">${s('toast.loadFailed')}: ${esc(e.message)}</div>`;
    return;
  }

  document.getElementById('hbLoading').classList.add('hidden');
  renderHandbook();
});

function _localized(row, key) {
  // Prefer the user's language; fall back to the other one if blank.
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
  renderInfoList();
  renderRolesTree();
  renderDocsList();

  // Empty state — true when nothing matches the current filter.
  const anyVisible =
    !document.getElementById('hbInfoSection').classList.contains('hidden') ||
    !document.getElementById('hbRolesSection').classList.contains('hidden') ||
    !document.getElementById('hbDocsSection').classList.contains('hidden');
  document.getElementById('hbEmpty').classList.toggle('hidden', anyVisible);
}

// ── Info sections ────────────────────────────────────────────────────────────

function renderInfoList() {
  const list = _hb.info.filter(it => {
    const title = _localized(it, 'title');
    const body  = _localized(it, 'content');
    return _matchesFilter(title) || _matchesFilter(body);
  });
  const wrap = document.getElementById('hbInfoSection');
  const target = document.getElementById('hbInfoList');
  if (!list.length) { wrap.classList.add('hidden'); target.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  target.innerHTML = list.map(it => `
    <div class="hb-info-card">
      <div class="hb-info-title">${esc(_localized(it, 'title'))}</div>
      <div class="hb-info-body">${_renderContent(_localized(it, 'content'))}</div>
    </div>
  `).join('');
}

// Plain text → HTML. Linkifies URLs, escapes everything else, preserves
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

// ── Roles (org chart) ────────────────────────────────────────────────────────

function renderRolesTree() {
  // Build a parent → children map; entries with no parent or a missing parent
  // become roots.
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

  // Filter: keep a node if it matches OR any descendant matches.
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
  const target = document.getElementById('hbRolesTree');
  if (!visibleRoots.length) { wrap.classList.add('hidden'); target.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  target.innerHTML = visibleRoots.map(r => _renderRoleNode(r, visible)).join('');
}

function _renderRoleNode(r, visiblePred) {
  const title = esc(_localized(r, 'title'));
  const name  = esc(r.name || '');
  const phone = r.phone ? `<a href="tel:${esc(r.phone)}" class="hb-link">${esc(r.phone)}</a>` : '';
  const email = r.email ? `<a href="mailto:${esc(r.email)}" class="hb-link">${esc(r.email)}</a>` : '';
  const notes = esc(_localized(r, 'notes'));
  const contactRow = (phone || email)
    ? `<div class="hb-role-contact">${phone}${phone && email ? ' · ' : ''}${email}</div>`
    : '';
  const notesRow = notes ? `<div class="hb-role-notes">${notes}</div>` : '';
  const childrenHtml = (r.children || [])
    .filter(visiblePred)
    .map(c => _renderRoleNode(c, visiblePred))
    .join('');
  return `
    <div class="hb-role-node">
      <div class="hb-role-card">
        <div class="hb-role-title">${title}</div>
        ${name ? `<div class="hb-role-name">${name}</div>` : ''}
        ${contactRow}
        ${notesRow}
      </div>
      ${childrenHtml ? `<div class="hb-role-children">${childrenHtml}</div>` : ''}
    </div>`;
}

// ── Docs (PDFs + URLs) ───────────────────────────────────────────────────────

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

  // Group by category (blank category goes last in an "Other" bucket).
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
