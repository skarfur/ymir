import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports incidents.gs's getIncidents_ — optional filter by event date
// (falling back to filed_at when date is unset, matching the Sheets
// version's date-or-filedAt/createdAt fallback). Translates the raw
// snake_case rows into the camelCase DTO incidents.js/dailylog.js read
// (i.locationName, i.handOffTo, i.filedBy, ...), the same read-DTO bug
// pattern fixed everywhere else this session.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function toDto(i: any) {
  return {
    id: i.id,
    types: JSON.stringify(i.types || []),
    severity: i.severity || "",
    date: i.date || "",
    time: i.time || "",
    locationId: i.location_id || "",
    locationName: i.location_name || "",
    boatId: i.boat_id || "",
    boatName: i.boat_name || "",
    description: i.description || "",
    involved: i.involved || "",
    witnesses: i.witnesses || "",
    immediateAction: i.immediate_action || "",
    followUp: i.follow_up || "",
    handOffTo: i.hand_off_to || "",
    handOffName: i.hand_off_name || "",
    handOffNotes: i.hand_off_notes || "",
    photoUrls: JSON.stringify(i.photo_urls || []),
    filedBy: i.filed_by || "",
    filedAt: i.filed_at || "",
    resolved: !!i.resolved,
    resolvedAt: i.resolved_at || "",
    staffNotes: i.staff_notes || "[]",
    reviewerNotes: i.reviewer_notes || "[]",
    status: i.status || "closed",
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

  const { data: all, error } = await admin.from("incidents").select("*");
  if (error) return json({ error: "Incidents lookup failed" }, 500);

  const date = body?.date ? String(body.date).slice(0, 10) : "";
  if (!date) return json({ incidents: (all || []).map(toDto) });

  const incidents = (all || []).filter((i) => {
    const ev = String(i.date || "").slice(0, 10) || String(i.filed_at || "").slice(0, 10);
    return ev === date;
  }).map(toDto);
  return json({ incidents });
});
