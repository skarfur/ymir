// ═══════════════════════════════════════════════════════════════════════════════
// admin/flags.js — Weather flag scoring + guidance config
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
//
// Everything here saves as one JSON value under app_config.flagConfig (see
// shared/weather.js SCORE_CONFIG / FLAG_GUIDANCE_DEFAULTS for the shape and
// supabase/migrations/20260929100000_flag_guidance.sql for server-side use).
// ═══════════════════════════════════════════════════════════════════════════════

function _fcBandRow(cId,idx,fields,removeFn){
  return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">'+fields.map(function(f){return '<div class="field" style="flex:1;min-width:80px;margin-bottom:0"><label style="font-size:10px">'+esc(f.label)+'</label><input type="number" id="'+cId+'_'+f.key+'_'+idx+'" value="'+f.val+'" step="'+(f.step||1)+'" min="'+(f.min!=null?f.min:-99)+'" style="width:100%" data-admin-input="updateFlagPreview"></div>';}).join('')+'<button data-admin-click="'+removeFn+'" data-admin-arg="'+idx+'" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:0 4px;margin-top:14px">×</button></div>';
}
function _fcReadBands(cId,keys){var rows=[],idx=0;while(document.getElementById(cId+'_'+keys[0]+'_'+idx)!==null){var row={};keys.forEach(function(k){var el=document.getElementById(cId+'_'+k+'_'+idx);row[k]=el?parseFloat(el.value):0;});rows.push(row);idx++;}return rows;}
var _fcWindBands=[],_fcWaveBands=[],_fcSstBands=[],_fcFeelsBands=[];
var _fcCurrentWx=null;
async function _fcLoadCurrentWx(){
  if(typeof wxFetch!=='function'||typeof WX_DEFAULT==='undefined')return;
  try{
    var res=await wxFetch(WX_DEFAULT.lat,WX_DEFAULT.lon);
    var c=res&&res.wx&&res.wx.current?res.wx.current:null;
    var mc=res&&res.marine&&res.marine.current?res.marine.current:null;
    if(!c)return;
    _fcCurrentWx={
      ws:c.wind_speed_10m||0,
      wDir:c.wind_direction_10m!=null?wxDirLabel(c.wind_direction_10m):'',
      waveH:mc&&mc.wave_height!=null?mc.wave_height:0,
      airT:c.apparent_temperature!=null?c.apparent_temperature:c.temperature_2m,
      sst:mc?mc.sea_surface_temperature:null,
      wg:c.wind_gusts_10m!=null?c.wind_gusts_10m:(c.wind_speed_10m||0),
      visKey:wxVisKey(c.visibility),
      source:c._source||null,
      obsTime:c._obs_time||null,
    };
    updateFlagPreview();
  }catch(e){}
}
function fcRenderWindBands(){var el=document.getElementById('fcWindBands');if(!el)return;el.innerHTML=_fcWindBands.map(function(b,i){return _fcBandRow('fcWind',i,[{key:'maxBft',label:'Max Force',val:b.maxBft,min:0},{key:'pts',label:'Points',val:b.pts,min:0}],'fcRemoveWindBand');}).join('');}
function fcRenderWaveBands(){var el=document.getElementById('fcWaveBands');if(!el)return;el.innerHTML=_fcWaveBands.map(function(b,i){return _fcBandRow('fcWave',i,[{key:'maxM',label:'Max m',val:b.maxM,min:0,step:0.1},{key:'pts',label:'Points',val:b.pts,min:0}],'fcRemoveWaveBand');}).join('');}
function fcRenderSstBands(){var el=document.getElementById('fcSstBands');if(!el)return;el.innerHTML=_fcSstBands.map(function(b,i){return _fcBandRow('fcSst',i,[{key:'minC',label:'Min °C',val:b.minC},{key:'pts',label:'Points',val:b.pts,min:0}],'fcRemoveSstBand');}).join('');}
function fcRenderFeelsBands(){var el=document.getElementById('fcFeelsBands');if(!el)return;el.innerHTML=_fcFeelsBands.map(function(b,i){return _fcBandRow('fcFeels',i,[{key:'minC',label:'Min °C',val:b.minC},{key:'pts',label:'Points',val:b.pts,min:0}],'fcRemoveFeelsBand');}).join('');}
function fcAddWindBand(){_fcWindBands=fcReadWindBands();_fcWindBands.push({maxBft:12,pts:0});fcRenderWindBands();updateFlagPreview();}
function fcRemoveWindBand(i){_fcWindBands=fcReadWindBands();_fcWindBands.splice(i,1);fcRenderWindBands();updateFlagPreview();}
function fcReadWindBands(){return _fcReadBands('fcWind',['maxBft','pts']).map(function(r){return{maxBft:r.maxBft,pts:r.pts};});}
function fcAddWaveBand(){_fcWaveBands=fcReadWaveBands();_fcWaveBands.push({maxM:99,pts:0});fcRenderWaveBands();updateFlagPreview();}
function fcRemoveWaveBand(i){_fcWaveBands=fcReadWaveBands();_fcWaveBands.splice(i,1);fcRenderWaveBands();updateFlagPreview();}
function fcReadWaveBands(){return _fcReadBands('fcWave',['maxM','pts']).map(function(r){return{maxM:r.maxM,pts:r.pts};});}
function fcAddSstBand(){_fcSstBands=fcReadSstBands();_fcSstBands.push({minC:-99,pts:0});fcRenderSstBands();updateFlagPreview();}
function fcRemoveSstBand(i){_fcSstBands=fcReadSstBands();_fcSstBands.splice(i,1);fcRenderSstBands();updateFlagPreview();}
function fcReadSstBands(){return _fcReadBands('fcSst',['minC','pts']).map(function(r){return{minC:r.minC,pts:r.pts};});}
function fcAddFeelsBand(){_fcFeelsBands=fcReadFeelsBands();_fcFeelsBands.push({minC:-99,pts:0});fcRenderFeelsBands();updateFlagPreview();}
function fcRemoveFeelsBand(i){_fcFeelsBands=fcReadFeelsBands();_fcFeelsBands.splice(i,1);fcRenderFeelsBands();updateFlagPreview();}
function fcReadFeelsBands(){return _fcReadBands('fcFeels',['minC','pts']).map(function(r){return{minC:r.minC,pts:r.pts};});}

