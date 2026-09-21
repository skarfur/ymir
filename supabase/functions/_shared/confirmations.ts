import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Ports trips.gs's getConfirmations_ and getVerificationRequests_ — both
// read trip_confirmations and share the exact same row -> DTO shape, so
// the DTO mapper lives here once instead of copied in both Edge
// Functions (it always had been — this just makes the duplication
// explicit-not-accidental by naming it).
//
// getConfirmations_: incoming/outgoing non-dismissed rows for a member.
// Matched against from/to_kennitala (not just the member_id FK) since
// to_kennitala can hold the literal 'staff' sentinel (requestVerification_),
// which has no member_id to match.
//
// getVerificationRequests_: pending, non-dismissed rows with type='verify'.
//
// Extracted so get-captain-bundle can pull both reads into its combined
// response without duplicating them.

function hhmm(ts: unknown): string {
  if (!ts) return "";
  const s = String(ts);
  return s.length >= 16 ? s.slice(11, 16) : "";
}

function toDto(r: any) {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    fromKennitala: r.from_kennitala || "",
    fromName: r.from_name || "",
    toKennitala: r.to_kennitala || "",
    toName: r.to_name || "",
    tripId: r.trip_id || "",
    linkedCheckoutId: r.linked_checkout_id || "",
    boatId: r.boat_id || "",
    boatName: r.boat_name || "",
    boatCategory: r.boat_category || "",
    locationId: r.location_id || "",
    locationName: r.location_name || "",
    date: r.date,
    timeOut: hhmm(r.time_out),
    timeIn: hhmm(r.time_in),
    hoursDecimal: r.hours_decimal != null ? Number(r.hours_decimal) : "",
    role: r.role || "",
    helm: r.helm || "",
    crew: r.crew_count || 1,
    skipperNote: r.skipper_note || "",
    beaufort: r.beaufort,
    windDir: r.wind_dir || "",
    wxSnapshot: r.wx_snapshot ? JSON.stringify(r.wx_snapshot) : "",
    rejectComment: r.reject_comment || "",
    createdAt: r.created_at,
    respondedAt: r.responded_at || "",
    dismissed: !!r.dismissed,
    dismissedAt: r.dismissed_at || "",
  };
}

export async function buildConfirmations(admin: SupabaseClient, kennitala: string): Promise<any> {
  const { data: all, error } = await admin.from("trip_confirmations").select("*").eq("dismissed", false);
  if (error) throw new Error("Confirmations lookup failed");

  const incoming = (all || []).filter((r) => String(r.to_kennitala || "") === kennitala).map(toDto);
  const outgoing = (all || []).filter((r) => String(r.from_kennitala || "") === kennitala).map(toDto);
  return { incoming, outgoing };
}

export async function buildVerificationRequests(admin: SupabaseClient): Promise<any> {
  const { data: requests, error } = await admin
    .from("trip_confirmations")
    .select("*")
    .eq("type", "verify")
    .eq("status", "pending")
    .eq("dismissed", false);
  if (error) throw new Error("Verification requests lookup failed");
  return { requests: (requests || []).map(toDto) };
}
