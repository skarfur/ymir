import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's requestVerification_ — mints a type='verify' handshake
// addressed to 'staff' (the sentinel — see create-confirmation's header)
// and mirrors validation_requested=true onto the trip so the "pending"
// badge survives a refresh even when the confirmations list isn't loaded.
// Any authenticated session, matching the original.
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

  const tripId = body?.tripId ? String(body.tripId) : "";
  if (!tripId) return json({ error: "tripId required" }, 400);

  const { data: trip } = await admin.from("trips").select("*").eq("id", tripId).maybeSingle();
  if (!trip) return json({ error: "Trip not found" }, 404);
  if (trip.verified) return json({ error: "Already verified" }, 400);

  const ts = new Date().toISOString();
  const fromKennitala = body?.fromKennitala ? String(body.fromKennitala) : (trip.member_kennitala || "");
  let fromMemberId: string | null = trip.member_id || null;
  if (!fromMemberId && fromKennitala) {
    const { data: m } = await admin.from("members").select("id").eq("kennitala", fromKennitala).maybeSingle();
    if (m) fromMemberId = m.id;
  }

  const { data: inserted, error } = await admin.from("trip_confirmations").insert({
    type: "verify",
    status: "pending",
    from_member_id: fromMemberId,
    from_kennitala: fromKennitala,
    from_name: String(body?.fromName || trip.member_name || ""),
    to_member_id: null,
    to_kennitala: "staff",
    to_name: "Staff",
    trip_id: tripId,
    linked_checkout_id: trip.linked_checkout_id,
    boat_id: trip.boat_id,
    boat_name: trip.boat_name || "",
    boat_category: trip.boat_category || "",
    location_id: trip.location_id,
    location_name: trip.location_name || "",
    date: trip.date,
    time_out: trip.time_out,
    time_in: trip.time_in,
    hours_decimal: trip.hours_decimal,
    role: trip.role || "",
    helm: trip.helm || "",
    crew_count: trip.crew_count || 1,
    skipper_note: trip.skipper_note || "",
    beaufort: trip.beaufort,
    wind_dir: trip.wind_dir || "",
    wx_snapshot: trip.wx_snapshot,
    reject_comment: "",
  }).select("id").single();
  if (error) return json({ error: "Verification request failed: " + error.message }, 500);

  await admin.from("trips").update({ validation_requested: true, updated_at: ts }).eq("id", tripId);

  return json({ id: inserted.id, created: true, requested: true });
});
