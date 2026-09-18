import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's getCrewInvites_ — filter by kennitala (resolved to
// member_id, pending only) and/or crewId.
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

  let query = admin.from("crew_invites").select("*");

  const kennitala = body?.kennitala ? String(body.kennitala).trim() : "";
  if (kennitala) {
    const { data: member } = await admin.from("members").select("id").eq("kennitala", kennitala).maybeSingle();
    if (!member) return json({ invites: [] });
    query = query.eq("to_member_id", member.id).eq("status", "pending");
  }

  const crewId = body?.crewId ? String(body.crewId) : "";
  if (crewId) query = query.eq("crew_id", crewId);

  const { data: invites, error } = await query;
  if (error) return json({ error: "Crew invites lookup failed" }, 500);

  return json({ invites: invites || [] });
});
