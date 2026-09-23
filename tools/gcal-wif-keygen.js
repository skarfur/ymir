#!/usr/bin/env node
// gcal-wif-keygen.js — run locally by tools/gcal-wif-setup.sh, not part of
// the deployed app. Generates a fresh ES256 (P-256) keypair for the Google
// Calendar Workload Identity Federation flow (see
// supabase/functions/_shared/gcal.ts).
//
// The PUBLIC half is written to jwks.json in this directory — that file is
// not sensitive (it's a public key) and gets handed to Google via
// `gcloud ... providers create-oidc --jwk-json-path=jwks.json`.
//
// The PRIVATE half is written ONLY to stdout, as a single line of JSON,
// and never touches disk here — the caller (gcal-wif-setup.sh) captures it
// straight into a shell variable and passes it directly as a
// `supabase secrets set` argument, so it's never written to a file or left
// in shell history via redirection.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const kid = crypto.randomBytes(8).toString('hex');

const pubJwk = publicKey.export({ format: 'jwk' });
const privJwk = privateKey.export({ format: 'jwk' });

pubJwk.kid = kid;
pubJwk.use = 'sig';
pubJwk.alg = 'ES256';
privJwk.kid = kid;
privJwk.use = 'sig';
privJwk.alg = 'ES256';

const jwksPath = path.join(__dirname, 'jwks.json');
fs.writeFileSync(jwksPath, JSON.stringify({ keys: [pubJwk] }, null, 2) + '\n');
process.stderr.write('Wrote public JWKS to ' + jwksPath + ' (kid ' + kid + ')\n');

process.stdout.write(JSON.stringify(privJwk));
