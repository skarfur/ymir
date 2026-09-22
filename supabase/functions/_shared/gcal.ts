// Google Calendar API access for Supabase Edge Functions, via a service
// account's OAuth2 "server to server" (JWT bearer) flow — see
// https://developers.google.com/identity/protocols/oauth2/service-account.
//
// This is the Deno/Edge-Function replacement for what checkouts.gs did
// with Apps Script's built-in CalendarApp/Calendar.Events (which relied on
// the Apps Script project's own implicit Google OAuth, not portable here).
// A calendar-touching write needs its target calendar shared with the
// service account's client_email (Settings and sharing → "Make changes to
// events") before any of this can succeed — sharing is per-calendar, done
// once in Google Calendar's UI, not something this code can do for you.
//
// Auth requires the GOOGLE_SERVICE_ACCOUNT_JSON secret: the full JSON key
// file downloaded when the service account's key is created in Google
// Cloud Console (Calendar API must be enabled on that project). Every
// calendar-touching Edge Function reads this same secret.

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

let cachedKey: ServiceAccountKey | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

function getServiceAccountKey(): ServiceAccountKey {
  if (cachedKey) return cachedKey;
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not configured");
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing client_email/private_key");
  }
  cachedKey = { client_email: parsed.client_email, private_key: parsed.private_key };
  return cachedKey;
}

function base64url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// Mints (and caches, for the life of this warm isolate) an OAuth2 access
// token scoped to the Calendar API. Tokens are valid for 1h; refreshed
// 60s early to avoid racing expiry mid-request.
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const { client_email, private_key } = getServiceAccountKey();
  const key = await importPrivateKey(private_key);
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const signingInput = base64url(new TextEncoder().encode(JSON.stringify(header))) + "." +
    base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const assertion = signingInput + "." + base64url(new Uint8Array(signature));

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error("Google token request failed: " + (data.error_description || data.error || resp.status));
  }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function gcalFetch(path: string, opts: { method: string; body?: unknown }): Promise<any> {
  const token = await getAccessToken();
  const resp = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    method: opts.method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (opts.method === "DELETE") {
    // Calendar API returns 204/200 on success, 410 if already gone — both
    // are "the event doesn't exist anymore", which is the desired end state.
    if (!resp.ok && resp.status !== 410 && resp.status !== 404) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Calendar delete failed: HTTP ${resp.status} ${text}`);
    }
    return null;
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(`Calendar API error: HTTP ${resp.status} ${data?.error?.message || ""}`);
  }
  return data;
}

// ── Class recurring-event lifecycle ─────────────────────────────────────────
// Ports checkouts.gs's syncClassRecurringEvent_ — one Google Calendar
// recurring event per active, calendar-synced activity template. `tmpl` is
// the camelCase activity-template DTO shape (as returned by
// save_activity_type / toActivityTemplateDto): id, name, nameIS, active,
// classTag, calendarId, calendarSyncActive, bulkSchedule
// {daysOfWeek, startTime, endTime, fromDate, toDate}, gcalSeriesEventId.
//
// Returns the resulting gcalSeriesEventId ('' if no series should exist).
// Never throws for "expected" conditions (missing calendar, sync off) —
// only for actual Calendar API failures, which the caller should treat as
// best-effort (log and keep the previous id) same as the GAS version did.
const TZ = "Atlantic/Reykjavik";
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function buildClassRRule(dowList: number[], toDateISO: string): string {
  const days = dowList.map((n) => BYDAY[n]).join(",");
  let rule = `RRULE:FREQ=WEEKLY;BYDAY=${days}`;
  if (toDateISO) rule += `;UNTIL=${toDateISO.replace(/-/g, "")}T235959Z`;
  return rule;
}

// First date on/after fromDateISO whose weekday is in dowList (JS getDay()
// values, 0=Sun..6=Sat). Returns '' if none found in the next 7 days.
function firstClassOccurrenceDate(fromDateISO: string, dowList: number[]): string {
  if (!fromDateISO || !dowList.length) return "";
  const d = new Date(fromDateISO + "T12:00:00");
  for (let i = 0; i < 7; i++) {
    if (dowList.indexOf(d.getDay()) !== -1) {
      const y = d.getFullYear(), mo = d.getMonth() + 1, da = d.getDate();
      return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
    d.setDate(d.getDate() + 1);
  }
  return "";
}

export async function syncClassRecurringEvent(tmpl: any): Promise<string> {
  if (!tmpl) return "";
  const calId = tmpl.calendarId || "";
  const syncOn = tmpl.calendarSyncActive === true || tmpl.calendarSyncActive === "true";
  const bs = tmpl.bulkSchedule || null;
  const days: number[] = (bs && Array.isArray(bs.daysOfWeek))
    ? bs.daysOfWeek.map(Number).filter((n: number) => n >= 0 && n <= 6)
    : [];
  const startT = (bs && bs.startTime) || tmpl.defaultStart || "";
  const endT = (bs && bs.endTime) || tmpl.defaultEnd || "";
  const fromDate = (bs && bs.fromDate) || "";
  const toDate = (bs && bs.toDate) || "";
  const active = tmpl.active !== false && tmpl.active !== "false";
  const canSync = active && calId && syncOn && bs && days.length && startT && endT && fromDate;

  if (!canSync) {
    if (tmpl.gcalSeriesEventId && calId) {
      try {
        await gcalFetch(`calendars/${encodeURIComponent(calId)}/events/${tmpl.gcalSeriesEventId}`, { method: "DELETE" });
      } catch (e) {
        console.error("syncClassRecurringEvent teardown failed:", e);
      }
    }
    return "";
  }

  const firstDate = firstClassOccurrenceDate(fromDate, days);
  if (!firstDate) return tmpl.gcalSeriesEventId || "";

  const resource = {
    summary: tmpl.nameIS || tmpl.name || "Activity",
    description: tmpl.classTag ? `[${tmpl.classTag}]` : "",
    start: { dateTime: `${firstDate}T${startT}:00`, timeZone: TZ },
    end: { dateTime: `${firstDate}T${endT}:00`, timeZone: TZ },
    recurrence: [buildClassRRule(days, toDate)],
  };

  try {
    if (tmpl.gcalSeriesEventId) {
      const updated = await gcalFetch(
        `calendars/${encodeURIComponent(calId)}/events/${tmpl.gcalSeriesEventId}`,
        { method: "PUT", body: resource },
      );
      return updated.id;
    }
    const created = await gcalFetch(`calendars/${encodeURIComponent(calId)}/events`, { method: "POST", body: resource });
    return created.id;
  } catch (e) {
    console.error("syncClassRecurringEvent upsert failed:", e);
    return tmpl.gcalSeriesEventId || "";
  }
}

// Direct teardown for the delete-activity-type path, where the row (and
// therefore tmpl.calendarId/gcalSeriesEventId) is already gone from the DB
// by the time cleanup runs — the caller passes the values it captured from
// local state before deleting.
export async function deleteClassRecurringEvent(calendarId: string, gcalSeriesEventId: string): Promise<void> {
  if (!calendarId || !gcalSeriesEventId) return;
  try {
    await gcalFetch(`calendars/${encodeURIComponent(calendarId)}/events/${gcalSeriesEventId}`, { method: "DELETE" });
  } catch (e) {
    console.error("deleteClassRecurringEvent failed:", e);
  }
}
