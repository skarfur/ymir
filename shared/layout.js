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
  // unpkg for script + style.
  var CSP_LEAFLET_ =
    CSP_BASE_.replace(
      "script-src 'self'",
      "script-src 'self' https://unpkg.com"
    ).replace(
      "style-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://unpkg.com"
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
        host.replaceWith(hdr);
        if (page && typeof global.buildHeader === 'function') {
          // buildHeader may race DOMContentLoaded; call on next tick so
          // user state (getUser) has had a chance to resolve.
          setTimeout(function () { try { global.buildHeader(page); } catch (e) { console.warn(e); } }, 0);
        }
      }
    });
  }

  global.YmirLayout = Layout;
})(typeof window !== 'undefined' ? window : this);
