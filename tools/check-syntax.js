#!/usr/bin/env node
// Parse-only syntax check for every .js under shared/, every portal's <portal>.js,
// every .gs at the repo root, and scripts under tools/. Exits non-zero with a
// per-file error list if anything fails to parse. CI-ready.
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|gs)$/.test(entry.name)) out.push(full);
  }
}

const root = path.resolve(__dirname, '..');
const files = [];
walk(root, files);

const failures = [];
for (const f of files) {
  // node --check wants .js or .mjs; .gs files are syntactically JS, so
  // copy-through via stdin trick is avoided by making a temp .js alias.
  const rel = path.relative(root, f);
  try {
    if (f.endsWith('.gs')) {
      // node --check via a temp .js file with identical content.
      const tmp = path.join('/tmp', 'syntaxcheck-' + Date.now() + '.js');
      fs.writeFileSync(tmp, fs.readFileSync(f));
      try {
        execSync(`node --check ${JSON.stringify(tmp)}`, { stdio: 'pipe' });
      } finally {
        try { fs.unlinkSync(tmp); } catch (_) {}
      }
    } else {
      execSync(`node --check ${JSON.stringify(f)}`, { stdio: 'pipe' });
    }
  } catch (e) {
    failures.push({ file: rel, err: (e.stderr || e.stdout || e.message || '').toString().trim() });
  }
}

if (!failures.length) {
  console.log(`OK — ${files.length} files parsed clean.`);
  process.exit(0);
}
console.error(`FAILED — ${failures.length} of ${files.length} files did not parse:\n`);
for (const { file, err } of failures) {
  console.error(`• ${file}`);
  for (const line of err.split('\n').slice(0, 3)) console.error(`    ${line}`);
}
process.exit(1);
