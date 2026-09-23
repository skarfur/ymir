import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports public.gs's deleteVolunteerEvent_ — any authenticated session
// (same as saveVolunteerEvent). Hard-deletes the activities row;
// volunteer_signups rows for it cascade automatically (event_id has
// ON DELETE CASCADE — see scheduling_and_audit's volunteer_signups
// table). Google Calendar cleanup (deleteVolunteerEventCalendarEvent_)
// is deliberately not ported, same deferral as every other
// Calendar-touching write.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: unknown) => { const s = v ? String(v) : ""; return s && UUID_RE.test(s) ? s : null; };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const bodyId = body?.id ? String(body.id) : "";
  if (!bodyId) return json({ deleted: true });

  // A stale local copy can still carry a virtual 'vae-...' id (e.g. the
  // client's merge of saved + virtual events hadn't caught up to a
  // signup-triggered materialization) — that's never a real activities.id,
  // so eq("id", ...) against it would either match nothing or, before the
  // asUuid guard, throw a uuid-cast error. Resolve to the real row by
  // source template + date when the id itself isn't a valid uuid, same
  // fallback save-volunteer-event/volunteer-signup use.
  let id = asUuid(bodyId);
  if (!id && bodyId.indexOf("vae-") === 0 && body?.sourceActivityTypeId && body?.date) {
    const sourceActivityTypeId = asUuid(body.sourceActivityTypeId);
    const dateIso = String(body.date);
    if (sourceActivityTypeId) {
      const { data: row } = await admin.from("activities").select("id")
        .eq("source_activity_type_id", sourceActivityTypeId).eq("date", dateIso).maybeSingle();
      if (row) id = row.id;
    }
  }
  // Nothing real to delete (a virtual occurrence that was never
  // materialized, or an id that resolved to no matching row) — not an
  // error, just nothing to do.
  if (!id) return json({ deleted: true });

  const { error } = await admin.from("activities").delete().eq("id", id).eq("signup_required", true);
  if (error) return json({ error: "deleteVolunteerEvent failed: " + error.message }, 500);

  return json({ deleted: true });
});
