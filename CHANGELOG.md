# Changelog

Material changes to the Ýmir Sailing Club codebase. Entries are newest-first.
Commit hashes reference the `main` branch.

## Unreleased — drop one-shot migration / seed helpers and dead modules

Sweep of legacy code that's already done its job. Every removed function was
either a one-time data migration that's been run on every environment, an
ad-hoc column/tab adder that's been folded into `setupSpreadsheet()` via
`SCHEMA_`, or an unreferenced module.

Backend (`.gs`):
- `_setup.gs` — removed `addRecentTripColumns`, `addPhotoMetaColumn`,
  `addHandshakeColumns`, `addPreferencesColumn`, `addReservationAndCrewTabs`
  (all redundant with `setupSpreadsheet()`); `migrateMemberLangIntoPreferences`
  (lang column already gone from `SCHEMA_`); `autoLinkGmailAddresses`
  (one-shot Google-email backfill, completed); `migrateToScheduledEvents` and
  the two private row-shape helpers (`_volEventToScheduledRow_` /
  `_activityToScheduledRow_`).
- `passport.gs` — removed `migrateRowingDivisionToSubcats` (legacy
  `released_rower` cert migration; runtime compat in `shared/api.js` still
  reads old cert shapes) and `ensurePassportSignoffsTab` (covered by
  `setupSpreadsheet()`).
- `handbook.gs` — removed `seedHandbookOrgChart_`,
  `migrateHandbookOrgChartToAreas_`, and `_hbSeedKey_` (only used by the seed
  helper). The org chart is admin-edited day-to-day; the default-seed and
  level-3-collapse migrations have run.
- `code.gs` — dropped the two `ADMIN_ACTIONS_` entries and `route_` cases
  for `seedHandbookOrgChart` / `migrateHandbookOrgChartToAreas`.
- `scheduling.gs` — header comment no longer points at the deleted migration.

Frontend:
- `admin/index.html` — removed the "Seed default org chart" and "Migrate
  sub-roles → areas" buttons under Settings → Handbook → Org chart.
- `admin/handbook.js` — removed the matching `seedHandbookOrgChart()` and
  `migrateHandbookOrgChart()` handlers.
- `shared/api.js` — dropped both actions from the `_INVALIDATES` map.
- `shared/strings-en.js` / `shared/strings-is.js` — dropped 5 keys
  (`admin.handbookSeedDefaults`, `admin.handbookSeedConfirm`,
  `admin.handbookMigrateAreas`, `admin.handbookMigrateAreasConfirm`,
  `admin.handbookMigrateAreasNoop`).

Dead module:
- `shared/alerts.js` — never referenced from any portal HTML or JS;
  `startAlertPoller` / `stopAlertPoller` had no call sites. The active
  client-side poller lives in `admin/alerts.js`.

Net: 11 files touched, 869 lines removed, 3 added.

⚠️ Backend files changed: `_setup.gs`, `code.gs`, `handbook.gs`, `passport.gs`,
`scheduling.gs`. No data migrations needed; the schema and existing data
are untouched. Redeploy Apps Script.

## Unreleased — Handbook storage: all four sections move to config

All four handbook tables (`handbook_roles`, `handbook_docs`,
`handbook_contacts`, `handbook_info`) collapse into JSON arrays under
config keys `handbookRoles` / `handbookDocs` / `handbookContacts` /
`handbookInfo` — same pattern as `boats`, `locations`, `activity_types`,
etc. Save/delete now go through the existing `saveConfigListItem_` /
`deleteConfigListItem_` helpers; no handbook-specific sheets remain.

`getHandbook` stays a separate endpoint (storage ≠ delivery): every page
calls `getConfig`, but only the handbook page needs handbook content.

Cell-size note: Sheets caps cells at 50,000 chars. Long-form info
content (rules, harbor briefings) could plausibly approach that if a
club accumulates many bilingual sections. If that ever happens, split
per-section into `handbookInfo_<id>` keys instead of one mega-blob.

