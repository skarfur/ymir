import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports public.gs's getVolunteerSignups_ — filter by eventId, otherwise
// plain readAll_('volunteerSignups'). Joins against members to hydrate
// kennitala/name into each row: the Sheets schema stored those directly
// (SCHEMA_.volunteer_signups has 'kennitala','name'), this table keeps
// member_id as the only source of truth. Translates the raw snake_case
// row into the camelCase DTO (eventId, roleId, signedUpAt) volunteer.js/
// member.js/admin read — the row was previously spread as-is, the same
// read-DTO bug fixed everywhere else this session.
//
// This is called as apiPost('getVolunteerSignups', {}) despite the get*
// name (Apps Script routes it through doPost, not doGet) — routed the
// same way here regardless, action name is what shared/api.js keys on.
//
// Requires a valid session — getVolunteerSignups isn't in Apps Script's
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

  const eventId = body?.eventId ? String(body.eventId) : "";

  let query = admin.from("volunteer_signups").select("*");
  if (eventId) query = query.eq("event_id", eventId);
  const { data: all, error } = await query;
  if (error) return json({ error: "Volunteer signups lookup failed" }, 500);

  const memberIds = [...new Set((all || []).map((s) => s.member_id).filter(Boolean))];
  let memberById: Record<string, any> = {};
  if (memberIds.length) {
    const { data: members } = await admin.from("members").select("id, kennitala, name").in("id", memberIds);
    (members || []).forEach((m) => { memberById[m.id] = m; });
  }

  const signups = (all || []).map((s) => {
    const m = s.member_id ? memberById[s.member_id] : null;
    return {
      id: s.id,
      eventId: s.event_id,
      roleId: s.role_id,
      kennitala: (m && m.kennitala) || "",
      name: (m && m.name) || "",
      signedUpAt: s.signed_up_at,
    };
  });

  return json({ signups });
});
