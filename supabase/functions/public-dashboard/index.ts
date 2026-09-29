import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createAdminClient } from "../_shared/session.ts";

// Ports public.gs's publicDashboard_ — the data behind /public/, the
// club's anonymous dashboard (on the water now, YTD trip stats + location
// heatmap, active member count, captain profiles, staff duty status, flag
// config). Same response shape as the Apps Script version so
// public/public.js renders it unchanged.
//
// Public: no session, deployed with verify_jwt disabled like login. That
// matches the Apps Script endpoint, which was in PUBLIC_ACTIONS_. It only
// returns the aggregate / captain-profile fields the old endpoint already
// exposed — no kennitala, phone or email leaves this function.
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

function certLabel(c: any, certDefs: any[]) {
  const def = c.certId ? certDefs.find((d) => d.id === c.certId) : null;
  const subcats = def && Array.isArray(def.subcats) ? def.subcats : [];
  const subcat = subcats.find((s: any) => s.key === c.sub) || null;
  const defEN = def ? (def.name_en || "") : "";
  const defIS = def ? (def.name_is || "") : "";
  const scEN = subcat ? (subcat.labelEN || subcat.label || "") : "";
  const scIS = subcat ? (subcat.labelIS || "") : "";
  let labelEN: string, labelIS: string;
  if (c.title) {
    labelEN = c.title; labelIS = c.title;
  } else if (subcat) {
    labelEN = (defEN || c.certId || "Unknown") + " — " + scEN;
    labelIS = (defIS || defEN || c.certId || "Unknown") + " — " + (scIS || scEN);
  } else if (def) {
    labelEN = defEN || c.certId || "Unknown";
    labelIS = defIS || defEN || c.certId || "Unknown";
  } else {
    labelEN = c.certId || "Unknown";
    labelIS = labelEN;
  }
  return { certId: c.certId, sub: c.sub || "", label: labelEN, labelEN, labelIS };
}

async function buildDashboard(admin: SupabaseClient): Promise<any> {
  const [configRes, boatsRes, locationsRes, certDefsRes, checkouts, members, trips] = await Promise.all([
    admin.from("app_config").select("key, value").in("key", ["boatCategories", "staffStatus", "flagConfig"]),
    admin.from("boats").select("id, category, type_model"),
    admin.from("locations").select("id, name, coordinates"),
    admin.from("cert_defs").select("id, name_en, name_is, subcats"),
    selectAll(admin, "checkouts",
      "id, boat_name, boat_names, boat_category, location_name, crew_count, is_group, participants_count, staff_names",
      (q) => q.eq("status", "out")),
    selectAll(admin, "members", "id, name, role, certifications, bio, headshot_url", (q) => q.eq("active", true)),
    selectAll(admin, "trips",
      "id, member_id, date, role, hours_decimal, distance_nm, boat_id, boat_name, boat_category, location_id, location_name, departure_port, crew_count, track_simplified"),
  ]);
  if (configRes.error) throw new Error("Config lookup failed");
  if (boatsRes.error) throw new Error("Boats lookup failed");
  if (locationsRes.error) throw new Error("Locations lookup failed");
  if (certDefsRes.error) throw new Error("Cert defs lookup failed");

  const cfg: Record<string, any> = {};
  (configRes.data || []).forEach((r) => { cfg[r.key] = r.value; });
  const boatCategories: any[] = Array.isArray(cfg.boatCategories) ? cfg.boatCategories : [];
  const certDefs = certDefsRes.data || [];

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

  // ── Captains ──
  const activeMembers = members.filter((m) => m.role !== "guest").length;
  const tripsByMember: Record<string, any[]> = {};
  trips.forEach((t) => {
    if (t.member_id && (t.role === "skipper" || t.role === "captain")) (tripsByMember[t.member_id] ||= []).push(t);
  });

  const captains: any[] = [];
  members.forEach((m) => {
    const certs = Array.isArray(m.certifications) ? m.certifications : [];
    if (!certs.some((c: any) => c && c.sub === "captain")) return;

    const captTrips = (tripsByMember[m.id] || [])
      .slice()
      .sort((a, b) => (String(b.date || "") > String(a.date || "") ? 1 : -1));
    let captHours = 0, captDist = 0;
    captTrips.forEach((t) => { captHours += Number(t.hours_decimal) || 0; captDist += Number(t.distance_nm) || 0; });

    const tripRows = captTrips.map((t) => ({
      date: t.date || "",
      boatName: t.boat_name || "",
      makeModel: boatMap[t.boat_id]?.type_model || "",
      location: t.location_name || t.departure_port || "",
      crew: Number(t.crew_count) || 1,
      duration: t.hours_decimal ? Number(t.hours_decimal).toFixed(1) : "",
      distance: t.distance_nm ? Number(t.distance_nm).toFixed(1) : "",
    }));

    const captLocStats: Record<string, { count: number; hours: number }> = {};
    captTrips.forEach((t) => {
      const lid = t.location_id || "";
      if (!lid) return;
      (captLocStats[lid] ||= { count: 0, hours: 0 });
      captLocStats[lid].count++; captLocStats[lid].hours += Number(t.hours_decimal) || 0;
    });
    const captLocData: any[] = [];
    Object.keys(captLocStats).forEach((lid) => {
      const loc = locMap[lid];
      const ll = loc && parseCoords(loc.coordinates);
      if (!ll) return;
      captLocData.push({ name: loc.name || lid, lat: ll.lat, lng: ll.lng, count: captLocStats[lid].count, hours: round1(captLocStats[lid].hours) });
    });

    const trackLines: any[] = [];
    captTrips.forEach((t) => {
      let pts = t.track_simplified;
      if (typeof pts === "string") { try { pts = JSON.parse(pts); } catch { pts = null; } }
      if (Array.isArray(pts) && pts.length >= 2) {
        trackLines.push(pts.filter((p: any) => p && typeof p.lat === "number" && typeof p.lng === "number"));
      }
    });

    captains.push({
      id: m.id,
      name: m.name || "",
      bio: m.bio || "",
      headshotUrl: m.headshot_url || "",
      certs: certs.map((c: any) => certLabel(c || {}, certDefs)),
      tripCount: captTrips.length,
      totalHours: round1(captHours),
      totalDist: round1(captDist),
      // The Apps Script ?action=captain record page has no Supabase
      // equivalent yet; public.js doesn't render this link.
      captainRecordUrl: "",
      trips: tripRows,
      locations: captLocData,
      trackLines,
    });
  });

  return {
    success: true,
    ytd: { totalTrips: ytdTrips.length, totalHours: round1(totalHours), byCategory },
    locations,
    onWater: { boatCount, peopleCount, boats: onWaterBoats },
    activeMembers,
    captains,
    boatCategories: boatCategories.map((c) => ({ key: c.key, labelEN: c.labelEN || c.key, labelIS: c.labelIS || "", emoji: c.emoji || "" })),
    staffStatus: cfg.staffStatus ?? null,
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
