// ═══════════════════════════════════════════════════════════════════════════════
// SHARE TOKEN CRUD  (authenticated — requires API_TOKEN_)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Members mint share tokens to grant a third party (coach, parent, etc.)
// read-only access to their logbook up to a cut-off date. The public-read
// side lives in `public.gs` (server-rendered HTML); `shareUid_` is in
// `code.gs` alongside the other id primitives.

function getShareTokens_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  const all = readAll_('shareTokens');
  const tokens = all.filter(t => String(t.memberKennitala) === String(b.kennitala));
  return okJ({ tokens });
}

function createShareToken_(b) {
  if (!b.kennitala) return failJ('kennitala required');
  const member = findOne_('members', 'kennitala', String(b.kennitala).trim());
  if (!member) return failJ('Member not found', 404);
  const id = shareUid_();
  const ts = now_();
  insertRow_('shareTokens', {
    id,
    memberId: member.id,
    memberKennitala: member.kennitala,
    cutOffDate: ts.slice(0, 10),
    createdAt: ts,
    revokedAt: '',
    accessCount: 0,
    lastAccessedAt: '',
    includePhotos: b.includePhotos !== false && b.includePhotos !== 'false',
    includeTracks: b.includeTracks !== false && b.includeTracks !== 'false',
    categories: b.categories || '',
  });
  return okJ({ id, created: true });
}

function revokeShareToken_(b) {
  if (!b.tokenId) return failJ('tokenId required');
  if (!b.kennitala) return failJ('kennitala required');
  const token = findOne_('shareTokens', 'id', b.tokenId);
  if (!token) return failJ('Token not found', 404);
  if (String(token.memberKennitala) !== String(b.kennitala)) return failJ('Not authorised', 403);
  updateRow_('shareTokens', 'id', b.tokenId, { revokedAt: now_() });
  return okJ({ revoked: true });
}

function deleteShareToken_(b) {
  if (!b.tokenId) return failJ('tokenId required');
  if (!b.kennitala) return failJ('kennitala required');
  const token = findOne_('shareTokens', 'id', b.tokenId);
  if (!token) return failJ('Token not found', 404);
  if (String(token.memberKennitala) !== String(b.kennitala)) return failJ('Not authorised', 403);
  deleteRow_('shareTokens', 'id', b.tokenId);
  return okJ({ deleted: true });
}
