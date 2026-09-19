import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports passport.gs's signPassportItem_ — any authenticated session; the
// original has its own internal authorization instead of a role-list
// gate: the signer must be staff/admin/manager, or a released rower /
// coxswain (checked via their own certifications), and can't sign their
// own passport. Auto-promotes the target member when every non-retired
// item in the passport is complete (maybePromoteRower_), same as the
// original.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function computeProgress(signoffs: any[], def: any) {
  const byKey: Record<string, any[]> = {};
  signoffs.forEach((r) => {
    const k = (r.passport_id || "rower") + "::" + r.item_id;
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push({
      id: r.id, signerId: r.signer_id, signerName: r.signer_name,
      signerRole: r.signer_role, timestamp: r.signed_at, note: r.note || "",
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
      items, totalCount, completeCount,
      percent: totalCount ? Math.round((100 * completeCount) / totalCount) : 0,
    };
  });
  return out;
}

async function maybePromoteRower(admin: any, memberId: string, passport: any, byName: string): Promise<boolean> {
  const { data: member } = await admin.from("members").select("certifications").eq("id", memberId).maybeSingle();
  if (!member) return false;
  let certs: any[] = Array.isArray(member.certifications) ? member.certifications : [];
  const certId = passport.promoteCertId || "rowing_division";
  const toSub = passport.toSub || "released";
  const fromSub = passport.fromSub || "restricted";
  const idx = certs.findIndex((c) => c.certId === certId);
  const ts = new Date().toISOString();
  if (idx >= 0) {
    if (certs[idx].sub === toSub || certs[idx].sub === "coxswain") return false;
    certs[idx].sub = toSub;
    certs[idx].verifiedBy = byName;
    certs[idx].verifiedAt = ts;
  } else {
    certs.push({
      certId, sub: toSub, category: "Club Endorsement",
      assignedBy: byName, assignedAt: ts, verifiedBy: byName, verifiedAt: ts,
      issuingAuthority: "", expires: false, expiresAt: "",
      description: "Auto-promoted on passport completion",
    });
  }
  certs = certs.filter((c, i) => !(c.certId === certId && c.sub === fromSub && i !== idx));
  await admin.from("members").update({ certifications: certs, updated_at: ts }).eq("id", memberId);
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

  const memberId = body?.memberId ? String(body.memberId) : "";
  const itemId = body?.itemId ? String(body.itemId) : "";
  const signerId = body?.signerId ? String(body.signerId) : "";
  if (!memberId) return json({ error: "memberId required" }, 400);
  if (!itemId) return json({ error: "itemId required" }, 400);
  if (!signerId) return json({ error: "signerId required" }, 400);
  const passportId = body?.passportId ? String(body.passportId) : "rower";

  let { data: signer } = await admin.from("members").select("id, kennitala, name, role, certifications")
    .eq("id", signerId).maybeSingle();
  if (!signer) {
    const byKt = await admin.from("members").select("id, kennitala, name, role, certifications")
      .eq("kennitala", signerId).maybeSingle();
    signer = byKt.data;
  }
  if (!signer) return json({ error: "Signer not found" }, 404);

  const signerRole = String(signer.role || "").toLowerCase();
  const signerCerts: any[] = Array.isArray(signer.certifications) ? signer.certifications : [];
  const isStaff = signerRole === "staff" || signerRole === "admin" || signerRole === "manager";
  const isReleased = signerCerts.some((c) => c.certId === "rowing_division" && (c.sub === "released" || c.sub === "coxswain"));
  if (!isStaff && !isReleased) return json({ error: "Signer not authorised to sign passport items" }, 403);

  if (String(signer.id) === memberId || String(signer.kennitala) === memberId) {
    return json({ error: "Cannot sign your own passport" }, 403);
  }

  const { data: configRow } = await admin.from("app_config").select("value").eq("key", "rowingPassport").maybeSingle();
  const def = (configRow?.value && Array.isArray(configRow.value.passports)) ? configRow.value : null;
  if (!def) return json({ error: "No rowing passport has been configured yet" }, 404);
  const passport = (def.passports || []).find((p: any) => p.id === passportId);
  if (!passport) return json({ error: "Unknown passport: " + passportId }, 404);
  let item: any = null;
  (passport.categories || []).forEach((c: any) => (c.items || []).forEach((i: any) => { if (i.id === itemId) item = i; }));
  if (!item) return json({ error: "Unknown item: " + itemId }, 404);
  if (item.retired) return json({ error: "Item retired" }, 410);

  const { data: existing } = await admin.from("passport_signoffs").select("id")
    .eq("member_id", memberId).eq("passport_id", passportId).eq("item_id", itemId)
    .eq("signer_id", signer.id).is("revoked_at", null);
  if (existing && existing.length) return json({ error: "You have already signed this item" }, 409);

  const ts = new Date().toISOString();
  const { error } = await admin.from("passport_signoffs").insert({
    member_id: memberId,
    passport_id: passportId,
    item_id: itemId,
    signer_id: signer.id,
    signer_name: signer.name || "",
    signer_role: isStaff ? "staff" : "released_rower",
    signed_at: ts,
    note: body?.note || "",
    revoked_by: null,
    revoked_at: null,
    revoke_reason: "",
  });
  if (error) return json({ error: "signPassportItem failed: " + error.message }, 500);

  const { data: signoffs } = await admin.from("passport_signoffs").select("*")
    .eq("member_id", memberId).is("revoked_at", null);
  const progress = computeProgress(signoffs || [], def);
  let promoted = false;
  const pProg = progress.passports[passportId];
  if (pProg && pProg.totalCount > 0 && pProg.completeCount === pProg.totalCount) {
    promoted = await maybePromoteRower(admin, memberId, passport, signer.name || "passport");
  }

  return json({ saved: true, progress, promoted });
});
