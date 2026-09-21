import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";
import { buildMembers } from "../_shared/members.ts";

// Ports members.gs's getMembers_. Query + DTO logic live in
// _shared/members.ts (buildMembers) so get-captain-bundle can pull the
// same read into its combined response without duplicating it.
//
// Requires a valid session — getMembers isn't in Apps Script's
// PUBLIC_ACTIONS_ either, and (checked against code.gs's ADMIN_ACTIONS_/
// STAFF_ACTIONS_) isn't role-gated there either: any authenticated member
// can call it and get the full sanitized roster today, in both versions.
// Not a gap this port introduces — but worth knowing before real member
// data goes in, since "any session" is looser than "admin only."

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

  try {
    const result = await buildMembers(admin, {
      offset: parseInt(String(body?.offset || "0"), 10) || 0,
      limit: parseInt(String(body?.limit || "0"), 10) || 0,
    });
    return json(result);
  } catch (e) {
    return json({ error: (e as Error).message || "Members lookup failed" }, 500);
  }
});