Migration: `getHandbook_` auto-runs a one-shot copy from the legacy
sheets to the new config keys on first read after deploy. It's
idempotent (skips keys that already have data) and also exposed
manually as the `migrateHandbookSheetsToConfig` action, which returns a
per-target `{counts, notes}` payload so admins can see *why* a target
was skipped (`skip:no-tab` / `skip:no-rows` / `skip:already-populated`
/ `error:…`). After it runs, the old `handbook_roles` /
`handbook_docs` / `handbook_contacts` / `handbook_info` tabs sit
unused and can be deleted from the spreadsheet.
## Unreleased — trip-card fixes: student badge scope, captain-page actions, verify-pending persistence

Three independent bugs surfaced on the same trip card:

- **Student badge in collapsed view leaked across users.** `tripCard()`
  flagged `isStudent` from `t.student` alone, which is correct on the
  member's own logbook (one row per user) but wrong on the captain
  portal (`myTrips` is fleet-wide, so `t` may belong to another
  member). Now gated by `isOwner` so the collapsed-view STUDENT badge
  reflects "I was the student on this trip", not "a student was
  aboard". The expanded crew list still labels each individual
  student.
- **Captain trip cards: "Edit trip" / "Add photos" silently no-op'd.**
  `openModal('editTripModal')` returns silently when the element is
  missing, and the two modals + their `data-lb-*` delegated listener
  only existed in `/logbook/index.html`. `shared/logbook-edit.js` now
  injects both modals (idempotent — the logbook portal still ships
  its own copy) and registers the `data-lb-*` listener with the same
  `document._lbListeners` guard so nothing double-fires. Captain
  portal also now loads `shared/trip-form.js` so the injected
  weather-fields container has a generator.
- **"Verification pending" badge disappeared after refresh.**
  `requestVerification_` only created the handshake row; it never set
  `validationRequested` on the trip itself, so after reload the badge
  depended on `_confirmations.outgoing`, which the captain portal
  doesn't load (no `#confBadge`). Backend now mirrors the flag onto
  the trip on request, clears it on `applyRejectionCleanup_` for
  `verify`, and `requestVerification` / `requestValidation` invalidate
  `getTrips` in addition to `getConfirmations`.

## Unreleased — Handbook portal (`/handbook/`)

New members- and staff-facing reference page at `/handbook/`, four
sections in fixed order — **Important contact numbers**, **Org chart**,
**Rules & best practices**, **Documents** — all admin-managed from
the new **Settings → Handbook** sub-tab.

Content:
- **Contact numbers** — two coexisting types, both admin-curated:
  free-text entries (e.g. "Emergency: 112", "Coast Guard: …") via
  `handbook_info` with `kind='contacts'`, plus a member-linked phone
  book (`handbook_contacts` sheet) where each row picks a member from
  a dropdown and gets a free-text label (e.g. "Maintenance lead",
  "Emergency contact"). Member-linked rows hydrate missing
  name / phone / email from the member record at read time, so
  updating a member updates their handbook entry automatically. No
  blanket auto-pull of all staff — admins curate exactly which people
  appear here.
- **Org chart** — hierarchical category nodes (Stjórn, deildir,
  sub-roles). Each node holds a `members` JSON array of
  `{ kennitala, label, labelIS, representsRoleId }`. Names, phones
  and emails are always pulled from the linked member record at read
  time — no free-text name field. Members render *inside* their
  parent box rather than as separate child nodes; a member can
  optionally `represent` another role (e.g. a board member who
  represents Kjölbátadeild), which surfaces as a small chip colored
  by the represented role's accent. Rendered as a real visual tree
  (boxes + connector lines) using pure CSS (`hb-orgchart`). Each role can have
  an optional `color` (top-border accent), an optional `kennitala`
  link to a member record (read endpoint hydrates missing name / phone
  / email from that member), and an optional `boatCategoryKey` link to
  a boat category from config — the read endpoint resolves the deild's
  color from the matching category at request time so the chart stays
  in sync if a category color is retuned elsewhere. Explicit `color`
  wins over the category fallback; `--hb-accent` cascades from each
  deild's wrap to its sub-roles via CSS custom-property inheritance,
  so sub-roles automatically inherit the deild color without storing
  their own. Default seed maps the five deildir to their boat
  categories (Kjölbátadeild → keelboat, Kænudeild → dinghy,
  Róðrardeild → rowing-shell, Kajakadeild → kayak, Bævængjudeild →
  wingfoil) and adds the four standard areas of responsibility under
  each deild — Námskeið / Iðkendur / Félagsstarf / Keppnisstarf —
  ready for admins to assign people. The seed dedupes by
  `(titleIS|parentId)` so the same sub-role title can coexist under
  every deild and re-running the seed adds only what's missing.
