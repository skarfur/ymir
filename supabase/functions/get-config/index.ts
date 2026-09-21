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
// boats also carries OOS/access-control fields as real columns now (see
// the boats_access_control_and_reservations migration) and reservations
// join in from their own table rather than a jsonb array on the boat row.
// Both tables are still empty right now; expect [] until real data is
// imported.
//
// volunteerEvents reads activities rows with signup_required=true and
// translates them via toVolDto, the same shape save-volunteer-event
// returns (see that function's header) — kept in sync manually since
// there's no shared module between Edge Functions here.
//
// cancelledActivityOccurrences: plain-activity (signup_required=false)
// tombstone rows written by the cancel-class-occurrence RPC (see
// supabase/migrations/20260921160000_class_occurrence_overrides.sql).
// Returned as the same 'sched-{classId}-{date}' virtual-id shape the
// client's buildUpcomingEvents (shared/scheduled-event.js) already expects
// from the Apps Script version, so no client-side change was needed to
// pick this up once it stopped being a stub.
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

function toVolDto(ev: any, classMap: Record<string, any>) {
  let subtitle = "", subtitleIS = "";
  if (ev.activity_type_id && classMap[ev.activity_type_id]) {
    const cls = classMap[ev.activity_type_id];
    subtitle = String(cls.classTag || cls.classTagIS || "");
    subtitleIS = String(cls.classTagIS || cls.classTag || "");
  }
  if (!subtitle) subtitle = ev.subtype_name || "";
  if (!subtitleIS) subtitleIS = subtitle || "";
  return {
    id: ev.id,
    activityTypeId: ev.activity_type_id || "",
    sourceActivityTypeId: ev.source_activity_type_id || "",
    sourceSubtypeId: ev.source_subtype_id || "",
    title: ev.title || "",
    titleIS: ev.title_is || "",
    subtitle, subtitleIS,
    date: ev.date || "",
    endDate: ev.end_date || "",
    startTime: ev.start_time || "",
    endTime: ev.end_time || "",
    leaderMemberId: ev.leader_member_id || "",
    leaderName: ev.leader_name || "",
    leaderPhone: ev.leader_phone || "",
    showLeaderPhone: !!ev.show_leader_phone,
    notes: ev.notes || "",
    notesIS: ev.notes_is || "",
    roles: ev.roles || [],
    reservedBoatIds: ev.reserved_boat_ids || [],
    gcalEventId: ev.gcal_event_id || "",
    calendarId: ev.calendar_id || "",
    calendarSyncActive: !!ev.calendar_sync_active,
    active: ev.status !== "cancelled",
    orphaned: ev.status === "orphaned",
    materialized: !!ev.source_activity_type_id,
    createdAt: ev.created_at,
    updatedAt: ev.updated_at,
  };
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

  const { data: boatRows, error: boatsError } = await admin.from("boats").select("*");
  if (boatsError) return json({ error: "Boats lookup failed" }, 500);
  const { data: allReservations, error: resError } = await admin.from("boat_reservations").select("*");
  if (resError) return json({ error: "Boat reservations lookup failed" }, 500);
  const reservationsByBoat: Record<string, any[]> = {};
  (allReservations || []).forEach((r) => {
    (reservationsByBoat[r.boat_id] ||= []).push(r);
  });
  const boats = (boatRows || []).map((b) => ({
    id: b.id,
    name: b.name,
    category: b.category,
    active: b.active,
    oos: !!b.oos,
    oosReason: b.oos_reason || "",
    defaultPortId: b.default_port_id || "",
    registrationNo: b.registration_no || "",
    typeModel: b.type_model || "",
    loa: b.loa != null ? Number(b.loa) : "",
    ownership: b.ownership || "club",
    ownerId: b.owner_kennitala || "",
    ownerName: b.owner_name || "",
    accessMode: b.access_mode || "free",
    accessGate: b.access_gate || null,
    accessGateCert: b.access_gate_cert || "",
    accessAllowlist: Array.isArray(b.access_allowlist) ? b.access_allowlist : [],
    slotSchedulingEnabled: !!b.slot_scheduling_enabled,
    availableOutsideSlots: b.available_outside_slots !== false,
    reservations: (reservationsByBoat[b.id] || []).map((r) => ({
      id: r.id,
      memberKennitala: r.member_kennitala,
      memberName: r.member_name,
      startDate: r.start_date,
      endDate: r.end_date,
      note: r.note || "",
    })),
  }));

  const { data: locations, error: locationsError } = await admin
    .from("locations")
    .select("id, name");
  if (locationsError) return json({ error: "Locations lookup failed" }, 500);

  const { data: volunteerEventRows, error: volEventsError } = await admin
    .from("activities").select("*").eq("signup_required", true);
  if (volEventsError) return json({ error: "Volunteer events lookup failed" }, 500);
  const classMap: Record<string, any> = {};
  (Array.isArray(cfg.activity_templates) ? cfg.activity_templates : []).forEach((t: any) => { if (t && t.id) classMap[t.id] = t; });
  const volunteerEvents = (volunteerEventRows || []).map((ev) => toVolDto(ev, classMap));

  const { data: cancelledRows, error: cancelledError } = await admin
    .from("activities")
    .select("source_activity_type_id, date")
    .eq("status", "cancelled")
    .eq("signup_required", false)
    .not("source_activity_type_id", "is", null);
  if (cancelledError) return json({ error: "Cancelled occurrences lookup failed" }, 500);
  const cancelledActivityOccurrences = (cancelledRows || [])
    .map((r) => (r.source_activity_type_id && r.date) ? `sched-${r.source_activity_type_id}-${r.date}` : null)
    .filter((id): id is string => !!id);

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
    volunteerEvents,
    clubCalendars: cfg.clubCalendars || [],
    cancelledActivityOccurrences,
  };

  return json(config);
});
