import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";
import { verifyGoogleIdToken } from "../_shared/google-auth.ts";

// Links a Google account to the caller's own member record — ports
// members.gs's linkGoogleAccount_. Requires an authenticated session
// (bootstraps the trust chain through the existing password login),
// verifies the supplied ID token, and refuses to link an email already
// attached to a different member. settings/settings.js's
// initGoogleLinkButton calls this after a GIS credential response.

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

  const idToken = String(body?.idToken || "");
  if (!idToken) return json({ error: "idToken required" }, 400);

  const payload = await verifyGoogleIdToken(idToken);
  if (!payload) return json({ error: "Invalid Google token" }, 403);
  const email = payload.email;

  const { data: existing, error: findError } = await admin
    .from("members").select("kennitala").eq("google_email", email).maybeSingle();
  if (findError) return json({ error: "Lookup failed" }, 500);
  if (existing && String(existing.kennitala) !== session.kennitala) {
    return json({ error: "Google account already linked to another member" }, 409);
  }

  // Belt-and-suspenders against the same race a concurrent link attempt
  // could hit between the check above and this write — the unique partial
  // index on members(google_email) (see the members_google_email_unique
  // migration) turns a lost race into a clean 23505 here instead of two
  // members silently sharing one Google account.
  const { error: updateError } = await admin
    .from("members")
    .update({ google_email: email, updated_at: new Date().toISOString() })
    .eq("kennitala", session.kennitala);
  if (updateError) {
    if (updateError.code === "23505") {
      return json({ error: "Google account already linked to another member" }, 409);
    }
    return json({ error: "Link failed" }, 500);
  }

  return json({ linked: true, googleEmail: email });
});
