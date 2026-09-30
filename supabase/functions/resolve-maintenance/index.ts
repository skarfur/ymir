import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

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

  const id = body?.id ? String(body.id) : "";
  if (!id) return json({ error: "id required" }, 400);

  // resolved_by is a display name (see 20260929110000). Callers send
  // `resolvedBy`; the shared detail modal historically sent `by`. Fall back
  // to the session member's own name.
  let resolvedBy = String(body?.resolvedBy || body?.by || "").trim();
  if (!resolvedBy && session.memberId) {
    const { data: m } = await admin.from("members").select("name").eq("id", session.memberId).maybeSingle();
    resolvedBy = m?.name || "";
  }

  const ts = new Date().toISOString();
  const { data: updated, error } = await admin.from("maintenance").update({
    resolved: true, resolved_by: resolvedBy, resolved_at: ts, updated_at: ts,
  }).eq("id", id).select("id");
  if (error) return json({ error: "Resolve failed: " + error.message }, 500);
  if (!updated || !updated.length) return json({ error: "Maintenance request not found" }, 404);

  return json({ resolved: true });
});
