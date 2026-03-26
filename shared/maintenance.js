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

// maintRenderCardCompact — staff hub summary card (2 lines, click for detail)
function maintRenderCardCompact(r) {
  const sevClass = SEV_BADGE[r.severity] || 'badge-green';
  const catIcon  = CAT_ICON[r.category]  || '🔧';
  const oosTag   = boolVal(r.markOos) && r.category === 'boat' && !boolVal(r.resolved)
    ? `<span class="oos-badge" style="font-size:10px;background:#e74c3c;color:#fff;padding:1px 6px;border-radius:10px;margin-left:4px">OOS</span>` : '';
  const date = (r.createdAt||'').slice(0,10);
  return `<div class="maint-card maint-card-compact" style="padding:10px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;cursor:pointer;transition:background .15s" data-id="${esc(r.id||'')}">
    <div style="display:flex;align-items:center;gap:6px">
      <span class="${sevClass}" style="font-size:11px">${esc(r.severity||'low')}</span>
      <span style="font-size:14px">${catIcon}</span>
      <span style="font-weight:600;font-size:13px;flex:1">${esc(r.itemName||r.name||'')}</span>
      ${oosTag}
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap">
      <span>${esc(r.boatName||r.boatId||'')}</span>
      ${r.reportedBy ? `<span>· ${esc(r.reportedBy)}</span>` : ''}
      ${date        ? `<span>· ${date}</span>` : ''}
    </div>
  </div>`;
}

