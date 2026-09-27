-- Backfills the structured access_gate for the three boats that only had
-- the legacy flat access_gate_cert set (a bare subcat key, not a real
-- cert_defs.id) -- Sif, Gulla ('captain' -> cert_mn9l9294/captain) and
-- Vogun ('released_rower' -> cert_75585c0f3db745a1/released_rower).
-- member_satisfies_boat_gate_() (fixed in
-- 20260927184453_fix_boat_gate_legacy_cert.sql) already resolves the bare
-- legacy string correctly at read time, so this isn't required for
-- correctness -- it's cleanup so these three boats match every other
-- boat's data shape (structured access_gate + access_gate_cert mirroring
-- its certId), same as re-saving each one from the admin Boats tab would
-- now produce with that migration's admin/boats.js fix.
update public.boats
set access_gate = jsonb_build_object('certId', 'cert_mn9l9294', 'sub', 'captain'),
    access_gate_cert = 'cert_mn9l9294'
where id in ('dc9f9a83-9293-5066-b49b-7d9bdec1c68f', 'd4cf3410-5fbb-546c-b16d-2f44635bd5b0')
  and access_gate is null and access_gate_cert = 'captain';

update public.boats
set access_gate = jsonb_build_object('certId', 'cert_75585c0f3db745a1', 'sub', 'released_rower'),
    access_gate_cert = 'cert_75585c0f3db745a1'
where id = '18fbbc4a-bb0f-5c37-9865-82c7f09ecba5'
  and access_gate is null and access_gate_cert = 'released_rower';
