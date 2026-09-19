import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's joinCrew_. Any authenticated session.
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
  const memberName = body?.memberName ? String(body.memberName) : "";
  if (!kennitala || !memberName) return json({ error: "kennitala and memberName required" }, 400);
  const pairId = body?.pairId ? String(body.pairId) : "";
  if (!pairId) return json({ error: "pairId required" }, 400);
  const seatIndex = parseInt(String(body?.seatIndex), 10);
  if (isNaN(seatIndex) || seatIndex < 0 || seatIndex > 1) return json({ error: "seatIndex must be 0 (bow) or 1 (stern)" }, 400);

  const { data: crew } = await admin.from("crews").select("*").eq("id", crewId).maybeSingle();
  if (!crew) return json({ error: "Crew not found" }, 404);
  if (crew.status === "disbanded") return json({ error: "Crew is disbanded" }, 400);
  if ((crew.visibility || "open") === "invite_only") return json({ error: "This crew is invite-only" }, 400);

  const pairs: any[] = Array.isArray(crew.pairs) ? crew.pairs : [];
  const alreadyMember = pairs.some((p) => (p.members || []).some((m: any) => m && String(m.kennitala) === kennitala));
  if (alreadyMember) return json({ error: "You are already in this crew" }, 400);
  const pair = pairs.find((p) => p.pairId === pairId);
  if (!pair) return json({ error: "Pair not found" }, 404);
  if (!pair.members) pair.members = [null, null];
  while (pair.members.length < 2) pair.members.push(null);
  if (pair.members[seatIndex] !== null) return json({ error: "This seat is taken" }, 400);
  pair.members[seatIndex] = { kennitala, name: memberName };

  const totalMembers = pairs.reduce((sum, p) => sum + (p.members || []).filter((m: any) => m !== null).length, 0);
  const totalSlots = pairs.length * 2;
  const newStatus = totalMembers >= totalSlots ? "active" : "forming";
  await admin.from("crews").update({ pairs, status: newStatus, updated_at: new Date().toISOString() }).eq("id", crewId);

  return json({ joined: true, status: newStatus });
});
