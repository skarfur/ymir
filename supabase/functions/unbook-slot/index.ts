import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's unbookSlot_ — allows the booker, a crew member, or
// staff/admin to cancel. Class-slot bookings (materialized from a virtual)
// get deleted so the (stubbed) projection can re-emit the virtual; regular
// slots just clear the booker fields.
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
  if (slotId.startsWith("vslot-")) return json({ error: "Virtual class slot — nothing to unbook" }, 400);

  const { data: slot } = await admin.from("reservation_slots").select("*").eq("id", slotId).maybeSingle();
  if (!slot) return json({ error: "Slot not found" }, 404);
  if (!slot.booked_by_kennitala) return json({ error: "Slot is not booked" }, 400);

  const kt = body?.kennitala ? String(body.kennitala) : "";
  const isBooker = String(slot.booked_by_kennitala) === kt;
  let isCrewMember = false;
  if (slot.booked_by_crew_id) {
    const { data: crew } = await admin.from("crews").select("pairs").eq("id", slot.booked_by_crew_id).maybeSingle();
    if (crew) {
      const pairs: any[] = Array.isArray(crew.pairs) ? crew.pairs : [];
      isCrewMember = pairs.some((p) => (p.members || []).some((m: any) => m && String(m.kennitala) === kt));
    }
  }
  const { data: member } = kt ? await admin.from("members").select("role").eq("kennitala", kt).maybeSingle() : { data: null };
  const isStaff = !!member && (member.role === "staff" || member.role === "admin");
  if (!isBooker && !isCrewMember && !isStaff) return json({ error: "Only the booker, a crew member, or staff can cancel" }, 403);

  if (slot.source_activity_class_id) {
    await admin.from("reservation_slots").delete().eq("id", slotId);
    return json({ unbooked: true, dematerialized: true });
  }

  const { error } = await admin.from("reservation_slots").update({
    booked_by_kennitala: null, booked_by_name: null, booked_by_crew_id: null, booking_color: null, tentative: false,
  }).eq("id", slotId);
  if (error) return json({ error: "Unbook failed: " + error.message }, 500);

  return json({ unbooked: true });
});
