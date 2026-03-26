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
  const SEV_CSS  = {low:'var(--green)',medium:'var(--yellow)',high:'var(--orange)',critical:'var(--red)'};
  const borderCol = SEV_CSS[r.severity] || 'var(--green)';
  const oosTag    = boolVal(r.markOos) && r.category==='boat' && !boolVal(r.resolved)
    ? '<span style="background:#e74c3c;color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0">OOS</span>' : '';
  const boat = esc(r.boatName||r.boatId||r.itemName||r.name||'');
  const part = esc(r.part||'');
  return `<div class="maint-card maint-card-compact" data-id="${esc(r.id||'')}"
    style="display:flex;align-items:center;gap:8px;padding:9px 12px 9px 14px;border:1px solid var(--border);border-left:4px solid ${borderCol};border-radius:8px;margin-bottom:6px;cursor:pointer;transition:background .15s"
    onmouseenter="this.style.background='var(--surface)'" onmouseleave="this.style.background=''">
    <div style="flex:1;min-width:0;display:flex;align-items:baseline;gap:6px;overflow:hidden">
      <span style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${boat}</span>
      ${part ? `<span style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${part}</span>` : ''}
    </div>
    ${oosTag}
  </div>`;
}

function maintOpenDetail(r, currentUser) {
  if (!document.getElementById('maintDetailModal')) {
    const el = document.createElement('div');
    el.id = 'maintDetailModal';
    el.className = 'modal-overlay hidden';
    el.innerHTML = `<div class="modal" style="max-width:580px;padding:0;overflow:hidden;display:flex;flex-direction:column;max-height:88vh">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
        <span id="maintDetailTitle" style="font-weight:600;font-size:14px"></span>
        <button onclick="closeModal('maintDetailModal')" style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--muted);line-height:1;padding:0 4px">&times;</button>
      </div>
      <div id="maintDetailBody" style="overflow-y:auto;padding:18px 20px;flex:1"></div>
    </div>`;
    el.addEventListener('click', e => { if (e.target===el) closeModal('maintDetailModal'); });
    document.body.appendChild(el);
  }
  if (!document.getElementById('maintConfirmModal')) {
    const el = document.createElement('div');
    el.id = 'maintConfirmModal';
    el.className = 'modal-overlay hidden';
    el.innerHTML = `<div class="modal" style="max-width:340px;padding:24px;text-align:center">
      <p id="maintConfirmMsg" style="margin:0 0 18px;font-size:14px;line-height:1.5"></p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="maintConfirmOk" style="padding:7px 22px;border:none;border-radius:20px;background:var(--brass);color:#fff;font-weight:600;cursor:pointer;font-size:13px">Confirm</button>
        <button onclick="closeModal('maintConfirmModal')" style="padding:7px 22px;border:1px solid var(--border);border-radius:20px;background:none;cursor:pointer;font-size:13px">Cancel</button>
      </div>
    </div>`;
    el.addEventListener('click', e => { if (e.target===el) closeModal('maintConfirmModal'); });
    document.body.appendChild(el);
  }

  // Resolve user name safely — never throws
  function getBy() {
    return currentUser
      || window._maintUser?.name
      || (typeof user !== 'undefined' ? user?.name : null)
      || 'Staff';
  }

  function doConfirm(msg, cb) {
    document.getElementById('maintConfirmMsg').textContent = msg;
    document.getElementById('maintConfirmOk').onclick = () => { closeModal('maintConfirmModal'); cb(); };
    openModal('maintConfirmModal');
  }

  function wireCard() {
    // Severity dropdown
    const cur  = document.getElementById('mdSevCurrent');
    const drop = document.getElementById('mdSevDropdown');
    if (cur && drop) {
      cur.addEventListener('click', e => {
        e.stopPropagation();
        drop.style.display = drop.style.display==='none' ? 'block' : 'none';
      });
      document.addEventListener('click', function _close() {
        drop.style.display = 'none';
        document.removeEventListener('click', _close);
      });
      drop.querySelectorAll('[data-sev]').forEach(el => {
        el.addEventListener('click', e => {
          e.stopPropagation();
          drop.style.display = 'none';
          const newSev = el.dataset.sev;
          doConfirm(`Change severity to "${newSev}" without resolving?`, async () => {
            await apiPost('saveMaintenance', {id:r.id, severity:newSev});
            r.severity = newSev;
            renderAndWire();
            if (typeof renderMaintenance==='function') renderMaintenance();
          });
        });
      });
    }

    // OOS toggle
    document.getElementById('mdOosBadge')?.addEventListener('click', () => {
      const isOos = boolVal(r.markOos) && r.category==='boat' && !boolVal(r.resolved);
      const msg   = isOos
        ? 'Return to service without resolving the issue?'
        : 'Mark as Out of Service without resolving the issue?';
      doConfirm(msg, async () => {
        await apiPost('saveMaintenance', {id:r.id, markOos:!isOos});
        r.markOos = !isOos;
        renderAndWire();
        if (typeof renderMaintenance==='function') renderMaintenance();
      });
    });

    // Comment post — uses addMaintenanceComment (correct backend action)
    const postComment = async () => {
      const input = document.getElementById('mdCommentInput');
      const text  = (input?.value||'').trim();
      if (!text) return;
      const by = getBy();
      try {
        await apiPost('addMaintenanceComment', {id:r.id, by, text});
        // Update local record so re-render shows new comment immediately
        const existing = parseJson(r.comments, []);
        const now = new Date().toISOString().slice(0,16);
        r.comments = JSON.stringify([...existing, {text, by, at:now}]);
        if (input) input.value = '';
        renderAndWire();
      } catch(e) { console.error('Comment failed', e); }
    };
    document.getElementById('mdCommentBtn')?.addEventListener('click', postComment);
    document.getElementById('mdCommentInput')?.addEventListener('keydown', e => {
      if (e.key==='Enter') postComment();
    });

    // Resolve
    document.getElementById('mdResolveBtn')?.addEventListener('click', () => {
      doConfirm('Mark this issue as resolved?', async () => {
        const now = new Date().toISOString().slice(0,16);
        const by  = getBy();
        await apiPost('resolveMaintenance', {id:r.id, by});
        r.resolved=true; r.resolvedAt=now; r.resolvedBy=by;
        renderAndWire();
        if (typeof renderMaintenance==='function') renderMaintenance();
      });
    });
  }

  function renderAndWire() {
    const catIcon = CAT_ICON[r.category] || '🔧';
    document.getElementById('maintDetailTitle').textContent = catIcon+' '+(r.itemName||r.name||'');
    document.getElementById('maintDetailBody').innerHTML = maintRenderCard(r);
    wireCard();
  }

  renderAndWire();
  openModal('maintDetailModal');
}

