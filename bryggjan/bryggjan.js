prefetch({ Config: ['getConfig'], Notifications: ['getNotifications'] });

const user = requireAuth();

let _brgPosts = [];
let _brgBoats = [];
let _brgBoatsById = {};

document.addEventListener('DOMContentLoaded', async () => {
  buildHeader('bryggjan');
  applyStrings();

  try {
    const cfg = await apiGet('getConfig');
    _brgBoats = (cfg.boats || []).filter(b => b.active);
    _brgBoatsById = {};
    _brgBoats.forEach(b => { _brgBoatsById[b.id] = b; });
    populateBoatSelect();
  } catch (e) { /* boat select just stays empty; board itself doesn't need it */ }

  await loadBryggjanBoard();

  // Fire-and-forget: marks the board seen so get-notifications stops
  // counting today's open posts against this member. Failure here shouldn't
  // block the page — worst case the badge stays lit one refresh longer.
  callSupabaseRpc('mark_bryggjan_seen', {}).then(() => {
    _invalidateApiCache('getNotifications');
  }).catch(() => {});
});

function populateBoatSelect() {
  const sel = document.getElementById('brgBoat');
  const keep = sel.querySelector('option[value=""]');
  sel.innerHTML = '';
  sel.appendChild(keep);
  _brgBoats.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  });
}

async function loadBryggjanBoard() {
  document.getElementById('brgLoading').classList.remove('hidden');
  document.getElementById('brgEmpty').classList.add('hidden');
  try {
    _brgPosts = await callPostgrestTable('bryggjan_posts', {
      query: '?select=*,bryggjan_signups(id,member_id,kennitala,member_name,status)'
        + '&status=neq.cancelled&order=date.asc,start_time.asc',
    });
  } catch (e) {
    document.getElementById('brgBoard').innerHTML =
      `<div class="empty-note text-red">${s('toast.loadFailed')}: ${esc(e.message)}</div>`;
    document.getElementById('brgLoading').classList.add('hidden');
    return;
  }
  document.getElementById('brgLoading').classList.add('hidden');
  renderBryggjanBoard();
}

function renderBryggjanBoard() {
  const board = document.getElementById('brgBoard');
  document.getElementById('brgEmpty').classList.toggle('hidden', _brgPosts.length > 0);
  board.innerHTML = _brgPosts.map(renderBryggjanCard).join('');
}

function _brgKindLabel(kind) {
  return s('brg.kind' + kind.charAt(0).toUpperCase() + kind.slice(1));
}

