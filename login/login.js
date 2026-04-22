// Track the dynamic screen currently shown so we can re-render it when the
// language changes without losing the user's place in the login flow.
var _currentScreen = null;

// Holds onto the password the user just typed + any wards they guard, while
// they're stuck on the force-change screen. Cleared once they're past it.
var _pendingOldPassword = null;
var _pendingWards = [];

// (Re)apply all UI strings on the page. Called once on load and again
// whenever the user toggles the language, so we can swap strings in place
// instead of reloading the page (which would wipe in-progress login state).
function wireStrings() {
  document.getElementById('ktLabel').textContent         = s('login.username');
  document.getElementById('ktInput').placeholder         = s('login.usernamePlaceholder');
  document.getElementById('pwLabel').textContent         = s('login.password');
  document.getElementById('pwInput').placeholder         = s('login.passwordPlaceholder');
  document.getElementById('stayLabel').textContent       = s('login.stayLoggedIn');
  document.getElementById('langBtn').textContent         = s('nav.langToggle');
  document.getElementById('backLink').textContent        = s('login.back');
  document.getElementById('accountBackLink').textContent = s('login.back');
  document.getElementById('changeBackLink').textContent  = s('login.back');
  document.getElementById('newPwLabel').textContent      = s('settings.newPassword');
  document.getElementById('confirmPwLabel').textContent  = s('settings.confirmPassword');

  var changeBtn = document.getElementById('changeBtn');
  var changeBtnText = document.getElementById('changeBtnText');
  if (changeBtn.disabled) {
    changeBtnText.innerHTML = '<span class="spinner"></span>' + s('login.loading');
  } else {
    changeBtnText.textContent = s('login.changePw.save');
  }

  // Preserve loading state if a sign-in is in flight
  var loginBtn = document.getElementById('loginBtn');
  var btnText  = document.getElementById('btnText');
  if (loginBtn.disabled) {
    btnText.innerHTML = '<span class="spinner"></span>' + s('login.loading');
  } else {
    btnText.textContent = s('login.btn');
  }

  // Refresh any visible error messages whose string key we tracked
  ['errMsg', 'accountErr', 'changeErr', 'googleErr'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el && el.style.display !== 'none' && el.dataset.sKey) {
      el.textContent = s(el.dataset.sKey);
    }
  });

  var gd = document.getElementById('googleDividerText');
  if (gd) gd.textContent = s('login.or');

  // Re-render whichever dynamic screen is currently shown so its labels update
  if (_currentScreen) {
    if (_currentScreen.type === 'account') {
      showAccountPicker(_currentScreen.guardian, _currentScreen.wards);
    } else if (_currentScreen.type === 'role') {
      showRolePicker(_currentScreen.user, _currentScreen.roles);
    } else if (_currentScreen.type === 'forceChange') {
      showForceChangeScreen(_currentScreen.user);
    }
  }
}

wireStrings();

// Override the api.js global on this page only: a full reload() would wipe
// the typed kennitala or kick the user back to the start screen even if
// they had already advanced to the role/account picker. Instead, fetch the
// other language file dynamically and re-apply strings in place.
function toggleLang() {
  var next = getLang() === 'EN' ? 'IS' : 'EN';
  setLang(next);
  var script = document.createElement('script');
  script.src = '../shared/strings-' + next.toLowerCase() + '.js';
  script.onload = wireStrings;
  document.head.appendChild(script);
}

['ktInput','pwInput'].forEach(function(id) {
  document.getElementById(id).addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
});
['newPwInput','confirmPwInput'].forEach(function(id) {
  document.getElementById(id).addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitForceChange();
  });
});

// Restore "stay logged in" checkbox from last choice so the user doesn't have
// to re-tick it every time on a device they treat as their own.
document.getElementById('stayLoggedIn').checked = getStayLoggedIn();

// Warm the Apps Script container early so post-login API calls are fast.
// Swallow the 401 — we're not authenticated yet and the request still
// spins up the container, which is all we care about here.
apiGet('getConfig').catch(function() {});

