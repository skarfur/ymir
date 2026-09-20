import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports payroll.gs's breakStart_ — any authenticated session.
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
  if (!lastIn || (lastOut && lastOut.ts > lastIn.ts)) {
    return json({ error: "Not clocked in" }, 400);
  }
  const brks = (entries || []).filter((r) => r.type === "break_start");
  const brkEs = (entries || []).filter((r) => r.type === "break_end");
  const lastBrk = brks[brks.length - 1];
  const lastBrkE = brkEs[brkEs.length - 1];
  if (lastBrk && (!lastBrkE || lastBrk.ts > lastBrkE.ts)) {
    return json({ error: "Already on break" }, 400);
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("time_clock").insert({
    id: crypto.randomUUID(), employee_id: employeeId, type: "break_start", ts: now,
    source: "staff", original_ts: null, note: body?.note || "",
    period_key: periodKey(), duration_minutes: 0,
  });
  if (error) return json({ error: "breakStart failed: " + error.message }, 500);

  return json({ type: "break_start", timestamp: now });
});
