import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's createCrew_. Any authenticated session.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const CREW_COLORS = ["#e74c3c", "#e67e22", "#f1c40f", "#27ae60", "#2980b9", "#8e44ad", "#d4af37", "#a78bfa"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const name = body?.name ? String(body.name) : "";
  if (!name) return json({ error: "Crew name required" }, 400);
  const kennitala = body?.kennitala ? String(body.kennitala) : "";
  const memberName = body?.memberName ? String(body.memberName) : "";
  if (!kennitala || !memberName) return json({ error: "Creator kennitala and name required" }, 400);

  let numPairs = parseInt(String(body?.numPairs || "2"), 10) || 2;
  if (numPairs < 2 || numPairs > 3) return json({ error: "numPairs must be 2 or 3" }, 400);

  const pairs: any[] = [];
  for (let i = 0; i < numPairs; i++) pairs.push({ pairId: `pair_${i + 1}`, members: [null, null] });
  let creatorPair = parseInt(String(body?.creatorPairIndex ?? "0"), 10) || 0;
  if (creatorPair >= pairs.length) creatorPair = 0;
  let creatorSeat = parseInt(String(body?.creatorSeatIndex ?? "0"), 10) || 0;
  if (creatorSeat > 1) creatorSeat = 0;
  pairs[creatorPair].members[creatorSeat] = { kennitala, name: memberName };

  const visibility = body?.visibility === "invite_only" ? "invite_only" : "open";
  let color = "";
  if (typeof body?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)) {
    color = body.color;
  } else {
    const { count } = await admin.from("crews").select("id", { count: "exact", head: true }).neq("status", "disbanded");
    color = CREW_COLORS[(count || 0) % CREW_COLORS.length];
  }

  const { data: inserted, error } = await admin.from("crews").insert({
    name, pairs, description: String(body?.description || ""), visibility, color, status: "forming",
  }).select("id").single();
  if (error) return json({ error: "Crew create failed: " + error.message }, 500);

  return json({ created: true, crewId: inserted.id, crew: { id: inserted.id, name, pairs, status: "forming", description: body?.description || "", visibility, color } });
});
