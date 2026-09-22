import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Ports members.gs's getMembers_ (and publicMember_ for the shape a single
// member's own record takes, e.g. in login's response). Translates this
// table's snake_case, normalized shape back into the camelCase shape the
// frontend already expects (matching SCHEMA_.members field names):
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
// toMemberDto is shared with login/index.ts — that function used to
// build its own trimmed-down {id,kennitala,name,role} object, silently
// dropping certifications/preferences/bio/etc. from the response every
// other GAS-era caller (and validate_member) expects on the stored user
// record. That regression is what broke every cert-gated page (captain,
// coxswain) immediately after a Supabase-routed login: isCaptain()/
// hasRowingEndorsement() read user.certifications, which was always
// undefined. Both callers now build the DTO from this one function so
// it can't drift out of sync again.
//
// Extracted from get-members/index.ts (which now just calls buildMembers)
// so get-captain-bundle can pull the same read into its combined response
// without duplicating it.

export function toMemberDto(m: any, guardian?: any) {
  const currentYear = new Date().getUTCFullYear();
  return {
    id: m.id,
    kennitala: m.kennitala,
    name: m.name,
    role: m.role,
    email: m.email || "",
    phone: m.phone || "",
    birthYear: m.birth_year,
    isMinor: !!(m.birth_year && currentYear - m.birth_year < 18),
    guardianName: (guardian && guardian.name) || "",
    guardianKennitala: (guardian && guardian.kennitala) || "",
    guardianPhone: (guardian && guardian.phone) || "",
    active: m.active,
    certifications: m.certifications || [],
    initials: m.initials || "",
    preferences: m.preferences || {},
    bio: m.bio || "",
    headshotUrl: m.headshot_url || "",
    googleEmail: m.google_email || "",
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    hasPassword: !!(m.password_hash && !m.password_is_temp),
  };
}

export interface MembersQuery {
  offset?: number;
  limit?: number;
}

export async function buildMembers(admin: SupabaseClient, q: MembersQuery = {}): Promise<any> {
  const { data: all, error } = await admin.from("members").select("*");
  if (error) throw new Error("Members lookup failed");

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

  const sanitized = (all || []).map((m) => toMemberDto(m, guardianByMember[m.id]));

  const offset = q.offset || 0;
  const limit = q.limit || 0;
  if (limit > 0) {
    return { members: sanitized.slice(offset, offset + limit), total: sanitized.length };
  }
  return { members: sanitized };
}
