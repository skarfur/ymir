import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports members.gs's saveDailyLog_ — staff/admin only (matches
// STAFF_ACTIONS_.saveDailyLog in code.gs). Persists activities into the
// activities table (signup_required=false rows keyed by id, matching
// get-daily-log's read contract) the same way persistDailyLogActivities_
// does, then upserts the daily_log row itself. GCal sync
// (syncDailyLogActivities_) is skipped — Calendar integration isn't
// ported anywhere in this migration, see save-slot's header for the same
// deferral.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function inferSource(id: string): string {
  if (id.startsWith("gcal-")) return "calendar";
  if (id.startsWith("sched-")) return "bulk";
  return "daily-log";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (session.role !== "staff" && session.role !== "admin") return json({ error: "Staff only" }, 403);

  const ts = new Date().toISOString();
  const date = body?.date ? String(body.date).slice(0, 10) : ts.slice(0, 10);

  if (body?.activities !== undefined) {
    const { data: oldRows } = await admin.from("activities").select("id")
      .eq("daily_log_date", date).eq("signup_required", false);
    const newActs = Array.isArray(body.activities) ? body.activities : [];
    const todayIso = new Date().toISOString().slice(0, 10);
    const status = date < todayIso ? "completed" : "upcoming";
    const nextIds = new Set<string>();

    for (const a of newActs) {
      if (!a || !a.id) continue;
      nextIds.add(String(a.id));
      await admin.from("activities").upsert({
        id: String(a.id),
        signup_required: false,
        status,
        source: inferSource(String(a.id)),
        date,
        start_time: a.start || a.startTime || null,
        end_time: a.end || a.endTime || null,
        activity_type_id: a.activityTypeId || null,
        subtype_id: a.subtypeId || null,
        subtype_name: a.subtypeName || "",
        title: a.name || a.type || "",
        title_is: "",
        notes: a.notes || "",
        notes_is: "",
        run_notes: a.runNotes || "",
        participants: a.participants || null,
        leader_member_id: a.leaderMemberId || null,
        leader_name: a.leaderName || "",
        leader_phone: a.leaderPhone || "",
        show_leader_phone: a.showLeaderPhone === true || a.showLeaderPhone === "true",
        gcal_event_id: a.gcalEventId || "",
        daily_log_date: date,
        abler_registered: a.ablerRegistered === true || a.ablerRegistered === "true",
        linked_group_checkout_ids: Array.isArray(a.linkedGroupCheckoutIds) ? a.linkedGroupCheckoutIds : [],
        edited_by: a.editedBy || "",
        edited_at: a.editedAt || null,
        actor_id: session.memberId,
        updated_at: ts,
      });
    }
    for (const old of oldRows || []) {
      if (!nextIds.has(old.id)) await admin.from("activities").delete().eq("id", old.id);
    }
  }

  const { data: ex } = await admin.from("daily_log").select("*").eq("date", date).maybeSingle();
  const updatedBy = String(body?.updatedBy || "");

  if (ex) {
    const signedOffBy = body?.signedOffBy !== undefined ? String(body.signedOffBy) : (ex.signed_off_by || "");
    const signedOffAt = body?.signedOffAt !== undefined ? String(body.signedOffAt) : (ex.signed_off_at || "");
    const updates: Record<string, unknown> = {
      signed_off_by: signedOffBy, signed_off_at: signedOffAt || null,
      updated_by: updatedBy, updated_at: ts, actor_id: session.memberId,
    };
    if (body?.openingChecks !== undefined) updates.opening_checks = body.openingChecks;
    if (body?.closingChecks !== undefined) updates.closing_checks = body.closingChecks;
    if (body?.weatherLog !== undefined) updates.weather_log = body.weatherLog;
    if (body?.narrative !== undefined) updates.narrative = String(body.narrative);
    if (body?.tideData !== undefined) updates.tide_data = body.tideData;

    const { error } = await admin.from("daily_log").update(updates).eq("date", date);
    if (error) return json({ error: "Daily log save failed: " + error.message }, 500);
    return json({ date, updated: true, signedOffBy, signedOffAt, updatedBy, updatedAt: ts });
  }

  const signedOffBy = body?.signedOffBy ? String(body.signedOffBy) : "";
  const signedOffAt = body?.signedOffAt ? String(body.signedOffAt) : "";
  const { error } = await admin.from("daily_log").insert({
    date,
    opening_checks: body?.openingChecks || {},
    closing_checks: body?.closingChecks || {},
    activities: [],
    weather_log: body?.weatherLog || [],
    narrative: String(body?.narrative || ""),
    tide_data: body?.tideData || {},
    signed_off_by: signedOffBy, signed_off_at: signedOffAt || null,
    updated_by: updatedBy,
    actor_id: session.memberId,
  });
  if (error) return json({ error: "Daily log save failed: " + error.message }, 500);

  return json({ date, created: true, signedOffBy, signedOffAt, updatedBy, updatedAt: ts });
});