// maintOpenDetail(r, currentUser) — opens the staff hub detail modal for a record
function maintOpenDetail(r, currentUser) {
  // Inject modal shell once
  if (!document.getElementById('maintDetailModal')) {
    const shell = document.createElement('div');
    shell.innerHTML = `<div id="maintDetailModal" class="modal hidden" onclick="if(event.target===this)closeModal('maintDetailModal')">
      <div class="modal-box" style="max-width:560px;padding:0;overflow:hidden;display:flex;flex-direction:column;max-height:90vh">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
          <span id="maintDetailTitle" style="font-weight:600;font-size:14px"></span>
          <button onclick="closeModal('maintDetailModal')" style="background:none;border:none;cursor:pointer;font-size:20px;color:var(--muted);line-height:1">&times;</button>
        </div>
        <div id="maintDetailBody" style="overflow-y:auto;padding:16px;flex:1"></div>
      </div>
    </div>`;
    document.body.appendChild(shell.firstElementChild);
  }

  // Inject confirm modal shell once
  if (!document.getElementById('maintConfirmModal')) {
    const c = document.createElement('div');
    c.innerHTML = `<div id="maintConfirmModal" class="modal hidden" onclick="if(event.target===this)closeModal('maintConfirmModal')">
      <div class="modal-box" style="max-width:380px;padding:20px;text-align:center">
        <p id="maintConfirmMsg" style="margin:0 0 16px;font-size:14px"></p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button id="maintConfirmOk" style="padding:7px 20px;border:none;border-radius:20px;background:var(--brass);color:#fff;font-weight:600;cursor:pointer">Confirm</button>
          <button onclick="closeModal('maintConfirmModal')" style="padding:7px 20px;border:1px solid var(--border);border-radius:20px;background:none;cursor:pointer">Cancel</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(c.firstElementChild);
  }

  function confirm(msg, cb) {
    document.getElementById('maintConfirmMsg').textContent = msg;
    document.getElementById('maintConfirmOk').onclick = () => { closeModal('maintConfirmModal'); cb(); };
    openModal('maintConfirmModal');
  }

  function renderDetail() {
    document.getElementById('maintDetailTitle').textContent = (CAT_ICON[r.category]||'🔧') + ' ' + (r.itemName||r.name||'');
    const sevClass = SEV_BADGE[r.severity] || 'badge-green';
    const isOos    = boolVal(r.markOos) && r.category==='boat' && !boolVal(r.resolved);
    const comments = parseJson(r.comments, []);

    // Status row — clickable severity badge + OOS toggle
    const sevOptions = ['low','medium','high','critical'];
    const sevMenu = sevOptions.map(s =>
      `<span data-sev="${s}" class="${SEV_BADGE[s]}" style="cursor:pointer;margin:2px;font-size:11px;${s===r.severity?'outline:2px solid var(--text);outline-offset:2px':''}">${s}</span>`
    ).join('');

    const oosBtn = (r.category==='boat' && !boolVal(r.resolved))
      ? `<button id="mdOosBtn" style="padding:4px 12px;border-radius:20px;border:none;font-size:11px;font-weight:600;cursor:pointer;background:${isOos?'#e74c3c':'var(--surface)'};color:${isOos?'#fff':'var(--muted)'};">${isOos?'In service (remove OOS)':'Mark OOS'}</button>` : '';

    // Comments
    const commentsHtml = comments.length ? comments.map(c => `
      <div style="border-top:1px solid var(--border);padding:8px 0">
        <div style="font-size:11px;color:var(--muted);margin-bottom:3px">${esc(c.by||'')} · ${(c.at||'').slice(0,16).replace('T',' ')} UTC</div>
        <div style="font-size:13px">${esc(c.text||'')}</div>
      </div>`).join('') : '';

    document.getElementById('maintDetailBody').innerHTML = `
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px">
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap" id="mdSevBadges">${sevMenu}</div>
        ${oosBtn}
      </div>
      ${r.description ? `<p style="font-size:13px;margin:0 0 12px">${esc(r.description)}</p>` : ''}
      <div style="font-size:11px;color:var(--muted);margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap">
        ${r.boatName  ? `<span>🚢 ${esc(r.boatName)}</span>`     : ''}
        ${r.reportedBy? `<span>👤 ${esc(r.reportedBy)}</span>`   : ''}
        ${r.createdAt ? `<span>📅 ${(r.createdAt||'').slice(0,10)}</span>` : ''}
        ${r.part      ? `<span>🔧 ${esc(r.part)}</span>`          : ''}
      </div>
      ${r.photoUrl ? `<img src="${esc(r.photoUrl)}" style="width:100%;border-radius:6px;margin-bottom:12px;cursor:pointer" onclick="viewPhoto('${esc(r.photoUrl)}')">` : ''}
      <div id="mdComments">${commentsHtml}</div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <input id="mdCommentInput" type="text" placeholder="Add comment…" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--surface);color:var(--text)">
        <button id="mdCommentBtn" style="padding:6px 14px;border:none;border-radius:6px;background:var(--brass);color:#fff;font-weight:600;cursor:pointer;font-size:13px">Post</button>
      </div>
      ${!boolVal(r.resolved) ? `<button id="mdResolveBtn" style="margin-top:12px;width:100%;padding:8px;border:none;border-radius:8px;background:#27ae60;color:#fff;font-weight:600;cursor:pointer;font-size:13px">Mark Resolved</button>` : `<div style="margin-top:12px;font-size:12px;color:var(--muted);text-align:center">Resolved ${(r.resolvedAt||'').slice(0,10)} by ${esc(r.resolvedBy||'')}</div>`}
    `;

    // Wire severity change
    document.querySelectorAll('#mdSevBadges [data-sev]').forEach(el => {
      el.addEventListener('click', () => {
        const newSev = el.dataset.sev;
        if (newSev === r.severity) return;
        confirm(`Change severity to "${newSev}"?`, async () => {
          await apiPost('saveMaintenance', { id: r.id, severity: newSev });
          r.severity = newSev;
          renderDetail();
          if (typeof renderMaintenance === 'function') renderMaintenance();
        });
      });
    });

    // Wire OOS toggle
    document.getElementById('mdOosBtn')?.addEventListener('click', () => {
      const newOos = !isOos;
      const msg = newOos ? 'Mark this boat as Out of Service?' : 'Return this boat to service?';
      confirm(msg, async () => {
        await apiPost('saveMaintenance', { id: r.id, markOos: newOos });
        r.markOos = newOos;
        renderDetail();
        if (typeof renderMaintenance === 'function') renderMaintenance();
      });
    });

    // Wire comment post
    document.getElementById('mdCommentBtn')?.addEventListener('click', async () => {
      const input = document.getElementById('mdCommentInput');
      const text  = input.value.trim();
      if (!text) return;
      const now  = new Date().toISOString().slice(0,16);
      const by   = currentUser || 'Staff';
      const existing = parseJson(r.comments, []);
      const updated  = [...existing, { text, by, at: now }];
      await apiPost('saveMaintenance', { id: r.id, comments: JSON.stringify(updated) });
      r.comments = JSON.stringify(updated);
      input.value = '';
      renderDetail();
    });

    // Wire resolve
    document.getElementById('mdResolveBtn')?.addEventListener('click', () => {
      confirm('Mark this issue as resolved?', async () => {
        const now = new Date().toISOString().slice(0,16);
        await apiPost('saveMaintenance', { id: r.id, resolved: true, resolvedAt: now, resolvedBy: currentUser||'Staff' });
        r.resolved = true; r.resolvedAt = now; r.resolvedBy = currentUser||'Staff';
        renderDetail();
        if (typeof renderMaintenance === 'function') renderMaintenance();
      });
    });
  }

  renderDetail();
  openModal('maintDetailModal');
}

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
