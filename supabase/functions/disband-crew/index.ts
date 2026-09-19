import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's disbandCrew_ — also rejects any pending invites for
// the crew. Any authenticated session.
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

  const crewId = body?.crewId ? String(body.crewId) : "";
  if (!crewId) return json({ error: "crewId required" }, 400);
  const { data: crew } = await admin.from("crews").select("id").eq("id", crewId).maybeSingle();
  if (!crew) return json({ error: "Crew not found" }, 404);

  const ts = new Date().toISOString();
  await admin.from("crews").update({ status: "disbanded", updated_at: ts }).eq("id", crewId);
  await admin.from("crew_invites").update({ status: "rejected", responded_at: ts })
    .eq("crew_id", crewId).eq("status", "pending");

  return json({ disbanded: true });
});
