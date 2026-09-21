import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's getNotifications_. trip_confirmations now carries a
// to_kennitala text column (see the trip_confirmations write-port
// migration) matching the original's toKennitala field exactly — filtered
// directly by that, not by a resolved member_id FK, since to_kennitala can
// hold the literal 'staff' sentinel with no member behind it.
// crew_invites still only has a member_id FK, so that one filter stays
// resolved-by-kennitala.
//
// Requires a valid session — getNotifications isn't in Apps Script's
// PUBLIC_ACTIONS_ either.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const kennitala = body?.kennitala ? String(body.kennitala).trim() : "";
  if (!kennitala) return json({ error: "kennitala required" }, 400);

  const counts = { confirmations: 0, crewInvites: 0, saumaklubbur: 0, captainQ: 0 };

  // trip_confirmations, the member lookup, and maintenance are all
  // independent of each other — only crew_invites needs member.id first,
  // so it's the one query that stays sequential.
  const [
    { data: pending },
    { data: member },
    { data: allMaint },
  ] = await Promise.all([
    admin
      .from("trip_confirmations")
      .select("type")
      .eq("to_kennitala", kennitala)
      .eq("status", "pending")
      .eq("dismissed", false),
    admin.from("members").select("id").eq("kennitala", kennitala).maybeSingle(),
    admin.from("maintenance").select("saumaklubbur, resolved, approved, verkstjori, followers, updated_at"),
  ]);
  const pendingList = pending || [];
  counts.captainQ = pendingList.length;
  counts.confirmations = pendingList.filter((r) => r.type !== "verify").length;

  if (member) {
    const { data: invites } = await admin
      .from("crew_invites")
      .select("id")
      .eq("to_member_id", member.id)
      .eq("status", "pending");
    counts.crewInvites = (invites || []).length;
  }

  let saumaCount = 0;
  (allMaint || []).forEach((r) => {
    if (!r.saumaklubbur || r.resolved) return;
    if (!r.approved) return;
    if (!r.verkstjori) {
      saumaCount++;
      return;
    }
    const followers = Array.isArray(r.followers) ? r.followers : [];
    const myFollow = followers.find((f: any) => f && String(f.kt) === kennitala);
    if (myFollow && r.updated_at && myFollow.at && r.updated_at > myFollow.at) saumaCount++;
  });
  counts.saumaklubbur = saumaCount;

  return json({ counts });
});
