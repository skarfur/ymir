import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports weather.gs's getWeather_ — current BIRK (Reykjavíkurflugvöllur)
// observations, reshaped into the same `{obs:{...}}` envelope the frontend
// already consumes. Two upstreams are fetched in parallel and the newer
// observation wins:
//
//   - METAR BIRK via aviationweather.gov's JSON API. Issued every 30 min
//     (:00 and :30) plus SPECI reports on significant changes, so it's
//     usually fresher than Vedur. Wind is in knots → converted to m/s here.
//     Carries QNH (`altim`, hPa), which Vedur 1477 doesn't report.
//   - Vedur.is (Icelandic Met Office) XML observations for station 1477.
//     Hourly only, but always carries a gust (FG = max gust in the past
//     hour), whereas METAR omits gusts unless they're significant.
//
// Nulls in the winner are filled from the other source (pressure from
// METAR; gust from Vedur when it's recent) — see pickObs(). Either
// upstream failing or timing out just leaves the other one in charge.
//
// Both are CORS-blocked or otherwise unsuitable for direct browser use,
// which is why this has to be a server-side proxy at all.
//
// Requires a valid session (getWeather isn't in Apps Script's
// PUBLIC_ACTIONS_ either). No database table involved; this is a pure
// external-API proxy.
//
// Vedur's XML is parsed with a few narrow regexes rather than a real XML
// parser: the feed's shape (a single <station> with flat <F>/<D>/<FG>/<T>/
// <time> children, or an <error>) is small, well-known, and stable.

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

// The frontend races this whole call against a 2s timeout, so each
// upstream gets a bit less than that — one slow source mustn't sink both.
const UPSTREAM_TIMEOUT_MS = 1700;
const KT_TO_MS = 0.514444;
// Vedur's FG is the max gust over the preceding hour; only borrow it to
// fill a gust-less METAR if the Vedur report is at most this old.
const GUST_FILL_MAX_AGE_MS = 90 * 60 * 1000;

type Obs = {
  wdir: number | null;
  wspd: number | null;
  wgst: number | null;
  temp: number | null;
  slp: number | null;
  reportTime: string | null;
  _source: string;
};

const VEDUR_DIR_DEG: Record<string, number> = {
  N: 0, NNE: 23, NE: 45, ENE: 68,
  E: 90, ESE: 113, SE: 135, SSE: 158,
  S: 180, SSW: 203, SW: 225, WSW: 248,
  W: 270, WNW: 293, NW: 315, NNW: 338,
};

function compassToDeg(label: string | null): number | null {
  if (!label) return null;
  const u = label.toUpperCase().trim();
  return u in VEDUR_DIR_DEG ? VEDUR_DIR_DEG[u] : null;
}

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  if (!m) return null;
  const t = m[1].trim();
  return t === "" ? null : t;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ktToMs(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n * KT_TO_MS * 10) / 10;
}

function timeMs(o: Obs | null): number {
  const t = o?.reportTime ? Date.parse(o.reportTime) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

async function fetchVedur(): Promise<Obs> {
  const res = await fetch(
    "https://xmlweather.vedur.is/?op_w=xml&type=obs&lang=en&view=xml&ids=1477",
    { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`Vedur fetch failed: HTTP ${res.status}`);
  const xml = await res.text();

  const stationMatch = xml.match(/<station[^>]*>([\s\S]*?)<\/station>/);
  if (!stationMatch) {
    const errorMatch = xml.match(/<error[^>]*>([\s\S]*?)<\/error>/);
    throw new Error(`Vedur: ${errorMatch ? errorMatch[1].trim() : "no station in response"}`);
  }
  const stationXml = stationMatch[1];
  const stationErr = extractTag(stationXml, "err");
  if (stationErr) throw new Error(`Vedur station error: ${stationErr}`);

  const time = extractTag(stationXml, "time");
  return {
    wdir: compassToDeg(extractTag(stationXml, "D")),
    wspd: num(extractTag(stationXml, "F")),
    wgst: num(extractTag(stationXml, "FG")),
    temp: num(extractTag(stationXml, "T")),
    slp: null, // Vedur 1477 has no pressure
    reportTime: time ? time.replace(" ", "T") + "Z" : null,
    _source: "Vedur:1477",
  };
}

async function fetchMetar(): Promise<Obs> {
  const res = await fetch(
    "https://aviationweather.gov/api/data/metar?ids=BIRK&format=json",
    { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`METAR fetch failed: HTTP ${res.status}`);
  const arr = await res.json();
  const m = Array.isArray(arr) ? arr[0] : null;
  if (!m) throw new Error("METAR: no report for BIRK");

  // obsTime is unix seconds; fall back to the reportTime string.
  const obsSec = num(m.obsTime);
  const reportTime = obsSec != null
    ? new Date(obsSec * 1000).toISOString()
    : (typeof m.reportTime === "string" ? new Date(m.reportTime.replace(" ", "T")).toISOString() : null);

  return {
    wdir: num(m.wdir), // "VRB" → null
    wspd: ktToMs(m.wspd),
    wgst: ktToMs(m.wgst),
    temp: num(m.temp),
    slp: num(m.altim),
    reportTime,
    _source: "METAR:BIRK",
  };
}

function pickObs(metar: Obs | null, vedur: Obs | null): Obs | null {
  if (!metar || !vedur) return metar ?? vedur;
  const metarNewer = timeMs(metar) >= timeMs(vedur);
  const primary = { ...(metarNewer ? metar : vedur) };
  const other = metarNewer ? vedur : metar;

  if (primary.slp == null) primary.slp = other.slp;
  if (primary.temp == null) primary.temp = other.temp;
  if (
    primary.wgst == null && other.wgst != null &&
    timeMs(primary) - timeMs(other) <= GUST_FILL_MAX_AGE_MS
  ) {
    // Never report a gust below the current mean wind.
    primary.wgst = Math.max(other.wgst, primary.wspd ?? 0);
  }
  return primary;
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

  const [metarRes, vedurRes] = await Promise.allSettled([fetchMetar(), fetchVedur()]);
  const metar = metarRes.status === "fulfilled" ? metarRes.value : null;
  const vedur = vedurRes.status === "fulfilled" ? vedurRes.value : null;

  const obs = pickObs(metar, vedur);
  if (!obs) {
    const reasons = [metarRes, vedurRes]
      .map((r) => (r.status === "rejected" ? (r.reason as Error)?.message : null))
      .filter(Boolean)
      .join("; ");
    return json({ error: `getWeather error: ${reasons || "no observations"}` }, 502);
  }
  return json({ obs });
});
