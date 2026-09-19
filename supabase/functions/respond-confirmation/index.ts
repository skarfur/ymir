import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports trips.gs's respondConfirmation_ — the trip-confirmation handshake
// state machine. Any authenticated session, matching the original.
//
// On reject: rolls back speculative skipper-side state (applyRejectionCleanup,
// ports the original 1:1 — helm/student flag clearing, crew_assigned
// removal from the crewNames list + crew-count decrement on both the trip
// and, if check-in hasn't happened yet, the checkout row).
//
// On confirm: creates the crew trip row (crew_assigned/crew_join), sets
// helm/student flags, or marks the trip verified (verify) — then runs
// tryAutoVerify: when a keelboat captain's trip has every handshake for
// its checkout resolved, auto-verifies the skipper trip and every linked
// crew trip.
//
// crewNames (a JSON array of {name, kennitala, guest, helm, student}
// objects) lives in trips.crew (jsonb) here, matching save-trip's crew
// jsonb usage — not a separate crewNames column.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

type Admin = ReturnType<typeof createAdminClient>;

function parseCrewNames(raw: unknown): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

async function findSkipperTripForConf(admin: Admin, row: any): Promise<any | null> {
  if (row.trip_id) {
    const { data } = await admin.from("trips").select("*").eq("id", row.trip_id).maybeSingle();
    if (data) return data;
  }
  if (row.linked_checkout_id) {
    const { data } = await admin.from("trips").select("*")
      .eq("linked_checkout_id", row.linked_checkout_id).in("role", ["skipper", "captain"]).limit(1);
    if (data && data.length) return data[0];
  }
  if (row.type === "crew_join" && row.to_kennitala) {
    let q = admin.from("trips").select("*").eq("member_kennitala", row.to_kennitala);
    q = row.linked_checkout_id ? q.eq("linked_checkout_id", row.linked_checkout_id) : q.eq("id", row.trip_id || "");
    const { data } = await q.limit(1);
    if (data && data.length) return data[0];
  }
  return null;
}

async function findCrewMemberTrips(admin: Admin, kt: string, row: any): Promise<any[]> {
  if (!kt) return [];
  const { data } = await admin.from("trips").select("*").eq("member_kennitala", kt);
  return (data || []).filter((t: any) =>
    (row.linked_checkout_id && String(t.linked_checkout_id || "") === String(row.linked_checkout_id)) ||
    (row.trip_id && String(t.linked_trip_id || "") === String(row.trip_id))
  );
}

async function clearCrewNamesFlag(admin: Admin, trip: any, kt: string, flag: "helm" | "student", ts: string) {
  if (!kt || !trip) return;
  const cn = parseCrewNames(trip.crew);
  let changed = false;
  cn.forEach((entry: any) => {
    if (entry && entry.kennitala && String(entry.kennitala) === String(kt) && entry[flag]) {
      entry[flag] = false;
      changed = true;
    }
  });
  if (changed) await admin.from("trips").update({ crew: cn, updated_at: ts }).eq("id", trip.id);
}

async function removeFromCrewNamesAndDecrement(
  admin: Admin, table: "trips" | "checkouts", rowObj: any, rejectingKt: string, minCrew: number, ts: string,
) {
  const cn = parseCrewNames(rowObj.crew);
  const nextCn = cn.filter((entry: any) => !(entry && entry.kennitala && String(entry.kennitala) === String(rejectingKt)));
  const changed = nextCn.length !== cn.length;
  const curCrew = rowObj.crew_count || 1;
  const newCrew = Math.max(minCrew || 1, curCrew - 1);
  const updates: Record<string, unknown> = {};
  if (changed) updates.crew = nextCn;
  if (newCrew !== curCrew) updates.crew_count = newCrew;
  if (table === "trips" && (changed || newCrew !== curCrew)) updates.updated_at = ts;
  if (Object.keys(updates).length) await admin.from(table).update(updates).eq("id", rowObj.id);
}

