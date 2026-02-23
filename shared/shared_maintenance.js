/* ═══════════════════════════════════════════════════════════════════════════════
   ÝMIR — shared/maintenance.js
   Shared maintenance constants and rendering helpers.

   Requires: shared/api.js  (esc, boolVal, parseJson, toast, apiGet, apiPost)

   Exports (globals):
     SEV_BADGE          — severity → badge CSS class map
     SEV_HINTS          — severity → human description map
     CAT_ICON           — category → emoji map
     maintRenderCard()  — render a full maintenance card (staff view)
     maintRenderRow()   — render a compact maintenance row (dailylog view)
     maintResolveRow()  — resolve a dailylog checkbox row in-place
   ═══════════════════════════════════════════════════════════════════════════════ */

// ── Constants ─────────────────────────────────────────────────────────────────

const SEV_BADGE = {
  low:      "badge-green",
  medium:   "badge-yellow",
  high:     "badge-orange",
  critical: "badge-red",
};

const SEV_HINTS = {
  low:      "Minor issue — no immediate action required.",
  medium:   "Functional issue, usable with care.",
  high:     "Significant problem — assess before use.",
  critical: "Safety risk — take out of service immediately.",
};

const CAT_ICON = { boat: "⛵", equipment: "🦺", facility: "🏠" };

// ── Full card (staff/maintenance.html) ────────────────────────────────────────
/**
 * Render a full maintenance request card with comments, actions, and resolve button.
 * Identical to what was inline in staff/maintenance.html.
 */
function maintRenderCard(r) {
  const resolved    = boolVal(r.resolved);
  const sevClass    = "sev-" + (r.severity || "low");
  const catIcon     = CAT_ICON[r.category] || "🔧";
  const oosTag      = boolVal(r.markOos) && r.category === "boat" && !resolved
    ? `<span class="oos-badge">⛔ OOS</span>` : "";
  const subjectLabel = r.category === "boat"
    ? esc(r.boatName || r.boatId || "—")
    : esc(r.itemName || "—");

  const comments    = parseJson(r.comments, []);
  const commentHtml = comments.length ? `
    <div class="comment-thread">
      ${comments.map(c => `
        <div class="comment-item">
          <span class="comment-by">${esc(c.by)}</span>
          <span style="color:var(--border)"> · </span>
          <span>${esc((c.at || "").slice(0, 16).replace("T", " "))}</span>
          <span style="color:var(--border)"> · </span>
          ${esc(c.text)}
        </div>`).join("")}
    </div>` : "";

  const commentInput = !resolved ? `
    <div class="comment-add">
      <input type="text" placeholder="Add a comment…" id="ci-${r.id}"
        onkeydown="if(event.key==='Enter')maintAddComment('${r.id}')">
      <button class="btn btn-secondary" onclick="maintAddComment('${r.id}')">Add</button>
    </div>` : "";

  const resolveBtn = !resolved
    ? `<button class="btn btn-primary" style="font-size:11px;padding:6px 14px"
         onclick="maintResolve('${r.id}')">✓ Mark Resolved</button>`
    : `<span style="font-size:11px;color:var(--green)">
         ✓ Resolved by ${esc(r.resolvedBy || "—")} · ${esc((r.resolvedAt || "").slice(0, 10))}
       </span>`;

  return `
  <div class="req-card ${sevClass} ${resolved ? "resolved" : ""}" id="card-${r.id}">
    <div class="req-header">
      <div>
        <div class="req-title">
          ${catIcon} ${subjectLabel}
          ${r.part ? `<span style="color:var(--muted);font-size:12px"> · ${esc(r.part)}</span>` : ""}
          ${oosTag}
        </div>
        <div class="req-meta">
          <span class="badge ${SEV_BADGE[r.severity] || "badge-muted"}">${(r.severity || "—").toUpperCase()}</span>
          <span>by ${esc(r.reportedBy || "—")}</span>
          <span>${esc((r.createdAt || "").slice(0, 10))}</span>
          ${r.source ? `<span class="badge badge-muted">${esc(r.source)}</span>` : ""}
        </div>
      </div>
    </div>
    ${r.description ? `<div class="req-desc">${esc(r.description)}</div>` : ""}
    ${r.photoUrl    ? `<img class="req-photo" src="${esc(r.photoUrl)}" alt="photo"
                         onclick="viewPhoto('${esc(r.photoUrl)}')">` : ""}
    ${commentHtml}
    ${commentInput}
    <div class="req-actions">${resolveBtn}</div>
  </div>`;
}

