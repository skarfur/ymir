// Handbook admin: contacts (people + free text), rules, org chart, docs.

var _hbAdmin = {
  info: [], roles: [], docs: [], contacts: [],
  editingInfoId: null, editingRoleId: null, editingDocId: null, editingContactId: null,
};

async function loadHandbookAdmin(force) {
  try {
    const res = await apiGet('getHandbook', force ? { _fresh: 1 } : {});
    _hbAdmin.info     = res.info     || [];
    _hbAdmin.roles    = res.roles    || [];
    _hbAdmin.docs     = res.docs     || [];
    _hbAdmin.contacts = res.contacts || [];
  } catch (e) {
    console.warn('loadHandbookAdmin failed:', e.message);
  }
}

async function renderHandbookAdmin() {
  await loadHandbookAdmin();
  renderHandbookContactsAdmin();
  renderHandbookRulesAdmin();
  renderHandbookRolesList();
  renderHandbookDocsList();
}

const _hbT = (row, key) => localizedField(row, key);

function _hbBySort(a, b) {
  return (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) ||
    String(a.title || a.label || '').localeCompare(String(b.title || b.label || ''));
}

function _hbAdminMemberName(kt) {
  if (typeof members === 'undefined' || !members) return '';
  const m = members.find(x => String(x.kennitala) === String(kt));
  return m ? (m.name || '') : '';
}

// Generic save: posts the payload, splices the result into the local array,
// closes the modal, re-renders, toasts. `render` may be a single fn or array.
async function _hbSave(action, payload, listKey, modalId, render) {
  try {
    const res = await apiPost(action, payload);
    payload.id = payload.id || res.id;
    payload.active = true;
    const arr = _hbAdmin[listKey];
    const idx = arr.findIndex(x => x.id === payload.id);
    if (idx >= 0) arr[idx] = { ...arr[idx], ...payload };
    else          arr.push(payload);
    closeModal(modalId, true);
    [].concat(render).forEach(fn => fn());
    toast(s('toast.saved'));
  } catch (e) { toast(s('toast.saveFailed') + ': ' + e.message, 'err'); }
}

async function _hbDelete(action, listKey, editingKey, modalId, render) {
  const id = _hbAdmin[editingKey];
  if (!id) return;
  if (!await ymConfirm(s('admin.handbookConfirmDelete'))) return;
  try {
    await apiPost(action, { id: id });
    _hbAdmin[listKey] = _hbAdmin[listKey].filter(x => x.id !== id);
    closeModal(modalId, true);
    [].concat(render).forEach(fn => fn());
    toast(s('toast.deleted'));
  } catch (e) { toast(s('toast.error') + ': ' + e.message, 'err'); }
}

// ── Contacts col-section: people + free-text ────────────────────────────────

function _hbInfoRowHtml(it) {
  return `
    <div class="list-row">
      <span class="list-name">${esc(_hbT(it, 'title'))}</span>
      <button class="row-edit" data-admin-click="openHandbookInfoModal" data-admin-arg="${it.id}">${s('btn.edit')}</button>
    </div>`;
}

function renderHandbookContactsAdmin() {
  const card = document.getElementById('hbAdminContactsCard');
  if (!card) return;
  const ppl  = (_hbAdmin.contacts || []).slice().sort(_hbBySort);
  const text = (_hbAdmin.info || []).filter(it => it.kind === 'contacts').sort(_hbBySort);

  let html = '';
  if (ppl.length) {
    html += `<div class="text-xs text-muted mb-4" style="text-transform:uppercase;letter-spacing:1px">${esc(s('admin.handbookContactsPeople'))}</div>`;
    html += ppl.map(c => {
      const lbl  = _hbT(c, 'label');
      const name = c.name || (c.memberId ? _hbAdminMemberName(c.memberId) : '');
      return `
        <div class="list-row">
          <span class="list-name">${esc(name || '—')}<span class="text-xs text-muted"> · ${esc(lbl)}</span></span>
          <button class="row-edit" data-admin-click="openHandbookContactModal" data-admin-arg="${c.id}">${s('btn.edit')}</button>
        </div>`;
    }).join('');
  }
  if (text.length) {
    html += `<div class="text-xs text-muted mt-8 mb-4" style="text-transform:uppercase;letter-spacing:1px">${esc(s('admin.handbookContactsText'))}</div>`;
    html += text.map(_hbInfoRowHtml).join('');
  }
  card.innerHTML = html || `<div class="empty-state">${s('admin.handbookEmptyInfo')}</div>`;
}

// Rules is now a single free-text body (markdown) with EN + IS textareas.
// Loads the canonical 'rules_main' row, falling back to the first existing
// 'rules' (or legacy 'info') row so pre-existing content surfaces for editing.
function renderHandbookRulesAdmin() {
  const en = document.getElementById('hbRulesContent');
  const is = document.getElementById('hbRulesContentIS');
  const titleEn = document.getElementById('hbRulesTitle');
  const titleIs = document.getElementById('hbRulesTitleIS');
  if (!en || !is) return;
  const rows = (_hbAdmin.info || []).filter(it => {
    const k = it.kind || 'info';
    return k === 'rules' || k === 'info';
  });
  const main = rows.find(r => r.id === 'rules_main') || rows[0] || null;
  // Populate from cache only on first mount; avoid clobbering in-progress
  // edits if a sibling save (contacts modal etc.) re-runs this renderer.
  if (en.dataset.mounted !== '1') {
    en.value = main ? (main.content   || '') : '';
    is.value = main ? (main.contentIS || '') : '';
    if (titleEn) titleEn.value = main ? (main.title   || '') : '';
    if (titleIs) titleIs.value = main ? (main.titleIS || '') : '';
    if (titleEn) titleEn.placeholder = s('handbook.rulesHdr');
    if (titleIs) titleIs.placeholder = s('handbook.rulesHdr');
    en.dataset.mounted = '1';
    is.dataset.mounted = '1';
  }
  const status = document.getElementById('hbRulesStatus');
  if (status) status.textContent = '';
}

