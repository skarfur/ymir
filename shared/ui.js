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
// RIGHT  = ⚙ Settings · lang toggle · Sign out
//
// page values:
//   hub pages      — 'staff' | 'admin' | 'member'
//   staff subpages — 'dailylog' | 'maintenance' | 'logbook-review' | 'incidents'
//   admin subpages — 'payroll'
//   member subpages— 'settings' | 'logbook' | 'weather' | 'saumaklubbur'
//                    'captain' | 'coxswain' (rowing division)
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

  window.toast = (msg, type) => showToast(msg, type);
})();

// ── HTML ESCAPE ────────────────────────────────────────────────────────────────
window.esc = function (s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};

// ── MEMBER NAME DISAMBIGUATION ────────────────────────────────────────────────
// When multiple people in an array share the same name, append the birth year
// to distinguish them. Pass the member (or any {name, birthYear}-like object)
// and the array it belongs to. Returns a plain string (not HTML-escaped).
window.memberDisplayName = function (member, allMembers) {
  if (!member) return '';
  var name = member.name || '';
  if (!name || !Array.isArray(allMembers)) return name;
  var dupes = 0;
  for (var i = 0; i < allMembers.length; i++) {
    if (allMembers[i] && allMembers[i].name === name) {
      if (++dupes > 1) break;
    }
  }
  if (dupes > 1 && member.birthYear) return name + ' (' + member.birthYear + ')';
  return name;
};

// ── MEMBER INITIALS ───────────────────────────────────────────────────────────
// Compact label for tight spaces. Prefers the stored `initials` field (set by
// the backend in _memberRow_), otherwise computes from `name` using the same
// rule as code.gs extractInitials_: split on whitespace, drop all-lowercase
// tokens (connectors like "van", "de", "af"), strip hyphens, take first char
// of each remaining token, uppercase. When two members in `allMembers` would
// collapse to the same initials and the member has a birthYear, append the
// last two digits as a disambiguator (e.g. "JM'98").
function _computeInitials(name) {
  if (!name) return '';
  return String(name).trim().split(/\s+/)
    .filter(function(t) { return t && t !== t.toLowerCase(); })
    .map(function(t) { return t.replace(/-/g, '').charAt(0); })
    .join('').toUpperCase();
}
window.memberInitials = function (member, allMembers) {
  if (!member) return '';
  var ini = (member.initials && String(member.initials).trim())
    || _computeInitials(member.name || '');
  if (!ini || !Array.isArray(allMembers)) return ini;
  var dupes = 0;
  for (var i = 0; i < allMembers.length; i++) {
    var other = allMembers[i];
    if (!other) continue;
    var otherIni = (other.initials && String(other.initials).trim())
      || _computeInitials(other.name || '');
    if (otherIni === ini) {
      if (++dupes > 1) break;
    }
  }
  if (dupes > 1 && member.birthYear) {
    var yy = String(member.birthYear).slice(-2);
    return ini + "'" + yy;
  }
  return ini;
};

