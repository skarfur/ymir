# Changelog

Material changes to the Ýmir Sailing Club codebase. Entries are newest-first.
Commit hashes reference the `main` branch.

## Unreleased — light theme is the default

New users (and anyone without a saved `ymirTheme`) now get light mode out of
the box. `shared/api.js` `getTheme()` defaults to `"light"`; `settings.js`
`saveSettings` falls back to `"light"` when nothing is selected. The login
page now calls `applyTheme()` on load — previously it didn't load `ui.js`, so
the form always rendered with the `:root` dark palette regardless of the
user's saved preference. The Google sign-in button also measures its
container and renders at the card's actual inner width (clamped to GSI's
200-400px range) so it lines up flush with the password inputs on every
screen instead of sitting at a hard-coded 320px.

## Unreleased — Google sign-in (one-click, with password fallback)

Members can link a Google account and sign in with Google Identity Services'
one-tap / "Sign in with Google" button. Password sign-in stays as the
primary backup and as the linking mechanism — members log in with their
password once, then link their Google account from Settings → Sign-in, and
future sign-ins on that device can complete in one click.

- **Backend (`members.gs`, `code.gs`, `_setup.gs`).** New `loginWithGoogle`
  public action verifies the Google ID token via
  `oauth2.googleapis.com/tokeninfo` (checks `aud`, `iss`, `exp`,
  `email_verified`), looks up a member by a new `googleEmail` column, and
  mints a session via the existing `createSession_` path. New authenticated
  `linkGoogleAccount` / `unlinkGoogleAccount` actions manage the link on the
  caller's own member row; linking refuses an email that's already tied to
  another member. `publicMember_` now exposes `googleEmail`. Requires the
  `GOOGLE_CLIENT_ID` script property to be set.
- **Login portal (`login/index.html`, `login/login.js`, `login/login.css`).**
  GIS button renders above the kennitala/password form when
  `GOOGLE_CLIENT_ID` is configured; one-tap prompt fires on load. CSP
  updated to allow `https://accounts.google.com/gsi/`.
- **Settings portal (`settings/`).** New "Google account" row inside the
  Sign-in section: shows the linked email + a Disconnect button, or a
  "Continue with Google" link button. CSP updated to match login.
- **Strings + cache.** `login.or`, `login.googleNotLinked`,
  `login.googleError`, and nine `settings.google*` keys added to both
  `strings-en.js` and `strings-is.js`. `shared/api.js` invalidates
  `getMembers` after `linkGoogleAccount` / `unlinkGoogleAccount`, and
  exposes a public `GOOGLE_CLIENT_ID` constant alongside `SCRIPT_URL`.
- **Auto-link on import (`members.gs`, `_setup.gs`).** `importMembers_` and
  `saveMember_` pre-populate `googleEmail` whenever a row's email is
  provably a Google Account — personal Gmail (`@gmail.com`,
  `@googlemail.com`) is matched directly; every other domain is tested by
  resolving MX records via `https://dns.google/resolve` (script-cache TTL
  24h per domain). Explicit `googleEmail` in the payload wins; an
  existing link is never overwritten. New one-shot editor helper
  `autoLinkGmailAddresses()` backfills the same logic onto existing
  members whose `googleEmail` is still empty.
- **Deployment prerequisites.** Create an OAuth 2.0 Client ID in Google
  Cloud Console with the site origin (e.g. `https://skarfur.github.io`) and
  `http://localhost:*` on "Authorized JavaScript origins". Set the client
  ID on both the Apps Script `GOOGLE_CLIENT_ID` script property and the
  `GOOGLE_CLIENT_ID` constant in `shared/api.js`. Run
  `setupSpreadsheet()` to add the new `googleEmail` column, then
  optionally `autoLinkGmailAddresses()` once to backfill existing rows.
## Unreleased — unified compact button size

- **`.btn-sm` modifier in `shared/style.css`** — one canonical compact size
  (`padding: 6px 12px; font-size: 11px; min-height: 0;`) replaces ~40 ad-hoc
  inline `style="padding:…;font-size:…"` overrides spread across captain,
  staff, coxswain, admin, member, weather, incidents, and the shared boat /
  slot / maintenance / payroll / boats modules. Mobile caps the touch target
  at 32px (between `.btn`'s 44px and `.btn-ghost`'s 36px).
