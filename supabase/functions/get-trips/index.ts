import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's getTrips_ — filter (kennitala -> member_id, date,
// linkedCheckoutId, category), sort by date desc, paginate — translated
// into the flat camelCase DTO shared/tripcard.js reads directly
// (kennitala, memberName, boatName, boatCategory, locationName, timeOut,
// timeIn, hoursDecimal, crew, ...), not the raw snake_case columns. This
// previously just spread the raw row (same bug get-active-checkouts had
// before it was fixed) — fixed now because groupCheckIn's
// createSupervisorTripsForGroup writes rows here that need to render.
//
// Group-sail label resolution (buildGroupLabelMap_ → isGroupTrip/
// groupLabel) stays stubbed — same deferral as get-active-checkouts.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function hhmm(ts: unknown): string {
  if (!ts) return "";
  const s = String(ts);
  return s.length >= 16 ? s.slice(11, 16) : "";
}

function toDto(t: any) {
  return {
    id: t.id,
    kennitala: t.member_kennitala || "",
    memberName: t.member_name || "",
    date: t.date,
    timeOut: hhmm(t.time_out),
    timeIn: hhmm(t.time_in),
    hoursDecimal: t.hours_decimal != null ? Number(t.hours_decimal) : 0,
    boatId: t.boat_id || "",
    boatName: t.boat_name || "",
    boatCategory: t.boat_category || "",
    locationId: t.location_id || "",
    locationName: t.location_name || "",
    crew: t.crew_count || 1,
    role: t.role || "skipper",
    beaufort: t.beaufort,
    windDir: t.wind_dir || "",
    wxSnapshot: t.wx_snapshot ? JSON.stringify(t.wx_snapshot) : "",
    notes: t.notes || "",
    isLinked: !!t.is_linked,
    linkedCheckoutId: t.linked_checkout_id || "",
    linkedTripId: t.linked_trip_id || "",
    verified: !!t.verified,
    verifiedBy: t.verified_by || "",
    verifiedAt: t.verified_at || "",
    staffComment: t.staff_comment || "",
    validationRequested: !!t.validation_requested,
    helm: t.helm || "",
    student: t.student || "",
    skipperNote: t.skipper_note || "",
    nonClub: !!t.non_club,
    distanceNm: t.distance_nm != null ? Number(t.distance_nm) : null,
    departurePort: t.departure_port || "",
    arrivalPort: t.arrival_port || "",
    trackFileUrl: t.track_file_url || "",
    trackSimplified: t.track_simplified ? JSON.stringify(t.track_simplified) : "",
    trackSource: t.track_source || "",
    photoUrls: t.photo_urls || [],
    photoMeta: t.photo_meta ? JSON.stringify(t.photo_meta) : "",
    createdAt: t.created_at,
    updatedAt: t.updated_at,
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

  const kennitala = body?.kennitala ? String(body.kennitala).trim() : "";
  const date = body?.date ? String(body.date).slice(0, 10) : "";
  const linkedCheckoutId = body?.linkedCheckoutId ? String(body.linkedCheckoutId) : "";
  const category = body?.category ? String(body.category).toLowerCase() : "";
  const limit = parseInt(String(body?.limit || "100"), 10) || 100;
  const offset = parseInt(String(body?.offset || "0"), 10) || 0;

  const { data: all, error } = await admin.from("trips").select("*");
  if (error) return json({ error: "Trips lookup failed" }, 500);

  const filtered = (all || []).filter((t: any) => {
    if (kennitala && String(t.member_kennitala || "") !== kennitala) return false;
    if (date && String(t.date || "").slice(0, 10) !== date) return false;
    if (linkedCheckoutId && String(t.linked_checkout_id || "") !== linkedCheckoutId) return false;
    if (category && String(t.boat_category || "").toLowerCase() !== category) return false;
    return true;
  });
  filtered.sort((a: any, b: any) => (b.date || "") > (a.date || "") ? 1 : -1);

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit).map(toDto);

  return json({ trips: page, total, offset, limit });
});
