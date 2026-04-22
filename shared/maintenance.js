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
  get low()      { return s('maint.sevHint.low'); },
  get medium()   { return s('maint.sevHint.medium'); },
  get high()     { return s('maint.sevHint.high'); },
  get critical() { return s('maint.sevHint.critical'); },
};

const CAT_ICON = { boat: "⛵", equipment: "🔧", facility: "🏗️" };

// ── Title fallback ─ used when a card has no boat/part to show ───────────────
// Returns a truncated description (word boundary) or the "untitled" string, so
// collapsed cards always have readable text next to the category icon.
function maintTitleFallback_(r, max) {
  max = max || 60;
  const d = (r && r.description) ? String(r.description).trim() : '';
  if (!d) return s('maint.untitled');
  if (d.length <= max) return d;
  const cut = d.slice(0, max);
  const sp  = cut.lastIndexOf(' ');
  return (sp > 30 ? cut.slice(0, sp) : cut) + '…';
}

// ── Fallback viewPhoto — pages that include their own can override ────────────
if (typeof window.viewPhoto === 'undefined') {
  window.viewPhoto = function (url) {
    window.open(url, '_blank');
  };
}

// ── Full card (staff/maintenance.html) ────────────────────────────────────────
/**
 * Render a full maintenance request card with comments, actions, and resolve button.
 * Identical to what was inline in staff/maintenance.html.
 */

