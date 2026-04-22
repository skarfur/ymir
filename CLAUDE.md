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
- `alerts.gs` — weather, overdue alerts, share tokens
- `public.gs` — server-rendered public endpoints, volunteer events
- `_setup.gs` — idempotent schema migrations
- `passport.gs` — rowing passport

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

## Caching

`api.js` uses sessionStorage caching (60–300s per action). POST operations must invalidate the relevant cache keys.

## Styling

Use existing CSS variables (`--brass`, `--surface`, `--border`, `--text`, `--muted`, `--faint`, `--card`) rather than hardcoding colors. Shared styles live in `/shared/style.css`.
