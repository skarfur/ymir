import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient } from "../_shared/session.ts";

// Called by the trips_notify_shared_photos_trg trigger (see
// supabase/migrations/20260923110000_shared_photo_notify.sql) whenever a
// trip's photo_meta gains a photo newly marked "shared with the club".
// Not reachable by the frontend — no action name in shared/api.js's
// _SUPABASE_ACTIONS — and not meant to be: the only legitimate caller is
// that trigger, authenticated via the x-trigger-secret header (compared
// against the TRIGGER_SHARED_SECRET Edge Function secret, which must
// match the 'trigger_shared_secret' value stored in Supabase Vault that
// the trigger reads). Deployed with verify_jwt=false like every other
// Edge Function here, since this has no end-user session to validate —
// the shared-secret check is the actual gate.
//
// Sends via Resend (RESEND_API_KEY secret) — a plain HTML email linking
// to the already-public Storage URLs, not attachments: the photos are
// already served publicly from the trip-files bucket, so there's no
// reason to re-download and re-attach the bytes, and it sidesteps email
// attachment size limits entirely.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-trigger-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

interface PhotoMetaEntry {
  shared?: boolean;
  clubUse?: boolean;
  uploadedBy?: string;
}

function newlySharedUrls(newMeta: Record<string, PhotoMetaEntry>, oldMeta: Record<string, PhotoMetaEntry>): string[] {
  return Object.keys(newMeta).filter((url) => {
    const wasShared = !!oldMeta[url]?.shared;
    const isShared = !!newMeta[url]?.shared;
    return isShared && !wasShared;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("TRIGGER_SHARED_SECRET");
  const gotSecret = req.headers.get("x-trigger-secret");
  if (!expectedSecret || !gotSecret || gotSecret !== expectedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const record = (body?.record || {}) as Record<string, unknown>;
  const oldRecord = (body?.old_record || {}) as Record<string, unknown>;
  const newMeta = (record.photo_meta || {}) as Record<string, PhotoMetaEntry>;
  const oldMeta = (oldRecord.photo_meta || {}) as Record<string, PhotoMetaEntry>;

  const urls = newlySharedUrls(newMeta, oldMeta);
  if (!urls.length) return json({ sent: false, reason: "nothing newly shared" });

  const admin = createAdminClient();
  const { data: cfgRow } = await admin.from("app_config").select("value").eq("key", "sharedPhotoEmailTo").maybeSingle();
  const toAddress = typeof cfgRow?.value === "string" ? cfgRow.value : "";
  if (!toAddress) return json({ sent: false, reason: "sharedPhotoEmailTo not configured" });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "RESEND_API_KEY not configured" }, 500);

  const memberName = String(record.member_name || "");
  const date = String(record.date || "");
  const boatName = String(record.boat_name || "");
  const subject = `${urls.length} new shared photo${urls.length === 1 ? "" : "s"}${memberName ? ` from ${memberName}` : ""}${date ? ` (${date})` : ""}`;
  const html = `
    <p>${memberName || "A member"} shared ${urls.length} new photo${urls.length === 1 ? "" : "s"}${boatName ? ` from a trip on ${boatName}` : ""}${date ? ` on ${date}` : ""}:</p>
    <ul>${urls.map((u) => `<li><a href="${u}">${u}</a></li>`).join("")}</ul>
  `.trim();

  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("SHARED_PHOTO_EMAIL_FROM") || "onboarding@resend.dev",
      to: toAddress,
      subject,
      html,
    }),
  });
  if (!resendResp.ok) {
    const errText = await resendResp.text().catch(() => "");
    return json({ error: "Resend send failed: " + errText }, 502);
  }

  return json({ sent: true, count: urls.length });
});
