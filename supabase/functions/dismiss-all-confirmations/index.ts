import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's dismissAllConfirmations_ — dismisses every non-pending,
// non-dismissed confirmation where the member is either party. Any
// authenticated session, matching the original.
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

  const { data: all, error } = await admin
    .from("trip_confirmations")
    .select("id")
    .or(`to_kennitala.eq.${kennitala},from_kennitala.eq.${kennitala}`)
    .neq("status", "pending")
    .eq("dismissed", false);
  if (error) return json({ error: "Dismiss-all lookup failed" }, 500);

  const ids = (all || []).map((r) => r.id);
  if (ids.length) {
    await admin.from("trip_confirmations")
      .update({ dismissed: true, dismissed_at: new Date().toISOString() })
      .in("id", ids);
  }

  return json({ dismissed: ids.length });
});
