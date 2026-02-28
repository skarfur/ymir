// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/ui.js   v2
//
// Utilities shared across all pages:
//   showToast(text, type, ms)                — race-free single toast
//   esc(s)                                   — HTML escape
//   domRefs(map)                             — cached getElementById proxy
//   replaceWithFragment(el, items, buildFn)  — replaceChildren via DocumentFragment
//   buildHeader(page)                        — role-aware standard header
//
// buildHeader layout (v2):
//   LEFT  = logo · [← Staff if subpage] · role-hub buttons for OTHER hubs user can access
//   RIGHT = ⛅ Weather · lang toggle · Sign out
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
      background: p.bg, border: `1px solid ${p.border}55`, color: p.color, opacity: '0',
    });
    el.textContent = text;
    _raf = requestAnimationFrame(() => { el.style.opacity = '1'; _raf = null; });
    _tid = setTimeout(() => { el.style.opacity = '0'; _tid = null; }, ms);
  };
})();


// ── HTML ESCAPE ───────────────────────────────────────────────────────────────
window.esc = function(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};


// ── CACHED DOM REFS ───────────────────────────────────────────────────────────
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
window.replaceWithFragment = function(container, items, buildNodeFn) {
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const node = buildNodeFn(item);
    if (node) frag.appendChild(node);
  }
  container.replaceChildren(frag);
};


// ── STANDARD HEADER ───────────────────────────────────────────────────────────
// Call from DOMContentLoaded: buildHeader('staff'), buildHeader('trips'), etc.
//
// page values:
//   hub pages    — 'staff' | 'admin' | 'member'
//   staff sub    — 'dailylog' | 'maintenance' | 'trips' | 'incidents'
//
// LEFT  = logo · [← Staff if subpage] · role-hub buttons for OTHER accessible hubs
// RIGHT = ⛅ Weather · lang · Sign out
window.buildHeader = function(page) {
  const user = (typeof getUser === 'function') ? getUser() : null;
  const hdr  = document.getElementById('ym-header');
  if (!hdr) return;

  const left  = hdr.querySelector('.header-left');
  const right = hdr.querySelector('.header-right');
  if (!left || !right) return;

  left.innerHTML  = '';
  right.innerHTML = '';

  function makeLink(href, label, cls) {
    const a = Object.assign(document.createElement('a'), {
      href, className: cls || 'hbtn', textContent: label,
    });
    a.style.fontSize = '11px';
    return a;
  }
  function makeBtn(label, fn) {
    const b = Object.assign(document.createElement('button'), {
      className: 'btn-ghost', textContent: label,
    });
    b.style.fontSize = '11px';
    b.addEventListener('click', fn);
    return b;
  }

  // Logo
  const logo = document.createElement('span');
  logo.className   = 'logo';
  logo.textContent = 'ÝMIR';
  left.appendChild(logo);

  // Determine current hub
  const staffSubpages = ['dailylog', 'maintenance', 'trips', 'incidents'];
  const isSubpage     = staffSubpages.includes(page);
  const currentHub    = isSubpage ? 'staff' : page;

  // Back arrow on subpages (sits between logo and role buttons)
  if (isSubpage) {
    left.appendChild(makeLink('../staff/', '← Staff', 'hbtn'));
  }

  // Role-hub buttons: every hub the user can reach EXCEPT the one they're in
  if (user) {
    if (currentHub !== 'member') {
      left.appendChild(makeLink('../member/', '⛵ Member'));
    }
    if (typeof isStaff === 'function' && isStaff(user) && currentHub !== 'staff') {
      left.appendChild(makeLink('../staff/', '⚓ Staff'));
    }
    if (typeof isAdmin === 'function' && isAdmin(user) && currentHub !== 'admin') {
      left.appendChild(makeLink('../admin/', '⚙ Admin'));
    }
  }

  // Right: Weather · lang · sign out
  right.appendChild(makeLink('../weather/', '⛅ Weather'));
  const langLabel = (typeof getLang === 'function' && getLang() === 'EN') ? 'IS' : 'EN';
  const langBtn   = makeBtn(langLabel, () => { if (typeof toggleLang === 'function') toggleLang(); });
  langBtn.id = 'ym-lang-btn';
  right.appendChild(langBtn);
  right.appendChild(makeBtn('Sign out', () => { if (typeof signOut === 'function') signOut(); }));
};
