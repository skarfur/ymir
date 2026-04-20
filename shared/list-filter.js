// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/list-filter.js
//
// State container for the "list + filter + edit modal" pattern. Pages keep
// ownership of their row/detail HTML (it's intentionally domain-specific);
// this helper owns filter state, predicate runs, search debounce, and the
// render trigger — the pieces every list page was reimplementing.
//
// ── Basic usage ──────────────────────────────────────────────────────────────
//   const lf = createListFilter({
//     source:   () => allTrips,
//     filters:  { boat: '', status: 'open' },      // initial state
//     predicate: (item, f) => {
//       if (f.boat   && item.boatId !== f.boat)   return false;
//       if (f.status && item.status !== f.status) return false;
//       if (f.search && !item.name.toLowerCase().includes(f.search.toLowerCase())) return false;
//       return true;
//     },
//     render:   items => renderRows(items),
//     onSearch: 250,                               // search-input debounce ms
//   });
//
// ── Wiring shortcut (autoWire) ───────────────────────────────────────────────
//   lf.autoWire({
//     fields: { fYear: 'yr', fCat: 'cat', fWind: 'wind' },  // elId → state key
//     search: 'fText',                                      // input → setSearch()
//   });
// Equivalent to adding change/input listeners by hand; skips any missing elements.
//
// ── Set-valued filters (multi-select pills) ──────────────────────────────────
// Initial state value can be a Set; toggleSetMember flips membership without
// the caller managing Set semantics:
//   lf.toggleSetMember('status', 'open');
//
// ── Lifecycle ────────────────────────────────────────────────────────────────
//   lf.refresh();   // re-run (e.g. after a POST updates the source)
//   lf.get();       // current filtered array
//   lf.getState();  // snapshot of filter state
// ═══════════════════════════════════════════════════════════════════════════════

;(function () {
  window.createListFilter = function (opts) {
    const source    = opts.source;
    const predicate = opts.predicate || (() => true);
    const render    = opts.render    || (() => {});
    const debounce  = opts.onSearch  || 200;
    const state     = Object.assign({ search: '' }, opts.filters || {});
    let   searchTid = null;
    let   lastOut   = [];

    function apply() {
      const arr = typeof source === 'function' ? (source() || []) : (source || []);
      lastOut = arr.filter(item => predicate(item, state));
      render(lastOut, state);
      return lastOut;
    }

    const api = {
      setFilter(key, val) { state[key] = val; apply(); },
      setFilters(patch)   { Object.assign(state, patch); apply(); },
      setSearch(val) {
        state.search = val;
        if (searchTid) clearTimeout(searchTid);
        searchTid = setTimeout(apply, debounce);
      },
      toggleSetMember(key, val) {
        if (!(state[key] instanceof Set)) state[key] = new Set();
        if (state[key].has(val)) state[key].delete(val);
        else                     state[key].add(val);
        apply();
      },
      refresh()  { apply(); return lastOut; },
      get()      { return lastOut; },
      getState() { return Object.assign({}, state); },
      // Live reference to the internal state (including Sets). Callers that
      // only read are fine; mutations bypass re-render — use setFilter /
      // toggleSetMember for writes.
      state()    { return state; },
      // Bind select/input elements to state keys in one call. Missing elements
      // are skipped (handy when a page hides certain filters conditionally).
      autoWire(cfg) {
        const fields = (cfg && cfg.fields) || {};
        Object.keys(fields).forEach(function (elId) {
          const el  = document.getElementById(elId);
          if (!el) return;
          const key = fields[elId];
          el.addEventListener('change', function () { api.setFilter(key, el.value); });
        });
        if (cfg && cfg.search) {
          const searchEl = document.getElementById(cfg.search);
          if (searchEl) searchEl.addEventListener('input', function () { api.setSearch(searchEl.value); });
        }
        return api;
      },
    };
    return api;
  };
})();
