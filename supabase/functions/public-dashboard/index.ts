import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Ports public.gs's publicDashboard_ — the data behind /public/, the
// club's anonymous dashboard (on the water now, YTD trip stats + location
// heatmap, active member count, staff duty status, flag config). Same
// response shape as the Apps Script version, minus `captains`: the public
// page no longer shows per-captain profiles, trips or GPS tracks, so none of
// that is read or returned here.
//
// Public: no session, deployed with verify_jwt disabled like login. That
// matches the Apps Script endpoint, which was in PUBLIC_ACTIONS_. It only
// returns aggregate counts plus boat/location names — no member names,
// kennitala, phone or email leaves this function.
//
// The old version cached for 15s (CacheService) because it aggregates every
// trip on each hit; this keeps the same TTL in-isolate, and concurrent
// misses share one in-flight build so a burst of anonymous traffic can't
// fan out into a burst of full-table reads.

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

// Inlined rather than imported from _shared/session.ts so this public
// function doesn't bundle the session/JWT-signing code it never uses.
function createAdminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

const CACHE_TTL_MS = 15 * 1000;
// PostgREST caps a single select at 1000 rows; trips outgrows that.
const PAGE = 1000;

const round1 = (n: number) => Math.round(n * 10) / 10;

async function selectAll(admin: SupabaseClient, table: string, cols: string, filter?: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = admin.from(table).select(cols).order("id").range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} lookup failed`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

function parseCoords(coords: unknown): { lat: number; lng: number } | null {
  if (!coords) return null;
  const parts = String(coords).split(",");
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0]), lng = parseFloat(parts[1]);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

async function buildDashboard(admin: SupabaseClient): Promise<any> {
  const [configRes, boatsRes, locationsRes, checkouts, members, trips] = await Promise.all([
    admin.from("app_config").select("key, value").in("key", ["boatCategories", "staffStatus", "flagConfig"]),
    admin.from("boats").select("id, category"),
    admin.from("locations").select("id, name, coordinates"),
    selectAll(admin, "checkouts",
      "id, boat_name, boat_names, boat_category, location_name, crew_count, is_group, participants_count, staff_names",
      (q) => q.eq("status", "out")),
    selectAll(admin, "members", "id, role", (q) => q.eq("active", true)),
    selectAll(admin, "trips",
      "id, date, hours_decimal, boat_id, boat_category, location_id",
      (q) => q.gte("date", new Date().getFullYear() + "-01-01")),
  ]);
  if (configRes.error) throw new Error("Config lookup failed");
  if (boatsRes.error) throw new Error("Boats lookup failed");
  if (locationsRes.error) throw new Error("Locations lookup failed");

  const cfg: Record<string, any> = {};
  (configRes.data || []).forEach((r) => { cfg[r.key] = r.value; });
  const boatCategories: any[] = Array.isArray(cfg.boatCategories) ? cfg.boatCategories : [];

  const catMap: Record<string, any> = {};
  boatCategories.forEach((c) => { catMap[c.key] = c; });
  const locMap: Record<string, any> = {};
  (locationsRes.data || []).forEach((l) => { locMap[l.id] = l; });
  const boatMap: Record<string, any> = {};
  (boatsRes.data || []).forEach((b) => { boatMap[b.id] = b; });

  // ── YTD trips ──
  const yearStart = new Date().getFullYear() + "-01-01";
  const ytdTrips = trips.filter((t) => String(t.date || "") >= yearStart);
  let totalHours = 0;
  const catStats: Record<string, { count: number; hours: number }> = {};
  const locStats: Record<string, { count: number; hours: number }> = {};
  ytdTrips.forEach((t) => {
    const hrs = Number(t.hours_decimal) || 0;
    totalHours += hrs;
    const cat = t.boat_category || boatMap[t.boat_id]?.category || "";
    if (cat) {
      (catStats[cat] ||= { count: 0, hours: 0 });
      catStats[cat].count++; catStats[cat].hours += hrs;
    }
    const lid = t.location_id || "";
    if (lid) {
      (locStats[lid] ||= { count: 0, hours: 0 });
      locStats[lid].count++; locStats[lid].hours += hrs;
    }
  });

  const byCategory = boatCategories.map((c) => {
    const st = catStats[c.key] || { count: 0, hours: 0 };
    return {
      key: c.key, labelEN: c.labelEN || c.key, labelIS: c.labelIS || c.labelEN || c.key,
      emoji: c.emoji || "", count: st.count, hours: round1(st.hours),
    };
  }).filter((c) => c.count > 0);

  const locations: any[] = [];
  Object.keys(locStats).forEach((lid) => {
    const loc = locMap[lid];
    const ll = loc && parseCoords(loc.coordinates);
    if (!ll) return;
    locations.push({
      id: lid, name: loc.name || lid, lat: ll.lat, lng: ll.lng,
      tripCount: locStats[lid].count, totalHours: round1(locStats[lid].hours),
    });
  });

  // ── On the water ──
  let boatCount = 0, peopleCount = 0;
  const onWaterBoats: any[] = [];
  checkouts.forEach((c) => {
    if (c.is_group) {
      const names: string[] = Array.isArray(c.boat_names) && c.boat_names.length
        ? c.boat_names.map(String)
        : String(c.boat_name || "").split(",");
      boatCount += names.length || 1;
      peopleCount += (Number(c.participants_count) || 0) + (Array.isArray(c.staff_names) ? c.staff_names.length : 0);
      names.forEach((bn) => onWaterBoats.push({
        boatName: bn.trim(), boatCategory: c.boat_category || "", locationName: c.location_name || "",
      }));
    } else {
      boatCount += 1;
      peopleCount += Number(c.crew_count) || 1;
      onWaterBoats.push({ boatName: c.boat_name || "", boatCategory: c.boat_category || "", locationName: c.location_name || "" });
    }
  });
  onWaterBoats.forEach((b) => { b.emoji = catMap[b.boatCategory]?.emoji || ""; });

  // ── Members ──
  const activeMembers = members.filter((m) => m.role !== "guest").length;

  return {
    success: true,
    ytd: { totalTrips: ytdTrips.length, totalHours: round1(totalHours), byCategory },
    locations,
    onWater: { boatCount, peopleCount, boats: onWaterBoats },
    activeMembers,
    boatCategories: boatCategories.map((c) => ({ key: c.key, labelEN: c.labelEN || c.key, labelIS: c.labelIS || "", emoji: c.emoji || "" })),
    // Only the two flags public.js shows — not updatedByName.
    staffStatus: cfg.staffStatus
      ? { onDuty: !!cfg.staffStatus.onDuty, supportBoat: !!cfg.staffStatus.supportBoat }
      : null,
    flagConfig: cfg.flagConfig ?? null,
  };
}

let cached: { at: number; body: any } | null = null;
let inflight: Promise<any> | null = null;

function getDashboard(): Promise<any> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.body);
  if (!inflight) {
    inflight = buildDashboard(createAdminClient())
      .then((body) => { cached = { at: Date.now(), body }; return body; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    return json(await getDashboard());
  } catch (e) {
    return json({ error: (e as Error).message || "Dashboard failed" }, 500);
  }
});
