// ═══════════════════════════════════════════════════════════════════════════════
// admin/members.js — Member management (list, modal, password reset, import)
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Filters ─────────────────────────────────────────────────────────────────
// Chip filters narrow the list before the search box does. Counts on each chip
// are recomputed on every render so they stay honest after edits.
var _memberFilter   = 'all';
var _selectedMember = null;
var _CERT_WARN_DAYS = 60;

var _MEMBER_FILTERS = [
  { key: 'all',      label: 'admin.mem.fAll',      test: function ()  { return true; } },
  { key: 'active',   label: 'admin.mem.fActive',   test: function (m) { return bool(m.active); } },
  { key: 'staff',    label: 'admin.mem.fStaff',    test: function (m) { return bool(m.active) && (m.role === 'staff' || m.role === 'admin'); } },
  { key: 'youth',    label: 'admin.mem.fYouth',    test: function (m) { return bool(m.active) && _memberIsMinor(m); } },
  { key: 'certs',    label: 'admin.mem.fCerts',    test: function (m) { return bool(m.active) && !!_memberCertStatus(m); } },
  { key: 'inactive', label: 'admin.mem.fInactive', test: function (m) { return !bool(m.active); } },
];

// isMinor is computed server-side from birthYear; guardian presence is the
// fallback for rows that carry a guardian but no birth year.
function _memberIsMinor(m) {
  return !!m.isMinor || !!String(m.guardianKennitala || '').trim();
}

// Certifications arrive as an array from Supabase (a JSON string in the
// legacy Sheets shape) — accept both.
function _memberCerts(m) {
  return typeof m.certifications === 'string' ? parseJson(m.certifications, []) : (m.certifications || []);
}

// '' | 'expiring' | 'expired' — the worst state across the member's credentials.
function _memberCertStatus(m) {
  var certs = _memberCerts(m);
  if (!certs.length) return '';
  var today = todayISO();
  var soon = new Date(); soon.setDate(soon.getDate() + _CERT_WARN_DAYS);
  var soonISO = soon.toISOString().slice(0, 10);
  var worst = '';
  certs.forEach(function (c) {
    if (!c.expiresAt) return;
    if (c.expiresAt < today) worst = 'expired';
    else if (c.expiresAt <= soonISO && worst !== 'expired') worst = 'expiring';
  });
  return worst;
}

