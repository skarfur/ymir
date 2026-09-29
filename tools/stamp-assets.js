#!/usr/bin/env node
// tools/stamp-assets.js — cache-bust a portal's local <script src> and
// <link href> references by setting ?v=<stamp> on each one.
//
// GitHub Pages lets browsers cache .js/.css for ~10 minutes. Without a
// version query, a deploy can pair a fresh index.html with a stale script
// (e.g. new markup calling a function the cached script doesn't define).
// Re-run this for a portal whenever you change any of its JS/CSS:
//
//   node tools/stamp-assets.js admin/index.html [other/index.html …]
//
// Only relative (local) .js/.css URLs are touched; CDN URLs (unpkg, with
// SRI hashes) are left alone. The stamp is the current UTC time
// (YYYYMMDDHHMM), so every run produces a new version. Zero dependencies.

const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/stamp-assets.js <page.html> [more.html …]');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const ATTR_RE = /(<(?:script|link)\b[^>]*?\s(?:src|href)=")([^"]+)(")/g;

files.forEach(function (file) {
  const abs = path.resolve(file);
  const html = fs.readFileSync(abs, 'utf8');
  let n = 0;
  const out = html.replace(ATTR_RE, function (m, pre, url, post) {
    if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith('data:')) return m;
    const bare = url.replace(/\?v=[^&#"]*/, '').replace(/\?$/, '');
    if (!/\.(?:js|css)$/.test(bare.split('#')[0])) return m;
    n++;
    return pre + bare + '?v=' + stamp + post;
  });
  fs.writeFileSync(abs, out);
  console.log(file + ': stamped ' + n + ' reference(s) with v=' + stamp);
});
