import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's getCrews_. `pairs` is native jsonb here — no
// JSON.parse-if-string step needed, unlike the Sheets version.
//
// Requires a valid session — getCrews isn't in Apps Script's
// PUBLIC_ACTIONS_ either.

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

  const kennitala = body?.kennitala ? String(body.kennitala).trim() : "";

  const { data: all, error } = await admin.from("crews").select("*");
  if (error) return json({ error: "Crews lookup failed" }, 500);

  let crews = all || [];
  if (kennitala) {
    crews = crews.filter((c) => {
      if (c.status === "disbanded") return false;
      const pairs = Array.isArray(c.pairs) ? c.pairs : [];
      return pairs.some((p: any) =>
        (p.members || []).some((m: any) => m && String(m.kennitala) === kennitala),
      );
    });
  }

  return json({ crews });
});