function _fcNum(id,fallback){var v=parseFloat(document.getElementById(id).value);return isNaN(v)?fallback:v;}

function loadFlagConfigPanel(c){
  c=c||{};var D=SCORE_CONFIG_DEFAULTS;var t=Object.assign({},D.thresholds,c.thresholds||{});
  document.getElementById('fcThreshY').value=t.yellow;
  document.getElementById('fcThreshR').value=t.red;
  document.getElementById('fcThreshB').value=t.black;
  document.getElementById('fcHysteresis').value=c.hysteresis!=null?c.hysteresis:D.hysteresis;
  _fcWindBands=((c.wind&&c.wind.length)?c.wind:D.wind).map(function(b){return{maxBft:b.maxBft,pts:b.pts};});
  _fcWaveBands=((c.waves&&c.waves.length)?c.waves:D.waves).map(function(b){return{maxM:b.maxM,pts:b.pts};});
  _fcSstBands=((c.sst&&c.sst.length)?c.sst:D.sst).map(function(b){return{minC:b.minC,pts:b.pts};});
  _fcFeelsBands=(Array.isArray(c.feelsLike)?c.feelsLike:D.feelsLike).map(function(b){return{minC:b.minC,pts:b.pts};});
  fcRenderWindBands();fcRenderWaveBands();fcRenderSstBands();fcRenderFeelsBands();
  _fcLoadCurrentWx();
  var wdm=Object.assign({},D.windDirModifier,c.windDirModifier||{});
  document.getElementById('fcWindDirPts').value=wdm.pts;
  document.getElementById('fcWindDirMinBft').value=wdm.minBft!=null?wdm.minBft:3;
  document.getElementById('fcGust1Pts').value=c.gustModifier1Pts!=null?c.gustModifier1Pts:D.gustModifier1Pts;
  document.getElementById('fcGust2Pts').value=c.gustModifier2Pts!=null?c.gustModifier2Pts:D.gustModifier2Pts;
  document.getElementById('fcWindDirDirs').value=(wdm.dirs||[]).join(',');
  var vis=Object.assign({},D.visibility,c.visibility||{});
  document.getElementById('fcVisGood').value=vis.good;
  document.getElementById('fcVisReduced').value=vis.reduced;
  document.getElementById('fcVisPoor').value=vis.poor;
  var advEl=document.getElementById('fcFlagAdvice');
  if(advEl){advEl.innerHTML=FLAG_KEYS.map(function(key){var fc=Object.assign({},D.flags[key]),saved=(c.flags&&c.flags[key])||{};return '<div style="background:'+fc.bg+';border:1px solid '+fc.border+';border-radius:8px;padding:10px 12px;margin-bottom:4px">'+'<div style="font-size:12px;color:'+fc.color+';font-weight:500;margin-bottom:8px">'+fc.icon+' '+key+'</div>'+'<div class="field" style="margin-bottom:6px"><label style="font-size:10px">Short advice (EN)</label><input type="text" id="fcAdvice_'+key+'" value="'+esc(saved.advice||fc.advice||'')+'" style="font-size:11px"></div>'+'<div class="field" style="margin-bottom:6px"><label style="font-size:10px">Stutt ráðlegging (IS)</label><input type="text" id="fcAdviceIS_'+key+'" value="'+esc(saved.adviceIS||fc.adviceIS||'')+'" style="font-size:11px"></div>'+'<div class="field" style="margin-bottom:6px"><label style="font-size:10px">Full description (EN)</label><textarea id="fcDesc_'+key+'" rows="2" style="font-size:11px;width:100%;box-sizing:border-box;resize:vertical;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 7px;font-family:inherit">'+esc(saved.description||fc.description||'')+'</textarea></div>'+'<div class="field" style="margin-bottom:0"><label style="font-size:10px">Full lýsingartexti (IS)</label><textarea id="fcDescIS_'+key+'" rows="2" style="font-size:11px;width:100%;box-sizing:border-box;resize:vertical;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 7px;font-family:inherit">'+esc(saved.descriptionIS||fc.descriptionIS||'')+'</textarea></div>'+'</div>';}).join('');}
  // Guidance: profiles reset to defaults when nothing is saved; boat and
  // activity mappings reference real ids, so a reset keeps whatever the
  // editor currently holds for them.
  var g=c.guidance||{};
  var keepBoat=_fcGuidance?_fcGuidance.boatProfiles:{},keepAct=_fcGuidance?_fcGuidance.activities:{};
  _fcGuidance={
    profiles:JSON.parse(JSON.stringify(g.profiles||FLAG_GUIDANCE_DEFAULTS.profiles)),
    boatProfiles:JSON.parse(JSON.stringify(g.boatProfiles||keepBoat||{})),
    activities:JSON.parse(JSON.stringify(g.activities||keepAct||{})),
  };
  fcRenderGuidance();
  updateFlagPreview();
}

