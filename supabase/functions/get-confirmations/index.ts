import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";
import { buildConfirmations } from "../_shared/confirmations.ts";

// Ports trips.gs's getConfirmations_. Query + DTO logic live in
// _shared/confirmations.ts (shared with get-verification-requests) so
// get-captain-bundle can pull the same read into its combined response
// without duplicating it.

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

  const kennitala = body?.kennitala ? String(body.kennitala).trim() : "";
  if (!kennitala) return json({ error: "kennitala required" }, 400);

  try {
    return json(await buildConfirmations(admin, kennitala));
  } catch (e) {
    return json({ error: (e as Error).message || "Confirmations lookup failed" }, 500);
  }
});
