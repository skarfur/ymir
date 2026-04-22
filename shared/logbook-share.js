// ═══════════════════════════════════════════════════════════════════════════════
// logbook-share.js — Share tokens + CSV export
// Extracted from shared/logbook.js. All functions stay global via the existing
// non-module script pattern. Callers (captain/index.html, logbook/index.html)
// must include this file alongside shared/logbook.js.
// ═══════════════════════════════════════════════════════════════════════════════

function toggleSharePanel(){
  var p=document.getElementById('sharePanel');
  if(p.style.display==='none'){p.style.display='';renderShareCatChecks();}
  else p.style.display='none';
}
function renderShareCatChecks(){
  var cats=[...new Set(myTrips.map(function(t){return(_boat(t.boatId)?.category)||t.boatCategory||'';}).filter(Boolean))].sort();
  var el=document.getElementById('shareCatChecks');
  if(!cats.length){el.innerHTML='';return;}
  el.innerHTML=cats.map(function(c){
    var key=c.toLowerCase();
    var col=BOAT_CAT_COLORS[key]||BOAT_CAT_COLORS.other;
    return '<label class="flex-center" style="font-size:11px;color:'+col.color+';gap:5px;text-transform:none;letter-spacing:0;margin:0;padding:3px 8px;border-radius:10px;border:1px solid '+col.border+';background:'+col.bg+'">'
      +'<input type="checkbox" class="share-cat-chk" value="'+esc(c)+'" checked style="width:14px;height:14px;accent-color:'+col.color+'">'
      +esc(_boatCatLabel(c))+'</label>';
  }).join('');
}
async function loadShareTokens(){
  try{
    var res=await apiPost('getShareTokens',{kennitala:user.kennitala});
    renderShareTokens(res.tokens||[]);
  }catch(e){}
}
function renderShareTokens(tokens){
  var el=document.getElementById('shareActiveTokens');if(!el)return;
  var active=tokens.filter(function(t){return!t.revokedAt||!String(t.revokedAt).trim();});
  if(!active.length){el.innerHTML='';return;}
  el.innerHTML='<div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">'
    +'<div class="text-sm text-muted" style="font-weight:600;margin-bottom:4px">'+s('logbook.activeTokens')+'</div>'
    +active.map(function(tk){
    return '<div class="flex-center gap-8 text-sm" style="margin-top:6px">'
      +'<span class="text-green">●</span>'
      +'<span class="flex-1 text-muted">'+s('logbook.upTo')+' '+esc(tk.cutOffDate||'')+' · '+(tk.accessCount||0)+' '+s('logbook.views')+'</span>'
      +'<button class="btn-ghost-sm" style="font-size:10px;padding:2px 8px" data-trip-action="copy-share" data-trip-id="'+tk.id+'">'+s('logbook.copy')+'</button>'
      +'<button class="btn-ghost-sm" style="font-size:10px;padding:2px 8px;color:var(--red)" data-trip-action="revoke-share" data-trip-id="'+tk.id+'">'+s('logbook.revoke')+'</button>'
      +'</div>';
  }).join('')+'</div>';
}
async function generateAndCopyShareLink(){
  try{
    var catChecks=document.querySelectorAll('.share-cat-chk:checked');
    var categories=Array.from(catChecks).map(function(c){return c.value;});
    var photos=document.getElementById('sharePhotos').checked;
    var tracks=document.getElementById('shareTracks').checked;
    var res=await apiPost('createShareToken',{kennitala:user.kennitala,includePhotos:photos,includeTracks:tracks,categories:JSON.stringify(categories)});
    if(res.id){
      var url=SCRIPT_URL+'?share='+res.id;
      await navigator.clipboard.writeText(url);
      showToast(s('logbook.shareCopied'));
      loadShareTokens();
    }
  }catch(e){showToast(s('toast.error')+': '+e.message,'err');}
}
function exportLogbookCsv(){
  try{
    var catChecks=document.querySelectorAll('.share-cat-chk:checked');
    var cats=Array.from(catChecks).map(function(c){return c.value;});
    var rows=(myTrips||[]).filter(function(t){
      if(!cats.length) return true;
      var c=(_boat(t.boatId)?.category)||t.boatCategory||'';
      return cats.indexOf(c)!==-1;
    });
    if(!rows.length){ showToast(s('logbook.noTrips'),'err'); return; }
    var cols=['date','timeOut','timeIn','hoursDecimal','boatName','boatCategory','locationName','beaufort','windDir','notes','skipperNote'];
    var headers=cols;
    function csvCell(v){
      if(v==null) return '';
      var str=String(v);
      if(/[",\n\r]/.test(str)) return '"'+str.replace(/"/g,'""')+'"';
      return str;
    }
    var lines=[headers.join(',')];
    rows.forEach(function(t){
      lines.push(cols.map(function(k){return csvCell(t[k]);}).join(','));
    });
    var csv='\ufeff'+lines.join('\r\n');
    var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;
    a.download='logbook-'+(user.kennitala||'export')+'-'+todayISO()+'.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }catch(e){ showToast(s('toast.error')+': '+e.message,'err'); }
}
function copyShareLink(tokenId){
  navigator.clipboard.writeText(SCRIPT_URL+'?share='+tokenId).then(function(){
    showToast(s('logbook.shareCopied'));
  });
}
async function revokeShareToken(tokenId){
  if(!await ymConfirm(s('logbook.revokeLink')))return;
  try{
    await apiPost('revokeShareToken',{tokenId:tokenId,kennitala:user.kennitala});
    showToast(s('logbook.linkRevoked'));
    loadShareTokens();
  }catch(e){showToast(s('toast.error')+': '+e.message,'err');}
}

// ── Init ──────────────────────────────────────────────────────────────────────
