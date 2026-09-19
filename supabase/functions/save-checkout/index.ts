import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's saveCheckout_ — single-boat checkout. Callable by any
// authenticated member (self-checkout from member/, or staff/ on someone's
// behalf) — not staff-gated, matching the original (not in STAFF_ACTIONS_).
//
// Deliberately stubbed: the controlled-access boat gate (accessMode/
// accessGate/accessAllowlist/reservations/slotSchedulingEnabled, checked
// against config.gs's cert-gate helpers). The boats table only carries
// id/name/category/active so far — none of those access-control fields
// have been migrated — and boats has zero rows regardless (no real fleet
// data imported yet), so there's nothing to gate against. Revisit once
// real boat data + access rules are ported.
//
// boat_id/location_id are resolved best-effort against the (currently
// empty) boats/locations tables — a miss, a non-uuid id, or a nonClub
// (BYO boat) checkout all just leave the FK null. boat_name/boat_category/
// location_name are always stored directly (as the Sheets version did) so
// the checkout renders correctly either way.
//
// memberPhone/memberIsMinor/guardianName/guardianPhone are computed
// server-side from members+guardians — client-sent values for these fields
// are ignored, mirroring the original (saveCheckout_ never reads
// b.memberPhone/b.memberIsMinor/etc, only getMemberMap_()[kt]).

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseWx(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const w = (typeof raw === "string" ? JSON.parse(raw) : raw) as any;
    const wsVal = (typeof w.ws === "string" && w.ws.indexOf("-") !== -1) ? w.ws : (w.ws != null ? Math.round(w.ws) : 0);
    return {
      bft: Math.round(w.bft || 0), ws: wsVal, wg: Math.round(w.wg || 0),
      dir: w.dir || w.wDir || "",
      wv: w.wv != null ? Math.round(w.wv * 10) / 10 : (w.waveH != null ? Math.round(parseFloat(w.waveH) * 10) / 10 : null),
      flag: w.flag || w.flagKey || "",
      tc: w.tc != null ? Math.round(w.tc) : (w.airT != null ? Math.round(w.airT) : null),
      ts: w.ts || new Date().toISOString(),
    };
  } catch { return null; }
}

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function timeToTimestamptz(hhmm: unknown, dateISO: string): string | null {
  if (!hhmm) return null;
  const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${dateISO}T${m[1].padStart(2, "0")}:${m[2]}:00Z`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const kt = String(body?.memberKennitala || body?.memberKt || body?.kennitala || "").trim();
  if (!kt) return json({ error: "memberKennitala required" }, 400);

  const { data: member } = await admin.from("members").select("id, phone, birth_year").eq("kennitala", kt).maybeSingle();
  if (!member) return json({ error: "Member not found" }, 400);

  let guardianName = "", guardianPhone = "";
  const { data: guardian } = await admin.from("guardians").select("name, phone").eq("member_id", member.id).limit(1).maybeSingle();
  if (guardian) { guardianName = guardian.name || ""; guardianPhone = guardian.phone || ""; }
  const currentYear = new Date().getUTCFullYear();
  const isMinor = !!(member.birth_year && currentYear - member.birth_year < 18);

  const nonClub = !!body?.nonClub;
  const boatIdIn = nonClub ? "" : String(body?.boatId || "");
  let boat_id: string | null = null;
  if (boatIdIn && UUID_RE.test(boatIdIn)) {
    const { data: boat } = await admin.from("boats").select("id").eq("id", boatIdIn).maybeSingle();
    if (boat) boat_id = boat.id;
  }
  const locationIdIn = nonClub ? "" : String(body?.locationId || "");
  let location_id: string | null = null;
  if (locationIdIn && UUID_RE.test(locationIdIn)) {
    const { data: loc } = await admin.from("locations").select("id").eq("id", locationIdIn).maybeSingle();
    if (loc) location_id = loc.id;
  }

  let crewNames: unknown[] = [];
  if (body?.crewNames) {
    try {
      const p = typeof body.crewNames === "string" ? JSON.parse(body.crewNames as string) : body.crewNames;
      if (Array.isArray(p)) crewNames = p;
    } catch { /* ignore malformed crewNames */ }
  }

  let preLaunchChecklist: unknown = null;
  if (body?.preLaunchChecklist) {
    try { preLaunchChecklist = typeof body.preLaunchChecklist === "string" ? JSON.parse(body.preLaunchChecklist as string) : body.preLaunchChecklist; } catch { /* ignore */ }
  }

  const date = todayUtc();
  const row: Record<string, unknown> = {
    member_id: member.id,
    member_kennitala: kt,
    member_name: String(body?.memberName || ""),
    boat_id,
    boat_name: String(body?.boatName || ""),
    boat_category: String(body?.boatCategory || ""),
    location_id,
    location_name: String(body?.locationName || ""),
    crew_count: parseInt(String(body?.crew || "1"), 10) || 1,
    crew: crewNames,
    expected_return: timeToTimestamptz(body?.expectedReturn, date) || timeToTimestamptz(body?.returnBy, date),
    wx_snapshot: parseWx(body?.wxSnapshot),
    pre_launch_checklist: preLaunchChecklist,
    notes: String(body?.notes || ""),
    status: "out",
    departure_port: String(body?.departurePort || ""),
    non_club: nonClub,
    member_phone: member.phone || "",
    member_is_minor: isMinor,
    guardian_name: guardianName,
    guardian_phone: guardianPhone,
    actor_id: session.memberId,
  };
  const checkedOutAt = timeToTimestamptz(body?.checkedOutAt, date) || timeToTimestamptz(body?.timeOut, date);
  if (checkedOutAt) row.checked_out_at = checkedOutAt;

  const { data: inserted, error } = await admin.from("checkouts").insert(row).select("id").single();
  if (error) return json({ error: "Checkout save failed: " + error.message }, 500);

  return json({ id: inserted.id, created: true });
});
