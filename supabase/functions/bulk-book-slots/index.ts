import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's bulkBookSlots_. Any authenticated session.
// Deliberately stubbed: the keelboat cert-access gate — see book-slot's
// header (same deferral, same reason).
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

  const boatId = body?.boatId ? String(body.boatId) : "";
  if (!boatId) return json({ error: "boatId required" }, 400);
  const fromDate = body?.fromDate ? String(body.fromDate) : "";
  const toDate = body?.toDate ? String(body.toDate) : "";
  if (!fromDate || !toDate) return json({ error: "fromDate and toDate required" }, 400);
  const daysOfWeek = body?.daysOfWeek;
  if (!Array.isArray(daysOfWeek) || !daysOfWeek.length) return json({ error: "daysOfWeek required (array of 0-6)" }, 400);
  const kennitala = body?.kennitala ? String(body.kennitala) : "";
  if (!kennitala) return json({ error: "kennitala required" }, 400);

  const { data: boat } = await admin.from("boats").select("*").eq("id", boatId).maybeSingle();
  if (!boat) return json({ error: "Boat not found" }, 404);

  const updates: Record<string, unknown> = {
    booked_by_kennitala: null, booked_by_name: null, booked_by_crew_id: null,
    booking_color: String(body?.bookingColor || ""), tentative: false,
  };
  const crewId = body?.crewId ? String(body.crewId) : "";
  if (crewId) {
    const { data: crew } = await admin.from("crews").select("*").eq("id", crewId).maybeSingle();
    if (!crew || crew.status === "disbanded") return json({ error: "Crew not found or disbanded" }, 404);
    if (crew.status !== "active" && crew.status !== "forming") return json({ error: "Crew not found or not active" }, 400);
    const pairs: any[] = Array.isArray(crew.pairs) ? crew.pairs : [];
    const isMember = pairs.some((p) => (p.members || []).some((m: any) => m && String(m.kennitala) === kennitala));
    if (!isMember) return json({ error: "You are not a member of this crew" }, 400);
    updates.booked_by_crew_id = crewId;
    updates.booked_by_name = String(crew.name || body?.memberName || "");
    updates.booked_by_kennitala = kennitala;
    updates.tentative = crew.status === "forming";
  } else {
    updates.booked_by_kennitala = kennitala;
    updates.booked_by_name = String(body?.memberName || "");
  }

  const days = daysOfWeek.map(Number);
  const filterStart = body?.startTime ? String(body.startTime) : "";
  const filterEnd = body?.endTime ? String(body.endTime) : "";

  const { data: all, error: fetchErr } = await admin.from("reservation_slots").select("id, date, start_time, end_time, booked_by_kennitala")
    .eq("boat_id", boatId).gte("date", fromDate).lte("date", toDate);
  if (fetchErr) return json({ error: "Slots lookup failed" }, 500);

  let booked = 0, skipped = 0;
  for (const sl of all || []) {
    const slDate = new Date(sl.date + "T00:00:00Z");
    if (!days.includes(slDate.getUTCDay())) continue;
    if (filterStart && sl.start_time < filterStart) continue;
    if (filterEnd && sl.end_time > filterEnd) continue;
    if (sl.booked_by_kennitala) { skipped++; continue; }
    const { error } = await admin.from("reservation_slots").update(updates).eq("id", sl.id);
    if (!error) booked++;
  }

  return json({ success: true, booked, skipped });
});
