// ═══════════════════════════════════════════════════════════════════════════════
// Shared portal layout helpers
// ═══════════════════════════════════════════════════════════════════════════════
//
// There are 17 portal index.html files, each with a hand-copied <head> block:
// CSP, charset, viewport, favicon, preconnects, shared stylesheet, and the
// core script includes (api.js / ui.js / strings.js). Without a build step
// these cannot be fully deduplicated — CSP and stylesheet links must appear
// in <head> before the parser emits any tokens.
//
// What THIS file gives us:
//
//   1. <ymir-header> custom element — replaces the boilerplate
//          <header id="ym-header">
//            <div class="header-left"></div>
//            <div class="header-right"></div>
//          </header>
//      with a single tag. shared/ui.js's buildHeader() continues to work
//      against the same DOM shape.
//
//   2. Layout.CSP — canonical CSP strings so portals can reference a single
//      source of truth in reviews / audits. (Meta-element value must still
//      be literal in HTML; this constant is for JS callers and docs.)
//
//   3. Layout.coreScripts — the fixed set of scripts every authenticated
//      portal pulls in. Documentation aid; the physical <script> tags still
//      live in HTML.
//
// Load order: this file should be included early (non-deferred) so the
// custom element is defined before the parser reaches it in <body>.

(function (global) {
  'use strict';

  var CSP_BASE_ =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; " +
    "connect-src 'self' https://script.google.com https://script.googleusercontent.com " +
    "https://api.open-meteo.com https://marine-api.open-meteo.com; " +
    "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
    "upgrade-insecure-requests";

  // Portals that embed Leaflet (captain, logbook, public) need to whitelist
  // unpkg for script + style. connect-src must also include unpkg so DevTools
  // can fetch source maps (leaflet.js.map, leaflet-heat.js.map) without CSP
  // blocking the request.
  var CSP_LEAFLET_ =
    CSP_BASE_.replace(
      "script-src 'self'",
      "script-src 'self' https://unpkg.com"
    ).replace(
      "style-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://unpkg.com"
    ).replace(
      "connect-src 'self'",
      "connect-src 'self' https://unpkg.com"
    );

  // Alert-action is the public email-response page — minimal surface area,
  // no fonts, no external APIs beyond the Apps Script relay.
  var CSP_ALERT_ACTION_ =
    "default-src 'self'; script-src 'self'; style-src 'self'; " +
    "img-src 'self' data:; connect-src 'self' https://script.google.com https://script.googleusercontent.com; " +
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
    "upgrade-insecure-requests";

  // Member hub embeds a Google Calendar iframe.
  var CSP_MEMBER_ =
    CSP_LEAFLET_ + "; frame-src https://calendar.google.com";

  var Layout = {
    CSP: {
      standard:    CSP_BASE_,
      withLeaflet: CSP_LEAFLET_,
      member:      CSP_MEMBER_,
      alertAction: CSP_ALERT_ACTION_,
    },
    // Canonical include set for authenticated portals. Physical <script>
    // tags live in each portal's HTML; this is the reference list.
    coreScripts: [
      '../shared/api.js',
      '../shared/ui.js',
      '../shared/strings.js',
    ],
  };

  // ── <ymir-header> custom element ─────────────────────────────────────────
  // Drop-in replacement for the 4-line header shell. Expands into the
  // same DOM that shared/ui.js's buildHeader() expects. Attribute
  // `data-page="..."` is forwarded to buildHeader() on connection if
  // window.buildHeader is available (it will be, since ui.js is in the
  // core include set).
  // Pick the element a skip-link should land focus on. Walks forward from
  // the header looking for the first "real" content container; ignores
  // modal overlays (hidden, and they'd strand focus). Falls back to the
  // header itself if the portal is unusual.
  function _findMainTarget(hdr) {
    var n = hdr.nextElementSibling;
    while (n) {
      if (!n.matches('.modal-overlay, .group-modal-overlay, .guest-modal-overlay, .map-modal-overlay, .modal-bg, [hidden]')) {
        return n;
      }
      n = n.nextElementSibling;
    }
    return hdr;
  }

  if (typeof customElements !== 'undefined' && !customElements.get('ymir-header')) {
    customElements.define('ymir-header', class extends HTMLElement {
      connectedCallback() {
        // Preserve the id/class contract other CSS/JS depends on by
        // replacing self with the canonical <header>. Avoids Shadow DOM
        // so global styles (style.css) still apply.
        var host = this;
        var hdr = document.createElement('header');
        hdr.id = 'ym-header';
        if (host.className) hdr.className = host.className;
        var page = host.getAttribute('data-page') || '';
        hdr.innerHTML = '<div class="header-left"></div><div class="header-right"></div>';

        // Skip link precedes the header — first Tab stop for keyboard
        // users, visually hidden until focused (see .skip-link in
        // shared/style.css). Translation-ready via data-s; falls back to
        // hard-coded English if strings.js hasn't applied yet.
        var skip = document.createElement('a');
        skip.className = 'skip-link';
        skip.href = '#ym-main';
        skip.setAttribute('data-s', 'a11y.skip');
        skip.textContent = 'Skip to main content';
        host.replaceWith(skip, hdr);

        // Tag the first real content container so the skip link has a
        // target. Done after replaceWith so _findMainTarget walks the
        // live DOM, not the pre-upgrade state.
        var main = _findMainTarget(hdr);
        if (main && !main.id) main.id = 'ym-main';
        if (main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');

        if (typeof global.applyStrings === 'function') global.applyStrings(skip.parentNode);
        if (page && typeof global.buildHeader === 'function') {
          // buildHeader may race DOMContentLoaded; call on next tick so
          // user state (getUser) has had a chance to resolve.
          setTimeout(function () { try { global.buildHeader(page); } catch (e) { Logger && Logger.log ? Logger.log(e) : null; } }, 0);
        }
      }
    });
  }

  // ── ARIA auto-annotation for tab bars ────────────────────────────────────
  // Walks every container with a tab-bar-ish class and annotates it as a
  // WAI-ARIA tablist with proper role / aria-selected / aria-controls /
  // keyboard arrow support. Idempotent — safe to call multiple times as
  // tab bars get injected dynamically.
  var TAB_BAR_SELECTORS = '.tab-bar, .vp-tab-bar, .pr-tabs';
  function _annotateTabBars(root) {
    root = root || document;
    root.querySelectorAll(TAB_BAR_SELECTORS).forEach(function (bar) {
      if (bar.getAttribute('role') === 'tablist') return;
      bar.setAttribute('role', 'tablist');
      var tabs = Array.prototype.slice.call(
        bar.querySelectorAll('button, [role="tab"]')
      );
      tabs.forEach(function (tab, i) {
        tab.setAttribute('role', 'tab');
        var selected = tab.classList.contains('active');
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.tabIndex = selected ? 0 : -1;
        // If the tab's data-tab / data-top / data-val points at a panel id
        // that exists, link them up so screen readers announce the panel.
        var key = tab.dataset.tab || tab.dataset.top || tab.dataset.val;
        if (key) {
          var panel = document.getElementById('tab-' + key)
                    || document.getElementById('top-' + key)
                    || document.getElementById(key);
          if (panel) {
            if (!panel.id) panel.id = 'tab-' + key;
            tab.setAttribute('aria-controls', panel.id);
            if (!panel.getAttribute('role')) panel.setAttribute('role', 'tabpanel');
            if (!panel.getAttribute('aria-labelledby')) {
              if (!tab.id) tab.id = panel.id + '-tab';
              panel.setAttribute('aria-labelledby', tab.id);
            }
          }
        }
      });
      // Sync aria-selected after the portal's existing click handler
      // toggles .active. Runs on next tick so we read the post-handler
      // DOM state, not the pre-click one.
      bar.addEventListener('click', function (e) {
        if (!e.target.closest('[role="tab"]')) return;
        setTimeout(function () {
          tabs.forEach(function (t) {
            var sel = t.classList.contains('active');
            t.setAttribute('aria-selected', sel ? 'true' : 'false');
            t.tabIndex = sel ? 0 : -1;
          });
        }, 0);
      });
      // Arrow-key navigation between tabs — ARIA Authoring Practices.
      bar.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' &&
            e.key !== 'Home' && e.key !== 'End') return;
        var curr = tabs.indexOf(document.activeElement);
        if (curr < 0) return;
        var next = curr;
        if (e.key === 'ArrowRight') next = (curr + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (curr - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        tabs[next].focus();
        tabs[next].click();
        e.preventDefault();
      });
    });
  }
  // Run once after DOM parse; also expose for pages that create tab bars
  // dynamically (admin/settings sub-tab bar etc.).
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { _annotateTabBars(); });
    } else {
      _annotateTabBars();
    }
  }
  Layout.annotateTabBars = _annotateTabBars;

  global.YmirLayout = Layout;
})(typeof window !== 'undefined' ? window : this);
