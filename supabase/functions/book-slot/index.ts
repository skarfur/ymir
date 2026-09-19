import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's bookSlot_. Any authenticated session.
//
// Deliberately stubbed: virtual (vslot-*) class-slot materialization —
// depends on activity_templates data that doesn't exist yet (same
// deferral get-slots already documents), and no real vslot- id can reach
// this function in practice since get-slots never projects one.
//
// Deliberately stubbed: the keelboat cert-access gate (getCertDefsFromMap_/
// normalizeAccessGate_/memberHasGate_) — same deferral as save-checkout's
// controlled-access boat gate. Booking a keelboat still requires the boat
// to exist in the boats table, which is empty regardless, so this is moot
// until real boat + cert data is imported.
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

  const slotId = body?.slotId ? String(body.slotId) : "";
  if (!slotId) return json({ error: "slotId required" }, 400);
  if (slotId.startsWith("vslot-")) return json({ error: "Virtual slot booking not supported yet" }, 400);

  const { data: slot } = await admin.from("reservation_slots").select("*").eq("id", slotId).maybeSingle();
  if (!slot) return json({ error: "Slot not found" }, 404);
  if (slot.booked_by_kennitala) return json({ error: "Slot already booked" }, 400);

  const { data: boat } = await admin.from("boats").select("*").eq("id", slot.boat_id).maybeSingle();
  if (!boat) return json({ error: "Boat not found" }, 404);

  const updates: Record<string, unknown> = {
    booked_by_kennitala: null, booked_by_name: null, booked_by_crew_id: null,
    booking_color: String(body?.bookingColor || ""), tentative: false,
  };

  const crewId = body?.crewId ? String(body.crewId) : "";
  if (crewId) {
    const { data: crew } = await admin.from("crews").select("*").eq("id", crewId).maybeSingle();
    if (!crew || crew.status === "disbanded") return json({ error: "Crew not found or disbanded" }, 404);
    if (crew.status !== "active" && crew.status !== "forming") return json({ error: "Crew not found or not active" }, 400);
    const pairs: any[] = Array.isArray(crew.pairs) ? crew.pairs : [];
    const kennitala = body?.kennitala ? String(body.kennitala) : "";
    const isMember = pairs.some((p) => (p.members || []).some((m: any) => m && String(m.kennitala) === kennitala));
    if (!isMember) return json({ error: "You are not a member of this crew" }, 400);
    updates.booked_by_crew_id = crewId;
    updates.booked_by_name = String(crew.name || body?.memberName || "");
    updates.booked_by_kennitala = kennitala;
    updates.tentative = crew.status === "forming";
  } else {
    const kennitala = body?.kennitala ? String(body.kennitala) : "";
    if (!kennitala) return json({ error: "kennitala required" }, 400);
    updates.booked_by_kennitala = kennitala;
    updates.booked_by_name = String(body?.memberName || "");
  }

  const { error } = await admin.from("reservation_slots").update(updates).eq("id", slotId);
  if (error) return json({ error: "Booking failed: " + error.message }, 500);

  return json({ booked: true, slotId });
});
