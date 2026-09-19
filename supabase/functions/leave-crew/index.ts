import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's leaveCrew_. Any authenticated session.
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
  const kennitala = body?.kennitala ? String(body.kennitala) : "";
  if (!kennitala) return json({ error: "kennitala required" }, 400);

  const { data: crew } = await admin.from("crews").select("*").eq("id", crewId).maybeSingle();
  if (!crew) return json({ error: "Crew not found" }, 404);
  if (crew.status === "disbanded") return json({ error: "Crew is disbanded" }, 400);

  const pairs: any[] = Array.isArray(crew.pairs) ? crew.pairs : [];
  let found = false;
  pairs.forEach((p) => {
    if (!p.members) return;
    for (let i = 0; i < p.members.length; i++) {
      if (p.members[i] && String(p.members[i].kennitala) === kennitala) {
        p.members[i] = null;
        found = true;
      }
    }
  });
  if (!found) return json({ error: "You are not in this crew" }, 400);

  const totalMembers = pairs.reduce((sum, p) => sum + (p.members || []).filter((m: any) => m !== null).length, 0);
  if (totalMembers === 0) {
    await admin.from("crews").update({ status: "disbanded", updated_at: new Date().toISOString() }).eq("id", crewId);
    return json({ left: true, disbanded: true });
  }
  const newStatus = totalMembers >= pairs.length * 2 ? "active" : "forming";
  await admin.from("crews").update({ pairs, status: newStatus, updated_at: new Date().toISOString() }).eq("id", crewId);

  return json({ left: true, status: newStatus });
});