// ── Google one-tap sign-in ──────────────────────────────────────────────────
// Poll briefly for the GSI library to load (it's async deferred). When it's
// ready — and only if the admin has configured a client ID — render the
// button and enable one-tap. The password form remains the fallback.
(function waitForGoogleIdentity(attempts) {
  attempts = attempts || 0;
  if (!GOOGLE_CLIENT_ID) return;
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
    if (attempts > 40) return; // ~10s
    setTimeout(function(){ waitForGoogleIdentity(attempts + 1); }, 250);
    return;
  }
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    google.accounts.id.renderButton(document.getElementById('googleBtn'), {
      type: 'standard',
      theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'outline' : 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      logo_alignment: 'center',
      width: 320,
    });
    document.getElementById('googleBtnWrap').classList.remove('d-none');
    document.getElementById('googleDividerText').textContent = s('login.or');
    google.accounts.id.prompt();
  } catch (e) {
    // Swallow — any failure (blocked third-party cookies, wrong origin)
    // just means the user falls back to the password form.
  }
})();

async function handleGoogleCredential(resp) {
  var err = document.getElementById('googleErr');
  err.classList.add('d-none');
  delete err.dataset.sKey;
  if (!resp || !resp.credential) return;
  var stay = document.getElementById('stayLoggedIn').checked;
  setStayLoggedIn(stay);
  try {
    var data = await apiPost('loginWithGoogle', {
      idToken: resp.credential,
      stayLoggedIn: stay,
      userAgent: (navigator.userAgent || '').slice(0, 200),
    });
    var user = data.member;
    var wards = Array.isArray(data.wards) ? data.wards : [];
    if (data.sessionToken) {
      setSession(data.sessionToken, data.expiresAt || null, data.sessionId || null);
    }
    user.usingDefaultPassword = !!data.usingDefaultPassword;
    if (data.usingDefaultPassword) {
      // Rare path: a Google-linked member whose password was admin-reset.
      // Keep the same "choose a password" gate so they don't end up with
      // only a temp password on file.
      _pendingWards = wards;
      _pendingOldPassword = '';
      showForceChangeScreen(user);
      return;
    }
    if (wards.length) {
      showAccountPicker(user, wards);
      return;
    }
    proceedWithUser(user);
  } catch (e) {
    var msg = (e && e.message) || '';
    var key = 'login.googleError';
    if (msg.indexOf('not linked') >= 0) key = 'login.googleNotLinked';
    else if (msg.indexOf('Inactive') >= 0) key = 'login.notFound';
    err.textContent  = s(key);
    err.dataset.sKey = key;
    err.classList.remove('d-none');
  }
}