- **Captain's slot-week-nav aligns with the rest** — removed the
  `.slot-week-nav .btn` size rule; the strip now uses `.btn-sm` directly,
  so "Assign cred", "+ Add boat", "← →", "New Booking" and "Bulk Book" all
  share the same height/padding instead of drifting by 1–3px each.

## Unreleased — logbook bug fixes

Surface-level fixes for the logbook portal after the inline-style → utility-class
refactor (`c9c77e1`) silently broke JS toggles that read/write `style.display`
on elements initialised with `class="d-none"`.

- **Stats + share panel + manual-trip modal internals show again.** 17 elements
  in `logbook/index.html` (`#stat-strip`, `#catHours`, `#confBadge`,
  `#sharePanel`, `#loadMoreTripsBtn`, `#joinExtras`, `#jErr`, `#logStep2`,
  `#mSkipperSection`, `#mBoatFree`, `#mLocFree`, `#mLocGeoStatus`,
  `#mCrewSection`, `#addPortHint`, `#mWxFetchStatus`, `#mErr`, `#etErr`,
  `#puErr`) switched back from `class="d-none"` to `style="display:none"`.
  The refactor had swapped the inline style for the utility class but the
  callers kept toggling via `.style.display = '' / 'none'`, which can't
  override the class rule — so "Enter Manually", "Share your logbook", the
  stats strip, and most inline error banners were stuck hidden.
- **Modals no longer dock to the bottom of the viewport.** All four logbook
  modals (`#confirmationsModal`, `#logModal`, `#editTripModal`,
  `#photoUploadModal`) swapped `class="modal-sheet"` → `class="modal"` so
  they center per the shared overlay rule instead of triggering the
  `align-items: flex-end` `:has()` variant.
- **Join-a-recent-club-trip card respects CSP.** `shared/logbook-form.js`
  no longer does `card.setAttribute('onclick', …)` — replaced with
  `data-lb-click` / `data-lb-arg` and `joinTripAsCrew(tripId)` now looks up
  the card by its `data-lb-arg` attribute.

## Earlier — security, CSP, and accessibility hardening

Large cross-cutting pass started from an external code review. Grouped by the
review's categories; see commit messages for per-change detail.

**Security**

- `code.gs`: `SHEET_ID_` / `API_TOKEN_` constants read from `PropertiesService`
  at runtime instead of being hard-coded source literals. Apps Script project
  needs two Script Properties set (`SHEET_ID`, `API_TOKEN`) before deploy.
- All four public endpoints (`lookup`, `captain`, `boat`, `dashboard`) now
  gated by a `publicRateLimit_` helper backed by `CacheService`. Per-licence
  throttle on `lookup` (10 attempts / 15 min) blocks initials-guessing;
  others are 60–120 req/min global.
- `validateRow_` called at the top of `insertRow_` / `updateRow_` — rejects
  unknown tab keys, non-object payloads, and strings over 45 kB (Sheets
  cell cap is 50 kB; margin avoids silent truncation).
- SRI on every CDN load (Leaflet, Leaflet-heat, jsQR) for both the static
  `<script src>` tags and the dynamic loaders in `shared/logbook.js` and
  `shared/qr.js`.

**CSP — `script-src 'self'` on every portal**

- All 19 portal `index.html` files had their inline `<script>` blocks
  extracted to per-portal `<portal>.js` companions.
- All 10 shared JS modules that emitted inline `onclick=` attributes were
  refactored to `data-*` + document-level delegated listeners. Affected
  modules: `certs`, `weather`, `volunteer`, `maintenance`, `payroll`,
  `boats`, `slot-modal`, `mcm`, `boat-modal`, `logbook`.
- The shared rendering APIs (`renderVolunteerCard`, `renderBoatCard`,
  `renderCheckoutCard`, `renderFleetStatus`) now take function **names**
  as strings instead of pre-interpolated JS expression strings. Call sites
  in `admin/`, `staff/`, `member/` updated atomically.

**Frontend correctness**

- `shared/api.js` cache-invalidation: the six-branch if-chain is now a
  declarative `_INVALIDATES` map from action name to list of getXxx cache
  keys to evict. Adding a write just adds a table row.
