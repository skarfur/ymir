import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Removes the Google link from the caller's own member record — ports
// members.gs's unlinkGoogleAccount_. Password login keeps working either
// way; this is just the "disconnect" side of the link.

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

  const { error } = await admin
    .from("members")
    .update({ google_email: "", updated_at: new Date().toISOString() })
    .eq("kennitala", session.kennitala);
  if (error) return json({ error: "Unlink failed" }, 500);

  return json({ unlinked: true });
});
