import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports payroll.gs's getTimeEntries_ — filters by employeeId and/or
// period (period_key) only, matching the original exactly; admin/
// payroll.js also sends from/to but the Apps Script version never read
// them either. Called via apiGet, but routes through the same
// _SUPABASE_ACTIONS dispatch as any apiPost action (see shared/api.js's
// _call).
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

  let query = admin.from("time_clock").select("*");
  if (body?.employeeId) query = query.eq("employee_id", String(body.employeeId));
  if (body?.period) query = query.eq("period_key", String(body.period));
  const { data: rows, error } = await query;
  if (error) return json({ error: "Time entries lookup failed" }, 500);

  const entries = (rows || []).map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    type: r.type,
    timestamp: r.ts,
    source: r.source || "",
    originalTimestamp: r.original_ts || "",
    note: r.note || "",
    periodKey: r.period_key || "",
    durationMinutes: r.duration_minutes || 0,
  }));

  return json({ entries });
});
