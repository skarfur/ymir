# Project Instructions

## Project Overview

Ýmir is a sailing club management system. The backend is a Google Apps Script project split across multiple `.gs` files at the repository root (Apps Script concatenates all `.gs` files into a single global namespace). Data is stored in Google Sheets. The frontend is vanilla HTML/JS/CSS hosted on GitHub Pages. There is no build system or package manager — changes to frontend files are deployed directly.

### Backend file layout

- `code.gs` — infrastructure: constants, bilingual strings, primitives, auth/sessions, sheet helpers (`readAll_`, `insertRow_`, `updateRow_`), cache helpers, `doGet`/`doPost`/`route_`
- `data.gs` — thin domain-oriented data-access layer (`data_.readMembers`, `data_.updateTrip`, etc.)
- `members.gs` — member CRUD, sessions API, preferences, daily log
- `maintenance.gs` — maintenance projects
- `payroll.gs` — punch clock, pay periods, launamiðar XML
- `config.gs` — config bundle + certifications
- `incidents.gs` — incident reports
- `checkouts.gs` — checkouts, reservation slots, crews
- `trips.gs` — trips, handshake confirmations, file uploads (GPS tracks + photos)
- `weather.gs` — Vedur.is observations proxy (`getWeather_`)
- `alerts.gs` — overdue alerts (config, dispatch, response handling), share tokens
- `public.gs` — server-rendered public endpoints, volunteer events
- `_setup.gs` — idempotent schema migrations
- `passport.gs` — rowing passport
- `scheduling.gs` — unified `scheduled_events` CRUD (volunteer events + daily-log activities share one sheet via the `kind` discriminator)
- `handbook.gs` — handbook entries (org-chart roles, doc links, info sections)

## Backend Changes (any `.gs` file)

**IMPORTANT:** Whenever you modify any `.gs` file, you MUST explicitly warn the user by calling out the change prominently — e.g., "⚠️ I updated trips.gs (the backend)." Include a summary of what changed and why. Never let a `.gs` edit go unannounced.

Frontend changes can be tested locally, but `.gs` changes require deploying to Google Apps Script.

## Bilingual Support (Icelandic / English)

The app supports Icelandic (`IS`) and English (`EN`). All user-facing strings must include both languages. Backend strings use `GS_STRINGS_`, frontend strings use `strings-is.js` and `strings-en.js` in `/shared/`.

## Naming Conventions

- **Constants:** `UPPER_CASE` with trailing underscore (`SHEET_ID_`, `API_TOKEN_`, `TABS_`)
- **Internal/private functions:** trailing underscore (`ss_()`, `now_()`, `uid_()`, `esc_()`)
- **Public functions:** camelCase (`apiGet()`, `apiPost()`, `saveMember()`)

## Project Structure

- `/` — Apps Script backend (`.gs` files, see "Backend file layout" above)
- `/shared/` — Reusable JS modules and CSS (`api.js`, `boats.js`, `tripcard.js`, `logbook.js`, `layout.js`, `style.css`, etc.)
- `/login/` — Authentication and role selection (entry point)
- `/admin/` — Admin dashboard and payroll
- `/staff/` — Staff portal and logbook review
- `/captain/`, `/coxswain/` — Role-specific portals
- `/member/` — Member hub
- `/dailylog/`, `/logbook/`, `/incidents/` — Logging and reporting
- `/maintenance/`, `/saumaklubbur/` — Maintenance and materials
- `/weather/` — Weather and tides widget
- `/settings/`, `/public/` — User settings and public record lookup
- `/handbook/` — Read-only handbook for members + staff (org chart, docs, info)

## Caching

`api.js` uses sessionStorage caching (60–300s per action). POST operations must invalidate the relevant cache keys.

## Styling

Use existing CSS variables (`--brass`, `--surface`, `--border`, `--text`, `--muted`, `--faint`, `--card`) rather than hardcoding colors. Shared styles live in `/shared/style.css`.

