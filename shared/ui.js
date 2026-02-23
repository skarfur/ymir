// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/ui.js   v1
//
// Utilities shared across all pages:
//   showToast(text, type, ms)       — race-free single toast
//   esc(s)                          — HTML escape
//   domRefs(map)                    — cached getElementById proxy
//   replaceWithFragment(el, items, buildFn)  — replaceChildren via DocumentFragment
//   buildHeader(page)               — role-aware standard header
// ═══════════════════════════════════════════════════════════════════════════════

// ── TOAST (no setTimeout race) ────────────────────────────────────────────────
;(function() {
  let _el  = null;
  let _raf = null;
  let _tid = null;

  function ensureEl() {
    if (_el) return _el;
    _el = document.createElement('div');
    _el.id = 'ym-toast';
    Object.assign(_el.style, {
      position:'fixed', bottom:'24px', left:'50%',
      transform:'translateX(-50%)',
      minWidth:'200px', maxWidth:'92vw', textAlign:'center',
      zIndex:'9999', fontSize:'12px', padding:'10px 18px',
      borderRadius:'8px', fontFamily:'inherit',
      transition:'opacity .2s', opacity:'0', pointerEvents:'none',
    });
    document.body.appendChild(_el);
    return _el;
  }

  window.showToast = function(text, type, ms) {
    ms = ms || 3000;
    // Cancel in-flight timers (prevents races)
    if (_tid) { clearTimeout(_tid);  _tid = null; }
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }

    const el = ensureEl();
    const palette = {
      ok:   { bg:'var(--card)', border:'var(--green)',  color:'var(--green)'  },
      err:  { bg:'var(--card)', border:'var(--red)',    color:'var(--red)'    },
      warn: { bg:'var(--card)', border:'var(--orange)', color:'var(--orange)' },
      info: { bg:'var(--card)', border:'var(--border)', color:'var(--text)'   },
    };
    const p = palette[type] || palette.info;
    Object.assign(el.style, {
      background: p.bg,
      border: `1px solid ${p.border}55`,
      color: p.color,
      opacity: '0',
    });
    el.textContent = text;
    // Separate frame so transition fires
    _raf = requestAnimationFrame(() => { el.style.opacity = '1'; _raf = null; });
    _tid = setTimeout(() => { el.style.opacity = '0'; _tid = null; }, ms);
  };
})();


// ── HTML ESCAPE ───────────────────────────────────────────────────────────────
window.esc = function(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};


// ── CACHED DOM REFS ───────────────────────────────────────────────────────────
// Usage: const dom = domRefs({ boatsCard:'boatsCard', amCard:'amCard', ... })
// Access: dom.boatsCard  → lazily queries and caches on first use
window.domRefs = function(idMap) {
  const cache = {};
  return new Proxy({}, {
    get(_, key) {
      if (key in cache) return cache[key];
      if (!(key in idMap)) throw new Error('domRefs: unknown key "' + key + '"');
      return (cache[key] = document.getElementById(idMap[key]));
    }
  });
};


// ── FRAGMENT RENDERER ─────────────────────────────────────────────────────────
// replaceWithFragment(container, items, buildNodeFn)
//   buildNodeFn(item) → HTMLElement | null
//   Builds a DocumentFragment and calls replaceChildren — no innerHTML, no reflow storm.
window.replaceWithFragment = function(container, items, buildNodeFn) {
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const node = buildNodeFn(item);
    if (node) frag.appendChild(node);
  }
  container.replaceChildren(frag);
};


// ── STANDARD HEADER ───────────────────────────────────────────────────────────
// Call from DOMContentLoaded: buildHeader('dailylog') etc.
//
// page values: 'staff' | 'dailylog' | 'maintenance' | 'trips' | 'incidents' | 'admin' | 'member'
//
// Header rule: left = logo + back-if-subpage + OTHER hub(s)
//              right = Weather + lang + sign out
//   - member role:  can always get to Staff if staff/admin, and Admin if admin
//   - on member page: show staff/admin links if applicable
//   - on staff page:  show member + admin (if admin)
//   - on admin page:  show member + staff
//   - on sub-pages (dailylog/maintenance/trips/incidents): ← Staff + member + (admin if admin)
window.buildHeader = function(page) {
  const user = (typeof getUser === 'function') ? getUser() : null;
  const hdr  = document.getElementById('ym-header');
  if (!hdr) return;

  const left  = hdr.querySelector('.header-left');
  const right = hdr.querySelector('.header-right');
  if (!left || !right) return;

  // Clear
  left.innerHTML  = '';
  right.innerHTML = '';

  // Logo
  const logo = document.createElement('span');
  logo.className = 'logo';
  logo.textContent = 'ÝMIR';
  left.appendChild(logo);

  function makeLink(href, label, cls) {
    const a = Object.assign(document.createElement('a'), { href, className: cls || 'hbtn', textContent: label });
    a.style.fontSize = '11px';
    return a;
  }
  function makeBtn(label, fn) {
    const b = Object.assign(document.createElement('button'), { className: 'btn-ghost', textContent: label });
    b.style.fontSize = '11px';
    b.addEventListener('click', fn);
    return b;
  }

  // Sub-pages: back to staff
  const isSubpage = ['dailylog','maintenance','trips','incidents'].includes(page);
  if (isSubpage) left.appendChild(makeLink('../staff/', '← Staff'));

  // Hub links: which hubs should appear in the header?
  // Rule: show all hubs the user can access EXCEPT the one we're currently in.
  const staffHubs  = ['dailylog','maintenance','trips','incidents','staff'];
  const currentHub = staffHubs.includes(page) ? 'staff' : page; // normalize subpages → 'staff'

  if (user) {
    if (currentHub !== 'member') left.appendChild(makeLink('../member/', '⛵ Member Hub'));
    if (isStaff(user) && currentHub !== 'staff') left.appendChild(makeLink('../staff/',  '⚓ Staff'));
    if (isAdmin(user) && currentHub !== 'admin') left.appendChild(makeLink('../admin/',  '⚙ Admin'));
  }

  // Right: weather, lang, sign out
  right.appendChild(makeLink('../weather/', '⛅ Weather'));
  const langBtn = makeBtn(getLang() === 'EN' ? 'IS' : 'EN', () => toggleLang());
  langBtn.id = 'ym-lang-btn';
  right.appendChild(langBtn);
  right.appendChild(makeBtn('Sign out', () => signOut()));
};