- **Rules & best practices** — single bilingual free-text body (one EN +
  one IS markdown blob) rather than per-rule cards. Admin edits both
  textareas inline with a small format toolbar (bold, italic, headings,
  lists, link, code); rendered as formatted HTML on the read side using
  a minimal markdown subset. Stored as a single canonical
  `handbook_info` row with `id='rules_main'`, `kind='rules'`. Pre-existing
  per-rule rows still surface (first one wins as fallback) until an
  admin saves once.
- **Documents** — PDFs and external URLs grouped by category. Admin can
  upload PDFs (or any common doc/image type) directly through the UI;
  uploads land in a dedicated Drive folder via new script property
  `DRIVE_FOLDER_ID_HANDBOOK_DOCS`. Deleting a doc trashes its Drive
  file.

Backend (`handbook.gs`):
- One read (`getHandbook`) returns `{ roles, contacts, docs, info }`.
- Eight admin-only writes plus `seedHandbookOrgChart` — a one-shot
  helper that adds Stjórn + 5 deildir (Kjölbátadeild, Kænudeild,
  Róðrardeild, Kajakadeild, Bævængjudeild) when missing. Idempotent;
  never overwrites existing entries.
- Four new sheets: `handbook_roles` (with `color` and `parentId`),
  `handbook_contacts` (with `memberId` link), `handbook_docs`, and
  `handbook_info` (with `kind` discriminator — `'contacts' | 'rules'
  | 'info'`). Added to `_setup.gs` SCHEMA_; `setupSpreadsheet()`
  will create them and add columns to existing installs.
- All write actions gated by `ADMIN_ACTIONS_`. Soft-delete via
  `active=false` so audit history survives.

Frontend:
- Nav links from the member portal (quick-action strip) and staff portal
  (tools nav-card grid). New `nav.handbook` / `handbook.*` strings in
  EN + IS.
- `getHandbook` cached 120s in `shared/api.js`; all nine write actions
  invalidate the cached read.
- New admin sub-module `admin/handbook.js` with a contact-picker modal
  (member dropdown + free-text label with autocomplete from past
  labels), `kind` selector for info entries, color picker for role
  boxes, and a "Seed default org chart" button that calls the backend
  seed helper.

## Unreleased — collapse trip cards back to a single-row summary

The 2-column grid added in `860555b` (boat/crew, departed/returned,
location/duration) made collapsed cards heavy enough to defeat the
purpose of collapsing. Reverted to the single boat headline + badges
row: date, boat, duration, wind, and role/verification/student/
non-club/pending badges. Times, location, crew count, distance, and
ports already live in the expanded card.

Dropped now-unused CSS (`.trip-grid`, `.trip-cell`, `.trip-lbl`,
`.trip-val`, `.trip-badges`, `.trip-port`) and promoted the previously
legacy `.trip-boat` / `.trip-meta` back to primary.

## Unreleased — fix 2×16-minute time drift from Sheets auto-converting "HH:MM" strings

