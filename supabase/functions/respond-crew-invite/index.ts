import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's respondCrewInvite_ — on accept, places the invitee
// in the specified (or first empty) seat. Any authenticated session.
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

  const inviteId = body?.inviteId ? String(body.inviteId) : "";
  if (!inviteId) return json({ error: "inviteId required" }, 400);
  const response = body?.response;
  if (response !== "accepted" && response !== "rejected") return json({ error: "response must be accepted or rejected" }, 400);

  const { data: inv } = await admin.from("crew_invites").select("*").eq("id", inviteId).maybeSingle();
  if (!inv) return json({ error: "Invite not found" }, 404);
  if (inv.status !== "pending") return json({ error: "Invite already responded to" }, 400);

  const ts = new Date().toISOString();
  await admin.from("crew_invites").update({ status: response, responded_at: ts }).eq("id", inviteId);

  if (response === "accepted" && inv.crew_id) {
    const { data: crew } = await admin.from("crews").select("*").eq("id", inv.crew_id).maybeSingle();
    if (crew) {
      const pairs: any[] = Array.isArray(crew.pairs) ? crew.pairs : [];
      const pair = pairs.find((p) => p.pairId === inv.pair_id);
      if (pair) {
        if (!pair.members) pair.members = [null, null];
        while (pair.members.length < 2) pair.members.push(null);
        let seatIdx = body?.seatIndex !== undefined ? parseInt(String(body.seatIndex), 10) : -1;
        if (seatIdx < 0 || seatIdx > 1 || pair.members[seatIdx] !== null) {
          seatIdx = pair.members[0] === null ? 0 : (pair.members[1] === null ? 1 : -1);
        }
        if (seatIdx >= 0 && pair.members[seatIdx] === null) {
          pair.members[seatIdx] = { kennitala: inv.to_kennitala, name: inv.to_name };
          const totalMembers = pairs.reduce((sum, p) => sum + (p.members || []).filter((m: any) => m !== null).length, 0);
          const newStatus = totalMembers >= pairs.length * 2 ? "active" : "forming";
          await admin.from("crews").update({ pairs, status: newStatus, updated_at: ts }).eq("id", inv.crew_id);
        }
      }
    }
  }

  return json({ responded: true, status: response });
});
