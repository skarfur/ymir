import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports members.gs's getMembers_. Translates this table's snake_case,
// normalized shape back into the camelCase shape the frontend already
// expects (matching SCHEMA_.members field names):
//   - isMinor is computed from birth_year at read time, never stored
//     (age changes with the calendar, not the row — see the members-table
//     migration's note).
//   - guardianName/guardianKennitala/guardianPhone come from a join
//     against the guardians table (first guardian per member), since
//     those moved off members onto their own table in this schema.
//   - password_hash is never included in the response, same as the Sheets
//     version stripping passwordHash; hasPassword mirrors its logic
//     exactly (a real hash set, and not a temp password).
//
// Requires a valid session — getMembers isn't in Apps Script's
// PUBLIC_ACTIONS_ either, and (checked against code.gs's ADMIN_ACTIONS_/
// STAFF_ACTIONS_) isn't role-gated there either: any authenticated member
// can call it and get the full sanitized roster today, in both versions.
// Not a gap this port introduces — but worth knowing before real member
// data goes in, since "any session" is looser than "admin only."

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

  const { data: all, error } = await admin.from("members").select("*");
  if (error) return json({ error: "Members lookup failed" }, 500);

  const memberIds = (all || []).map((m) => m.id);
  let guardianByMember: Record<string, any> = {};
  if (memberIds.length) {
    const { data: guardians } = await admin
      .from("guardians")
      .select("member_id, name, kennitala, phone")
      .in("member_id", memberIds);
    (guardians || []).forEach((g) => {
      if (!guardianByMember[g.member_id]) guardianByMember[g.member_id] = g;
    });
  }

  const currentYear = new Date().getUTCFullYear();
  const sanitized = (all || []).map((m) => {
    const g = guardianByMember[m.id];
    return {
      id: m.id,
      kennitala: m.kennitala,
      name: m.name,
      role: m.role,
      email: m.email || "",
      phone: m.phone || "",
      birthYear: m.birth_year,
      isMinor: !!(m.birth_year && currentYear - m.birth_year < 18),
      guardianName: (g && g.name) || "",
      guardianKennitala: (g && g.kennitala) || "",
      guardianPhone: (g && g.phone) || "",
      active: m.active,
      certifications: m.certifications || [],
      initials: m.initials || "",
      preferences: m.preferences || {},
      googleEmail: m.google_email || "",
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      hasPassword: !!(m.password_hash && !m.password_is_temp),
    };
  });

  const offset = parseInt(String(body?.offset || "0"), 10) || 0;
  const limit = parseInt(String(body?.limit || "0"), 10) || 0;
  if (limit > 0) {
    return json({ members: sanitized.slice(offset, offset + limit), total: sanitized.length });
  }
  return json({ members: sanitized });
});
