# Project Instructions

## Project Overview

Ýmir is a sailing club management system. The backend is a Google Apps Script (`code.gs`) that uses Google Sheets for data storage. The frontend is vanilla HTML/JS/CSS hosted on GitHub Pages. There is no build system or package manager — changes to frontend files are deployed directly.

## Backend Changes (code.gs)

**IMPORTANT:** Whenever you modify `code.gs`, you MUST explicitly warn the user by calling out the change prominently — e.g., "⚠️ I updated code.gs (the backend)." Include a summary of what changed and why. Never let a `code.gs` edit go unannounced.

Frontend changes can be tested locally, but `code.gs` changes require deploying to Google Apps Script.

## Bilingual Support (Icelandic / English)

The app supports Icelandic (`IS`) and English (`EN`). All user-facing strings must include both languages. Backend strings use `GS_STRINGS_`, frontend strings use `strings-is.js` and `strings-en.js` in `/shared/`.

## Naming Conventions

- **Constants:** `UPPER_CASE` with trailing underscore (`SHEET_ID_`, `API_TOKEN_`, `TABS_`)
- **Internal/private functions:** trailing underscore (`ss_()`, `now_()`, `uid_()`, `esc_()`)
- **Public functions:** camelCase (`apiGet()`, `apiPost()`, `saveMember()`)

## Project Structure

- `/shared/` — Reusable JS modules and CSS (`api.js`, `boats.js`, `style.css`, etc.)
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
