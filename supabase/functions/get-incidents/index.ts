import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports incidents.gs's getIncidents_ — plain read, optional filter by
// event date (falling back to filed_at when date is unset, matching the
// Sheets version's date-or-filedAt/createdAt fallback).
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

  const { data: all, error } = await admin.from("incidents").select("*");
  if (error) return json({ error: "Incidents lookup failed" }, 500);

  const date = body?.date ? String(body.date).slice(0, 10) : "";
  if (!date) return json({ incidents: all || [] });

  const incidents = (all || []).filter((i) => {
    const ev = String(i.date || "").slice(0, 10) || String(i.filed_at || "").slice(0, 10);
    return ev === date;
  });
  return json({ incidents });
});