Observed: a scheduled event created today appeared 32 minutes later than
entered. Root cause: `setValue("09:00")` hands Sheets a string that looks
like a time literal, and Sheets silently stores it as a Date anchored to
the 1899-12-30 epoch **in the sheet's timezone**. `sanitizeCell_` then
formatted that Date using the **script's** timezone, and for the
Atlantic/Reykjavik LMT-era historical date the two timezones' tzdata
tables disagreed by ~16 minutes. Any round-trip (read → frontend → write)
compounded the drift, landing at exactly 2×16 = 32 minutes.

Two fixes:

1. **Write side** (`literalWrite_` in `code.gs`) — prepend a literal
   apostrophe to any string matching `HH:MM` or `YYYY-MM-DD` so Sheets
   stores the cell as plain text and never auto-converts to a Date. The
   apostrophe is invisible in the rendered cell and stripped by
   `getValue()`. Existing protection for formula chars (`=+-@`) and line
   breaks is preserved.
2. **Read side** (`sanitizeCell_` in `code.gs`) — for Date cells whose
   UTC ISO starts with `1899-12-2x/3x` (Sheets' time-only epoch), format
   using the spreadsheet's timezone (`ss.getSpreadsheetTimeZone()`,
   cached per request) instead of the script's timezone. The sheet TZ is
   what Sheets used to anchor the value, so reading with the same TZ
   round-trips cleanly regardless of which engine's tzdata the script
   process uses.

Together, these close the drift class:
- New writes store text → zero TZ involvement on the round-trip.
- Pre-existing Date-valued cells format consistently against the same TZ
  that wrote them.

⚠️ Backend file changed: `code.gs`.

## Unreleased — admin tabs consolidate into one Scheduling tab + client ScheduledEvent normalizer

Three admin tabs — Activity Types, Volunteers, and (Club) Calendars — merge
into a single **Scheduling** tab with four col-sections: Upcoming events,
Activity types, Volunteer events, Calendars. Reservation slots keep their
own tab (per-boat; different domain). URL aliases (`?tab=actTypes`,
`?tab=volunteers`, `?tab=clubCal`) redirect to `?tab=scheduling` so
bookmarks keep working.

The new **Upcoming events** card is the payoff: a 30-day merged timeline of
volunteer events + bulk-scheduled activity projections, sorted by date and
time, with kind + source badges. Built client-side from data already loaded
in the admin page — no extra API calls. Activity types that read their
schedule from Google Calendar are surfaced as a hint beneath the list
(per-date projection needs the backend).

**New files**:
- `shared/scheduled-event.js` — `toScheduledEvent(raw, {kind, source, signupCount})`,
  `buildUpcomingEvents({actTypes, volunteerEvents, volunteerSignups, fromIso, toIso})`,
  `calendarSourcedActivityTypes(actTypes)`. The shape matches the backend's
  `scheduling.gs` domain object so front- and backend stay aligned.
- `admin/scheduling.js` — owns `renderSchedulingTab()` (called from
  `showTab('scheduling')`) and `renderUpcomingEvents()`. Existing renderers
  in `act-types.js` / `volunteers.js` / `calendars.js` are unchanged and
  continue to own their own col-sections; the scheduling module just
  composes them.

Plus minor CSS in `admin.css` for the timeline look (tabular time column,
kind/source badges, per-day group headers), a documentation update in
`CLAUDE.md`, and 11 new strings × 2 languages (all `admin.sched*` /
`admin.tabScheduling`).

## Unreleased — unified `scheduled_events` table replaces two split storage locations

Volunteer events and daily-log activities now share a single sheet,
`scheduled_events`, with a `kind` discriminator (`'volunteer'` vs `'activity'`)
and a `status` column (`'upcoming' | 'completed' | 'cancelled' | 'orphaned'`).
Replaces:

- the `activities` JSON column on `daily_log` rows (for daily-log activities), and
- the `volunteer_events` JSON value in `config` (for volunteer events).

Every scheduled event is now one sheet row, keyed by id. Signups in
`volunteer_signups` already reference that id via `eventId`, so no cascade
rewrite was needed — ids are preserved across the migration.