async function doLogin() {
  const rawUser = document.getElementById('ktInput').value.trim();
  const password = document.getElementById('pwInput').value;
  const stay     = document.getElementById('stayLoggedIn').checked;
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('errMsg');

  if (!rawUser) {
    err.textContent    = s('login.usernameRequired');
    err.dataset.sKey   = 'login.usernameRequired';
    err.style.display  = 'block';
    return;
  }
  if (!password) {
    err.textContent    = s('login.passwordRequired');
    err.dataset.sKey   = 'login.passwordRequired';
    err.style.display  = 'block';
    return;
  }

  // If the user typed all digits, treat it as a kennitala and enforce the
  // 10-digit rule. Otherwise treat it as initials.
  const digits = rawUser.replace(/\D/g, '');
  const looksLikeKt = digits.length === rawUser.length;
  if (looksLikeKt && digits.length !== 10) {
    err.textContent    = s('login.tooShort');
    err.dataset.sKey   = 'login.tooShort';
    err.style.display  = 'block';
    return;
  }
  const username = looksLikeKt ? digits : rawUser;

  err.style.display  = 'none';
  delete err.dataset.sKey;
  btn.disabled       = true;
  document.getElementById('btnText').innerHTML =
    `<span class="spinner"></span>${s('login.loading')}`;

  // Apply "stay logged in" before we persist the user so setUser puts the
  // record in the right storage.
  setStayLoggedIn(stay);

  try {
    const data = await apiPost('loginMember', {
      username: username,
      password: password,
      stayLoggedIn: stay,
      userAgent: (navigator.userAgent || '').slice(0, 200),
    });
    const user = data.member;
    const wards = Array.isArray(data.wards) ? data.wards : [];

    // Stash the session token so every subsequent API call can authenticate
    // as this user. Expiry is enforced client- and server-side.
    if (data.sessionToken) {
      setSession(data.sessionToken, data.expiresAt || null, data.sessionId || null);
    }

    // Flag the user record so downstream pages can nag about the default
    // password until it's been changed.
    user.usingDefaultPassword = !!data.usingDefaultPassword;

    // First-time sign-in on the club-wide default password: force the user
    // to choose their own before we let them past this screen. We stash the
    // pending wards so the account picker still kicks in afterwards.
    if (data.usingDefaultPassword) {
      _pendingWards = wards;
      _pendingOldPassword = password;
      showForceChangeScreen(user);
      return;
    }

    // If this member guards one or more minors, offer an account picker so
    // they can choose whether to open their own account or a ward's account.
    // Otherwise go straight to the existing role/redirect flow.
    if (wards.length) {
      showAccountPicker(user, wards);
      return;
    }

    proceedWithUser(user);
  } catch(e) {
    const msg = (e && e.message) || '';
    let key = 'login.error';
    if (msg.indexOf('Too many attempts') >= 0 || (e && e.code === 429))
                                                        key = 'login.rateLimited';
    else if (msg.indexOf('Invalid credentials') >= 0)   key = 'login.badPassword';
    else if (msg.indexOf('Ambiguous') >= 0)             key = 'login.ambiguous';
    else if (msg.indexOf('Not found') >= 0 ||
             msg.indexOf('Inactive') >= 0)              key = 'login.notFound';
    err.textContent   = s(key);
    err.dataset.sKey  = key;
    err.style.display = 'block';
    btn.disabled      = false;
    document.getElementById('btnText').textContent = s('login.btn');
  }
}

// Persist the chosen user and drive the existing role-picker / redirect flow.
// `user` is assumed to already carry any `guardianSession` metadata if the
// active session is a guardian acting as their ward.
function proceedWithUser(user) {
  setUser(user);

  // Sync server preferences → localStorage so all pages see saved settings
  var serverPrefs = parseJson(user.preferences, {});
  if (Object.keys(serverPrefs).length) {
    setPrefs(serverPrefs);
    if (serverPrefs.theme) setTheme(serverPrefs.theme);
    if (serverPrefs.lang) setLang(serverPrefs.lang);
  }

  // Prefetch data the landing page will need while user is on role picker
  // (or racing the redirect for regular members). Results land in
  // sessionStorage via apiGet's cache, so the target page skips the call.
  window._prefetchConfig = apiGet('getConfig');
  if (user.role === 'admin') {
    window._prefetchMembers = apiGet('getMembers');
    window._prefetchCheckouts = apiGet('getActiveCheckouts');
    showRolePicker(user, ['member', 'staff', 'admin']);
  } else if (user.role === 'staff') {
    window._prefetchMembers = apiGet('getMembers');
    window._prefetchCheckouts = apiGet('getActiveCheckouts');
    showRolePicker(user, ['member', 'staff']);
  } else if (user.role === 'guardian') {
    // Guardians don't have a member hub — send them straight to the
    // guardian landing page, which handles ward switching + settings.
    window.location.href = '../guardian/';
  } else {
    window._prefetchCheckouts = apiGet('getActiveCheckouts');
    window.location.href = '../member/';
  }
}

