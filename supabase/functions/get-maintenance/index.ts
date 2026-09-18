import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports maintenance.gs's getMaintenance_ — a plain readAll_('maintenance')
// in the Sheets version. Joins against boats to hydrate boatName/
// boatCategory into each row: the Sheets schema stored those as literal
// columns on maintenance (SCHEMA_.maintenance has 'boatName'), but this
// table keeps boat_id as the only source of truth and joins for display,
// same normalization choice made everywhere else in this migration.
//
// Requires a valid session — getMaintenance isn't in Apps Script's
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

  const { data: all, error } = await admin.from("maintenance").select("*");
  if (error) return json({ error: "Maintenance lookup failed" }, 500);

  const boatIds = [...new Set((all || []).map((r) => r.boat_id).filter(Boolean))];
  let boatById: Record<string, any> = {};
  if (boatIds.length) {
    const { data: boats } = await admin.from("boats").select("id, name, category").in("id", boatIds);
    (boats || []).forEach((b) => { boatById[b.id] = b; });
  }

  const requests = (all || []).map((r) => {
    const b = r.boat_id ? boatById[r.boat_id] : null;
    return {
      ...r,
      boatName: (b && b.name) || "",
      boatCategory: (b && b.category) || "",
    };
  });

  return json({ requests });
});
