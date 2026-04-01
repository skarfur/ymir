// ÝMIR — shared/strings.js (loader)
// Language-specific strings are loaded from strings-en.js or strings-is.js.
// This file provides the s() and applyStrings() functions.

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

window.applyStrings = function applyStrings(root) {
  (root || document).querySelectorAll('[data-s]').forEach(function(el) {
    var key  = el.dataset.s;
    var attr = el.dataset.sAttr;
    var val  = window.s(key);
    if (attr) el.setAttribute(attr, val);
    else      el.textContent = val;
  });
};
