import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface ResolvedSession {
  memberId: string;
  kennitala: string;
  role: string;
  sessionId: string;
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
