#!/usr/bin/env node
// Parity check for shared/strings-en.js and shared/strings-is.js.
// Extracts "key": entries from each file (simple regex — both files are
// flat object literals) and diffs the key sets. Exits non-zero with a
// human-readable diff if they differ. Safe to wire into CI.
'use strict';

const fs = require('fs');
const path = require('path');

function extractKeys(file) {
  const text = fs.readFileSync(file, 'utf8');
  const keys = new Set();
  const re = /^\s*"([^"]+)":/gm;
  let m;
  while ((m = re.exec(text))) keys.add(m[1]);
  return keys;
}

const en = extractKeys(path.join(__dirname, '..', 'shared', 'strings-en.js'));
const is = extractKeys(path.join(__dirname, '..', 'shared', 'strings-is.js'));

const missingInIs = [...en].filter(k => !is.has(k)).sort();
const missingInEn = [...is].filter(k => !en.has(k)).sort();

if (!missingInIs.length && !missingInEn.length) {
  console.log(`OK — ${en.size} keys, both files in sync.`);
  process.exit(0);
}

if (missingInIs.length) {
  console.error(`Missing in strings-is.js (${missingInIs.length}):`);
  missingInIs.forEach(k => console.error(`  ${k}`));
}
if (missingInEn.length) {
  console.error(`\nMissing in strings-en.js (${missingInEn.length}):`);
  missingInEn.forEach(k => console.error(`  ${k}`));
}
process.exit(1);
