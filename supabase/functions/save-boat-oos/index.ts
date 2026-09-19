import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's saveBoatOos_ — toggles a boat out-of-service, with a
// reason. Any authenticated session (not admin/staff-gated in code.gs
// either — matches STAFF_ACTIONS_'s own comment that some flows can't be
// blanket-gated; shared/maintenance.js calls this when resolving a
// maintenance issue). Operates on real boats columns now (oos/oos_reason)
// instead of rewriting the whole boats config-JSON blob.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBoatDto(b: any, reservations: any[]) {
  return {
    id: b.id,
    name: b.name,
    category: b.category,
    active: b.active,
    oos: !!b.oos,
    oosReason: b.oos_reason || "",
    defaultPortId: b.default_port_id || "",
    registrationNo: b.registration_no || "",
    typeModel: b.type_model || "",
    loa: b.loa != null ? Number(b.loa) : "",
    ownership: b.ownership || "club",
    ownerId: b.owner_kennitala || "",
    ownerName: b.owner_name || "",
    accessMode: b.access_mode || "free",
    accessGate: b.access_gate || null,
    accessGateCert: b.access_gate_cert || "",
    accessAllowlist: Array.isArray(b.access_allowlist) ? b.access_allowlist : [],
    slotSchedulingEnabled: !!b.slot_scheduling_enabled,
    availableOutsideSlots: b.available_outside_slots !== false,
    reservations: (reservations || []).map((r) => ({
      id: r.id,
      memberKennitala: r.member_kennitala,
      memberName: r.member_name,
      startDate: r.start_date,
      endDate: r.end_date,
      note: r.note || "",
    })),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const id = body?.id ? String(body.id) : "";
  if (!id) return json({ error: "id required" }, 400);
  if (!UUID_RE.test(id)) return json({ error: "Boat not found" }, 404);

  const updates: Record<string, unknown> = {};
  if (body?.oos !== undefined) updates.oos = !!body.oos;
  if (body?.oosReason !== undefined) updates.oos_reason = String(body.oosReason || "");

  let boat: any = null;
  if (Object.keys(updates).length) {
    const { data, error } = await admin.from("boats").update(updates).eq("id", id).select("*").maybeSingle();
    if (error) return json({ error: "Boat OOS save failed: " + error.message }, 500);
    boat = data;
  } else {
    const { data } = await admin.from("boats").select("*").eq("id", id).maybeSingle();
    boat = data;
  }
  if (!boat) return json({ error: "Boat not found" }, 404);

  const { data: reservations } = await admin.from("boat_reservations").select("*").eq("boat_id", id);

  return json({ updated: true, boat: toBoatDto(boat, reservations || []) });
});
