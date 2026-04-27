prefetch({Handbook:['getHandbook']});

requireAuth();

let _hb = { roles: [], docs: [], info: [], contacts: [] };
let _hbFilter = '';

document.addEventListener('DOMContentLoaded', async () => {
  buildHeader('handbook');
  applyStrings();
  document.getElementById('hbSearch').placeholder = s('handbook.searchPlaceholder');

  try {
    const res = await (window._earlyHandbook || apiGet('getHandbook'));
    _hb.roles    = res.roles    || [];
    _hb.docs     = res.docs     || [];
    _hb.info     = res.info     || [];
    _hb.contacts = res.contacts || [];
  } catch (e) {
    document.getElementById('hbLoading').innerHTML =
      `<div class="empty-note text-red">${s('toast.loadFailed')}: ${esc(e.message)}</div>`;
    return;
  }

  document.getElementById('hbLoading').classList.add('hidden');
  renderHandbook();
});

const _t = (row, key) => localizedField(row, key);

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

// Plain text → safe HTML: escape, linkify URLs, preserve paragraph breaks.
function _renderContent(text) {
  if (!text) return '';
  const escaped = esc(String(text));
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return linked.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function renderContactsSection() {
  const people = (_hb.contacts || []).filter(c =>
    _matchesFilter(_t(c, 'label')) ||
    _matchesFilter(c.name)  ||
    _matchesFilter(c.phone) ||
    _matchesFilter(c.email) ||
    _matchesFilter(_t(c, 'notes'))
  );

  const text = _hb.info
    .filter(it => (it.kind || 'info') === 'contacts')
    .filter(it => _matchesFilter(_t(it, 'title')) || _matchesFilter(_t(it, 'content')));

  const wrap     = document.getElementById('hbContactsSection');
  const peopleEl = document.getElementById('hbContactsPeople');
  const textEl   = document.getElementById('hbContactsText');

  if (!people.length && !text.length) {
    wrap.classList.add('hidden');
    peopleEl.innerHTML = '';
    textEl.innerHTML = '';
    return;
  }
  wrap.classList.remove('hidden');

  peopleEl.innerHTML = people.length ? `
    <div class="hb-contact-grid">
      ${people.map(c => {
        const label = esc(_t(c, 'label'));
        const name  = esc(c.name || '');
        const phone = c.phone ? `<a href="tel:${esc(c.phone)}" class="hb-link">${esc(c.phone)}</a>` : '';
        const email = c.email ? `<a href="mailto:${esc(c.email)}" class="hb-link">${esc(c.email)}</a>` : '';
        const notes = esc(_t(c, 'notes'));
        return `
          <div class="hb-contact-card">
            ${label ? `<div class="hb-contact-label">${label}</div>` : ''}
            ${name ? `<div class="hb-contact-name">${name}</div>` : ''}
            <div class="hb-contact-meta">
              ${phone}${phone && email ? '<span class="hb-sep"> · </span>' : ''}${email}
            </div>
            ${notes ? `<div class="hb-contact-notes">${notes}</div>` : ''}
          </div>`;
      }).join('')}
    </div>` : '';

  textEl.innerHTML = text.length ? text.map(it => `
    <div class="hb-info-card">
      <div class="hb-info-title">${esc(_t(it, 'title'))}</div>
      <div class="hb-info-body">${_renderContent(_t(it, 'content'))}</div>
    </div>
  `).join('') : '';
}

function renderOrgChart() {
  const byId = {};
  _hb.roles.forEach(r => { byId[r.id] = Object.assign({ children: [] }, r); });
  const roots = [];
  Object.values(byId).forEach(r => {
    if (r.parentId && byId[r.parentId]) byId[r.parentId].children.push(r);
    else roots.push(r);
  });
  const sorter = (a, b) => (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) ||
                           String(_t(a, 'title')).localeCompare(_t(b, 'title'));
  roots.sort(sorter);
  Object.values(byId).forEach(r => r.children.sort(sorter));

  const visCache = {};
  function visible(r) {
    if (visCache[r.id] !== undefined) return visCache[r.id];
    const childMatches = r.children.some(visible);
    const memberMatch = (r.members || []).some(m =>
      _matchesFilter(m.name) || _matchesFilter(_t(m, 'label')) ||
      _matchesFilter(m.phone) || _matchesFilter(m.email)
    );
    const self = _matchesFilter(_t(r, 'title')) ||
                 _matchesFilter(_t(r, 'notes')) ||
                 memberMatch;
    return (visCache[r.id] = self || childMatches);
  }

  const visibleRoots = roots.filter(visible);
  const wrap = document.getElementById('hbRolesSection');
  const target = document.getElementById('hbOrgChart');
  if (!visibleRoots.length) { wrap.classList.add('hidden'); target.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  target.innerHTML = `<div class="hb-orgchart-row hb-orgchart-roots">${
    visibleRoots.map(r => _renderOrgNode(r, visible, byId)).join('')
  }</div>`;
}

function _renderOrgNode(r, visiblePred, byId) {
  const visibleChildren = (r.children || []).filter(visiblePred);
  const title = esc(_t(r, 'title'));
  const notes = esc(_t(r, 'notes'));
  const notesRow = notes ? `<div class="hb-orgnode-notes">${notes}</div>` : '';
  // --hb-accent on the wrap cascades to descendant sub-roles via CSS
  // custom-property inheritance; children with their own color override.
  const accent = r.color ? ` style="--hb-accent:${esc(r.color)}"` : '';
  const hasChildren = visibleChildren.length > 0;
  const membersHtml = _renderOrgNodeMembers(r.members || [], byId);
  return `
    <div class="hb-orgnode-wrap"${accent}>
      <div class="hb-orgnode${hasChildren ? ' hb-orgnode--has-children' : ''}">
        <div class="hb-orgnode-title">${title}</div>
        ${membersHtml}
        ${notesRow}
      </div>
      ${hasChildren ? `
        <div class="hb-orgchart-row">
          ${visibleChildren.map(c => _renderOrgNode(c, visiblePred, byId)).join('')}
        </div>` : ''}
    </div>`;
}

function _renderOrgNodeMembers(members, byId) {
  if (!members.length) return '';
  return `<ul class="hb-member-list">${
    members.map(m => {
      const name  = esc(m.name || '');
      const label = esc(_t(m, 'label'));
      const phone = m.phone ? `<a href="tel:${esc(m.phone)}" class="hb-link">${esc(m.phone)}</a>` : '';
      const email = m.email ? `<a href="mailto:${esc(m.email)}" class="hb-link">${esc(m.email)}</a>` : '';
      const repRole = m.representsRoleId && byId[m.representsRoleId];
      const chip = repRole
        ? `<span class="hb-represents-chip" style="--hb-chip:${esc(repRole.color || 'var(--brass)')}">${esc(_t(repRole, 'title'))}</span>`
        : '';
      const contact = (phone || email)
        ? `<span class="hb-member-contact">${phone}${phone && email ? ' · ' : ''}${email}</span>`
        : '';
      return `
        <li class="hb-member-item">
          <span class="hb-member-name">${name || '—'}</span>
          ${label ? `<span class="hb-member-label">${label}</span>` : ''}
          ${chip}
          ${contact}
        </li>`;
    }).join('')
  }</ul>`;
}

function renderRulesSection() {
  // Includes legacy rows where `kind` is unset so pre-migration content
  // still renders here.
  const list = _hb.info
    .filter(it => {
      const k = it.kind || 'info';
      return k === 'rules' || k === 'info';
    })
    .filter(it => _matchesFilter(_t(it, 'title')) || _matchesFilter(_t(it, 'content')));
  const wrap = document.getElementById('hbRulesSection');
  const target = document.getElementById('hbRulesList');
  if (!list.length) { wrap.classList.add('hidden'); target.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  target.innerHTML = list.map(it => `
    <div class="hb-info-card">
      <div class="hb-info-title">${esc(_t(it, 'title'))}</div>
      <div class="hb-info-body">${_renderContent(_t(it, 'content'))}</div>
    </div>
  `).join('');
}

function renderDocsList() {
  const list = _hb.docs.filter(d =>
    _matchesFilter(_t(d, 'title')) ||
    _matchesFilter(_t(d, 'category')) ||
    _matchesFilter(_t(d, 'notes'))
  );
  const wrap = document.getElementById('hbDocsSection');
  const target = document.getElementById('hbDocsList');
  if (!list.length) { wrap.classList.add('hidden'); target.innerHTML = ''; return; }
  wrap.classList.remove('hidden');

  const groups = {};
  list.forEach(d => {
    const cat = _t(d, 'category') || s('handbook.docCatOther');
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
              <span class="hb-doc-title">${esc(_t(d, 'title'))}</span>
            </a>
            ${_t(d, 'notes') ? `<div class="hb-doc-notes">${esc(_t(d, 'notes'))}</div>` : ''}
          </li>
        `).join('')}
      </ul>
    </div>
  `).join('');
}

(function () {
  if (document._hbListeners) return;
  document._hbListeners = true;
  document.addEventListener('input', function (e) {
    var i = e.target.closest('[data-hb-input]');
    if (i && typeof window[i.dataset.hbInput] === 'function') {
      window[i.dataset.hbInput]();
    }
  });
})();
