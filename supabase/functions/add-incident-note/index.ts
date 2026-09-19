import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports incidents.gs's addIncidentNote_ — staff/admin only (matches
// STAFF_ACTIONS_.addIncidentNote in code.gs). staff_notes/reviewer_notes
// are stored as JSON-stringified arrays of {by, at, text}, same shape as
// the Sheets column.
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
  if (session.role !== "staff" && session.role !== "admin") return json({ error: "Staff only" }, 403);

  const id = body?.id ? String(body.id) : "";
  if (!id) return json({ error: "id required" }, 400);

  const field = body?.kind === "reviewer" ? "reviewer_notes" : "staff_notes";
  const { data: ex } = await admin.from("incidents").select(field).eq("id", id).maybeSingle();

  let notes: unknown[] = [];
  try { notes = ex && (ex as Record<string, unknown>)[field] ? JSON.parse((ex as Record<string, unknown>)[field] as string) : []; } catch { notes = []; }
  notes.push({ by: body?.by || "", at: new Date().toISOString(), text: body?.text || "" });

  const updates: Record<string, unknown> = {};
  updates[field] = JSON.stringify(notes);

  const { error } = await admin.from("incidents").update(updates).eq("id", id);
  if (error) return json({ error: "Note save failed: " + error.message }, 500);

  return json({ updated: true });
});
