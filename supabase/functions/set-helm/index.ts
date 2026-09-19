import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's setHelm_ — any authenticated session, matching the
// original. trips.helm is text (not boolean) to match the flexible
// truthy-string values tripcard.js/logbook code already reads across the
// app (e.g. student's 'false'-string check) — stored as the string
// 'true'/'false' here, same shape saveTrip's helm field uses.
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

  const tripId = body?.tripId ? String(body.tripId) : "";
  if (!tripId) return json({ error: "tripId required" }, 400);

  const { error } = await admin.from("trips").update({
    helm: String(!!body?.helm),
    updated_at: new Date().toISOString(),
    actor_id: session.memberId,
  }).eq("id", tripId);
  if (error) return json({ error: "Set helm failed: " + error.message }, 500);

  return json({ updated: true });
});