// maintRenderCardCompact — staff hub summary card (2 lines, click for detail)
function maintRenderCardCompact(r) {
  const SEV_CSS   = {low:'var(--green)',medium:'var(--yellow)',high:'var(--orange)',critical:'var(--red)'};
  const borderCol = SEV_CSS[r.severity] || 'var(--green)';
  const catIcon   = CAT_ICON[r.category] || '⚙️';
  const oosTag    = boolVal(r.markOos) && r.category==='boat' && !boolVal(r.resolved)
    ? '<span style="background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0">'+s('maint.oosTag')+'</span>' : '';
  const saumaTag = boolVal(r.saumaklubbur)
    ? '<span style="font-size:10px;background:var(--brass)22;color:var(--brass-fg);border:1px solid var(--brass)44;padding:1px 6px;border-radius:10px;white-space:nowrap;flex-shrink:0">🧵</span>' : '';
  const subject = r.category==='boat' ? esc(r.boatName||r.boatId||'') : '';
  const part = esc(r.part||'');
  const fallback = (!subject && !part) ? esc(maintTitleFallback_(r)) : '';
  return `<div class="maint-card maint-card-compact" data-id="${esc(r.id||'')}"
    style="display:flex;align-items:center;gap:8px;padding:9px 12px 9px 14px;border:1px solid var(--border);border-left:4px solid ${borderCol};border-radius:8px;margin-bottom:6px;cursor:pointer;transition:background .15s">
    <div style="flex:1;min-width:0;display:flex;align-items:baseline;gap:5px;overflow:hidden">
      <span style="flex-shrink:0">${catIcon}</span>
      ${subject ? `<span style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${subject}</span>` : ''}
      ${part ? `<span style="${subject?'font-size:12px;color:var(--muted);':'font-weight:600;font-size:13px;'}white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${part}</span>` : ''}
      ${fallback ? `<span style="font-weight:600;font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${fallback}</span>` : ''}
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
        <button id="maintConfirmOk" style="padding:7px 22px;border:none;border-radius:20px;background:var(--brass);color:#fff;font-weight:600;cursor:pointer;font-size:13px">${s('maint.confirmBtn')}</button>
        <button id="maintConfirmCancel" style="padding:7px 22px;border:1px solid var(--border);border-radius:20px;background:none;cursor:pointer;font-size:13px">${s('maint.cancelBtn')}</button>
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
      || s('maint.defaultAuthor');
  }

  function renderAndWire() {
    const catIcon  = CAT_ICON[r.category] || '⚙️';
    const isOos    = boolVal(r.markOos) && r.category==='boat' && !boolVal(r.resolved);
    const resolved = boolVal(r.resolved);
    const isSauma  = boolVal(r.saumaklubbur);
    const isOnHold = isSauma && boolVal(r.onHold) && !resolved;
    const comments = parseJson(r.comments, []);
    const materials = parseJson(r.materials, []);
    const _mKt = window._maintUser?.kennitala ? String(window._maintUser.kennitala) : '';
    const followers = parseJson(r.followers, []);
    const isFollowing = _mKt && followers.some(function(f) { return String(f.kt||f) === _mKt; });
    const subjectLabel = r.category==='boat'
      ? esc(r.boatName||r.boatId||'')
      : '';

    document.getElementById('maintDetailTitle').textContent =
      catIcon+' '+(subjectLabel ? subjectLabel+(r.part ? ' · '+r.part : '') : (r.part || maintTitleFallback_(r)));

    // Severity dropdown — saumaklúbbur only gets low/medium/high
    const allSevs = isSauma ? ['low','medium','high'] : ['low','medium','high','critical'];
    const sevOptions = allSevs.filter(s=>s!==r.severity);
    const dropItems  = sevOptions.map(sv=>
      `<div data-sev="${sv}" class="badge ${SEV_BADGE[sv]}" style="padding:5px 12px;cursor:pointer;font-size:11px;border-top:1px solid var(--border);white-space:nowrap">${sv}</div>`
    ).join('');

    // OOS: "OOS" when active, "In service" when inactive
    const oosBtn = (r.category==='boat' && !resolved)
      ? `<button id="mdOosBtn" style="padding:3px 11px;border-radius:14px;border:none;font-size:11px;font-weight:600;cursor:pointer;background:${isOos?'var(--red)':'var(--surface)'};color:${isOos?'#fff':'var(--muted)'};">${isOos?s('maint.oosTag'):s('maint.inService')}</button>`
      : '';

    // Comments: poster · timestamp on top, then text body
    const commentHtml = comments.map((c,idx)=>`
      <div class="comment-item" style="position:relative;padding-right:24px">
        <div style="font-size:11px;margin-bottom:3px"><span style="color:var(--text);font-weight:500">${esc(c.by||'')}</span> <span style="color:var(--muted)">· ${sstr(c.at).slice(0,16).replace('T',' ')}</span></div>
        ${c.text ? `<div style="font-size:13px;margin-bottom:3px">${esc(c.text)}</div>` : ''}
        ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" style="max-width:200px;max-height:150px;border-radius:6px;border:1px solid var(--border);margin-bottom:4px;cursor:pointer" data-view-photo="${esc(c.photoUrl)}">` : ''}
        ${!resolved ? `<button data-cidx="${idx}" style="position:absolute;top:0;right:0;background:none;border:none;cursor:pointer;font-size:14px;color:var(--muted);padding:0 2px;line-height:1" title="${s('maint.deleteComment')}">&times;</button>` : ''}
      </div>`).join('');

    // Materials list for saumaklúbbur projects
    const materialsHtml = isSauma ? `
      <div style="margin-bottom:14px">
        <div style="font-size:10px;color:var(--brass-fg);letter-spacing:1px;margin-bottom:6px">${s('maint.materials')}</div>
        ${materials.map((m,i)=>`
          <div class="mat-row" data-midx="${i}" style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px;border-bottom:1px solid var(--border)33">
            <input type="checkbox" ${m.purchased?'checked':''} style="width:15px;height:15px;accent-color:var(--green);cursor:pointer" data-matidx="${i}">
            <span style="flex:1;${m.purchased?'text-decoration:line-through;color:var(--muted)':''}">${esc(m.name)}</span>
            ${!resolved ? `<button data-matdelete="${i}" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--muted);padding:0 2px;line-height:1" title="${s('maint.removeMaterial')}">&times;</button>` : ''}
          </div>`).join('')}
        ${!resolved ? `<div style="display:flex;gap:6px;align-items:center;margin-top:8px">
          <input id="mdMaterialInput" type="text" placeholder="${s('maint.addMaterialPh')}" style="flex:1">
          <button id="mdAddMaterialBtn" class="btn btn-secondary" style="font-size:11px;padding:4px 12px">${s('maint.addMaterialBtn')}</button>
        </div>` : ''}
      </div>` : '';

    document.getElementById('maintDetailBody').innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <div style="position:relative;display:inline-block">
          <span style="font-size:10px;color:var(--muted);margin-right:4px">${isSauma ? s('maint.priorityLabel') : s('maint.severityLabel')}:</span>
          <span id="mdSevCurrent" class="badge ${SEV_BADGE[r.severity]||'badge-green'}"
            style="cursor:pointer;user-select:none">${r.severity||'low'} ▾</span>
          <div id="mdSevDropdown" style="display:none;position:absolute;top:100%;left:0;margin-top:4px;background:var(--bg);border:1px solid var(--border);border-radius:6px;overflow:hidden;z-index:20;min-width:80px;box-shadow:0 4px 12px rgba(0,0,0,.15)">
            ${dropItems}
          </div>
        </div>
        ${oosBtn}
      </div>
      ${isSauma ? `<div style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="badge" style="background:var(--brass)22;color:var(--brass-fg);border:1px solid var(--brass)44">🧵 ${s('maint.saumaBadge')}</span>
        ${isOnHold ? `<span class="badge" style="background:var(--yellow)22;color:var(--yellow);border:1px solid var(--yellow)44">⏸ ${s('maint.onHoldBadge')}</span>` : ''}
        ${r.verkstjori ? `<span style="font-size:12px;color:var(--muted)">${s('maint.verkstjoriPrefix')} <strong style="color:var(--text)">${esc(r.verkstjori)}</strong></span>` : `<span style="font-size:12px;color:var(--muted);font-style:italic">${s('maint.noVerkstjori')}</span>`}
        ${!r.verkstjori && !resolved ? `<button id="mdAdoptBtn" class="btn btn-secondary" style="font-size:11px;padding:4px 12px">${s('maint.adoptProject')}</button>` : ''}
        ${_mKt && !resolved ? `<button id="mdFollowBtn" class="btn btn-secondary" style="font-size:11px;padding:4px 12px">${isFollowing ? s('sauma.unfollow') : s('sauma.follow')}</button>` : ''}
      </div>` : ''}
      <div class="req-meta" style="margin-bottom:12px;font-size:12px;color:var(--muted)">
        ${r.reportedBy ? `<span>${s('maint.reportedByLabel')} <span style="color:var(--text);font-weight:500">${esc(r.reportedBy)}</span></span>` : ''}
        ${r.createdAt  ? `<span>${sstr(r.createdAt).slice(0,10)}</span>`  : ''}
      </div>
      ${r.description ? `<p style="font-size:13px;margin:0 0 14px;line-height:1.5">${esc(r.description)}</p>` : ''}
      ${r.photoUrl    ? `<img src="${esc(r.photoUrl)}" style="width:100%;border-radius:6px;margin-bottom:14px;cursor:pointer" data-view-photo="${esc(r.photoUrl)}">` : ''}
      ${materialsHtml}
      ${commentHtml ? `<div class="comment-thread">${commentHtml}</div>` : ''}
      ${!resolved ? `
      <div class="comment-add" style="margin-top:12px">
        <div style="display:flex;gap:6px;align-items:center">
          <input id="mdCommentInput" type="text" placeholder="${s('maint.addCommentPh')}" style="flex:1">
          <label style="cursor:pointer;font-size:16px;padding:4px;color:var(--muted);flex-shrink:0" title="${s('maint.attachPhoto')}">📷
            <input id="mdCommentPhoto" type="file" accept="image/*" style="display:none">
          </label>
          <button id="mdCommentBtn" class="btn btn-secondary" style="font-size:12px">${s('maint.postBtn')}</button>
        </div>
        <div id="mdCommentPhotoPreview" style="margin-top:6px"></div>
      </div>
      ${isSauma && !boolVal(r.approved) ? `<div style="margin-bottom:10px;padding:8px 12px;border-radius:6px;background:var(--brass)11;border:1px solid var(--brass)44;font-size:12px;color:var(--brass-fg)">⏳ ${s('maint.pendingReview')}<button id="mdApproveBtn" class="btn btn-primary" style="font-size:11px;padding:4px 14px;margin-left:12px">${s('maint.approveBtn')}</button></div>` : ''}
      <div class="req-actions" style="margin-top:10px;display:flex;gap:8px;align-items:center">
        <button id="mdDeleteBtn" class="btn btn-secondary" style="font-size:12px;color:var(--red)">${s('maint.deleteBtn')}</button>
        ${typeof window.maintOpenEdit === 'function' ? `<button id="mdEditBtn" class="btn btn-secondary" style="font-size:12px;padding:7px 14px">${s('btn.edit')}</button>` : ''}
        ${isSauma && boolVal(r.approved) ? `<button id="mdHoldBtn" class="btn btn-secondary" style="font-size:12px;padding:7px 14px;margin-left:auto">${isOnHold ? '▶ '+s('maint.resumeBtn') : '⏸ '+s('maint.putOnHold')}</button>` : ''}
        <button id="mdResolveBtn" class="btn btn-primary" style="font-size:12px;padding:7px 16px${isSauma && boolVal(r.approved) ? '' : ';margin-left:auto'}">${isSauma ? s('maint.markCompleted') : s('maint.markResolved2')}</button>
      </div>`
      : `<div style="margin-top:10px;font-size:11px;color:var(--muted)">${s(isSauma ? 'maint.completedBy' : 'maint.resolvedBy', { date: sstr(r.resolvedAt).slice(0,10), by: esc(r.resolvedBy||'') })}</div>`}
    `;

    // Severity dropdown toggle
    const cur  = document.getElementById('mdSevCurrent');
    const drop = document.getElementById('mdSevDropdown');
    if (cur && drop) {
      cur.addEventListener('click', e => {
        e.stopPropagation();
        drop.style.display = drop.style.display==='none' ? 'block' : 'none';
      });
      document.addEventListener('click', function() {
        drop.style.display='none';
      }, { once: true });
      drop.querySelectorAll('[data-sev]').forEach(el => {
        el.addEventListener('click', e => {
          e.stopPropagation();
          drop.style.display='none';
          const newSev = el.dataset.sev;
          doConfirm(s('maint.changeSevConfirm',{sev:newSev}), async () => {
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
      doConfirm(s('maint.adoptConfirm'), async ()=>{
        await apiPost('adoptSaumaklubbur',{id:r.id,name:by});
        r.verkstjori=by; renderAndWire();
        if(typeof renderList==='function') renderList();
        if(typeof renderMaintenance==='function') renderMaintenance();
      });
    });

    // Hold / Resume saumaklúbbur project
    document.getElementById('mdHoldBtn')?.addEventListener('click', ()=>{
      const newHold = !boolVal(r.onHold);
      const msg = newHold ? s('maint.holdConfirm') : s('maint.resumeConfirm');
      doConfirm(msg, async ()=>{
        await apiPost('holdSaumaklubbur',{id:r.id,onHold:newHold});
        r.onHold=newHold; renderAndWire();
        if(typeof renderList==='function') renderList();
        if(typeof renderMaintenance==='function') renderMaintenance();
      });
    });

    // Follow / Unfollow saumaklúbbur project
    document.getElementById('mdFollowBtn')?.addEventListener('click', async ()=>{
      const kt = window._maintUser?.kennitala;
      if (!kt) return;
      const followers = parseJson(r.followers, []);
      const alreadyFollowing = followers.some(function(f) { return String(f.kt||f) === String(kt); });
      if (alreadyFollowing) {
        await apiPost('unfollowProject',{id:r.id,kennitala:kt});
        r.followers = JSON.stringify(followers.filter(function(f) { return String(f.kt||f) !== String(kt); }));
        if(typeof toast==='function') toast(s('sauma.unfollowed'));
      } else {
        await apiPost('followProject',{id:r.id,kennitala:kt});
        followers.push({kt:String(kt),at:new Date().toISOString()});
        r.followers = JSON.stringify(followers);
        if(typeof toast==='function') toast(s('sauma.followed'));
      }
      renderAndWire();
      if(typeof renderList==='function') renderList();
      if(typeof renderBoard==='function') renderBoard();
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
          if(typeof renderList==='function') renderList();
        } catch(e) { cb.disabled = false; }
      });
    });

    // Add material
    const addMat = async () => {
      const input = document.getElementById('mdMaterialInput');
      const name = (input?.value||'').trim();
      if (!name) return;
      const btn = document.getElementById('mdAddMaterialBtn');
      if(btn) btn.disabled = true;
      try {
        const res = await apiPost('addMaterial',{id:r.id,name});
        if (res.materials) r.materials = JSON.stringify(res.materials);
        renderAndWire();
        if(typeof renderList==='function') renderList();
      } catch(e) { if(btn) btn.disabled = false; }
    };
    document.getElementById('mdAddMaterialBtn')?.addEventListener('click', addMat);
    document.getElementById('mdMaterialInput')?.addEventListener('keydown', e => { if(e.key==='Enter') addMat(); });

    // Delete material
    document.querySelectorAll('#maintDetailBody [data-matdelete]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.matdelete);
        doConfirm(s('maint.removeMaterialConfirm'), async () => {
          const res = await apiPost('removeMaterial',{id:r.id,index:idx});
          if (res.materials) r.materials = JSON.stringify(res.materials);
          renderAndWire();
          if(typeof renderList==='function') renderList();
        });
      });
    });

    // OOS toggle
    document.getElementById('mdOosBtn')?.addEventListener('click', ()=>{
      const msg = isOos
        ? s('maint.returnToService')
        : s('maint.markOosConfirm');
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
        doConfirm(s('maint.deleteCommentConfirm'), async () => {
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
        if (file.size > 5*1024*1024) { _mdCommentPhotoData = null; if(previewEl) previewEl.innerHTML='<span style="font-size:11px;color:var(--red)">'+s('maint.maxFileSize')+'</span>'; this.value=''; return; }
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
              + '<button data-clear-parent style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--muted);vertical-align:top">&times;</button>';
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
      if(btn) { btn.disabled=true; btn.textContent=s('maint.postingBtn'); }
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
      } finally { if(btn){btn.disabled=false;btn.textContent=s('maint.postBtn');} }
    };
    document.getElementById('mdCommentBtn')?.addEventListener('click',postComment);
    document.getElementById('mdCommentInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')postComment();});

    // Approve sauma project
    document.getElementById('mdApproveBtn')?.addEventListener('click', async ()=>{
      const btn = document.getElementById('mdApproveBtn');
      if(btn) { btn.disabled=true; btn.textContent=s('maint.approvingBtn'); }
      try {
        await apiPost('approveSaumaklubbur',{id:r.id});
        r.approved = true; renderAndWire();
        if(typeof renderList==='function') renderList();
        if(typeof renderStats==='function') renderStats();
        if(typeof renderMaintenance==='function') renderMaintenance();
      } catch(e) { if(btn){btn.disabled=false;btn.textContent=s('maint.approveBtn');} }
    });

    // Resolve / Complete
    document.getElementById('mdResolveBtn')?.addEventListener('click',()=>{
      doConfirm(isSauma ? s('maint.completeConfirm') : s('maint.resolveConfirm2'), async ()=>{
        const now=new Date().toISOString().slice(0,16);
        const by=getBy();
        await apiPost('resolveMaintenance',{id:r.id,by});
        r.resolved=true;r.resolvedAt=now;r.resolvedBy=by;
        renderAndWire();
        if(typeof renderList==='function') renderList();
        if(typeof renderMaintenance==='function') renderMaintenance();
      });
    });

    // Edit issue — delegates to the page-provided window.maintOpenEdit handler
    document.getElementById('mdEditBtn')?.addEventListener('click',()=>{
      if (typeof window.maintOpenEdit !== 'function') return;
      closeModal('maintDetailModal');
      window.maintOpenEdit(r);
    });

    // Delete issue
    document.getElementById('mdDeleteBtn')?.addEventListener('click',()=>{
      doConfirm(s('maint.deleteConfirm'), async ()=>{
        try {
          await apiPost('deleteMaintenance',{id:r.id});
        } catch(e) {
          if(typeof ymAlert==='function') ymAlert(s('logbook.errGeneric', { msg: e.message }));
          return;
        }
        // Remove from any in-memory lists the page is using
        [window.allRequests, window._maintRequests, window._dlMaintenance].forEach(list => {
          if (Array.isArray(list)) {
            const idx = list.findIndex(x => x && x.id === r.id);
            if (idx !== -1) list.splice(idx, 1);
          }
        });
        closeModal('maintDetailModal');
        if(typeof renderStats==='function') renderStats();
        if(typeof renderList==='function') renderList();
        if(typeof renderMaintenance==='function') renderMaintenance();
      });
    });
  }

  renderAndWire();
  openModal('maintDetailModal');

  // Mark followed project as seen — clears "updated since follow" notifications
  (function() {
    const kt = window._maintUser?.kennitala;
    if (!kt || !boolVal(r.saumaklubbur)) return;
    const followers = parseJson(r.followers, []);
    const myIdx = followers.findIndex(function(f) { return String(f.kt||f) === String(kt); });
    if (myIdx < 0) return;
    const myFollow = followers[myIdx];
    if (!r.updatedAt || !myFollow.at || r.updatedAt <= myFollow.at) return;
    // Optimistically bump local timestamp so subsequent renders don't re-trigger
    followers[myIdx] = { kt: String(kt), at: new Date().toISOString() };
    r.followers = JSON.stringify(followers);
    apiPost('markProjectSeen', { id: r.id, kennitala: kt }).catch(function() {});
  })();
}

function maintRenderCard(r) {
  const resolved  = boolVal(r.resolved);
  const isSauma   = boolVal(r.saumaklubbur);
  const sevClass  = 'sev-' + (r.severity||'low');
  const catIcon   = CAT_ICON[r.category] || '⚙️';
  const isOos     = boolVal(r.markOos) && r.category==='boat' && !resolved;
  const subjectLabel = r.category==='boat'
    ? esc(r.boatName||r.boatId||'')
    : '';
  const oosTag = isOos ? '<span class="oos-badge">'+s('maint.oosTag')+'</span>' : '';
  const saumaBadge = isSauma ? '<span style="font-size:10px;background:var(--brass)22;color:var(--brass-fg);border:1px solid var(--brass)44;padding:1px 6px;border-radius:3px">🧵</span>' : '';

  const comments = parseJson(r.comments, []);
  const materials = isSauma ? parseJson(r.materials, []) : [];
  const matDone = materials.filter(m=>m.purchased).length;
  const commentHtml = comments.map(c=>`
    <div class="comment-item">
      <div style="font-size:11px;margin-bottom:2px"><span class="comment-by">${esc(c.by||'')}</span> <span style="color:var(--muted)">· ${sstr(c.at).slice(0,16).replace('T',' ')}</span></div>
      ${c.text ? `<div style="font-size:13px;margin-bottom:3px">${esc(c.text)}</div>` : ''}
      ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" style="width:60px;height:45px;object-fit:cover;border-radius:4px;border:1px solid var(--border);margin-bottom:3px;cursor:pointer" data-view-photo="${esc(c.photoUrl)}">` : ''}
    </div>`).join('');

  return `<div class="req-card ${sevClass}${resolved?' resolved':''}">
    <div class="req-header">
      <div style="flex:1;min-width:0">
        <div class="req-title">
          ${catIcon} ${subjectLabel ? subjectLabel : ''}${subjectLabel && r.part ? `<span style="color:var(--muted);font-size:12px;font-weight:400"> · ${esc(r.part)}</span>` : ''}${!subjectLabel && r.part ? esc(r.part) : ''}${!subjectLabel && !r.part ? esc(maintTitleFallback_(r)) : ''}
          ${oosTag} ${saumaBadge}
        </div>
        <div class="req-meta">
          <span class="badge ${SEV_BADGE[r.severity]||'badge-green'}">${r.severity||'low'}</span>
          ${isSauma && r.verkstjori ? `<span style="color:var(--brass-fg)">${s('maint.verkstjoriPrefix')} ${esc(r.verkstjori)}</span>` : ''}
          ${r.reportedBy ? `<span>${esc(r.reportedBy)}</span>` : ''}
          ${r.createdAt  ? `<span>${sstr(r.createdAt).slice(0,10)}</span>` : ''}
          ${materials.length ? `<span>📦 ${matDone}/${materials.length}</span>` : ''}
          ${comments.length ? `<span>💬 ${comments.length}</span>` : ''}
        </div>
      </div>
    </div>
    ${r.description ? `<div class="req-desc">${esc(r.description)}</div>` : ''}
    ${r.photoUrl    ? `<img class="req-photo" src="${esc(r.photoUrl)}" style="cursor:pointer" data-view-photo="${esc(r.photoUrl)}">` : ''}
    ${commentHtml   ? `<div class="comment-thread">${commentHtml}</div>` : ''}
    ${resolved ? `<div style="margin-top:8px;font-size:11px;color:var(--muted)">${s(isSauma ? 'maint.completedBy' : 'maint.resolvedBy', { date: sstr(r.resolvedAt).slice(0,10), by: esc(r.resolvedBy||'') })}</div>` : ''}
  </div>`;
}

function maintRenderRow(m) {
  return `
    <div class="maint-row ${m._done ? "resolved" : ""}" id="mr-${m.id}">
      <input type="checkbox" ${m._done ? "checked" : ""}
        data-maint-resolve="${m.id}">
      <div class="maint-info">
        <div class="maint-boat">
          ${m.category==='boat' ? esc(m.boatName||m.boatId||'') : ''}${m.category==='boat' && m.part ? ' · ' : ''}${m.part ? esc(m.part) : ''}
          <span class="badge ${SEV_BADGE[m.severity] || "badge-muted"}" style="margin-left:6px">${m.severity || ""}</span>
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
  if (!await ymConfirm(s('maint.resolveConfirm2'))) return;
  const r = (window._maintRequests || []).find(x => x.id === id);
  if (!r) return;
  try {
    await apiPost("resolveMaintenance", { id, resolvedBy: (typeof getUser==='function'?getUser()?.name:s('maint.defaultAuthor')) });
    r.resolved = true; r.resolvedBy = (typeof getUser==='function'?getUser()?.name:s('maint.defaultAuthor')); r.resolvedAt = new Date().toISOString();
    if (boolVal(r.markOos) && r.boatId) {
      await apiPost("saveBoatOos", { id: r.boatId, oos: false, oosReason: "" });
    }
    if (typeof renderStats === "function") renderStats();
    if (typeof renderList  === "function") renderList();
    toast(s('maint.resolvedToast'));
  } catch(e) { ymAlert(s('logbook.errGeneric', { msg: e.message })); }
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
    toast(s('maint.commentAdded'));
  } catch(e) { ymAlert(s('logbook.errGeneric', { msg: e.message })); }
}

/**
 * Resolve a dailylog maintenance row via checkbox.
 * Expects window._dlMaintenance to hold the local array.
 */
async function maintResolveRow(id, checked) {
  if (!checked) return; // un-resolving is not supported; ignore unchecks
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
      ymAlert(s('logbook.errGeneric', { msg: e.message }));
    }
  }
}

// Delegated handlers for data-* attrs on rendered maintenance DOM
// (replaces inline onclicks/onchange in the templates above).
if (typeof document !== 'undefined' && !document._maintClickListener) {
  document._maintClickListener = true;
  document.addEventListener('click', function(e) {
    const v = e.target.closest('[data-view-photo]');
    if (v && typeof window.viewPhoto === 'function') {
      window.viewPhoto(v.dataset.viewPhoto);
      return;
    }
    const c = e.target.closest('[data-clear-parent]');
    if (c && c.parentElement) {
      c.parentElement.innerHTML = '';
    }
  });
  document.addEventListener('change', function(e) {
    const r = e.target.closest('[data-maint-resolve]');
    if (r && typeof window.maintResolveRow === 'function') {
      window.maintResolveRow(r.dataset.maintResolve, r.checked);
    }
  });
}