function showForceChangeScreen(user) {
  _currentScreen = { type: 'forceChange', user: user };
  document.getElementById('ktScreen').style.display          = 'none';
  document.getElementById('accountScreen').style.display     = 'none';
  document.getElementById('roleScreen').style.display        = 'none';
  document.getElementById('forceChangeScreen').style.display = 'block';
  document.getElementById('changeGreeting').textContent =
    s('login.welcome') + ' ' + (user.name || '').split(' ')[0] + ' — ' + s('login.changePw.title');
  document.getElementById('changeHint').textContent = s('login.changePw.hint');
  document.getElementById('changeBtnText').textContent = s('login.changePw.save');
  document.getElementById('newPwInput').focus();
}

async function submitForceChange() {
  const pw1 = document.getElementById('newPwInput').value;
  const pw2 = document.getElementById('confirmPwInput').value;
  const btn = document.getElementById('changeBtn');
  const err = document.getElementById('changeErr');

  function showErr(key) {
    err.textContent   = s(key);
    err.dataset.sKey  = key;
    err.style.display = 'block';
  }

  if (!pw1 || pw1.length < 4) { showErr('settings.passwordTooShort'); return; }
  if (pw1 !== pw2)            { showErr('settings.passwordMismatch'); return; }

  err.style.display = 'none';
  delete err.dataset.sKey;
  btn.disabled = true;
  document.getElementById('changeBtnText').innerHTML =
    `<span class="spinner"></span>${s('login.loading')}`;

  const user = _currentScreen && _currentScreen.user;
  if (!user) { btn.disabled = false; return; }

  try {
    await apiPost('setPassword', {
      kennitala:       user.kennitala,
      currentPassword: _pendingOldPassword || '',
      newPassword:     pw1,
    });

    user.usingDefaultPassword = false;
    const wards = _pendingWards || [];
    _pendingOldPassword = null;
    _pendingWards = [];
    document.getElementById('forceChangeScreen').style.display = 'none';

    if (wards.length) {
      showAccountPicker(user, wards);
    } else {
      proceedWithUser(user);
    }
  } catch(e) {
    const msg = (e && e.message) || '';
    let key = 'settings.passwordSaveFailed';
    if (msg.indexOf('at least') >= 0)       key = 'settings.passwordTooShort';
    else if (msg.indexOf('Current password') >= 0) key = 'settings.passwordWrongCurrent';
    showErr(key);
    btn.disabled = false;
    document.getElementById('changeBtnText').textContent = s('login.changePw.save');
  }
}

function showAccountPicker(guardian, wards) {
  _currentScreen = { type: 'account', guardian: guardian, wards: wards };
  document.getElementById('ktScreen').style.display          = 'none';
  document.getElementById('roleScreen').style.display        = 'none';
  document.getElementById('forceChangeScreen').style.display = 'none';
  document.getElementById('accountScreen').style.display     = 'block';
  document.getElementById('accountGreeting').textContent =
    s('login.welcome') + ' ' + (guardian.name || '').split(' ')[0] + ' — ' + s('login.chooseAccount');

  const container = document.getElementById('accountBtns');
  container.innerHTML = '';

  // Guardian's own account — label differs for guardian-only accounts since
  // they have no member hub; the button opens their guardian landing page.
  const selfBtn = document.createElement('button');
  const isGuardianOnly = guardian.role === 'guardian';
  selfBtn.className = 'role-btn role-member';
  selfBtn.innerHTML =
    '<span class="role-icon">' + (isGuardianOnly ? '👤' : '⛵') + '</span>' +
    '<div>' +
      '<div class="role-label">' + esc(guardian.name) + '</div>' +
      '<div class="role-desc">' +
        (isGuardianOnly ? s('login.guardianAccount') : s('login.yourAccount')) +
      '</div>' +
    '</div>';
  selfBtn.onclick = function() { proceedWithUser(guardian); };
  container.appendChild(selfBtn);

  // One button per ward
  wards.forEach(function(w) {
    const wBtn = document.createElement('button');
    wBtn.className = 'role-btn role-ward';
    wBtn.innerHTML =
      '<span class="role-icon">🧒</span>' +
      '<div>' +
        '<div class="role-label">' + esc(w.name) + '</div>' +
        '<div class="role-desc">' + s('login.wardMinor') +
          (w.birthYear ? ' · ' + esc(w.birthYear) : '') + '</div>' +
      '</div>';
    wBtn.onclick = function() { switchToWard(guardian, w); };
    container.appendChild(wBtn);
  });
}