async function applyRejectionCleanup(admin: Admin, row: any, ts: string) {
  const type = row.type;
  if (type === "helm" || type === "student") {
    const flag = type as "helm" | "student";
    const memberKt = row.to_kennitala;
    const skipperTrip = await findSkipperTripForConf(admin, row);
    if (skipperTrip) await clearCrewNamesFlag(admin, skipperTrip, memberKt, flag, ts);
    const crewTrips = await findCrewMemberTrips(admin, memberKt, row);
    for (const t of crewTrips) {
      if (t[flag] && String(t[flag]) !== "false") {
        await admin.from("trips").update({ [flag]: "false", updated_at: ts }).eq("id", t.id);
      }
    }
    return;
  }
  if (type === "crew_assigned") {
    const rejectingKt = row.to_kennitala;
    const skipperTrip2 = await findSkipperTripForConf(admin, row);
    if (skipperTrip2) {
      const { data: others } = await admin.from("trips").select("id, linked_trip_id, linked_checkout_id").neq("id", skipperTrip2.id);
      const linkedCrewCount = (others || []).filter((t: any) =>
        String(t.linked_trip_id || "") === String(skipperTrip2.id) ||
        (skipperTrip2.linked_checkout_id && String(t.linked_checkout_id || "") === String(skipperTrip2.linked_checkout_id))
      ).length;
      const minCrew = Math.max(1, linkedCrewCount + 1);
      await removeFromCrewNamesAndDecrement(admin, "trips", skipperTrip2, rejectingKt, minCrew, ts);
    }
    if (row.linked_checkout_id) {
      const { data: co } = await admin.from("checkouts").select("*").eq("id", row.linked_checkout_id).maybeSingle();
      if (co && (co.status === "out" || !co.status)) {
        await removeFromCrewNamesAndDecrement(admin, "checkouts", co, rejectingKt, 1, ts);
      }
    }
    return;
  }
  if (type === "verify" && row.trip_id) {
    await admin.from("trips").update({ validation_requested: false, updated_at: ts }).eq("id", row.trip_id);
  }
}

