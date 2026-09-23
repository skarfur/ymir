import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Ports config.gs's getConfig_ — the bundle every portal fetches on load,
// and (via buildConfigSnapshot) the same snapshot login/index.ts piggybacks
// onto a successful login so the destination portal's first apiGet('getConfig')
// is an instant cache hit, same as the Apps Script version's
// _loginConfigPiggyback_ did.
//
// Extracted into _shared/ (rather than duplicated between get-config and
// login, "kept in sync manually" the way volunteerEvents' toVolDto used to
// be documented) specifically so there's exactly one place this logic
// lives — a change here reaches both callers on their next deploy instead
// of needing to be hand-copied twice.
//
// The queries below are independent of each other (none reads a value
// the other produced — the activity_templates -> classMap join is done in
// JS after both are in hand, not as a DB-level dependency), so they run via
// Promise.all instead of sequential awaits: this was previously several
// round-trips end-to-end, now it's bounded by the slowest single one.
//
// boats/locations/activity_templates/cert_defs read from their own real
// tables (a deliberate normalization from the Sheets version's
// config-JSON-blobs, not a shortcut) — see the
// boats_access_control_and_reservations migration, and
// 20260922100000_activity_templates_table.sql's header for why
// activity_templates followed the same path (a real bug, not just
// tidiness: its legacy string ids didn't satisfy the uuid columns
// activities.source_activity_type_id etc. expect). cert_defs
// (20260922110000) is the same promotion for consistency, not a bug fix
// — its ids are only ever compared as free text, never a typed uuid
// column, so they kept their original values with no remap needed.

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

function toCertDefDto(d: any) {
  const subcats = Array.isArray(d.subcats)
    ? d.subcats.map((sc: any) => {
        const labelEN = sc.labelEN || sc.label || "";
        const labelIS = sc.labelIS || "";
        const scDescEN = sc.descriptionEN || sc.description || "";
        const scDescIS = sc.descriptionIS || "";
        return { ...sc, labelEN, labelIS, label: labelEN, descriptionEN: scDescEN, descriptionIS: scDescIS, description: scDescEN };
      })
    : [];
  return {
    id: d.id,
    nameEN: d.name_en || "", nameIS: d.name_is || "", name: d.name_en || "",
    descriptionEN: d.description_en || "", descriptionIS: d.description_is || "", description: d.description_en || "",
    category: d.category || "",
    issuingAuthority: d.issuing_authority || "",
    color: d.color || "",
    expires: !!d.expires,
    hasIdNumber: !!d.has_id_number,
    clubEndorsement: !!d.club_endorsement,
    subcats,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
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

function toActivityTemplateDto(t: any) {
  return {
    id: t.id,
    name: t.name || "",
    nameIS: t.name_is || "",
    active: t.active,
    classTag: t.class_tag || "",
    classTagIS: t.class_tag_is || "",
    calendarId: t.calendar_id || "",
    calendarSyncActive: !!t.calendar_sync_active,
    scheduleSource: t.schedule_source || "bulk",
    volunteer: !!t.volunteer,
    roles: t.roles || [],
    leaderMemberId: t.leader_member_id || "",
    leaderName: t.leader_name || "",
    leaderPhone: t.leader_phone || "",
    showLeaderPhone: !!t.show_leader_phone,
    defaultStart: t.default_start || "",
    defaultEnd: t.default_end || "",
    bulkSchedule: t.bulk_schedule || null,
    reservedBoatIds: t.reserved_boat_ids || [],
    gcalSeriesEventId: t.gcal_series_event_id || "",
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
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
  "dailyChecklist", "overdueAlerts", "flagConfig", "flagOverride",
  "certCategories", "launchChecklists", "boatCategories", "staffStatus",
  "allowBreaks", "rowingCalendarId", "rowingCalendarSyncActive", "keelboatCalendarId",
  "keelboatCalendarSyncActive", "rowingPassport", "clubCalendars", "sharedPhotoEmailTo",
];

export async function buildConfigSnapshot(admin: SupabaseClient): Promise<any> {
  const [
    { data: configRows, error: configError },
    { data: boatRows, error: boatsError },
    { data: allReservations, error: resError },
    { data: locations, error: locationsError },
    { data: templateRows, error: templatesError },
    { data: certDefRows, error: certDefsError },
    { data: volunteerEventRows, error: volEventsError },
    { data: cancelledRows, error: cancelledError },
  ] = await Promise.all([
    admin.from("app_config").select("key, value").in("key", CONFIG_KEYS),
    admin.from("boats").select("*"),
    admin.from("boat_reservations").select("*"),
    admin.from("locations").select("id, name, type, coordinates, active"),
    admin.from("activity_templates").select("*"),
    admin.from("cert_defs").select("*"),
    admin.from("activities").select("*").eq("signup_required", true),
    admin.from("activities").select("source_activity_type_id, date")
      .eq("status", "cancelled").eq("signup_required", false).not("source_activity_type_id", "is", null),
  ]);
  if (configError) throw new Error("Config lookup failed");
  if (boatsError) throw new Error("Boats lookup failed");
  if (resError) throw new Error("Boat reservations lookup failed");
  if (locationsError) throw new Error("Locations lookup failed");
  if (templatesError) throw new Error("Activity templates lookup failed");
  if (certDefsError) throw new Error("Cert defs lookup failed");
  if (volEventsError) throw new Error("Volunteer events lookup failed");
  if (cancelledError) throw new Error("Cancelled occurrences lookup failed");

  const cfg: Record<string, any> = {};
  (configRows || []).forEach((r) => { cfg[r.key] = r.value; });

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

  const activityTemplates = (templateRows || []).map(toActivityTemplateDto);
  const classMap: Record<string, any> = {};
  activityTemplates.forEach((t) => { if (t && t.id) classMap[t.id] = t; });
  const volunteerEvents = (volunteerEventRows || []).map((ev) => toVolDto(ev, classMap));

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

  return {
    activityTemplates,
    dailyChecklist,
    overdueAlerts: mergeAlertConfig(cfg.overdueAlerts),
    flagConfig: cfg.flagConfig || null,
    flagOverride,
    certDefs: (certDefRows || []).map(toCertDefDto),
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
    sharedPhotoEmailTo: cfg.sharedPhotoEmailTo || "",
  };
}
