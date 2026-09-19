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
  const text = body?.text ? String(body.text) : "";
  if (!text) return json({ error: "text required" }, 400);

  const { data: ex } = await admin.from("maintenance").select("comments").eq("id", id).maybeSingle();
  if (!ex) return json({ error: "Request not found" }, 404);

  const comments: any[] = Array.isArray(ex.comments) ? ex.comments : [];
  const ts = new Date().toISOString();
  const entry: Record<string, unknown> = { by: String(body?.by || ""), at: ts, text };
  if (body?.photoUrl) entry.photoUrl = String(body.photoUrl);
  comments.push(entry);

  const { error } = await admin.from("maintenance").update({ comments, updated_at: ts }).eq("id", id);
  if (error) return json({ error: "Comment failed: " + error.message }, 500);

  return json({ commented: true });
});
