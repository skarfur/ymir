-- share_tokens.id was declared uuid with a gen_random_uuid() default, but
-- createShareToken_ mints an 8-char base62 code via shareUid_() and that
-- code IS the id — it's embedded directly in the public share URL
-- (?share=<id>) and looked up as-is by public.gs's findOne_('shareTokens',
-- 'id', tokenId). A uuid column can't hold it. Same "declared one type,
-- actually needs another" bug as trips.verified_by and friends, just on
-- a primary key this time.
alter table share_tokens alter column id drop default;
alter table share_tokens alter column id type text using id::text;

-- getShareTokens_/revokeShareToken_/deleteShareToken_ all filter/authorize
-- by memberKennitala directly, not by a resolved member_id join.
alter table share_tokens add column member_kennitala text;
