import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports handbook.gs's deleteHandbookInfo_ — admin only.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

async function readConfigList(admin: any, key: string): Promise<any[]> {
  const { data } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
  return Array.isArray(data?.value) ? data.value : [];
}

async function softDeleteConfigListItem(admin: any, key: string, id: string): Promise<boolean> {
  const arr = await readConfigList(admin, key);
  const idx = arr.findIndex((x: any) => x && x.id === id);
  if (idx < 0) return false;
  arr[idx].active = false;
  arr[idx].updatedAt = new Date().toISOString();
  await admin.from("app_config").upsert({ key, value: arr, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return true;
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

  const id = body?.id ? String(body.id) : "";
  if (!id) return json({ error: "id required" }, 400);

  const ok = await softDeleteConfigListItem(admin, "handbookInfo", id);
  if (!ok) return json({ error: "Info section not found" }, 404);

  return json({ ok: true });
});