async function saveHandbookRulesBody() {
  const en = document.getElementById('hbRulesContent');
  const is = document.getElementById('hbRulesContentIS');
  const titleEn = document.getElementById('hbRulesTitle');
  const titleIs = document.getElementById('hbRulesTitleIS');
  const status = document.getElementById('hbRulesStatus');
  try {
    const titleVal   = (titleEn && titleEn.value.trim()) || 'Rules';
    const titleISVal = (titleIs && titleIs.value.trim()) || 'Reglur';
    const payload = {
      id:        'rules_main',
      kind:      'rules',
      title:     titleVal,
      titleIS:   titleISVal,
      content:   en.value,
      contentIS: is.value,
      sortOrder: 0,
    };
    const res = await apiPost('saveHandbookInfo', payload);
    payload.active = true;
    payload.id = payload.id || res.id;
    const arr = _hbAdmin.info;
    const idx = arr.findIndex(x => x.id === payload.id);
    if (idx >= 0) arr[idx] = { ...arr[idx], ...payload };
    else          arr.push(payload);
    if (status) status.textContent = s('admin.handbook.rules.saved');
    toast(s('toast.saved'));
  } catch (e) {
    toast(s('toast.saveFailed') + ': ' + e.message, 'err');
  }
}

// Wraps the current selection in `before`/`after`, or inserts `placeholder`
// inside the wrappers if there's no selection. For line-prefix tools (lists,
// headings) pass `before` only with a trailing space; the insertion happens
// at the start of the current line.
function hbRulesFormat(targetId, kind) {
  const ta = document.getElementById(targetId);
  if (!ta) return;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const value = ta.value;
  const sel   = value.slice(start, end);

  const wrap = (before, after, placeholder) => {
    const inner = sel || placeholder || '';
    const next  = value.slice(0, start) + before + inner + after + value.slice(end);
    ta.value = next;
    const cStart = start + before.length;
    const cEnd   = cStart + inner.length;
    ta.setSelectionRange(cStart, cEnd);
  };

  const linePrefix = (prefix) => {
    // Find the start of the current line.
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    // Apply prefix to every line in the selection (or just the current line).
    const block = value.slice(lineStart, end);
    const prefixed = block.split('\n').map(l => prefix + l).join('\n');
    ta.value = value.slice(0, lineStart) + prefixed + value.slice(end);
    ta.setSelectionRange(lineStart, lineStart + prefixed.length);
  };

  switch (kind) {
    case 'bold':    wrap('**', '**', s('admin.handbook.rules.tb.boldPh'));     break;
    case 'italic':  wrap('*',  '*',  s('admin.handbook.rules.tb.italicPh'));   break;
    case 'h2':      linePrefix('## ');                                          break;
    case 'h3':      linePrefix('### ');                                         break;
    case 'ul':      linePrefix('- ');                                           break;
    case 'ol':      linePrefix('1. ');                                          break;
    case 'link': {
      const url = sel && /^https?:\/\//.test(sel) ? sel : 'https://';
      const text = sel && !/^https?:\/\//.test(sel) ? sel : s('admin.handbook.rules.tb.linkPh');
      const next = value.slice(0, start) + '[' + text + '](' + url + ')' + value.slice(end);
      ta.value = next;
      const cStart = start + 1;
      ta.setSelectionRange(cStart, cStart + text.length);
      break;
    }
    case 'code':    wrap('`', '`', s('admin.handbook.rules.tb.codePh'));        break;
  }
  ta.focus();
}

function openHandbookInfoModal(id, kindHint) {
  _hbAdmin.editingInfoId = id || null;
  const row = id ? _hbAdmin.info.find(x => x.id === id) : null;
  document.getElementById('hbInfoModalTitle').textContent = row
    ? s('admin.handbook.info.modalEdit')
    : s('admin.handbook.info.modalAdd');
  let kind;
  if (row)            kind = row.kind === 'contacts' ? 'contacts' : 'rules';
  else if (kindHint)  kind = kindHint;
  else                kind = 'contacts';
  document.getElementById('hbInfoKind').value      = kind;
  document.getElementById('hbInfoTitle').value     = row ? (row.title || '')     : '';
  document.getElementById('hbInfoTitleIS').value   = row ? (row.titleIS || '')   : '';
  document.getElementById('hbInfoContent').value   = row ? (row.content || '')   : '';
  document.getElementById('hbInfoContentIS').value = row ? (row.contentIS || '') : '';
  document.getElementById('hbInfoSort').value      = row ? (row.sortOrder || 0)  : 0;
  document.getElementById('hbInfoDeleteBtn').classList.toggle('hidden', !row);
  applyStrings(document.getElementById('hbInfoModal'));
  openModal('hbInfoModal');
}

