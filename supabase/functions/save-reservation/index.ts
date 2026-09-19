import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's saveReservation_ — adds a date-range reservation for
// a boat. Any authenticated session, matching the original (not in
// ADMIN_ACTIONS_/STAFF_ACTIONS_) — called from captain/ and admin/boats.js.
//
// Writes to the real boat_reservations table instead of pushing into the
// boats config-JSON blob's `reservations` array — see the migration header
// for why (avoids the read-modify-write-the-whole-blob race on concurrent
// bookings). The frontend never sends a reservationId when creating (only
// removeReservation takes one, echoing an id this function just minted),
// so this is always an insert — no update-in-place branch needed.
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

  const boatId = body?.boatId ? String(body.boatId) : "";
  if (!boatId) return json({ error: "boatId required" }, 400);
  const memberKennitala = body?.memberKennitala ? String(body.memberKennitala) : "";
  const memberName = body?.memberName ? String(body.memberName) : "";
  if (!memberKennitala || !memberName) return json({ error: "member required" }, 400);
  const startDate = body?.startDate ? String(body.startDate).slice(0, 10) : "";
  const endDate = body?.endDate ? String(body.endDate).slice(0, 10) : "";
  if (!startDate || !endDate) return json({ error: "startDate and endDate required" }, 400);

  if (!UUID_RE.test(boatId)) return json({ error: "Boat not found" }, 404);
  const { data: boat } = await admin.from("boats").select("*").eq("id", boatId).maybeSingle();
  if (!boat) return json({ error: "Boat not found" }, 404);

  const { data: member } = await admin.from("members").select("id").eq("kennitala", memberKennitala).maybeSingle();

  const { data: reservation, error } = await admin.from("boat_reservations").insert({
    boat_id: boatId,
    member_id: member ? member.id : null,
    member_kennitala: memberKennitala,
    member_name: memberName,
    start_date: startDate,
    end_date: endDate,
    note: String(body?.note || ""),
  }).select("*").single();
  if (error) return json({ error: "Reservation save failed: " + error.message }, 500);

  const { data: reservations } = await admin.from("boat_reservations").select("*").eq("boat_id", boatId);

  return json({
    updated: true,
    boat: toBoatDto(boat, reservations || []),
    reservation: {
      id: reservation.id,
      memberKennitala: reservation.member_kennitala,
      memberName: reservation.member_name,
      startDate: reservation.start_date,
      endDate: reservation.end_date,
      note: reservation.note || "",
    },
  });
});
