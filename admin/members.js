// ═══════════════════════════════════════════════════════════════════════════════
// admin/members.js — Member management (list, modal, password reset, import)
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

function filterMembers() {
  const q = document.getElementById("memberSearch").value.toLowerCase();
  const active = members.filter(m => bool(m.active) &&
    (String(m.name||"").toLowerCase().includes(q) || String(m.kennitala||"").includes(q)));
  renderMemberList(active);
}

function renderMembers() {
  const active = members.filter(m => bool(m.active));
  document.getElementById("memberCountLabel").textContent = `(${active.length})`;
  renderMemberList(active);
}

var _memberListData = [];
var _memberDupNames = null;
var _memberRendered = 0;
var _memberObserver = null;
var _MEMBER_BATCH = 50;

function renderMemberList(list) {
  const card = document.getElementById("membersCard");
  if (!list.length) { card.innerHTML = `<div class="empty-state">${s('admin.noMembers')}</div>`; return; }
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
    var row = document.createElement('div');
    row.className = 'member-row';
    row.innerHTML =
      `<span class="member-name">${esc((_memberDupNames && _memberDupNames.has(m.name) && m.birthYear) ? (m.name + ' (' + m.birthYear + ')') : (m.name || "—"))}</span>` +
      `<span class="member-kt">${esc(m.kennitala || "")}</span>` +
      `<button class="row-edit" data-admin-click="openMemberModal" data-admin-arg="${m.id}">Edit</button>` +
      `<button class="row-edit" data-admin-click="openMemberCertModal" data-admin-arg="${m.id}" style="font-size:10px">${s('admin.manageCreds')}</button>`;
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
  }
}

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
  document.getElementById("mDob").value            = m ? (m.dob          || "") : "";
  document.getElementById("mRole").value           = m ? (m.role         || "member") : "member";
  document.getElementById("mGuardianName").value   = m ? (m.guardianName  || "") : "";
  document.getElementById("mGuardianKt").value     = m ? (m.guardianKt   || "") : "";
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
      status.style.color = 'var(--brass)';
    }
    document.getElementById("mResetPwBtn").disabled = !m.hasPassword;
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
    var res = await apiPost('adminResetMemberPassword', { kennitala: m.kennitala });
    m.hasPassword = false;
    var status = document.getElementById('mPwStatus');
    status.textContent = s('admin.usingDefaultPassword');
    status.style.color = 'var(--brass)';
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

  const id      = editingId || ("mbr_" + Date.now().toString(36));
  const payload = {
    id, name, kennitala,
    email:          document.getElementById("mEmail").value.trim(),
    phone:          document.getElementById("mPhone").value.trim(),
    initials:       document.getElementById("mInitials").value.trim().toUpperCase(),
    dob:            document.getElementById("mDob").value,
    role:           document.getElementById("mRole").value,
    guardianName:   document.getElementById("mGuardianName").value.trim(),
    guardianKt:     document.getElementById("mGuardianKt").value.trim(),
    guardianPhone:  document.getElementById("mGuardianPhone").value.trim(),
    active:         document.getElementById("mActive").checked,
  };

  try {
    const res = await apiPost("saveMember", payload);
    const idx = members.findIndex(x => x.id === id);
    if (idx >= 0) members[idx] = { ...members[idx], ...payload };
    else          members.push(payload);
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
    await apiPost("deleteMember", { id });
    members = members.filter(m => m.id !== id);
    renderMembers();
  } catch(e) { toast(s("toast.error") + ": " + e.message, "err"); }
}
async function deleteMember() { await deactivateMember(editingId); closeModal("memberModal", true); }

// ══ BOAT CATEGORIES ══════════════════════════════════════════════════════════