Prefer the utility classes in `shared/style.css` (`.mb-8`, `.gap-6`, `.flex-1`, `.text-muted`, `.w-full`, `.pos-relative`, `.cursor-pointer`, `.icon-inline`, `.d-none`, `.items-center`, etc.) over `style="..."` attributes on elements. Inline `style=` still works but adds to the long tail — when possible pick the utility or add one if the pattern repeats.

## Content Security Policy

Every portal's CSP is strict on `script-src 'self'` (some also allow `https://unpkg.com` for Leaflet/jsQR, which are SRI-pinned). **Never reintroduce an inline `<script>` block or inline event-handler attribute (`onclick=`, `onchange=`, `oninput=`, `onerror=`, etc.) into HTML or into JS-template strings** — they'll be silently blocked by the browser. Use the data-attribute + delegation pattern below.

`style-src` keeps `'unsafe-inline'` deliberately — inline `style=` attributes are allowed for now.

## Event handling (data-* + delegation)

Portals use a per-portal data-attribute convention plus a document-level delegated listener. Each portal picks a short prefix (`admin`, `staff`, `member`, `cq` for captain, `cx` for coxswain, `lb` for logbook, `dl` for dailylog, `mt` for maintenance, `sk` for saumaklubbur, `pr` for admin/payroll, `slr` for staff_logbook-review, `vp` for volunteer, `inc` for incidents, `login`):

```html
<button data-admin-click="saveMember">Save</button>
<input  data-admin-input="filterMembers">
<select data-admin-change="showTab">
<div    data-admin-close-self id="memberModal">…</div>
<button data-admin-close="memberModal">×</button>
```

The portal's `<portal>.js` has a single delegated listener at the bottom that maps each action to the named global function. When adding a new interactive element, extend the appropriate data-* vocabulary rather than writing an inline handler.

Shared modules (e.g. `shared/volunteer.js`, `shared/boats.js`, `shared/maintenance.js`) follow the same pattern with their own prefix (`vp`, `boat`, `mt`, …). Their delegated listeners are attached once per document, guarded by a `document._XxxListener` flag so they stay idempotent across re-mounts.

### Shared-renderer callback contract

When a shared renderer takes handler props (e.g. `renderVolunteerCard({ onSignup, onWithdraw })`, `renderBoatCard({ onClickAction, onCheckIn })`), those props are **function NAMES as strings**, not JS expressions. The renderer emits data attributes; the shared delegated listener looks up `window[fnName]`. Never interpolate arguments into the string — the renderer interpolates IDs into separate data attributes.

## Cache invalidation

Frontend reads are cached in sessionStorage by `shared/api.js` (`apiGet`). When you add a new `apiPost` action that mutates data backing any cached read, **add a row to the `_INVALIDATES` map at the top of `shared/api.js`**:

```js
var _INVALIDATES = {
  saveNewThing: ['getConfig', 'getThings'],
  // …
};
```

Don't add if-branches — the map is the single source of truth. Duplicate parallel `apiGet` calls during page init are de-duped automatically via `apiGet._inflight`; no action needed.

## Script properties (Apps Script project settings)

The backend reads secrets and config from `PropertiesService.getScriptProperties()`. **Never hard-code these in source.** Required keys:

- `SHEET_ID` — the Google Sheets document ID the backend reads/writes
- `API_TOKEN` — the shared token the frontend sends on every authenticated call

Additional optional keys used by various flows: `BOOTSTRAP_KENNITALA`, `BOOTSTRAP_PRESET_PASSWORD`, `DRIVE_FOLDER_ID_PHOTOS`, `DRIVE_FOLDER_ID_MAINT_PHOTOS`, `DRIVE_FOLDER_ID_HANDBOOK_DOCS`. Set these in Apps Script → Project Settings → Script Properties before deploying a fresh environment.

## Portal file layout

Each portal is three files at the same path:

