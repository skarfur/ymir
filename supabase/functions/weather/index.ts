import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports weather.gs's getWeather_ — proxies Vedur.is's (Icelandic Met
// Office) public XML observations feed for station 1477
// (Reykjavíkurflugvöllur), reshaped into the same `{obs:{...}}` envelope
// the frontend already consumes. Vedur is CORS-blocked from browsers,
// which is why this has to be a server-side proxy at all, same as before.
//
// Requires a valid session (getWeather isn't in Apps Script's
// PUBLIC_ACTIONS_ either) — ported as-is rather than loosening access
// during the migration. No database table involved; this is a pure
// external-API proxy.
//
// XML is parsed with a few narrow regexes rather than a real XML parser:
// the feed's shape (a single <station> with flat <F>/<D>/<FG>/<T>/<time>
// children, or an <error>) is small, well-known, and stable. A real
// parser would be worth it for a feed with nested/variable structure;
// this one isn't.

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

  try {
    const res = await fetch("https://xmlweather.vedur.is/?op_w=xml&type=obs&lang=en&view=xml&ids=1477");
    if (!res.ok) return json({ error: `Vedur fetch failed: HTTP ${res.status}` }, 502);
    const xml = await res.text();

    const stationMatch = xml.match(/<station[^>]*>([\s\S]*?)<\/station>/);
    if (!stationMatch) {
      const errorMatch = xml.match(/<error[^>]*>([\s\S]*?)<\/error>/);
      return json({ error: `Vedur: ${errorMatch ? errorMatch[1].trim() : "no station in response"}` }, 502);
    }
    const stationXml = stationMatch[1];
    const stationErr = extractTag(stationXml, "err");
    if (stationErr) return json({ error: `Vedur station error: ${stationErr}` }, 502);

    const F = extractTag(stationXml, "F");
    const D = extractTag(stationXml, "D");
    const FG = extractTag(stationXml, "FG");
    const T = extractTag(stationXml, "T");
    const time = extractTag(stationXml, "time");

    const obs = {
      wdir: compassToDeg(D),
      wspd: F != null ? Number(F) : null,
      wgst: FG != null ? Number(FG) : null,
      temp: T != null ? Number(T) : null,
      slp: null as number | null, // Vedur 1477 has no pressure
      reportTime: time ? time.replace(" ", "T") + "Z" : null,
      _source: "Vedur:1477",
    };
    return json({ obs });
  } catch (e) {
    return json({ error: `getWeather error: ${(e as Error).message}` }, 500);
  }
});