// ── Compact row (dailylog) ────────────────────────────────────────────────────
/**
 * Render a compact checkbox row for the dailylog maintenance card.
 */
function maintRenderRow(m) {
  return `
    <div class="maint-row ${m._done ? "resolved" : ""}" id="mr-${m.id}">
      <input type="checkbox" ${m._done ? "checked" : ""}
        onchange="maintResolveRow('${m.id}', this.checked)">
      <div class="maint-info">
        <div class="maint-boat">
          ${esc(m.boatName || m.itemName || "—")}
          <span class="badge ${SEV_BADGE[m.severity] || "badge-muted"}" style="margin-left:6px">${m.severity || "—"}</span>
          ${m.part ? `<span class="badge badge-muted" style="margin-left:4px">${esc(m.part)}</span>` : ""}
        </div>
        <div class="maint-desc">${esc(m.description || "")}</div>
      </div>
    </div>`;
}

// ── Shared actions ────────────────────────────────────────────────────────────

/**
 * Resolve a maintenance request and un-OOS the boat if applicable.
 * Used by staff/maintenance.html; calls renderStats() and renderList() after.
 * Both those functions must exist on the page.
 */
async function maintResolve(id) {
  if (!confirm("Mark this request as resolved?")) return;
  const r = (window._maintRequests || []).find(x => x.id === id);
  if (!r) return;
  try {
    await apiPost("resolveMaintenance", { id, resolvedBy: window._maintUser.name });
    r.resolved = true; r.resolvedBy = window._maintUser.name; r.resolvedAt = new Date().toISOString();
    if (boolVal(r.markOos) && r.boatId) {
      await apiPost("saveBoat", { id: r.boatId, oos: false, oosReason: "" });
    }
    if (typeof renderStats === "function") renderStats();
    if (typeof renderList  === "function") renderList();
    toast("✓ Resolved.");
  } catch(e) { alert("Error: " + e.message); }
}

/**
 * Add a comment to a maintenance request.
 * Used by staff/maintenance.html.
 */
async function maintAddComment(id) {
  const input = document.getElementById("ci-" + id);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  try {
    await apiPost("addMaintenanceComment", { id, by: window._maintUser.name, text });
    const r = (window._maintRequests || []).find(x => x.id === id);
    if (r) {
      const comments = parseJson(r.comments, []);
      comments.push({ by: window._maintUser.name, at: new Date().toISOString(), text });
      r.comments = JSON.stringify(comments);
    }
    if (typeof renderList === "function") renderList();
    toast("Comment added.");
  } catch(e) { alert("Error: " + e.message); }
}

/**
 * Resolve a dailylog maintenance row via checkbox.
 * Expects window._dlMaintenance to hold the local array.
 */
async function maintResolveRow(id, checked) {
  const list = window._dlMaintenance || [];
  const item = list.find(m => m.id === id);
  if (!item) return;
  item._done = checked;
  if (typeof renderDlMaintenance === "function") renderDlMaintenance();
  if (checked) {
    try {
      await apiPost("resolveMaintenance", { id, resolvedBy: window._dlUser.name });
    } catch(e) {
      item._done = false;
      if (typeof renderDlMaintenance === "function") renderDlMaintenance();
      alert("Could not resolve: " + e.message);
    }
  }
}
