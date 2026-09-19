import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports handbook.gs's reorderHandbookRoles_ — admin only. Bulk-updates
// sortOrder on a set of roles (admin reorder arrows); members/areas stay
// untouched.
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

  let items = body?.items;
  if (typeof items === "string") {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  if (!Array.isArray(items)) return json({ error: "items required" }, 400);

  const { data } = await admin.from("app_config").select("value").eq("key", "handbookRoles").maybeSingle();
  const arr: any[] = Array.isArray(data?.value) ? data.value : [];
  const ts = new Date().toISOString();
  let updated = 0;
  items.forEach((it: any) => {
    if (!it || !it.id) return;
    const idx = arr.findIndex((x) => x && x.id === it.id);
    if (idx < 0) return;
    arr[idx].sortOrder = Number(it.sortOrder || 0);
    arr[idx].updatedAt = ts;
    updated++;
  });

  if (updated) {
    await admin.from("app_config").upsert({ key: "handbookRoles", value: arr, updated_at: ts }, { onConflict: "key" });
  }

  return json({ updated });
});
