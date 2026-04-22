var user = requireAuth();
if (!user) throw new Error('not authenticated');

// Wire up static button clicks (replaces inline onclicks).
document.getElementById('changePwBtn').addEventListener('click', function() { changePassword(); });
document.getElementById('signOutAllBtn').addEventListener('click', function() { signOutEverywhereElse(); });
document.getElementById('cancelBtn').addEventListener('click', function() { cancelSettings(); });
document.getElementById('saveBtn').addEventListener('click', function() { saveSettings(); });

var _autoInitials = '';

document.addEventListener('DOMContentLoaded', async function() {
  buildHeader('settings');
  applyStrings();

  // Guardians don't sail, so hide the sailing-centric sections. They keep the
  // login, sign-in activity, language, and theme controls.
  if (typeof isGuardian === 'function' && isGuardian(user)) {
    document.querySelectorAll('[data-member-only]').forEach(function(el) {
      el.style.display = 'none';
    });
  }

  // Load current prefs from localStorage
  var prefs = getPrefs();
  var theme = getTheme();
  var lang  = getLang();

  // Set initials from user object
  _autoInitials = extractInitials(user.name);
  document.getElementById('sInitials').value = user.initials || _autoInitials;

  // Language toggle
  setToggle('langToggle', lang);

  // Wind unit
  document.getElementById('sWindUnit').value = prefs.windUnit || 'ms';

  // Theme toggle
  setToggle('themeToggle', theme);

  // Stats visibility
  var sv = prefs.statsVisibility || {};
  applyStatVis(sv);

  // Logbook page preferences
  var showHeatmap = prefs.showHeatmap !== false;
  var shm = document.getElementById('svShowHeatmap');
  shm.checked = showHeatmap;
  shm.closest('.pill-toggle').classList.toggle('active', showHeatmap);

  // Sign-in preferences
  setToggle('usernameStyleToggle', prefs.usernameStyle || 'kt');
  var stay = document.getElementById('svStayLoggedIn');
  stay.checked = getStayLoggedIn();
  stay.closest('.pill-toggle').classList.toggle('active', stay.checked);

  // Live handler for username-style toggle
  document.getElementById('usernameStyleToggle').addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    setToggle('usernameStyleToggle', btn.dataset.val);
  });

  // Pill toggle behavior
  document.querySelectorAll('.pill-toggle').forEach(function(pill) {
    pill.addEventListener('click', function(e) {
      e.preventDefault();
      var cb = pill.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      pill.classList.toggle('active', cb.checked);
    });
  });

  // Live theme preview. Track user interaction so a late-arriving server
  // sync (below) doesn't clobber the user's selection mid-click.
  var _userChangedTheme = false;
  document.getElementById('themeToggle').addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    _userChangedTheme = true;
    setToggle('themeToggle', btn.dataset.val);
    setTheme(btn.dataset.val);
  });

  // Live lang toggle (doesn't reload — only sets UI state)
  document.getElementById('langToggle').addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    setToggle('langToggle', btn.dataset.val);
  });

  // Load active sessions for the Sign-in activity section. Best-effort —
  // failures just render the empty state rather than blocking page load.
  loadSessions().catch(function() {});

  // Always fetch from server to keep local prefs in sync
  try {
    var mRes = await apiGet('getMembers');
    var me = (mRes.members || []).find(function(m) { return String(m.kennitala) === String(user.kennitala); });
    if (me) {
      var serverPrefs = parseJson(me.preferences, {});
      if (Object.keys(serverPrefs).length) {
        setPrefs(serverPrefs);
        if (serverPrefs.windUnit) document.getElementById('sWindUnit').value = serverPrefs.windUnit;
        if (serverPrefs.theme && !_userChangedTheme) { setToggle('themeToggle', serverPrefs.theme); setTheme(serverPrefs.theme); }
        if (serverPrefs.statsVisibility) {
          applyStatVis(serverPrefs.statsVisibility);
        }
        if (serverPrefs.usernameStyle) setToggle('usernameStyleToggle', serverPrefs.usernameStyle);
        var serverShowHeatmap = serverPrefs.showHeatmap !== false;
        var shm2 = document.getElementById('svShowHeatmap');
        shm2.checked = serverShowHeatmap;
        shm2.closest('.pill-toggle').classList.toggle('active', serverShowHeatmap);
      }
      var spv = document.getElementById('svSharePhoneVol');
      spv.checked = serverPrefs.sharePhoneVolunteer === true;
      spv.closest('.pill-toggle').classList.toggle('active', spv.checked);
      // Show server initials if different
      if (me.initials) document.getElementById('sInitials').value = me.initials;
    }
  } catch(e) { /* proceed with local prefs */ }
});

