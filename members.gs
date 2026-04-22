// ═══════════════════════════════════════════════════════════════════════════════
// MEMBERS
// ═══════════════════════════════════════════════════════════════════════════════

function publicMember_(m) {
  return {
    id: m.id, kennitala: m.kennitala, name: m.name, role: m.role,
    email: m.email || '', phone: m.phone || '',
    birthYear: m.birthYear || '', isMinor: bool_(m.isMinor),
    guardianName: m.guardianName || '', guardianKennitala: m.guardianKennitala || '',
    guardianPhone: m.guardianPhone || '',
    certifications: m.certifications || '',
    initials: m.initials || extractInitials_(m.name),
    preferences: m.preferences || '{}',
    bio: m.bio || '',
    headshotUrl: m.headshotUrl || '',
  };
}

// Find all active minor members whose guardianKennitala matches the given kennitala.
// Returns a trimmed list with just enough info for the account picker.
function findWardsOf_(guardianKt) {
  const kt = String(guardianKt || '').trim();
  if (!kt) return [];
  const all = readAll_('members');
  return all.filter(function(r) {
    return bool_(r.active) && bool_(r.isMinor) &&
           String(r.guardianKennitala || '').trim() === kt;
  }).map(function(r) {
    return {
      id: r.id,
      kennitala: r.kennitala,
      name: r.name,
      birthYear: r.birthYear || '',
    };
  });
}

// Make sure a guardian has a members-sheet row they can log in with.
// Guardians of minors are not necessarily members themselves, but they still
// need to authenticate (kt + default password) so they can open their ward's
// account and manage their own login settings. This helper returns the
// existing members row if one is already there; otherwise, if the kt is
// listed as a guardian on at least one active minor, it inserts a role=
// guardian stub using the guardianName/guardianPhone stored on the ward
// record (or an explicit hint, used when saving a minor). Returns null if
// the kt has no relationship to any active minor and no hint was provided.
function ensureGuardianRecord_(kt, hintName, hintPhone) {
  const s = String(kt || '').trim();
  if (!s || s.length !== 10) return null;
  const existing = findOne_('members', 'kennitala', s);
  if (existing) return existing;
  let name  = hintName  == null ? '' : String(hintName).trim();
  let phone = hintPhone == null ? '' : String(hintPhone).trim();
  if (!name) {
    const ward = readAll_('members').find(function(r) {
      return bool_(r.active) && bool_(r.isMinor) &&
             String(r.guardianKennitala || '').trim() === s;
    });
    if (!ward) return null;
    name  = String(ward.guardianName  || '').trim();
    phone = phone || String(ward.guardianPhone || '').trim();
  }
  const ts = now_();
  const tempPassword = genTempPassword_();
  const row = {
    id: uid_(), kennitala: s, name: name, role: 'guardian',
    email: '', phone: phone, birthYear: '',
    isMinor: false,
    guardianName: '', guardianKennitala: '', guardianPhone: '',
    active: true, certifications: '',
    initials: extractInitials_(name), preferences: '{}',
    passwordHash: hashPassword_(tempPassword),
    passwordIsTemp: true,
    createdAt: ts, updatedAt: ts,
  };
  insertRow_('members', row);
  cDel_('members');
  // Attach the plaintext temp on the in-memory return so callers (admin flows)
  // can relay it to the guardian. Not a column, so it isn't persisted.
  row.tempPassword = tempPassword;
  return row;
}

function validateMember_(kennitala, caller) {
  if (!kennitala) return failJ('kennitala required');
  const kt = String(kennitala).trim();
  // Only the member themselves (or an admin) can re-read a full member
  // record. All other callers must go through the public lookup endpoints.
  if (caller && kt !== caller.kennitala && !isAdmin_(caller)) {
    return failJ('Forbidden', 403);
  }
  const m = findOne_('members', 'kennitala', kt);
  if (!m) return failJ('Not found', 404);
  if (!bool_(m.active)) return failJ('Inactive account', 403);
  // If this member is not themselves a minor, surface any wards they guard
  // so the login UI can offer account switching.
  const wards = bool_(m.isMinor) ? [] : findWardsOf_(m.kennitala);
  return okJ({
    member: publicMember_(m),
    wards: wards,
  });
}

