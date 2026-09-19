import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's updateCrew_. Any authenticated session.
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
  const { data: crew } = await admin.from("crews").select("status").eq("id", crewId).maybeSingle();
  if (!crew) return json({ error: "Crew not found" }, 404);
  if (crew.status === "disbanded") return json({ error: "Crew is disbanded" }, 400);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.name !== undefined) updates.name = String(body.name);
  if (body?.description !== undefined) updates.description = String(body.description);
  if (body?.visibility !== undefined) updates.visibility = body.visibility === "invite_only" ? "invite_only" : "open";
  if (body?.color !== undefined) updates.color = String(body.color);

  const { error } = await admin.from("crews").update(updates).eq("id", crewId);
  if (error) return json({ error: "Crew update failed: " + error.message }, 500);

  return json({ updated: true });
});