function _memberInitials(m) {
  if (m.initials) return String(m.initials).slice(0, 3).toUpperCase();
  var parts = String(m.name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function _memberRoleLabel(role) {
  if (role === 'admin') return s('admin.mem.roleAdmin');
  if (role === 'staff') return s('admin.mem.roleStaff');
  if (role === 'guardian') return s('lbl.guardian');
  return s('lbl.member');
}

function setMemberFilter(key) {
  _memberFilter = key;
  renderMembers();
}

function renderMemberChips() {
  var box = document.getElementById('memberChips');
  if (!box) return;
  box.innerHTML = _MEMBER_FILTERS.map(function (f) {
    var n = members.filter(f.test).length;
    var on = f.key === _memberFilter;
    return '<button type="button" class="day-pill' + (on ? ' on' : '') + '" aria-pressed="' + on + '"' +
      ' data-admin-click="setMemberFilter" data-admin-arg="' + f.key + '">' +
      esc(s(f.label)) + ' <span class="mem-chip-n">' + n + '</span></button>';
  }).join('');
}

function _filteredMembers() {
  var f = _MEMBER_FILTERS.find(function (x) { return x.key === _memberFilter; }) || _MEMBER_FILTERS[0];
  var q = (document.getElementById('memberSearch').value || '').toLowerCase().trim();
  // Kennitala is stored as 10 raw digits; strip a pasted display hyphen
  // ("010190-1234") for the kennitala side of the match.
  var qDigits = q.replace(/\D/g, '');
  return members.filter(function (m) {
    if (!f.test(m)) return false;
    if (!q) return true;
    return String(m.name || '').toLowerCase().includes(q) ||
           (qDigits && String(m.kennitala || '').includes(qDigits)) ||
           String(m.email || '').toLowerCase().includes(q);
  });
}

function filterMembers() { renderMembers(); }

function renderMembers() {
  renderMemberChips();
  var list = _filteredMembers();
  document.getElementById('memberCountLabel').textContent = list.length;
  renderMemberList(list);
  // Drop a selection that no longer exists in the members array.
  if (_selectedMember && !members.some(function (m) { return m.id === _selectedMember; })) _selectedMember = null;
  renderMemberDetail();
}

var _memberListData = [];
var _memberDupNames = null;
var _memberRendered = 0;
var _memberObserver = null;
var _MEMBER_BATCH = 50;

function renderMemberList(list) {
  const card = document.getElementById("membersCard");
  if (!list.length) { card.innerHTML = `<div class="empty-state">${s('admin.noMembers')}</div>`; return; }
  // Re-sort at render time, not just once on load: saveMember/confirmImport
  // append new/updated rows to the end of the members array.
  const _mLocale = getLang() === 'IS' ? 'is' : 'en';
  list = list.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', _mLocale, { sensitivity: 'base' }));
  _memberListData = list;
  _memberDupNames = duplicateMemberNames(list);
  _memberRendered = 0;
  card.innerHTML = '';
  _renderMemberBatch(card);
  _setupMemberScrollObserver(card);
}

function _renderMemberBatch(card) {
  var end = Math.min(_memberRendered + _MEMBER_BATCH, _memberListData.length);
  var frag = document.createDocumentFragment();
  for (var i = _memberRendered; i < end; i++) {
    var m = _memberListData[i];
    var name = (_memberDupNames && _memberDupNames.has(m.name) && m.birthYear) ? (m.name + ' (' + m.birthYear + ')') : (m.name || '—');
    var cert = _memberCertStatus(m);
    var flag = cert === 'expired'  ? `<span class="badge badge-red">${esc(s('admin.mem.certExpired'))}</span>`
             : cert === 'expiring' ? `<span class="badge badge-yellow">${esc(s('admin.mem.certExpiring'))}</span>`
             : '';
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'mem-row' + (m.id === _selectedMember ? ' selected' : '') + (bool(m.active) ? '' : ' mem-row--inactive');
    row.dataset.adminClick = 'selectMember';
    row.dataset.adminArg = m.id;
    if (m.id === _selectedMember) row.setAttribute('aria-current', 'true');
    row.innerHTML =
      `<span class="mem-avatar" aria-hidden="true">${esc(_memberInitials(m))}</span>` +
      `<span class="mem-row-main"><span class="mem-row-name">${esc(name)}</span>` +
      `<span class="mem-row-sub">${esc(_memberRoleLabel(m.role))}${_memberIsMinor(m) ? ' · ' + esc(s('admin.mem.minor')) : ''}${bool(m.active) ? '' : ' · ' + esc(s('lbl.inactive'))}</span></span>` +
      flag;
    frag.appendChild(row);
  }
  var oldSentinel = card.querySelector('.member-scroll-sentinel');
  if (oldSentinel) oldSentinel.remove();
  card.appendChild(frag);
  _memberRendered = end;
  if (_memberRendered < _memberListData.length) {
    var sentinel = document.createElement('div');
    sentinel.className = 'member-scroll-sentinel';
    sentinel.style.height = '1px';
    card.appendChild(sentinel);
    // The observer only watches the exact node passed to observe(); the old
    // sentinel was just removed, so re-observe or the list stops at 2 batches.
    if (_memberObserver) _memberObserver.observe(sentinel);
  }
}

// ── Detail pane ─────────────────────────────────────────────────────────────
function selectMember(id) {
  _selectedMember = id || null;
  document.querySelectorAll('#membersCard .mem-row').forEach(function (r) {
    var on = r.dataset.adminArg === _selectedMember;
    r.classList.toggle('selected', on);
    if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
  });
  renderMemberDetail();
  // Narrow screens show one pane at a time — bring the detail into view.
  if (_selectedMember && window.matchMedia('(max-width: 899px)').matches) {
    var d = document.getElementById('memberDetail');
    if (d) { d.scrollIntoView({ block: 'start' }); var h = d.querySelector('h2'); if (h) h.focus({ preventScroll: true }); }
  }
}

function closeMemberDetail() {
  var id = _selectedMember;
  selectMember(null);
  var row = id && document.querySelector('#membersCard .mem-row[data-admin-arg="' + CSS.escape(id) + '"]');
  if (row) row.focus();
}

function _detailRow(label, valueHtml) {
  return `<div class="mem-dl-row"><dt>${esc(label)}</dt><dd>${valueHtml || '<span class="text-muted">—</span>'}</dd></div>`;
}

function renderMemberDetail() {
  var split = document.getElementById('memberSplit');
  var box = document.getElementById('memberDetail');
  if (!box) return;
  var m = _selectedMember ? members.find(function (x) { return x.id === _selectedMember; }) : null;
  if (split) split.classList.toggle('has-detail', !!m);
  if (!m) {
    box.innerHTML = `<div class="mem-detail-empty">${esc(s('admin.mem.selectPrompt'))}</div>`;
    return;
  }
  var id = esc(m.id);
  var chips = [`<span class="badge badge-accent">${esc(_memberRoleLabel(m.role))}</span>`];
  if (!bool(m.active)) chips.push(`<span class="badge badge-muted">${esc(s('admin.mem.fInactive'))}</span>`);
  if (_memberIsMinor(m)) chips.push(`<span class="badge badge-yellow">${esc(s('admin.mem.minor'))}</span>`);

  var certs = enrichMemberCerts(_memberCerts(m), certDefs, certCategories);
  var certHtml = certs.length
    ? `<div class="mem-cert-list">${certs.map(certBadgeHTML).join('')}</div>`
    : `<div class="text-sm text-muted">${esc(s('admin.mem.noCerts'))}</div>`;

  var email = m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : '';
  var phone = m.phone ? `<a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>` : '';
  var hasGuardian = m.guardianName || m.guardianKennitala || m.guardianPhone;

  box.innerHTML =
    `<button type="button" class="btn-ghost mem-detail-back" data-admin-click="closeMemberDetail">← ${esc(s('admin.mem.backToList'))}</button>` +
    `<div class="mem-detail-head">` +
      `<span class="mem-avatar mem-avatar--lg" aria-hidden="true">${esc(_memberInitials(m))}</span>` +
      `<div class="mem-detail-id"><h2 class="mem-detail-name" tabindex="-1">${esc(m.name || '—')}</h2>` +
      `<div class="text-sm text-muted">${esc(m.kennitala || '')}</div></div>` +
      `<div class="mem-detail-actions">` +
        `<button type="button" class="btn btn-secondary" data-admin-click="openMemberCertModal" data-admin-arg="${id}">${esc(s('admin.manageCreds'))}</button>` +
        `<button type="button" class="btn btn-primary" data-admin-click="openMemberModal" data-admin-arg="${id}">${esc(s('btn.edit'))}</button>` +
      `</div>` +
    `</div>` +
    `<div class="mem-tags">${chips.join('')}</div>` +
    `<div class="mem-cards">` +
      `<section class="card card--sm card--surface"><h3 class="section-label">${esc(s('admin.mem.contact'))}</h3><dl>` +
        _detailRow(s('lbl.email'), email) +
        _detailRow(s('lbl.phone'), phone) +
        _detailRow(s('admin.mem.birthYear'), esc(m.birthYear || '')) +
        _detailRow(s('admin.initials'), esc(m.initials || '')) +
      `</dl></section>` +
      `<section class="card card--sm card--surface"><h3 class="section-label">${esc(s('admin.mem.account'))}</h3><dl>` +
        _detailRow(s('lbl.role'), esc(_memberRoleLabel(m.role))) +
        _detailRow(s('admin.password'), esc(m.hasPassword ? s('admin.hasCustomPassword') : s('admin.usingDefaultPassword'))) +
      `</dl>` +
        `<button type="button" class="btn btn-ghost mt-8" data-admin-click="resetMemberPasswordFor" data-admin-arg="${id}">${esc(s('admin.resetPassword'))}</button>` +
      `</section>` +
      `<section class="card card--sm card--surface mem-card--wide"><div class="mem-card-head"><h3 class="section-label">${esc(s('admin.tabCerts'))}</h3>` +
        `<button type="button" class="btn-ghost" data-admin-click="openMemberCertModal" data-admin-arg="${id}">${esc(s('admin.mem.manage'))}</button></div>` +
        certHtml +
      `</section>` +
      (hasGuardian
        ? `<section class="card card--sm card--surface"><h3 class="section-label">${esc(s('lbl.guardian'))}</h3><dl>` +
            _detailRow(s('lbl.name'), esc(m.guardianName || '')) +
            _detailRow(s('admin.kennitala'), esc(m.guardianKennitala || '')) +
            _detailRow(s('lbl.phone'), m.guardianPhone ? `<a href="tel:${esc(m.guardianPhone)}">${esc(m.guardianPhone)}</a>` : '') +
          `</dl></section>`
        : '') +
    `</div>`;
}

// Reset from the detail pane reuses the modal's reset flow, which keys off
// editingId and updates the (hidden) modal's status line.
async function resetMemberPasswordFor(id) {
  editingId = id;
  await resetMemberPassword();
  renderMemberDetail();
}

// Credential edits made in the shared member-cert modal refresh list + detail.
window.mcmOnUpdate = function () { renderMembers(); };

function _setupMemberScrollObserver(card) {
  if (_memberObserver) _memberObserver.disconnect();
  if (!('IntersectionObserver' in window)) return;
  _memberObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && _memberRendered < _memberListData.length) {
      _renderMemberBatch(card);
    }
  }, { rootMargin: '200px' });
  var sentinel = card.querySelector('.member-scroll-sentinel');
  if (sentinel) _memberObserver.observe(sentinel);
}