function renderBryggjanCard(post) {
  const signups = post.bryggjan_signups || [];
  const approved = signups.filter(su => su.status === 'approved');
  const pending = signups.filter(su => su.status === 'pending');
  const myMemberId = user.id;
  const mySignup = signups.find(su => su.member_id === myMemberId && (su.status === 'approved' || su.status === 'pending'));
  const isOrganizer = post.organizer_member_id === myMemberId;
  const canManage = isOrganizer || isStaff(user);

  const badge = post.status === 'full'
    ? `<span class="badge badge-blue">${s('brg.statusFull')}</span>`
    : `<span class="badge badge-green">${s('brg.statusOpen')}</span>`;

  const when = post.start_time
    ? `${fmtDate(post.date)} · ${sstr(post.start_time).slice(0, 5)}${post.end_time ? '–' + sstr(post.end_time).slice(0, 5) : ''}`
    : fmtDate(post.date);

  const rosterHtml = approved.map(su =>
    `<li>${esc(su.member_name)}${su.member_id === post.organizer_member_id ? ' ★' : ''}</li>`
  ).join('');

  let pendingHtml = '';
  if (canManage && pending.length) {
    pendingHtml = `<div class="mt-8"><div class="text-xs text-muted mb-3">${s('brg.pendingRequests')}</div><ul class="brg-pending-list">${
      pending.map(su => `
        <li class="d-flex items-center gap-6">
          <span class="flex-1">${esc(su.member_name)}</span>
          <button class="btn btn-secondary btn-sm" data-brg-click="decideSignup" data-brg-arg="${su.id}" data-brg-arg2="1">${s('brg.approve')}</button>
          <button class="btn btn-secondary btn-sm" data-brg-click="decideSignup" data-brg-arg="${su.id}" data-brg-arg2="0">${s('brg.decline')}</button>
        </li>`).join('')
    }</ul></div>`;
  }

  let actionsHtml = '';
  if (post.status === 'cancelled') {
    // filtered server-side; kept for safety if ever included
  } else if (mySignup) {
    const waitingNote = mySignup.status === 'pending'
      ? `<span class="text-xs text-muted">${s('brg.awaitingApproval')}</span>`
      : '';
    actionsHtml = `${waitingNote}<button class="btn btn-secondary btn-sm" data-brg-click="withdrawSignup" data-brg-arg="${mySignup.id}">${s('brg.withdraw')}</button>`;
  } else if (post.enrollment_mode === 'contact_organizer') {
    actionsHtml = `<span class="text-xs text-muted">${s('brg.contactOrganizerHint', { name: esc(post.organizer_name) })}</span>`;
  } else if (post.status === 'open') {
    actionsHtml = `<button class="btn btn-primary btn-sm" data-brg-click="joinPost" data-brg-arg="${post.id}">${s('brg.join')}</button>`;
  }

  if (canManage && post.status !== 'cancelled') {
    actionsHtml += `<button class="btn btn-secondary btn-sm" data-brg-click="cancelPost" data-brg-arg="${post.id}">${s('brg.cancelPost')}</button>`;
  }

  return `
    <div class="card card--sm brg-post-card">
      <div class="d-flex items-center gap-8 mb-6" style="justify-content:space-between">
        <div class="fw-500">${esc(_brgKindLabel(post.activity_kind))}${post.boat_name ? ' · ' + esc(post.boat_name) : ''}</div>
        ${badge}
      </div>
      ${post.title ? `<div class="mb-3">${esc(post.title)}</div>` : ''}
      <div class="text-sm text-muted mb-6">${esc(when)} · ${s('brg.organizer')}: ${esc(post.organizer_name)} · ${approved.length}/${post.max_crew}</div>
      ${post.note ? `<div class="text-sm mb-6">${esc(post.note)}</div>` : ''}
      ${rosterHtml ? `<ul class="brg-roster-list mb-6">${rosterHtml}</ul>` : ''}
      ${pendingHtml}
      <div class="d-flex gap-8 items-center mt-8">${actionsHtml}</div>
    </div>`;
}

function openCreatePost() {
  document.getElementById('brgCreateErr').classList.add('hidden');
  document.getElementById('brgKind').value = 'sailing';
  document.getElementById('brgBoat').value = '';
  document.getElementById('brgPostTitle').value = '';
  document.getElementById('brgDate').value = '';
  document.getElementById('brgMaxCrew').value = '4';
  document.getElementById('brgStartTime').value = '';
  document.getElementById('brgEndTime').value = '';
  document.getElementById('brgRequiredCert').value = '';
  document.getElementById('brgNote').value = '';
  document.getElementById('brgEnrollMode').value = 'open';
  onBoatChange();
  openModal('brgCreateModal');
}

function closeCreatePost() {
  closeModal('brgCreateModal');
}

function onBoatChange() {
  const boatId = document.getElementById('brgBoat').value;
  const boat = boatId ? _brgBoatsById[boatId] : null;
  document.getElementById('brgCertField').classList.toggle('hidden', !!boat);
  const slotBoat = !!(boat && boat.slotSchedulingEnabled);
  document.getElementById('brgSlotHint').classList.toggle('hidden', !slotBoat);
}

