import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's createConfirmation_ — starts a trip-confirmation
// handshake (crew_assigned/crew_join/helm/student/verify). Any
// authenticated session, matching the original (not in ADMIN_ACTIONS_/
// STAFF_ACTIONS_).
//
// to_kennitala can be the literal string 'staff' (requestVerification_'s
// sentinel for "any staff member") — that's why it's a text column, not
// just a member_id FK; to_member_id stays best-effort/null for that case.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function timeToTimestamptz(hhmm: unknown, dateISO: string): string | null {
  if (!hhmm || !dateISO) return null;
  const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${dateISO}T${m[1].padStart(2, "0")}:${m[2]}:00Z`;
}
function parseJsonMaybe(v: unknown): unknown {
  if (v === "" || v == null) return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const type = body?.type ? String(body.type) : "";
  if (!type) return json({ error: "type required" }, 400);
  const toKennitala = body?.toKennitala ? String(body.toKennitala) : "";
  if (!toKennitala) return json({ error: "toKennitala required" }, 400);

  const fromKennitala = body?.fromKennitala ? String(body.fromKennitala) : "";
  let fromMemberId: string | null = null;
  if (fromKennitala) {
    const { data: m } = await admin.from("members").select("id").eq("kennitala", fromKennitala).maybeSingle();
    if (m) fromMemberId = m.id;
  }
  let toMemberId: string | null = null;
  if (toKennitala && toKennitala !== "staff") {
    const { data: m } = await admin.from("members").select("id").eq("kennitala", toKennitala).maybeSingle();
    if (m) toMemberId = m.id;
  }

  const tripId = body?.tripId ? String(body.tripId) : "";
  const linkedCheckoutId = body?.linkedCheckoutId ? String(body.linkedCheckoutId) : "";
  const boatId = body?.boatId ? String(body.boatId) : "";
  const locationId = body?.locationId ? String(body.locationId) : "";
  const date = body?.date ? String(body.date).slice(0, 10) : "";

  const row = {
    type,
    status: "pending",
    from_member_id: fromMemberId,
    from_kennitala: fromKennitala,
    from_name: String(body?.fromName || ""),
    to_member_id: toMemberId,
    to_kennitala: toKennitala,
    to_name: String(body?.toName || ""),
    trip_id: tripId && UUID_RE.test(tripId) ? tripId : null,
    linked_checkout_id: linkedCheckoutId && UUID_RE.test(linkedCheckoutId) ? linkedCheckoutId : null,
    boat_id: boatId && UUID_RE.test(boatId) ? boatId : null,
    boat_name: String(body?.boatName || ""),
    boat_category: String(body?.boatCategory || ""),
    location_id: locationId && UUID_RE.test(locationId) ? locationId : null,
    location_name: String(body?.locationName || ""),
    date: date || null,
    time_out: timeToTimestamptz(body?.timeOut, date),
    time_in: timeToTimestamptz(body?.timeIn, date),
    hours_decimal: body?.hoursDecimal === "" || body?.hoursDecimal == null ? null : Number(body.hoursDecimal),
    role: String(body?.role || ""),
    helm: body?.helm ? "true" : "",
    crew_count: parseInt(String(body?.crew || "1"), 10) || 1,
    skipper_note: String(body?.skipperNote || ""),
    beaufort: body?.beaufort === "" || body?.beaufort == null ? null : parseInt(String(body.beaufort), 10),
    wind_dir: String(body?.windDir || ""),
    wx_snapshot: parseJsonMaybe(body?.wxSnapshot),
    reject_comment: "",
  };

  const { data: inserted, error } = await admin.from("trip_confirmations").insert(row).select("id").single();
  if (error) return json({ error: "Confirmation create failed: " + error.message }, 500);

  return json({ id: inserted.id, created: true });
});