async function saveHandbookInfo() {
  const title   = document.getElementById('hbInfoTitle').value.trim();
  const titleIS = document.getElementById('hbInfoTitleIS').value.trim();
  if (!title && !titleIS) { toast(s('admin.nameRequired') || 'Title required', 'err'); return; }
  return _hbSave('saveHandbookInfo', {
    id:        _hbAdmin.editingInfoId || undefined,
    kind:      document.getElementById('hbInfoKind').value,
    title:     title,
    titleIS:   titleIS,
    content:   document.getElementById('hbInfoContent').value,
    contentIS: document.getElementById('hbInfoContentIS').value,
    sortOrder: Number(document.getElementById('hbInfoSort').value) || 0,
  }, 'info', 'hbInfoModal', [renderHandbookContactsAdmin, renderHandbookRulesAdmin]);
}

async function deleteHandbookInfo() {
  return _hbDelete('deleteHandbookInfo', 'info', 'editingInfoId', 'hbInfoModal',
    [renderHandbookContactsAdmin, renderHandbookRulesAdmin]);
}

// ── Member-linked contacts ──────────────────────────────────────────────────

function openHandbookContactModal(id) {
  _hbAdmin.editingContactId = id || null;
  const row = id ? _hbAdmin.contacts.find(x => x.id === id) : null;
  document.getElementById('hbContactModalTitle').textContent = row
    ? s('admin.handbook.contact.modalEdit')
    : s('admin.handbook.contact.modalAdd');

  const sel = document.getElementById('hbContactMember');
  const opts = ['<option value="">' + esc(s('admin.handbook.contact.memberNone')) + '</option>'];
  if (typeof members !== 'undefined' && Array.isArray(members)) {
    members
      .filter(m => bool(m.active))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .forEach(m => {
        const sel2 = (row && String(row.memberId) === String(m.kennitala)) ? ' selected' : '';
        opts.push(`<option value="${esc(m.kennitala)}"${sel2}>${esc(m.name || m.kennitala)}</option>`);
      });
  }
  sel.innerHTML = opts.join('');

  document.getElementById('hbContactLabel').value     = row ? (row.label || '')     : '';
  document.getElementById('hbContactLabelIS').value   = row ? (row.labelIS || '')   : '';
  document.getElementById('hbContactName').value      = row ? (row.name || '')      : '';
  document.getElementById('hbContactPhone').value     = row ? (row.phone || '')     : '';
  document.getElementById('hbContactEmail').value     = row ? (row.email || '')     : '';
  document.getElementById('hbContactNotes').value     = row ? (row.notes || '')     : '';
  document.getElementById('hbContactNotesIS').value   = row ? (row.notesIS || '')   : '';
  document.getElementById('hbContactSort').value      = row ? (row.sortOrder || 0)  : 0;

  const usedEN = {}, usedIS = {};
  (_hbAdmin.contacts || []).forEach(c => {
    if (c.label) usedEN[c.label] = true;
    if (c.labelIS) usedIS[c.labelIS] = true;
  });
  document.getElementById('hbContactLabelList').innerHTML =
    Object.keys(usedEN).sort().map(l => `<option value="${esc(l)}">`).join('');
  document.getElementById('hbContactLabelListIS').innerHTML =
    Object.keys(usedIS).sort().map(l => `<option value="${esc(l)}">`).join('');

  // Surface the linked member's values as placeholders so the admin sees what
  // will render on the public page if they don't override.
  hbContactMemberPicked();

  document.getElementById('hbContactDeleteBtn').classList.toggle('hidden', !row);
  applyStrings(document.getElementById('hbContactModal'));
  openModal('hbContactModal');
}

function hbContactMemberPicked() {
  const kt = document.getElementById('hbContactMember').value;
  const m = (typeof members !== 'undefined' && Array.isArray(members))
    ? members.find(x => String(x.kennitala) === String(kt))
    : null;
  document.getElementById('hbContactName').placeholder  = m ? (m.name || '')  : '';
  document.getElementById('hbContactPhone').placeholder = m ? (m.phone || '') : '';
  document.getElementById('hbContactEmail').placeholder = m ? (m.email || '') : '';
}

async function saveHandbookContact() {
  const label   = document.getElementById('hbContactLabel').value.trim();
  const labelIS = document.getElementById('hbContactLabelIS').value.trim();
  if (!label && !labelIS) { toast(s('admin.handbookLabelRequired'), 'err'); return; }
  return _hbSave('saveHandbookContact', {
    id:        _hbAdmin.editingContactId || undefined,
    memberId:  document.getElementById('hbContactMember').value || '',
    label:     label,
    labelIS:   labelIS,
    name:      document.getElementById('hbContactName').value.trim(),
    phone:     document.getElementById('hbContactPhone').value.trim(),
    email:     document.getElementById('hbContactEmail').value.trim(),
    notes:     document.getElementById('hbContactNotes').value,
    notesIS:   document.getElementById('hbContactNotesIS').value,
    sortOrder: Number(document.getElementById('hbContactSort').value) || 0,
  }, 'contacts', 'hbContactModal', renderHandbookContactsAdmin);
}

async function deleteHandbookContact() {
  return _hbDelete('deleteHandbookContact', 'contacts', 'editingContactId',
    'hbContactModal', renderHandbookContactsAdmin);
}

// ── Roles (org chart) ───────────────────────────────────────────────────────