function maintRenderCard(r) {
  const SEV_CSS    = {low:'var(--green)',medium:'var(--yellow)',high:'var(--orange)',critical:'var(--red)'};
  const resolved   = boolVal(r.resolved);
  const sevClass   = 'sev-' + (r.severity||'low');
  const catIcon    = CAT_ICON[r.category] || '🔧';
  const isOos      = boolVal(r.markOos) && r.category==='boat' && !resolved;
  const borderCol  = SEV_CSS[r.severity] || 'var(--green)';

  const oosTag = boolVal(r.markOos) && r.category==='boat' && !resolved
    ? `<span id="mdOosBadge" style="display:inline-block;background:#e74c3c;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;cursor:pointer;user-select:none" title="Click to return to service">OOS</span>`
    : (r.category==='boat' && !resolved
        ? `<span id="mdOosBadge" style="display:inline-block;background:var(--surface);border:1px solid var(--border);color:var(--muted);font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;cursor:pointer;user-select:none" title="Click to mark OOS">Mark OOS</span>`
        : '');

  const comments  = parseJson(r.comments, []);
  const commentHtml = comments.map(c => `
    <div style="padding:7px 0;border-top:1px solid var(--border)">
      <div style="font-size:11px;color:var(--muted);margin-bottom:2px">${esc(c.by||'')} · ${(c.at||'').slice(0,16).replace('T',' ')} UTC</div>
      <div style="font-size:13px">${esc(c.text||'')}</div>
    </div>`).join('');

  const resolveBtn = !resolved
    ? `<button id="mdResolveBtn" style="width:100%;margin-top:12px;padding:9px;border:none;border-radius:8px;background:#27ae60;color:#fff;font-weight:600;cursor:pointer;font-size:13px">Mark Resolved</button>`
    : `<div style="margin-top:12px;font-size:12px;color:var(--muted);text-align:center">Resolved ${(r.resolvedAt||'').slice(0,10)} by ${esc(r.resolvedBy||'')}</div>`;

  // Severity dropdown — current badge shown with caret, others hidden until click
  const sevOptions = ['low','medium','high','critical'].filter(s=>s!==r.severity);
  const dropItems  = sevOptions.map(sv =>
    `<div data-sev="${sv}" class="${SEV_BADGE[sv]||'badge-green'}" style="padding:5px 12px;cursor:pointer;font-size:11px;border-top:1px solid var(--border);white-space:nowrap">${sv}</div>`
  ).join('');

  return `<div style="border-left:4px solid ${borderCol};padding-left:12px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <div style="position:relative;display:inline-block" id="mdSevWrapper">
        <span id="mdSevCurrent" class="${SEV_BADGE[r.severity]||'badge-green'}" style="cursor:pointer;font-size:11px;user-select:none">${r.severity||'low'} ▾</span>
        <div id="mdSevDropdown" style="display:none;position:absolute;top:100%;left:0;margin-top:4px;background:var(--bg);border:1px solid var(--border);border-radius:6px;overflow:hidden;z-index:20;min-width:80px;box-shadow:0 4px 12px rgba(0,0,0,.15)">
          ${dropItems}
        </div>
      </div>
      ${catIcon} <strong>${esc(r.itemName||r.name||'')}</strong>
      ${oosTag}
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;display:flex;gap:12px;flex-wrap:wrap">
      ${r.boatName   ? `<span>⛵ ${esc(r.boatName)}</span>`                   : ''}
      ${r.part       ? `<span>🔧 ${esc(r.part)}</span>`                    : ''}
      ${r.reportedBy ? `<span>👤 ${esc(r.reportedBy)}</span>`             : ''}
      ${r.createdAt  ? `<span>📅 ${(r.createdAt||'').slice(0,10)}</span>` : ''}
    </div>
    ${r.description ? `<p style="font-size:13px;margin:0 0 12px;line-height:1.5">${esc(r.description)}</p>` : ''}
    ${r.photoUrl    ? `<img src="${esc(r.photoUrl)}" style="width:100%;border-radius:6px;margin-bottom:12px;cursor:pointer" onclick="viewPhoto('${esc(r.photoUrl)}')">` : ''}
    ${commentHtml ? `<div>${commentHtml}</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:12px">
      <input id="mdCommentInput" type="text" placeholder="Add comment…"
        style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--surface);color:var(--text)">
      <button id="mdCommentBtn" style="padding:7px 14px;border:none;border-radius:6px;background:var(--brass);color:#fff;font-weight:600;cursor:pointer;font-size:13px">Post</button>
    </div>
    ${resolveBtn}
  </div>`;
}

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
