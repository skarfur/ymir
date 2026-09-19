import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports passport.gs's revokePassportSignoff_ — any authenticated session
// (the original has no signer-authorization check beyond a valid
// session; the UI only exposes the revoke action to certain views).
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

  const signoffId = body?.signoffId ? String(body.signoffId) : "";
  if (!signoffId) return json({ error: "signoffId required" }, 400);

  const { data, error } = await admin.from("passport_signoffs").update({
    revoked_by: String(body?.revokedBy || ""),
    revoked_at: new Date().toISOString(),
    revoke_reason: String(body?.reason || ""),
  }).eq("id", signoffId).select("id");
  if (error) return json({ error: "revokePassportSignoff failed: " + error.message }, 500);
  if (!data || !data.length) return json({ error: "Sign-off not found" }, 404);

  return json({ revoked: true });
});
