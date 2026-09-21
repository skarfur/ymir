import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Ports maintenance.gs's getMaintenance_ — a plain readAll_('maintenance')
// in the Sheets version, translated into the flat camelCase DTO
// maintenance.js/saumaklubbur.js/member.js read directly instead of raw
// snake_case columns. boat_name is now a real denormalized column (see the
// fix_maintenance_write_port_fields migration) so this reads it straight
// off the row, matching the Sheets SCHEMA_.maintenance shape exactly — no
// join needed.
//
// Extracted from get-maintenance/index.ts (which now just calls this) so
// get-captain-bundle can pull the same read into its combined response
// without duplicating it — see that function's header for why.

function toDto(r: any) {
  return {
    id: r.id,
    category: r.category || "boat",
    boatId: r.boat_id || "",
    boatName: r.boat_name || "",
    itemName: r.item_name || "",
    part: r.part || "",
    severity: r.severity || "medium",
    description: r.description || "",
    photoUrl: r.photo_url || "",
    markOos: !!r.mark_oos,
    reportedBy: r.reported_by || "",
    source: r.source || "staff",
    createdAt: r.created_at,
    resolved: !!r.resolved,
    resolvedBy: r.resolved_by || "",
    resolvedAt: r.resolved_at || "",
    comments: r.comments ? JSON.stringify(r.comments) : "[]",
    saumaklubbur: !!r.saumaklubbur,
    verkstjori: r.verkstjori || "",
    materials: r.materials ? JSON.stringify(r.materials) : "[]",
    approved: !!r.approved,
    onHold: !!r.on_hold,
    followers: r.followers ? JSON.stringify(r.followers) : "[]",
    updatedAt: r.updated_at,
  };
}

export async function buildMaintenance(admin: SupabaseClient): Promise<any> {
  const { data: all, error } = await admin.from("maintenance").select("*");
  if (error) throw new Error("Maintenance lookup failed");
  return { requests: (all || []).map(toDto) };
}
