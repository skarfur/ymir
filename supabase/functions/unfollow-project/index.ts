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
  const kennitala = body?.kennitala ? String(body.kennitala) : "";
  if (!kennitala) return json({ error: "kennitala required" }, 400);

  const { data: ex } = await admin.from("maintenance").select("followers").eq("id", id).maybeSingle();
  if (!ex) return json({ error: "Request not found" }, 404);

  const followers: any[] = (Array.isArray(ex.followers) ? ex.followers : []).filter((f: any) => String(f.kt) !== kennitala);

  const { error } = await admin.from("maintenance").update({ followers }).eq("id", id);
  if (error) return json({ error: "Unfollow failed: " + error.message }, 500);

  return json({ unfollowed: true });
});
