var _embedded = new URLSearchParams(window.location.search).get('embed') === '1';

/* == Helpers == */
function prHide(id){var el=document.getElementById(id);if(el)el.classList.add('hidden');}
function prShow(id){var el=document.getElementById(id);if(el)el.classList.remove('hidden');}
function prToggleId(id){var el=document.getElementById(id);if(el)el.classList.toggle('hidden');}
// Opt-in to unsaved-changes guard for the time-entry modal.
if(typeof guardUnsavedChanges==='function')guardUnsavedChanges('prModal');

/* == Bootstrap == */
var user=requireAuth(isAdmin);
if(user){
  if(!_embedded) buildHeader('payroll');
  applyStrings(document.body);
  if(_embedded){
    document.querySelectorAll('.pr-standalone-only').forEach(function(el){el.style.display='none';});
    document.body.style.margin='0';document.body.style.padding='0';
    new ResizeObserver(function(){
      var h=document.documentElement.scrollHeight;
      if(window.parent!==window) window.parent.postMessage({type:'payroll-resize',height:h},'*');
    }).observe(document.body);
  }
}
var _members=[],_empData={},_empByMember={},_previewData={},_tsEmployees=[],_closedPeriods=new Set();
var _tsEntries=[],_calYear=new Date().getFullYear(),_calMonth=new Date().getMonth(),_calView='cal',_editId=null;
function _e(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function _fmtEU(n){var v=Math.round(n||0),neg=v<0,s=Math.abs(v).toString(),out='';for(var i=0;i<s.length;i++){if(i>0&&(s.length-i)%3===0)out+='.';out+=s[i];}return neg?'-'+out:out;}
function _fmtTime(iso){if(!iso)return'';var d=new Date(iso);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function _fmtDateDMY(iso){if(!iso)return'';var d=new Date(iso);return String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear();}
function kr(n){return _fmtEU(n)+'\u00a0kr.';}
function fmtMins(m){var h=Math.floor((+m)/60),mn=Math.round((+m)%60);return h+'h '+String(mn).padStart(2,'0')+'m';}
function toLocal(iso){if(!iso)return '';var d=new Date(iso);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function locale(){return (typeof getLang==='function')&&getLang()==='IS'?'is-IS':'en-GB';}
var EMP_COLORS=['#4e9a8c','#7b5ea7','#c97c3a','#3a79c9','#b84a4a','#5a9e47','#a04a7c','#7a8a3a'];
function empColor(eid){var i=_tsEmployees.findIndex(function(x){return x.id===eid;});return EMP_COLORS[Math.max(0,i)%EMP_COLORS.length];}
function empName(eid){var e=_tsEmployees.find(function(x){return x.id===eid;});return e?e.name:eid;}

/* == Tab router == */
function prTab(tab){
  ['employees','timesheets'].forEach(function(t){
    document.getElementById('pr-'+t).classList.toggle('hidden',t!==tab);
  });
  document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.toggle('active',b.dataset.tab===tab);});
  var url=new URL(window.location.href);url.searchParams.set('tab',tab);history.replaceState(null,'',url);
  if(tab==='employees')   prLoadEmployees();
  if(tab==='timesheets')  prInitTimesheets();
}

/* == EMPLOYEES == */
async function prLoadEmployees(){
  var list=document.getElementById('prEmpList');
  list.innerHTML='<div class="empty-note" data-s="lbl.loading"></div>';applyStrings(list);
  // Load allowBreaks toggle state from config
  try{
    var cfgRes=await apiGet('getConfig');
    var cb=document.getElementById('cfgAllowBreaks');
    if(cb)cb.checked=!!(cfgRes&&cfgRes.allowBreaks);
    var lbl=document.getElementById('cfgAllowBreaksLbl');
    if(lbl)lbl.textContent=(cfgRes&&cfgRes.allowBreaks)?s('lbl.on'):s('lbl.off');
  }catch(e){}
  try{
    var res=await Promise.all([apiGet('getMembers'),apiGet('getEmployees')]);
    _members=(res[0].members||[]).filter(function(m){return m.role==='staff'||m.role==='admin';});
    _empData={};_empByMember={};
    (res[1].employees||[]).forEach(function(e){_empData[e.id]=e;if(e.memberId)_empByMember[e.memberId]=e;});
    if(!_members.length){list.innerHTML='<div class="empty-note" data-s="lbl.noData"></div>';applyStrings(list);return;}
    list.innerHTML=_members.map(function(m){
      var emp=_empByMember[m.id]||null;
      var act=emp&&(emp.payrollEnabled===true||emp.payrollEnabled==='true');
      return prEmpRowHTML(m,emp,act);
    }).join('');
    applyStrings(list);
  }catch(e){list.innerHTML='<div class="empty-note" style="color:var(--red)">'+_e(e.message)+'</div>';}
}
function prEmpRowHTML(m,emp,act){
  var mid=_e(m.id);
  var h='<div class="emp-row" id="emprow_'+mid+'">';
  h+='<span class="emp-name">'+_e(m.name)+'</span>';
  h+='<span class="emp-kt">'+_e(m.kennitala||'')+'</span>';
  h+='<span class="'+(act?'pr-badge-on':'pr-badge-off')+'" data-s="'+(act?'payroll.tabEmployees':'payroll.notEnabled')+'"></span>';
  h+='<button class="btn btn-secondary btn-sm" data-pr-click="prToggleEdit" data-pr-arg="'+mid+'" data-s="btn.edit"></button>';
  h+='</div>';
  h+='<div id="empedit_'+mid+'" class="hidden" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:8px">';
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">';
  h+='<strong style="font-size:13px">'+_e(m.name)+'</strong>';
  h+='<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">';
  h+='<input type="checkbox" id="prEnabled_'+mid+'" '+(act?'checked':'')+'>';
  h+='<span data-s="payroll.enablePayroll"></span></label></div>';
  h+='<div class="emp-fields">';
  h+='<div class="field"><label data-s="payroll.titleField"></label><input id="prTitle_'+mid+'" type="text" value="'+_e(emp&&emp.title||'')+'"></div>';
  h+='</div>';
  h+='<div style="display:flex;gap:8px;margin-top:10px">';
  h+='<button class="btn btn-primary btn-sm" data-pr-click="prSaveEmployee" data-pr-arg="'+mid+'" data-s="btn.save"></button>';
  h+='<button class="btn btn-secondary btn-sm" data-pr-click="prToggleEdit" data-pr-arg="'+mid+'" data-s="btn.cancel"></button>';
  h+='<span id="prMsg_'+mid+'" style="font-size:11px;margin-left:4px"></span>';
  h+='</div></div>';
  return h;
}
// Inline employee edit panels: track their initial state so we can detect
// unsaved edits on close / page unload. Keyed by member id.
var _empEditBaseline={};
function _empEditSnapshot(mid){
  var pan=document.getElementById('empedit_'+mid);
  if(!pan){delete _empEditBaseline[mid];return;}
  var en=document.getElementById('prEnabled_'+mid);
  var ti=document.getElementById('prTitle_'+mid);
  _empEditBaseline[mid]={enabled:en?en.checked:false,title:ti?ti.value:''};
}
function _empEditIsDirty(mid){
  var base=_empEditBaseline[mid];if(!base)return false;
  var en=document.getElementById('prEnabled_'+mid);
  var ti=document.getElementById('prTitle_'+mid);
  if(en&&en.checked!==base.enabled)return true;
  if(ti&&ti.value!==base.title)return true;
  return false;
}
function _anyEmpEditDirty(){
  for(var k in _empEditBaseline){
    var pan=document.getElementById('empedit_'+k);
    if(pan&&!pan.classList.contains('hidden')&&_empEditIsDirty(k))return true;
  }
  return false;
}
function prToggleEdit(mid){
  var el=document.getElementById('empedit_'+mid);if(!el)return;
  var wasOpen=!el.classList.contains('hidden');
  if(wasOpen&&_empEditIsDirty(mid)){
    ymConfirm(s('msg.unsavedChanges')).then(function(ok){
      if(!ok)return;
      el.classList.add('hidden');
      delete _empEditBaseline[mid];
    });
    return;
  }
  el.classList.toggle('hidden');
  if(wasOpen){delete _empEditBaseline[mid];return;}
  applyStrings(el);
  _empEditSnapshot(mid);
}
window.addEventListener('beforeunload',function(e){
  if(_anyEmpEditDirty()){e.preventDefault();e.returnValue='';return '';}
});
async function prSaveEmployee(memberId){
  var msg=document.getElementById('prMsg_'+memberId);
  var member=_members.find(function(m){return m.id===memberId;});if(!member)return;
  var existing=_empByMember[memberId]||null;
  var empId=existing?existing.id:('emp_'+Date.now().toString(36));
  function fv(pre){var el=document.getElementById(pre+'_'+memberId);return el?el.value.trim():'';}
  var payload={id:empId,memberId:memberId,name:member.name,kt:member.kennitala||'',
    title:fv('prTitle'),
    payrollEnabled:!!(document.getElementById('prEnabled_'+memberId)&&document.getElementById('prEnabled_'+memberId).checked)};
  if(msg)msg.textContent=s('lbl.loading');
  try{
    await apiPost('saveEmployee',payload);
    _empData[empId]=Object.assign({},existing||{},payload);
    _empByMember[memberId]=_empData[empId];
    delete _empEditBaseline[memberId];
    if(msg){msg.textContent='\u2713';msg.style.color='var(--green)';}
    setTimeout(function(){prLoadEmployees();},800);
  }catch(e){if(msg){msg.textContent=e.message;msg.style.color='var(--red)';}}
}
async function cfgSaveAllowBreaks(){
  var cb=document.getElementById('cfgAllowBreaks');
  var lbl=document.getElementById('cfgAllowBreaksLbl');
  var val=cb?cb.checked:false;
  if(lbl)lbl.textContent=val?s('lbl.on'):s('lbl.off');
  try{
    await apiPost('saveConfig',{allowBreaks:val});
    showToast(s('toast.saved'));
  }catch(e){showToast(e.message,'err');}
}

/* == TIME REPORTING == */
async function prInitTimesheets(){
  if(_tsEmployees.length===0){
    try{
      var empRes=await apiGet('getEmployees');
      if(!_members.length){var mRes=await apiGet('getMembers');_members=(mRes.members||[]).filter(function(m){return m.role==='staff'||m.role==='admin';});}
      _tsEmployees=(empRes.employees||[]).filter(function(e){
        if(!(e.payrollEnabled===true||e.payrollEnabled==='true'))return false;
        return !_members.length||_members.some(function(m){return m.id===e.memberId;});
      });
      var sel=document.getElementById('prTsEmp'),meSel=document.getElementById('meEmp');
      _tsEmployees.forEach(function(e){
        var o=document.createElement('option');o.value=e.id;o.textContent=e.name;sel.appendChild(o);
        var o2=document.createElement('option');o2.value=e.id;o2.textContent=e.name;meSel.appendChild(o2);
      });
    }catch(e){}
  }
  prRenderCalLabel();prLoadTsEntries();
}
function prTsFilter(){prLoadTsEntries();}
function prSetView(v){
  _calView=v;
  document.getElementById('btnCal').classList.toggle('active',v==='cal');
  document.getElementById('btnList').classList.toggle('active',v==='list');
  document.getElementById('prCalView').classList.toggle('hidden',v!=='cal');
  document.getElementById('prListView').classList.toggle('hidden',v!=='list');
  if(v==='list') prRenderList();else prRenderCalDays();
}
function prCalMove(dir){
  _calMonth+=dir;
  if(_calMonth>11){_calMonth=0;_calYear++;}
  if(_calMonth<0){_calMonth=11;_calYear--;}
  prRenderCalLabel();prLoadTsEntries();
}
function prRenderCalLabel(){
  var d=new Date(_calYear,_calMonth,1);
  document.getElementById('prCalLabel').textContent=String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear();
}
// Pair separate type='in'/type='out' rows into single session entries.
function _pairTimeEntries(rows) {
  var ins   = rows.filter(function(r){ return r.type==='in'; });
  var outs  = rows.filter(function(r){ return r.type==='out'; });
  var paired = [];
  // Pair out rows with their matching in rows
  var usedInIds=new Set();
  outs.slice().sort(function(a,b){return a.timestamp>b.timestamp?1:-1;}).forEach(function(out){
    var matchIn=null;
    ins.slice().reverse().forEach(function(inn){
      if(!matchIn&&!usedInIds.has(inn.id)&&inn.employeeId===out.employeeId&&inn.timestamp<out.timestamp)
        matchIn=inn;
    });
    var e=Object.assign({},out);
    if(matchIn){e.clockIn=matchIn.timestamp;usedInIds.add(matchIn.id);}
    paired.push(e);
  });
  return paired;
}
async function prLoadTsEntries(){
  var empId=document.getElementById('prTsEmp').value;
  var firstDay=new Date(_calYear,_calMonth,1);
  var startDow=(firstDay.getDay()+6)%7;
  var rangeStart=new Date(_calYear,_calMonth,1-startDow);
  var lastDay=new Date(_calYear,_calMonth+1,0);
  var endDow=(lastDay.getDay()+6)%7;
  var rangeEnd=new Date(_calYear,_calMonth+1,7-endDow);
  try{
    var params={from:rangeStart.toISOString().slice(0,10),to:rangeEnd.toISOString().slice(0,10),period:_calYear+'-'+String(_calMonth+1).padStart(2,'0')+'-01'};
    if(empId)params.employeeId=empId;
    var res=await apiGet('getTimeEntries',params);
    _tsEntries=_pairTimeEntries(res.entries||res.timeEntries||[]);
    var filtered=empId?_tsEntries.filter(function(e){return e.employeeId===empId;}):_tsEntries;
    var totalMins=filtered.reduce(function(s,e){return s+(+(e.durationMinutes||0));},0);
    document.getElementById('prTsTotal').textContent=fmtMins(totalMins)+' '+s('payroll.totalHours');
    if(_calView==='cal')prRenderCalDays();else prRenderList();
  }catch(e){document.getElementById('prTsTotal').textContent='';}
}
function prRenderCalDays(){
  var container=document.getElementById('prCalDays');
  var empId=document.getElementById('prTsEmp').value;
  var today=new Date();today.setHours(0,0,0,0);
  var firstDay=new Date(_calYear,_calMonth,1);
  var startDow=(firstDay.getDay()+6)%7;
  var lastDay=new Date(_calYear,_calMonth+1,0).getDate();
  var endDow=(new Date(_calYear,_calMonth+1,0).getDay()+6)%7;
  var byDate={};
  _tsEntries.forEach(function(e){
    if(empId&&e.employeeId!==empId)return;
    var d=sstr(e.clockIn||e.timestamp).slice(0,10);if(!d)return;
    if(!byDate[d])byDate[d]=[];byDate[d].push(e);
  });
  var totalCells=startDow+lastDay+(endDow<6?6-endDow:0);
  var html='';
  for(var i=0;i<totalCells;i++){
    var dayNum=i-startDow+1;
    var cellDate=new Date(_calYear,_calMonth,dayNum);
    var isOther=dayNum<1||dayNum>lastDay;
    var isToday=cellDate.getTime()===today.getTime();
    var dateStr=cellDate.toISOString().slice(0,10);
    var dayEntries=byDate[dateStr]||[];
    var cls='cal-cell'+(isOther?' other-month':'')+(isToday?' today':'');
    var shown=dayEntries.slice(0,3);
    var pills=shown.map(function(e){
      var col=empColor(e.employeeId);
      var inT=e.clockIn?_fmtTime(e.clockIn):'?';
      var outT=e.timestamp?_fmtTime(e.timestamp):'?';
      var dur=e.durationMinutes?fmtMins(+e.durationMinutes):'';
      var firstName=empName(e.employeeId).split(' ')[0];
      var label=firstName+'\u00a0'+inT+'\u2013'+outT;
      var edata=JSON.stringify(e).replace(/"/g,'&quot;');
      return '<span class="cal-pill" style="background:'+col+'22;color:'+col+';border-color:'+col+'44"'
        +' data-pr-open-ds-row data-e="'+edata+'"'
        +' title="'+_e(empName(e.employeeId))+' '+inT+'\u2013'+outT+' ('+dur+')">'+_e(label)+'</span>';
    }).join('');
    if(dayEntries.length>3)pills+='<div class="cal-more">+'+(dayEntries.length-3)+' '+s('payroll.moreEntries')+'</div>';
    html+='<div class="'+cls+'" data-pr-open-date data-pr-arg="'+dateStr+'">'
      +'<span class="cal-day-num">'+cellDate.getDate()+'</span>'+pills+'</div>';
  }
  container.innerHTML=html;
}
function prRenderList(){
  var list=document.getElementById('prTsList');
  var empId=document.getElementById('prTsEmp').value;
  var filtered=empId?_tsEntries.filter(function(e){return e.employeeId===empId;}):_tsEntries;
  if(!filtered.length){list.innerHTML='<div class="empty-note" data-s="lbl.noData"></div>';applyStrings(list);return;}
  var byEmp={};
  filtered.forEach(function(e){var k=e.employeeId||'unknown';if(!byEmp[k])byEmp[k]={name:e.employeeName||empName(k),entries:[]};byEmp[k].entries.push(e);});
  list.innerHTML=Object.keys(byEmp).map(function(eid){
    var grp=byEmp[eid];
    var tot=grp.entries.reduce(function(s,e){return s+(+(e.durationMinutes||0));},0);
    var rows=grp.entries.slice().sort(function(a,b){return (a.clockIn||a.timestamp||'')>(b.clockIn||b.timestamp||'')?1:-1;}).map(function(e){
      var ci=e.clockIn?new Date(e.clockIn):null,co=e.timestamp?new Date(e.timestamp):null;
      var dateStr=e.clockIn?_fmtDateDMY(e.clockIn):'--';
      var inT=e.clockIn?_fmtTime(e.clockIn):'--';
      var outT=e.timestamp?_fmtTime(e.timestamp):'--';
      var dur=e.durationMinutes?fmtMins(+e.durationMinutes):'--';
      var srcLabel=e.source==='admin'?('<span class="src-admin">\u270e '+s('lbl.admin')+'</span>'):s('lbl.staff');
      var edited=e.originalTimestamp?('<span class="edited-badge">'+s('lbl.edited')+'</span>'):'';
      var edata=JSON.stringify(e).replace(/"/g,'&quot;');
      return '<tr><td>'+dateStr+'</td><td>'+inT+'</td><td>'+outT+edited+'</td><td>'+dur+'</td><td>'+srcLabel+'</td>'
        +'<td style="text-align:right"><button class="btn btn-secondary btn-sm"'
        +' data-pr-open-ds data-e="'+edata+'" data-s="btn.edit"></button></td></tr>';
    }).join('');
    return '<div><div class="ts-group-header" style="font-weight:600;font-size:13px;margin-bottom:6px;display:flex;justify-content:space-between">'
      +'<span>'+_e(grp.name)+'</span><span style="font-size:11px;color:var(--muted)">'+fmtMins(tot)+' '+s('payroll.totalHours')+'</span></div>'
      +'<table class="ts-table"><thead><tr>'
      +'<th data-s="lbl.date"></th><th data-s="payroll.clockInLabel"></th><th data-s="payroll.clockOutLabel"></th>'
      +'<th data-s="lbl.duration"></th><th data-s="lbl.type"></th><th></th>'
      +'</tr></thead><tbody>'+rows+'</tbody></table></div>';
  }).join('');
  applyStrings(list);
}

/* Entry modal */
function prOpenModal(entry,dateStr){
  _editId=entry?entry.id:null;
  document.getElementById('prModalTitle').textContent=entry?s('payroll.editEntry'):s('payroll.addEntry');
  document.getElementById('meDelBtn').style.display=entry?'inline-block':'none';
  var meSel=document.getElementById('meEmp');
  if(entry&&entry.employeeId)meSel.value=entry.employeeId;
  else if(_tsEmployees.length)meSel.value=_tsEmployees[0].id;
  if(entry){
    document.getElementById('meIn').value=toLocal(entry.clockIn||'');
    document.getElementById('meOut').value=toLocal(entry.timestamp||'');
    document.getElementById('meMins').value=entry.durationMinutes||'';
    document.getElementById('meNote').value=entry.note||'';
  }else{
    var off=new Date().getTimezoneOffset()*60000;
    var base=dateStr?new Date(dateStr+'T09:00'):new Date();
    var baseEnd=dateStr?new Date(dateStr+'T17:00'):new Date(Date.now()+3600000);
    document.getElementById('meIn').value=new Date(base-base.getTimezoneOffset()*60000).toISOString().slice(0,16);
    document.getElementById('meOut').value=new Date(baseEnd-baseEnd.getTimezoneOffset()*60000).toISOString().slice(0,16);
    document.getElementById('meMins').value='480';
    document.getElementById('meNote').value='';
  }
  document.getElementById('meErr').textContent='';
  openModal('prModal');
}
function prCloseModal(force){closeModal('prModal',force===true);_editId=null;}
function meCalcMins(){
  var i=document.getElementById('meIn').value,o=document.getElementById('meOut').value;
  if(!i||!o)return;var d=Math.round((new Date(o)-new Date(i))/60000);if(d>0)document.getElementById('meMins').value=d;
}
async function meSave(){
  var err=document.getElementById('meErr');err.textContent='';
  var empId=document.getElementById('meEmp').value;
  var inV=document.getElementById('meIn').value;
  var outV=document.getElementById('meOut').value;
  var mins=+(document.getElementById('meMins').value)||0;
  var note=document.getElementById('meNote').value.trim();
  if(!empId||!inV||!outV){err.textContent=s('payroll.entryRequired');return;}
  if(!mins)mins=Math.round((new Date(outV)-new Date(inV))/60000);
  if(mins<=0){err.textContent=s('payroll.clockOutAfterIn');return;}
  try{
    if(_editId){
      await apiPost('adminEditTime',{id:_editId,clockIn:new Date(inV).toISOString(),timestamp:new Date(outV).toISOString(),durationMinutes:mins,note:note||'admin edit',source:'admin'});
    }else{
      await apiPost('adminAddTime',{employeeId:empId,clockIn:new Date(inV).toISOString(),timestamp:new Date(outV).toISOString(),durationMinutes:mins,note:note||'admin entry',source:'admin'});
    }
    prCloseModal(true);showToast(s('toast.saved'));prLoadTsEntries();
  }catch(e){err.textContent=e.message;}
}
async function meDelete(){
  if(!_editId)return;
  if(!await ymConfirm(s('payroll.deleteConfirm')))return;
  try{await apiPost('adminDeleteTime',{id:_editId});prCloseModal(true);showToast(s('toast.deleted'));prLoadTsEntries();}
  catch(e){document.getElementById('meErr').textContent=e.message;}
}

/* == EXPORT TO EXTERNAL PAYROLL APP == */
function prToggleExport(){
  var panel=document.getElementById('prExportPanel');
  if(!panel)return;
  var hidden=panel.classList.toggle('hidden');
  if(!hidden){
    // First open (or reopen): seed defaults from current calendar month, load saved URL
    var from=document.getElementById('prExpFrom'),to=document.getElementById('prExpTo');
    var firstDay=new Date(_calYear,_calMonth,1);
    var lastDay=new Date(_calYear,_calMonth+1,0);
    function iso(d){return d.toISOString().slice(0,10);}
    if(from&&!from.value)from.value=iso(firstDay);
    if(to&&!to.value)to.value=iso(lastDay);
    var urlEl=document.getElementById('prExpUrl');
    if(urlEl&&!urlEl.value){
      try{urlEl.value=localStorage.getItem('ymir_payroll_export_url')||'';}catch(e){}
    }
    applyStrings(panel);
  }
}
function prSaveExportUrl(){
  var el=document.getElementById('prExpUrl');
  if(!el)return;
  try{localStorage.setItem('ymir_payroll_export_url',el.value.trim());}catch(e){}
}
async function prExportTimeData(){
  var msg=document.getElementById('prExpMsg');
  function setMsg(text,color){if(msg){msg.textContent=text;msg.style.color=color||'';}}
  var url='';
  try{url=(localStorage.getItem('ymir_payroll_export_url')||'').trim();}catch(e){}
  var urlEl=document.getElementById('prExpUrl');
  if(!url&&urlEl)url=urlEl.value.trim();
  if(!url){showToast(s('payroll.urlNotSet'),'err');setMsg(s('payroll.urlNotSet'),'var(--red)');return;}
  var from=(document.getElementById('prExpFrom')||{}).value||'';
  var to=(document.getElementById('prExpTo')||{}).value||'';
  if(!from||!to||from>to){showToast(s('payroll.noPeriodDefined'),'err');setMsg(s('payroll.noPeriodDefined'),'var(--red)');return;}
  setMsg(s('lbl.loading'),'var(--muted)');
  try{
    var res=await Promise.all([
      apiGet('getTimeEntries',{from:from,to:to,period:from.slice(0,7)+'-01'}),
      apiGet('getEmployees')
    ]);
    var payload={
      from:from,to:to,
      employees:res[1].employees||[],
      timeEntries:res[0].entries||res[0].timeEntries||[]
    };
    var fetchRes=await fetch(url,{
      method:'POST',
      mode:'cors',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),
      redirect:'follow'
    });
    if(!fetchRes.ok)throw new Error('HTTP '+fetchRes.status);
    setMsg('\u2713 '+s('payroll.exportSent'),'var(--green)');
    showToast(s('payroll.exportSent'));
  }catch(e){
    setMsg(s('payroll.exportFailed')+': '+e.message,'var(--red)');
    showToast(s('payroll.exportFailed')+': '+e.message,'err');
  }
}

/* == Init == */
(function(){var p=new URLSearchParams(window.location.search);prTab(p.get('tab')||'employees');})();

(function () {
  if (typeof document === 'undefined' || document._prListeners) return;
  document._prListeners = true;
  document.addEventListener('click', function (e) {
    var cs = e.target.closest('[data-pr-close-self]');
    if (cs && e.target === cs) { closeModal('prModal'); return; }
    var cl = e.target.closest('[data-pr-close]');
    if (cl) { closeModal(cl.dataset.prClose); return; }
    // Row with dataset.e JSON blob — stop bubble before opening
    var rowStop = e.target.closest('[data-pr-open-ds-row]');
    if (rowStop) {
      e.stopPropagation();
      try { prOpenModal(JSON.parse(rowStop.dataset.e), null); } catch (_) {}
      return;
    }
    var row = e.target.closest('[data-pr-open-ds]');
    if (row) { try { prOpenModal(JSON.parse(row.dataset.e), null); } catch (_) {} return; }
    var dt = e.target.closest('[data-pr-open-date]');
    if (dt) { prOpenModal(null, dt.dataset.prArg); return; }
    var c = e.target.closest('[data-pr-click]');
    if (c && typeof window[c.dataset.prClick] === 'function') {
      var a = c.dataset.prArg != null ? [c.dataset.prArg] : [];
      window[c.dataset.prClick].apply(null, a);
    }
  });
  document.addEventListener('change', function (e) {
    var c = e.target.closest('[data-pr-change]');
    if (c && typeof window[c.dataset.prChange] === 'function') window[c.dataset.prChange]();
  });
  document.addEventListener('input', function (e) {
    var i = e.target.closest('[data-pr-input]');
    if (i && typeof window[i.dataset.prInput] === 'function') window[i.dataset.prInput]();
  });
})();
