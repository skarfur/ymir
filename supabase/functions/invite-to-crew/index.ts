import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's inviteToCrew_. Any authenticated session.
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
  const toKennitala = body?.toKennitala ? String(body.toKennitala) : "";
  const toName = body?.toName ? String(body.toName) : "";
  if (!toKennitala || !toName) return json({ error: "Invitee kennitala and name required" }, 400);
  const fromKennitala = body?.fromKennitala ? String(body.fromKennitala) : "";
  const fromName = body?.fromName ? String(body.fromName) : "";
  if (!fromKennitala || !fromName) return json({ error: "Inviter kennitala and name required" }, 400);
  const pairId = body?.pairId ? String(body.pairId) : "";
  if (!pairId) return json({ error: "pairId required" }, 400);

  const { data: crew } = await admin.from("crews").select("*").eq("id", crewId).maybeSingle();
  if (!crew) return json({ error: "Crew not found" }, 404);
  if (crew.status === "disbanded") return json({ error: "Crew is disbanded" }, 400);

  const pairs: any[] = Array.isArray(crew.pairs) ? crew.pairs : [];
  const pair = pairs.find((p) => p.pairId === pairId);
  if (!pair) return json({ error: "Pair not found" }, 404);
  if (!pair.members) pair.members = [null, null];
  while (pair.members.length < 2) pair.members.push(null);
  if (pair.members.filter((m: any) => m === null).length === 0) return json({ error: "This pair is full" }, 400);
  const alreadyMember = pairs.some((p) => (p.members || []).some((m: any) => m && String(m.kennitala) === toKennitala));
  if (alreadyMember) return json({ error: "This person is already in the crew" }, 400);

  const { data: existing } = await admin.from("crew_invites").select("id")
    .eq("crew_id", crewId).eq("to_kennitala", toKennitala).eq("status", "pending").maybeSingle();
  if (existing) return json({ error: "An invite is already pending for this person" }, 400);

  const { data: fromMember } = await admin.from("members").select("id").eq("kennitala", fromKennitala).maybeSingle();
  const { data: toMember } = await admin.from("members").select("id").eq("kennitala", toKennitala).maybeSingle();

  const { data: inserted, error } = await admin.from("crew_invites").insert({
    crew_id: crewId, crew_name: String(crew.name),
    pair_id: pairId,
    from_member_id: fromMember ? fromMember.id : null, from_kennitala: fromKennitala, from_name: fromName,
    to_member_id: toMember ? toMember.id : null, to_kennitala: toKennitala, to_name: toName,
    status: "pending",
  }).select("id").single();
  if (error) return json({ error: "Invite failed: " + error.message }, 500);

  return json({ invited: true, inviteId: inserted.id });
});
