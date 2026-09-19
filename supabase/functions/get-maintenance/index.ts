import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports maintenance.gs's getMaintenance_ — a plain readAll_('maintenance')
// in the Sheets version, translated into the flat camelCase DTO
// maintenance.js/saumaklubbur.js/member.js read directly instead of raw
// snake_case columns. boat_name is now a real denormalized column (see the
// fix_maintenance_write_port_fields migration) so this reads it straight
// off the row, matching the Sheets SCHEMA_.maintenance shape exactly —
// no join needed.
//
// Requires a valid session — getMaintenance isn't in Apps Script's
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

function toDto(r: any) {
  return {
    id: r.id,
    category: r.category || "boat",
    boatId: r.boat_id || "",
    boatName: r.boat_name || "",
    itemName: r.item_name || "",
    part: r.part || "",
    severity: r.severity || "medium",
    description: r.description || "",
    photoUrl: r.photo_url || "",
    markOos: !!r.mark_oos,
    reportedBy: r.reported_by || "",
    source: r.source || "staff",
    createdAt: r.created_at,
    resolved: !!r.resolved,
    resolvedBy: r.resolved_by || "",
    resolvedAt: r.resolved_at || "",
    comments: r.comments ? JSON.stringify(r.comments) : "[]",
    saumaklubbur: !!r.saumaklubbur,
    verkstjori: r.verkstjori || "",
    materials: r.materials ? JSON.stringify(r.materials) : "[]",
    approved: !!r.approved,
    onHold: !!r.on_hold,
    followers: r.followers ? JSON.stringify(r.followers) : "[]",
    updatedAt: r.updated_at,
  };
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

  const { data: all, error } = await admin.from("maintenance").select("*");
  if (error) return json({ error: "Maintenance lookup failed" }, 500);

  return json({ requests: (all || []).map(toDto) });
});