function openMemberModal(id) {
  editingId = id || null;
  const m   = id ? members.find(x => x.id === id) : null;
  document.getElementById("memberModalTitle").textContent = m ? s('admin.memberModal.edit') : s('admin.memberModal.add');
  document.getElementById("mName").value           = m ? (m.name         || "") : "";
  document.getElementById("mKennitala").value      = m ? (m.kennitala    || "") : "";
  document.getElementById("mEmail").value          = m ? (m.email        || "") : "";
  document.getElementById("mPhone").value          = m ? (m.phone        || "") : "";
  document.getElementById("mInitials").value       = m ? (m.initials     || "") : "";
  // mDob is a date picker but the backend only stores a birth YEAR
  // (isMinor is computed from it, day/month were never stored) — show
  // Jan 1 of that year so editing an existing member doesn't discard it.
  document.getElementById("mDob").value            = m && m.birthYear ? (m.birthYear + "-01-01") : "";
  document.getElementById("mRole").value           = m ? (m.role         || "member") : "member";
  document.getElementById("mGuardianName").value   = m ? (m.guardianName  || "") : "";
  document.getElementById("mGuardianKt").value     = m ? (m.guardianKennitala || "") : "";
  document.getElementById("mGuardianPhone").value  = m ? (m.guardianPhone || "") : "";
  document.getElementById("mActive").checked       = m ? bool(m.active)  : true;
  document.getElementById("mDeleteBtn").classList.toggle("hidden", !m);
  // Show a compact password status + reset button for existing members.
  var pwBox = document.getElementById("mPwBox");
  if (m) {
    pwBox.classList.remove("hidden");
    var status = document.getElementById("mPwStatus");
    if (m.hasPassword) {
      status.textContent = s('admin.hasCustomPassword');
      status.style.color = 'var(--muted)';
    } else {
      status.textContent = s('admin.usingDefaultPassword');
      status.style.color = 'var(--accent)';
    }
    // Always enabled: re-issuing is exactly what's needed for a member
    // still stuck on their original temp password (lost, never picked up,
    // or the "issued" dialog got closed before anyone copied it down) —
    // not just for replacing an already-set custom password.
    document.getElementById("mResetPwBtn").disabled = false;
  } else {
    pwBox.classList.add("hidden");
  }
  openModal("memberModal");
}

