// Runs synchronously during HTML parse to set data-theme on <html> before
// the first paint, so dark-mode users don't see a light→dark flash when
// navigating between pages. The full theme helpers (getTheme/setTheme/
// applyTheme) live in api.js (deferred); this just primes the attribute
// early. Keep it tiny — it's render-blocking by design.
(function () {
  try {
    var t = localStorage.getItem('ymirTheme') || 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
