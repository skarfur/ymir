import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports scheduling.gs's getActivityLog_ — date range (default: 90 days
// before `to`, capped at 366 days span) + optional activityTypeId/classTag
// filter over the activities table.
//
// Simplified vs the original: activity_listLog_'s full DTO shape (with
// classTag/classTagIS enrichment, runNotes, etc.) isn't fully replicated
// field-by-field — this returns the raw activities rows matching the
// filters. activities has zero rows regardless, so there's nothing to
// verify the full DTO shape against yet; revisit once real activity data
// exists and this is actually rendering something.
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

  const to = body?.to ? String(body.to).trim() : new Date().toISOString().slice(0, 10);
  let from = body?.from ? String(body.from).trim() : "";
  if (!from) {
    const d = new Date(to + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 90);
    from = d.toISOString().slice(0, 10);
  }
  const spanDays = Math.round((new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86400000);
  if (spanDays > 366) {
    const capped = new Date(to + "T00:00:00Z");
    capped.setUTCDate(capped.getUTCDate() - 366);
    from = capped.toISOString().slice(0, 10);
  }

  const activityTypeId = body?.activityTypeId ? String(body.activityTypeId) : "";

  const { data: all, error } = await admin
    .from("activities")
    .select("*")
    .gte("date", from)
    .lte("date", to);
  if (error) return json({ error: "Activity log lookup failed" }, 500);

  const activities = activityTypeId
    ? (all || []).filter((r) => r.activity_type_id === activityTypeId)
    : (all || []);

  return json({ activities, from, to });
});
