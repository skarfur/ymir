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
// LEFT   = ÝMIR [← Parent back-link if subpage]
//          ⚓ Staff Hub  (shown to staff/admin when NOT on staff pages)
//          ⛵ Members    (shown to staff/admin when NOT on member pages)
//          ⚙ Admin       (shown to admin when NOT on admin page)
// RIGHT  = ⚙ Settings · ⛅ Weather · lang toggle · Sign out
//
// page values:
//   hub pages      — 'staff' | 'admin' | 'member'
//   staff subpages — 'dailylog' | 'maintenance' | 'logbook-review' | 'incidents'
//   admin subpages — 'payroll'
//   member subpages— 'settings' | 'logbook' | 'weather' | 'saumaklubbur'
//                    'captain' | 'coxswain'
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

// ── SYSTEM DIALOGS (ymAlert / ymConfirm / ymPrompt) ──────────────────────────
// Promise-based replacements for native alert(), confirm(), prompt().
// Reuse .modal-overlay + .modal CSS; lazy-create a single shared DOM element.
;(function () {
  let _overlay = null;
  let _resolve = null;

  function ensureOverlay() {
    if (_overlay) return _overlay;
    _overlay = document.createElement('div');
    _overlay.id = 'ym-dialog';
    _overlay.className = 'modal-overlay hidden';
    _overlay.style.zIndex = '300';
    _overlay.addEventListener('click', function (e) {
      if (e.target === _overlay) dismiss();
    });
    document.body.appendChild(_overlay);
    return _overlay;
  }

  function dismiss(value) {
    if (!_resolve) return;
    _overlay.classList.add('hidden');
    var fn = _resolve;
    _resolve = null;
    fn(value);
  }

  function show(html) {
    var el = ensureOverlay();
    el.innerHTML = '<div class="modal" style="max-width:400px">' + html + '</div>';
    el.classList.remove('hidden');
    // watch for Escape (global handler adds .hidden)
    var obs = new MutationObserver(function () {
      if (el.classList.contains('hidden') && _resolve) dismiss(undefined);
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return new Promise(function (resolve) {
      _resolve = resolve;
    }).finally(function () { obs.disconnect(); });
  }

  var label = function (key, fallback) {
    return (typeof s === 'function') ? s(key) : fallback;
  };

  // wire click after innerHTML render
  var wireOk = function (val) {
    var b = document.getElementById('ym-dlg-ok');
    if (b) b.onclick = function () { dismiss(val); };
  };

  window.ymAlert = function (msg) {
    var p = show(
      '<p style="margin:0 0 18px;white-space:pre-wrap">' + esc(msg) + '</p>' +
      '<div class="ym-dialog-btns">' +
        '<button class="btn-primary" id="ym-dlg-ok">' + label('btn.close', 'OK') + '</button>' +
      '</div>'
    );
    wireOk(undefined);
    return p;
  };

  window.ymConfirm = function (msg) {
    var p = show(
      '<p style="margin:0 0 18px;white-space:pre-wrap">' + esc(msg) + '</p>' +
      '<div class="ym-dialog-btns">' +
        '<button class="btn-ghost" id="ym-dlg-cancel">' + label('btn.cancel', 'Cancel') + '</button>' +
        '<button class="btn-primary" id="ym-dlg-ok">' + label('btn.confirm', 'Confirm') + '</button>' +
      '</div>'
    );
    wireOk(true);
    var bc = document.getElementById('ym-dlg-cancel');
    if (bc) bc.onclick = function () { dismiss(false); };
    return p.then(function (v) { return v === true; });
  };

  window.ymPrompt = function (msg, defaultVal) {
    var p = show(
      '<label style="display:block;margin-bottom:12px;white-space:pre-wrap">' + esc(msg) + '</label>' +
      '<input type="text" id="ym-dlg-input" class="input" value="' + esc(defaultVal || '') + '" style="width:100%;margin-bottom:18px">' +
      '<div class="ym-dialog-btns">' +
        '<button class="btn-ghost" id="ym-dlg-cancel">' + label('btn.cancel', 'Cancel') + '</button>' +
        '<button class="btn-primary" id="ym-dlg-ok">' + label('btn.confirm', 'OK') + '</button>' +
      '</div>'
    );
    var inp = document.getElementById('ym-dlg-input');
    if (inp) { inp.focus(); inp.select(); }
    wireOk('__submit__');
    var bc = document.getElementById('ym-dlg-cancel');
    if (bc) bc.onclick = function () { dismiss(null); };
    if (inp) inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') dismiss('__submit__');
    });
    return p.then(function (v) {
      if (v === '__submit__') {
        var el = document.getElementById('ym-dlg-input');
        return el ? el.value : '';
      }
      return null;
    });
  };
})();

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
  const MEMBER_SUBPAGES = ['settings', 'logbook', 'weather', 'saumaklubbur', 'captain', 'coxswain'];
  const isStaffSub  = STAFF_SUBPAGES.includes(page);
  const isAdminSub  = ADMIN_SUBPAGES.includes(page);
  const isMemberSub = MEMBER_SUBPAGES.includes(page);
  const currentHub = isStaffSub ? 'staff' : isAdminSub ? 'admin' : isMemberSub ? 'member' : page;
  const depth = isAdminSub ? '../../' : '../';
  const isCaptainUser = typeof isCaptain === 'function' && user && isCaptain(user);

  // LEFT: logo
  const logo = document.createElement('span');
  logo.className = 'logo'; logo.textContent = 'ÝMIR';
  left.appendChild(logo);

  // LEFT: back link on subpages
  if (isStaffSub)  left.appendChild(link(depth + 'staff/',  '← ' + s('nav.staffHub'),  'back-btn'));
  if (isAdminSub)  left.appendChild(link(depth + 'admin/',  '← ' + s('nav.admin'),     'back-btn'));
  if (isMemberSub) left.appendChild(link(depth + 'member/', '← ' + s('nav.memberHub'), 'back-btn'));

  // LEFT: hub-switch buttons (staff/admin only)
  if (user) {
    const canStaff = typeof isStaff === 'function' && isStaff(user);
    const canAdmin = typeof isAdmin === 'function' && isAdmin(user);

    if (canStaff && currentHub !== 'staff')  left.appendChild(link(depth + 'staff/',  s('nav.staffHub'),  'hbtn'));
    if (canStaff && currentHub !== 'member') left.appendChild(link(depth + 'member/', s('nav.memberHub'), 'hbtn'));
    if (canAdmin && currentHub !== 'admin')  left.appendChild(link(depth + 'admin/',  s('nav.admin'),     'hbtn'));
    if (isCaptainUser && page !== 'captain') left.appendChild(link(depth + 'captain/', s('nav.captainQuarters'), 'hbtn'));
  }

  // RIGHT: Settings · Weather · lang · sign out
  if (user && page !== 'settings') right.appendChild(link(depth + 'settings/', s('nav.settings'), 'hbtn'));
  if (page !== 'weather') right.appendChild(link(depth + 'weather/', s('nav.weather'), 'hbtn'));
  right.appendChild(btn(s('nav.langToggle'), () => { if (typeof toggleLang === 'function') toggleLang(); }));
  right.appendChild(btn(s('nav.signOut'),    () => { if (typeof signOut    === 'function') signOut();    }));
};

// ── APPLY THEME ON LOAD ────────────────────────────────────────────────────────
if (typeof applyTheme === 'function') applyTheme();
