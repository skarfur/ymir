import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyGoogleIdToken } from "../_shared/google-auth.ts";
import { finishLogin } from "../_shared/finish-login.ts";

// Public sign-in via a Google ID token — ports members.gs's
// loginWithGoogle_. The frontend's GIS one-tap/button flow posts the
// credential here; we verify it, look up a member by their previously-
// linked google_email, and mint a session. Unlinked members are rejected
// with a specific message so the UI can tell the user to sign in with
// their password first and link from settings (see login/login.js's
// handleGoogleCredential).
//
// Like login/index.ts, this implements its own authentication and must be
// callable unauthenticated — deployed with verify_jwt disabled.

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

  const idToken = String(body?.idToken || "");
  const stayLoggedIn = Boolean(body?.stayLoggedIn);
  if (!idToken) return json({ error: "idToken required" }, 400);

  const payload = await verifyGoogleIdToken(idToken);
  if (!payload) return json({ error: "Invalid Google token" }, 401);
  const email = payload.email;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: matches, error: findError } = await admin
    .from("members").select("*").eq("google_email", email);
  if (findError) return json({ error: "Lookup failed" }, 500);
  const member = matches && matches[0];
  if (!member) return json({ error: "Google account not linked" }, 404);
  if (!member.active) return json({ error: "Inactive account" }, 403);

  // A successful Google sign-in clears any password-attempt lockout on this
  // account, matching loginWithGoogle_'s clearLoginAttempts_ call — Google
  // auth is a separate trust path, so it shouldn't stay blocked by unrelated
  // failed password guesses.
  await admin.from("login_attempts").delete().eq("kennitala", member.kennitala);

  try {
    const result = await finishLogin(admin, member, {
      stayLoggedIn,
      userAgent: req.headers.get("user-agent") || "",
      // See finish-login.ts's FinishLoginOpts doc — Google sign-in never
      // nags about a temp password the user didn't just type.
      usingDefaultPasswordOverride: false,
    });
    return json(result);
  } catch {
    return json({ error: "Session creation failed" }, 500);
  }
});
