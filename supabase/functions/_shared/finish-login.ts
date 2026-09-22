import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { mintAccessToken } from "./session.ts";
import { buildConfigSnapshot } from "./config.ts";
import { toMemberDto } from "./members.ts";

// Shared tail of a successful sign-in — session row, wards, config
// piggyback, and the signed accessToken — factored out of login/index.ts
// so login-with-google/index.ts doesn't duplicate this security-sensitive
// logic (session minting drifting between two hand-copied versions is
// exactly how bugs like the wards/config piggyback regression, documented
// in login/index.ts's header comment, happen again).

const SHORT_SESSION_MS = 8 * 60 * 60 * 1000;
const LONG_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// isMinor is computed from birth_year, not a stored column — age changes
// with the calendar, not the row (same formula as get-members.ts and the
// member-CRUD/validate-ward RPCs).
function isMinor(birthYear: number | null): boolean {
  if (!birthYear) return false;
  return new Date().getUTCFullYear() - birthYear < 18;
}

// Ports findWardsOf_: active minors whose guardians-table row points at
// this kennitala. A minor can never itself be a guardian, so callers pass
// [] straight through without querying when the logging-in member is one.
async function getWardsOf(admin: SupabaseClient, guardianKennitala: string) {
  const { data: links } = await admin
    .from("guardians").select("member_id").eq("kennitala", guardianKennitala);
  const wardIds = (links || []).map((l) => l.member_id);
  if (!wardIds.length) return [];
  const { data: wardRows } = await admin
    .from("members").select("id, kennitala, name, birth_year, active").in("id", wardIds);
  return (wardRows || [])
    .filter((w) => w.active && isMinor(w.birth_year))
    .map((w) => ({ id: w.id, kennitala: w.kennitala, name: w.name, birthYear: w.birth_year || "" }));
}

export interface FinishLoginOpts {
  stayLoggedIn: boolean;
  userAgent: string;
  // Google sign-in is its own trust path — a Google-linked member never
  // gets nagged about a password they didn't just use to authenticate,
  // even if their stored password happens to still be an admin-issued
  // temp one. Password login omits this and lets the real
  // member.password_is_temp flag decide. Ports loginWithGoogle_'s
  // usingDefaultPassword: false override exactly.
  usingDefaultPasswordOverride?: boolean;
}

export async function finishLogin(admin: SupabaseClient, member: any, opts: FinishLoginOpts) {
  const now = new Date();
  const rawToken = randomToken();
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(now.getTime() + (opts.stayLoggedIn ? LONG_SESSION_MS : SHORT_SESSION_MS));

  const [
    { data: session, error: sessionError },
    wards,
    config,
    { data: guardian },
  ] = await Promise.all([
    admin
      .from("sessions")
      .insert({
        member_id: member.id,
        token_hash: tokenHash,
        role: member.role,
        stay_logged_in: opts.stayLoggedIn,
        expires_at: expiresAt.toISOString(),
        user_agent: opts.userAgent.slice(0, 300),
      })
      .select("id, expires_at")
      .single(),
    isMinor(member.birth_year) ? Promise.resolve([]) : getWardsOf(admin, member.kennitala),
    // Best-effort: a failure here shouldn't fail the login, same as the
    // original _loginConfigPiggyback_'s try/catch — the client just falls
    // back to its own apiGet('getConfig').
    buildConfigSnapshot(admin).catch(() => null),
    admin.from("guardians").select("name, kennitala, phone").eq("member_id", member.id).maybeSingle(),
  ]);

  if (sessionError) throw new Error("Session creation failed");

  const accessToken = await mintAccessToken({
    memberId: member.id,
    kennitala: member.kennitala,
    role: member.role,
    sessionId: session.id,
  }, expiresAt);

  return {
    member: toMemberDto(member, guardian),
    // Top-level, matching members.gs's loginMember_ exactly — the frontend
    // reads data.usingDefaultPassword, not data.member.usingDefaultPassword.
    usingDefaultPassword: opts.usingDefaultPasswordOverride ?? member.password_is_temp,
    wards,
    sessionToken: rawToken,
    sessionId: session.id,
    expiresAt: session.expires_at,
    accessToken,
    config,
  };
}
