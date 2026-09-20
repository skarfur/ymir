import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface ResolvedSession {
  memberId: string;
  kennitala: string;
  role: string;
  sessionId: string;
}

// ── Self-signed access tokens (Phase 0 of the RLS/RPC rearchitecture) ──────
// Ymir doesn't use Supabase Auth (auth.users) — login/session logic stays
// entirely custom (see resolveSession above). mintAccessToken additionally
// signs a real JWT with the project's own ES256 signing key (APP_JWT_SECRET,
// a JWK imported via `supabase gen signing-key`/dashboard, NOT the legacy
// shared JWT secret), so PostgREST/RLS can read custom claims via
// auth.jwt() for direct table access and RPC calls — see
// supabase/migrations/20260920010000_rls_auth_helpers.sql for the policies
// that consume these claims.

function base64url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

let cachedSigningKey: { key: CryptoKey; kid: string } | null = null;

async function getSigningKey(): Promise<{ key: CryptoKey; kid: string }> {
  if (cachedSigningKey) return cachedSigningKey;
  const secretJson = Deno.env.get("APP_JWT_SECRET");
  if (!secretJson) throw new Error("APP_JWT_SECRET not configured");
  const jwk = JSON.parse(secretJson);
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  cachedSigningKey = { key, kid: jwk.kid };
  return cachedSigningKey;
}

// Mints a JWT PostgREST will trust for the `authenticated` role, carrying
// custom claims the RLS helper functions read via auth.jwt(). `expiresAt`
// should match the underlying sessions.expires_at row — session_valid()
// is the real revocation authority (checks that row is still live), the
// JWT's own exp is just a hard ceiling on worst-case replay.
export async function mintAccessToken(session: ResolvedSession, expiresAt: Date): Promise<string> {
  const { key, kid } = await getSigningKey();
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid, typ: "JWT" };
  const payload = {
    sub: session.memberId,
    role: "authenticated",
    app_role: session.role,
    member_id: session.memberId,
    kennitala: session.kennitala,
    session_id: session.sessionId,
    iat: nowSec,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const signingInput = base64urlJson(header) + "." + base64urlJson(payload);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return signingInput + "." + base64url(new Uint8Array(signature));
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

// Resolves a caller from a raw session token: hashes it, looks up the
// session, checks expiry, and touches last_seen_at. Mirrors code.gs's
// authCaller_ — expired sessions are deleted on encounter so the table
// self-cleans, same as the Sheets version.
export async function resolveSession(
  admin: SupabaseClient,
  rawToken: string | undefined | null,
): Promise<ResolvedSession | null> {
  const token = String(rawToken ?? "").trim();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);

  const { data: session } = await admin
    .from("sessions")
    .select("id, member_id, role, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!session) return null;

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await admin.from("sessions").delete().eq("id", session.id);
    return null;
  }

  const { data: member } = await admin
    .from("members")
    .select("id, kennitala, role, active")
    .eq("id", session.member_id)
    .maybeSingle();
  if (!member || !member.active) return null;

  await admin.from("sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", session.id);

  return {
    memberId: member.id,
    kennitala: member.kennitala,
    role: member.role || session.role,
    sessionId: session.id,
  };
}