// Build a Set of names that occur more than once in the given array.
window.duplicateMemberNames = function (allMembers) {
  var seen = Object.create(null), dupes = new Set();
  if (!Array.isArray(allMembers)) return dupes;
  for (var i = 0; i < allMembers.length; i++) {
    var n = allMembers[i] && allMembers[i].name;
    if (!n) continue;
    if (seen[n]) dupes.add(n);
    else seen[n] = true;
  }
  return dupes;
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
// Unsaved-changes guard: opt-in per modal via guardUnsavedChanges(modalId).
// When a guarded modal is opened, its form inputs are snapshotted; when closed
// without `force === true`, it confirms before discarding dirty edits.
;(function () {
  const _tracked  = new Set();           // modalIds that opt into the guard
  const _baseline = new Map();           // modalId -> [[el, value], ...]

  function _snapshot(modalId) {
    const m = document.getElementById(modalId);
    if (!m) { _baseline.delete(modalId); return; }
    const snap = [];
    m.querySelectorAll('input, textarea, select').forEach(el => {
      if (el.type === 'file') return;
      const val = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
      snap.push([el, val]);
    });
    _baseline.set(modalId, snap);
  }

  function _isDirty(modalId) {
    const snap = _baseline.get(modalId);
    if (!snap) return false;
    for (let i = 0; i < snap.length; i++) {
      const el = snap[i][0], was = snap[i][1];
      if (!el.isConnected) continue;
      const cur = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
      if (cur !== was) return true;
    }
    return false;
  }

  window.guardUnsavedChanges = function (modalId) { _tracked.add(modalId); };
  window.isModalDirty        = function (modalId) { return _isDirty(modalId); };
  window.resnapshotModal     = function (modalId) { if (_tracked.has(modalId)) _snapshot(modalId); };

  // Focus management. Tracks which element had focus before each modal
  // opened so we can restore on close; picks the first focusable inside
  // the modal to focus on open. Keyed by modal id so nested modals (rare
  // but possible — maintenance detail inside admin) don't clobber each
  // other.
  const _priorFocus = new Map();
  const FOCUSABLE_SEL = 'a[href],button:not([disabled]),textarea:not([disabled]),' +
    'input:not([disabled]):not([type=hidden]),select:not([disabled]),' +
    '[tabindex]:not([tabindex="-1"])';
  function _focusablesIn(el) {
    return Array.from(el.querySelectorAll(FOCUSABLE_SEL))
      .filter(n => !n.hidden && n.offsetParent !== null);
  }

  window.openModal = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    if (_tracked.has(id)) _snapshot(id);
    // Save whatever had focus so closeModal can put it back.
    _priorFocus.set(id, document.activeElement);
    // Focus the first focusable inside the modal. Fall back to the modal
    // container itself (with tabindex=-1) so ESC / Tab still work even
    // when the body is empty at open time.
    const first = _focusablesIn(el)[0];
    if (first) { try { first.focus(); } catch (e) {} }
    else {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      try { el.focus(); } catch (e) {}
    }
  };

  window.closeModal = function (id, force) {
    const el = document.getElementById(id);
    if (!el) return;
    const doClose = () => {
      el.classList.add('hidden');
      _baseline.delete(id);
      // Restore focus to whatever had it before open — keyboard users
      // don't want to be kicked back to <body>.
      const prior = _priorFocus.get(id);
      _priorFocus.delete(id);
      if (prior && typeof prior.focus === 'function' && document.contains(prior)) {
        try { prior.focus(); } catch (e) {}
      }
    };
    if (force === true || !_tracked.has(id) || !_isDirty(id)) { doClose(); return; }
    const msg = (typeof s === 'function') ? s('msg.unsavedChanges')
              : 'You have unsaved changes. Discard them?';
    // ymConfirm returns a promise; close only if the user confirms.
    Promise.resolve(ymConfirm(msg)).then(ok => { if (ok) doClose(); });
  };

  // Focus trap: keep Tab / Shift+Tab within the top-most open modal.
  // Registered once at module load.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    const overlays = document.querySelectorAll(
      '.modal-overlay:not(.hidden), .modal-bg:not(.hidden), ' +
      '.group-modal-overlay:not(.hidden), .guest-modal-overlay:not(.hidden), ' +
      '.map-modal-overlay:not(.hidden)'
    );
    if (!overlays.length) return;
    const top = overlays[overlays.length - 1];
    const focusables = _focusablesIn(top);
    if (!focusables.length) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus(); e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus(); e.preventDefault();
    }
  });

  // Warn before leaving the page while a guarded modal has unsaved edits.
  window.addEventListener('beforeunload', function (e) {
    for (const id of _tracked) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden') && _isDirty(id)) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    }
  });
})();

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
  // Route through closeModal so the unsaved-changes guard (if active) fires.
  if (top.id && typeof window.closeModal === 'function') window.closeModal(top.id);
  else top.classList.add('hidden');
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
    // Above .modal-overlay (2000) + full-screen viewers (2100) so confirm /
    // alert / prompt can fire from inside another modal and still sit on top.
    _overlay.style.zIndex = '2200';
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

