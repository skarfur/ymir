var user = requireAuth();
if (!user) throw new Error('not authenticated');

document.addEventListener('DOMContentLoaded', async function() {
  buildHeader('guardian');
  applyStrings();

  var firstName = (user.name || '').split(' ')[0] || user.name || '';
  document.getElementById('gHello').textContent = s('login.welcome') + ' ' + firstName;
  document.getElementById('gSub').textContent = s('guardian.sub');

  try {
    // validateMember returns { member, wards } — wards is what we need.
    var data = await apiGet('validateMember', { kennitala: user.kennitala, _fresh: 1 });
    renderWards(Array.isArray(data.wards) ? data.wards : []);
  } catch (e) {
    renderWards([]);
    var err = document.getElementById('gErr');
    err.textContent = s('guardian.loadError');
    err.style.display = 'block';
  }
});

function renderWards(wards) {
  var list = document.getElementById('wardList');
  list.innerHTML = '';
  if (!wards.length) {
    var empty = document.createElement('div');
    empty.className = 'empty-wards';
    empty.textContent = s('guardian.noWards');
    list.appendChild(empty);
    return;
  }
  wards.forEach(function(w) {
    var btn = document.createElement('button');
    btn.className = 'ward-btn';
    btn.innerHTML =
      '<span class="ward-icon">🧒</span>' +
      '<div>' +
        '<div class="ward-name">' + esc(w.name) + '</div>' +
        '<div class="ward-sub">' + s('login.wardMinor') +
          (w.birthYear ? ' · ' + esc(w.birthYear) : '') + '</div>' +
      '</div>';
    btn.onclick = function() { switchToWard(w); };
    list.appendChild(btn);
  });
}

async function switchToWard(ward) {
  var err = document.getElementById('gErr');
  err.style.display = 'none';
  // Drop per-user caches so the ward's hub doesn't show stale guardian data.
  try {
    ['ymir_getTrips_','ymir_getCrews_','ymir_getCrewBoard_','ymir_getCrewInvites_']
      .forEach(function(k) { sessionStorage.removeItem(k); });
  } catch(e) {}
  try {
    // Preserve the guardian's current session so switchBackToGuardian can
    // restore it without re-login; it's cleared when the user fully signs out.
    var parent = getSessionInfo();
    if (parent && parent.token) setParentSession(parent);
    var data = await apiPost('validateWard', {
      guardianKennitala: user.kennitala,
      wardKennitala:     ward.kennitala,
      userAgent:         (navigator.userAgent || '').slice(0, 200),
    });
    if (data.sessionToken) {
      setSession(data.sessionToken, data.expiresAt || null, data.sessionId || null);
    }
    var wardUser = Object.assign({}, data.member, {
      guardianSession: {
        id:        user.id,
        kennitala: user.kennitala,
        name:      user.name,
        role:      user.role,
      },
    });
    setUser(wardUser);
    window.location.href = '../member/';
  } catch (e) {
    err.textContent = s('login.wardSwitchError');
    err.style.display = 'block';
  }
}

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
