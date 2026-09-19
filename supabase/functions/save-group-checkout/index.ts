import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's saveGroupCheckout_ — staff/admin only (matches
// STAFF_ACTIONS_.saveGroupCheckout in code.gs), a group sail (courses,
// events) covering multiple boats/staff/participants under one checkout
// row rather than one row per sailor.
//
// boat_id (singular) is deliberately left null — the Sheets version stored
// a comma-joined id string there (`boatIds.join(',')`), which doesn't fit
// a real uuid FK. boat_ids (plural, jsonb) is the real list; boat_id was
// never read for group rows on the frontend (group cards render from
// boatNames/boatIds, not the singular field).
//
// The three activity-association flavors (linkedActivityId / classTag /
// newActivity) are ported as-is: newActivity mints an ad-hoc `activities`
// row (status='upcoming', source='manual') and its real uuid becomes
// linkedActivityId.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseWx(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const w = (typeof raw === "string" ? JSON.parse(raw) : raw) as any;
    const wsVal = (typeof w.ws === "string" && w.ws.indexOf("-") !== -1) ? w.ws : (w.ws != null ? Math.round(w.ws) : 0);
    return {
      bft: Math.round(w.bft || 0), ws: wsVal, wg: Math.round(w.wg || 0),
      dir: w.dir || w.wDir || "",
      wv: w.wv != null ? Math.round(w.wv * 10) / 10 : null,
      flag: w.flag || "",
      tc: w.tc != null ? Math.round(w.tc) : null,
      ts: w.ts || new Date().toISOString(),
    };
  } catch { return null; }
}

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function timeToTimestamptz(hhmm: unknown, dateISO: string): string | null {
  if (!hhmm) return null;
  const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${dateISO}T${m[1].padStart(2, "0")}:${m[2]}:00Z`;
}
function toArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (!v) return [];
  try { const p = typeof v === "string" ? JSON.parse(v as string) : v; return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
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

  const boatIds = toArr(body?.boatIds);
  const boatNames = toArr(body?.boatNames);
  const staffNames = toArr(body?.staffNames);
  const staffKennitalar = toArr(body?.staffKennitalar);

  let linkedActivityId = body?.linkedActivityId ? String(body.linkedActivityId) : "";
  let classTag = body?.classTag ? String(body.classTag) : "";

  const newActivity = body?.newActivity as Record<string, unknown> | null | undefined;
  if (newActivity && typeof newActivity === "object" && (newActivity.name || newActivity.classTag)) {
    const date = todayUtc();
    const startTime = (newActivity.startTime as string) || (body?.checkedOutAt as string) || "";
    const endTime = (newActivity.endTime as string) || (body?.expectedReturn as string) || "";
    const { data: newAct, error: actErr } = await admin.from("activities").insert({
      signup_required: false,
      status: "upcoming",
      source: "manual",
      date,
      start_time: startTime || null,
      end_time: endTime || null,
      title: String(newActivity.name || newActivity.classTag || ""),
      actor_id: session.memberId,
    }).select("id").single();
    if (!actErr && newAct) linkedActivityId = newAct.id;
    if (!classTag) classTag = String(newActivity.classTag || "");
  }

  const locationIdIn = body?.locationId ? String(body.locationId) : "";
  let location_id: string | null = null;
  if (locationIdIn && UUID_RE.test(locationIdIn)) {
    const { data: loc } = await admin.from("locations").select("id").eq("id", locationIdIn).maybeSingle();
    if (loc) location_id = loc.id;
  }

  const activityTypeIdIn = body?.activityTypeId ? String(body.activityTypeId) : "";
  const activity_type_id = activityTypeIdIn && UUID_RE.test(activityTypeIdIn) ? activityTypeIdIn : null;

  const participants = parseInt(String(body?.participants || "0"), 10) || 0;
  const crewCount = parseInt(String(body?.crew || ""), 10) || (participants + staffNames.length);

  const date = todayUtc();
  const row: Record<string, unknown> = {
    boat_id: null, // see file header — no real single-boat FK for a group row
    boat_ids: boatIds,
    boat_name: boatNames.join(", "),
    boat_names: boatNames,
    boat_category: String(body?.boatCategory || ""),
    member_id: null,
    member_kennitala: "",
    member_name: staffNames.length ? staffNames.join(", ") : "Group",
    crew_count: crewCount,
    location_id,
    location_name: String(body?.locationName || ""),
    expected_return: timeToTimestamptz(body?.expectedReturn, date),
    wx_snapshot: parseWx(body?.wxSnapshot),
    notes: "",
    status: "out",
    is_group: true,
    participants_count: participants,
    staff_names: staffNames,
    staff_kennitalar: staffKennitalar,
    activity_type_id,
    activity_type_name: String(body?.activityTypeName || ""),
    linked_activity_id: linkedActivityId || null,
    class_tag: classTag,
    actor_id: session.memberId,
  };
  const checkedOutAt = timeToTimestamptz(body?.checkedOutAt, date);
  if (checkedOutAt) row.checked_out_at = checkedOutAt;

  const { data: inserted, error } = await admin.from("checkouts").insert(row).select("id").single();
  if (error) return json({ error: "Group checkout save failed: " + error.message }, 500);

  return json({ id: inserted.id, created: true, linkedActivityId, classTag });
});
