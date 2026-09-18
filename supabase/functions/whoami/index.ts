import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Minimal protected endpoint — proves the session round-trip end to end
// (login issues a token -> whoami resolves it back to a caller).
//
// Uses the shared resolveSession() helper — import-test confirmed
// _shared/*.ts cross-file imports resolve correctly in this deployment
// path. (This function briefly inlined the same logic instead, on the
// suspicion that the shared import was the cause of an earlier "no
// response"; that turned out to be leftover shell-quoting/URL issues in
// that test session, not a real bundler bug. See import-test's commit
// history if this needs re-litigating.)

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

  return json({
    memberId: session.memberId,
    kennitala: session.kennitala,
    role: session.role,
  });
});
