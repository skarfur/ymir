import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession, ResolvedSession } from "../_shared/session.ts";

// Ports trips.gs's saveTrip_ — a generic insert-or-patch over the trips
// table: id present and found -> patch only the supplied fields (never
// ghost-inserts on a verify/unverify-only call); otherwise insert. Any
// authenticated session, matching the original (not in ADMIN_ACTIONS_/
// STAFF_ACTIONS_) — called from member/ (self-logged trips), staff/
// (auto-trip on checkout check-in), and every shared/logbook-*.js edit
// flow (photo uploads, GPS track uploads, verify/unverify, crew-name
// edits) via the same generic action.
//
// actor_id is set on every call (trips.actor_id is NOT NULL) even though
// the Sheets version never tracked an actor on trips writes at all — a
// deliberate normalization, not a behavior port, since the column exists
// specifically for the audit_log trigger already wired to this table.
//
// Time fields (timeOut/timeIn) are anchored to the trip's own `date`, not
// "today" — unlike checkouts, trips are routinely logged/edited for past
// dates. boat_id/location_id/linked_checkout_id/linked_trip_id are
// resolved best-effort against their tables (still empty); boat_name/
// boat_category/location_name are always stored directly regardless,
// matching the checkouts precedent.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function timeToTimestamptz(hhmm: unknown, dateISO: string): string | null {
  if (!hhmm) return null;
  const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${dateISO}T${m[1].padStart(2, "0")}:${m[2]}:00Z`;
}
function parseJsonMaybe(v: unknown): unknown {
  if (v === "" || v == null) return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
}
function parseArrMaybe(v: unknown): unknown[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

async function translateFields(
  admin: ReturnType<typeof createAdminClient>,
  body: Record<string, unknown>,
  dateAnchor: string,
  isInsert: boolean,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  if (body.kennitala !== undefined) {
    const kt = String(body.kennitala || "");
    out.member_kennitala = kt;
    out.member_id = null;
    if (kt) {
      const { data: member } = await admin.from("members").select("id").eq("kennitala", kt).maybeSingle();
      if (member) out.member_id = member.id;
    }
  }
  if (body.memberName !== undefined) out.member_name = String(body.memberName || "");
  if (body.date !== undefined) out.date = String(body.date).slice(0, 10);
  if (body.timeOut !== undefined) out.time_out = timeToTimestamptz(body.timeOut, dateAnchor);
  if (body.timeIn !== undefined) out.time_in = timeToTimestamptz(body.timeIn, dateAnchor);
  if (body.hoursDecimal !== undefined) out.hours_decimal = body.hoursDecimal === "" ? null : Number(body.hoursDecimal) || 0;
  if (body.boatId !== undefined) {
    const bid = String(body.boatId || "");
    out.boat_id = null;
    if (bid && UUID_RE.test(bid)) {
      const { data: boat } = await admin.from("boats").select("id, category").eq("id", bid).maybeSingle();
      if (boat) {
        out.boat_id = boat.id;
        // Only auto-derive on insert, matching saveTrip_'s original
        // `if (!boatCategory && b.boatId) boatCategory = getBoatMap_()[...]`
        // fallback (update path never had this fallback).
        if (isInsert && body.boatCategory === undefined && boat.category) out.boat_category = boat.category;
      }
    }
  }
  if (body.boatName !== undefined) out.boat_name = String(body.boatName || "");
  if (body.boatCategory !== undefined) out.boat_category = String(body.boatCategory || "");
  if (body.locationId !== undefined) {
    const lid = String(body.locationId || "");
    out.location_id = null;
    if (lid && UUID_RE.test(lid)) {
      const { data: loc } = await admin.from("locations").select("id").eq("id", lid).maybeSingle();
      if (loc) out.location_id = loc.id;
    }
  }
  if (body.locationName !== undefined) out.location_name = String(body.locationName || "");
  if (body.crew !== undefined) out.crew_count = parseInt(String(body.crew), 10) || 1;
  if (body.role !== undefined) out.role = String(body.role || "skipper");
  if (body.beaufort !== undefined) out.beaufort = body.beaufort === "" || body.beaufort == null ? null : parseInt(String(body.beaufort), 10);
  if (body.windDir !== undefined) out.wind_dir = String(body.windDir || "");
  if (body.wxSnapshot !== undefined) out.wx_snapshot = parseJsonMaybe(body.wxSnapshot);
  if (body.notes !== undefined) out.notes = String(body.notes || "");
  if (body.isLinked !== undefined) out.is_linked = !!body.isLinked;
  if (body.linkedCheckoutId !== undefined) {
    const lcid = String(body.linkedCheckoutId || "");
    out.linked_checkout_id = lcid && UUID_RE.test(lcid) ? lcid : null;
  }
  if (body.linkedTripId !== undefined) {
    const ltid = String(body.linkedTripId || "");
    out.linked_trip_id = ltid && UUID_RE.test(ltid) ? ltid : null;
  }
  if (body.verified !== undefined) out.verified = !!body.verified;
  if (body.verifiedBy !== undefined) out.verified_by = String(body.verifiedBy || "");
  if (body.verifiedAt !== undefined) out.verified_at = body.verifiedAt || null;
  if (body.staffComment !== undefined) out.staff_comment = String(body.staffComment || "");
  if (body.validationRequested !== undefined) out.validation_requested = !!body.validationRequested;
  if (body.helm !== undefined) out.helm = body.helm === "" || body.helm == null ? "" : String(body.helm);
  if (body.student !== undefined) out.student = body.student === "" || body.student == null ? "" : String(body.student);
  if (body.skipperNote !== undefined) out.skipper_note = String(body.skipperNote || "");
  if (body.distanceNm !== undefined) out.distance_nm = body.distanceNm === "" ? null : Number(body.distanceNm);
  if (body.departurePort !== undefined) out.departure_port = String(body.departurePort || "");
  if (body.arrivalPort !== undefined) out.arrival_port = String(body.arrivalPort || "");
  if (body.nonClub !== undefined) out.non_club = !!body.nonClub;
  if (body.trackFileUrl !== undefined) out.track_file_url = String(body.trackFileUrl || "");
  if (body.trackSimplified !== undefined) out.track_simplified = parseJsonMaybe(body.trackSimplified);
  if (body.trackSource !== undefined) out.track_source = String(body.trackSource || "");
  if (body.photoUrls !== undefined) out.photo_urls = parseArrMaybe(body.photoUrls);
  if (body.photoMeta !== undefined) out.photo_meta = parseJsonMaybe(body.photoMeta);
  if (body.crewNames !== undefined) out.crew = parseArrMaybe(body.crewNames);

  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session: ResolvedSession | null = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const id = body?.id ? String(body.id) : "";

  if (id) {
    const { data: existing } = await admin.from("trips").select("id, date").eq("id", id).maybeSingle();
    if (existing) {
      const anchorDate = body?.date ? String(body.date).slice(0, 10) : String(existing.date);
      const updates = await translateFields(admin, body, anchorDate, false);
      updates.updated_at = new Date().toISOString();
      updates.actor_id = session.memberId;

      const { error } = await admin.from("trips").update(updates).eq("id", id);
      if (error) return json({ error: "Trip save failed: " + error.message }, 500);
      return json({ id, updated: true });
    }
  }

  const insertDate = body?.date ? String(body.date).slice(0, 10) : todayUtc();
  const fields = await translateFields(admin, body, insertDate, true);
  const row: Record<string, unknown> = {
    date: insertDate,
    role: "skipper",
    crew_count: 1,
    verified: false,
    ...fields,
    actor_id: session.memberId,
  };
  const { data: inserted, error } = await admin.from("trips").insert(row).select("id").single();
  if (error) return json({ error: "Trip save failed: " + error.message }, 500);

  return json({ id: inserted.id, created: true });
});