async function switchToWard(guardian, ward) {
  const btns = document.querySelectorAll('#accountBtns button');
  const err  = document.getElementById('accountErr');
  btns.forEach(function(b) { b.disabled = true; });
  err.style.display = 'none';
  delete err.dataset.sKey;
  // Drop per-user caches so the ward's hub doesn't show stale guardian data
  // if a previous session left something in sessionStorage.
  try {
    ['ymir_getTrips_','ymir_getCrews_','ymir_getCrewBoard_','ymir_getCrewInvites_']
      .forEach(function(k) { sessionStorage.removeItem(k); });
  } catch(e) {}
  try {
    // Preserve the guardian's current session so switchBackToGuardian can
    // restore it without re-login; it's cleared when the user fully signs out.
    var parent = getSessionInfo();
    if (parent && parent.token) setParentSession(parent);
    const data = await apiPost('validateWard', {
      guardianKennitala: guardian.kennitala,
      wardKennitala: ward.kennitala,
      userAgent: (navigator.userAgent || '').slice(0, 200),
    });
    // Swap to the ward's freshly-minted session for subsequent calls.
    if (data.sessionToken) {
      setSession(data.sessionToken, data.expiresAt || null, data.sessionId || null);
    }
    // Stash a trimmed guardian record on the ward's user object so the
    // header can surface "Signed in as X — ↶ Back to guardian".
    const wardUser = Object.assign({}, data.member, {
      guardianSession: {
        id: guardian.id,
        kennitala: guardian.kennitala,
        name: guardian.name,
        role: guardian.role,
      },
    });
    proceedWithUser(wardUser);
  } catch(e) {
    btns.forEach(function(b) { b.disabled = false; });
    err.textContent  = s('login.wardSwitchError');
    err.dataset.sKey = 'login.wardSwitchError';
    err.style.display = 'block';
  }
}

