import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports public.gs's saveVolunteerEvent_ — any authenticated session (not
// in ADMIN_ACTIONS_/STAFF_ACTIONS_ in code.gs; the admin volunteers tab
// is the only caller in practice, but the server never enforced that).
// Volunteer events are activities-table rows with signup_required=true,
// shared infrastructure with daily-log activities (signup_required=
// false) — see save-daily-log's header for the same table split.
//
// Always a full upsert (not a partial patch): the client always sends
// the complete event shape, matching activity_upsert_'s contract.
// Google Calendar sync (syncVolunteerEventToCalendar_) is deliberately
// not ported, same deferral as every other Calendar-touching write.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: unknown) => { const s = v ? String(v) : ""; return s && UUID_RE.test(s) ? s : null; };

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  let roles: unknown[] = [];
  if (Array.isArray(body?.roles)) roles = body.roles as unknown[];
  else if (typeof body?.roles === "string" && body.roles) {
    try { roles = JSON.parse(body.roles as string); } catch { roles = []; }
  }
  let reservedBoatIds: string[] = [];
  try {
    const rb = Array.isArray(body?.reservedBoatIds)
      ? body.reservedBoatIds
      : (typeof body?.reservedBoatIds === "string" && body.reservedBoatIds ? JSON.parse(body.reservedBoatIds as string) : []);
    reservedBoatIds = (rb || []).map(String).filter(Boolean);
  } catch { reservedBoatIds = []; }

  let startIso = body?.date ? String(body.date) : "";
  let endIso = body?.endDate ? String(body.endDate) : "";
  if (endIso && startIso && endIso < startIso) { const swap = endIso; endIso = startIso; startIso = swap; }
  if (endIso && endIso === startIso) endIso = "";

  const id = body?.id ? String(body.id) : crypto.randomUUID();
  const prev = body?.id ? (await admin.from("activities").select("*").eq("id", id).maybeSingle()).data : null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const row = {
    id,
    signup_required: true,
    status: (startIso && startIso < todayIso) ? "completed" : "upcoming",
    source: prev ? (prev.source || "manual") : "manual",
    activity_type_id: asUuid(body?.activityTypeId),
    date: startIso || null,
    end_date: endIso || null,
    start_time: body?.startTime || null,
    end_time: body?.endTime || null,
    title: String(body?.title || ""),
    title_is: String(body?.titleIS || ""),
    notes: String(body?.notes || ""),
    notes_is: String(body?.notesIS || ""),
    leader_member_id: asUuid(body?.leaderMemberId || body?.leaderId),
    leader_name: String(body?.leaderName || ""),
    leader_phone: String(body?.leaderPhone || ""),
    show_leader_phone: body?.showLeaderPhone === true || body?.showLeaderPhone === "true",
    roles,
    reserved_boat_ids: reservedBoatIds,
    gcal_event_id: prev ? prev.gcal_event_id : "",
    calendar_id: String(body?.calendarId || ""),
    calendar_sync_active: body?.calendarSyncActive === true || body?.calendarSyncActive === "true",
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error } = await admin.from("activities").upsert(row).select("*").single();
  if (error) return json({ error: "saveVolunteerEvent failed: " + error.message }, 500);

  const { data: cfgRow } = await admin.from("app_config").select("value").eq("key", "activity_templates").maybeSingle();
  const classMap: Record<string, any> = {};
  (Array.isArray(cfgRow?.value) ? cfgRow!.value : []).forEach((t: any) => { if (t && t.id) classMap[t.id] = t; });

  return json({ id: saved.id, item: toVolDto(saved, classMap) });
});
