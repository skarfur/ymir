import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports payroll.gs's saveEmployee_ — admin only (ADMIN_ACTIONS_ in
// code.gs). id present -> patch only supplied fields; otherwise insert.
// admin/payroll/payroll.js's prSaveEmployee only ever sends
// {id, memberId, name, kt, title, payrollEnabled} — the other columns
// (bankAccount, baseRateKr, union, ...) have no edit UI and stay at
// their insert-time defaults, matching the Sheets version's blank-cell
// behavior for fields the client never sends.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: unknown) => { const s = v ? String(v) : ""; return s && UUID_RE.test(s) ? s : null; };

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

  const { data: existing } = await admin.from("employees").select("id").eq("id", id).maybeSingle();

  if (existing) {
    const updates: Record<string, unknown> = {};
    if (body.kt !== undefined) updates.kt = body.kt;
    if (body.name !== undefined) updates.name = body.name;
    if (body.title !== undefined) updates.title = body.title;
    if (body.bankAccount !== undefined) updates.bank_account = body.bankAccount;
    if (body.orlofsreikningur !== undefined) updates.orlofsreikningur = body.orlofsreikningur;
    if (body.baseRateKr !== undefined) updates.base_rate_kr = body.baseRateKr;
    if (body.union !== undefined) updates.union_name = body.union;
    if (body.lifeyrir !== undefined) updates.lifeyrir = body.lifeyrir;
    if (body.sereignarsjodur !== undefined) updates.sereignarsjodur = body.sereignarsjodur;
    if (body.otherWithholdings !== undefined) updates.other_withholdings = body.otherWithholdings;
    if (body.active !== undefined) updates.active = body.active === true || body.active === "true";
    if (body.startDate !== undefined) updates.start_date = body.startDate || null;
    if (body.memberId !== undefined) updates.member_id = asUuid(body.memberId);
    if (body.payrollEnabled !== undefined) updates.payroll_enabled = body.payrollEnabled === true || body.payrollEnabled === "true";

    if (Object.keys(updates).length) {
      const { error } = await admin.from("employees").update(updates).eq("id", id);
      if (error) return json({ error: "saveEmployee failed: " + error.message }, 500);
    }
    return json({ saved: true });
  }

  const { error } = await admin.from("employees").insert({
    id,
    member_id: asUuid(body?.memberId),
    kt: body?.kt || "",
    name: String(body?.name || ""),
    title: body?.title || "",
    bank_account: body?.bankAccount || "",
    orlofsreikningur: body?.orlofsreikningur || "",
    base_rate_kr: body?.baseRateKr ?? null,
    union_name: body?.union || "",
    lifeyrir: body?.lifeyrir || "",
    sereignarsjodur: body?.sereignarsjodur || "",
    other_withholdings: body?.otherWithholdings || [],
    active: body?.active === true || body?.active === "true",
    start_date: body?.startDate || null,
    payroll_enabled: body?.payrollEnabled === true || body?.payrollEnabled === "true",
  });
  if (error) return json({ error: "saveEmployee failed: " + error.message }, 500);

  return json({ saved: true });
});
