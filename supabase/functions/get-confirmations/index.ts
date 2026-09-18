import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's getConfirmations_ — incoming/outgoing pending
// trip_confirmations for a member, resolved via member_id FK.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const kennitala = body?.kennitala ? String(body.kennitala).trim() : "";
  if (!kennitala) return json({ error: "kennitala required" }, 400);

  const { data: member } = await admin.from("members").select("id").eq("kennitala", kennitala).maybeSingle();
  if (!member) return json({ incoming: [], outgoing: [] });

  const { data: all, error } = await admin.from("trip_confirmations").select("*").eq("dismissed", false);
  if (error) return json({ error: "Confirmations lookup failed" }, 500);

  const incoming = (all || []).filter((r) => r.to_member_id === member.id);
  const outgoing = (all || []).filter((r) => r.from_member_id === member.id);

  return json({ incoming, outgoing });
});
