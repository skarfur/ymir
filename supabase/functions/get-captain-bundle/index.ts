import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";
import { buildConfigSnapshot } from "../_shared/config.ts";
import { buildMaintenance } from "../_shared/maintenance.ts";
import { buildTrips } from "../_shared/trips.ts";
import { buildConfirmations, buildVerificationRequests } from "../_shared/confirmations.ts";
import { buildMembers } from "../_shared/members.ts";

// captain/captain.js's page load fires 6 separate apiGet calls
// (getConfig, getMaintenance, getTrips, getConfirmations,
// getVerificationRequests, getMembers) in one Promise.all — each of
// those is its own Edge Function invocation, so each pays its own
// resolveSession round-trip (a sessions-table lookup + a last_seen_at
// write) and its own cold-start risk on top of whatever the query itself
// costs. This bundle resolves the session once and runs all six reads
// in parallel server-side instead, behind a single HTTP round-trip.
//
// Each builder is the exact same function the standalone Edge Function
// (get-config, get-maintenance, get-trips, get-confirmations,
// get-verification-requests, get-members) calls — this isn't a fork of
// their logic, so nothing here can drift out of sync with what a direct
// call to any of those returns individually. Those standalone functions
// stay deployed and unchanged: other portals (staff.js, member.js, admin
// pages) call them individually and don't need the bundle.
//
// The client seeds each individual action's apiGet cache slot from this
// response (see captain/captain.js) so existing per-action invalidation
// (_invalidateApiCache('getMaintenance') etc., fired from any other page
// that writes to one of these tables) keeps working unchanged — this
// bundle only replaces the *initial* fan-out of network calls, not the
// caching/invalidation model.

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

  const kennitala = body?.kennitala ? String(body.kennitala).trim() : session.kennitala;

  try {
    const [config, maintenance, trips, confirmations, verificationRequests, members] = await Promise.all([
      buildConfigSnapshot(admin),
      buildMaintenance(admin),
      buildTrips(admin, { limit: 500 }),
      buildConfirmations(admin, kennitala),
      buildVerificationRequests(admin),
      buildMembers(admin),
    ]);
    return json({ config, maintenance, trips, confirmations, verificationRequests, members });
  } catch (e) {
    return json({ error: (e as Error).message || "Bundle lookup failed" }, 500);
  }
});
