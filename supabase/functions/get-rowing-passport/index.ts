import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports passport.gs's getRowingPassport_ + computePassportProgress_.
// definition comes straight from app_config's rowingPassport key (already
// jsonb, no JSON.parse-or-default dance needed). progress is only computed
// when memberId is provided, same as the Sheets version — admin/passport.js's
// init call passes {} (no memberId), so it only ever needed `definition`;
// progress is ported in full anyway since passport_signoffs already exists
// and the extra cost was small.
//
// Requires a valid session — getRowingPassport isn't in Apps Script's
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

function computeProgress(signoffs: any[], def: any) {
  const byKey: Record<string, any[]> = {};
  signoffs.forEach((r) => {
    const k = (r.passport_id || "rower") + "::" + r.item_id;
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push({
      id: r.id,
      signerId: r.signer_id,
      signerName: r.signer_name,
      signerRole: r.signer_role,
      timestamp: r.signed_at,
      note: r.note || "",
    });
  });

  const out: { passports: Record<string, any> } = { passports: {} };
  (def.passports || []).forEach((p: any) => {
    const required = Number(p.requiredSigs || 2);
    const items: Record<string, any> = {};
    let completeCount = 0, totalCount = 0;
    (p.categories || []).forEach((cat: any) => {
      (cat.items || []).forEach((it: any) => {
        if (it.retired) return;
        totalCount++;
        const sigs = byKey[p.id + "::" + it.id] || [];
        const distinct: Record<string, any> = {};
        sigs.forEach((s) => { if (s.signerId) distinct[s.signerId] = s; });
        const distinctCount = Object.keys(distinct).length;
        const complete = distinctCount >= required;
        if (complete) completeCount++;
        items[it.id] = { signoffs: sigs, complete, distinctSigners: distinctCount, required };
      });
    });
    out.passports[p.id] = {
      items,
      totalCount,
      completeCount,
      percent: totalCount ? Math.round((100 * completeCount) / totalCount) : 0,
    };
  });
  return out;
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

  const memberId = body?.memberId ? String(body.memberId) : "";

  // The definition read and the signoffs read (when memberId is given)
  // don't depend on each other — def only feeds into computeProgress as a
  // pure-JS combination once both are in hand — so they run in parallel.
  const [{ data: configRow }, { data: signoffs }] = await Promise.all([
    admin.from("app_config").select("value").eq("key", "rowingPassport").maybeSingle(),
    memberId
      ? admin.from("passport_signoffs").select("*").eq("member_id", memberId).is("revoked_at", null)
      : Promise.resolve({ data: null }),
  ]);

  const def = (configRow?.value && Array.isArray(configRow.value.passports))
    ? configRow.value
    : { version: 1, passports: [] };

  const result: Record<string, unknown> = { definition: def };
  if (memberId) {
    result.progress = computeProgress(signoffs || [], def);
  }

  return json(result);
});
