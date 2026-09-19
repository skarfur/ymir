import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports incidents.gs's createIncident_ — any authenticated session (it's
// called from both the incidents portal and the member hub's self-report
// flow, so it can't be staff-gated). Normalizes `types` to a clean JSON
// string the same way the original did (the client sends
// JSON.stringify([...]) already, so re-stringifying a parsed value avoids
// double-encoding). photoUrls is always stored empty here, matching the
// Apps Script version — no upload path feeds this field from either
// caller, consistent with Drive uploads staying out of scope everywhere
// else this migration.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const ts = new Date().toISOString();

  let typesJson: unknown[] = [];
  if (Array.isArray(body?.types)) {
    typesJson = body.types as unknown[];
  } else if (typeof body?.types === "string" && body.types) {
    try {
      const parsed = JSON.parse(body.types as string);
      typesJson = Array.isArray(parsed) ? parsed : [];
    } catch { typesJson = []; }
  }

  const locationIdIn = body?.locationId ? String(body.locationId) : "";
  const boatIdIn = body?.boatId ? String(body.boatId) : "";

  const { data: inserted, error } = await admin.from("incidents").insert({
    types: typesJson,
    severity: String(body?.severity || "minor"),
    date: body?.date ? String(body.date) : ts.slice(0, 10),
    time: body?.time ? String(body.time) : ts.slice(11, 16),
    location_id: locationIdIn && UUID_RE.test(locationIdIn) ? locationIdIn : null,
    location_name: String(body?.locationName || ""),
    boat_id: boatIdIn && UUID_RE.test(boatIdIn) ? boatIdIn : null,
    boat_name: String(body?.boatName || ""),
    description: String(body?.description == null ? "" : body.description),
    involved: String(body?.involved || ""),
    witnesses: String(body?.witnesses || ""),
    immediate_action: String(body?.immediateAction || ""),
    follow_up: String(body?.followUp || ""),
    hand_off_to: String(body?.handOffTo || ""),
    hand_off_name: String(body?.handOffName || ""),
    hand_off_notes: String(body?.handOffNotes || ""),
    photo_urls: [],
    filed_by: String(body?.filedBy || ""),
    filed_at: ts,
    resolved: !!body?.resolved,
    resolved_at: body?.resolved ? ts : null,
    staff_notes: "",
    reviewer_notes: "",
    status: body?.status === "review" ? "review" : "closed",
  }).select("id").single();
  if (error) return json({ error: "Incident save failed: " + error.message }, 500);

  return json({ id: inserted.id, created: true });
});