async function resetMemberPassword() {
  if (!editingId) return;
  var m = members.find(function(x) { return x.id === editingId; });
  if (!m) return;
  var name = m.name || m.kennitala;
  if (!(await ymConfirm(s('admin.resetPasswordConfirm').replace('{name}', name)))) return;
  var btn = document.getElementById('mResetPwBtn');
  btn.disabled = true;
  try {
    var res = await callSupabaseRpc('admin_reset_member_password', { p_kennitala: m.kennitala });
    _invalidateApiCache('getMembers');
    _invalidateApiCache('listSessions');
    m.hasPassword = false;
    var status = document.getElementById('mPwStatus');
    status.textContent = s('admin.usingDefaultPassword');
    status.style.color = 'var(--accent)';
    var n = (res && typeof res.sessionsRevoked === 'number') ? res.sessionsRevoked : 0;
    toast(s('admin.resetPasswordDone').replace('{n}', n), 'ok');
    if (res && res.tempPassword) {
      showTempPasswordDialog([{ name: name, kennitala: m.kennitala, tempPassword: res.tempPassword }]);
    }
  } catch (e) {
    toast(s('toast.error') + ': ' + e.message, 'err');
    btn.disabled = false;
  }
}

// Show a modal listing one or more admin-issued temp passwords with copy
// buttons. Called after saveMember/adminResetMemberPassword/importMembers
// whenever the backend returns plaintext temp credentials. The modal must
// stay open long enough for the admin to record the value — the server
// never retains it.
function showTempPasswordDialog(items) {
  if (!items || !items.length) return;
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '300';
  var box = document.createElement('div');
  box.className = 'modal';
  box.style.maxWidth = '480px';
  var heading = document.createElement('h3');
  heading.style.margin = '0 0 8px';
  heading.textContent = items.length === 1 ? s('admin.tempPasswordTitle') : s('admin.tempPasswordTitlePlural');
  var warn = document.createElement('p');
  warn.style.cssText = 'color:var(--muted);margin:0 0 14px;font-size:13px';
  warn.textContent = s('admin.tempPasswordWarning');
  box.appendChild(heading);
  box.appendChild(warn);
  items.forEach(function(it) {
    var row = document.createElement('div');
    row.style.cssText = 'margin-bottom:10px;padding:8px;border:1px solid var(--border);border-radius:6px';
    var label = document.createElement('div');
    label.style.cssText = 'font-size:12px;color:var(--muted)';
    label.textContent = (it.name || '') + (it.kennitala ? ' · ' + it.kennitala : '');
    var pwRow = document.createElement('div');
    pwRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:4px';
    var code = document.createElement('code');
    code.style.cssText = 'flex:1;font-size:16px;font-family:monospace;padding:4px 8px;background:var(--faint);border-radius:4px;user-select:all';
    code.textContent = it.tempPassword;
    var btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.textContent = s('admin.tempPasswordCopy');
    btn.onclick = function() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(it.tempPassword).then(function() {
          toast(s('admin.tempPasswordCopied'), 'ok');
        });
      }
    };
    pwRow.appendChild(code);
    pwRow.appendChild(btn);
    row.appendChild(label);
    row.appendChild(pwRow);
    box.appendChild(row);
  });
  var btnRow = document.createElement('div');
  btnRow.className = 'ym-dialog-btns';
  btnRow.style.marginTop = '14px';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-primary';
  closeBtn.textContent = s('btn.close');
  closeBtn.onclick = function() { overlay.remove(); };
  btnRow.appendChild(closeBtn);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function saveMember() {
  const name      = document.getElementById("mName").value.trim();
  const kennitala = document.getElementById("mKennitala").value.trim();
  if (!name || !kennitala) { toast(s("admin.nameKtRequired"), "err"); return; }

  const dobVal = document.getElementById("mDob").value;
  const payload = {
    name, kennitala,
    email:               document.getElementById("mEmail").value.trim(),
    phone:               document.getElementById("mPhone").value.trim(),
    initials:            document.getElementById("mInitials").value.trim().toUpperCase(),
    birthYear:           dobVal ? new Date(dobVal).getFullYear() : null,
    role:                document.getElementById("mRole").value,
    guardianName:        document.getElementById("mGuardianName").value.trim(),
    guardianKennitala:   document.getElementById("mGuardianKt").value.trim(),
    guardianPhone:       document.getElementById("mGuardianPhone").value.trim(),
    active:              document.getElementById("mActive").checked,
  };

  try {
    const res = await callSupabaseRpc("save_member", {
      p_id: editingId, p_kennitala: payload.kennitala, p_name: payload.name,
      p_role: payload.role, p_email: payload.email, p_phone: payload.phone,
      p_birth_year: payload.birthYear, p_guardian_name: payload.guardianName,
      p_guardian_kennitala: payload.guardianKennitala, p_guardian_phone: payload.guardianPhone,
      p_active: payload.active, p_initials: payload.initials || null,
    });
    _invalidateApiCache("getMembers");
    const id  = editingId || res.id;
    const idx = members.findIndex(x => x.id === id);
    if (idx >= 0) members[idx] = { ...members[idx], ...payload, id };
    else          members.push({ ...payload, id });
    closeModal("memberModal", true);
    renderMembers();
    toast(s("toast.saved"));
    const temps = [];
    if (res && res.tempPassword) temps.push({ name: name, kennitala: kennitala, tempPassword: res.tempPassword });
    if (res && res.guardianTempPassword) temps.push(res.guardianTempPassword);
    if (temps.length) showTempPasswordDialog(temps);
  } catch(e) { toast(s("toast.saveFailed") + ": " + e.message, "err"); }
}

async function deactivateMember(id) {
  if (!await ymConfirm(s("admin.confirmDeactivateMember"))) return;
  try {
    await callPostgrestTable("members", {
      method: "PATCH", query: "?id=eq." + encodeURIComponent(id), body: { active: false },
    });
    _invalidateApiCache("getMembers");
    // Mark inactive rather than removing from the local array — the list
    // now shows all members, so a deactivated one should stay visible
    // (greyed out) instead of vanishing.
    const m = members.find(x => x.id === id);
    if (m) m.active = false;
    renderMembers();
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}
async function deleteMember() { await deactivateMember(editingId); closeModal("memberModal", true); }

// ══ BOAT CATEGORIES ══════════════════════════════════════════════════════════

