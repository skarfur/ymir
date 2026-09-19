import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's saveRecurringSlots_ — any authenticated session.
// Calendar sync skipped, see save-slot's header.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

async function hasSlotConflict(
  admin: ReturnType<typeof createAdminClient>, boatId: string, date: string, startTime: string, endTime: string,
): Promise<boolean> {
  if (endTime <= startTime) return false;
  const { data } = await admin.from("reservation_slots").select("start_time, end_time").eq("boat_id", boatId).eq("date", date);
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
  const startTime = body?.startTime ? String(body.startTime) : "";
  const endTime = body?.endTime ? String(body.endTime) : "";
  if (!startTime || !endTime) return json({ error: "startTime and endTime required" }, 400);
  if (endTime <= startTime) return json({ error: "endTime must be after startTime" }, 400);
  const fromDate = body?.fromDate ? String(body.fromDate) : "";
  const toDate = body?.toDate ? String(body.toDate) : "";
  if (!fromDate || !toDate) return json({ error: "fromDate and toDate required" }, 400);
  const daysOfWeek = body?.daysOfWeek;
  if (!Array.isArray(daysOfWeek) || !daysOfWeek.length) return json({ error: "daysOfWeek required (array of 0-6)" }, 400);
  const days = daysOfWeek.map(Number);

  const recGroupId = crypto.randomUUID();
  const created: string[] = [];
  let skipped = 0;
  const d = new Date(fromDate + "T00:00:00Z");
  const end = new Date(toDate + "T00:00:00Z");
  while (d <= end) {
    if (days.includes(d.getUTCDay())) {
      const dateStr = d.toISOString().slice(0, 10);
      if (await hasSlotConflict(admin, boatId, dateStr, startTime, endTime)) {
        skipped++;
      } else {
        const { data: inserted, error } = await admin.from("reservation_slots").insert({
          boat_id: boatId, date: dateStr, start_time: startTime, end_time: endTime,
          recurrence_group_id: recGroupId, note: String(body?.note || ""),
        }).select("id").single();
        if (!error && inserted) created.push(inserted.id);
      }
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }

  return json({ saved: true, recurrenceGroupId: recGroupId, count: created.length, skipped, slotIds: created });
});
