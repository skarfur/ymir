import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports config.gs's getConfig_ — the bundle every portal fetches
// immediately after login. Config values are natively jsonb in app_config
// now, not stringified cells, so most of the Sheets version's JSON.parse
// calls just disappear; the shape returned to the client is unchanged.
//
// boats/locations move from config-JSON-blobs to their own real tables
// (boats, locations) in the new schema — a deliberate normalization, not a
// shortcut — so they're read from those tables here instead of app_config.
// Both tables are empty right now; expect [] until real data is imported.
//
// Deliberately stubbed (deferred, not ported): volunteerEvents and
// cancelledActivityOccurrences, normally derived from the activities table
// via activity_parseRow_/_schedToVolDto_ (public.gs). That's real,
// separate-scope logic, and activities has zero rows in this project
// regardless, so there's nothing to derive yet — returning [] rather than
// faking a derivation with no data to exercise it.
//
// Requires a valid session — getConfig isn't in Apps Script's
// PUBLIC_ACTIONS_ either.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const ALERT_DEFAULTS = {
  enabled: true,
  firstAlertMins: 15,
  repeatMins: 30,
  snoozeMins: 30,
  channels: { web: true, email: false, sms: false },
  staffEmailList: [] as string[],
  staffSmsList: [] as string[],
};

function mergeAlertConfig(raw: any): typeof ALERT_DEFAULTS {
  if (!raw || typeof raw !== "object") return ALERT_DEFAULTS;
  return {
    ...ALERT_DEFAULTS,
    ...raw,
    channels: { ...ALERT_DEFAULTS.channels, ...(raw.channels || {}) },
  };
}

function normalizeCertDefs(arr: unknown): any[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((d: any) => {
    if (!d) return d;
    const nameEN = d.nameEN || d.name || "";
    const nameIS = d.nameIS || "";
    const descriptionEN = d.descriptionEN || d.description || "";
    const descriptionIS = d.descriptionIS || "";
    const subcats = Array.isArray(d.subcats)
      ? d.subcats.map((sc: any) => {
          const labelEN = sc.labelEN || sc.label || "";
          const labelIS = sc.labelIS || "";
          const scDescEN = sc.descriptionEN || sc.description || "";
          const scDescIS = sc.descriptionIS || "";
          return { ...sc, labelEN, labelIS, label: labelEN, descriptionEN: scDescEN, descriptionIS: scDescIS, description: scDescEN };
        })
      : [];
    return { ...d, nameEN, nameIS, name: nameEN, descriptionEN, descriptionIS, description: descriptionEN, subcats };
  });
}

function normalizeCertCategories(arr: unknown): any[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((c: any) => {
      if (c == null) return { key: "", labelEN: "", labelIS: "" };
      if (typeof c === "string") {
        const s = c.trim();
        return { key: s, labelEN: s, labelIS: "" };
      }
      const labelEN = String(c.labelEN || c.label || c.key || "").trim();
      const key = String(c.key || labelEN).trim();
      return { key, labelEN, labelIS: String(c.labelIS || "").trim() };
    })
    .filter((c) => c.key);
}

const CONFIG_KEYS = [
  "activity_templates", "dailyChecklist", "overdueAlerts", "flagConfig", "flagOverride",
  "certDefs", "certCategories", "launchChecklists", "boatCategories", "staffStatus",
  "allowBreaks", "rowingCalendarId", "rowingCalendarSyncActive", "keelboatCalendarId",
  "keelboatCalendarSyncActive", "rowingPassport", "clubCalendars",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { data: configRows, error: configError } = await admin
    .from("app_config")
    .select("key, value")
    .in("key", CONFIG_KEYS);
  if (configError) return json({ error: "Config lookup failed" }, 500);

  const cfg: Record<string, any> = {};
  (configRows || []).forEach((r) => { cfg[r.key] = r.value; });

  const { data: boats, error: boatsError } = await admin
    .from("boats")
    .select("id, name, category, active");
  if (boatsError) return json({ error: "Boats lookup failed" }, 500);

  const { data: locations, error: locationsError } = await admin
    .from("locations")
    .select("id, name");
  if (locationsError) return json({ error: "Locations lookup failed" }, 500);

  const dailyChecklistRaw = cfg.dailyChecklist || {};
  const dailyChecklist = {
    opening: (dailyChecklistRaw.opening || []).filter((r: any) => r && r.active),
    closing: (dailyChecklistRaw.closing || []).filter((r: any) => r && r.active),
  };

  // flagOverride auto-clears past its expiresAt, same as the Sheets version —
  // clear it in app_config so the next read is clean, but don't block this
  // response on that write finishing.
  let flagOverride: any = null;
  const fov = cfg.flagOverride;
  if (fov && fov.active) {
    const exp = fov.expiresAt ? new Date(fov.expiresAt).getTime() : 0;
    if (exp && exp <= Date.now()) {
      // app_config.value is NOT NULL — clear to {} (falsy for the .active
      // check above), not null, which would violate the column constraint.
      admin.from("app_config").update({ value: {}, updated_at: new Date().toISOString() })
        .eq("key", "flagOverride").then(() => {});
    } else {
      flagOverride = fov;
    }
  }

  const config = {
    activityTemplates: cfg.activity_templates || [],
    dailyChecklist,
    overdueAlerts: mergeAlertConfig(cfg.overdueAlerts),
    flagConfig: cfg.flagConfig || null,
    flagOverride,
    certDefs: normalizeCertDefs(cfg.certDefs),
    certCategories: normalizeCertCategories(cfg.certCategories),
    boats: boats || [],
    locations: locations || [],
    launchChecklists: cfg.launchChecklists || {},
    boatCategories: cfg.boatCategories || [],
    staffStatus: cfg.staffStatus ?? null,
    allowBreaks: !!cfg.allowBreaks,
    charterCalendars: {
      rowingCalendarId: cfg.rowingCalendarId || "",
      rowingCalendarSyncActive: !!cfg.rowingCalendarSyncActive,
      keelboatCalendarId: cfg.keelboatCalendarId || "",
      keelboatCalendarSyncActive: !!cfg.keelboatCalendarSyncActive,
    },
    rowingPassport: cfg.rowingPassport ?? null,
    volunteerEvents: [] as any[], // stubbed — see file header
    clubCalendars: cfg.clubCalendars || [],
    cancelledActivityOccurrences: [] as any[], // stubbed — see file header
  };

  return json(config);
});