// Minimal HTML escape used inside dynamically built buttons in this page.
// shared/ui.js defines a global `esc`, but it isn't loaded on the login page.
function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showRolePicker(user, roles) {
  _currentScreen = { type: 'role', user: user, roles: roles };
  document.getElementById('ktScreen').style.display          = 'none';
  document.getElementById('accountScreen').style.display     = 'none';
  document.getElementById('forceChangeScreen').style.display = 'none';
  document.getElementById('roleScreen').style.display        = 'block';
  document.getElementById('roleGreeting').textContent =
    s('login.welcome') + ' ' + user.name.split(' ')[0] + ' — ' + s('login.chooseView');

  const dests = {
    admin:  { icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M249.94,120.24l-27.05-6.76a95.86,95.86,0,0,0-80.37-80.37l-6.76-27a8,8,0,0,0-15.52,0l-6.76,27.05a95.86,95.86,0,0,0-80.37,80.37l-27,6.76a8,8,0,0,0,0,15.52l27.05,6.76a95.86,95.86,0,0,0,80.37,80.37l6.76,27.05a8,8,0,0,0,15.52,0l6.76-27.05a95.86,95.86,0,0,0,80.37-80.37l27.05-6.76a8,8,0,0,0,0-15.52Zm-95.49,22.9L139.31,128l15.14-15.14L215,128Zm-52.9,0L41,128l60.57-15.14L116.69,128ZM205.77,109.2,158.6,97.4,146.8,50.23A79.88,79.88,0,0,1,205.77,109.2Zm-62.63-7.65L128,116.69l-15.14-15.14L128,41ZM109.2,50.23,97.4,97.4,50.23,109.2A79.88,79.88,0,0,1,109.2,50.23Zm-59,96.57L97.4,158.6l11.8,47.17A79.88,79.88,0,0,1,50.23,146.8Zm62.63,7.65L128,139.31l15.14,15.14L128,215Zm33.94,51.32,11.8-47.17,47.17-11.8A79.88,79.88,0,0,1,146.8,205.77Z"/></svg>', label: s('login.admin.label'),  desc: s('login.admin.desc'),  href: '../admin/',  cls: 'role-admin'  },
    staff:  { icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,80a8,8,0,0,0-8,8v16H188.85L184,55.2A8,8,0,0,0,181.32,50L138.44,11.88l-.2-.17a16,16,0,0,0-20.48,0l-.2.17L74.68,50A8,8,0,0,0,72,55.2L67.15,104H56V88a8,8,0,0,0-16,0v24a8,8,0,0,0,8,8H65.54l-9.47,94.48A16,16,0,0,0,72,232H184a16,16,0,0,0,15.92-17.56L190.46,120H208a8,8,0,0,0,8-8V88A8,8,0,0,0,208,80ZM128,24l27,24H101ZM87.24,64h81.52l4,40H136V88a8,8,0,0,0-16,0v16H83.23ZM72,216l4-40H180l4,40Zm106.39-56H77.61l4-40h92.76Z"/></svg>', label: s('login.staff.label'),  desc: s('login.staff.desc'),  href: '../staff/',  cls: 'role-staff'  },
    member: { icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M247.21,172.53A8,8,0,0,0,240,168H144V144h72a8,8,0,0,0,5.92-13.38L144,44.91V8a8,8,0,0,0-14.21-5l-104,128A8,8,0,0,0,32,144h96v24H16a8,8,0,0,0-6.25,13l29.6,37a15.93,15.93,0,0,0,12.49,6H204.16a15.93,15.93,0,0,0,12.49-6l29.6-37A8,8,0,0,0,247.21,172.53ZM197.92,128H144V68.69ZM48.81,128,128,30.53V128Zm155.35,80H51.84l-19.2-24H223.36Z"/></svg>', label: s('login.member.label'), desc: s('login.member.desc'), href: '../member/', cls: 'role-member' },
  };

  const container = document.getElementById('roleBtns');
  container.innerHTML = '';
  roles.forEach(r => {
    const d   = dests[r];
    const btn = document.createElement('button');
    btn.className = 'role-btn ' + d.cls;
    btn.innerHTML = `<span class="role-icon">${d.icon}</span>
      <div>
        <div class="role-label">${d.label}</div>
        <div class="role-desc">${d.desc}</div>
      </div>`;
    btn.onclick = () => { window.location.href = d.href; };
    container.appendChild(btn);
  });
}

function goBack() {
  _currentScreen = null;
  _pendingOldPassword = null;
  _pendingWards = [];
  document.getElementById('ktScreen').style.display          = 'block';
  document.getElementById('roleScreen').style.display        = 'none';
  document.getElementById('accountScreen').style.display     = 'none';
  document.getElementById('forceChangeScreen').style.display = 'none';
  ['accountErr', 'changeErr'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = 'none'; delete el.dataset.sKey; }
  });
  document.getElementById('ktInput').value = '';
  document.getElementById('pwInput').value = '';
  document.getElementById('newPwInput').value = '';
  document.getElementById('confirmPwInput').value = '';
  document.getElementById('loginBtn').disabled = false;
  document.getElementById('changeBtn').disabled = false;
  document.getElementById('btnText').textContent = s('login.btn');
  document.getElementById('changeBtnText').textContent = s('login.changePw.save');
}

(function () {
  if (typeof document === 'undefined' || document._loginListeners) return;
  document._loginListeners = true;
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-login-click]');
    if (el && typeof window[el.dataset.loginClick] === 'function') window[el.dataset.loginClick]();
  });
})();
