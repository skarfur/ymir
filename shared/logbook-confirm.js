// ═══════════════════════════════════════════════════════════════════════════════
// logbook-confirm.js — Crew-confirmation modal + editNote + dismiss
// Extracted from shared/logbook.js. All functions stay global via the existing
// non-module script pattern. Callers (captain/index.html, logbook/index.html)
// must include this file alongside shared/logbook.js.
// ═══════════════════════════════════════════════════════════════════════════════

async function requestTripValidation(id) {
  try {
    await apiPost('requestVerification', {
      tripId: id,
      fromKennitala: user.kennitala,
      fromName: user.name
    });
    // Update local trip data
    const t = myTrips.find(x => x.id === id);
    if (t) t.validationRequested = true;
    applyFilter();
    showToast(s('logbook.verificationReq'));
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

// ══ CONFIRMATIONS ════════════════════════════════════════════════════════════
let _confirmations={incoming:[],outgoing:[]}, _confirmationsLoaded=false;

async function loadConfirmations(){
  try{
    const res=await (window._earlyConfirmations || apiGet('getConfirmations',{kennitala:user.kennitala}));
    // One-shot: clear the prefetch handle so the next call (e.g. after a
    // mutation invalidates the cache) refetches instead of reusing stale data.
    window._earlyConfirmations = null;
    const incoming = res.incoming||[], outgoing = res.outgoing||[];
    // Auto-dismiss resolved confirmations server-side in background.
    // Exception: keep rejected outgoing crew_assigned visible — the skipper
    // needs to review and acknowledge the resulting crew-count change.
    const _isCrewRejection = c => c.status==='rejected' && c.type==='crew_assigned';
    const resolved = incoming.filter(c=>c.status!=='pending')
      .concat(outgoing.filter(c=>c.status!=='pending' && !_isCrewRejection(c)));
    if (resolved.length) {
      resolved.forEach(c => apiPost('dismissConfirmation', { id: c.id }).catch(function(){}));
    }
    // Keep pending + confirmed in local state (confirmed needed for helm/student display).
    // Outgoing also keeps rejected crew_assigned so the skipper sees the change.
    _confirmations={
      incoming:incoming.filter(c=>c.status==='pending'||c.status==='confirmed'),
      outgoing:outgoing.filter(c=>c.status==='pending'||c.status==='confirmed'||_isCrewRejection(c)),
    };
    _confirmationsLoaded=true;
    updateConfBadge();
    // Re-render trips so confirmation badges (pending/helm/student) appear
    if (typeof applyFilter === 'function') applyFilter();
  }catch(e){
    console.warn('loadConfirmations:',e.message);
    _confirmationsLoaded=true;
  }
}

function updateConfBadge(){
  var pending=_confirmations.incoming.filter(function(c){return c.status==='pending';}).length;
  // Rejected crew_assigned outgoing items also need attention from the skipper
  var rejected=_confirmations.outgoing.filter(function(c){return c.status==='rejected'&&c.type==='crew_assigned';}).length;
  var total=pending+rejected;
  var badge=document.getElementById('confBadge');
  if(badge){badge.textContent=total;badge.style.display=total>0?'':'none';}
}

async function openConfirmationsModal(){
  document.getElementById('confirmationsTitle').textContent=s('member.confirmationsTitle');
  openModal('confirmationsModal');
  document.body.style.overflow='hidden';
  if(!_confirmationsLoaded) await loadConfirmations();
  renderConfirmations();
}

function closeConfModal(){
  closeModal('confirmationsModal');
  document.body.style.overflow='';
}

function _confDesc(c, outgoing){
  if(outgoing){
    var n = esc(c.toName || '?');
    if(c.type==='crew_assigned') return s('member.crewAssignedOut', {name:n});
    if(c.type==='crew_join')     return s('member.crewJoinOut',     {name:n});
    if(c.type==='helm')          return s('member.helmReqOut',      {name:n});
  }
  if(c.type==='crew_assigned') return s('member.crewAssigned');
  if(c.type==='crew_join') return s('member.crewJoin');
  if(c.type==='helm') return s('member.helmReq');
  if(c.type==='student') return s('logbook.studentBadge');
  if(c.type==='verify') return s('logbook.tripVerification');
  return c.type;
}

function renderConfirmations(){
  var inEl=document.getElementById('incomingConfirmations');
  var outEl=document.getElementById('outgoingConfirmations');

  // Clear dismiss-all area (resolved items are auto-dismissed on load)
  var dismissAllEl = document.getElementById('confDismissAll');
  if (!dismissAllEl) {
    var d = document.createElement('div');
    d.id = 'confDismissAll';
    inEl.parentElement.insertBefore(d, inEl.parentElement.querySelector('[data-s="member.incoming"]'));
  }
  dismissAllEl = document.getElementById('confDismissAll');
  if (dismissAllEl) dismissAllEl.innerHTML = '';

  // Group incoming confirmations by trip (linkedCheckoutId or tripId)
  var incoming=_confirmations.incoming.filter(function(c){return c.status==='pending';}).sort(function(a,b){return(b.createdAt||'').localeCompare(a.createdAt||'');});
  if(!incoming.length){
    inEl.innerHTML='<div class="empty-note">'+s('member.noIncoming')+'</div>';
  }else{
    var inGroups={}, inOrder=[];
    incoming.forEach(function(c){
      var key=c.linkedCheckoutId||c.tripId||c.id;
      if(!inGroups[key]){inGroups[key]=[];inOrder.push(key);}
      inGroups[key].push(c);
    });
    inEl.innerHTML=inOrder.map(function(key){
      var group=inGroups[key];
      var first=group[0];
      var header='<div class="flex-center flex-wrap gap-6 mb-6">'+
        '<span class="conf-boat-info fw-500">'+esc(first.boatName||'')+'</span>'+
        '<span class="conf-date-info">'+esc(first.date||'')+(first.timeOut?' '+esc(first.timeOut):'')+'</span>'+
        '<span class="conf-name text-xs text-muted">'+s('logbook.from')+' '+esc(first.fromName||'?')+'</span>'+
      '</div>';
      var items=group.map(function(c){
        return '<div class="flex-center flex-wrap gap-6" style="padding:4px 0;border-top:1px solid var(--border)22">'+
          '<span class="conf-type" style="flex-shrink:0">'+_confDesc(c)+'</span>'+
          '<div class="flex-center gap-4 ml-auto">'+
            '<button class="btn-confirm" data-trip-action="respond-conf" data-trip-id="'+esc(c.id)+'" data-trip-arg="confirmed" style="font-size:10px;font-family:inherit;padding:3px 8px;border-radius:5px;cursor:pointer;border:1px solid">'+s('member.confirmBtn')+'</button>'+
            '<button class="btn-reject" data-trip-action="reject-conf" data-trip-id="'+esc(c.id)+'" style="font-size:10px;font-family:inherit;padding:3px 8px;border-radius:5px;cursor:pointer;border:1px solid">'+s('member.rejectBtn')+'</button>'+
          '</div>'+
        '</div>';
      }).join('');
      return '<div class="conf-card">'+header+items+'</div>';
    }).join('');
  }

  // Group outgoing confirmations by trip — show pending and rejected crew_assigned
  // (the latter need explicit acknowledgement so the skipper sees the count change).
  var outgoing=_confirmations.outgoing.filter(function(c){
    return c.status==='pending' || (c.status==='rejected' && c.type==='crew_assigned');
  }).sort(function(a,b){return(b.createdAt||'').localeCompare(a.createdAt||'');});
  if(!outgoing.length){
    outEl.innerHTML='<div class="empty-note">'+s('member.noOutgoing')+'</div>';
  }else{
    var outGroups={}, outOrder=[];
    outgoing.forEach(function(c){
      var key=c.linkedCheckoutId||c.tripId||c.id;
      if(!outGroups[key]){outGroups[key]=[];outOrder.push(key);}
      outGroups[key].push(c);
    });
    outEl.innerHTML=outOrder.map(function(key){
      var group=outGroups[key];
      var first=group[0];
      var header='<div class="flex-center flex-wrap gap-6 mb-6">'+
        '<span class="conf-boat-info fw-500">'+esc(first.boatName||'')+'</span>'+
        '<span class="conf-date-info">'+esc(first.date||'')+(first.timeOut?' '+esc(first.timeOut):'')+'</span>'+
      '</div>';
      var items=group.map(function(c){
        if(c.status==='rejected'){
          var why=c.rejectComment?' <span class="text-muted text-xs">— '+esc(c.rejectComment)+'</span>':'';
          return '<div class="flex-center flex-wrap gap-6" style="padding:4px 0;border-top:1px solid var(--border)22">'+
            '<span class="conf-name fw-500 text-sm">'+esc(c.toName||'?')+'</span>'+
            '<span class="conf-type">'+s('member.crewDeclined')+why+'</span>'+
            '<div class="flex-center gap-4 ml-auto">'+
              '<span class="conf-status rejected">'+s('member.statusRejected')+'</span>'+
              '<button class="btn-confirm" data-trip-action="ack-rej" data-trip-id="'+esc(c.id)+'" style="font-size:10px;font-family:inherit;padding:3px 8px;border-radius:5px;cursor:pointer;border:1px solid">'+s('member.ackBtn')+'</button>'+
            '</div>'+
          '</div>';
        }
        return '<div class="flex-center flex-wrap gap-6" style="padding:4px 0;border-top:1px solid var(--border)22">'+
          '<span class="conf-type">'+_confDesc(c, true)+'</span>'+
          '<span class="conf-status pending ml-auto">'+s('member.statusPending')+'</span>'+
        '</div>';
      }).join('');
      return '<div class="conf-card">'+header+items+'</div>';
    }).join('');
  }
}

// Skipper acknowledges that a rejected crew_assigned has been seen — server
// already adjusted crewNames + crew count when the rejection was recorded;
// dismissing here just clears it from the notification list.
async function ackCrewRejection(confId){
  try{
    await apiPost('dismissConfirmation',{id:confId});
    _confirmations.outgoing=_confirmations.outgoing.filter(c=>c.id!==confId);
    updateConfBadge();
    renderConfirmations();
    // Crew count on the skipper's trip may have changed — refresh the logbook view
    if(typeof reload==='function') reload();
  }catch(e){showToast(s('toast.error')+': '+e.message,'err');}
}

async function respondConf(confId,response,rejectComment){
  // Optimistic update: flip local state and repaint before the server round-trip
  // so the UI feels instant. On error we revert below.
  var _conf = _confirmations.incoming.find(c => c.id === confId);
  var _prevStatus = _conf ? _conf.status : null;
  if (_conf) _conf.status = response === 'confirmed' ? 'confirmed' : 'rejected';
  // Server-side dismiss hides the row from BOTH parties (single shared flag),
  // so skip it when rejecting a crew_assigned: the skipper still needs to see
  // the rejection and acknowledge the resulting crew-count change.
  var skipDismiss = response==='rejected' && _conf && _conf.type==='crew_assigned';
  updateConfBadge();
  renderConfirmations();
  try{
    await apiPost('respondConfirmation',{id:confId,response:response,rejectComment:rejectComment||''});
    if (!skipDismiss) {
      apiPost('dismissConfirmation', { id: confId }).catch(function(){});
    }
    if(response==='confirmed'){
      // Refresh logbook to show the new crew trip created server-side
      reload();
    }
    showToast(response==='confirmed'?s('logbook.confirmed'):s('logbook.rejected'));
  }catch(e){
    // Revert optimistic change so the UI matches reality
    if (_conf) _conf.status = _prevStatus;
    updateConfBadge();
    renderConfirmations();
    showToast(s('toast.error')+': '+e.message,'err');
  }
}

async function promptRejectConf(confId){
  var comment=await ymPrompt(s('member.rejectReason'));
  if(comment===null) return;
  respondConf(confId,'rejected',comment);
}

// ── Edit notes (only notes remain editable after handshake) ──────────────────
async function editNote(tripId, field) {
  const t = myTrips.find(x => x.id === tripId);
  if (!t) return;
  const current = field === 'skipperNote' ? (t.skipperNote||'') : (t.notes||'');
  const label = field === 'skipperNote'
    ? s('logbook.skipperNoteLabel')
    : s('logbook.privateNoteLabel');
  const val = await ymPrompt(label, current);
  if (val === null) return;
  try {
    const update = {};
    update[field] = val;
    await apiPost('saveTrip', { id: tripId, [field]: val });
    t[field] = val;
    applyFilter();
    showToast(s('logbook.noteSaved'), 'success');
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

// ── Dismiss confirmations ───────────────────────────────────────────────────
async function dismissConf(confId) {
  try {
    await apiPost('dismissConfirmation', { id: confId });
    _confirmations.incoming = _confirmations.incoming.filter(c => c.id !== confId);
    _confirmations.outgoing = _confirmations.outgoing.filter(c => c.id !== confId);
    renderConfirmations();
    showToast(s('logbook.dismissed'), 'success');
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

async function dismissAllConf() {
  try {
    await apiPost('dismissAllConfirmations', { kennitala: user.kennitala });
    _confirmations.incoming = _confirmations.incoming.filter(c => c.status === 'pending');
    _confirmations.outgoing = _confirmations.outgoing.filter(c => c.status === 'pending');
    renderConfirmations();
    showToast(s('logbook.allDismissed'), 'success');
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

// Auto-load on page ready for portals that mount the confirmations UI.
// Gated on the #confBadge element so captain/ — which loads this file for
// its helpers but has its own confirmation UI — doesn't fire an unused call.
(function () {
  if (typeof document === 'undefined') return;
  var start = function () {
    if (document.getElementById('confBadge')) loadConfirmations();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

