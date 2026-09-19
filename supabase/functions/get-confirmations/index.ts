import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's getConfirmations_ — incoming/outgoing non-dismissed
// trip_confirmations for a member, translated into the flat camelCase DTO
// captain.js/member.js read directly (fromKennitala/fromName/toKennitala/
// toName/boatName/boatCategory/locationName/crew as a headcount/etc), not
// the raw snake_case columns — the same bug get-active-checkouts/get-trips
// had before they were fixed. Matched against from/to_kennitala (not just
// the member_id FK) since to_kennitala can hold the literal 'staff'
// sentinel (requestVerification_), which has no member_id to match.
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

  const kennitala = body?.kennitala ? String(body.kennitala).trim() : "";
  if (!kennitala) return json({ error: "kennitala required" }, 400);

  const { data: all, error } = await admin.from("trip_confirmations").select("*").eq("dismissed", false);
  if (error) return json({ error: "Confirmations lookup failed" }, 500);

  const incoming = (all || []).filter((r) => String(r.to_kennitala || "") === kennitala).map(toDto);
  const outgoing = (all || []).filter((r) => String(r.from_kennitala || "") === kennitala).map(toDto);

  return json({ incoming, outgoing });
});
