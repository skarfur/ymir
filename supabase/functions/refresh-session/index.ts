import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession, mintAccessToken } from "../_shared/session.ts";

// Re-mints a fresh signed accessToken from a still-valid opaque
// sessionToken — replaces code.gs's touchSession_ sliding-window renewal
// (a JWT's own exp can't silently extend itself the way an opaque
// session's expiry could, so the frontend calls this periodically —
// on load and every ~30 min — instead). resolveSession already extends
// last_seen_at and rejects an expired/unknown token exactly as it does
// for every other Edge Function call.
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

  const { data: row } = await admin.from("sessions").select("expires_at").eq("id", session.sessionId).maybeSingle();
  if (!row) return json({ error: "Unauthorized" }, 401);

  const accessToken = await mintAccessToken(session, new Date(row.expires_at));
  return json({ accessToken, expiresAt: row.expires_at });
});
