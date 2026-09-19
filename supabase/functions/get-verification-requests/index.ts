import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's getVerificationRequests_ — pending, non-dismissed
// trip_confirmations with type='verify', translated into the flat
// camelCase DTO (same shape get-confirmations returns) instead of raw
// snake_case columns.
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { data: requests, error } = await admin
    .from("trip_confirmations")
    .select("*")
    .eq("type", "verify")
    .eq("status", "pending")
    .eq("dismissed", false);
  if (error) return json({ error: "Verification requests lookup failed" }, 500);

  return json({ requests: (requests || []).map(toDto) });
});
