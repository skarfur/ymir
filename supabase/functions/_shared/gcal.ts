// Google Calendar API access for Supabase Edge Functions, via Workload
// Identity Federation (WIF) — no downloaded service-account key involved.
// This function mints its own short-lived OIDC-shaped JWT (signed with a
// dedicated ES256 key held only as the GCAL_WIF_SIGNING_KEY Supabase
// secret — same signing pattern as _shared/session.ts's mintAccessToken,
// a separate key so a leak of one never compromises the other), exchanges
// it at Google's STS endpoint for a federated access token, then uses that
// to impersonate the Calendar service account via the IAM Credentials API
// for a short-lived, Calendar-scoped access token. See
// https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers.
//
// This replaces an earlier downloaded-key JWT-bearer flow (which read a
// GOOGLE_SERVICE_ACCOUNT_JSON secret directly) — Google's current guidance
// is to avoid long-lived, downloadable service-account keys wherever the
// calling platform can instead present a verifiable identity of its own.
// Supabase Edge Functions don't get one ambiently (unlike e.g. GitHub
// Actions or GCP compute), so we mint one ourselves: the Workload Identity
// Pool's OIDC provider trusts our own public key, uploaded directly (no
// public issuer endpoint needed) — see tools/gcal-wif-setup.sh, which
// performs that one-time Google Cloud + Supabase-secrets setup locally.
//
// This is the Deno/Edge-Function replacement for what checkouts.gs did
// with Apps Script's built-in CalendarApp/Calendar.Events (which relied on
// the Apps Script project's own implicit Google OAuth, not portable here).
// A calendar-touching write still needs its target calendar shared with
// the service account's email (Settings and sharing → "Make changes to
// events") before any of this can succeed — sharing is per-calendar, done
// once in Google Calendar's UI, not something this code can do for you.
//
// Required secrets (all pushed by tools/gcal-wif-setup.sh):
//   GCAL_WIF_SIGNING_KEY — our own private JWK (ES256)
//   GCAL_WIF_AUDIENCE    — full WIF provider resource name
//   GCAL_WIF_ISSUER      — the `iss`/`aud` claim our JWTs carry; must match
//                          the provider's configured issuer-uri exactly
//   GCAL_WIF_SUBJECT     — the `sub` claim our JWTs carry; must match the
//                          IAM binding's .../subject/<this value>
//   GCAL_SA_EMAIL        — the Calendar service account's email to impersonate

interface WifSigningKey {
  jwk: JsonWebKey;
  kid: string;
}

let cachedSigningKey: WifSigningKey | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} not configured`);
  return v;
}

function getSigningKey(): WifSigningKey {
  if (cachedSigningKey) return cachedSigningKey;
  const raw = requireEnv("GCAL_WIF_SIGNING_KEY");
  const jwk = JSON.parse(raw);
  if (!jwk.kid) throw new Error("GCAL_WIF_SIGNING_KEY missing kid");
  cachedSigningKey = { jwk, kid: jwk.kid };
  return cachedSigningKey;
}

function base64url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

// Mints the short-lived OIDC-shaped assertion Google's STS endpoint
// verifies against the JWKS we uploaded to the Workload Identity Pool
// provider (tools/gcal-wif-setup.sh) — this is the "external token" in
// Google's federation flow, standing in for what GitHub Actions/GCP
// compute would hand a workload automatically.
async function mintWifAssertion(): Promise<string> {
  const { jwk, kid } = getSigningKey();
  const issuer = requireEnv("GCAL_WIF_ISSUER");
  const subject = requireEnv("GCAL_WIF_SUBJECT");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid, typ: "JWT" };
  const claims = { iss: issuer, sub: subject, aud: issuer, iat: nowSec, exp: nowSec + 300 };
  const signingInput = base64urlJson(header) + "." + base64urlJson(claims);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return signingInput + "." + base64url(new Uint8Array(signature));
}

// Two-step "workload identity federation with service account
// impersonation" flow: exchange our self-signed assertion at Google's STS
// endpoint for a federated access token, then use that to impersonate the
// Calendar service account via the IAM Credentials API for a token
// actually scoped to the Calendar API. Cached for the life of this warm
// isolate, refreshed 60s early to avoid racing expiry mid-request.
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const assertion = await mintWifAssertion();
  const audience = requireEnv("GCAL_WIF_AUDIENCE");
  const saEmail = requireEnv("GCAL_SA_EMAIL");

  const stsResp = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectToken: assertion,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    }),
  });
  const stsData = await stsResp.json().catch(() => null);
  // The STS token endpoint's response follows RFC 8693's snake_case wire
  // format even though its own request body uses camelCase field names —
  // a real (if confusing) asymmetry in Google's implementation.
  const federatedToken = stsData?.access_token;
  if (!stsResp.ok || !federatedToken) {
    throw new Error(
      "WIF token exchange failed: " + (stsData?.error_description || stsData?.error || stsResp.status),
    );
  }

  const impResp = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(saEmail)}:generateAccessToken`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${federatedToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/calendar"], lifetime: "3600s" }),
    },
  );
  const impData = await impResp.json().catch(() => null);
  if (!impResp.ok || !impData?.accessToken) {
    throw new Error("Service account impersonation failed: " + (impData?.error?.message || impResp.status));
  }

  cachedToken = { token: impData.accessToken, expiresAt: new Date(impData.expireTime).getTime() };
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