// ── LUCIDE ICONS (MIT) ────────────────────────────────────────────────────────
// Shared icon registry. Use window.icon(name) to get an SVG string. Icons use
// currentColor + the .icon-inline class so they size with the surrounding text.
;(function () {
  const LUCIDE_ = {
    'image-plus': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/></svg>',
    'message-square-plus': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>',
    'trash-2': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
    'qr-code': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>',
    'wind': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>',
    'hourglass': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>',
    'locate-fixed': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>',
    'pencil': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
    'map-pin': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
    'download': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
  };
  window.icon = function (name) { return LUCIDE_[name] || ''; };
})();

// ── STANDARD HEADER ────────────────────────────────────────────────────────────
// buildHeader(page) populates the page-wide nav bar. Pages must include this
// shell in their HTML (typically as the first <body> child):
//
//   <header id="ym-header">
//     <div class="header-left"></div>
//     <div class="header-right"></div>
//   </header>
//
// Accepted `page` values:
//   hub pages      — 'staff' | 'admin' | 'member'
//   staff subpages — 'dailylog' | 'maintenance' | 'logbook-review' | 'incidents'
//   admin subpages — 'payroll'
//   member subpages— 'settings' | 'logbook' | 'weather' | 'saumaklubbur'
//                    'captain' | 'coxswain' | 'volunteer'
//   standalone     — 'login' | 'public' | 'guardian' | 'alert-action' (no role nav)
//
// If the shell is missing, log a clear warning so developers notice (instead
// of the header silently vanishing).
window.buildHeader = function (page) {
  const user = (typeof getUser === 'function') ? getUser() : null;
  const hdr  = document.getElementById('ym-header');
  if (!hdr) {
    console.warn('[buildHeader] Missing <header id="ym-header"> on page', page || '(unknown)');
    return;
  }

  const left  = hdr.querySelector('.header-left');
  const right = hdr.querySelector('.header-right');
  if (!left || !right) {
    console.warn('[buildHeader] #ym-header must contain .header-left and .header-right children (page:', page || '(unknown)', ')');
    return;
  }

  left.innerHTML = right.innerHTML = '';

  // nav-icon SVGs (Phosphor fill, 256×256) keyed by hub name
  const NAV_ICONS_ = {
    admin:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" class="icon-inline"><path d="M249.94,120.24l-27.05-6.76a95.86,95.86,0,0,0-80.37-80.37l-6.76-27a8,8,0,0,0-15.52,0l-6.76,27.05a95.86,95.86,0,0,0-80.37,80.37l-27,6.76a8,8,0,0,0,0,15.52l27.05,6.76a95.86,95.86,0,0,0,80.37,80.37l6.76,27.05a8,8,0,0,0,15.52,0l6.76-27.05a95.86,95.86,0,0,0,80.37-80.37l27.05-6.76a8,8,0,0,0,0-15.52Zm-95.49,22.9L139.31,128l15.14-15.14L215,128Zm-52.9,0L41,128l60.57-15.14L116.69,128ZM205.77,109.2,158.6,97.4,146.8,50.23A79.88,79.88,0,0,1,205.77,109.2Zm-62.63-7.65L128,116.69l-15.14-15.14L128,41ZM109.2,50.23,97.4,97.4,50.23,109.2A79.88,79.88,0,0,1,109.2,50.23Zm-59,96.57L97.4,158.6l11.8,47.17A79.88,79.88,0,0,1,50.23,146.8Zm62.63,7.65L128,139.31l15.14,15.14L128,215Zm33.94,51.32,11.8-47.17,47.17-11.8A79.88,79.88,0,0,1,146.8,205.77Z"/></svg>',
    staff:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" class="icon-inline"><path d="M208,80a8,8,0,0,0-8,8v16H188.85L184,55.2A8,8,0,0,0,181.32,50L138.44,11.88l-.2-.17a16,16,0,0,0-20.48,0l-.2.17L74.68,50A8,8,0,0,0,72,55.2L67.15,104H56V88a8,8,0,0,0-16,0v24a8,8,0,0,0,8,8H65.54l-9.47,94.48A16,16,0,0,0,72,232H184a16,16,0,0,0,15.92-17.56L190.46,120H208a8,8,0,0,0,8-8V88A8,8,0,0,0,208,80ZM128,24l27,24H101ZM87.24,64h81.52l4,40H136V88a8,8,0,0,0-16,0v16H83.23ZM72,216l4-40H180l4,40Zm106.39-56H77.61l4-40h92.76Z"/></svg>',
    member: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" class="icon-inline"><path d="M247.21,172.53A8,8,0,0,0,240,168H144V144h72a8,8,0,0,0,5.92-13.38L144,44.91V8a8,8,0,0,0-14.21-5l-104,128A8,8,0,0,0,32,144h96v24H16a8,8,0,0,0-6.25,13l29.6,37a15.93,15.93,0,0,0,12.49,6H204.16a15.93,15.93,0,0,0,12.49-6l29.6-37A8,8,0,0,0,247.21,172.53ZM197.92,128H144V68.69ZM48.81,128,128,30.53V128Zm155.35,80H51.84l-19.2-24H223.36Z"/></svg>',
  };

  // Lucide icons (MIT) for icon-only header buttons
  const UI_ICONS_ = {
    settings: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    logout:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-inline"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>',
  };

  // helpers
  function link(href, label, cls, hub) {
    const a = document.createElement('a');
    a.href = href; a.className = cls || 'hbtn';
    if (hub && NAV_ICONS_[hub]) { a.innerHTML = NAV_ICONS_[hub] + label; }
    else { a.textContent = label; }
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
  const MEMBER_SUBPAGES = ['settings', 'logbook', 'weather', 'saumaklubbur', 'captain', 'coxswain', 'volunteer', 'handbook'];
  const isStaffSub  = STAFF_SUBPAGES.includes(page);
  const isAdminSub  = ADMIN_SUBPAGES.includes(page);
  const isMemberSub = MEMBER_SUBPAGES.includes(page);
  const currentHub = isStaffSub ? 'staff' : isAdminSub ? 'admin' : isMemberSub ? 'member' : page;
  const depth = isAdminSub ? '../../' : '../';
  const isCaptainUser = typeof isCaptain === 'function' && user && isCaptain(user);

  // LEFT: logo
  const logo = document.createElement('span');
  logo.className = 'logo logo-icon';
  left.appendChild(logo);

  // LEFT: back link on subpages
  if (isStaffSub)  left.appendChild(link(depth + 'staff/',  '← ' + s('nav.staffHub'),  'back-btn', 'staff'));
  if (isAdminSub)  left.appendChild(link(depth + 'admin/',  '← ' + s('nav.admin'),     'back-btn', 'admin'));
  if (isMemberSub) left.appendChild(link(depth + 'member/', '← ' + s('nav.memberHub'), 'back-btn', 'member'));

  // LEFT: hub-switch buttons — only on top-level hub pages, not subpages
  const isSubpage = isStaffSub || isAdminSub || isMemberSub;
  if (user && !isSubpage) {
    const canStaff = typeof isStaff === 'function' && isStaff(user);
    const canAdmin = typeof isAdmin === 'function' && isAdmin(user);

    if (canStaff && currentHub !== 'staff')  left.appendChild(link(depth + 'staff/',  s('nav.staffHub'),  'hbtn', 'staff'));
    if (canStaff && currentHub !== 'member') left.appendChild(link(depth + 'member/', s('nav.memberHub'), 'hbtn', 'member'));
    if (canAdmin && currentHub !== 'admin')  left.appendChild(link(depth + 'admin/',  s('nav.admin'),     'hbtn', 'admin'));
  }

  // RIGHT: guardian-acting-as-ward badge (if applicable)
  if (user && user.guardianSession && user.guardianSession.kennitala) {
    const gs = user.guardianSession;
    const firstGuardianName = (gs.name || '').split(' ')[0];
    const firstWardName     = (user.name || '').split(' ')[0];

    const badge = document.createElement('span');
    badge.className = 'hbtn ward-badge';
    badge.textContent = s('nav.actingAs', { name: firstWardName });
    badge.style.cursor = 'default';
    badge.style.opacity = '0.85';
    right.appendChild(badge);

    const backBtn = btn(
      s('nav.backToGuardian', { name: firstGuardianName }),
      () => { if (typeof switchBackToGuardian === 'function') switchBackToGuardian(); }
    );
    right.appendChild(backBtn);
  }

  // RIGHT: Settings · lang · sign out
  if (user && page !== 'settings') {
    const a = link(depth + 'settings/', s('nav.settings'), 'hbtn icon-only');
    a.innerHTML = UI_ICONS_.settings;
    a.setAttribute('aria-label', s('nav.settings'));
    a.title = s('nav.settings');
    right.appendChild(a);
  }
  right.appendChild(btn(s('nav.langToggle'), () => { if (typeof toggleLang === 'function') toggleLang(); }, 'hbtn'));
  const so = btn(s('nav.signOut'), () => { if (typeof signOut === 'function') signOut(); }, 'hbtn icon-only');
  so.innerHTML = UI_ICONS_.logout;
  so.setAttribute('aria-label', s('nav.signOut'));
  so.title = s('nav.signOut');
  right.appendChild(so);
};

// ── COLOR PALETTE + SWATCH HELPER ─────────────────────────────────────────────
// 12-colour palette used by every "pick a colour" UI in the app (crew colour,
// captain booking colour, boat-category colour, cert card colour, …). Three
// brand anchors (navy, moss, brass) appear in the list so defaults favour the
// brand; the remaining nine span the wheel at roughly even hue steps.
window.YMIR_PALETTE = [
  '#e74c3c', '#ff7675', '#e67e22', '#d9b441',
  '#f1c40f', '#a3cb3e', '#4fa55e', '#1abc9c',
  '#3498db', '#3a5ea8', '#8e44ad', '#a78bfa',
];

// Render a row of preset swatches next to a native <input type="color">.
// Clicking a swatch writes to the input and fires `input`+`change` events so
// any existing delegated handlers (data-admin-input, data-cq-change, …) run
// untouched. Typing a custom colour into the native picker clears the
// highlight — swatch-and-custom, always both.
//
//   <input type="color" id="myColor">
//   <div id="myColorSwatches"></div>
//   renderColorSwatches('myColor', 'myColorSwatches');
//
// opts.size   — swatch diameter in px (default 20)
// opts.colors — override palette (defaults to YMIR_PALETTE)
window.renderColorSwatches = function (inputId, containerId, opts) {
  opts = opts || {};
  var input     = document.getElementById(inputId);
  var container = document.getElementById(containerId);
  if (!input || !container) return;
  var size   = opts.size || 20;
  var colors = opts.colors || window.YMIR_PALETTE;

  container.style.display  = 'flex';
  container.style.flexWrap = 'wrap';
  container.style.gap      = '5px';
  container.innerHTML = colors.map(function (clr) {
    return '<button type="button" data-color="' + clr + '" aria-label="' + clr + '"'
         + ' style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;'
         + 'background:' + clr + ';cursor:pointer;padding:0;'
         + 'border:1px solid rgba(0,0,0,.15);outline:none;transition:outline .1s"></button>';
  }).join('');

  function highlight(active) {
    var a = (active || '').toLowerCase();
    container.querySelectorAll('button[data-color]').forEach(function (b) {
      var match = b.getAttribute('data-color').toLowerCase() === a;
      b.style.outline       = match ? '2px solid var(--text)' : 'none';
      b.style.outlineOffset = match ? '2px' : '';
    });
  }

  if (!container._ymSwatchBound) {
    container._ymSwatchBound = true;
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-color]');
      if (!btn) return;
      var c = btn.getAttribute('data-color');
      input.value = c;
      highlight(c);
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    input.addEventListener('input', function () { highlight(input.value); });
  }
  highlight(input.value);
};

// ── APPLY THEME ON LOAD ────────────────────────────────────────────────────────
if (typeof applyTheme === 'function') applyTheme();
