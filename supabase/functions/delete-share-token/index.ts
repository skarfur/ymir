import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports share.gs's deleteShareToken_ — any authenticated session, but
// only the token's own owner (memberKennitala match) may delete it.
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

  const tokenId = body?.tokenId ? String(body.tokenId) : "";
  const kennitala = body?.kennitala ? String(body.kennitala) : "";
  if (!tokenId) return json({ error: "tokenId required" }, 400);
  if (!kennitala) return json({ error: "kennitala required" }, 400);

  const { data: token } = await admin.from("share_tokens").select("id, member_kennitala").eq("id", tokenId).maybeSingle();
  if (!token) return json({ error: "Token not found" }, 404);
  if (String(token.member_kennitala) !== kennitala) return json({ error: "Not authorised" }, 403);

  const { error } = await admin.from("share_tokens").delete().eq("id", tokenId);
  if (error) return json({ error: "deleteShareToken failed: " + error.message }, 500);

  return json({ deleted: true });
});
