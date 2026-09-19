import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports maintenance.gs's reassignMaintenance_ — staff/admin only (matches
// STAFF_ACTIONS_.reassignMaintenance in code.gs). verkstjori/materials are
// preserved across the flip so reassigning back doesn't lose work.
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
  if (session.role !== "staff" && session.role !== "admin") return json({ error: "Staff only" }, 403);

  const id = body?.id ? String(body.id) : "";
  if (!id) return json({ error: "id required" }, 400);

  const { data: ex } = await admin.from("maintenance").select("id").eq("id", id).maybeSingle();
  if (!ex) return json({ error: "Request not found" }, 404);

  const toSauma = !!body?.toSauma;
  const updates: Record<string, unknown> = { saumaklubbur: toSauma, updated_at: new Date().toISOString() };
  if (toSauma) {
    updates.approved = true;
    updates.on_hold = false;
    updates.mark_oos = false;
  } else {
    updates.approved = false;
    updates.on_hold = false;
  }

  const { error } = await admin.from("maintenance").update(updates).eq("id", id);
  if (error) return json({ error: "Reassign failed: " + error.message }, 500);

  return json({ reassigned: true, toSauma });
});
