import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's getSlots_ — real-row filtering only (boatId,
// category via a boats-table lookup, date range). Deliberately stubbed:
// the virtual-slot projection (projectSlotsForRange_, which expands each
// active activity class's bulkSchedule x reservedBoatIds into synthetic
// slots) — that depends on activity_templates data that doesn't exist yet
// (app_config's activity_templates key is unseeded), so it would return []
// regardless of how faithfully it's ported right now.
//
// Requires a valid session — getSlots isn't in Apps Script's
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

  const boatId = body?.boatId ? String(body.boatId) : "";
  const category = body?.category ? String(body.category) : "";
  const fromDate = body?.fromDate ? String(body.fromDate) : "";
  const toDate = body?.toDate ? String(body.toDate) : "";

  let catBoatIds: Set<string> | null = null;
  if (category) {
    const { data: boats } = await admin.from("boats").select("id").eq("category", category);
    catBoatIds = new Set((boats || []).map((b) => b.id));
  }

  const { data: all, error } = await admin.from("reservation_slots").select("*");
  if (error) return json({ error: "Slots lookup failed" }, 500);

  const result = (all || []).filter((s) => {
    if (boatId && s.boat_id !== boatId) return false;
    if (catBoatIds && !catBoatIds.has(s.boat_id)) return false;
    if (fromDate && s.date < fromDate) return false;
    if (toDate && s.date > toDate) return false;
    return true;
  });

  return json({ slots: result });
});
