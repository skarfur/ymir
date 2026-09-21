import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, mintAccessToken, resolveSession, sha256Hex } from "../_shared/session.ts";

// Ports members.gs's validateWard_ — a guardian "switching into" a ward's
// account from the guardian landing page. Needs its own Edge Function
// (not a plain RPC) because it mints a brand-new session + signs a fresh
// accessToken JWT for the ward, the same as login/index.ts does — plpgsql
// can't sign the ES256 JWT.
//
// Ported checks, in the same order as the original:
//   1. caller must be authenticated (resolveSession on the guardian's own
//      sessionToken).
//   2. caller must BE the guardian they claim to be (guardianKennitala ===
//      caller.kennitala), or an admin helping out.
//   3. guardian row must exist, be active, and not itself be a minor.
//   4. ward row must exist, be active, and be a minor.
//   5. the guardians table (this schema's normalized replacement for the
//      Sheets version's ward.guardianKennitala column) must have a row
//      linking this ward to this guardian kennitala.
//
// isMinor is computed from birth_year here, same formula get-members.ts
// and save_member's RPC already use (age changes with the calendar, not
// the row) — there's no stored isMinor column in this schema.
//
// The minted session is always short-lived (stay_logged_in=false), same
// as the original comment: "a guardian switching into a ward should not
// be able to 'stay logged in' as the minor."

const SHORT_SESSION_MS = 8 * 60 * 60 * 1000;

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

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isMinor(birthYear: number | null): boolean {
  if (!birthYear) return false;
  return new Date().getUTCFullYear() - birthYear < 18;
}

function publicMemberDto(m: any) {
  return {
    id: m.id,
    kennitala: m.kennitala,
    name: m.name,
    role: m.role,
    email: m.email || "",
    phone: m.phone || "",
    birthYear: m.birth_year || "",
    isMinor: isMinor(m.birth_year),
    certifications: m.certifications || [],
    initials: m.initials || "",
    preferences: m.preferences || {},
    bio: m.bio || "",
    headshotUrl: m.headshot_url || "",
    googleEmail: m.google_email || "",
  };
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
  const caller = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!caller) return json({ error: "Unauthorized" }, 401);

  const guardianKt = String(body?.guardianKennitala ?? "").trim();
  const wardKt = String(body?.wardKennitala ?? "").trim();
  if (!guardianKt || !wardKt) {
    return json({ error: "guardianKennitala and wardKennitala required" }, 400);
  }
  if (guardianKt !== caller.kennitala && caller.role !== "admin") {
    return json({ error: "Forbidden" }, 403);
  }

  const { data: guardian } = await admin
    .from("members").select("*").eq("kennitala", guardianKt).maybeSingle();
  if (!guardian) return json({ error: "Guardian not found" }, 404);
  if (!guardian.active) return json({ error: "Inactive account" }, 403);
  if (isMinor(guardian.birth_year)) return json({ error: "Minors cannot act as guardians" }, 403);

  const { data: ward } = await admin
    .from("members").select("*").eq("kennitala", wardKt).maybeSingle();
  if (!ward) return json({ error: "Ward not found" }, 404);
  if (!ward.active) return json({ error: "Inactive account" }, 403);
  if (!isMinor(ward.birth_year)) return json({ error: "Target is not a minor" }, 403);

  const { data: link } = await admin
    .from("guardians").select("id").eq("member_id", ward.id).eq("kennitala", guardianKt).maybeSingle();
  if (!link) return json({ error: "Not authorised for this ward" }, 403);

  const rawToken = randomToken();
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + SHORT_SESSION_MS);
  const userAgent = String(body?.userAgent ?? "").slice(0, 300);

  const { data: session, error: sessionError } = await admin
    .from("sessions")
    .insert({
      member_id: ward.id,
      token_hash: tokenHash,
      role: ward.role,
      stay_logged_in: false,
      expires_at: expiresAt.toISOString(),
      user_agent: userAgent,
    })
    .select("id, expires_at")
    .single();
  if (sessionError) return json({ error: "Session creation failed" }, 500);

  const accessToken = await mintAccessToken({
    memberId: ward.id,
    kennitala: ward.kennitala,
    role: ward.role,
    sessionId: session.id,
  }, expiresAt);

  return json({
    member: publicMemberDto(ward),
    sessionToken: rawToken,
    sessionId: session.id,
    expiresAt: session.expires_at,
    accessToken,
  });
});
