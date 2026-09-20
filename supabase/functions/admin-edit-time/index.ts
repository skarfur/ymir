import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports payroll.gs's adminEditTime_ — admin only (ADMIN_ACTIONS_ in
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

  const id = body?.id ? String(body.id) : "";
  const timestamp = body?.timestamp ? String(body.timestamp) : "";
  if (!id || !timestamp) return json({ error: "id and timestamp required" }, 400);

  const { data: row } = await admin.from("time_clock").select("*").eq("id", id).maybeSingle();
  if (!row) return json({ error: "Entry not found" }, 404);

  const { error } = await admin.from("time_clock").update({
    ts: timestamp,
    original_ts: body?.clockIn || row.original_ts || row.ts,
    note: body?.note || row.note || "admin edit",
    source: "admin",
    duration_minutes: body?.durationMinutes !== undefined ? body.durationMinutes : row.duration_minutes,
  }).eq("id", id);
  if (error) return json({ error: "adminEditTime failed: " + error.message }, 500);

  return json({ updated: true });
});
