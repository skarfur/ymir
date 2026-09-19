import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's groupCheckIn_ + createSupervisorTripsForGroup_ —
// staff/admin only (matches STAFF_ACTIONS_.groupCheckIn). Flips the group
// checkout to 'in', then inserts one trip row per named staff member with a
// kennitala (role: 'supervisor') so supervising staff get sea-time credit —
// idempotent: skips any kennitala that already has a trip linked to this
// checkout id, same as the original.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function timeToTimestamptz(hhmm: unknown, dateISO: string): string | null {
  if (!hhmm) return null;
  const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${dateISO}T${m[1].padStart(2, "0")}:${m[2]}:00Z`;
}
function hhmm(ts: unknown): string {
  if (!ts) return "";
  const s = String(ts);
  return s.length >= 16 ? s.slice(11, 16) : "";
}
function toArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (!v) return [];
  try { const p = typeof v === "string" ? JSON.parse(v as string) : v; return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
}

async function createSupervisorTripsForGroup(
  admin: ReturnType<typeof createAdminClient>,
  checkoutId: string,
  checkedInAtTs: string,
  actorId: string,
): Promise<number> {
  const { data: co } = await admin.from("checkouts").select("*").eq("id", checkoutId).maybeSingle();
  if (!co) return 0;
  const staffNames = toArr(co.staff_names);
  const staffKennitalar = toArr(co.staff_kennitalar);
  if (!staffKennitalar.length) return 0;

  const { data: existing } = await admin.from("trips").select("member_kennitala").eq("linked_checkout_id", checkoutId);
  const seenKt = new Set((existing || []).map((t: any) => String(t.member_kennitala || "")).filter(Boolean));

  const timeOut = hhmm(co.checked_out_at);
  const timeIn = hhmm(checkedInAtTs);
  let hoursDecimal = 0;
  if (timeOut && timeIn) {
    const [oh, om] = timeOut.split(":").map(Number);
    const [ih, im] = timeIn.split(":").map(Number);
    let mins = (ih * 60 + im) - (oh * 60 + om);
    if (mins < 0) mins += 1440;
    hoursDecimal = Math.round((mins / 60) * 100) / 100;
  }
  const date = todayUtc();

  let n = 0;
  for (let i = 0; i < staffKennitalar.length; i++) {
    const kt = staffKennitalar[i].trim();
    if (!kt || seenKt.has(kt)) continue;
    const name = staffNames[i] || "";
    const { data: member } = await admin.from("members").select("id").eq("kennitala", kt).maybeSingle();
    const { error } = await admin.from("trips").insert({
      member_id: member ? member.id : null,
      member_kennitala: kt,
      member_name: name,
      date,
      time_out: timeToTimestamptz(timeOut, date),
      time_in: timeToTimestamptz(timeIn, date),
      hours_decimal: hoursDecimal,
      boat_id: co.boat_id,
      boat_name: co.boat_name || "",
      boat_category: co.boat_category || "",
      location_id: co.location_id,
      location_name: co.location_name || "",
      crew_count: co.crew_count || 0,
      role: "supervisor",
      wx_snapshot: co.wx_snapshot,
      notes: "",
      is_linked: true,
      linked_checkout_id: checkoutId,
      departure_port: co.departure_port || "",
      actor_id: actorId,
    });
    if (!error) n++;
  }
  return n;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (session.role !== "staff" && session.role !== "admin") return json({ error: "Staff only" }, 403);

  const id = body?.id ? String(body.id) : "";
  if (!id) return json({ error: "id required" }, 400);

  const date = todayUtc();
  const checkedInAtTs = timeToTimestamptz(body?.timeIn, date) || new Date().toISOString();

  const { error } = await admin.from("checkouts").update({
    status: "in",
    checked_in_at: checkedInAtTs,
    actor_id: session.memberId,
  }).eq("id", id);
  if (error) return json({ error: "Group check-in failed: " + error.message }, 500);

  let tripsCreated = 0;
  try {
    tripsCreated = await createSupervisorTripsForGroup(admin, id, checkedInAtTs, session.memberId);
  } catch { /* mirrors the original's try/catch — never blocks the check-in itself */ }

  return json({ updated: true, checkedInAt: checkedInAtTs.slice(11, 16), tripsCreated });
});
