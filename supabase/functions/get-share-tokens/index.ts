import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports share.gs's getShareTokens_ — filter share_tokens by
// member_kennitala directly (see create-share-token's header for why the
// id column and this denormalized field exist). Translates the raw
// snake_case rows into the camelCase DTO logbook-share.js reads
// (cutOffDate, accessCount, revokedAt, ...) — the row was previously
// spread as-is, the same read-DTO bug fixed everywhere else this
// session.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function toDto(t: any) {
  return {
    id: t.id,
    memberId: t.member_id || "",
    memberKennitala: t.member_kennitala || "",
    cutOffDate: t.cut_off_date || "",
    createdAt: t.created_at,
    revokedAt: t.revoked_at || "",
    accessCount: t.access_count || 0,
    lastAccessedAt: t.last_accessed_at || "",
    includePhotos: !!t.include_photos,
    includeTracks: !!t.include_tracks,
    categories: t.categories || [],
  };
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

  const { data: tokens, error } = await admin.from("share_tokens").select("*").eq("member_kennitala", kennitala);
  if (error) return json({ error: "Share tokens lookup failed" }, 500);

  return json({ tokens: (tokens || []).map(toDto) });
});
