import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's getTrips_ — filter (kennitala -> member_id, date,
// linkedCheckoutId, category), sort by date desc, paginate.
// Group-sail label resolution (buildGroupLabelMap_) stubbed — same
// deferral as get-active-checkouts, moot with empty checkouts/activities.
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

  const kennitala = body?.kennitala ? String(body.kennitala).trim() : "";
  const date = body?.date ? String(body.date).slice(0, 10) : "";
  const linkedCheckoutId = body?.linkedCheckoutId ? String(body.linkedCheckoutId) : "";
  const category = body?.category ? String(body.category).toLowerCase() : "";
  const limit = parseInt(String(body?.limit || "100"), 10) || 100;
  const offset = parseInt(String(body?.offset || "0"), 10) || 0;

  let memberId: string | null = null;
  if (kennitala) {
    const { data: member } = await admin.from("members").select("id").eq("kennitala", kennitala).maybeSingle();
    if (!member) return json({ trips: [], total: 0, offset, limit });
    memberId = member.id;
  }

  const { data: all, error } = await admin.from("trips").select("*, boats(category)");
  if (error) return json({ error: "Trips lookup failed" }, 500);

  let filtered = (all || []).filter((t: any) => {
    if (memberId && t.member_id !== memberId) return false;
    if (date && String(t.date || "").slice(0, 10) !== date) return false;
    if (linkedCheckoutId && String(t.linked_checkout_id || "") !== linkedCheckoutId) return false;
    if (category && String(t.boats?.category || "").toLowerCase() !== category) return false;
    return true;
  });
  filtered.sort((a: any, b: any) => (b.date || "") > (a.date || "") ? 1 : -1);

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit).map((t: any) => {
    const { boats, ...rest } = t;
    return rest;
  });

  return json({ trips: page, total, offset, limit });
});
