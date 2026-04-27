// ÝMIR — shared/strings.js
//
// Loads the language-specific strings file (strings-en.js or strings-is.js)
// and exposes s() + applyStrings(). Pages include just this one script.
//
// Note: document.write() is still the simplest way to inject a synchronous
// <script> during parse so _STRINGS_FLAT is ready before downstream JS runs.
// The modern alternatives (dynamic <script> append, top-level await) don't
// preserve parse order with non-module pages, and rewriting all pages to
// modules is out of scope.
;(function () {
  if (typeof _STRINGS_FLAT !== 'undefined') return;  // already loaded
  var here = document.currentScript && document.currentScript.src;
  var base = here ? here.substring(0, here.lastIndexOf('/') + 1) : '';
  var lang = (localStorage.getItem('ymirLang') || 'IS').toLowerCase();
  if (lang !== 'en' && lang !== 'is') lang = 'is';
  // Sync <html lang> to the active UI language so screen readers, search
  // engines, and browser translation prompts pick the right language. The
  // static lang= in each portal's HTML head is a placeholder — this is
  // the canonical value. Runs before the language file loads so any
  // server-rendered lang-aware text (none today, but future-proof) is
  // consistent with the strings about to be applied.
  try { document.documentElement.lang = lang; } catch (e) {}
  document.write('<script src="' + base + 'strings-' + lang + '.js"><\/script>');
})();

window.s = function s(key, vars, lang) {
  // If a specific language is requested that differs from loaded, fall back to key
  if (typeof _STRINGS_FLAT === 'undefined') {
    console.warn('[strings] _STRINGS_FLAT not loaded; language file may be missing');
    return key;
  }
  var str = _STRINGS_FLAT[key];
  if (str === undefined) {
    console.warn('[strings] missing key:', key);
    return key;
  }
  if (vars) {
    str = str.replace(/\{(\w+)\}/g, function(_, k) { return vars[k] !== undefined ? vars[k] : '{' + k + '}'; });
  }
  return str;
};

// Read a bilingual field from a row: prefer the active-language variant,
// fall back to the other one when the preferred is blank. Convention:
// English lives in `key`, Icelandic in `key + 'IS'`.
window.localizedField = function localizedField(row, key) {
  if (!row) return '';
  var lang = (localStorage.getItem('ymirLang') || 'IS').toUpperCase();
  if (lang === 'IS') return row[key + 'IS'] || row[key] || '';
  return row[key] || row[key + 'IS'] || '';
};

window.applyStrings = function applyStrings(root) {
  var scope = root || document;
  scope.querySelectorAll('[data-s]').forEach(function(el) {
    var key  = el.dataset.s;
    var attr = el.dataset.sAttr;
    var val  = window.s(key);
    if (attr) el.setAttribute(attr, val);
    else      el.textContent = val;
  });
  // Icon-only buttons: set aria-label/title without touching innerHTML.
  scope.querySelectorAll('[data-s-aria]').forEach(function(el) {
    el.setAttribute('aria-label', window.s(el.dataset.sAria));
  });
  scope.querySelectorAll('[data-s-title]').forEach(function(el) {
    el.title = window.s(el.dataset.sTitle);
  });
  // Lucide icons: inject SVG into elements with data-icon="<name>" once.
  if (typeof window.icon === 'function') {
    scope.querySelectorAll('[data-icon]').forEach(function(el) {
      if (el.dataset.iconApplied) return;
      var svg = window.icon(el.dataset.icon);
      if (svg) { el.innerHTML = svg; el.dataset.iconApplied = '1'; }
    });
  }
};