function renderHandbookRolesList() {
  const card = document.getElementById('hbAdminRolesCard');
  if (!card) return;
  if (!_hbAdmin.roles.length) {
    card.innerHTML = `<div class="empty-state">${s('admin.handbookEmptyRoles')}</div>`;
    return;
  }
  // Group by parent so the ↑/↓ arrows operate on siblings only. Top-level
  // roots first, then each root's children indented under it, recursively.
  const sortFn = (a, b) =>
    (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) ||
    String(_hbT(a, 'title')).localeCompare(_hbT(b, 'title'));
  const childrenByParent = {};
  _hbAdmin.roles.forEach(r => {
    const k = r.parentId || '';
    (childrenByParent[k] = childrenByParent[k] || []).push(r);
  });
  Object.keys(childrenByParent).forEach(k => childrenByParent[k].sort(sortFn));

  const renderRow = (r, isFirst, isLast, depth) => {
    const memberCount = Array.isArray(r.members) ? r.members.length : 0;
    const who = memberCount ? ` <span class="text-xs text-muted">(${memberCount})</span>` : '';
    const indent = depth ? ` style="padding-left:${depth * 16}px"` : '';
    const upDis   = isFirst ? ' disabled' : '';
    const downDis = isLast  ? ' disabled' : '';
    return `
      <div class="list-row"${indent}>
        <span class="list-name">${esc(_hbT(r, 'title'))}${who}</span>
        <button class="row-edit" data-admin-click="moveHbRole" data-admin-arg="${r.id}" data-admin-arg2="-1" title="${esc(s('admin.handbook.role.moveUp'))}" aria-label="${esc(s('admin.handbook.role.moveUp'))}"${upDis}>↑</button>
        <button class="row-edit" data-admin-click="moveHbRole" data-admin-arg="${r.id}" data-admin-arg2="1"  title="${esc(s('admin.handbook.role.moveDown'))}" aria-label="${esc(s('admin.handbook.role.moveDown'))}"${downDis}>↓</button>
        <button class="row-edit" data-admin-click="openHandbookRoleModal" data-admin-arg="${r.id}">${s('btn.edit')}</button>
      </div>`;
  };

  const renderGroup = (parentId, depth) => {
    const sibs = childrenByParent[parentId] || [];
    return sibs.map((r, i) => {
      const row = renderRow(r, i === 0, i === sibs.length - 1, depth);
      const sub = childrenByParent[r.id] ? renderGroup(r.id, depth + 1) : '';
      return row + sub;
    }).join('');
  };

  card.innerHTML = renderGroup('', 0);
}

// Swap a role with its previous (dir=-1) or next (dir=+1) sibling. Re-numbers
// the affected sibling group with stride-10 sortOrder values and POSTs only
// the rows whose value actually changed. The full sort is recomputed locally
// so the optimistic re-render matches the server result.
async function moveHbRole(id, dir) {
  const d = Number(dir);
  if (d !== -1 && d !== 1) return;
  const row = _hbAdmin.roles.find(r => r.id === id);
  if (!row) return;
  const parentId = row.parentId || '';
  const sortFn = (a, b) =>
    (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) ||
    String(_hbT(a, 'title')).localeCompare(_hbT(b, 'title'));
  const sibs = _hbAdmin.roles.filter(r => (r.parentId || '') === parentId).sort(sortFn);
  const i = sibs.findIndex(r => r.id === id);
  if (i < 0) return;
  const j = i + d;
  if (j < 0 || j >= sibs.length) return;

  const reordered = sibs.slice();
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];

  const items = [];
  reordered.forEach((r, idx) => {
    const next = (idx + 1) * 10;
    if (Number(r.sortOrder || 0) !== next) {
      r.sortOrder = next;
      items.push({ id: r.id, sortOrder: next });
    }
  });
  if (!items.length) return;
  renderHandbookRolesList(); // optimistic
  try {
    await apiPost('reorderHandbookRoles', { items: items });
  } catch (e) {
    toast(s('toast.saveFailed') + ': ' + e.message, 'err');
    await loadHandbookAdmin(true);
    renderHandbookRolesList();
  }
}

