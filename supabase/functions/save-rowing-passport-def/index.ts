import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports passport.gs's saveRowingPassportDef_ — admin only (ADMIN_ACTIONS_
// in code.gs). Stores the definition as jsonb directly under app_config's
// 'rowingPassport' key, natively typed instead of a stringified cell.
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
  if (session.role !== "admin") return json({ error: "Admin only" }, 403);

  let def = body?.definition;
  if (typeof def === "string") {
    try { def = JSON.parse(def); } catch { return json({ error: "definition must be valid JSON" }, 400); }
  }
  if (!def) return json({ error: "definition required" }, 400);
  if (!Array.isArray((def as any).passports)) return json({ error: "definition.passports must be array" }, 400);

  const { error } = await admin.from("app_config")
    .upsert({ key: "rowingPassport", value: def, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return json({ error: "saveRowingPassportDef failed: " + error.message }, 500);

  return json({ saved: true });
});
