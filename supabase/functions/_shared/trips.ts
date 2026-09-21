import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Ports trips.gs's getTrips_ — filter (kennitala -> member_id, date,
// linkedCheckoutId, category), sort by date desc, paginate — translated
// into the flat camelCase DTO shared/tripcard.js reads directly
// (kennitala, memberName, boatName, boatCategory, locationName, timeOut,
// timeIn, hoursDecimal, crew, ...), not the raw snake_case columns.
//
// Group-sail label resolution (buildGroupLabelMap_ → isGroupTrip/
// groupLabel) stays stubbed — same deferral as get-active-checkouts.
//
// Extracted from get-trips/index.ts (which now just calls this) so
// get-captain-bundle can pull the same read into its combined response
// without duplicating it.

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

export interface TripsQuery {
  kennitala?: string;
  date?: string;
  linkedCheckoutId?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export async function buildTrips(admin: SupabaseClient, q: TripsQuery): Promise<any> {
  const kennitala = q.kennitala || "";
  const date = q.date ? q.date.slice(0, 10) : "";
  const linkedCheckoutId = q.linkedCheckoutId || "";
  const category = q.category ? q.category.toLowerCase() : "";
  const limit = q.limit || 100;
  const offset = q.offset || 0;

  const { data: all, error } = await admin.from("trips").select("*");
  if (error) throw new Error("Trips lookup failed");

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

  return { trips: page, total, offset, limit };
}
