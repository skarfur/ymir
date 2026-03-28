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

const CAT_ICON = { boat: "⛵", equipment: "🔧", facility: "🏗" };

// ── Full card (staff/maintenance.html) ────────────────────────────────────────
/**
 * Render a full maintenance request card with comments, actions, and resolve button.
 * Identical to what was inline in staff/maintenance.html.
 */

// maintRenderCardCompact — staff hub summary card (2 lines, click for detail)
function maintRenderCardCompact(r) {
  const SEV_CSS   = {low:'var(--green)',medium:'var(--yellow)',high:'var(--orange)',critical:'var(--red)'};
  const borderCol = SEV_CSS[r.severity] || 'var(--green)';
  const catIcon   = CAT_ICON[r.category] || '⚙';
  const oosTag    = boolVal(r.markOos) && r.category==='boat' && !boolVal(r.resolved)
    ? '<span style="background:#e74c3c;color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0">OOS</span>' : '';
  const saumaTag = boolVal(r.saumaklubbur)
    ? '<span style="font-size:10px;background:var(--brass)22;color:var(--brass);border:1px solid var(--brass)44;padding:1px 6px;border-radius:10px;white-space:nowrap;flex-shrink:0">🧵</span>' : '';
  const boat = esc(r.boatName||r.boatId||r.itemName||r.name||'');
  const part = esc(r.part||'');
  return `<div class="maint-card maint-card-compact" data-id="${esc(r.id||'')}"
    style="display:flex;align-items:center;gap:8px;padding:9px 12px 9px 14px;border:1px solid var(--border);border-left:4px solid ${borderCol};border-radius:8px;margin-bottom:6px;cursor:pointer;transition:background .15s"
    onmouseenter="this.style.background='var(--surface)'" onmouseleave="this.style.background=''">
    <div style="flex:1;min-width:0;display:flex;align-items:baseline;gap:5px;overflow:hidden">
      <span style="flex-shrink:0">${catIcon}</span>
      <span style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${boat}</span>
      ${part ? `<span style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${part}</span>` : ''}
    </div>
    ${saumaTag}
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
        <button id="maintDetailClose" style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--muted);line-height:1;padding:0 4px">&times;</button>
      </div>
      <div id="maintDetailBody" style="overflow-y:auto;padding:18px 20px;flex:1"></div>
    </div>`;
    el.addEventListener('click', e => { if (e.target===el) closeModal('maintDetailModal'); });
    document.body.appendChild(el);
    el.querySelector('#maintDetailClose').addEventListener('click', ()=>closeModal('maintDetailModal'));
  }
  if (!document.getElementById('maintConfirmModal')) {
    const el = document.createElement('div');
    el.id = 'maintConfirmModal';
    el.className = 'modal-overlay hidden';
    el.innerHTML = `<div class="modal" style="max-width:340px;padding:24px;text-align:center">
      <p id="maintConfirmMsg" style="margin:0 0 18px;font-size:14px;line-height:1.5"></p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="maintConfirmOk" style="padding:7px 22px;border:none;border-radius:20px;background:var(--brass);color:#fff;font-weight:600;cursor:pointer;font-size:13px">Confirm</button>
        <button id="maintConfirmCancel" style="padding:7px 22px;border:1px solid var(--border);border-radius:20px;background:none;cursor:pointer;font-size:13px">Cancel</button>
      </div>
    </div>`;
    el.addEventListener('click', e => { if (e.target===el) closeModal('maintConfirmModal'); });
    el.querySelector('#maintConfirmCancel').addEventListener('click', ()=>closeModal('maintConfirmModal'));
    document.body.appendChild(el);
  }

  function doConfirm(msg, cb) {
    document.getElementById('maintConfirmMsg').textContent = msg;
    document.getElementById('maintConfirmOk').onclick = () => { closeModal('maintConfirmModal'); cb(); };
    openModal('maintConfirmModal');
  }

  function getBy() {
    return currentUser
      || (typeof getUser==='function' ? getUser()?.name : null)
      || 'Staff';
  }

  function renderAndWire() {
    const catIcon  = CAT_ICON[r.category] || '⚙';
    const isOos    = boolVal(r.markOos) && r.category==='boat' && !boolVal(r.resolved);
    const resolved = boolVal(r.resolved);
    const isSauma  = boolVal(r.saumaklubbur);
    const comments = parseJson(r.comments, []);
    const materials = parseJson(r.materials, []);
    const subjectLabel = r.category==='boat'
      ? esc(r.boatName||r.boatId||'')
      : esc(r.itemName||'');

    document.getElementById('maintDetailTitle').textContent =
      (isSauma ? '🧵 ' : catIcon+' ')+subjectLabel+(r.part ? ' · '+r.part : '');

    // Severity dropdown — saumaklúbbur only gets low/medium/high
    const allSevs = isSauma ? ['low','medium','high'] : ['low','medium','high','critical'];
    const sevOptions = allSevs.filter(s=>s!==r.severity);
    const dropItems  = sevOptions.map(sv=>
      `<div data-sev="${sv}" class="badge ${SEV_BADGE[sv]}" style="padding:5px 12px;cursor:pointer;font-size:11px;border-top:1px solid var(--border);white-space:nowrap">${sv}</div>`
    ).join('');

    // OOS: "OOS" when active, "In service" when inactive
    const oosBtn = (r.category==='boat' && !resolved)
      ? `<button id="mdOosBtn" style="padding:3px 11px;border-radius:14px;border:none;font-size:11px;font-weight:600;cursor:pointer;background:${isOos?'#e74c3c':'var(--surface)'};color:${isOos?'#fff':'var(--muted)'};">${isOos?'OOS':'In service'}</button>`
      : '';

    // Comments: text first, then name · timestamp, · to delete
    const commentHtml = comments.map((c,idx)=>`
      <div class="comment-item" style="position:relative;padding-right:24px">
        ${c.text ? `<div style="font-size:13px;margin-bottom:3px">${esc(c.text)}</div>` : ''}
        ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" style="max-width:200px;max-height:150px;border-radius:6px;border:1px solid var(--border);margin-bottom:4px;cursor:pointer" onclick="viewPhoto('${esc(c.photoUrl)}')">` : ''}
        <div style="font-size:11px;color:var(--muted)">${esc(c.by||'')} · ${(c.at||'').slice(0,16).replace('T',' ')} UTC</div>
        ${!resolved ? `<button data-cidx="${idx}" style="position:absolute;top:0;right:0;background:none;border:none;cursor:pointer;font-size:14px;color:var(--muted);padding:0 2px;line-height:1" title="Delete comment">&times;</button>` : ''}
      </div>`).join('');

    // Materials list for saumaklúbbur projects
    const materialsHtml = isSauma && materials.length ? `
      <div style="margin-bottom:14px">
        <div style="font-size:10px;color:var(--brass);letter-spacing:1px;margin-bottom:6px">MATERIALS</div>
        ${materials.map((m,i)=>`
          <div class="mat-row" data-midx="${i}" style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px;border-bottom:1px solid var(--border)33;cursor:pointer">
            <input type="checkbox" ${m.purchased?'checked':''} style="width:15px;height:15px;accent-color:var(--green);cursor:pointer" data-matidx="${i}">
            <span style="${m.purchased?'text-decoration:line-through;color:var(--muted)':''}">${esc(m.name)}</span>
          </div>`).join('')}
      </div>` : '';

    document.getElementById('maintDetailBody').innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <div style="position:relative;display:inline-block">
          <span style="font-size:10px;color:var(--muted);margin-right:4px">${isSauma ? 'Priority' : 'Severity'}:</span>
          <span id="mdSevCurrent" class="badge ${SEV_BADGE[r.severity]||'badge-green'}"
            style="cursor:pointer;user-select:none">${r.severity||'low'} ▾</span>
          <div id="mdSevDropdown" style="display:none;position:absolute;top:100%;left:0;margin-top:4px;background:var(--bg);border:1px solid var(--border);border-radius:6px;overflow:hidden;z-index:20;min-width:80px;box-shadow:0 4px 12px rgba(0,0,0,.15)">
            ${dropItems}
          </div>
        </div>
        ${oosBtn}
      </div>
      ${isSauma ? `<div style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="badge" style="background:var(--brass)22;color:var(--brass);border:1px solid var(--brass)44">🧵 Saumaklúbbur</span>
        ${r.verkstjori ? `<span style="font-size:12px;color:var(--muted)">Verkstjóri: <strong style="color:var(--text)">${esc(r.verkstjori)}</strong></span>` : `<span style="font-size:12px;color:var(--muted);font-style:italic">No verkstjóri assigned</span>`}
        ${!r.verkstjori && !resolved ? `<button id="mdAdoptBtn" class="btn btn-secondary" style="font-size:11px;padding:4px 12px">Adopt Project</button>` : ''}
      </div>` : ''}
      <div class="req-meta" style="margin-bottom:12px">
        ${r.boatName   ? `<span>⛵ ${esc(r.boatName)}</span>`                   : ''}
        ${r.part       ? `<span>${esc(r.part)}</span>`                    : ''}
        ${r.reportedBy ? `<span>${esc(r.reportedBy)}</span>`              : ''}
        ${r.createdAt  ? `<span>${(r.createdAt||'').slice(0,10)}</span>`  : ''}
      </div>
      ${r.description ? `<p style="font-size:13px;margin:0 0 14px;line-height:1.5">${esc(r.description)}</p>` : ''}
      ${r.photoUrl    ? `<img src="${esc(r.photoUrl)}" style="width:100%;border-radius:6px;margin-bottom:14px;cursor:pointer" onclick="viewPhoto('${esc(r.photoUrl)}')">` : ''}
      ${materialsHtml}
      ${commentHtml ? `<div class="comment-thread">${commentHtml}</div>` : ''}
      ${!resolved ? `
      <div class="comment-add" style="margin-top:12px">
        <div style="display:flex;gap:6px;align-items:center">
          <input id="mdCommentInput" type="text" placeholder="Add comment…" style="flex:1">
          <label style="cursor:pointer;font-size:16px;padding:4px;color:var(--muted);flex-shrink:0" title="Attach photo">📷
            <input id="mdCommentPhoto" type="file" accept="image/*" style="display:none">
          </label>
          <button id="mdCommentBtn" class="btn btn-secondary" style="font-size:12px">Post</button>
        </div>
        <div id="mdCommentPhotoPreview" style="margin-top:6px"></div>
      </div>
      <div class="req-actions" style="margin-top:10px;justify-content:space-between">
        <button id="mdResolveBtn" class="btn btn-primary" style="font-size:12px;padding:7px 16px">${isSauma ? 'Mark Completed' : 'Mark Resolved'}</button>
        <button id="mdDeleteBtn" class="btn btn-secondary" style="font-size:12px;color:#e74c3c;margin-left:auto">Delete</button>
      </div>`
      : `<div style="margin-top:10px;font-size:11px;color:var(--muted)">✓ ${isSauma ? 'Completed' : 'Resolved'} ${(r.resolvedAt||'').slice(0,10)} by ${esc(r.resolvedBy||'')}</div>`}
    `;

    // Severity dropdown toggle
    const cur  = document.getElementById('mdSevCurrent');
    const drop = document.getElementById('mdSevDropdown');
    if (cur && drop) {
      cur.addEventListener('click', e => {
        e.stopPropagation();
        drop.style.display = drop.style.display==='none' ? 'block' : 'none';
      });
      document.addEventListener('click', function _close() {
        drop.style.display='none';
        document.removeEventListener('click',_close);
      });
      drop.querySelectorAll('[data-sev]').forEach(el => {
        el.addEventListener('click', e => {
          e.stopPropagation();
          drop.style.display='none';
          const newSev = el.dataset.sev;
          doConfirm(`Change severity to "${newSev}" without resolving?`, async () => {
            await apiPost('saveMaintenance',{id:r.id,severity:newSev});
            r.severity=newSev; renderAndWire();
            if(typeof renderList==='function') renderList();
            if(typeof renderMaintenance==='function') renderMaintenance();
          });
        });
      });
    }

    // Adopt saumaklúbbur project
    document.getElementById('mdAdoptBtn')?.addEventListener('click', ()=>{
      const by = getBy();
      doConfirm('Become verkstjóri for this project?', async ()=>{
        await apiPost('adoptSaumaklubbur',{id:r.id,name:by});
        r.verkstjori=by; renderAndWire();
        if(typeof renderList==='function') renderList();
        if(typeof renderMaintenance==='function') renderMaintenance();
      });
    });

    // Material purchase toggle
    document.querySelectorAll('#maintDetailBody [data-matidx]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const idx = parseInt(cb.dataset.matidx);
        cb.disabled = true;
        try {
          const res = await apiPost('toggleMaterial',{id:r.id,index:idx});
          if (res.materials) r.materials = JSON.stringify(res.materials);
          renderAndWire();
        } catch(e) { cb.disabled = false; }
      });
    });

    // OOS toggle
    document.getElementById('mdOosBtn')?.addEventListener('click', ()=>{
      const msg = isOos
        ? 'Return to service without resolving?'
        : 'Mark as Out of Service without resolving?';
      doConfirm(msg, async ()=>{
        await apiPost('saveMaintenance',{id:r.id,markOos:!isOos});
        r.markOos=!isOos; renderAndWire();
        if(typeof renderList==='function') renderList();
        if(typeof renderMaintenance==='function') renderMaintenance();
      });
    });

    // Delete individual comment
    document.querySelectorAll('#maintDetailBody [data-cidx]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.cidx);
        doConfirm('Delete this comment?', async () => {
          const updated = parseJson(r.comments,[]).filter((_,i)=>i!==idx);
          await apiPost('saveMaintenance',{id:r.id,comments:JSON.stringify(updated)});
          r.comments=JSON.stringify(updated); renderAndWire();
        });
      });
    });

    // Comment photo handling
    let _mdCommentPhotoData = null;
    const photoInput = document.getElementById('mdCommentPhoto');
    const previewEl  = document.getElementById('mdCommentPhotoPreview');
    if (photoInput) {
      photoInput.addEventListener('change', function() {
        const file = this.files[0];
        if (!file) { _mdCommentPhotoData = null; if(previewEl) previewEl.innerHTML=''; return; }
        if (file.size > 5*1024*1024) { _mdCommentPhotoData = null; if(previewEl) previewEl.innerHTML='<span style="font-size:11px;color:var(--red)">Max 5 MB</span>'; this.value=''; return; }
        const reader = new FileReader();
        reader.onload = function(ev) {
          const img = new Image();
          img.onload = function() {
            const maxW = 1400; let data;
            if (img.width <= maxW) { data = ev.target.result; }
            else {
              const c = document.createElement('canvas'); const ratio = maxW/img.width;
              c.width = maxW; c.height = Math.round(img.height*ratio);
              c.getContext('2d').drawImage(img,0,0,c.width,c.height);
              data = c.toDataURL('image/jpeg',0.82);
            }
            _mdCommentPhotoData = { fileName: file.name, fileData: data, mimeType: file.type||'image/jpeg' };
            if(previewEl) previewEl.innerHTML = '<img src="'+data+'" style="width:60px;height:45px;object-fit:cover;border-radius:4px;border:1px solid var(--border)">'
              + '<button onclick="this.parentElement.innerHTML=\'\'" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--muted);vertical-align:top">&times;</button>';
            previewEl.querySelector('button').addEventListener('click', function(){ _mdCommentPhotoData=null; photoInput.value=''; });
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    // Post comment
    const postComment = async () => {
      const input = document.getElementById('mdCommentInput');
      const text  = (input?.value||'').trim();
      if(!text && !_mdCommentPhotoData) return;
      const by = getBy();
      const btn = document.getElementById('mdCommentBtn');
      if(btn) { btn.disabled=true; btn.textContent='Posting…'; }
      try {
        let photoUrl = '';
        if (_mdCommentPhotoData) {
          const upRes = await apiPost('uploadMaintenancePhoto', _mdCommentPhotoData);
          if (upRes.ok) photoUrl = upRes.photoUrl;
        }
        await apiPost('addMaintenanceComment',{id:r.id,by,text:text||'',photoUrl});
        const existing = parseJson(r.comments,[]);
        const entry = {text:text||'',by,at:new Date().toISOString().slice(0,16)};
        if(photoUrl) entry.photoUrl = photoUrl;
        r.comments = JSON.stringify([...existing,entry]);
        _mdCommentPhotoData = null;
        if(input) input.value='';
        renderAndWire();
      } finally { if(btn){btn.disabled=false;btn.textContent='Post';} }
    };
    document.getElementById('mdCommentBtn')?.addEventListener('click',postComment);
    document.getElementById('mdCommentInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')postComment();});

    // Resolve / Complete
    document.getElementById('mdResolveBtn')?.addEventListener('click',()=>{
      doConfirm(isSauma ? 'Mark this project as completed?' : 'Mark this issue as resolved?', async ()=>{
        const now=new Date().toISOString().slice(0,16);
        const by=getBy();
        await apiPost('resolveMaintenance',{id:r.id,by});
        r.resolved=true;r.resolvedAt=now;r.resolvedBy=by;
        renderAndWire();
        if(typeof renderList==='function') renderList();
        if(typeof renderMaintenance==='function') renderMaintenance();
      });
    });

    // Delete issue
    document.getElementById('mdDeleteBtn')?.addEventListener('click',()=>{
      doConfirm('Delete this issue? This cannot be undone.', async ()=>{
        await apiPost('deleteMaintenance',{id:r.id});
        closeModal('maintDetailModal');
        if(typeof renderList==='function') renderList();
        if(typeof renderMaintenance==='function') renderMaintenance();
      });
    });
  }

  renderAndWire();
  openModal('maintDetailModal');
}

function maintRenderCard(r) {
  const resolved  = boolVal(r.resolved);
  const isSauma   = boolVal(r.saumaklubbur);
  const sevClass  = 'sev-' + (r.severity||'low');
  const catIcon   = CAT_ICON[r.category] || '⚙';
  const isOos     = boolVal(r.markOos) && r.category==='boat' && !resolved;
  const subjectLabel = r.category==='boat'
    ? esc(r.boatName||r.boatId||'')
    : esc(r.itemName||'');
  const oosTag = isOos ? '<span class="oos-badge">OOS</span>' : '';
  const saumaBadge = isSauma ? '<span style="font-size:10px;background:var(--brass)22;color:var(--brass);border:1px solid var(--brass)44;padding:1px 6px;border-radius:3px">🧵</span>' : '';

  const comments = parseJson(r.comments, []);
  const materials = isSauma ? parseJson(r.materials, []) : [];
  const matDone = materials.filter(m=>m.purchased).length;
  const commentHtml = comments.map(c=>`
    <div class="comment-item">
      ${c.text ? `<div style="font-size:13px;margin-bottom:3px">${esc(c.text)}</div>` : ''}
      ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" style="width:60px;height:45px;object-fit:cover;border-radius:4px;border:1px solid var(--border);margin-bottom:3px;cursor:pointer" onclick="viewPhoto('${esc(c.photoUrl)}')">` : ''}
      <div style="font-size:11px;color:var(--muted)">${esc(c.by||'')} · ${(c.at||'').slice(0,16).replace('T',' ')} UTC</div>
    </div>`).join('');

  return `<div class="req-card ${sevClass}${resolved?' resolved':''}">
    <div class="req-header">
      <div style="flex:1;min-width:0">
        <div class="req-title">
          ${isSauma ? '🧵' : catIcon} ${subjectLabel}
          ${r.part ? `<span style="color:var(--muted);font-size:12px;font-weight:400"> · ${esc(r.part)}</span>` : ''}
          ${oosTag} ${saumaBadge}
        </div>
        <div class="req-meta">
          <span class="badge ${SEV_BADGE[r.severity]||'badge-green'}">${r.severity||'low'}</span>
          ${isSauma && r.verkstjori ? `<span style="color:var(--brass)">Verkstjóri: ${esc(r.verkstjori)}</span>` : ''}
          ${r.category==='boat'&&r.itemName ? `<span>${esc(r.itemName)}</span>` : ''}
          ${r.reportedBy ? `<span>${esc(r.reportedBy)}</span>` : ''}
          ${r.createdAt  ? `<span>${(r.createdAt||'').slice(0,10)}</span>` : ''}
          ${materials.length ? `<span>📦 ${matDone}/${materials.length}</span>` : ''}
          ${comments.length ? `<span>💬 ${comments.length}</span>` : ''}
        </div>
      </div>
    </div>
    ${r.description ? `<div class="req-desc">${esc(r.description)}</div>` : ''}
    ${r.photoUrl    ? `<img class="req-photo" src="${esc(r.photoUrl)}" style="cursor:pointer" onclick="viewPhoto('${esc(r.photoUrl)}')">` : ''}
    ${commentHtml   ? `<div class="comment-thread">${commentHtml}</div>` : ''}
    ${resolved ? `<div style="margin-top:8px;font-size:11px;color:var(--muted)">✓ ${isSauma ? 'Completed' : 'Resolved'} ${(r.resolvedAt||'').slice(0,10)} by ${esc(r.resolvedBy||'')}</div>` : ''}
  </div>`;
}

function maintRenderRow(m) {
  return `
    <div class="maint-row ${m._done ? "resolved" : ""}" id="mr-${m.id}">
      <input type="checkbox" ${m._done ? "checked" : ""}
        onchange="maintResolveRow('${m.id}', this.checked)">
      <div class="maint-info">
        <div class="maint-boat">
          ${esc(m.boatName || m.itemName || "")}
          <span class="badge ${SEV_BADGE[m.severity] || "badge-muted"}" style="margin-left:6px">${m.severity || ""}</span>
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
    await apiPost("resolveMaintenance", { id, resolvedBy: (typeof getUser==='function'?getUser()?.name:'Staff') });
    r.resolved = true; r.resolvedBy = (typeof getUser==='function'?getUser()?.name:'Staff'); r.resolvedAt = new Date().toISOString();
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
    await apiPost("addMaintenanceComment", { id, by: (typeof getUser==='function'?getUser()?.name:'Staff'), text });
    const r = (window._maintRequests || []).find(x => x.id === id);
    if (r) {
      const comments = parseJson(r.comments, []);
      comments.push({ by: (typeof getUser==='function'?getUser()?.name:'Staff'), at: new Date().toISOString(), text });
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