- `apiGet._inflight` dedupes parallel identical requests — common on page
  init when two components both fetch `getConfig` or `getMembers` during
  the cache-miss window. Keys clear in a `finally` to avoid leaks.
- `_handleUnauthorized` shows a bilingual "Your session expired" toast
  for 1.5 s before redirecting to `/login/`, instead of silent page-blank.
- `shared/logbook.js` builds `_boatById` / `_memberByKt` Maps when
  `allBoats` / `allMembers` reload and replaces 10 per-trip `.find()`
  calls with `_boat(id)` / `_member(kt)` — `O(n²)` → `O(n)` on render.
- Service-worker cleanup block in `api.js` gated behind a one-shot
  localStorage flag instead of running on every page load.

**Accessibility**

- `<ymir-header>` emits a visually-hidden skip link as the first Tab stop
  on every portal; tags the first content sibling with `id="ym-main"` so
  the link always has a target.
- `Layout.annotateTabBars` auto-annotates every `.tab-bar` / `.vp-tab-bar`
  / `.pr-tabs` as a WAI-ARIA `tablist` with `role`, `aria-selected`,
  `aria-controls`, `aria-labelledby`, and arrow-key navigation.
- 186 `for=` attributes added to `<label>` elements that preceded an id'd
  input. `<img>` elements now always have `alt`.
- `shared/ui.js` `openModal` / `closeModal` save and restore prior focus;
  document-level Tab / Shift-Tab trap keeps focus within the top-most
  open modal.

**i18n**

- `tools/check-strings.js` diffs the key sets of `shared/strings-en.js`
  and `shared/strings-is.js`. Exits non-zero with a missing-key list;
  wired into CI.
- `shared/strings.js` sets `document.documentElement.lang` to the active
  language on load. Static `<html lang>` unified to `lang="en"` across
  all 19 portals (the dynamic setter overrides).
- 19 new stat-label keys added for the highest-visibility hardcoded
  strings (logbook personal-stats grid, admin YTD panel,
  member report-issue modal, alert-action spinner).

**Architecture / naming**

- `code.gs` monolith split into 13 domain-scoped files
  (`_setup`, `alerts`, `checkouts`, `code`, `config`, `data`, `incidents`,
  `maintenance`, `members`, `passport`, `payroll`, `public`, `trips`).
- `data.gs` exposes a `data_` namespace of domain-oriented readers over
  the sheet primitives.
- 31 functions with double-prefix names (`_foo_`) renamed to trailing-
  underscore-only (`foo_`) per CLAUDE.md convention. No call-site
  collisions.
- `requiredCol_(headers, name)` helper replaces the silent-`-1`-return
  `headers.indexOf(name)` pattern in five `alerts.gs` sites that index
  rows with the result. Missing columns throw loudly instead of
  miswriting to column −1.

**Tooling (this release)**

- Added `.gitignore`, `.eslintrc.json`, `.prettierrc.json`,
  `.prettierignore`, minimal `package.json`, and
  `.github/workflows/checks.yml` — CI runs strings parity, syntax check
  on every `.js` / `.gs`, and (non-blocking for now) ESLint / Prettier.
- `tools/check-syntax.js` parse-checks every `.js` and `.gs` file.

**Debuggability**

- `doGet` / `doPost` outer `catch` now include `err.message` in the
  client response (`'Server error: ' + err.message` instead of the bare
  `'Server error'`). The Apps Script `Logger.log` still carries the full
  stack; this surfaces enough detail in the browser console that a
  future regression doesn't need Apps Script log access to diagnose.

## v6

Apps Script backend. Previously lived as a comment at the top of
`code.gs`; moved here on the Unreleased pass.

- Boats and locations moved from dedicated sheets to config-sheet JSON.
  `getConfig` now returns `boats` + `locations`; `saveConfig` accepts
  them.
- Removed one-time setup functions (`addLangColumnIfNeeded`,
  `addAlertColumnsIfNeeded`, `createSheetStructure`). Run these from
  v5 if you need to re-bootstrap a sheet.
- Removed now-unused sheet-based boat/location handlers: `getBoats_`,
  `saveBoat_`, `deleteBoat_`, `getLocations_`, `saveLocation_`,
  `deleteLocation_`.