**Migration**: one-shot, idempotent, lives in `_setup.gs` as
`migrateToScheduledEvents()`. It reads the legacy locations, inserts each row
into `scheduled_events`, and skips ids that already exist. Run it from the
Apps Script editor once per environment after deploying the new code. The
legacy columns/keys are left populated (but no longer read) so a `git revert`
of this cutover rolls back cleanly.

**New module**: `scheduling.gs` owns the read/write primitives
(`sched_getById_`, `sched_listVolunteerEvents_`, `sched_listActivitiesForDate_`,
`sched_upsert_`, `sched_cancel_`, `sched_hardDelete_`). Every site that used
to touch either storage location now goes through these helpers, so the
sheet is a genuine single source of truth.

**Call sites rewritten** (backend only):

- `public.gs` — `saveVolunteerEvent_`, `deleteVolunteerEvent_`,
  `volunteerSignup_` (virtual-event materialization),
  `materializeVolunteerEventsForAt_`, `reconcileVolunteerEventsForAt_`,
  `syncVolunteerEvents_`. `volMergeMaterialized_` deleted — replaced by
  idempotent upsert.
- `members.gs` — `getDailyLog_` (reads from `scheduled_events`, packs into
  the existing `log.activities` JSON for frontend compat), `saveDailyLog_`
  (splits per-activity rows via new `persistDailyLogActivities_` helper),
  `materializeYesterday_` (freezes projections into rows).
- `checkouts.gs` — `syncVolunteerEventToCalendar_` reads/writes through
  `sched_*` helpers instead of config.
- `config.gs` — `getConfig_` synthesizes the legacy `volunteerEvents` DTO
  via `listVolunteerEventDtos_` (in `public.gs`) so the frontend contract is
  preserved. `deleteActivityType_` cascade drops rows from `scheduled_events`.

**Frontend**: zero changes in this commit. `getConfig().volunteerEvents` and
`getDailyLog().log.activities` preserve their pre-cutover shapes. Admin tab
consolidation + client-side `ScheduledEvent` normalizer land in a follow-up.

⚠️ Backend files changed: `_setup.gs`, `code.gs` (SCHEMA_/TABS_), new
`scheduling.gs`, `config.gs`, `members.gs`, `public.gs`, `checkouts.gs`.
Redeploy Apps Script, then run `migrateToScheduledEvents()` from the editor.

## Unreleased — activity types can read their schedule from Google Calendar, volunteer events write back

Activity types now pick a `scheduleSource`: `bulk` (the existing per-subtype
bulk-schedule editor) or `calendar` (reads from the activity type's Google
Calendar for each date). In calendar mode, `projectActivitiesForDate_` calls
the new `projectActivitiesFromCalendar_` helper (`checkouts.gs`) — it reads
events for the requested day via `CalendarApp.getCalendarById().getEvents()`,
caches the result in `CacheService.getScriptCache()` for 5 minutes, and maps
each event to the same scheduled-activity shape the daily log already knows
how to render. Subtype matching is best-effort by title substring (EN or IS),
so subtype names still carry through when they appear in the calendar event
title. Bulk-schedule authoring is preserved unchanged for types that stay on
`scheduleSource: 'bulk'` (the default, also used for legacy rows).

Admins author the new setting in the activity-type modal via a radio-button
block (`admin/index.html`, wired in `admin/act-types.js`). Switching a type
to calendar mode fades the subtype/bulk-schedule section so nobody edits it
expecting it to do something. The existing `calendarId` + `calendarSyncActive`
fields double as the read source — one calendar does both jobs.

Volunteer events now round-trip to Google Calendar. `saveVolunteerEvent_` and
`deleteVolunteerEvent_` (`public.gs`) call the new
`syncVolunteerEventToCalendar_` / `deleteVolunteerEventCalendarEvent_` helpers
(`checkouts.gs`) — mirroring the existing daily-log-activity writer. The
reconcile, prune, and cascade paths (`reconcileVolunteerEventsForAt_`,
`syncVolunteerEvents_`, `deleteActivityType_`) tear down the GCal twin when a
materialized event is pruned or soft-deleted, so the calendar never drifts
out of sync with the admin view. `gcalEventId` is persisted on the event row
in config and preserved across edits, so upserts stay idempotent.

