import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports members.gs's getDailyLog_ — translated into the flat camelCase DTO
// dailylog.js reads directly (openingChecks, closingChecks, weatherLog,
// narrative, tideData, signedOffBy, signedOffAt, updatedBy, activities as
// a JSON string of camelCase activity objects) instead of the raw
// snake_case row this previously spread — the same bug pattern fixed
// everywhere else this session.
//
// Deliberately stubbed: scheduledActivities (projected/virtual activities
// from activity-type bulk schedules) — depends on activity_templates data
// that doesn't exist yet, same deferral as get-slots' virtual projection.
//
// Requires a valid session — getDailyLog isn't in Apps Script's
// PUBLIC_ACTIONS_ either.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function activityDto(r: any) {
  return {
    id: r.id,
    activityTypeId: r.activity_type_id || "",
    subtypeId: r.subtype_id || "",
    subtypeName: r.subtype_name || "",
    title: r.title || "",
    name: r.title || "",
    type: r.title || "",
    notes: r.notes || "",
    runNotes: r.run_notes || "",
    participants: r.participants,
    leaderMemberId: r.leader_member_id || "",
    leaderName: r.leader_name || "",
    leaderPhone: r.leader_phone || "",
    showLeaderPhone: !!r.show_leader_phone,
    gcalEventId: r.gcal_event_id || "",
    ablerRegistered: !!r.abler_registered,
    linkedGroupCheckoutIds: r.linked_group_checkout_ids || [],
    start: r.start_time || "",
    startTime: r.start_time || "",
    end: r.end_time || "",
    endTime: r.end_time || "",
    editedBy: r.edited_by || "",
    editedAt: r.edited_at || "",
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

  const date = body?.date ? String(body.date).trim() : new Date().toISOString().slice(0, 10);

  // Both filtered by the same date, neither depends on the other's result.
  const [{ data: log }, { data: activityRows }] = await Promise.all([
    admin.from("daily_log").select("*").eq("date", date).maybeSingle(),
    admin.from("activities").select("*").eq("daily_log_date", date).eq("signup_required", false),
  ]);

  const logDto = log ? {
    id: log.id,
    date: log.date,
    openingChecks: log.opening_checks || {},
    closingChecks: log.closing_checks || {},
    weatherLog: log.weather_log || [],
    narrative: log.narrative || "",
    tideData: log.tide_data || {},
    signedOffBy: log.signed_off_by || "",
    signedOffAt: log.signed_off_at || "",
    updatedBy: log.updated_by || "",
    createdAt: log.created_at,
    updatedAt: log.updated_at,
    activities: JSON.stringify((activityRows || []).map(activityDto)),
  } : null;

  return json({ log: logDto, date, scheduledActivities: [] });
});
