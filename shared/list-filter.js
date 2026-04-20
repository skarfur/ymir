// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/list-filter.js
//
// Lightweight state container for the "list + filter + edit modal" pattern
// used on logbook, captain, incidents, maintenance, and dailylog. Pages keep
// ownership of their row/detail HTML (it is intentionally domain-specific);
// this helper removes the boilerplate of tracking filter values, running the
// predicate, debouncing search, and triggering a re-render.
//
// Usage:
//   const lf = createListFilter({
//     source:   () => allTrips,            // array accessor
//     filters:  { boat: '', status: 'open' },  // initial filter state
//     predicate: (item, f) => {
//       if (f.boat   && item.boatId !== f.boat)   return false;
//       if (f.status && item.status !== f.status) return false;
//       if (f.search && !item.name.toLowerCase().includes(f.search.toLowerCase())) return false;
//       return true;
//     },
//     render:   items => renderRows(items),
//     onSearch: 250,                       // debounce ms (default 200)
//   });
//   lf.setFilter('boat', boatId);          // triggers render
//   lf.setSearch(input.value);             // debounced
//   lf.refresh();                          // force re-run (e.g. after POST)
//   lf.get();                              // current filtered array
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

    return {
      setFilter(key, val) { state[key] = val; apply(); },
      setFilters(patch)   { Object.assign(state, patch); apply(); },
      setSearch(val) {
        state.search = val;
        if (searchTid) clearTimeout(searchTid);
        searchTid = setTimeout(apply, debounce);
      },
      refresh()      { apply(); return lastOut; },
      get()          { return lastOut; },
      getState()     { return Object.assign({}, state); },
    };
  };
})();
