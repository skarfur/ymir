import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's checkIn_ — flips status to 'in' and stamps
// checked_in_at. Callable by any authenticated member (self check-in from
// member/, or staff/ checking someone else in) — not staff-gated, matching
// the original (not in STAFF_ACTIONS_).
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function timeToTimestamptz(hhmm: unknown, dateISO: string): string | null {
  if (!hhmm) return null;
  const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${dateISO}T${m[1].padStart(2, "0")}:${m[2]}:00Z`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const id = body?.id ? String(body.id) : "";
  if (!id) return json({ error: "id required" }, 400);

  const date = todayUtc();
  const checkedInAtTs = timeToTimestamptz(body?.timeIn, date) || new Date().toISOString();

  const updates: Record<string, unknown> = {
    status: "in",
    checked_in_at: checkedInAtTs,
    actor_id: session.memberId,
  };
  if (body?.afterSailChecklist) {
    try {
      updates.after_sail_checklist = typeof body.afterSailChecklist === "string"
        ? JSON.parse(body.afterSailChecklist as string)
        : body.afterSailChecklist;
    } catch { /* ignore malformed checklist */ }
  }

  const { error } = await admin.from("checkouts").update(updates).eq("id", id);
  if (error) return json({ error: "Check-in failed: " + error.message }, 500);

  return json({ updated: true, checkedInAt: checkedInAtTs.slice(11, 16) });
});
