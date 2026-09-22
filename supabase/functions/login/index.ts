import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { finishLogin } from "../_shared/finish-login.ts";

// Password-gated sign-in — ports members.gs's loginMember_. Username may be
// either a 10-digit kennitala or the member's initials (case-insensitive).
// Issues a session token on success and enforces a 5-per-15-min rate limit
// per kennitala, same as the Apps Script version.
//
// This function implements its own authentication (username/password +
// custom session tokens), not Supabase Auth — it must be callable by an
// unauthenticated client, so it's deployed with verify_jwt disabled.
//
// The session-minting tail (sessionToken/accessToken, wards, getConfig
// piggyback) lives in _shared/finish-login.ts, shared with
// login-with-google/index.ts, so the two sign-in paths can't drift apart
// the way this function's wards/config piggyback silently did once before
// (see finish-login.ts's header comment).

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Browser callers send a CORS preflight (OPTIONS) before the real POST
// whenever the body is application/json — curl never triggers this, which
// is why direct-HTTP testing didn't catch its absence. Access-Control-Allow-
// Origin: '*' is deliberate here, matching Supabase's own default function
// template: the anon key + RLS/grants are the real access boundary, not
// which origin is allowed to call this endpoint.
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

  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  const stayLoggedIn = Boolean(body?.stayLoggedIn);

  if (!username) return json({ error: "Username required" }, 400);
  if (!password) return json({ error: "Password required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve username: 10-digit kennitala, or case-insensitive initials.
  const isKennitala = /^\d{10}$/.test(username);
  const lookup = admin.from("members").select("*");
  const { data: matches, error: findError } = isKennitala
    ? await lookup.eq("kennitala", username)
    : await lookup.ilike("initials", username);

  if (findError) return json({ error: "Lookup failed" }, 500);
  if (!matches || matches.length === 0) return json({ error: "Not found" }, 404);
  if (matches.length > 1) return json({ error: "Ambiguous initials" }, 409);
  const member = matches[0];

  if (!member.active) return json({ error: "Inactive account" }, 403);

  const now = new Date();
  const { data: attemptRow } = await admin
    .from("login_attempts")
    .select("*")
    .eq("kennitala", member.kennitala)
    .maybeSingle();

  if (attemptRow?.locked_until && new Date(attemptRow.locked_until) > now) {
    return json({ error: "Too many attempts" }, 429);
  }

  const { data: passwordOk } = await admin.rpc("verify_member_password", {
    p_kennitala: member.kennitala,
    p_password: password,
  });

  if (!passwordOk) {
    const windowStart = attemptRow?.window_start ? new Date(attemptRow.window_start) : now;
    const withinWindow = now.getTime() - windowStart.getTime() < RATE_LIMIT_WINDOW_MS;
    const attempts = (withinWindow ? attemptRow?.attempts ?? 0 : 0) + 1;
    const lockedUntil = attempts >= RATE_LIMIT_MAX
      ? new Date(now.getTime() + RATE_LIMIT_WINDOW_MS)
      : null;

    await admin.from("login_attempts").upsert({
      kennitala: member.kennitala,
      attempts,
      window_start: withinWindow ? attemptRow?.window_start ?? now.toISOString() : now.toISOString(),
      locked_until: lockedUntil,
    });

    if (lockedUntil) return json({ error: "Too many attempts" }, 429);
    return json({ error: "Invalid credentials" }, 401);
  }

  await admin.from("login_attempts").delete().eq("kennitala", member.kennitala);

  try {
    const result = await finishLogin(admin, member, {
      stayLoggedIn,
      userAgent: req.headers.get("user-agent") || "",
    });
    return json(result);
  } catch {
    return json({ error: "Session creation failed" }, 500);
  }
});