async function submitCreatePost() {
  const errEl = document.getElementById('brgCreateErr');
  errEl.classList.add('hidden');

  const boatId = document.getElementById('brgBoat').value || null;
  const boat = boatId ? _brgBoatsById[boatId] : null;
  const date = document.getElementById('brgDate').value;
  const maxCrew = parseInt(document.getElementById('brgMaxCrew').value, 10);
  const startTime = document.getElementById('brgStartTime').value || null;
  const endTime = document.getElementById('brgEndTime').value || null;

  if (!date) { errEl.textContent = s('brg.errDateRequired'); errEl.classList.remove('hidden'); return; }
  if (!maxCrew || maxCrew < 1) { errEl.textContent = s('brg.errMaxCrewRequired'); errEl.classList.remove('hidden'); return; }
  if (boat && boat.slotSchedulingEnabled && (!startTime || !endTime)) {
    errEl.textContent = s('brg.errTimeRequired');
    errEl.classList.remove('hidden');
    return;
  }

  try {
    await callSupabaseRpc('create_bryggjan_post', {
      p_activity_kind: document.getElementById('brgKind').value,
      p_date: date,
      p_max_crew: maxCrew,
      p_boat_id: boatId,
      p_start_time: startTime,
      p_end_time: endTime,
      p_title: document.getElementById('brgPostTitle').value.trim(),
      p_note: document.getElementById('brgNote').value.trim(),
      p_required_cert: boat ? '' : document.getElementById('brgRequiredCert').value.trim(),
      p_enrollment_mode: document.getElementById('brgEnrollMode').value,
    });
    _invalidateApiCache('getNotifications');
    closeModal('brgCreateModal');
    showToast(s('brg.postCreated'), 'ok');
    await loadBryggjanBoard();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

async function joinPost(postId) {
  try {
    const res = await callSupabaseRpc('join_bryggjan_post', { p_post_id: postId });
    _invalidateApiCache('getNotifications');
    showToast(res.status === 'approved' ? s('brg.joined') : s('brg.requestSent'), 'ok');
    await loadBryggjanBoard();
  } catch (e) { showToast(e.message, 'err'); }
}

async function withdrawSignup(signupId) {
  if (!await ymConfirm(s('brg.confirmWithdraw'))) return;
  try {
    await callSupabaseRpc('withdraw_bryggjan_signup', { p_signup_id: signupId });
    _invalidateApiCache('getNotifications');
    showToast(s('brg.withdrawn'), 'ok');
    await loadBryggjanBoard();
  } catch (e) { showToast(e.message, 'err'); }
}

async function decideSignup(signupId, approveStr) {
  const approve = approveStr === '1';
  try {
    await callSupabaseRpc('decide_bryggjan_signup', { p_signup_id: signupId, p_approve: approve });
    _invalidateApiCache('getNotifications');
    showToast(approve ? s('brg.requestApproved') : s('brg.requestDeclined'), 'ok');
    await loadBryggjanBoard();
  } catch (e) { showToast(e.message, 'err'); }
}

async function cancelPost(postId) {
  if (!await ymConfirm(s('brg.confirmCancel'))) return;
  try {
    await callSupabaseRpc('cancel_bryggjan_post', { p_post_id: postId });
    _invalidateApiCache('getNotifications');
    showToast(s('brg.postCancelled'), 'ok');
    await loadBryggjanBoard();
  } catch (e) { showToast(e.message, 'err'); }
}

// Delegated listener — data-brg-* convention (see CLAUDE.md "Event handling").
(function () {
  if (typeof document === 'undefined' || document._brgListeners) return;
  document._brgListeners = true;

  function argsFrom(el) {
    var a = [];
    if ('brgArg'  in el.dataset) a.push(el.dataset.brgArg);
    if ('brgArg2' in el.dataset) a.push(el.dataset.brgArg2);
    return a;
  }

  document.addEventListener('click', function (e) {
    var closeSelf = e.target.closest('[data-brg-close-self]');
    if (closeSelf && e.target === closeSelf) {
      closeModal(closeSelf.dataset.brgCloseSelf);
      return;
    }
    var close = e.target.closest('[data-brg-close]');
    if (close) {
      closeModal(close.dataset.brgClose);
      return;
    }
    var clk = e.target.closest('[data-brg-click]');
    if (clk) {
      var fn = clk.dataset.brgClick;
      if (typeof window[fn] === 'function') window[fn].apply(null, argsFrom(clk));
    }
  });

  document.addEventListener('change', function (e) {
    var c = e.target.closest('[data-brg-change]');
    if (c && typeof window[c.dataset.brgChange] === 'function') window[c.dataset.brgChange]();
  });
})();
