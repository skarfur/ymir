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
    googleEmail: m.googleEmail || '',
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
// GOOGLE SIGN-IN
// ─────────────────────────────────────────────────────────────────────────────

// Verify a Google ID token by calling Google's tokeninfo endpoint. Returns
// the decoded payload on success, or null if the token is missing, expired,
// issued for a different client, or fails any other check. We hit tokeninfo
// instead of parsing the JWT locally because Apps Script has no ergonomic
// JWKS verifier, and tokeninfo already validates the signature for us.
function verifyGoogleIdToken_(idToken) {
  const token = String(idToken || '').trim();
  if (!token) return null;
  const expectedAud = String(
    PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID') || ''
  ).trim();
  if (!expectedAud) {
    throw new Error('Google sign-in not configured (GOOGLE_CLIENT_ID missing)');
  }
  let payload = null;
  try {
    const resp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return null;
    payload = JSON.parse(resp.getContentText() || '{}');
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  // aud must match our OAuth client.
  if (String(payload.aud || '') !== expectedAud) return null;
  // iss must be a Google issuer.
  const iss = String(payload.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') return null;
  // exp is in seconds since epoch. Reject if missing or in the past.
  const exp = parseInt(payload.exp, 10);
  if (!exp || exp * 1000 < Date.now()) return null;
  // Require a verified email.
  if (!payload.email) return null;
  const verified = String(payload.email_verified || '').toLowerCase();
  if (verified !== 'true' && payload.email_verified !== true) return null;
  payload.email = String(payload.email).trim().toLowerCase();
  return payload;
}

// Normalise an email for Google-link comparison. Lowercase + trim. We don't
// collapse Gmail dots (f.oo@gmail.com ≠ foo@gmail.com here) because Google's
// ID-token `email` claim returns the address the user actually registered
// with, so stripping dots on our side would create false matches.
function normGoogleEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

// True iff the email is a personal Gmail address. @gmail.com and
// @googlemail.com are Google Accounts by definition — no MX check needed.
function isGmailAddress_(email) {
  return /@(gmail|googlemail)\.com$/.test(normGoogleEmail_(email));
}

// Check the email's domain for MX records pointing at Google (Workspace).
// Uses Google's DNS-over-HTTPS endpoint so Apps Script can resolve without
// a real resolver. Cached per-domain for 24h in the script cache — a fresh
// import of 500 members with 20 unique domains only costs 20 lookups.
// Returns true only on a clean, signed match; any failure mode (timeout,
// non-200, malformed JSON) returns false so we silently fall back to
// manual linking rather than mis-populate.
function mxPointsToGoogle_(domain) {
  var d = String(domain || '').trim().toLowerCase();
  if (!d) return false;
  var cache = CacheService.getScriptCache();
  var cacheKey = 'mxGoogle:' + d;
  var cached = cache.get(cacheKey);
  if (cached === 'y') return true;
  if (cached === 'n') return false;
  var isGoogle = false;
  try {
    var resp = UrlFetchApp.fetch(
      'https://dns.google/resolve?name=' + encodeURIComponent(d) + '&type=MX',
      { muteHttpExceptions: true, followRedirects: false }
    );
    if (resp.getResponseCode() === 200) {
      var body = JSON.parse(resp.getContentText() || '{}');
      // Status 0 = NOERROR. Anything else (NXDOMAIN, SERVFAIL) → false.
      if (body.Status === 0 && Array.isArray(body.Answer)) {
        isGoogle = body.Answer.some(function(a) {
          var txt = String(a.data || '').toLowerCase();
          // MX data is "<preference> <hostname>." — match the hostname
          // suffix so aspmx.l.google.com., alt1.aspmx.l.google.com.,
          // googlemail.l.google.com., etc. all count.
          return /\s(\S*\.)?google(mail)?\.com\.?\s*$/.test(' ' + txt);
        });
      }
    }
  } catch (e) { /* fall through to false */ }
  cache.put(cacheKey, isGoogle ? 'y' : 'n', 86400);
  return isGoogle;
}

// If the email looks like it's backed by a Google account (personal Gmail
// or a Workspace domain whose MX is Google), return the normalised email
// so it can be stored in googleEmail for auto-link. Otherwise return ''.
function resolveGoogleEmail_(email) {
  var e = normGoogleEmail_(email);
  if (!e) return '';
  if (isGmailAddress_(e)) return e;
  var at = e.lastIndexOf('@');
  if (at < 0) return '';
  var domain = e.slice(at + 1);
  if (mxPointsToGoogle_(domain)) return e;
  return '';
}

// Pick the value to write into `googleEmail` for a create or update: an
// explicit CSV/payload value wins; otherwise keep an already-linked value;
// otherwise try to auto-resolve from the row's primary email. Keeps
// re-imports from clobbering a manual link in settings.
function pickGoogleEmail_(explicit, existing, sourceEmail) {
  var e = normGoogleEmail_(explicit);
  if (e) return e;
  var ex = normGoogleEmail_(existing);
  if (ex) return ex;
  return resolveGoogleEmail_(sourceEmail);
}

// Public sign-in via a Google ID token. The frontend's GIS one-tap flow
// posts the credential here; we verify it, look up a member by their
// previously-linked googleEmail, and mint a session. Unlinked members are
// rejected with a specific code so the UI can tell the user to sign in with
// their password first and link from settings.
function loginWithGoogle_(b) {
  const idToken = String((b && b.idToken) || '');
  const stay    = bool_(b && b.stayLoggedIn);
  const ua      = String((b && b.userAgent) || '');
  const payload = verifyGoogleIdToken_(idToken);
  if (!payload) return failJ('Invalid Google token', 401);
  const email = payload.email;

  addColIfMissing_('members', 'googleEmail');
  const m = findOne_('members', 'googleEmail', email);
  if (!m) return failJ('Google account not linked', 404);
  if (!bool_(m.active)) return failJ('Inactive account', 403);

  clearLoginAttempts_(m.kennitala);
  const session = createSession_(m.kennitala, m.role || 'member', stay, ua);
  const wards = bool_(m.isMinor) ? [] : findWardsOf_(m.kennitala);
  // The temp-password-rotation prompt is only meaningful when the user actually
  // authenticated with that password. A Google OAuth sign-in is its own trust
  // path, so don't nag them about a password they never used.
  return okJ({
    member: publicMember_(m),
    wards: wards,
    usingDefaultPassword: false,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    sessionId: session.id,
  });
}

// Link a Google account to the caller's member record. Requires an
// authenticated session (bootstraps the trust chain through the existing
// password login), verifies the supplied ID token, and refuses to link an
// email that's already attached to a different member.
function linkGoogleAccount_(b, caller) {
  if (!caller) return failJ('Unauthorized', 401);
  const idToken = String((b && b.idToken) || '');
  const payload = verifyGoogleIdToken_(idToken);
  if (!payload) return failJ('Invalid Google token', 403);
  const email = payload.email;

  addColIfMissing_('members', 'googleEmail');
  const existing = findOne_('members', 'googleEmail', email);
  if (existing && String(existing.kennitala) !== caller.kennitala) {
    return failJ('Google account already linked to another member', 409);
  }
  updateRow_('members', 'kennitala', caller.kennitala, {
    googleEmail: email,
    updatedAt: now_(),
  });
  cDel_('members');
  return okJ({ linked: true, googleEmail: email });
}

// Remove the Google link from the caller's member record. Password login
// keeps working either way; this is just the "disconnect" side of the link.
function unlinkGoogleAccount_(b, caller) {
  if (!caller) return failJ('Unauthorized', 401);
  addColIfMissing_('members', 'googleEmail');
  updateRow_('members', 'kennitala', caller.kennitala, {
    googleEmail: '',
    updatedAt: now_(),
  });
  cDel_('members');
  return okJ({ unlinked: true });
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
    if (!verifyPassword_(m, cur)) return failJ('Current password incorrect', 403);
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
    addColIfMissing_('members', 'googleEmail');
    const tempPassword = genTempPassword_();
    const emailVal = b.email || '';
    insertRow_('members', {
      id, kennitala: b.kennitala, name: b.name, role: role,
      email: emailVal, phone: b.phone || '', birthYear: b.birthYear || '',
      isMinor: bool_(b.isMinor) || false,
      guardianName: b.guardianName || '', guardianKennitala: b.guardianKennitala || '',
      guardianPhone: b.guardianPhone || '', active: true,
      certifications: '', initials: extractInitials_(b.name),
      passwordHash: hashPassword_(tempPassword), passwordIsTemp: true,
      googleEmail: pickGoogleEmail_(b.googleEmail, '', emailVal),
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
  addColIfMissing_('members', 'googleEmail');
  const ts = now_(); let created = 0, updated = 0;
  const tempPasswords = [];
  rows.forEach(r => {
    const ex = findOne_('members', 'kennitala', String(r.kennitala || '').trim());
    if (ex) {
      const emailVal = r.email || ex.email || '';
      updateRow_('members', 'kennitala', ex.kennitala, {
        name: r.name || ex.name, email: emailVal,
        phone: r.phone || ex.phone || '', role: r.role || ex.role || 'member',
        birthYear: r.birthYear || ex.birthYear || '',
        isMinor: r.isMinor !== undefined ? bool_(r.isMinor) : ex.isMinor,
        guardianName: r.guardianName || ex.guardianName || '',
        guardianKennitala: r.guardianKennitala || ex.guardianKennitala || '',
        guardianPhone: r.guardianPhone || ex.guardianPhone || '',
        initials: ex.initials || extractInitials_(r.name || ex.name),
        active: r.active !== undefined ? bool_(r.active) : ex.active,
        googleEmail: pickGoogleEmail_(r.googleEmail, ex.googleEmail, emailVal),
        updatedAt: ts,
      });
      updated++;
    } else {
      const temp = genTempPassword_();
      const kt = String(r.kennitala).trim();
      const emailVal = r.email || '';
      insertRow_('members', {
        id: uid_(), kennitala: kt, name: r.name || '',
        role: r.role || 'member', email: emailVal, phone: r.phone || '',
        birthYear: r.birthYear || '', isMinor: bool_(r.isMinor) || false,
        guardianName: r.guardianName || '', guardianKennitala: r.guardianKennitala || '',
        guardianPhone: r.guardianPhone || '', active: true,
        certifications: '', initials: extractInitials_(r.name),
        passwordHash: hashPassword_(temp), passwordIsTemp: true,
        googleEmail: pickGoogleEmail_(r.googleEmail, '', emailVal),
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
  // Concrete activity rows for this date from scheduled_events. Populated
  // into the dailyLog DTO's `activities` field (as a JSON string) so the
  // frontend contract is preserved — see dailylog.js `applyLogData`.
  var activityRows = [];
  try {
    activityRows = sched_listActivitiesForDate_(d).map(_schedActivityToLogShape_);
  } catch (e) { activityRows = []; }
  // Projected activities from activity-type templates (bulk schedule or
  // linked Google Calendar) that haven't been materialized yet. See
  // projectActivitiesForDate_ in config.gs. Excludes any projection whose
  // id already exists as a concrete row.
  var scheduledActivities = [];
  try {
    var materialized = {};
    activityRows.forEach(function (a) { if (a && a.id) materialized[a.id] = true; });
    // Cancelled tombstones aren't returned by sched_listActivitiesForDate_
    // (it filters status !== 'cancelled'), but they still need to suppress
    // their matching projection virtual. Union the cancelled ids in.
    try {
      (readAll_('scheduledEvents') || []).forEach(function (r) {
        if (r && r.kind === 'activity' && r.date === d
            && r.status === 'cancelled' && r.id) {
          materialized[r.id] = true;
        }
      });
    } catch (e) {}
    scheduledActivities = (projectActivitiesForDate_(d) || [])
      .filter(function (a) { return a && a.id && !materialized[a.id]; });
  } catch (e) { scheduledActivities = []; }
  var logDto = log ? Object.assign({}, log, { activities: JSON.stringify(activityRows) }) : null;
  return okJ({ log: logDto, date: d, scheduledActivities: scheduledActivities });
}

// Convert a scheduled_events row (kind='activity') into the daily-log activity
// shape the frontend already knows how to render.
function _schedActivityToLogShape_(a) {
  return {
    id:              a.id,
    activityTypeId:  a.activityTypeId || '',
    subtypeId:       a.subtypeId || '',
    subtypeName:     a.subtypeName || '',
    type:            a.title || '',
    name:            a.title || '',
    start:           a.startTime || '',
    end:             a.endTime || '',
    participants:    a.participants || '',
    notes:           a.notes || '',
    leaderMemberId:  a.leaderMemberId || '',
    leaderName:      a.leaderName || '',
    leaderPhone:     a.leaderPhone || '',
    showLeaderPhone: a.showLeaderPhone === true || a.showLeaderPhone === 'true',
    gcalEventId:     a.gcalEventId || '',
  };
}

function saveDailyLog_(b) {
  const ts = now_(), date = b.date || ts.slice(0, 10);
  const ex = findOne_('dailyLog', 'date', date);
  // Persist activities into scheduled_events (kind='activity'). Each activity
  // gets its own row keyed by id; sync to activity-type calendars happens
  // inside syncDailyLogActivities_.
  if (b.activities !== undefined) {
    var oldRows = sched_listActivitiesForDate_(date);
    persistDailyLogActivities_(date, oldRows, b.activities || [], b.updatedBy || '');
  }
  // The `activities` column on dailyLog is now unread (authoritative source is
  // scheduled_events). We still write an empty JSON array to the column so the
  // sheet row shape stays clean, but the frontend gets activities from the
  // new table via getDailyLog_.
  if (ex) {
    // Note: `activities` column is intentionally omitted from the update —
    // authoritative activities live in scheduled_events now, and leaving the
    // legacy column untouched preserves pre-cutover data as a rollback safety.
    updateRow_('dailyLog', 'date', date, {
      openingChecks: b.openingChecks !== undefined ? JSON.stringify(b.openingChecks) : ex.openingChecks,
      closingChecks: b.closingChecks !== undefined ? JSON.stringify(b.closingChecks) : ex.closingChecks,
      weatherLog: b.weatherLog !== undefined ? JSON.stringify(b.weatherLog) : ex.weatherLog,
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
      openingChecks: JSON.stringify(b.openingChecks || {}),
      closingChecks: JSON.stringify(b.closingChecks || {}),
      activities: '[]',
      weatherLog: JSON.stringify(b.weatherLog || []),
      narrative: b.narrative || '',
      tideData: JSON.stringify(b.tideData || {}),
      signedOffBy: b.signedOffBy || '', signedOffAt: b.signedOffAt || '',
      updatedBy: b.updatedBy || '', createdAt: ts, updatedAt: ts,
    });
    return okJ({ date, created: true });
  }
}

// Upsert each activity from the frontend's saved daily log into scheduled_events
// as kind='activity' rows. Deletes rows whose id vanished from the new list.
// Handles per-activity GCal sync via syncDailyLogActivities_ before writing so
// that the assigned gcalEventId is persisted on the row.
function persistDailyLogActivities_(dateISO, oldRows, newActs, updatedBy) {
  // Run GCal sync over the shape the frontend sent (plain daily-log activity
  // objects) so the existing writer populates gcalEventId on each row.
  // newActs is mutated in place.
  try {
    var oldForGcal = (oldRows || []).map(function (r) {
      return { id: r.id, activityTypeId: r.activityTypeId, gcalEventId: r.gcalEventId };
    });
    syncDailyLogActivities_(dateISO, oldForGcal, newActs);
  } catch (e) { Logger.log('persistDailyLogActivities_ gcal sync failed: ' + e); }
  var nextIds = {};
  var todayIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var status = dateISO < todayIso ? 'completed' : 'upcoming';
  (newActs || []).forEach(function (a) {
    if (!a || !a.id) return;
    nextIds[a.id] = true;
    sched_upsert_({
      id:              a.id,
      kind:            'activity',
      status:          status,
      source:          _inferActivitySource_(a),
      date:            dateISO,
      startTime:       a.start || a.startTime || '',
      endTime:         a.end   || a.endTime   || '',
      activityTypeId:  a.activityTypeId || '',
      subtypeId:       a.subtypeId || '',
      subtypeName:     a.subtypeName || '',
      title:           a.name || a.type || '',
      titleIS:         '',
      notes:           a.notes || '',
      notesIS:         '',
      participants:    a.participants || '',
      leaderMemberId:  a.leaderMemberId || '',
      leaderName:      a.leaderName || '',
      leaderPhone:     a.leaderPhone || '',
      showLeaderPhone: a.showLeaderPhone === true || a.showLeaderPhone === 'true',
      gcalEventId:     a.gcalEventId || '',
      dailyLogDate:    dateISO,
      updatedBy:       updatedBy || '',
    });
  });
  // Drop rows whose id is no longer in the saved set.
  (oldRows || []).forEach(function (old) {
    if (!old || !old.id) return;
    if (nextIds[old.id]) return;
    sched_hardDelete_(old.id);
  });
}

function _inferActivitySource_(a) {
  var id = String(a && a.id || '');
  if (id.indexOf('gcal-')  === 0) return 'calendar';
  if (id.indexOf('sched-') === 0) return 'bulk';
  return 'daily-log';
}

// ── Midnight materialization ─────────────────────────────────────────────────
// Time-driven trigger: at local midnight, insert a dailyLog row for the day
// that just ended if none exists. Snapshots the bulk-scheduled activities so
// subsequent edits to a bulk schedule don't silently rewrite historical days.
// No-op when a row already exists (manually saved or signed off).
//
// Install once from the Apps Script editor:
//   setupDailyLogMidnightTrigger()
function materializeYesterday_() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  var dateISO = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  // Freeze each projected activity into scheduled_events so the day is
  // captured even if nobody opened the daily log. Idempotent — sched_upsert_
  // is keyed by id. Checklist metadata still lives on the dailyLog row; if
  // the row is missing, create an empty one so the daily-log page has a
  // shell to render against.
  var scheduled = [];
  try { scheduled = projectActivitiesForDate_(dateISO); } catch (e) { scheduled = []; }
  if (!scheduled.length && findOne_('dailyLog', 'date', dateISO)) return;
  if (scheduled.length) {
    persistDailyLogActivities_(dateISO, sched_listActivitiesForDate_(dateISO), scheduled, 'auto:midnight');
  }
  if (!findOne_('dailyLog', 'date', dateISO)) {
    var ts = now_();
    insertRow_('dailyLog', {
      id: uid_(), date: dateISO,
      openingChecks: '{}', closingChecks: '{}',
      activities: '[]',
      weatherLog: '[]', narrative: '',
      tideData: '{}',
      signedOffBy: '', signedOffAt: '',
      updatedBy: 'auto:midnight', createdAt: ts, updatedAt: ts,
    });
  }
}

function setupDailyLogMidnightTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'materializeYesterday_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('materializeYesterday_').timeBased().atHour(0).everyDays(1).create();
  Logger.log('Daily-log midnight materializer registered.');
}


