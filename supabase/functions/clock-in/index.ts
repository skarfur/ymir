import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports payroll.gs's clockIn_ — any authenticated session (employee
// self-service via the punch-clock widget).
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function periodKey(): string {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const employeeId = body?.employeeId ? String(body.employeeId) : "";
  if (!employeeId) return json({ error: "employeeId required" }, 400);

  const { data: entries } = await admin.from("time_clock").select("*")
    .eq("employee_id", employeeId).order("ts", { ascending: true });
  const ins = (entries || []).filter((r) => r.type === "in");
  const outs = (entries || []).filter((r) => r.type === "out");
  const lastIn = ins[ins.length - 1];
  const lastOut = outs[outs.length - 1];
  if (lastIn && (!lastOut || lastIn.ts > lastOut.ts)) {
    return json({ error: "Already clocked in since " + lastIn.ts }, 400);
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("time_clock").insert({
    id: crypto.randomUUID(), employee_id: employeeId, type: "in", ts: now,
    source: body?.source || "staff", original_ts: null,
    note: body?.note || "", period_key: periodKey(), duration_minutes: 0,
  });
  if (error) return json({ error: "clockIn failed: " + error.message }, 500);

  return json({ clocked: "in", timestamp: now });
});
