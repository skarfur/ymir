import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's saveSlot_. Any authenticated session.
//
// Google Calendar sync (syncSlotToCalendar_) is not ported anywhere in
// this migration — it's an Apps-Script-only integration (CalendarApp +
// per-category charter-calendar script properties) out of scope here, so
// every slot-writing function below skips it rather than half-porting it.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hasSlotConflict(
  admin: ReturnType<typeof createAdminClient>, boatId: string, date: string, startTime: string, endTime: string, excludeId: string | null,
): Promise<boolean> {
  if (endTime <= startTime) return false;
  let q = admin.from("reservation_slots").select("id, start_time, end_time").eq("boat_id", boatId).eq("date", date);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  return (data || []).some((sl: any) => startTime < sl.end_time && endTime > sl.start_time);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const boatId = body?.boatId ? String(body.boatId) : "";
  if (!boatId) return json({ error: "boatId required" }, 400);
  const date = body?.date ? String(body.date).slice(0, 10) : "";
  const startTime = body?.startTime ? String(body.startTime) : "";
  const endTime = body?.endTime ? String(body.endTime) : "";
  if (!date || !startTime || !endTime) return json({ error: "date, startTime, endTime required" }, 400);
  if (endTime <= startTime) return json({ error: "endTime must be after startTime" }, 400);

  const slotId = body?.slotId ? String(body.slotId) : "";
  const existing = slotId && UUID_RE.test(slotId)
    ? (await admin.from("reservation_slots").select("id").eq("id", slotId).maybeSingle()).data
    : null;

  if (await hasSlotConflict(admin, boatId, date, startTime, endTime, existing ? existing.id : null)) {
    return json({ error: "Slot conflicts with an existing slot on this boat" }, 400);
  }

  if (existing) {
    const { error } = await admin.from("reservation_slots").update({
      date, start_time: startTime, end_time: endTime, note: String(body?.note || ""),
    }).eq("id", existing.id);
    if (error) return json({ error: "Slot save failed: " + error.message }, 500);
    return json({ saved: true, slotId: existing.id });
  }

  const recGroupId = body?.recurrenceGroupId ? String(body.recurrenceGroupId) : "";
  const { data: inserted, error } = await admin.from("reservation_slots").insert({
    boat_id: boatId, date, start_time: startTime, end_time: endTime,
    recurrence_group_id: recGroupId && UUID_RE.test(recGroupId) ? recGroupId : null,
    note: String(body?.note || ""),
  }).select("id").single();
  if (error) return json({ error: "Slot save failed: " + error.message }, 500);

  return json({ saved: true, slotId: inserted.id });
});