```
<portal>/index.html     structure + CSP + script/style tags
<portal>/<portal>.js    page logic (loaded via <script src defer>)
<portal>/<portal>.css   page styles (loaded via <link rel=stylesheet>)
```

Each portal also includes `<ymir-header></ymir-header>` from `shared/layout.js` — this emits the header shell, tags the first content container with `id="ym-main"`, and injects a skip link as the first Tab stop.

### Admin is split into per-sub-tab modules

`admin/admin.js` is the router/core (~420 lines). Every sub-tab has its own file: `admin/members.js`, `admin/boats.js`, `admin/locations.js`, `admin/checklists.js`, `admin/act-types.js`, `admin/volunteers.js`, `admin/scheduling.js`, `admin/certs.js`, `admin/alerts.js`, `admin/flags.js`, `admin/import.js`, `admin/calendars.js`, `admin/passport.js`. When adding or editing an admin feature, work in the matching file — don't grow `admin.js` core. All are loaded as separate `<script>` tags in `admin/index.html`; order is documentary (defer guarantees correctness).

The **Scheduling** tab is the visible consolidation of activity types, volunteer events, and club calendars: one tab, four col-sections (Upcoming events, Activity types, Volunteer events, Calendars). `admin/scheduling.js` owns the new "Upcoming events" timeline; the other sections delegate to existing renderers (`renderActTypes` in `act-types.js`, `renderVolunteerEvents` in `volunteers.js`, `loadClubCalendars` in `calendars.js`). Underneath, both volunteer events and daily-log activities live in one sheet (`scheduled_events`, backed by `scheduling.gs`). Client code normalizes across the two API shapes via `shared/scheduled-event.js`.

### Logbook shared module is split similarly

`shared/logbook.js` is core (state, filter/render, card interactions, map, lightbox, mutations, delegation). Feature code lives in `shared/logbook-form.js`, `shared/logbook-share.js`, `shared/logbook-confirm.js`, `shared/logbook-edit.js`. Both consuming portals (`captain/`, `logbook/`) include all five in sequence.

## Accessibility

- Modals use the shared `openModal(id)` / `closeModal(id)` in `shared/ui.js`, which save/restore focus and trap Tab. Don't bypass them.
- Tab bars (`.tab-bar`, `.vp-tab-bar`, `.pr-tabs`) are auto-annotated with WAI-ARIA roles + arrow-key navigation by `Layout.annotateTabBars()` — just match the existing class + `data-tab` pattern and it works.
- `<label>` elements should have explicit `for="<input-id>"` when they sit next to (not around) their input.
- `<img>` elements always need an `alt` attribute. Use `alt=""` for purely decorative images.

## Write-side guards (backend)

- Generic sheet writes go through `insertRow_` / `updateRow_`, which invoke `validateRow_` — don't bypass by calling `sheet.appendRow()` / `setValue()` directly unless the shape is genuinely narrower (e.g. time-clock entries).
- `headers.indexOf('colName')` returns -1 silently on missing columns. Use `requiredCol_(headers, 'colName')` instead when the result will be used as an index; the helper throws loudly.
- New public (no-auth) GET endpoints must be gated by `publicRateLimit_(bucket, limit, windowSec)` in the `doGet` router.

## Dynamic language attribute

`shared/strings.js` sets `document.documentElement.lang` to the active language on load. The static `lang="en"` in each portal HTML is a fallback; don't try to keep it in sync — the dynamic setter takes over the moment strings.js executes.

## Tooling (run before you commit)

- `node tools/check-strings.js` — fails if `shared/strings-en.js` and `shared/strings-is.js` are missing keys in either direction. Zero dependencies.
- `node tools/check-syntax.js` — runs `node --check` over every `.js` and `.gs` file. Catches parse errors immediately.
- `npm run check` — runs both of the above plus ESLint + Prettier (the latter two are non-blocking in CI until rules settle).

## Version history

Material changes go in `CHANGELOG.md` at the repo root, not in header comments at the top of `code.gs` or other files. Group by release or "Unreleased" for the current branch's work.