New strings: `admin.scheduleSource*` (5 keys × 2 languages).

⚠️ Backend files changed: `config.gs`, `checkouts.gs`, `public.gs`.

## Unreleased — Lucide icons replace text/emoji in maintenance & admin modals

Added a shared Lucide icon registry (`window.icon(name)` in `shared/ui.js`)
seeded with `image-plus`, `message-square-plus`, and `trash-2` (MIT). Inline
SVGs use `currentColor` + `.icon-inline`, so they inherit size and color from
their container and stay CSP-safe under `script-src 'self'`.

`shared/strings.js` `applyStrings()` now recognizes three extra declarative
hooks on any element: `data-s-aria` (sets `aria-label`), `data-s-title` (sets
`title`), and `data-icon="<name>"` (injects the registered SVG once). This is
the icon-only counterpart to the existing `data-s` text setter — innerHTML is
only touched by `data-icon`, so i18n and icon painting don't fight.

Applied to: the camera-emoji photo attach in the maintenance comment form
(→ `image-plus`), the maintenance comment Post button (→ `message-square-plus`,
now icon-only), the per-comment delete ×, the maintenance request delete
button, and eight admin modal Delete buttons (boat category, location,
checklist item, launch-checklist item, activity type, volunteer event, cert
definition, passport item). The trip card "Add photos" button keeps its text
but drops the 📷 emoji and gets a proper Lucide icon prefix; `tc.addPhotos`
in both strings files no longer contains the emoji.

Added `.icon-btn` helper to `shared/style.css` for flex-centered icon buttons.
## Unreleased — clock-in no longer throws "unknown tabKey time_clock"

`payroll.gs` was calling `insertRow_(TABS_.timeClock, …)` / `updateRow_(TABS_.timeClock, …)`.
`TABS_.timeClock` evaluates to the sheet name `'time_clock'`, but `validateRow_`
strictly requires the tab *key* (`'timeClock'`) and threw `validateRow_:
unknown tabKey time_clock`. Other `TABS_.*` sites worked by coincidence because
their key and value matched — `timeClock` is the only key that differs from its
value. Switched the five `insertRow_`/`updateRow_` sites (clockIn/clockOut/
breakStart/breakEnd/adminEditTime) to the string key `'timeClock'`. Read-only
and direct-sheet sites (`readAll_`, `ss.getSheetByName`) still use
`TABS_.timeClock` since they need (or tolerate) the sheet name.

## Unreleased — bulk-scheduled activities flow into the daily log

Activities defined per-subtype as `bulkSchedule` entries in `activity_types`
config now surface automatically on the daily log for any matching date,
without writing to the `dailyLog` sheet until the day is actually saved by
staff or frozen by the midnight trigger.

- Added `projectActivitiesForDate_(dateISO)` in `config.gs`: expands each
  active subtype's `bulkSchedule` (fromDate/toDate/daysOfWeek/startTime/
  endTime) into activity items of the same shape `dailyLog.activities`
  stores. Each projected item carries `scheduled: true`.
- `getDailyLog_` in `members.gs` returns `{ log, date, scheduledActivities }`.
  The frontend uses `scheduledActivities` when no sheet row exists yet —
  today pre-populates with the projection (user can edit/delete before
  saving); future days render read-only so users can browse ahead.
- Removed the forward-date guard in `dailylog/dailylog.js` so the `▶` button
  no longer dead-ends at today. `isFuture()` added; future days skip the
  trips + incidents fetch and show the projected activities.