async function tryAutoVerify(admin: Admin, conf: any, ts: string) {
  const tripId = conf.trip_id, coId = conf.linked_checkout_id;
  let skipperTrip: any = null;
  if (tripId) {
    const { data } = await admin.from("trips").select("*").eq("id", tripId).maybeSingle();
    skipperTrip = data;
  }
  if (!skipperTrip && coId) {
    const { data } = await admin.from("trips").select("*")
      .eq("linked_checkout_id", coId).in("role", ["skipper", "captain"]).limit(1);
    skipperTrip = data && data[0];
  }
  if (!skipperTrip) return;

  const { data: member } = await admin.from("members").select("certifications")
    .eq("kennitala", skipperTrip.member_kennitala).maybeSingle();
  if (!member) return;
  const certs = Array.isArray(member.certifications) ? member.certifications : [];
  if (!certs.some((c: any) => c && c.sub === "captain")) return;

  if (String(skipperTrip.boat_category || "").toLowerCase() !== "keelboat") return;

  const { data: allConfs } = await admin.from("trip_confirmations").select("linked_checkout_id, trip_id, status");
  const related = (allConfs || []).filter((c: any) =>
    (coId && String(c.linked_checkout_id || "") === String(coId)) ||
    (tripId && String(c.trip_id || "") === String(tripId))
  );
  if (related.some((c: any) => c.status === "pending")) return;

  const { data: allTrips } = await admin.from("trips").select("id, verified, linked_checkout_id, linked_trip_id");
  const linkedTrips = (allTrips || []).filter((t: any) =>
    String(t.id) === String(skipperTrip.id) ||
    (coId && String(t.linked_checkout_id || "") === String(coId)) ||
    String(t.linked_trip_id || "") === String(skipperTrip.id)
  );
  for (const t of linkedTrips) {
    if (!t.verified) {
      await admin.from("trips").update({ verified: true, verified_by: "(auto)", verified_at: ts, updated_at: ts }).eq("id", t.id);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);

  const id = body?.id ? String(body.id) : "";
  if (!id) return json({ error: "id required" }, 400);
  const response = body?.response;
  if (response !== "confirmed" && response !== "rejected") {
    return json({ error: "response must be confirmed or rejected" }, 400);
  }

  const { data: row } = await admin.from("trip_confirmations").select("*").eq("id", id).maybeSingle();
  if (!row) return json({ error: "Confirmation not found" }, 404);
  if (row.status !== "pending") return json({ error: "Already responded" }, 400);

  const ts = new Date().toISOString();
  const updates: Record<string, unknown> = { status: response, responded_at: ts };
  if (response === "rejected" && body?.rejectComment) updates.reject_comment = String(body.rejectComment);
  const { error: updateErr } = await admin.from("trip_confirmations").update(updates).eq("id", id);
  if (updateErr) return json({ error: "Respond failed: " + updateErr.message }, 500);

  if (response === "rejected") {
    await applyRejectionCleanup(admin, row, ts);
    if (row.type === "verify" && row.trip_id && body?.staffComment) {
      await admin.from("trips").update({ staff_comment: String(body.staffComment), updated_at: ts }).eq("id", row.trip_id);
    }
    return json({ updated: true, status: "rejected" });
  }

  // confirmed
  const type = row.type;
  if (type === "crew_assigned" || type === "crew_join") {
    const crewKt = type === "crew_assigned" ? row.to_kennitala : row.from_kennitala;
    const crewName = type === "crew_assigned" ? row.to_name : row.from_name;

    let existingQuery = admin.from("trips").select("id").eq("member_kennitala", crewKt);
    existingQuery = row.linked_checkout_id
      ? existingQuery.eq("linked_checkout_id", row.linked_checkout_id)
      : existingQuery.eq("linked_trip_id", row.trip_id || "");
    const { data: existing } = await existingQuery;

    if (!existing || !existing.length) {
      let origCrew = row.crew_count || 1;
      let origSkipperNote = row.skipper_note || "";
      let origCrewNames: any[] = [];
      let origDistNm: number | null = null, origDepPort = "", origArrPort = "";
      if (row.trip_id) {
        const { data: origTrip } = await admin.from("trips").select("*").eq("id", row.trip_id).maybeSingle();
        if (origTrip) {
          if (origCrew <= 1) origCrew = origTrip.crew_count || 1;
          if (!origSkipperNote) origSkipperNote = origTrip.skipper_note || "";
          origCrewNames = Array.isArray(origTrip.crew) ? origTrip.crew : [];
          origDistNm = origTrip.distance_nm;
          origDepPort = origTrip.departure_port || "";
          origArrPort = origTrip.arrival_port || "";
        }
      }
      const { data: crewMember } = await admin.from("members").select("id").eq("kennitala", crewKt).maybeSingle();
      await admin.from("trips").insert({
        member_id: crewMember ? crewMember.id : null,
        member_kennitala: crewKt, member_name: crewName || "",
        date: row.date, time_out: row.time_out, time_in: row.time_in,
        hours_decimal: row.hours_decimal || 0,
        boat_id: row.boat_id, boat_name: row.boat_name || "", boat_category: row.boat_category || "",
        location_id: row.location_id, location_name: row.location_name || "",
        crew_count: origCrew, role: "crew",
        beaufort: row.beaufort, wind_dir: row.wind_dir || "", wx_snapshot: row.wx_snapshot,
        notes: "", skipper_note: origSkipperNote, is_linked: true,
        linked_checkout_id: row.linked_checkout_id, linked_trip_id: row.trip_id,
        verified: false, validation_requested: false, helm: "",
        distance_nm: origDistNm, departure_port: origDepPort, arrival_port: origArrPort,
        crew: origCrewNames,
        actor_id: session.memberId,
      });
    }

    if (type === "crew_join" && row.trip_id) {
      const { data: origSkipTrip } = await admin.from("trips").select("*").eq("id", row.trip_id).maybeSingle();
      if (origSkipTrip) {
        const { data: allLinked } = await admin.from("trips").select("id, linked_trip_id, linked_checkout_id").neq("id", origSkipTrip.id);
        const linkedCrewCount = (allLinked || []).filter((t: any) =>
          String(t.linked_trip_id || "") === String(origSkipTrip.id) ||
          (row.linked_checkout_id && String(t.linked_checkout_id || "") === String(row.linked_checkout_id))
        ).length;
        const neededCrew = linkedCrewCount + 1;
        const curCrew = origSkipTrip.crew_count || 1;
        if (curCrew < neededCrew) {
          await admin.from("trips").update({ crew_count: neededCrew, updated_at: ts }).eq("id", origSkipTrip.id);
        }
      }
    }
  }

  if (type === "helm") {
    if (row.trip_id) {
      await admin.from("trips").update({ helm: "true", updated_at: ts }).eq("id", row.trip_id);
    } else if (row.to_kennitala && row.linked_checkout_id) {
      const { data: helmTrips } = await admin.from("trips").select("id")
        .eq("member_kennitala", row.to_kennitala).eq("linked_checkout_id", row.linked_checkout_id);
      for (const t of helmTrips || []) {
        await admin.from("trips").update({ helm: "true", updated_at: ts }).eq("id", t.id);
      }
    }
  }

  if (type === "student" && row.to_kennitala && row.linked_checkout_id) {
    const { data: stuTrips } = await admin.from("trips").select("id")
      .eq("member_kennitala", row.to_kennitala).eq("linked_checkout_id", row.linked_checkout_id);
    for (const t of stuTrips || []) {
      await admin.from("trips").update({ student: "true", updated_at: ts }).eq("id", t.id);
    }
  }

  if (type === "verify" && row.trip_id) {
    const verifyUpdates: Record<string, unknown> = {
      verified: true,
      verified_by: (body?.responderName as string) || row.to_name || "",
      verified_at: ts,
      updated_at: ts,
    };
    if (body?.staffComment) verifyUpdates.staff_comment = String(body.staffComment);
    await admin.from("trips").update(verifyUpdates).eq("id", row.trip_id);
  }

  if (type === "crew_assigned" || type === "crew_join" || type === "helm" || type === "student") {
    await tryAutoVerify(admin, row, ts);
  }

  return json({ updated: true, status: "confirmed" });
});
