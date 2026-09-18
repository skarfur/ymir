import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports members.gs's getDailyLog_ — the daily_log row for a date, with its
// `activities` field replaced by the concrete (non-signup) activities rows
// for that date, JSON-stringified (matching the frontend contract:
// dailylog.js's applyLogData expects `log.activities` as a JSON string,
// same as the Sheets version produced).
//
// Deliberately stubbed: scheduledActivities (projected/virtual activities
// from activity-type bulk schedules that haven't been materialized yet —
// config.gs's projectActivitiesForDate_). That depends on activity
// templates + bulk-schedule expansion logic not ported yet, and
// activities/app_config's activity_templates are both empty regardless,
// so there's nothing to project. Returns [] rather than faking it.
//
// Requires a valid session — getDailyLog isn't in Apps Script's
// PUBLIC_ACTIONS_ either.
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

  const date = body?.date ? String(body.date).trim() : new Date().toISOString().slice(0, 10);

  const { data: log } = await admin.from("daily_log").select("*").eq("date", date).maybeSingle();

  const { data: activityRows } = await admin
    .from("activities")
    .select("*")
    .eq("daily_log_date", date)
    .eq("signup_required", false);

  const logDto = log ? { ...log, activities: JSON.stringify(activityRows || []) } : null;

  return json({ log: logDto, date, scheduledActivities: [] });
});
