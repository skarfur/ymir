import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createAdminClient, resolveSession } from "../_shared/session.ts";

// Ports passport.gs's importRowingPassportCsv_ — admin only
// (ADMIN_ACTIONS_ in code.gs). CSV columns (headers, order-independent):
//   passport_id (optional, defaults 'rower')
//   category_id (optional — auto-slugged from category_label_en if blank)
//   category_label_en, category_label_is (label_is optional)
//   item_id (optional — reused from existing item with same label_en, else slugged)
//   assessment ('theory' | 'practical', defaults 'practical')
//   module (optional — positive integer reflecting the teaching module; 0/blank = unassigned)
//   item_label_en (required), item_label_is (optional)
//   description_en, description_is (both optional)
// Only item_label_en is strictly required per row. Existing items not
// present in the CSV are marked retired (not deleted).
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function slugify(s: unknown): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { q = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { q = true; }
      else if (ch === "," || ch === ";") { out.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

function parsePassportCsv(text: string): { rows: Record<string, string>[]; headers: string[] } {
  let t = String(text || "");
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const lines = t.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { rows: [], headers: [] };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = (cells[j] || "").trim(); });
    if (row.item_id || row.item_label_en) out.push(row);
  }
  return { rows: out, headers };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const admin = createAdminClient();
  const session = await resolveSession(admin, body?.sessionToken as string | undefined);
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (session.role !== "admin") return json({ error: "Admin only" }, 403);

  const csv = body?.csv ? String(body.csv) : "";
  if (!csv) return json({ error: "csv required" }, 400);

  const parsed = parsePassportCsv(csv);
  const rows = parsed.rows;
  if (!rows.length) {
    const hdrs = parsed.headers || [];
    if (!hdrs.length) {
      return json({ error: "CSV is empty — expected a header row and at least one data row." }, 400);
    }
    const needed = ["item_id", "item_label_en"];
    const missing = needed.filter((h) => hdrs.indexOf(h) < 0);
    if (missing.length === needed.length) {
      return json({ error: "CSV headers not recognised. Detected: [" + hdrs.join(", ") + "]. Expected at least one of: item_id, item_label_en. Column names must be lowercase with underscores (e.g. item_label_en, not \"Item Label EN\")." }, 400);
    }
    return json({ error: "CSV has no data rows with an item_id or item_label_en. Detected headers: [" + hdrs.join(", ") + "]." }, 400);
  }

  const { data: configRow } = await admin.from("app_config").select("value").eq("key", "rowingPassport").maybeSingle();
  const current = (configRow?.value && Array.isArray(configRow.value.passports)) ? configRow.value : { version: 0, passports: [] };

  const existingItemByLabel: Record<string, string> = {};
  const existingCatByLabel: Record<string, string> = {};
  (current.passports || []).forEach((p: any) => {
    (p.categories || []).forEach((c: any) => {
      const catLabelKey = p.id + "|" + slugify((c.name && c.name.EN) || c.id);
      existingCatByLabel[catLabelKey] = c.id;
      (c.items || []).forEach((i: any) => {
        const itemLabelKey = p.id + "|" + c.id + "|" + String((i.name && i.name.EN) || "").toLowerCase().trim();
        if (itemLabelKey.split("|")[2]) existingItemByLabel[itemLabelKey] = i.id;
      });
    });
  });

  const passports: Record<string, any> = {};
  const errors: string[] = [];
  rows.forEach((r, rowIdx) => {
    const lineNo = rowIdx + 2;
    const pid = r.passport_id || "rower";
    if (!passports[pid]) {
      const existing = (current.passports || []).find((p: any) => p.id === pid);
      passports[pid] = existing
        ? { ...existing, categories: [] }
        : { id: pid, name: { EN: pid, IS: pid }, promoteCertId: "rowing_division", fromSub: "restricted", toSub: "released", requiredSigs: 2, categories: [] };
      passports[pid].categories = [];
      passports[pid]._catIndex = {};
    }
    const p = passports[pid];

    let catId = (r.category_id || "").trim();
    if (!catId) {
      const catLabelEn = (r.category_label_en || "").trim();
      if (!catLabelEn) { errors.push("Row " + lineNo + ": needs either category_id or category_label_en"); return; }
      const catKey = pid + "|" + slugify(catLabelEn);
      catId = existingCatByLabel[catKey] || slugify(catLabelEn);
    }

    let cat = p._catIndex[catId];
    if (!cat) {
      cat = { id: catId, name: { EN: r.category_label_en || catId, IS: r.category_label_is || r.category_label_en || catId }, items: [] };
      p._catIndex[catId] = cat;
      p.categories.push(cat);
    }

    const labelEn = (r.item_label_en || "").trim();
    if (!labelEn && !(r.item_id || "").trim()) {
      errors.push("Row " + lineNo + ": needs either item_id or item_label_en");
      return;
    }

    let itemId = (r.item_id || "").trim();
    if (!itemId) {
      const itemKey = pid + "|" + catId + "|" + labelEn.toLowerCase();
      itemId = existingItemByLabel[itemKey] || slugify(labelEn);
    }

    if (cat.items.some((i: any) => i.id === itemId)) {
      errors.push("Row " + lineNo + ': duplicate item "' + itemId + '" in category "' + catId + '" (give distinct labels or explicit item_id)');
      return;
    }

    let assessment = (r.assessment || "").toLowerCase();
    if (assessment !== "theory" && assessment !== "practical") assessment = "practical";
    let moduleNum = parseInt((r.module || "").toString().trim(), 10);
    if (!(moduleNum >= 0)) moduleNum = 0;
    cat.items.push({
      id: itemId,
      assessment,
      module: moduleNum,
      name: { EN: labelEn || itemId, IS: r.item_label_is || labelEn || itemId },
      desc: { EN: r.description_en || "", IS: r.description_is || "" },
    });
  });

  if (errors.length) {
    return json({ error: "Import errors:\n" + errors.slice(0, 10).join("\n") + (errors.length > 10 ? "\n(+" + (errors.length - 10) + " more)" : "") }, 400);
  }

  (current.passports || []).forEach((oldP: any) => {
    const newP = passports[oldP.id];
    if (!newP) {
      passports[oldP.id] = {
        ...oldP,
        categories: (oldP.categories || []).map((c: any) => ({
          ...c,
          items: (c.items || []).map((i: any) => ({ ...i, retired: true })),
        })),
      };
      return;
    }
    const newItemIds = new Set<string>();
    newP.categories.forEach((c: any) => c.items.forEach((i: any) => newItemIds.add(i.id)));
    (oldP.categories || []).forEach((oldCat: any) => {
      (oldCat.items || []).forEach((oldItem: any) => {
        if (!newItemIds.has(oldItem.id)) {
          let hostCat = newP.categories.find((c: any) => c.id === oldCat.id);
          if (!hostCat) {
            hostCat = { id: oldCat.id, name: oldCat.name, items: [] };
            newP.categories.push(hostCat);
          }
          hostCat.items.push({ ...oldItem, retired: true });
        }
      });
    });
  });

  const newDef = {
    version: (current.version || 0) + 1,
    passports: Object.values(passports).map((p: any) => {
      const copy = { ...p };
      delete copy._catIndex;
      return copy;
    }),
  };

  const { error } = await admin.from("app_config")
    .upsert({ key: "rowingPassport", value: newDef, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return json({ error: "importRowingPassportCsv failed: " + error.message }, 500);

  return json({ saved: true, definition: newDef });
});