// Password-gated sign-in. Username may be either a 10-digit kennitala or the
// member's initials (case-insensitive). Issues a session token on success
// and enforces a 5-per-15-min rate limit per kennitala.
// Response shape: { member, wards, usingDefaultPassword, sessionToken, expiresAt }
function loginMember_(b) {
  const username = String((b && b.username) || '').trim();
  const password = String((b && b.password) || '');
  const stay     = bool_(b && b.stayLoggedIn);
  const ua       = String((b && b.userAgent) || '');
  if (!username) return failJ('Username required');
  if (!password) return failJ('Password required');

  const r = findMemberForLogin_(username);
  if (r.ambiguous) return failJ('Ambiguous initials', 409);
  if (r.notFound || !r.member) return failJ('Not found', 404);
  const m = r.member;
  if (!bool_(m.active)) return failJ('Inactive account', 403);

  // Rate limit is keyed off the resolved kennitala so initials and kennitala
  // attempts share a counter.
  const rate = checkLoginRate_(m.kennitala);
  if (!rate.ok) return failJ('Too many attempts', 429);

  if (!verifyPassword_(m, password)) {
    bumpLoginAttempts_(m.kennitala);
    // Re-read the row: this attempt may have crossed the lockout threshold.
    const after = checkLoginRate_(m.kennitala);
    if (!after.ok) return failJ('Too many attempts', 429);
    return failJ('Invalid credentials', 401);
  }

  clearLoginAttempts_(m.kennitala);
  const session = createSession_(m.kennitala, m.role || 'member', stay, ua);

  const wards = bool_(m.isMinor) ? [] : findWardsOf_(m.kennitala);
  return okJ({
    member: publicMember_(m),
    wards: wards,
    usingDefaultPassword: bool_(m.passwordIsTemp),
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    sessionId: session.id,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// Revoke the caller's current session, or a named session by id (still
// restricted to the caller's own kennitala so admins can't accidentally
// sign out a non-admin via a stray id). Returns 200 even when the session
// no longer exists so the UI can always finish its local cleanup.
function signOut_(b, caller) {
  if (!caller) return failJ('Unauthorized', 401);
  const targetId = String((b && b.sessionId) || '').trim();
  if (targetId) {
    const row = findOne_('sessions', 'id', targetId);
    if (row && String(row.kennitala) === caller.kennitala) {
      deleteSessionById_(targetId);
    }
    return okJ({ signedOut: true });
  }
  if (caller.tokenHash) deleteSessionByHash_(caller.tokenHash);
  return okJ({ signedOut: true });
}

// Revoke every session belonging to the caller. `exceptCurrent` keeps the
// calling session alive — the setting page uses that to power a "sign out
// everywhere else" button without logging the user out of the tab they're
// actively in. Without it, every session (including the current) is wiped.
function signOutAll_(b, caller) {
  if (!caller) return failJ('Unauthorized', 401);
  const exceptCurrent = bool_(b && b.exceptCurrent);
  const keep = exceptCurrent ? caller.tokenHash : null;
  const n = revokeSessionsForMember_(caller.kennitala, keep);
  return okJ({ signedOut: true, count: n });
}

// Return the caller's currently-active sessions, newest-first. Raw token
// hashes are never exposed — the UI uses `id` to drive per-row revoke.
function listSessions_(b, caller) {
  if (!caller) return failJ('Unauthorized', 401);
  ensureSheet_('sessions', SESSION_COLS_);
  const now = Date.now();
  const currentHash = caller.tokenHash || '';
  const rows = readAll_('sessions')
    .filter(function(r) {
      if (String(r.kennitala || '').trim() !== caller.kennitala) return false;
      const exp = r.expiresAt ? new Date(r.expiresAt).getTime() : 0;
      return exp && exp > now;
    })
    .map(function(r) {
      return {
        id:           r.id,
        createdAt:    r.createdAt,
        lastSeenAt:   r.lastSeenAt,
        expiresAt:    r.expiresAt,
        stayLoggedIn: bool_(r.stayLoggedIn),
        userAgent:    String(r.userAgent || ''),
        isCurrent:    currentHash && r.tokenHash === currentHash,
      };
    })
    .sort(function(a, b2) {
      return String(b2.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''));
    });
  return okJ({ sessions: rows });
}

// Admin-only: issue a fresh random temp password for a member, flag their
// row so the login flow forces a change, and revoke every active session.
// The plaintext is returned to the admin once and never persisted.
function adminResetMemberPassword_(b, caller) {
  if (!caller || !isAdmin_(caller)) return failJ('Admin only', 403);
  const kt = String((b && b.kennitala) || '').trim();
  if (!kt) return failJ('kennitala required');
  const m = findOne_('members', 'kennitala', kt);
  if (!m) return failJ('Member not found', 404);
  addColIfMissing_('members', 'passwordHash');
  addColIfMissing_('members', 'passwordIsTemp');
  const tempPassword = genTempPassword_();
  updateRow_('members', 'kennitala', kt, {
    passwordHash: hashPassword_(tempPassword),
    passwordIsTemp: true,
    updatedAt: now_(),
  });
  cDel_('members');
  clearLoginAttempts_(kt);
  const n = revokeSessionsForMember_(kt);
  return okJ({ reset: true, sessionsRevoked: n, tempPassword: tempPassword });
}

// Set or change a member's password. Non-admins must supply the current
// password (which can be either the admin-issued temp or a previous
// self-chosen value); admins acting on someone else's record skip that
// check. On success every other session for this kennitala is revoked.
function setPassword_(b, caller) {
  if (!b || !b.kennitala) return failJ('kennitala required');
  const kt = String(b.kennitala).trim();
  const m = findOne_('members', 'kennitala', kt);
  if (!m) return failJ('Member not found', 404);
  if (!bool_(m.active)) return failJ('Inactive account', 403);
  const cur  = String(b.currentPassword || '');
  const next = String(b.newPassword || '');
  if (!next) return failJ('newPassword required');
  if (next.length < 4) return failJ('Password must be at least 4 characters');

  const isAdminActing = caller && isAdmin_(caller) && caller.kennitala !== kt;
  if (!isAdminActing) {
    if (!verifyPassword_(m, cur)) return failJ('Current password incorrect', 401);
  }

  addColIfMissing_('members', 'passwordHash');
  addColIfMissing_('members', 'passwordIsTemp');
  updateRow_('members', 'kennitala', kt, {
    passwordHash: hashPassword_(next),
    passwordIsTemp: false,
    updatedAt: now_(),
  });
  cDel_('members');
  clearLoginAttempts_(kt);
  // Invalidate every other session for this member so a stolen laptop is
  // logged out the moment the owner changes their password. Preserve the
  // caller's own session when they're changing their own password so the
  // current tab doesn't get booted in the middle of the save.
  const keepHash = (caller && caller.kennitala === kt) ? caller.tokenHash : null;
  const revoked = revokeSessionsForMember_(kt, keepHash);
  return okJ({ saved: true, sessionsRevoked: revoked });
}

// Return a ward's full member object, but only if `guardianKennitala` is
// actually listed as the guardian on the ward's member record and the ward
// is still flagged as a minor and active. Requires the caller to prove the
// guardian relationship by passing their own kennitala, which must match.
function validateWard_(b, caller) {
  if (!caller) return failJ('Unauthorized', 401);
  const guardianKt = String((b && b.guardianKennitala) || '').trim();
  const wardKt     = String((b && b.wardKennitala) || '').trim();
  if (!guardianKt || !wardKt) return failJ('guardianKennitala and wardKennitala required');
  // The caller must be the guardian they claim to be (or an admin helping out).
  if (guardianKt !== caller.kennitala && !isAdmin_(caller)) {
    return failJ('Forbidden', 403);
  }
  const guardian = findOne_('members', 'kennitala', guardianKt);
  if (!guardian) return failJ('Guardian not found', 404);
  if (!bool_(guardian.active)) return failJ('Inactive account', 403);
  if (bool_(guardian.isMinor)) return failJ('Minors cannot act as guardians', 403);
  const ward = findOne_('members', 'kennitala', wardKt);
  if (!ward) return failJ('Ward not found', 404);
  if (!bool_(ward.active)) return failJ('Inactive account', 403);
  if (!bool_(ward.isMinor)) return failJ('Target is not a minor', 403);
  if (String(ward.guardianKennitala || '').trim() !== guardianKt) {
    return failJ('Not authorised for this ward', 403);
  }
  // Mint a short-lived session tied to the ward so the frontend can act on
  // the ward's behalf without the guardian's token also implicitly auth'ing
  // arbitrary ward-targeted calls. Always short-lived — a guardian switching
  // into a ward should not be able to "stay logged in" as the minor.
  const ua = String((b && b.userAgent) || (caller.session && caller.session.userAgent) || '');
  const s  = createSession_(ward.kennitala, ward.role || 'member', false, ua);
  return okJ({
    member: publicMember_(ward),
    sessionToken: s.token,
    expiresAt: s.expiresAt,
    sessionId: s.id,
  });
}

function getMembers_(params) {
  params = params || {};
  const c = cGet_('members');
  const members = c || readAll_('members');
  if (!c) cPut_('members', members);
  // Strip the password hash so it's never served to the client. Leave a
  // `hasPassword` flag the UI reads to decide whether the member has
  // chosen their own password yet; admin-issued temps count as "not chosen".
  const sanitized = members.map(function(m) {
    const out = Object.assign({}, m);
    out.hasPassword = !!String(out.passwordHash || '').trim() && !bool_(out.passwordIsTemp);
    delete out.passwordHash;
    return out;
  });
  // Support optional pagination
  var offset = parseInt(params.offset) || 0;
  var limit  = parseInt(params.limit)  || 0;
  if (limit > 0) {
    var page = sanitized.slice(offset, offset + limit);
    return okJ({ members: page, total: sanitized.length });
  }
  return okJ({ members: sanitized });
}

function getMemberMap_() {
  let members = cGet_('members');
  if (!members) { members = readAll_('members'); cPut_('members', members); }
  const map = {};
  members.forEach(m => { map[String(m.kennitala)] = m; });
  return map;
}

function getBoatMap_(cfgMap) {
  const raw = getConfigValue_('boats', cfgMap || getConfigMap_());
  let boats = [];
  try { boats = JSON.parse(raw || '[]'); } catch (e) {}
  const map = {};
  boats.forEach(function(b) { map[b.id] = b; });
  return map;
}

function saveMember_(b, caller) {
  const ts = now_(), ex = b.id ? findOne_('members', 'id', b.id) : null;
  const isAdminCaller = isAdmin_(caller) || (caller && caller.__system);
  // Non-admin guardrails: members can only register new guests (used by the
  // member hub's walk-in flow). Anything else — editing any record, creating
  // non-guest members, role changes — is admin only.
  if (!isAdminCaller) {
    if (ex) return failJ('Admin only', 403);
    const desiredRole = String(b.role || '').toLowerCase();
    if (desiredRole && desiredRole !== 'guest') return failJ('Admin only', 403);
  }
  if (ex) {
    updateRow_('members', 'id', b.id, {
      name: b.name || ex.name, role: b.role || ex.role, email: b.email || '',
      phone: b.phone || '', birthYear: b.birthYear || '',
      isMinor: b.isMinor !== undefined ? bool_(b.isMinor) : ex.isMinor,
      guardianName: b.guardianName || '', guardianKennitala: b.guardianKennitala || '',
      guardianPhone: b.guardianPhone || '',
      initials: b.initials || ex.initials || extractInitials_(b.name || ex.name),
      active: b.active !== undefined ? bool_(b.active) : ex.active,
      updatedAt: ts,
    });
    cDel_('members');
    let guardianTemp = null;
    if (bool_(b.isMinor) && b.guardianKennitala) {
      const g = ensureGuardianRecord_(b.guardianKennitala, b.guardianName, b.guardianPhone);
      if (g && g.tempPassword) guardianTemp = { kennitala: g.kennitala, name: g.name, tempPassword: g.tempPassword };
    }
    const out = { id: b.id, updated: true };
    if (guardianTemp) out.guardianTempPassword = guardianTemp;
    return okJ(out);
  } else {
    const id = uid_();
    // Force role=guest for non-admin callers so a crafted payload can't sneak
    // a new admin/staff row past the outer authorise step.
    const role = isAdminCaller ? (b.role || 'member') : 'guest';
    addColIfMissing_('members', 'passwordHash');
    addColIfMissing_('members', 'passwordIsTemp');
    const tempPassword = genTempPassword_();
    insertRow_('members', {
      id, kennitala: b.kennitala, name: b.name, role: role,
      email: b.email || '', phone: b.phone || '', birthYear: b.birthYear || '',
      isMinor: bool_(b.isMinor) || false,
      guardianName: b.guardianName || '', guardianKennitala: b.guardianKennitala || '',
      guardianPhone: b.guardianPhone || '', active: true,
      certifications: '', initials: extractInitials_(b.name),
      passwordHash: hashPassword_(tempPassword), passwordIsTemp: true,
      createdAt: ts, updatedAt: ts,
    });
    cDel_('members');
    let guardianTemp = null;
    if (bool_(b.isMinor) && b.guardianKennitala) {
      const g = ensureGuardianRecord_(b.guardianKennitala, b.guardianName, b.guardianPhone);
      if (g && g.tempPassword) guardianTemp = { kennitala: g.kennitala, name: g.name, tempPassword: g.tempPassword };
    }
    const out = { id, created: true, tempPassword: tempPassword };
    if (guardianTemp) out.guardianTempPassword = guardianTemp;
    return okJ(out);
  }
}

function deleteMember_(id) {
  if (!id) return failJ('id required');
  updateRow_('members', 'id', id, { active: false, updatedAt: now_() });
  cDel_('members'); return okJ({ deleted: true });
}

function importMembers_(rows) {
  if (!Array.isArray(rows)) return failJ('rows array required');
  addColIfMissing_('members', 'passwordHash');
  addColIfMissing_('members', 'passwordIsTemp');
  const ts = now_(); let created = 0, updated = 0;
  const tempPasswords = [];
  rows.forEach(r => {
    const ex = findOne_('members', 'kennitala', String(r.kennitala || '').trim());
    if (ex) {
      updateRow_('members', 'kennitala', ex.kennitala, {
        name: r.name || ex.name, email: r.email || ex.email || '',
        phone: r.phone || ex.phone || '', role: r.role || ex.role || 'member',
        birthYear: r.birthYear || ex.birthYear || '',
        isMinor: r.isMinor !== undefined ? bool_(r.isMinor) : ex.isMinor,
        guardianName: r.guardianName || ex.guardianName || '',
        guardianKennitala: r.guardianKennitala || ex.guardianKennitala || '',
        guardianPhone: r.guardianPhone || ex.guardianPhone || '',
        initials: ex.initials || extractInitials_(r.name || ex.name),
        active: r.active !== undefined ? bool_(r.active) : ex.active,
        updatedAt: ts,
      });
      updated++;
    } else {
      const temp = genTempPassword_();
      const kt = String(r.kennitala).trim();
      insertRow_('members', {
        id: uid_(), kennitala: kt, name: r.name || '',
        role: r.role || 'member', email: r.email || '', phone: r.phone || '',
        birthYear: r.birthYear || '', isMinor: bool_(r.isMinor) || false,
        guardianName: r.guardianName || '', guardianKennitala: r.guardianKennitala || '',
        guardianPhone: r.guardianPhone || '', active: true,
        certifications: '', initials: extractInitials_(r.name),
        passwordHash: hashPassword_(temp), passwordIsTemp: true,
        createdAt: ts, updatedAt: ts,
      });
      tempPasswords.push({ kennitala: kt, name: r.name || '', tempPassword: temp });
      created++;
    }
  });
  cDel_('members');
  // Auto-provision guardian stubs for every minor in the import. Each
  // guardian gets its own temp password so the admin can relay it.
  rows.forEach(r => {
    if (bool_(r.isMinor) && r.guardianKennitala) {
      const g = ensureGuardianRecord_(r.guardianKennitala, r.guardianName, r.guardianPhone);
      if (g && g.tempPassword) {
        tempPasswords.push({ kennitala: g.kennitala, name: g.name, tempPassword: g.tempPassword });
      }
    }
  });
  return okJ({ created, updated, tempPasswords });
}

function deactivateMembers_(ids) {
  if (!Array.isArray(ids) || !ids.length) return failJ('ids array required');
  const ts = now_(); let count = 0;
  ids.forEach(id => {
    const ok = updateRow_('members', 'id', String(id), { active: false, updatedAt: ts });
    if (ok) count++;
  });
  cDel_('members'); return okJ({ deactivated: count });
}

function savePreferences_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  const kt = String(b.kennitala).trim();
  const ex = findOne_('members', 'kennitala', kt);
  if (!ex) return failJ('Member not found', 404);

  const updates = { updatedAt: now_() };

  // Initials override
  if (b.initials !== undefined) {
    updates.initials = String(b.initials || '').trim().toUpperCase() || extractInitials_(ex.name);
  }

  // Merge preferences JSON (windUnit, theme, statsVisibility, lang, …)
  // The default language now lives inside preferences rather than a separate column.
  let prefsObj = null;
  if (b.preferences !== undefined) {
    if (typeof b.preferences === 'string') {
      try { prefsObj = JSON.parse(b.preferences || '{}'); } catch (e) { prefsObj = {}; }
    } else {
      prefsObj = b.preferences || {};
    }
  }
  if (b.lang !== undefined) {
    const l = String(b.lang || '').toUpperCase();
    if (['EN', 'IS'].includes(l)) {
      if (!prefsObj) {
        try { prefsObj = JSON.parse(ex.preferences || '{}'); } catch (e) { prefsObj = {}; }
      }
      prefsObj.lang = l;
    }
  }
  if (prefsObj !== null) {
    updates.preferences = JSON.stringify(prefsObj);
  }

  updateRow_('members', 'kennitala', kt, updates);
  cDel_('members');
  return okJ({ saved: true });
}


// ═══════════════════════════════════════════════════════════════════════════════
// DAILY LOG
// ═══════════════════════════════════════════════════════════════════════════════

function getDailyLog_(date) {
  // Daily-log rows are keyed by the local date the user sees on the hub,
  // not by UTC. now_().slice(0,10) gave UTC, which wraps a day late for
  // any non-UTC script timezone — fine at UTC+0 (Iceland today) but wrong
  // anywhere else. nowLocalDate_() matches the format saveDailyLog_ writes.
  const d = date || nowLocalDate_();
  const log = findOne_('dailyLog', 'date', d);
  return okJ({ log: log || null, date: d });
}

function saveDailyLog_(b) {
  const ts = now_(), date = b.date || ts.slice(0, 10);
  const ex = findOne_('dailyLog', 'date', date);
  // Sync activities to their activity-type calendars. Mutates b.activities
  // in place so the stored JSON captures freshly-assigned gcalEventId values.
  if (b.activities !== undefined) {
    var oldActs = [];
    if (ex && ex.activities) { try { oldActs = JSON.parse(ex.activities); } catch (e) {} }
    syncDailyLogActivities_(date, oldActs, b.activities);
  }
  if (ex) {
    updateRow_('dailyLog', 'date', date, {
      openingChecks: b.openingChecks !== undefined ? JSON.stringify(b.openingChecks) : ex.openingChecks,
      closingChecks: b.closingChecks !== undefined ? JSON.stringify(b.closingChecks) : ex.closingChecks,
      activities: b.activities !== undefined ? JSON.stringify(b.activities) : ex.activities,
      weatherLog: b.weatherLog !== undefined ? b.weatherLog : ex.weatherLog,
      narrative: b.narrative !== undefined ? b.narrative : ex.narrative,
      tideData: b.tideData !== undefined ? JSON.stringify(b.tideData) : ex.tideData,
      signedOffBy: b.signedOffBy || ex.signedOffBy || '',
      signedOffAt: b.signedOffAt || ex.signedOffAt || '',
      updatedBy: b.updatedBy || '', updatedAt: ts,
    });
    return okJ({ date, updated: true });
  } else {
    insertRow_('dailyLog', {
      id: uid_(), date,
      openingChecks: JSON.stringify(b.openingChecks || []),
      closingChecks: JSON.stringify(b.closingChecks || []),
      activities: JSON.stringify(b.activities || []),
      weatherLog: b.weatherLog || '', narrative: b.narrative || '',
      tideData: JSON.stringify(b.tideData || {}),
      signedOffBy: b.signedOffBy || '', signedOffAt: b.signedOffAt || '',
      updatedBy: b.updatedBy || '', createdAt: ts, updatedAt: ts,
    });
    return okJ({ date, created: true });
  }
}


