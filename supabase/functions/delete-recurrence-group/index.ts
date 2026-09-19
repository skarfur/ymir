import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's deleteRecurrenceGroup_. Any authenticated session.
// Calendar cleanup skipped, see save-slot's header.
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

  const recurrenceGroupId = body?.recurrenceGroupId ? String(body.recurrenceGroupId) : "";
  if (!recurrenceGroupId) return json({ error: "recurrenceGroupId required" }, 400);

  const { data: deleted, error } = await admin.from("reservation_slots")
    .delete().eq("recurrence_group_id", recurrenceGroupId).select("id");
  if (error) return json({ error: "Delete failed: " + error.message }, 500);

  return json({ deleted: true, count: (deleted || []).length });
});