// ── Guidance editors ────────────────────────────────────────────────────────
// Rendered from _fcGuidance; read back from the DOM (data-gd-* attributes) on
// every structural change and on save, same approach as the score bands.
var _fcGuidance=null;
var _FC_BOAT_ST=['ok','cond','approval','no'];
var _FC_ACT_ST=['go','adjust','cancel'];

function _fcStatusSelect(attrs,options,val,allowNone){
  return '<select class="fc-gd-status" '+attrs+' data-admin-change-el="fcGuidanceStatusChanged">'
    +(allowNone?'<option value=""'+(val?'':' selected')+'>—</option>':'')
    +options.map(function(o){return '<option value="'+o+'"'+(o===val?' selected':'')+'>'+esc(s('wx.gd.'+o))+'</option>';}).join('')
    +'</select>';
}
function _fcCell(kind,key,flag,e,options,allowNone){
  e=e||{};
  var a='data-gd-kind="'+kind+'" data-gd-key="'+esc(key)+'" data-gd-flag="'+flag+'"';
  var col=e.s?wxGuidanceColor(e.s):'var(--border)';
  return '<div class="fc-gd-cell" style="border-top:3px solid '+col+'">'
    +_fcStatusSelect(a+' data-gd-field="s"',options,e.s||'',allowNone)
    +'<input type="text" '+a+' data-gd-field="en" value="'+esc(e.en||'')+'" placeholder="EN">'
    +'<input type="text" '+a+' data-gd-field="is" value="'+esc(e.is||'')+'" placeholder="IS">'
    +'</div>';
}
function _fcFlagHeads(){
  return '<div class="fc-gd-row fc-gd-head"><div class="fc-gd-name"></div>'
    +FLAG_KEYS.map(function(k){return '<div class="fc-gd-cell-head">'+SCORE_CONFIG.flags[k].icon+'</div>';}).join('')+'</div>';
}
function _fcProfLabel(k){
  var p=_fcGuidance&&_fcGuidance.profiles[k];
  if(p&&(p.labelEN||p.labelIS))return (getLang()==='IS'&&p.labelIS)?p.labelIS:(p.labelEN||p.labelIS);
  return wxProfileLabel(k);
}
function fcRenderGuidance(){
  if(!_fcGuidance)return;
  var catKeys=(typeof _allBoatCats!=='undefined'?_allBoatCats:[]).map(function(c){return c.key;});
  // Profiles
  var pEl=document.getElementById('fcGuidanceProfiles');
  if(pEl){
    var keys=Object.keys(_fcGuidance.profiles);
    pEl.innerHTML=_fcFlagHeads()+keys.map(function(k){
      var p=_fcGuidance.profiles[k],isCat=catKeys.indexOf(k)!==-1;
      return '<div class="fc-gd-row" data-gd-profile="'+esc(k)+'">'
        +'<div class="fc-gd-name"><b>'+esc(_fcProfLabel(k))+'</b><div class="text-10 text-muted">'+esc(k)+(isCat?'':' · '+esc(s('admin.gdCustomProfile')))+'</div>'
        +(isCat?'':'<button class="fc-gd-remove" data-admin-click="fcRemoveProfile" data-admin-arg="'+esc(k)+'">'+esc(s('btn.delete'))+'</button>')+'</div>'
        +FLAG_KEYS.map(function(f){return _fcCell('profile',k,f,p[f],_FC_BOAT_ST,false);}).join('')
        +'</div>';
    }).join('');
    var missing=catKeys.filter(function(k){return !_fcGuidance.profiles[k];});
    var addSel=document.getElementById('fcGdAddCat');
    if(addSel)addSel.innerHTML='<option value="">—</option>'+missing.map(function(k){return '<option value="'+esc(k)+'">'+esc(_fcProfLabel(k))+'</option>';}).join('');
  }
  // Boat overrides
  var bEl=document.getElementById('fcGuidanceBoats');
  if(bEl){
    var profKeys=Object.keys(_fcGuidance.profiles);
    var list=(typeof _allBoats!=='undefined'?_allBoats:[]).filter(function(b){return b.active!==false&&b.active!=='false';})
      .slice().sort(function(a,b){return (a.category||'').localeCompare(b.category||'')||(a.name||'').localeCompare(b.name||'');});
    bEl.innerHTML=list.map(function(b){
      var cur=_fcGuidance.boatProfiles[b.id]||'';
      return '<div class="fc-gd-boat"><span class="flex-1">'+esc(b.name)+' <span class="text-10 text-muted">'+esc(b.category||'')+'</span></span>'
        +'<select data-gd-boat="'+esc(b.id)+'"><option value="">'+esc(s('admin.gdUseCategory'))+'</option>'
        +profKeys.map(function(k){return '<option value="'+esc(k)+'"'+(k===cur?' selected':'')+'>'+esc(_fcProfLabel(k))+'</option>';}).join('')
        +'</select></div>';
    }).join('')||'<div class="text-xs text-muted">'+esc(s('lbl.noData'))+'</div>';
  }
  // Activities
  var aEl=document.getElementById('fcGuidanceActs');
  if(aEl){
    var acts=(typeof activityTemplates!=='undefined'?activityTemplates:[]).filter(function(a){return a.active!==false&&a.active!=='false';});
    aEl.innerHTML=_fcFlagHeads()+acts.map(function(a){
      var gd=_fcGuidance.activities[a.id]||{};
      return '<div class="fc-gd-row"><div class="fc-gd-name"><b>'+esc(a.name||'')+'</b>'+(a.classTag?'<div class="text-10 text-muted">'+esc(a.classTag)+'</div>':'')+'</div>'
        +FLAG_KEYS.map(function(f){return _fcCell('activity',a.id,f,gd[f],_FC_ACT_ST,true);}).join('')
        +'</div>';
    }).join('');
  }
}
function fcGuidanceStatusChanged(el){
  var cell=el.closest('.fc-gd-cell');
  if(cell)cell.style.borderTopColor=el.value?wxGuidanceColor(el.value):'var(--border)';
}
function fcReadGuidance(){
  if(!_fcGuidance)return null;
  var out={profiles:{},boatProfiles:{},activities:{}};
  // Keep profile order and labels (labels aren't edited per-cell).
  Object.keys(_fcGuidance.profiles).forEach(function(k){
    var p=_fcGuidance.profiles[k],np={};
    if(p.labelEN)np.labelEN=p.labelEN;
    if(p.labelIS)np.labelIS=p.labelIS;
    out.profiles[k]=np;
  });
  document.querySelectorAll('#tab-flags [data-gd-kind][data-gd-field]').forEach(function(el){
    var kind=el.dataset.gdKind,key=el.dataset.gdKey,flag=el.dataset.gdFlag,field=el.dataset.gdField;
    var bucket=kind==='profile'?out.profiles:out.activities;
    if(kind==='profile'&&!bucket[key])return;
    bucket[key]=bucket[key]||{};
    bucket[key][flag]=bucket[key][flag]||{};
    var v=(el.value||'').trim();
    if(v)bucket[key][flag][field]=v;
  });
  // Drop empty activity cells (no status = no guidance for that flag).
  Object.keys(out.activities).forEach(function(id){
    var a=out.activities[id];
    Object.keys(a).forEach(function(f){if(!a[f].s)delete a[f];});
    if(!Object.keys(a).length)delete out.activities[id];
  });
  // Keep activity guidance for inactive templates that isn't on screen.
  Object.keys(_fcGuidance.activities).forEach(function(id){
    if(!out.activities[id]&&!document.querySelector('#fcGuidanceActs [data-gd-key="'+CSS.escape(id)+'"]'))out.activities[id]=_fcGuidance.activities[id];
  });
  document.querySelectorAll('#fcGuidanceBoats [data-gd-boat]').forEach(function(el){
    if(el.value)out.boatProfiles[el.dataset.gdBoat]=el.value;
  });
  // Keep overrides for boats not listed (inactive) so a save doesn't drop them.
  Object.keys(_fcGuidance.boatProfiles).forEach(function(id){
    if(!document.querySelector('#fcGuidanceBoats [data-gd-boat="'+CSS.escape(id)+'"]')&&out.profiles[_fcGuidance.boatProfiles[id]])out.boatProfiles[id]=_fcGuidance.boatProfiles[id];
  });
  return out;
}
function _fcBlankProfile(){var p={};FLAG_KEYS.forEach(function(f){p[f]={s:'ok'};});return p;}
function fcAddCategoryProfile(){
  var sel=document.getElementById('fcGdAddCat');var k=sel&&sel.value;if(!k)return;
  _fcGuidance=fcReadGuidance();_fcGuidance.profiles[k]=_fcBlankProfile();fcRenderGuidance();
}
function fcAddCustomProfile(){
  var kEl=document.getElementById('fcGdNewKey'),enEl=document.getElementById('fcGdNewLabel'),isEl=document.getElementById('fcGdNewLabelIS');
  var key=(kEl.value||'').trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');
  if(!key){toast(s('admin.nameRequired'),'err');return;}
  _fcGuidance=fcReadGuidance();
  if(_fcGuidance.profiles[key]){toast(s('admin.gdProfileExists'),'err');return;}
  var p=_fcBlankProfile();p.labelEN=(enEl.value||'').trim()||key;p.labelIS=(isEl.value||'').trim();
  _fcGuidance.profiles[key]=p;kEl.value='';enEl.value='';isEl.value='';
  fcRenderGuidance();
}
async function fcRemoveProfile(key){
  if(!await ymConfirm(s('admin.gdConfirmRemoveProfile')))return;
  _fcGuidance=fcReadGuidance();delete _fcGuidance.profiles[key];
  Object.keys(_fcGuidance.boatProfiles).forEach(function(id){if(_fcGuidance.boatProfiles[id]===key)delete _fcGuidance.boatProfiles[id];});
  fcRenderGuidance();
}

