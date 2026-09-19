import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports public.gs's syncVolunteerEvents_ — deliberately stubbed. The real
// version walks every activity_templates entry with a bulkSchedule and
// materializes/reconciles occurrence rows in the activities table
// (materializeVolunteerEventsForAt_/reconcileVolunteerEventsForAt_,
// volExpandActType_). That's the same virtual/projected-activity
// machinery deferred everywhere else this migration (see get-slots' and
// get-config's headers) — it depends on activity_templates data that
// doesn't exist yet in this project, so there's nothing to materialize.
// Returns zero counts rather than faking a reconciliation with no config
// to reconcile against.
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

  const { count } = await admin.from("activities")
    .select("id", { count: "exact", head: true }).eq("signup_required", true);

  return json({ added: 0, pruned: 0, softDeleted: 0, total: count || 0 });
});
