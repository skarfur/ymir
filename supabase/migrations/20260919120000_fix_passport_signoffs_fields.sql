-- passport_signoffs.revoked_by was declared as a member uuid FK, but
-- coxswain.js sends revokedBy: user.name (a free-text display name) —
-- same wrong-FK-type bug as trips.verified_by and friends. signer_name
-- was missing entirely even though signPassportItem_ always writes it
-- and get-rowing-passport's computeProgress already reads it.
alter table passport_signoffs drop column revoked_by;
alter table passport_signoffs add column revoked_by text;
alter table passport_signoffs add column signer_name text;