function openHandbookRoleModal(id) {
  _hbAdmin.editingRoleId = id || null;
  const row = id ? _hbAdmin.roles.find(x => x.id === id) : null;
  document.getElementById('hbRoleModalTitle').textContent = row
    ? s('admin.handbook.role.modalEdit')
    : s('admin.handbook.role.modalAdd');
  document.getElementById('hbRoleTitle').value   = row ? (row.title || '')   : '';
  document.getElementById('hbRoleTitleIS').value = row ? (row.titleIS || '') : '';
  document.getElementById('hbRoleNotes').value   = row ? (row.notes || '')   : '';
  document.getElementById('hbRoleNotesIS').value = row ? (row.notesIS || '') : '';
  document.getElementById('hbRoleColor').value   = (row && row.color) ? row.color : '#d4af37';
  // userSet flag distinguishes "admin picked this color" from "default
  // shown in the swatch but not chosen" so save can persist '' for default.
  document.getElementById('hbRoleColor').dataset.userSet = (row && row.color) ? '1' : '';
  document.getElementById('hbRoleSort').value    = row ? (row.sortOrder || 0): 0;

  // Title datalist — seeded sub-roles plus any titles already in use.
  const titlesEN = new Set(['Courses', 'Members', 'Social activities', 'Competition']);
  const titlesIS = new Set(['Námskeið', 'Iðkendur', 'Félagsstarf', 'Keppnisstarf']);
  _hbAdmin.roles.forEach(r => {
    if (r.title)   titlesEN.add(r.title);
    if (r.titleIS) titlesIS.add(r.titleIS);
  });
  document.getElementById('hbRoleTitleList').innerHTML =
    [...titlesEN].sort().map(t => `<option value="${esc(t)}">`).join('');
  document.getElementById('hbRoleTitleListIS').innerHTML =
    [...titlesIS].sort().map(t => `<option value="${esc(t)}">`).join('');

  // Members + areas: hydrated arrays from getHandbook, or JSON strings if a
  // previous save left them in local state, or the legacy single-kennitala
  // fallback so pre-multi-member rows edit cleanly.
  let rowMembers = row ? row.members : null;
  if (typeof rowMembers === 'string') {
    try { rowMembers = JSON.parse(rowMembers); } catch (e) { rowMembers = []; }
  }
  _hbRoleMembers = Array.isArray(rowMembers) && rowMembers.length
    ? rowMembers.map(m => ({
        kennitala:        m.kennitala || '',
        label:            m.label || '',
        labelIS:          m.labelIS || '',
        representsRoleId: m.representsRoleId || '',
        areaId:           m.areaId || '',
      }))
    : [];
  if (!_hbRoleMembers.length && row && (row.kennitala || row.name)) {
    _hbRoleMembers = [{ kennitala: row.kennitala || '', label: '', labelIS: '', representsRoleId: '', areaId: '' }];
  }

  let rowAreas = row ? row.areas : null;
  if (typeof rowAreas === 'string') {
    try { rowAreas = JSON.parse(rowAreas); } catch (e) { rowAreas = []; }
  }
  _hbRoleAreas = Array.isArray(rowAreas)
    ? rowAreas.map(a => ({
        id:      a.id || ('area_' + Math.random().toString(36).slice(2, 10)),
        label:   a.label || '',
        labelIS: a.labelIS || '',
      }))
    : [];

  renderHbRoleEditor();

  const catSel = document.getElementById('hbRoleBoatCat');
  const catOpts = ['<option value="">' + esc(s('admin.handbook.role.boatCatNone')) + '</option>'];
  if (typeof boatCats !== 'undefined' && Array.isArray(boatCats)) {
    boatCats.slice().sort((a, b) =>
      String(a.labelEN || a.key || '').localeCompare(String(b.labelEN || b.key || ''))
    ).forEach(c => {
      const sel2 = (row && row.boatCategoryKey === c.key) ? ' selected' : '';
      const lbl  = (getLang() === 'IS' ? (c.labelIS || c.labelEN) : (c.labelEN || c.labelIS)) || c.key;
      catOpts.push(`<option value="${esc(c.key)}"${sel2}>${esc((c.emoji || '') + ' ' + lbl).trim()}</option>`);
    });
  }
  catSel.innerHTML = catOpts.join('');

  // Exclude self from parent options to avoid loops.
  const sel = document.getElementById('hbRoleParent');
  const opts = ['<option value="">' + esc(s('admin.handbook.role.parentNone')) + '</option>'];
  _hbAdmin.roles
    .filter(r => !id || r.id !== id)
    .sort((a, b) => String(_hbT(a, 'title')).localeCompare(_hbT(b, 'title')))
    .forEach(r => {
      const sel2 = (row && row.parentId === r.id) ? ' selected' : '';
      opts.push(`<option value="${esc(r.id)}"${sel2}>${esc(_hbT(r, 'title'))}</option>`);
    });
  sel.innerHTML = opts.join('');

  document.getElementById('hbRoleDeleteBtn').classList.toggle('hidden', !row);
  applyStrings(document.getElementById('hbRoleModal'));
  openModal('hbRoleModal');
}

async function saveHandbookRole() {
  try {
    const title   = document.getElementById('hbRoleTitle').value.trim();
    const titleIS = document.getElementById('hbRoleTitleIS').value.trim();
    if (!title && !titleIS) { toast(s('admin.nameRequired') || 'Title required', 'err'); return; }
    const membersArr = _hbReadMembersFromDOM().filter(a => a.kennitala || a.label || a.labelIS);
    const areasArr   = _hbReadAreasFromDOM().filter(a => a.label || a.labelIS);
    return await _hbSave('saveHandbookRole', {
      id:              _hbAdmin.editingRoleId || undefined,
      parentId:        document.getElementById('hbRoleParent').value || '',
      title:           title,
      titleIS:         titleIS,
      notes:           document.getElementById('hbRoleNotes').value,
      notesIS:         document.getElementById('hbRoleNotesIS').value,
      color:           document.getElementById('hbRoleColor').dataset.userSet
                         ? document.getElementById('hbRoleColor').value : '',
      boatCategoryKey: document.getElementById('hbRoleBoatCat').value || '',
      members:         membersArr,
      areas:           areasArr,
      sortOrder:       Number(document.getElementById('hbRoleSort').value) || 0,
    }, 'roles', 'hbRoleModal', renderHandbookRolesList);
  } catch (e) {
    console.error('saveHandbookRole:', e);
    toast(s('toast.saveFailed') + ': ' + (e && e.message || e), 'err');
  }
}

