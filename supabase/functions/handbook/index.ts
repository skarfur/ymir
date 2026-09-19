import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports handbook.gs's getHandbook_ (read path only). Storage moves from
// Sheets config-sheet JSON strings under 'handbookRoles'/'handbookContacts'/
// 'handbookDocs'/'handbookInfo' keys to jsonb values in app_config under the
// same keys — same shape, natively typed instead of stringified.
//
// The write side (saveHandbookRole_/deleteHandbookRole_/
// reorderHandbookRoles_/saveHandbookContact_/deleteHandbookContact_/
// saveHandbookDoc_/deleteHandbookDoc_/saveHandbookInfo_/
// deleteHandbookInfo_) lives in save-handbook-role, delete-handbook-role,
// reorder-handbook-roles, save-handbook-contact, delete-handbook-contact,
// save-handbook-doc, delete-handbook-doc, save-handbook-info, and
// delete-handbook-info.
//
// Deliberately NOT ported: syncHandbookDocs_/uploadHandbookDoc_ (Drive
// integration, out of scope everywhere this migration) and
// boat-category color hydration on roles (_hbBoatCatColorMap_) — needs
// 'boatCategories' in app_config, which isn't seeded/ported yet either.
// Requires a valid session — getHandbook isn't in Apps Script's
// PUBLIC_ACTIONS_ either.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function isActive(r: any): boolean {
  return !!(r && r.active);
}

function byOrder(a: any, b: any): number {
  const ao = Number(a.sortOrder || 0), bo = Number(b.sortOrder || 0);
  if (ao !== bo) return ao - bo;
  return String(a.title || "").localeCompare(String(b.title || ""));
}

function coerceArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function hydrateMembers(r: any, memberByKt: Record<string, any>): any[] {
  let arr = coerceArray(r.members);
  if (!arr.length) {
    if (r.kennitala || r.name) {
      arr = [{ kennitala: r.kennitala || "", label: "", labelIS: "" }];
    } else {
      return [];
    }
  }
  return arr
    .map((a: any, i: number) => {
      const m = a.kennitala ? memberByKt[String(a.kennitala).trim()] : null;
      return {
        kennitala: a.kennitala || "",
        label: a.label || "",
        labelIS: a.labelIS || "",
        representsRoleId: a.representsRoleId || "",
        areaId: a.areaId || "",
        sortOrder: a.sortOrder == null ? i : Number(a.sortOrder),
        name: m ? m.name || "" : a.kennitala ? "" : r.name || "",
        phone: m ? m.phone || "" : r.phone || "",
        email: m ? m.email || "" : r.email || "",
      };
    })
    .sort((a: any, b: any) => a.sortOrder - b.sortOrder);
}

function parseAreas(r: any): any[] {
  const arr = coerceArray(r.areas);
  return arr
    .filter((a: any) => a && a.id)
    .map((a: any, i: number) => ({
      id: String(a.id),
      label: a.label || "",
      labelIS: a.labelIS || "",
      sortOrder: a.sortOrder == null ? i : Number(a.sortOrder),
    }))
    .sort((a: any, b: any) => a.sortOrder - b.sortOrder);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { data: configRows, error: configError } = await admin
    .from("app_config")
    .select("key, value")
    .in("key", ["handbookRoles", "handbookContacts", "handbookDocs", "handbookInfo"]);
  if (configError) return json({ error: "Config lookup failed" }, 500);

  const configMap: Record<string, any> = {};
  (configRows || []).forEach((r) => { configMap[r.key] = r.value; });

  const rolesRaw = coerceArray(configMap.handbookRoles).filter(isActive);
  const contactsRaw = coerceArray(configMap.handbookContacts).filter(isActive);
  const docs = coerceArray(configMap.handbookDocs).filter(isActive).sort(byOrder);
  const info = coerceArray(configMap.handbookInfo).filter(isActive).sort(byOrder);

  const { data: members, error: membersError } = await admin
    .from("members")
    .select("kennitala, name, phone, email");
  if (membersError) return json({ error: "Member lookup failed" }, 500);

  const memberByKt: Record<string, any> = {};
  (members || []).forEach((m) => { memberByKt[m.kennitala] = m; });

  const roles = rolesRaw
    .map((r: any) => ({
      ...r,
      members: hydrateMembers(r, memberByKt),
      areas: parseAreas(r),
    }))
    .sort(byOrder);

  const contacts = contactsRaw
    .map((c: any) => {
      const m = c.memberId ? memberByKt[String(c.memberId).trim()] : null;
      if (!m) return c;
      return {
        ...c,
        name: c.name || m.name || "",
        phone: c.phone || m.phone || "",
        email: c.email || m.email || "",
      };
    })
    .sort(byOrder);

  return json({ roles, contacts, docs, info });
});
