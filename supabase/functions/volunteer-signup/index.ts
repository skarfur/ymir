import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports public.gs's volunteerSignup_ — any authenticated session (members
// sign themselves up). volunteer_signups stores member_id as the source
// of truth (see get-volunteer-signups' header) rather than kennitala/name
// directly, so the caller's kennitala is resolved to a member row first.
//
// Preserves the "materialize a virtual event on first signup" fallback:
// when eventId isn't found and starts with 'vae-', the client has already
// computed the full virtual-event shape client-side (from activity_templates
// + bulkSchedule) and sends it as body.virtualEvent — this just persists
// that object into activities, it doesn't recompute anything server-side,
// so it doesn't depend on the (currently unseeded) activity_templates data
// the way the deferred bulk-materialization sync (syncVolunteerEvents_)
// does.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: unknown) => { const s = v ? String(v) : ""; return s && UUID_RE.test(s) ? s : null; };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const eventId = body?.eventId ? String(body.eventId) : "";
  const roleId = body?.roleId ? String(body.roleId) : "";
  const kennitala = body?.kennitala ? String(body.kennitala) : "";
  if (!eventId || !roleId || !kennitala) return json({ error: "Missing required fields" }, 400);

  const { data: member } = await admin.from("members").select("id, kennitala, name")
    .eq("kennitala", kennitala).maybeSingle();
  const memberId = member ? member.id : null;

  const { data: existingForRole } = await admin.from("volunteer_signups")
    .select("id, member_id").eq("event_id", eventId).eq("role_id", roleId);
  if (memberId && (existingForRole || []).some((s) => s.member_id === memberId)) {
    return json({ error: "Already signed up for this role" }, 400);
  }

  let evt = (await admin.from("activities").select("*").eq("id", eventId).maybeSingle()).data;

  if (!evt && body?.virtualEvent && eventId.indexOf("vae-") === 0) {
    const ve = body.virtualEvent as Record<string, unknown>;
    const { data: materialized, error: matErr } = await admin.from("activities").insert({
      id: eventId,
      signup_required: true,
      status: "upcoming",
      source: "bulk",
      activity_type_id: asUuid(ve.activityTypeId || ve.sourceActivityTypeId),
      source_activity_type_id: asUuid(ve.sourceActivityTypeId),
      source_subtype_id: asUuid(ve.sourceSubtypeId),
      title: String(ve.title || ""),
      title_is: String(ve.titleIS || ""),
      subtype_name: String(ve.subtitle || ""),
      date: ve.date || null,
      end_date: ve.endDate || null,
      start_time: ve.startTime || null,
      end_time: ve.endTime || null,
      roles: Array.isArray(ve.roles) ? ve.roles : [],
    }).select("*").single();
    if (!matErr) evt = materialized;
  }
  if (!evt) return json({ error: "Event not found" }, 404);

  const roles: any[] = Array.isArray(evt.roles) ? evt.roles : [];
  const role = roles.find((r) => r && r.id === roleId);
  if (!role) return json({ error: "Role not found" }, 404);

  const { count: filled } = await admin.from("volunteer_signups")
    .select("id", { count: "exact", head: true }).eq("event_id", eventId).eq("role_id", roleId);
  if (role.slots && (filled || 0) >= Number(role.slots)) return json({ error: "Role is full" }, 400);

  const ts = new Date().toISOString();
  const { data: inserted, error } = await admin.from("volunteer_signups").insert({
    event_id: eventId,
    role_id: roleId,
    member_id: memberId,
    signed_up_at: ts,
  }).select("id").single();
  if (error) return json({ error: "volunteerSignup failed: " + error.message }, 500);

  const signup = {
    id: inserted.id,
    eventId,
    roleId,
    kennitala,
    name: String(body?.name || (member && member.name) || ""),
    signedUpAt: ts,
  };
  return json({ id: inserted.id, signup });
});