function applyStatVis(sv) {
  var ids = ['svCareer','svHours','svYtd','svSkipper','svByCategory','svDistance','svLongest','svAvgWind','svStreak','svBoats','svCrew','svHeavy','svAvgDuration','svLocations','svVerified','svHelmHours','svStudent','svFavBoat','svFavLocation','svPeakWind'];
  var keys = ['career','hours','ytd','skipper','byCategory','distance','longest','avgWind','streak','boats','crew','heavy','avgDuration','locations','verified','helmHours','student','favBoat','favLocation','peakWind'];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    var on = isStatVisible(keys[i], sv);
    el.checked = on;
    el.closest('.pill-toggle').classList.toggle('active', on);
  }
}

function extractInitials(name) {
  if (!name) return '';
  return String(name).trim().split(/\s+/)
    .filter(function(t) { return t && t !== t.toLowerCase(); })
    .map(function(t) { return t.replace(/-/g, '').charAt(0); })
    .join('').toUpperCase();
}

function setToggle(groupId, val) {
  var btns = document.getElementById(groupId).querySelectorAll('button');
  btns.forEach(function(b) {
    b.classList.toggle('active', b.dataset.val === val);
  });
}

function getToggle(groupId) {
  var active = document.getElementById(groupId).querySelector('button.active');
  return active ? active.dataset.val : null;
}

function goBack() {
  if (document.referrer && document.referrer.indexOf(location.origin) === 0) {
    history.back();
  } else {
    location.href = (typeof isGuardian === 'function' && isGuardian(user))
      ? '../guardian/' : '../member/';
  }
}

function cancelSettings() {
  // Revert any live-previewed theme change
  var prefs = getPrefs();
  if (prefs.theme) setTheme(prefs.theme);
  goBack();
}

// Click outside modal to close
document.getElementById('settingsOverlay').addEventListener('click', function(e) {
  if (e.target === this) cancelSettings();
});

// Escape key to close
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') cancelSettings();
});

// ── Sign-in activity ────────────────────────────────────────────────────────
async function loadSessions() {
  var list = document.getElementById('sessionList');
  list.innerHTML = '<div class="settings-hint">' + s('lbl.loading') + '</div>';
  try {
    var data = await apiGet('listSessions', { _fresh: 1 });
    renderSessions(Array.isArray(data.sessions) ? data.sessions : []);
  } catch (e) {
    list.innerHTML = '<div class="settings-hint msg-err">' + s('settings.signInActivityError') + '</div>';
  }
}

