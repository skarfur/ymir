// ═══════════════════════════════════════════════════════════════════════════════
// admin/flags.js — Weather flag scoring config
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

function _fcBandRow(cId,idx,fields,removeFn){
  return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">'+fields.map(function(f){return '<div class="field" style="flex:1;min-width:80px;margin-bottom:0"><label style="font-size:10px">'+esc(f.label)+'</label><input type="number" id="'+cId+'_'+f.key+'_'+idx+'" value="'+f.val+'" step="'+(f.step||1)+'" min="'+(f.min!=null?f.min:-99)+'" style="width:100%" data-admin-input="updateFlagPreview"></div>';}).join('')+'<button data-admin-click="'+removeFn+'" data-admin-arg="'+idx+'" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:0 4px;margin-top:14px">×</button></div>';
}
function _fcReadBands(cId,keys){var rows=[],idx=0;while(document.getElementById(cId+'_'+keys[0]+'_'+idx)!==null){var row={};keys.forEach(function(k){var el=document.getElementById(cId+'_'+k+'_'+idx);row[k]=el?parseFloat(el.value):0;});rows.push(row);idx++;}return rows;}
var _fcWindBands=[],_fcWaveBands=[],_fcSstBands=[],_fcFeelsBands=[];
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
function loadFlagConfigPanel(c){
  c=c||{};var sc=SCORE_CONFIG;var t=c.thresholds||sc.thresholds;
  document.getElementById('fcThreshY').value=t.yellow!=null?t.yellow:25;
  document.getElementById('fcThreshO').value=t.orange!=null?t.orange:45;
  document.getElementById('fcThreshR').value=t.red!=null?t.red:65;
  document.getElementById('fcThreshB').value=t.black!=null?t.black:80;
  _fcWindBands=(c.wind||sc.wind).map(function(b){return{maxBft:b.maxBft,pts:b.pts};});
  _fcWaveBands=(c.waves||sc.waves).map(function(b){return{maxM:b.maxM,pts:b.pts};});
  _fcSstBands=(c.sst||sc.sst).map(function(b){return{minC:b.minC,pts:b.pts};});
  _fcFeelsBands=(c.feelsLike||sc.feelsLike).map(function(b){return{minC:b.minC,pts:b.pts};});
  fcRenderWindBands();fcRenderWaveBands();fcRenderSstBands();fcRenderFeelsBands();
  var wdm=c.windDirModifier||sc.windDirModifier||{dirs:[],pts:0};
  document.getElementById('fcWindDirPts').value=wdm.pts!=null?wdm.pts:0;
  document.getElementById('fcGust1Pts').value=(c.gustModifier1Pts??sc.gustModifier1Pts)??0;
  document.getElementById('fcGust2Pts').value=(c.gustModifier2Pts??sc.gustModifier2Pts)??0;
  document.getElementById('fcWindDirDirs').value=(wdm.dirs||[]).join(',');
  var vis=c.visibility||sc.visibility;
  document.getElementById('fcVisGood').value=vis.good!=null?vis.good:0;
  document.getElementById('fcVisReduced').value=vis.reduced!=null?vis.reduced:0;
  document.getElementById('fcVisPoor').value=vis.poor!=null?vis.poor:0;
  var advEl=document.getElementById('fcFlagAdvice');
  if(advEl){advEl.innerHTML=['green','yellow','orange','red','black'].map(function(key){var fc=SCORE_CONFIG.flags[key],saved=(c.flags&&c.flags[key])||{};return '<div style="background:'+fc.bg+';border:1px solid '+fc.border+';border-radius:8px;padding:10px 12px;margin-bottom:4px">'+'<div style="font-size:12px;color:'+fc.color+';font-weight:500;margin-bottom:8px">'+fc.icon+' '+key+'</div>'+'<div class="field" style="margin-bottom:6px"><label style="font-size:10px">Short advice (EN)</label><input type="text" id="fcAdvice_'+key+'" value="'+esc(saved.advice||fc.advice||'')+'" style="font-size:11px"></div>'+'<div class="field" style="margin-bottom:6px"><label style="font-size:10px">Stutt ráðlegging (IS)</label><input type="text" id="fcAdviceIS_'+key+'" value="'+esc(saved.adviceIS||fc.adviceIS||'')+'" style="font-size:11px"></div>'+'<div class="field" style="margin-bottom:6px"><label style="font-size:10px">Full description (EN)</label><textarea id="fcDesc_'+key+'" rows="2" style="font-size:11px;width:100%;box-sizing:border-box;resize:vertical;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 7px;font-family:inherit">'+esc(saved.description||fc.description||'')+'</textarea></div>'+'<div class="field" style="margin-bottom:0"><label style="font-size:10px">Full lýsingartexti (IS)</label><textarea id="fcDescIS_'+key+'" rows="2" style="font-size:11px;width:100%;box-sizing:border-box;resize:vertical;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 7px;font-family:inherit">'+esc(saved.descriptionIS||fc.descriptionIS||'')+'</textarea></div>'+'</div>';}).join('');}
  updateFlagPreview();
}
function getFlagFormValues(){
  var t={yellow:parseInt(document.getElementById('fcThreshY').value)||25,orange:parseInt(document.getElementById('fcThreshO').value)||45,red:parseInt(document.getElementById('fcThreshR').value)||65,black:parseInt(document.getElementById('fcThreshB').value)||80};
  var windDirDirs=(document.getElementById('fcWindDirDirs').value||'').split(',').map(function(s){return s.trim().toUpperCase();}).filter(Boolean);
  var windDirModifier={dirs:windDirDirs,pts:parseInt(document.getElementById('fcWindDirPts').value)||0};
  var cfg={thresholds:t,wind:fcReadWindBands(),waves:fcReadWaveBands(),sst:fcReadSstBands(),feelsLike:fcReadFeelsBands(),windDirModifier:windDirModifier,gustModifier1Pts:parseInt(document.getElementById('fcGust1Pts').value)||0,
      gustModifier2Pts:parseInt(document.getElementById('fcGust2Pts').value)||0,visibility:{good:parseInt(document.getElementById('fcVisGood').value)||0,reduced:parseInt(document.getElementById('fcVisReduced').value)||0,poor:parseInt(document.getElementById('fcVisPoor').value)||0},flags:{}};
  ['green','yellow','orange','red','black'].forEach(function(key){var en=document.getElementById('fcAdvice_'+key),is=document.getElementById('fcAdviceIS_'+key);var de=document.getElementById('fcDesc_'+key),dis=document.getElementById('fcDescIS_'+key);cfg.flags[key]={advice:en?en.value.trim():'',adviceIS:is?is.value.trim():'',description:de?de.value.trim():'',descriptionIS:dis?dis.value.trim():''};});
  return cfg;
}
function validateFlagConfig(cfg){var errs=[],t=cfg.thresholds;if(t.yellow>=t.orange)errs.push('Yellow must be < orange.');if(t.orange>=t.red)errs.push('Orange must be < red.');if(t.red>=t.black)errs.push('Red must be < closed.');if(!cfg.wind.length)errs.push('At least one wind band required.');return errs;}
function updateFlagPreview(){
  var preview=document.getElementById('fcFlagPreview');if(!preview)return;
  if(typeof wxScoreFlag!=='function'||typeof wxLoadFlagConfig!=='function'){
    preview.innerHTML='<div style="font-size:11px;color:var(--muted)">Preview requires weather.js — check script imports.</div>';return;
  }
  var examples=[{label:'Force 2, calm',ws:1.6,wDir:'SW',waveH:0,airT:12,sst:10,wg:2},{label:'Force 4, 0.6m, 8°C',ws:5.5,wDir:'SW',waveH:0.6,airT:8,sst:7,wg:7},{label:'Force 5 NE, 1m, 4°C',ws:8.0,wDir:'NE',waveH:1.0,airT:4,sst:5,wg:11},{label:'Force 7 E, 1.8m, -2°C',ws:13.9,wDir:'E',waveH:1.8,airT:-2,sst:3,wg:17},{label:'Force 8, 2.2m, -5°C',ws:17.2,wDir:'NW',waveH:2.2,airT:-5,sst:2,wg:21}];
  // Deep-clone SCORE_CONFIG, apply form values, render, then restore
  var snap=JSON.parse(JSON.stringify(SCORE_CONFIG));
  try{
    var cfg=getFlagFormValues();
    // Apply temporarily without persisting
    Object.assign(SCORE_CONFIG.thresholds,cfg.thresholds);
    SCORE_CONFIG.wind=cfg.wind;SCORE_CONFIG.waves=cfg.waves;
    SCORE_CONFIG.sst=cfg.sst;SCORE_CONFIG.feelsLike=cfg.feelsLike;
    Object.assign(SCORE_CONFIG.visibility,cfg.visibility);
    SCORE_CONFIG.windDirModifier=cfg.windDirModifier;
    SCORE_CONFIG.gustModifier1Pts=cfg.gustModifier1Pts;
    SCORE_CONFIG.gustModifier2Pts=cfg.gustModifier2Pts;
  }catch(e){}
  preview.innerHTML=examples.map(function(ex){
    var r=wxScoreFlag(ex.ws,ex.wDir,ex.waveH,ex.airT,ex.sst,ex.wg,'good');
    var fk=r.flagKey,fl=SCORE_CONFIG.flags[fk];
    return '<div style="flex:1;min-width:150px;background:'+fl.bg+';border:1px solid '+fl.border+';border-radius:8px;padding:8px 10px;color:'+fl.color+'">'
      +'<div style="font-size:12px;font-weight:500">'+fl.icon+' · <b>'+r.score+'</b> pts</div>'
      +'<div style="font-size:10px;opacity:.8;margin-top:3px">'+esc(ex.label)+'</div></div>';
  }).join('');
  // Restore
  Object.assign(SCORE_CONFIG.thresholds,snap.thresholds);
  SCORE_CONFIG.wind=snap.wind;SCORE_CONFIG.waves=snap.waves;
  SCORE_CONFIG.sst=snap.sst;SCORE_CONFIG.feelsLike=snap.feelsLike;
  Object.assign(SCORE_CONFIG.visibility,snap.visibility);
  SCORE_CONFIG.windDirModifier=snap.windDirModifier;
  SCORE_CONFIG.gustModifier1Pts=snap.gustModifier1Pts;
  SCORE_CONFIG.gustModifier2Pts=snap.gustModifier2Pts;
}
async function saveFlagConfig(){
  var errEl=document.getElementById('fcValidationError'),msgEl=document.getElementById('fcSaveMsg');errEl.style.display='none';msgEl.textContent='';
  var cfg=getFlagFormValues(),errs=validateFlagConfig(cfg);if(errs.length){errEl.textContent=errs.join(' ');errEl.style.display='block';return;}
  try{await apiPost('saveConfig',{flagConfig:cfg});if(typeof wxLoadFlagConfig==='function')wxLoadFlagConfig(cfg);updateFlagPreview();msgEl.style.color='var(--green)';msgEl.textContent='✓ '+s('toast.saved');setTimeout(function(){msgEl.textContent='';},3000);}catch(e){msgEl.style.color='var(--red)';msgEl.textContent=s('toast.saveFailed')+': '+e.message;}
}
async function resetFlagConfig(){if(!await ymConfirm(s('admin.confirmResetFlags')))return;loadFlagConfigPanel(null);}

// ══ CSV IMPORT ════════════════════════════════════════════════════════════════