- New `materializeYesterday_` + `setupDailyLogMidnightTrigger()` installer
  in `members.gs`. Time-driven trigger runs at local midnight, inserts a
  `dailyLog` row for the day that just ended (if none exists) with the
  projected activities snapshotted in. This prevents subsequent bulk-schedule
  edits from silently rewriting historical days. Run
  `setupDailyLogMidnightTrigger()` once from the Apps Script editor.
- "Scheduled" badge (`daily.scheduled` string) on pre-populated activities
  in both editable + read-only views so users can tell projected items apart
  from manually-added ones.

## Unreleased — incidents filter by event date, not filing time

`getIncidents_({ date })` in `incidents.gs` was bucketing incidents by
`filedAt`/`createdAt` — the *filing* timestamp — so an incident that
happened Monday but was filed Tuesday would appear on the wrong day of the
daily log. Now filters on `i.date` (the user-entered event date) with a
fallback to `filedAt`/`createdAt` for legacy rows that predate the split.

## Unreleased — trip cards condensed to 2-column + boat-category tint

`shared/tripcard.js` collapsed card is now a 2-col label/value grid:
boat/crew · out/in · location/duration. Status badges (skipper/crew,
verified, student, non-club, pending) moved to a compact row below the
grid. All data is preserved; the expanded card is unchanged.

Boat-category color now tints the whole card, not just the left border.
`--tc-cat` / `--tc-cat-bg` CSS custom properties are set inline from
`boatCatColors()` and drive the card background, the date column, and the
expanded boat/logistics sections via `color-mix()` at 5–10% alpha.

Second pass added `qr-code` and `wind` to the registry. The camera emoji in
`qr.scanBtn` ("📷 Scan QR" / "📷 Skanna QR") and the camera emoji in
`daily.wxLogBtn` ("📸 Log snapshot" / "📸 Taka veðurmynd") are gone from
both strings files; render sites in `member/member.js` (launch picker ×2,
issue-report boat picker, incident-report boat picker) now prepend
`icon('qr-code')` programmatically. The two static HTML buttons
(`incidents/index.html` boat scan, `dailylog/index.html` weather snapshot)
switch to a two-span pattern — `<span data-icon="name">` + `<span data-s="key">`
— so the icon and the translated text don't trample each other during
`applyStrings()`. The 🔳 emoji on the admin boat-list QR-reveal button is
replaced with a proper `qr-code` icon.

## Unreleased — no-orphan utility for CSS grids

Shared utility classes `.no-orphans-<N>` / `.no-orphans-sm-2` in
`shared/style.css` prevent a lone stat card from sitting on a trailing row.
Rules are breakpoint-scoped (desktop variants inside `@media (min-width:601px)`,
`sm-2` inside `@media (max-width:600px)`), so a class applied for desktop
columns stays out of the way when the grid collapses on mobile.

Applied to `logbook` (4→2), `maintenance` (5→2), `staff` (3→2), `captain`
(3→2), and `coxswain` (3→2). Bumped `maintenance`'s odd 580px breakpoint
to 600px to match the rest of the app.

In `logbook`, the stats-visibility hide path now removes the card from the
DOM (was `style.display='none'` on the wrapper). The `:nth-child` selectors
need accurate sibling counts to pick the orphan, so `renderStats()` caches
the strip's initial HTML once and restores it at the top of each render.

## Unreleased — logbook confirmations load without the 1.5s lag

The logbook page had a hard-coded 1500ms delay before the crew-confirmations
badge would populate (and before confirmation badges would appear on trip
cards). The `setTimeout(..., 1500)` in `shared/logbook.js` was a safety buffer
meant to wait for `shared/logbook-confirm.js` to define `loadConfirmations` —
but `defer` scripts execute in document order before `DOMContentLoaded`, so
the buffer was always unnecessary. Worse, the `typeof loadConfirmations`
guard would silently fail if the function weren't defined in time, masking
any future load-order regression.

- Removed the 1500ms timer. `loadConfirmations` is now auto-invoked from
  `shared/logbook-confirm.js` itself on `DOMContentLoaded`, gated on the
  presence of `#confBadge` so captain/ (which loads the file for its
  helpers but has its own confirmation machinery) doesn't fire a stray
  request.
