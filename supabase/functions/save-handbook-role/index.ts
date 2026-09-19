import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports handbook.gs's saveHandbookRole_ — admin only. Normalizes members[]
// and areas[] the same way the original does: drops blank rows, keeps
// only persisted fields (hydrated name/phone/email never round-trip back
// into storage), and allocates area ids for entries sent without one.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function coerceArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  if (typeof raw === "string") {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
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

  if (!body?.title && !body?.titleIS) return json({ error: "title required" }, 400);

  let members: any[] = [];
  if (body?.members != null) {
    const arr = coerceArray(body.members);
    members = arr
      .filter((a: any) => a && (a.kennitala || a.label || a.labelIS))
      .map((a: any, i: number) => ({
        kennitala: String(a.kennitala || "").trim(),
        label: a.label || "",
        labelIS: a.labelIS || "",
        representsRoleId: a.representsRoleId || "",
        areaId: a.areaId || "",
        sortOrder: a.sortOrder == null ? i : Number(a.sortOrder),
      }));
  }

  let areas: any[] = [];
  if (body?.areas != null) {
    const aarr = coerceArray(body.areas);
    areas = aarr
      .filter((a: any) => a && (a.label || a.labelIS))
      .map((a: any, i: number) => ({
        id: a.id || ("area_" + crypto.randomUUID()),
        label: a.label || "",
        labelIS: a.labelIS || "",
        sortOrder: a.sortOrder == null ? i : Number(a.sortOrder),
      }));
  }

  const res = await saveConfigListItem(admin, "handbookRoles", {
    id: body?.id || "",
    parentId: body?.parentId || "",
    title: body?.title || "",
    titleIS: body?.titleIS || "",
    name: body?.name || "",
    kennitala: body?.kennitala || "",
    phone: body?.phone || "",
    email: body?.email || "",
    notes: body?.notes || "",
    notesIS: body?.notesIS || "",
    color: body?.color || "",
    boatCategoryKey: body?.boatCategoryKey || "",
    members,
    areas,
    sortOrder: Number(body?.sortOrder || 0),
    active: body?.active === false ? false : true,
  });

  return json({ id: res.id, saved: true });
});