async function deleteHandbookRole() {
  try {
    return await _hbDelete('deleteHandbookRole', 'roles', 'editingRoleId',
      'hbRoleModal', renderHandbookRolesList);
  } catch (e) {
    console.error('deleteHandbookRole:', e);
    toast(s('toast.error') + ': ' + (e && e.message || e), 'err');
  }
}

// ── Role editor (lead members + per-area sub-units) ─────────────────────────
//
// Level 1 (board):    flat member list with a "represents division" column.
// Level 2 (division): "Lead" section + one section per area in role.areas.
//                     Areas are editable inline (label EN/IS, add/remove).
//                     Each member's section determines their areaId.
// Level 3+ (legacy):  flat member list, no represents, no areas.
//
// Internal state kept flat: every member carries its own areaId. DOM rows
// live inside an ancestor with `data-area-id="..."` so reading from DOM
// preserves the membership.

let _hbRoleMembers = [];
let _hbRoleAreas   = [];

// Determine the depth of the role being edited (1 = root/board, 2 = under
// root/division, 3+ = under division). Reads the parent dropdown so this
// updates live as the admin changes the parent.
function _hbEditingLevel() {
  const sel = document.getElementById('hbRoleParent');
  const parentId = sel ? sel.value : '';
  if (!parentId) return 1;
  const parent = _hbAdmin.roles.find(r => r.id === parentId);
  if (!parent) return 1;
  return parent.parentId ? 3 : 2;
}

function _hbMemberOptions() {
  if (typeof members === 'undefined' || !Array.isArray(members)) return [];
  return members
    .filter(m => bool(m.active))
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .map(m => ({ kt: String(m.kennitala || ''), label: m.name || m.kennitala }));
}

