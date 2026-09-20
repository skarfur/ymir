import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports payroll.gs's adminAddTime_ — admin only (ADMIN_ACTIONS_ in
// code.gs).
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (session.role !== "admin") return json({ error: "Admin only" }, 403);

  const employeeId = body?.employeeId ? String(body.employeeId) : "";
  const timestamp = body?.timestamp ? String(body.timestamp) : "";
  if (!employeeId || !timestamp) return json({ error: "employeeId and timestamp required" }, 400);

  const type = (body?.type === "break_end" || body?.type === "sick_end") ? String(body.type) : "out";
  const defaultNote = type === "break_end" ? "admin break" : (type === "sick_end" ? "admin sick day" : "admin entry");
  const id = crypto.randomUUID();
  const clockIn = body?.clockIn ? String(body.clockIn) : new Date().toISOString();
  const periodKey = clockIn.slice(0, 7) + "-01";

  const { error } = await admin.from("time_clock").insert({
    id, employee_id: employeeId, type, ts: timestamp, source: "admin",
    original_ts: body?.clockIn || null,
    note: body?.note || defaultNote,
    period_key: periodKey, duration_minutes: body?.durationMinutes || 0,
  });
  if (error) return json({ error: "adminAddTime failed: " + error.message }, 500);

  return json({ success: true, id });
});