function getFlagFormValues(){
  var D=SCORE_CONFIG_DEFAULTS;
  var t={yellow:_fcNum('fcThreshY',D.thresholds.yellow),red:_fcNum('fcThreshR',D.thresholds.red),black:_fcNum('fcThreshB',D.thresholds.black)};
  var windDirDirs=Array.from(new Set((document.getElementById('fcWindDirDirs').value||'').split(',').map(function(s){return s.trim().toUpperCase();}).filter(Boolean)));
  var windDirModifier={dirs:windDirDirs,pts:_fcNum('fcWindDirPts',0),minBft:_fcNum('fcWindDirMinBft',3)};
  var cfg={thresholds:t,hysteresis:_fcNum('fcHysteresis',D.hysteresis),
      wind:fcReadWindBands(),waves:fcReadWaveBands(),sst:fcReadSstBands(),feelsLike:fcReadFeelsBands(),windDirModifier:windDirModifier,
      gustModifier1Pts:_fcNum('fcGust1Pts',0),gustModifier2Pts:_fcNum('fcGust2Pts',0),
      visibility:{good:_fcNum('fcVisGood',0),reduced:_fcNum('fcVisReduced',0),poor:_fcNum('fcVisPoor',0)},flags:{}};
  wxSortBands(cfg);
  FLAG_KEYS.forEach(function(key){var en=document.getElementById('fcAdvice_'+key),is=document.getElementById('fcAdviceIS_'+key);var de=document.getElementById('fcDesc_'+key),dis=document.getElementById('fcDescIS_'+key);cfg.flags[key]={advice:en?en.value.trim():'',adviceIS:is?is.value.trim():'',description:de?de.value.trim():'',descriptionIS:dis?dis.value.trim():''};});
  var g=fcReadGuidance();if(g)cfg.guidance=g;
  return cfg;
}
function validateFlagConfig(cfg){
  var errs=[],t=cfg.thresholds;
  if(t.yellow>=t.red)errs.push(s('admin.fcErrYellowRed'));
  if(t.red>=t.black)errs.push(s('admin.fcErrRedBlack'));
  if(!cfg.wind.length)errs.push(s('admin.fcErrWind'));
  else if(cfg.wind[cfg.wind.length-1].maxBft<12)errs.push(s('admin.fcErrWindTop'));
  return errs;
}
function updateFlagPreview(){
  var preview=document.getElementById('fcFlagPreview');if(!preview)return;
  if(typeof wxScoreFlag!=='function'||typeof wxLoadFlagConfig!=='function'){
    preview.innerHTML='<div style="font-size:11px;color:var(--muted)">Preview requires weather.js — check script imports.</div>';return;
  }
  if(!_fcCurrentWx){
    preview.innerHTML='<div style="font-size:11px;color:var(--muted)">Loading current conditions…</div>';return;
  }
  var wx=_fcCurrentWx;
  // Deep-clone SCORE_CONFIG, apply form values, score, then restore
  var snap=JSON.parse(JSON.stringify(SCORE_CONFIG));
  try{
    var cfg=getFlagFormValues();
    Object.assign(SCORE_CONFIG.thresholds,cfg.thresholds);
    SCORE_CONFIG.wind=cfg.wind;SCORE_CONFIG.waves=cfg.waves;
    SCORE_CONFIG.sst=cfg.sst;SCORE_CONFIG.feelsLike=cfg.feelsLike;
    Object.assign(SCORE_CONFIG.visibility,cfg.visibility);
    SCORE_CONFIG.windDirModifier=cfg.windDirModifier;
    SCORE_CONFIG.gustModifier1Pts=cfg.gustModifier1Pts;
    SCORE_CONFIG.gustModifier2Pts=cfg.gustModifier2Pts;
  }catch(e){}
  var r=wxScoreFlag(wx.ws,wx.wDir,wx.waveH,wx.airT,wx.sst,wx.wg,wx.visKey);
  var fl=SCORE_CONFIG.flags[r.flagKey];
  var sub='Wind '+(Math.round(wx.ws*10)/10)+' m/s '+(wx.wDir||'')
    +' · gust '+Math.round(wx.wg)
    +' · waves '+(wx.waveH!=null?wx.waveH.toFixed(1)+'m':'–')
    +' · feels '+(wx.airT!=null?Math.round(wx.airT)+'°C':'–')
    +' · sst '+(wx.sst!=null?wx.sst.toFixed(1)+'°C':'–')
    +' · vis '+wx.visKey;
  var srcLabel=(wx.source||'')+(wx.obsTime?' · '+String(wx.obsTime).slice(11,16)+' UTC':'');
  preview.innerHTML='<div style="flex:1;min-width:200px;background:'+fl.bg+';border:1px solid '+fl.border+';border-radius:8px;padding:10px 12px;color:'+fl.color+'">'
    +'<div style="font-size:13px;font-weight:500">'+fl.icon+' · <b>'+r.score+'</b> pts · current conditions</div>'
    +'<div style="font-size:10px;opacity:.85;margin-top:4px">'+esc(sub)+'</div>'
    +(srcLabel?'<div style="font-size:9px;opacity:.6;margin-top:2px;letter-spacing:.5px">'+esc(srcLabel)+'</div>':'')
    +'</div>';
  Object.assign(SCORE_CONFIG.thresholds,snap.thresholds);
  SCORE_CONFIG.wind=snap.wind;SCORE_CONFIG.waves=snap.waves;
  SCORE_CONFIG.sst=snap.sst;SCORE_CONFIG.feelsLike=snap.feelsLike;
  Object.assign(SCORE_CONFIG.visibility,snap.visibility);
  SCORE_CONFIG.windDirModifier=snap.windDirModifier;
  SCORE_CONFIG.gustModifier1Pts=snap.gustModifier1Pts;
  SCORE_CONFIG.gustModifier2Pts=snap.gustModifier2Pts;
}
async function saveFlagConfig(){
  var errEl=document.getElementById('fcValidationError'),msgEl=document.getElementById('fcSaveMsg');errEl.classList.add('d-none');msgEl.textContent='';
  var cfg=getFlagFormValues(),errs=validateFlagConfig(cfg);if(errs.length){errEl.textContent=errs.join(' ');errEl.classList.remove('d-none');return;}
  try{await callSupabaseRpc('save_config_value',{p_key:'flagConfig',p_value:cfg});_invalidateApiCache('getConfig');if(typeof wxLoadFlagConfig==='function')wxLoadFlagConfig(cfg);_fcGuidance=cfg.guidance;updateFlagPreview();msgEl.style.color='var(--green)';msgEl.textContent='✓ '+s('toast.saved');setTimeout(function(){msgEl.textContent='';},3000);}catch(e){msgEl.style.color='var(--red)';msgEl.textContent=s('toast.saveFailed')+': '+e.message;}
}
async function resetFlagConfig(){if(!await ymConfirm(s('admin.confirmResetFlags')))return;_fcGuidance=fcReadGuidance();loadFlagConfigPanel(null);}

function loadSharedPhotoEmail(addr){
  var el=document.getElementById('sharedPhotoEmailTo');
  if(el) el.value=addr||'';
}
async function saveSharedPhotoEmail(){
  var msgEl=document.getElementById('sharedPhotoEmailMsg');
  var addr=(document.getElementById('sharedPhotoEmailTo').value||'').trim();
  msgEl.textContent='';
  try{
    await callSupabaseRpc('save_config_value',{p_key:'sharedPhotoEmailTo',p_value:addr});
    _invalidateApiCache('getConfig');
    msgEl.style.color='var(--green)';msgEl.textContent='✓ '+s('toast.saved');
    setTimeout(function(){msgEl.textContent='';},3000);
  }catch(e){msgEl.style.color='var(--red)';msgEl.textContent=s('toast.saveFailed')+': '+e.message;}
}

// ══ CSV IMPORT ════════════════════════════════════════════════════════════════

