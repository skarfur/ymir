import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports handbook.gs's saveHandbookDoc_ — admin only.
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

async function saveConfigListItem(admin: any, key: string, patch: Record<string, unknown>) {
  const arr = await readConfigList(admin, key);
  const ts = new Date().toISOString();
  const idx = patch?.id ? arr.findIndex((x: any) => x && x.id === patch.id) : -1;
  let item: any, created = false;
  if (idx >= 0) {
    item = { ...arr[idx], ...patch, updatedAt: ts };
    arr[idx] = item;
  } else {
    const newId = patch?.id || crypto.randomUUID();
    item = { ...patch, id: newId, createdAt: ts, updatedAt: ts };
    arr.push(item);
    created = true;
  }
  await admin.from("app_config").upsert({ key, value: arr, updated_at: ts }, { onConflict: "key" });
  return { id: item.id, item, created };
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

  if (!body?.title) return json({ error: "title required" }, 400);
  if (!body?.url) return json({ error: "url required" }, 400);

  const res = await saveConfigListItem(admin, "handbookDocs", {
    id: body?.id || "",
    category: body?.category || "",
    categoryIS: body?.categoryIS || "",
    title: body?.title || "",
    titleIS: body?.titleIS || "",
    url: body?.url || "",
    driveFileId: body?.driveFileId || "",
    notes: body?.notes || "",
    notesIS: body?.notesIS || "",
    sortOrder: Number(body?.sortOrder || 0),
    active: body?.active === false ? false : true,
  });

  return json({ id: res.id, saved: true });
});
