import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Minimal protected endpoint — proves the session round-trip end to end
// (login issues a token -> whoami resolves it back to a caller).
//
// Self-contained rather than importing ../_shared/session.ts: the first
// deploy used that shared import and produced no response at all (not even
// an error body) when invoked for real, which points at the cross-file
// import not resolving the way expected inside the deployed bundle. Rather
// than debug bundler semantics blind (this sandbox can't invoke the
// function to verify a fix), inlining the same logic removes the untested
// variable. _shared/session.ts is kept as a reference implementation but
// isn't wired into any deployed function yet — verify the shared-import
// path works before the next function relies on it.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const token = String(body?.sessionToken ?? "").trim();
  if (!token) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const tokenHash = await sha256Hex(token);
  const { data: session } = await admin
    .from("sessions")
    .select("id, member_id, role, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await admin.from("sessions").delete().eq("id", session.id);
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: member } = await admin
    .from("members")
    .select("id, kennitala, role, active")
    .eq("id", session.member_id)
    .maybeSingle();
  if (!member || !member.active) return json({ error: "Unauthorized" }, 401);

  await admin.from("sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", session.id);

  return json({
    memberId: member.id,
    kennitala: member.kennitala,
    role: member.role || session.role,
  });
});
