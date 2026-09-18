import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports checkouts.gs's getActiveCheckouts_ (core filter + member/guardian
// enrichment). member_id is a real FK here (not a kennitala-string map
// build like the Sheets version), so enrichment is a direct lookup rather
// than building a whole-table map first. memberIsMinor is computed from
// birth_year at read time (age changes with the calendar, not the row —
// see the members-table migration's note; it was never stored).
//
// Deliberately stubbed: buildGroupLabelMap_'s group-sail label resolution
// (checkout.linkedActivityId / activities.linkedGroupCheckoutIds /
// activityTypeName chain) — every checkout gets groupLabel: '' for now.
// Moot regardless: both checkouts and activities are empty tables.
//
// Requires a valid session — getActiveCheckouts isn't in Apps Script's
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

  const todayUtc = new Date().toISOString().slice(0, 10);
  const date = body?.date ? String(body.date).slice(0, 10) : "";

  const { data: all, error } = await admin.from("checkouts").select("*");
  if (error) return json({ error: "Checkouts lookup failed" }, 500);

  let result: any[];
  if (date && date !== todayUtc) {
    result = (all || []).filter((c) => String(c.created_at || "").slice(0, 10) === date);
  } else {
    result = (all || []).filter(
      (c) => c.status === "out" || (c.status === "in" && String(c.created_at || "").slice(0, 10) === todayUtc),
    );
  }

  const memberIds = [...new Set(result.map((c) => c.member_id).filter(Boolean))];

  let memberById: Record<string, any> = {};
  let guardianByMember: Record<string, any> = {};
  if (memberIds.length) {
    const [{ data: members }, { data: guardians }] = await Promise.all([
      admin.from("members").select("id, phone, birth_year").in("id", memberIds),
      admin.from("guardians").select("member_id, name, phone").in("member_id", memberIds),
    ]);
    (members || []).forEach((m) => { memberById[m.id] = m; });
    // First guardian per member, matching the Sheets model's one-guardian-
    // per-member assumption (a member row had one guardianName/Phone pair).
    (guardians || []).forEach((g) => {
      if (!guardianByMember[g.member_id]) guardianByMember[g.member_id] = g;
    });
  }

  const currentYear = new Date().getUTCFullYear();
  const enriched = result.map((c) => {
    const m = c.member_id ? memberById[c.member_id] : null;
    const g = c.member_id ? guardianByMember[c.member_id] : null;
    const isMinor = c.member_is_minor != null
      ? !!c.member_is_minor
      : !!(m && m.birth_year && currentYear - m.birth_year < 18);
    return {
      ...c,
      memberPhone: c.member_phone || (m && m.phone) || "",
      memberIsMinor: isMinor,
      guardianName: c.guardian_name || (g && g.name) || "",
      guardianPhone: c.guardian_phone || (g && g.phone) || "",
      groupLabel: "", // stubbed — see file header
    };
  });

  return json({ checkouts: enriched });
});
