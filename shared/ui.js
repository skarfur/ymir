// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/ui.js
//
// Utilities shared across all pages:
//   showToast(text, type, ms)         — race-free single toast
//   esc(s)                            — HTML escape
//   domRefs(map)                      — cached getElementById proxy
//   replaceWithFragment(el, items)    — replaceChildren via DocumentFragment
//   buildHeader(page)                 — role-aware standard header
//   openModal(id) / closeModal(id)    — modal helpers
//
// HEADER LAYOUT
//
// LEFT   = ÝMIR [⚓ Staff back-link if subpage]
//          ⚓ Staff Hub  (shown to staff/admin when NOT on staff pages)
//          ⛵ Members    (shown to staff/admin when NOT on member pages)
//          ⚙ Admin       (shown to admin when NOT on admin page)
// RIGHT  = ⛅ Weather · lang toggle · Sign out
//
// page values:
//   hub pages   — 'staff' | 'admin' | 'member'
//   subpages    — 'dailylog' | 'maintenance' | 'logbook-review' | 'incidents'
// ═══════════════════════════════════════════════════════════════════════════════

// ── TOAST ─────────────────────────────────────────────────────────────────────
;(function () {
  let _el = null, _raf = null, _tid = null;

  function ensureEl() {
    if (_el) return _el;
    _el = document.createElement('div');
    _el.id = 'ym-toast';
    Object.assign(_el.style, {
      position: 'fixed', bottom: '24px', left: '50%',
      transform: 'translateX(-50%)', minWidth: '200px', maxWidth: '92vw',
      textAlign: 'center', zIndex: '9999', fontSize: '12px',
      padding: '10px 18px', borderRadius: '8px', fontFamily: 'inherit',
      transition: 'opacity .2s', opacity: '0', pointerEvents: 'none',
    });
    document.body.appendChild(_el);
    return _el;
  }

  window.showToast = function (text, type, ms) {
    ms = ms || 3000;
    if (_tid) { clearTimeout(_tid); _tid = null; }
    if (_raf)  { cancelAnimationFrame(_raf); _raf = null; }
    const el = ensureEl();
    const p = ({ ok: { bg:'var(--card)', border:'var(--green)',  color:'var(--green)'  },
                 err: { bg:'var(--card)', border:'var(--red)',    color:'var(--red)'    },
                 warn:{ bg:'var(--card)', border:'var(--orange)', color:'var(--orange)' },
                 info:{ bg:'var(--card)', border:'var(--border)', color:'var(--text)'   } })[type] || { bg:'var(--card)', border:'var(--border)', color:'var(--text)' };
    Object.assign(el.style, { background: p.bg, border: `1px solid ${p.border}55`, color: p.color, opacity: '0' });
    el.textContent = text;
    _raf = requestAnimationFrame(() => { el.style.opacity = '1'; _raf = null; });
    _tid = setTimeout(() => { el.style.opacity = '0'; _tid = null; }, ms);
  };

  // backward-compat aliases
  window.toast   = (msg, type) => showToast(msg, type);
  window.showMsg = (msg, type) => showToast(msg, type);
})();

// ── HTML ESCAPE ────────────────────────────────────────────────────────────────
window.esc = function (s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};

// ── CACHED DOM REFS ────────────────────────────────────────────────────────────
window.domRefs = function (idMap) {
  const cache = {};
  return new Proxy({}, {
    get(_, key) {
      if (key in cache) return cache[key];
      if (!(key in idMap)) throw new Error('domRefs: unknown key "' + key + '"');
      return (cache[key] = document.getElementById(idMap[key]));
    },
  });
};

// ── FRAGMENT RENDERER ──────────────────────────────────────────────────────────
window.replaceWithFragment = function (container, items, buildNodeFn) {
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const node = buildNodeFn(item);
    if (node) frag.appendChild(node);
  }
  container.replaceChildren(frag);
};

// ── MODAL HELPERS ──────────────────────────────────────────────────────────────
window.openModal  = id => document.getElementById(id)?.classList.remove('hidden');
window.closeModal = id => document.getElementById(id)?.classList.add('hidden');

// ── GLOBAL ESCAPE-TO-CLOSE ────────────────────────────────────────────────────
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  // find the top-most visible modal overlay and close it
  const overlays = document.querySelectorAll(
    '.modal-overlay:not(.hidden), .modal-bg:not(.hidden), .group-modal-overlay:not(.hidden), .guest-modal-overlay:not(.hidden), .map-modal-overlay:not(.hidden)'
  );
  if (!overlays.length) return;
  // pick the one with highest z-index (last in DOM if equal)
  let top = overlays[overlays.length - 1];
  top.classList.add('hidden');
});

// ── STANDARD HEADER ────────────────────────────────────────────────────────────
window.buildHeader = function (page) {
  const user = (typeof getUser === 'function') ? getUser() : null;
  const hdr  = document.getElementById('ym-header');
  if (!hdr) return;

  const left  = hdr.querySelector('.header-left');
  const right = hdr.querySelector('.header-right');
  if (!left || !right) return;

  left.innerHTML = right.innerHTML = '';

  // helpers
  function link(href, label, cls) {
    const a = document.createElement('a');
    a.href = href; a.className = cls || 'hbtn'; a.textContent = label;
    return a;
  }
  function btn(label, fn, cls) {
    const b = document.createElement('button');
    b.className = cls || 'btn-ghost'; b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  // classify current page
  const STAFF_SUBPAGES  = ['dailylog', 'maintenance', 'logbook-review', 'incidents'];
  const ADMIN_SUBPAGES  = ['payroll'];
  const isSubpage  = STAFF_SUBPAGES.includes(page);
  const isAdminSub = ADMIN_SUBPAGES.includes(page);
  const currentHub = isSubpage ? 'staff' : isAdminSub ? 'admin' : page;
  const depth = isAdminSub ? '../../' : '../';

  // LEFT: logo
  const logo = document.createElement('span');
  logo.className = 'logo'; logo.textContent = 'ÝMIR';
  left.appendChild(logo);

  // LEFT: back link on subpages
  if (isSubpage)  left.appendChild(link('../staff/',   s('nav.staffHub'), 'hbtn'));
  if (isAdminSub) left.appendChild(link('../../admin/', s('nav.admin'),   'hbtn'));

  // LEFT: hub-switch buttons (staff/admin only)
  if (user) {
    const canStaff = typeof isStaff === 'function' && isStaff(user);
    const canAdmin = typeof isAdmin === 'function' && isAdmin(user);

    if (canStaff && currentHub !== 'staff')  left.appendChild(link(depth + 'staff/',  s('nav.staffHub'),  'hbtn'));
    if (canStaff && currentHub !== 'member') left.appendChild(link(depth + 'member/', s('nav.memberHub'), 'hbtn'));
    if (canAdmin && currentHub !== 'admin')  left.appendChild(link(depth + 'admin/',  s('nav.admin'),     'hbtn'));
  }

  // RIGHT: Weather · lang · sign out
  right.appendChild(link(depth + 'weather/', s('nav.weather'), 'hbtn'));
  right.appendChild(btn(s('nav.langToggle'), () => { if (typeof toggleLang === 'function') toggleLang(); }));
  right.appendChild(btn(s('nav.signOut'),    () => { if (typeof signOut    === 'function') signOut();    }));
};
