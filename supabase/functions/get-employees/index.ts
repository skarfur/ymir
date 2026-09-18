import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports payroll.gs's getEmployees_ — a plain readAll_(TABS_.employees) in
// the Sheets version. Translates this table's snake_case shape back into
// the camelCase shape SCHEMA_.employees defines.
//
// Contains real financial/PII fields (bank account, kennitala via kt,
// base pay rate) — same sensitivity level as get-members, and same note
// applies: not role-gated in either version (getEmployees isn't in
// code.gs's ADMIN_ACTIONS_/STAFF_ACTIONS_), any authenticated session can
// call it today. Worth closing before real payroll data goes in.
//
// Requires a valid session — getEmployees isn't in Apps Script's
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

  const { data: all, error } = await admin.from("employees").select("*");
  if (error) return json({ error: "Employees lookup failed" }, 500);

  const employees = (all || []).map((e) => ({
    id: e.id,
    kt: e.kt || "",
    name: e.name,
    title: e.title || "",
    bankAccount: e.bank_account || "",
    orlofsreikningur: e.orlofsreikningur || "",
    baseRateKr: e.base_rate_kr,
    union: e.union_name || "",
    lifeyrir: e.lifeyrir || "",
    sereignarsjodur: e.sereignarsjodur || "",
    otherWithholdings: e.other_withholdings || null,
    active: e.active,
    startDate: e.start_date,
    memberId: e.member_id,
    payrollEnabled: e.payroll_enabled,
  }));

  return json({ employees });
});
