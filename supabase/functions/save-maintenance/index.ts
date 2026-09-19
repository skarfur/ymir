import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports maintenance.gs's saveMaintenance_ — id present -> patch only
// supplied fields; otherwise insert. Any authenticated session.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const id = body?.id ? String(body.id) : "";

  if (id) {
    const updates: Record<string, unknown> = {};
    if (body.severity !== undefined) updates.severity = String(body.severity);
    if (body.markOos !== undefined) updates.mark_oos = !!body.markOos;
    if (body.comments !== undefined) updates.comments = typeof body.comments === "string" ? JSON.parse(body.comments as string || "[]") : body.comments;
    if (body.onHold !== undefined) updates.on_hold = !!body.onHold;
    if (body.verkstjori !== undefined) updates.verkstjori = String(body.verkstjori || "");
    if (body.materials !== undefined) updates.materials = typeof body.materials === "string" ? JSON.parse(body.materials as string || "[]") : body.materials;
    if (body.approved !== undefined) updates.approved = !!body.approved;
    if (body.category !== undefined) updates.category = String(body.category);
    if (body.boatId !== undefined) updates.boat_id = String(body.boatId) && UUID_RE.test(String(body.boatId)) ? String(body.boatId) : null;
    if (body.boatName !== undefined) updates.boat_name = String(body.boatName || "");
    if (body.part !== undefined) updates.part = String(body.part);
    if (body.description !== undefined) updates.description = String(body.description);
    if (body.photoUrl !== undefined) updates.photo_url = String(body.photoUrl);

    if (Object.keys(updates).length) {
      updates.updated_at = new Date().toISOString();
      const { error } = await admin.from("maintenance").update(updates).eq("id", id);
      if (error) return json({ error: "Maintenance save failed: " + error.message }, 500);
      return json({ id, updated: true });
    }
    return json({ id, noChanges: true });
  }

  const boatIdIn = body?.boatId ? String(body.boatId) : "";
  const isSauma = !!body?.saumaklubbur;
  const isStaffSource = (body?.source || "staff") === "staff";
  const { data: inserted, error } = await admin.from("maintenance").insert({
    category: String(body?.category || "boat"),
    boat_id: boatIdIn && UUID_RE.test(boatIdIn) ? boatIdIn : null,
    boat_name: String(body?.boatName || ""),
    item_name: String(body?.itemName || ""),
    part: String(body?.part || ""),
    severity: String(body?.severity || "medium"),
    description: String(body?.description || ""),
    photo_url: String(body?.photoUrl || ""),
    mark_oos: !!body?.markOos,
    reported_by: String(body?.reportedBy || ""),
    source: String(body?.source || "staff"),
    resolved: false,
    comments: [],
    saumaklubbur: isSauma,
    verkstjori: String(body?.verkstjori || ""),
    materials: [],
    approved: isSauma && !isStaffSource ? false : true,
    followers: [],
  }).select("id").single();
  if (error) return json({ error: "Maintenance save failed: " + error.message }, 500);

  return json({ id: inserted.id, created: true });
});
