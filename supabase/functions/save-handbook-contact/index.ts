import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports handbook.gs's saveHandbookContact_ — admin only (ADMIN_ACTIONS_ in
// code.gs). Handbook lists (roles/contacts/docs/info) are jsonb arrays
// under app_config keys, same shape as the Sheets config-sheet JSON
// strings (see the handbook read function's header) — this ports
// config.gs's saveConfigListItem_ generic primitive inline since there's
// no shared module between Edge Functions here.
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

  if (!body?.label && !body?.labelIS) return json({ error: "label required" }, 400);

  const res = await saveConfigListItem(admin, "handbookContacts", {
    id: body?.id || "",
    memberId: body?.memberId || "",
    label: body?.label || "",
    labelIS: body?.labelIS || "",
    name: body?.name || "",
    phone: body?.phone || "",
    email: body?.email || "",
    notes: body?.notes || "",
    notesIS: body?.notesIS || "",
    sortOrder: Number(body?.sortOrder || 0),
    active: body?.active === false ? false : true,
  });

  return json({ id: res.id, saved: true });
});
