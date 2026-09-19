import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports share.gs's createShareToken_ — any authenticated session (members
// mint their own share links). The id is an 8-char base62 code (ported
// from code.gs's shareUid_), not a uuid — it's embedded directly in the
// public share URL (?share=<id>) and looked up as-is, see the
// share_tokens.id migration for why the column had to change type.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function shareUid(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const hex = crypto.randomUUID().replace(/-/g, "");
  let id = "";
  for (let i = 0; i < 8; i++) id += chars[parseInt(hex.substr(i * 2, 2), 16) % 62];
  return id;
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

  const { data: member } = await admin.from("members").select("id, kennitala").eq("kennitala", kennitala).maybeSingle();
  if (!member) return json({ error: "Member not found" }, 404);

  const id = shareUid();
  const ts = new Date().toISOString();
  let categories: unknown = body?.categories;
  if (typeof categories === "string" && categories) {
    try { categories = JSON.parse(categories); } catch { categories = []; }
  }

  const { error } = await admin.from("share_tokens").insert({
    id,
    member_id: member.id,
    member_kennitala: member.kennitala,
    cut_off_date: ts.slice(0, 10),
    revoked_at: null,
    access_count: 0,
    last_accessed_at: null,
    include_photos: body?.includePhotos !== false && body?.includePhotos !== "false",
    include_tracks: body?.includeTracks !== false && body?.includeTracks !== "false",
    categories: Array.isArray(categories) ? categories : [],
  });
  if (error) return json({ error: "createShareToken failed: " + error.message }, 500);

  return json({ id, created: true });
});
