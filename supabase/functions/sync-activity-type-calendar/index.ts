import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";
import { syncClassRecurringEvent, deleteClassRecurringEvent } from "../_shared/gcal.ts";

// Google Calendar push for activity templates — the piece save_activity_type
// / delete_activity_type (Postgres RPCs, see
// 20260922100000_activity_templates_table.sql) can't do themselves, since a
// plpgsql function has no way to call an external HTTPS API. Ported from
// checkouts.gs's syncClassRecurringEvent_ (see _shared/gcal.ts).
//
// admin/act-types.js calls this AFTER the RPC write succeeds — save/delete
// stay RPC calls (so RLS's is_admin() sees the real caller via the
// request's own JWT, same as every other admin write), and this function
// does the calendar side as an independent, best-effort second step. A
// calendar failure here never undoes the already-saved template — same
// "log and move on" contract syncClassRecurringEvent_ had.
//
// Two call shapes:
//   - save path:   { sessionToken, id } — re-reads the template row by id
//     and upserts/tears down its master recurring event accordingly.
//   - delete path: { sessionToken, deleted: true, calendarId,
//     gcalSeriesEventId } — the row is already gone by the time this runs,
//     so the caller passes what it captured from local state before
//     deleting.

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
  if (session.role !== "admin") return json({ error: "Admin only" }, 403);

  try {
    if (body?.deleted === true) {
      const calendarId = String(body?.calendarId || "");
      const gcalSeriesEventId = String(body?.gcalSeriesEventId || "");
      await deleteClassRecurringEvent(calendarId, gcalSeriesEventId);
      return json({ gcalSeriesEventId: "" });
    }

    const id = String(body?.id || "");
    if (!id) return json({ error: "id required" }, 400);

    const { data: row, error } = await admin
      .from("activity_templates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return json({ error: "Lookup failed" }, 500);
    if (!row) return json({ gcalSeriesEventId: "" });

    const tmpl = {
      id: row.id,
      name: row.name || "",
      nameIS: row.name_is || "",
      active: row.active,
      classTag: row.class_tag || "",
      calendarId: row.calendar_id || "",
      calendarSyncActive: !!row.calendar_sync_active,
      defaultStart: row.default_start || "",
      defaultEnd: row.default_end || "",
      bulkSchedule: row.bulk_schedule || null,
      gcalSeriesEventId: row.gcal_series_event_id || "",
    };

    const gcalId = await syncClassRecurringEvent(tmpl);
    if (gcalId !== tmpl.gcalSeriesEventId) {
      await admin.from("activity_templates").update({ gcal_series_event_id: gcalId || "" }).eq("id", id);
    }
    return json({ gcalSeriesEventId: gcalId || "" });
  } catch (e) {
    return json({ error: (e as Error).message || "Calendar sync failed" }, 500);
  }
});