// "Represents" only applies to board members (level 1) → represented = a
// division (level-2 role). Level 2 uses areaId; level 3+ has no equivalent.
function _hbRepresentsOptions() {
  if (_hbEditingLevel() !== 1) return [];
  const editingId = _hbAdmin.editingRoleId;
  const rootIds = new Set(_hbAdmin.roles.filter(r => !r.parentId).map(r => r.id));
  return _hbAdmin.roles
    .filter(r => r.id !== editingId && r.parentId && rootIds.has(r.parentId))
    .map(r => ({ id: r.id, label: _hbT(r, 'title') }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

function renderHbRoleEditor() {
  const root = document.getElementById('hbRoleEditor');
  if (!root) return;
  const level      = _hbEditingLevel();
  const memberOpts = _hbMemberOptions();
  const repOpts    = _hbRepresentsOptions();
  const showRep    = repOpts.length > 0;

  if (level === 2) {
    const leadHtml = _hbAreaSectionHtml('', s('admin.handbook.role.leadHdr'), null, memberOpts, false, repOpts);
    const areasHtml = _hbRoleAreas.map(a =>
      _hbAreaSectionHtml(a.id, '', a, memberOpts, true, repOpts)
    ).join('');
    root.innerHTML = `
      ${leadHtml}
      <fieldset class="hb-areas-fieldset">
        <legend>${esc(s('admin.handbook.role.areasHdr'))}</legend>
        <div class="text-xs text-muted mb-8">${esc(s('admin.handbook.role.areasHint'))}</div>
        <div id="hbRoleAreasList">${areasHtml}</div>
        <button type="button" class="btn btn-secondary btn-sm" data-admin-click="addHbRoleArea">${esc(s('admin.handbook.role.addArea'))}</button>
      </fieldset>`;
  } else {
    root.innerHTML = _hbAreaSectionHtml('', s('admin.handbook.role.membersHdr'), null, memberOpts, false, repOpts);
  }
  _hbApplyMemberSelectValues();
}

// One section: a fieldset containing a header + member rows + "Add person"
// button. Used for Lead (areaId=''), each area (editable header), and the
// flat editor at level 1/3+ (static header, no areas).
function _hbAreaSectionHtml(areaId, staticTitle, area, memberOpts, editableHeader, repOpts) {
  const showRep = !editableHeader && repOpts.length > 0; // only at level 1 (no areas)
  const rows = _hbRoleMembers
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => (m.areaId || '') === areaId);
  const rowsHtml = rows
    .map(({ m, i }) => _hbMemberRowHtml(m, i, memberOpts, repOpts, showRep))
    .join('') ||
    `<div class="empty-note text-xs">${esc(s('admin.handbook.role.noMembers'))}</div>`;
  const head = editableHeader
    ? `<div class="hb-area-head">
         <input type="text" data-area-field="label"   placeholder="${esc(s('admin.handbook.role.areaLabelPh'))}"   value="${esc(area.label || '')}">
         <input type="text" data-area-field="labelIS" placeholder="${esc(s('admin.handbook.role.areaLabelISPh'))}" value="${esc(area.labelIS || '')}">
         <button type="button" class="row-del" data-admin-click="removeHbRoleArea" data-admin-arg="${esc(area.id)}" aria-label="${esc(s('btn.delete'))}">×</button>
       </div>`
    : `<legend>${esc(staticTitle)}</legend>`;
  return `
    <fieldset class="hb-members-fieldset hb-area-block" data-area-id="${esc(areaId)}">
      ${head}
      <div class="hb-area-members">${rowsHtml}</div>
      <button type="button" class="btn btn-secondary btn-sm" data-admin-click="addHbRoleAreaMember" data-admin-arg="${esc(areaId)}">${esc(s('admin.handbook.role.addMember'))}</button>
    </fieldset>`;
}

function _hbMemberRowHtml(m, i, memberOpts, repOpts, showRep) {
  const ktOpts = memberOpts.map(o =>
    `<option value="${esc(o.kt)}">${esc(o.label)}</option>`
  ).join('');
  const rowCls = 'hb-member-row' + (showRep ? '' : ' hb-member-row--no-rep');
  return `
    <div class="${rowCls}" data-row-idx="${i}">
      <select data-field="kennitala">
        <option value="">${esc(s('admin.handbook.role.kennitalaNone'))}</option>
        ${ktOpts}
      </select>
      <input type="text" data-field="label"
             placeholder="${esc(s('admin.handbook.role.memberLabelPh'))}" value="${esc(m.label || '')}">
      <input type="text" data-field="labelIS"
             placeholder="${esc(s('admin.handbook.role.memberLabelISPh'))}" value="${esc(m.labelIS || '')}">
      ${showRep ? _hbRepresentsCellHtml(repOpts) : ''}
      <button type="button" class="row-del" data-admin-click="removeHbRoleMember" data-admin-arg="${i}" aria-label="${esc(s('btn.delete'))}">×</button>
    </div>`;
}

function _hbRepresentsCellHtml(repOpts) {
  const opts = repOpts.map(o =>
    `<option value="${esc(o.id)}">${esc(o.label)}</option>`
  ).join('');
  return `<select data-field="representsRoleId">
    <option value="">${esc(s('admin.handbook.role.representsNone'))}</option>
    ${opts}
  </select>`;
}

// Set each select's value explicitly after render. Same pattern as
// openHandbookContactModal — relying on inline `selected` inside a parent
// innerHTML can leave the dropdown showing the first concrete option.
function _hbApplyMemberSelectValues() {
  document.querySelectorAll('#hbRoleEditor .hb-member-row').forEach(row => {
    const idx = Number(row.dataset.rowIdx);
    const m = _hbRoleMembers[idx];
    if (!m) return;
    row.querySelector('[data-field="kennitala"]').value = m.kennitala || '';
    const repEl = row.querySelector('[data-field="representsRoleId"]');
    if (repEl) repEl.value = m.representsRoleId || '';
  });
}

// Re-render the editor when the parent dropdown changes: the level (and
// therefore the editor layout) depends on which parent the admin picked.
function hbRoleParentChanged() {
  _hbRoleMembers = _hbReadMembersFromDOM();
  _hbRoleAreas   = _hbReadAreasFromDOM();
  renderHbRoleEditor();
}

function addHbRoleAreaMember(areaId) {
  _hbRoleMembers = _hbReadMembersFromDOM();
  _hbRoleAreas   = _hbReadAreasFromDOM();
  _hbRoleMembers.push({ kennitala: '', label: '', labelIS: '', representsRoleId: '', areaId: areaId || '' });
  renderHbRoleEditor();
}

function removeHbRoleMember(idx) {
  _hbRoleMembers = _hbReadMembersFromDOM();
  _hbRoleAreas   = _hbReadAreasFromDOM();
  _hbRoleMembers.splice(Number(idx), 1);
  renderHbRoleEditor();
}

function addHbRoleArea() {
  _hbRoleMembers = _hbReadMembersFromDOM();
  _hbRoleAreas   = _hbReadAreasFromDOM();
  _hbRoleAreas.push({
    id: 'area_' + Math.random().toString(36).slice(2, 10),
    label: '',
    labelIS: '',
  });
  renderHbRoleEditor();
}

function removeHbRoleArea(areaId) {
  _hbRoleMembers = _hbReadMembersFromDOM();
  _hbRoleAreas   = _hbReadAreasFromDOM();
  // Move members from the removed area back to "Lead" (areaId='') so they
  // aren't silently dropped if the admin re-creates the area later.
  _hbRoleMembers.forEach(m => { if (m.areaId === areaId) m.areaId = ''; });
  _hbRoleAreas = _hbRoleAreas.filter(a => a.id !== areaId);
  renderHbRoleEditor();
}

function _hbReadMembersFromDOM() {
  const rows = Array.from(document.querySelectorAll('#hbRoleEditor .hb-member-row'));
  // Sort by data-row-idx (assigned at render time) so the returned order
  // matches the original _hbRoleMembers order. DOM order is lead-first then
  // area-by-area, which differs from the flat array — without this sort a
  // splice-by-index after read would target the wrong member.
  rows.sort((a, b) => Number(a.dataset.rowIdx || 0) - Number(b.dataset.rowIdx || 0));
  return rows.map(row => {
    const block = row.closest('[data-area-id]');
    const areaId = block ? block.dataset.areaId : '';
    const repEl = row.querySelector('[data-field="representsRoleId"]');
    return {
      kennitala:        row.querySelector('[data-field="kennitala"]').value.trim(),
      label:            row.querySelector('[data-field="label"]').value.trim(),
      labelIS:          row.querySelector('[data-field="labelIS"]').value.trim(),
      representsRoleId: repEl ? repEl.value : '',
      areaId:           areaId || '',
    };
  });
}

function _hbReadAreasFromDOM() {
  return Array.from(document.querySelectorAll('#hbRoleAreasList .hb-area-block')).map(block => ({
    id:      block.dataset.areaId || ('area_' + Math.random().toString(36).slice(2, 10)),
    label:   (block.querySelector('[data-area-field="label"]')   || { value: '' }).value.trim(),
    labelIS: (block.querySelector('[data-area-field="labelIS"]') || { value: '' }).value.trim(),
  }));
}

function hbRoleColorPicked() {
  document.getElementById('hbRoleColor').dataset.userSet = '1';
}

function clearHandbookRoleColor() {
  // Empty userSet flag tells save to persist '' so the read-side falls back
  // to the boat-category color (or --brass if none).
  const el = document.getElementById('hbRoleColor');
  el.value = '#d4af37';
  el.dataset.userSet = '';
}

// ── Documents ───────────────────────────────────────────────────────────────

function renderHandbookDocsList() {
  const card = document.getElementById('hbAdminDocsCard');
  if (!card) return;
  if (!_hbAdmin.docs.length) {
    card.innerHTML = `<div class="empty-state">${s('admin.handbookEmptyDocs')}</div>`;
    return;
  }
  card.innerHTML = _hbAdmin.docs.slice().sort(_hbBySort).map(d => {
    const cat = _hbT(d, 'category');
    const catSpan = cat ? `<span class="text-xs text-muted"> · ${esc(cat)}</span>` : '';
    const icon = d.driveFileId ? '📄' : '🔗';
    return `
      <div class="list-row">
        <span class="list-name">${icon} ${esc(_hbT(d, 'title'))}${catSpan}</span>
        <button class="row-edit" data-admin-click="openHandbookDocModal" data-admin-arg="${d.id}">${s('btn.edit')}</button>
      </div>`;
  }).join('');
}

function openHandbookDocModal(id) {
  _hbAdmin.editingDocId = id || null;
  const row = id ? _hbAdmin.docs.find(x => x.id === id) : null;
  document.getElementById('hbDocModalTitle').textContent = row
    ? s('admin.handbook.doc.modalEdit')
    : s('admin.handbook.doc.modalAdd');
  document.getElementById('hbDocTitle').value      = row ? (row.title || '')       : '';
  document.getElementById('hbDocTitleIS').value    = row ? (row.titleIS || '')     : '';
  document.getElementById('hbDocCat').value        = row ? (row.category || '')    : '';
  document.getElementById('hbDocCatIS').value      = row ? (row.categoryIS || '')  : '';
  document.getElementById('hbDocUrl').value        = row ? (row.url || '')         : '';
  document.getElementById('hbDocDriveFileId').value= row ? (row.driveFileId || '') : '';
  document.getElementById('hbDocNotes').value      = row ? (row.notes || '')       : '';
  document.getElementById('hbDocNotesIS').value    = row ? (row.notesIS || '')     : '';
  document.getElementById('hbDocSort').value       = row ? (row.sortOrder || 0)    : 0;
  document.getElementById('hbDocFile').value       = '';
  document.getElementById('hbDocUploadStatus').textContent = '';

  const seen = {};
  const cats = [];
  _hbAdmin.docs.forEach(d => {
    if (d.category && !seen[d.category]) { seen[d.category] = true; cats.push(d.category); }
  });
  document.getElementById('hbDocCatList').innerHTML = cats
    .sort()
    .map(c => `<option value="${esc(c)}">`).join('');

  document.getElementById('hbDocDeleteBtn').classList.toggle('hidden', !row);
  applyStrings(document.getElementById('hbDocModal'));
  openModal('hbDocModal');
}

async function handleHandbookDocUpload(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const status = document.getElementById('hbDocUploadStatus');
  status.textContent = s('admin.handbook.doc.uploading');
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(file);
    });
    const res = await apiPost('uploadHandbookDoc', {
      fileData: dataUrl,
      fileName: file.name,
      mimeType: file.type,
    });
    if (!res.ok) throw new Error(res.error || 'upload failed');
    document.getElementById('hbDocUrl').value = res.url || '';
    document.getElementById('hbDocDriveFileId').value = res.driveFileId || '';
    if (!document.getElementById('hbDocTitle').value.trim()) {
      document.getElementById('hbDocTitle').value = file.name.replace(/\.[^.]+$/, '');
    }
    status.textContent = s('admin.handbook.doc.uploaded');
  } catch (e) {
    status.textContent = s('toast.error') + ': ' + e.message;
  }
}

async function saveHandbookDoc() {
  const title = document.getElementById('hbDocTitle').value.trim();
  const url   = document.getElementById('hbDocUrl').value.trim();
  if (!title) { toast(s('admin.nameRequired') || 'Title required', 'err'); return; }
  if (!url)   { toast('URL required', 'err'); return; }
  return _hbSave('saveHandbookDoc', {
    id:          _hbAdmin.editingDocId || undefined,
    title:       title,
    titleIS:     document.getElementById('hbDocTitleIS').value.trim(),
    category:    document.getElementById('hbDocCat').value.trim(),
    categoryIS:  document.getElementById('hbDocCatIS').value.trim(),
    url:         url,
    driveFileId: document.getElementById('hbDocDriveFileId').value.trim(),
    notes:       document.getElementById('hbDocNotes').value,
    notesIS:     document.getElementById('hbDocNotesIS').value,
    sortOrder:   Number(document.getElementById('hbDocSort').value) || 0,
  }, 'docs', 'hbDocModal', renderHandbookDocsList);
}

async function deleteHandbookDoc() {
  return _hbDelete('deleteHandbookDoc', 'docs', 'editingDocId',
    'hbDocModal', renderHandbookDocsList);
}