- Added `Confirmations` to the initial `prefetch()` in `logbook/logbook.js`
  so the GET races with `getTrips`/`getConfig`/`getMembers` instead of
  firing serially after init.
- Added `getConfirmations` to the `_CACHEABLE` map in `shared/api.js`
  (30s TTL, same as `getNotifications`) and wired cache invalidation for
  every POST that mutates confirmation state: `respondConfirmation`,
  `createConfirmation`, `requestVerification`, `requestValidation`,
  `dismissConfirmation`, `dismissAllConfirmations`.

Touches `shared/logbook.js`, `shared/logbook-confirm.js`, `shared/api.js`,
`logbook/logbook.js`.

## Unreleased — admin boats tab polish

Three small fixes to the admin → Boats sub-tab:

- Chevron now reliably expands/collapses a category. The `▼` span used to sit
  inside the header's `data-admin-nobubble` wrapper, so the delegated
  `toggleSection` handler ignored clicks on it and the chevron had no handler
  of its own — dead zone. Moved the chevron out of the nobubble region.
- Boat cards now shade with their category color (background + border pulled
  from `BOAT_CAT_COLORS` in `shared/boats.js`). The per-card category badge is
  redundant once cards are grouped under a category section, so it's gone.
- Tightened the card grid (180px min, 8px gap) and padding (8px 10px) for a
  more compact look; `.boat-card-meta` replaces inline `style="font-size:…"`
  on the reg-no / model / OOS-reason lines.

Touches `admin/boats.js`, `admin/admin.css`.

## Unreleased — color token cleanup (`--brass` → `--accent`)

The `--brass` family of CSS variables was semantically confused: the token was
named "brass" but held a theme-aware accent color (gold in dark mode, blue in
light mode), and a parallel `--brass-fg` token silently diverged in light
mode (green instead of blue) so active tabs rendered with a blue underline and
a green label. Renamed for clarity and merged the duplicate:

- `--brass` → `--accent` (theme-aware primary accent; gold `#d9b441` dark,
  canonical brand blue `#163274` light). Used for borders, button
  backgrounds, underlines — the *structural* accent.
- `--brass-fg` → `--accent-fg` (theme-aware text/icon accent; gold `#d9b441`
  dark, green `#1e8e4e` light). Used for `color:` on active-tab labels,
  stat numbers, section labels, role labels, icon masks, etc. Keeping this
  split preserves the club's green-on-white text in light mode while
  keeping the brand blue as the chrome accent.
- `--brass-tint-xs/sm/md` → `--accent-tint-xs/sm/md`.
- `--brass-glow-sm/md` → `--accent-glow-sm/md`.
- `--brass-d` (zero uses) and `--brass-l` (one use) deleted; the single
  `--brass-l` hover in `volunteer.css` now uses `--accent`.
- `.text-brass`, `.badge-brass`, `.c-brass`, `.chip-brass` utility classes
  renamed to `.text-accent`, `.badge-accent`, `.c-accent`, `.chip-accent`.

The `var(--accent)NN` alpha-append pattern still works — both theme values
stay 6-hex. `--logo-color`, `--purple`, `--navy`, `--moss`, `--green`, and
the `--header-*` tokens were left alone; each has a distinct semantic role.
## Unreleased — stop kicking users to login on wrong password / bad Google token

`setPassword_` (`members.gs`) returned HTTP 401 when the user typed their
current password wrong during a password change, and `linkGoogleAccount_`
returned 401 when the submitted Google ID token failed verification. The
frontend's global `_call` handler in `shared/api.js` treats any 401 from a
non-public action as "session expired" and wipes local state before
redirecting to `/login/`, so these input-credential failures were bouncing
users out of a still-valid session before `settings.js` could surface its
nice "Current password is incorrect" message. Both backend returns now use
403 (session is valid, request credential rejected); reserve 401 for actual
session-auth failures.

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