// Turn a long User-Agent into a compact "Chrome · iOS 17" label. We pattern-
// match the browser and OS loosely rather than pull in a 30KB parser.
function summariseUA(ua) {
  ua = String(ua || '');
  if (!ua) return s('lbl.unknown');
  var browser = '';
  if (/Edg\//.test(ua))          browser = 'Edge';
  else if (/OPR\//.test(ua))     browser = 'Opera';
  else if (/Chrome\//.test(ua))  browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua))  browser = 'Safari';
  var os = '';
  if (/iPhone|iPad|iPod/.test(ua))    os = 'iOS';
  else if (/Android/.test(ua))        os = 'Android';
  else if (/Mac OS X/.test(ua))       os = 'macOS';
  else if (/Windows/.test(ua))        os = 'Windows';
  else if (/Linux/.test(ua))          os = 'Linux';
  return [browser, os].filter(Boolean).join(' · ') || s('lbl.unknown');
}

function fmtSessionWhen(iso) {
  if (!iso) return s('lbl.unknown');
  try {
    var d = new Date(iso);
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return dd + '-' + mm + '-' + d.getFullYear() + ' ' + hh + ':' + mi;
  } catch(e) { return String(iso); }
}

function renderSessions(sessions) {
  var list = document.getElementById('sessionList');
  var btn  = document.getElementById('signOutAllBtn');
  list.innerHTML = '';
  if (!sessions.length) {
    list.innerHTML = '<div class="settings-hint">' + s('settings.signInActivityEmpty') + '</div>';
    btn.disabled = true;
    return;
  }
  btn.disabled = sessions.length <= 1; // only the current device is listed
  sessions.forEach(function(sess) {
    var row = document.createElement('div');
    row.className = 'session-row' + (sess.isCurrent ? ' current' : '');
    var meta = document.createElement('div');
    meta.className = 'meta';
    var ua = document.createElement('div');
    ua.className = 'ua';
    ua.textContent = summariseUA(sess.userAgent);
    if (sess.isCurrent) {
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = s('settings.signInActivityCurrent');
      ua.appendChild(badge);
    }
    var when = document.createElement('div');
    when.className = 'when';
    when.textContent = s('settings.signInActivityLastSeen') + ': ' + fmtSessionWhen(sess.lastSeenAt) +
      ' · ' + s('settings.signInActivityCreated') + ': ' + fmtSessionWhen(sess.createdAt);
    meta.appendChild(ua);
    meta.appendChild(when);
    row.appendChild(meta);
    if (!sess.isCurrent) {
      var del = document.createElement('button');
      del.className = 'row-del';
      del.type = 'button';
      del.textContent = s('settings.signInActivitySignOut');
      del.onclick = function() { signOutOne(sess.id); };
      row.appendChild(del);
    }
    list.appendChild(row);
  });
}

async function signOutOne(sessionId) {
  var msg = document.getElementById('sessionMsg');
  msg.style.display = 'none';
  try {
    await apiPost('signOut', { sessionId: sessionId });
    await loadSessions();
  } catch (e) {
    msg.textContent = s('settings.signInActivityError');
    msg.className = 'msg msg-err';
    msg.style.display = 'block';
  }
}

async function signOutEverywhereElse() {
  var btn = document.getElementById('signOutAllBtn');
  var msg = document.getElementById('sessionMsg');
  msg.style.display = 'none';
  if (!(await ymConfirm(s('settings.signOutEverywhereElseConfirm')))) return;
  btn.disabled = true;
  try {
    // `exceptCurrent: true` keeps this tab's session alive so the user
    // isn't punted back to /login/ after revoking remote devices.
    var data = await apiPost('signOutAll', { exceptCurrent: true });
    var n = (data && typeof data.count === 'number') ? data.count : 0;
    msg.textContent = s('settings.signedOutEverywhereElse').replace('{n}', n);
    msg.className = 'msg msg-ok';
    msg.style.display = 'block';
    loadSessions();
  } catch (e) {
    msg.textContent = s('settings.signInActivityError');
    msg.className = 'msg msg-err';
    msg.style.display = 'block';
    btn.disabled = false;
  }
}

async function changePassword() {
  var cur  = document.getElementById('sCurrentPw').value;
  var next = document.getElementById('sNewPw').value;
  var conf = document.getElementById('sConfirmPw').value;
  var btn  = document.getElementById('changePwBtn');
  var msg  = document.getElementById('pwMsg');

  function showMsg(key, cls) {
    msg.textContent = s(key);
    msg.className = 'msg ' + (cls || 'msg-err');
    msg.style.display = 'block';
  }

  if (!next || next.length < 4) { showMsg('settings.passwordTooShort'); return; }
  if (next !== conf)             { showMsg('settings.passwordMismatch'); return; }

  btn.disabled = true;
  var prevLabel = btn.textContent;
  btn.textContent = s('lbl.loading');
  try {
    var res = await apiPost('setPassword', {
      kennitala:       user.kennitala,
      currentPassword: cur,
      newPassword:     next,
    });
    document.getElementById('sCurrentPw').value = '';
    document.getElementById('sNewPw').value     = '';
    document.getElementById('sConfirmPw').value = '';
    // The member now has a real password, so clear the "default password" flag.
    user.usingDefaultPassword = false;
    setUser(user);
    // Surface how many other devices were signed out — the backend revokes
    // every other session on a password change. Fall back to the plain
    // success message when nothing else was active.
    var revoked = res && typeof res.sessionsRevoked === 'number' ? res.sessionsRevoked : 0;
    if (revoked > 0) {
      msg.textContent = s('settings.passwordChangedSignedOut').replace('{n}', revoked);
      msg.className = 'msg msg-ok';
      msg.style.display = 'block';
    } else {
      showMsg('settings.passwordChanged', 'msg-ok');
    }
    // Refresh the session list in case the user is watching it.
    loadSessions().catch(function() {});
  } catch (e) {
    var em = (e && e.message) || '';
    if (em.indexOf('Current password') >= 0) showMsg('settings.passwordWrongCurrent');
    else if (em.indexOf('at least') >= 0)     showMsg('settings.passwordTooShort');
    else                                      showMsg('settings.passwordSaveFailed');
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
}

async function saveSettings() {
  var btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = s('lbl.loading');

  var initials = document.getElementById('sInitials').value.trim().toUpperCase() || _autoInitials;
  var lang     = getToggle('langToggle') || 'IS';
  var windUnit = document.getElementById('sWindUnit').value;
  var theme    = getToggle('themeToggle') || 'dark';

  var statsVisibility = {
    career:     document.getElementById('svCareer').checked,
    hours:      document.getElementById('svHours').checked,
    ytd:        document.getElementById('svYtd').checked,
    skipper:    document.getElementById('svSkipper').checked,
    byCategory: document.getElementById('svByCategory').checked,
    distance:   document.getElementById('svDistance').checked,
    longest:    document.getElementById('svLongest').checked,
    avgWind:    document.getElementById('svAvgWind').checked,
    streak:     document.getElementById('svStreak').checked,
    boats:      document.getElementById('svBoats').checked,
    crew:       document.getElementById('svCrew').checked,
    heavy:      document.getElementById('svHeavy').checked,
    avgDuration:document.getElementById('svAvgDuration').checked,
    locations:  document.getElementById('svLocations').checked,
    verified:   document.getElementById('svVerified').checked,
    helmHours:  document.getElementById('svHelmHours').checked,
    student:    document.getElementById('svStudent').checked,
    favBoat:    document.getElementById('svFavBoat').checked,
    favLocation:document.getElementById('svFavLocation').checked,
    peakWind:   document.getElementById('svPeakWind').checked,
  };

  var sharePhoneVolunteer = document.getElementById('svSharePhoneVol').checked;
  var usernameStyle       = getToggle('usernameStyleToggle') || 'kt';
  var stayLoggedIn        = document.getElementById('svStayLoggedIn').checked;
  var showHeatmap         = document.getElementById('svShowHeatmap').checked;

  // "Stay logged in" is a per-device flag, not synced to the server, so the
  // user can enable it on their phone but stay one-shot on a shared laptop.
  setStayLoggedIn(stayLoggedIn);

  var prefs = {
    windUnit: windUnit, theme: theme, statsVisibility: statsVisibility,
    sharePhoneVolunteer: sharePhoneVolunteer, usernameStyle: usernameStyle,
    showHeatmap: showHeatmap,
  };
  var langChanged = lang !== getLang();

  // Save locally
  setPrefs(prefs);
  setTheme(theme);
  setLang(lang);

  // Update user object in session
  user.initials = initials;
  setUser(user);

  // Save to server
  try {
    await apiPost('savePreferences', {
      kennitala: user.kennitala,
      initials: initials,
      lang: lang,
      preferences: prefs,
    });
    showToast(s('settings.saved'), 'ok');

    // If language changed, reload the target page to apply
    if (langChanged) {
      location.href = (typeof isGuardian === 'function' && isGuardian(user))
        ? '../guardian/' : '../member/';
    } else {
      goBack();
    }
  } catch(e) {
    showToast(s('settings.saveFailed') + ': ' + e.message, 'err');
    btn.disabled = false;
    btn.textContent = s('btn.saveClose');
  }
}
