/* Recurring task automation. Bound Google Apps Script. Time zone: Asia/Kolkata. */
const TASK_HEADERS = ['Task ID','Task','Assigned to','Employee email','Frequency','Period days','First due date','Due time','Proof required','Active'];
const WORK_HEADERS = ['Cycle ID','Task ID','Task','Assigned to','Due at','Status','Proof required','Ticket ID / update proof','Submit','Completed at','Completed by','Manager acknowledge','Manager action / note','Acknowledged at','Acknowledged by','Manager alert at','Leadership alert at','Validation message'];
const ALERT_HEADERS = ['Alert ID','Cycle ID','Level','Reason','Recipient','Created at','Delivery status','Sent at','Error'];
const HISTORY_HEADERS = ['Cycle ID','Task ID','Assigned to','Completed at','Recorded by','Accepted proof'];

function validDay(day) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && !isNaN(Date.parse(day+'T00:00:00Z')) && new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day; }
function realEmail(value) { return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(String(value)) && !/@(?:[^@]*\.)?(?:example\.(?:com|invalid)|[^@]+\.invalid)$/i.test(String(value)); }
function taskSla(taskId,settings) {
  const demo=String(taskId).startsWith('DEMO-RUN-');
  return {ack:demo?Number(settings.demoAckMinutes||1)/60:settings.ackHours,resolve:demo?Number(settings.demoResolveMinutes||3)/60:settings.resolveHours};
}
function validateState(state,settings) {
  if(!(settings.ackHours>0 && settings.resolveHours>0))throw new Error('SLA hours must be positive.');
  if(settings.mode && !['DRY_RUN','LIVE'].includes(settings.mode))throw new Error('Email mode must be DRY_RUN or LIVE.');
  if(settings.demoMode && !['DRY_RUN','LIVE'].includes(settings.demoMode))throw new Error('Demo email mode must be DRY_RUN or LIVE.');
  const ids=new Set();
  state.tasks.forEach(t=>{
    if(ids.has(t.id))throw new Error('Duplicate Task ID: '+t.id);ids.add(t.id);
    if(!t.active)return;
    if(!t.task || !t.employee || !t.proof)throw new Error('Missing task, employee or proof requirement: '+t.id);
    if(!validDay(t.first) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time))throw new Error('Invalid date or time: '+t.id);
    const periods={'Daily':1,'Every 7 days':7,'Every 15 days':15,'Every 30 days':30};
    if(!(t.frequency in periods) || Number(t.period)!==periods[t.frequency])throw new Error('Frequency and period disagree: '+t.id);
  });
  (settings.holidays||[]).forEach(d=>{if(!validDay(d))throw new Error('Invalid holiday date: '+d);});
  const cycleIds=new Set(),alertIds=new Set();
  state.cycles.forEach(c=>{
    if(cycleIds.has(c.id))throw new Error('Duplicate Cycle ID. Repair before running.');cycleIds.add(c.id);
    if(!ids.has(c.taskId) || !Number.isFinite(Date.parse(c.due)))throw new Error('Unknown task or invalid due date: '+c.id);
  });
  state.alerts.forEach(a=>{if(alertIds.has(a.id))throw new Error('Duplicate Alert ID: '+a.id);alertIds.add(a.id);});
}

function localDay(at) { return new Date(new Date(at).getTime()+330*60000).toISOString().slice(0,10); }
function addDays(day,n) { return new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10); }
function workingDay(day,holidays) { const d=new Date(day+'T00:00:00Z').getUTCDay(); return d!==0 && d!==6 && !holidays.includes(day); }
function nextDay(task,day,holidays) {
  if(task.frequency!=='Daily') return addDays(day,Number(task.period));
  do { day=addDays(day,1); } while(!workingDay(day,holidays));
  return day;
}
function dueAt(task,day) { return day+'T'+task.time+':00+05:30'; }
function newCycle(task,day) { return {id:task.id+'|'+day,taskId:task.id,task:task.task,employee:task.employee,due:dueAt(task,day),status:'Upcoming',required:task.proof,proof:'',submit:false,completed:'',completedBy:'',ack:false,note:'',ackAt:'',ackBy:'',managerAt:'',leaderAt:'',error:''}; }
function alerted(state,id,level) { return state.alerts.some(a=>a.cycleId===id && a.level===level && ['SENT','SIMULATED','SENDING'].includes(a.delivery)); }
function queueAlert(state,c,level,reason,now,settings) {
  const id=c.id+'|'+level;
  const old=state.alerts.find(a=>a.id===id);
  if(old && old.delivery!=='CANCELLED')return;
  const recipient=String(c.taskId).startsWith('DEMO-RUN-')?settings.demoInbox:(level==='Manager'?settings.manager:settings.leadership);
  const alert={id:id,cycleId:c.id,level:level,reason:reason,to:recipient,created:now,delivery:'QUEUED',sent:'',error:''};
  if(old)Object.assign(old,alert);else state.alerts.push(alert);
}
/* Pure engine shared by production and deterministic tests. All times use explicit offsets. */
function advance(state,now,settings) {
  validateState(state,settings);
  const ms=Date.parse(now),today=localDay(now),holidays=settings.holidays||[];
  const ids=new Set(state.cycles.map(c=>c.id));
  if(ids.size!==state.cycles.length) throw new Error('Duplicate Cycle ID. Repair before running.');
  const taskIds=new Set();
  state.tasks.forEach(t=>{
    if(taskIds.has(t.id)) throw new Error('Duplicate Task ID: '+t.id);
    taskIds.add(t.id);
    if(!t.active) return;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(t.first) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)) throw new Error('Invalid date or time: '+t.id);
    if(t.frequency!=='Daily' && (!Number.isInteger(Number(t.period)) || Number(t.period)<1)) throw new Error('Invalid period: '+t.id);
    let day=t.first,count=0;
    if(t.frequency==='Daily') while(!workingDay(day,holidays)) day=addDays(day,1);
    // Backfill every missed cycle and prepare exactly one future cycle.
    while(true) {
      if(++count>5000) throw new Error('More than 5000 cycles for '+t.id+'. Review First due date.');
      const id=t.id+'|'+day;
      if(!ids.has(id)) {state.cycles.push(newCycle(t,day));ids.add(id);}
      if(day>today) break;
      day=nextDay(t,day,holidays);
    }
  });
  state.cycles.forEach(c=>{
    const task=state.tasks.find(t=>t.id===c.taskId);
    if(c.status==='Completed') {c.submit=false;return;}
    if(c.submit===true) {
      c.error='';
      if(!String(c.proof||'').trim()) c.error='Enter '+c.required+' before submitting.';
      else if(c.required==='Ticket ID' && !/^[A-Za-z0-9][A-Za-z0-9._\/-]{2,79}$/.test(String(c.proof).trim())) c.error='Ticket ID must be 3 to 80 letters, numbers, dots, slashes, hyphens or underscores.';
      else if(c.required!=='Ticket ID' && String(c.proof).trim().length<12) c.error='Paste the actual daily update or a screenshot link. A short yes or done is not enough.';
      else if(localDay(c.due)>today) c.error='This cycle is not due yet.';
      else {c.status='Completed';c.completed=now;c.completedBy=c.employee;c.submit=false;return;}
      c.submit=false;
    }
    if(c.ack===true && !c.ackAt) {
      if(!String(c.note||'').trim()) c.error='Manager must enter an action / note before acknowledging.';
      else {c.ackAt=now;c.ackBy=settings.manager; c.error='';}
    }
    c.status=ms>Date.parse(c.due)?'Overdue':localDay(c.due)<=today?'Due':'Upcoming';
    if(!task || !task.active) return;
    if(c.status==='Overdue') {
      queueAlert(state,c,'Manager','Task remains incomplete after deadline',now,settings);
      const manager=state.alerts.find(a=>a.cycleId===c.id && a.level==='Manager');
      const sla=taskSla(c.taskId,settings);
      // Acknowledgement clock starts only after the manager notification was delivered or simulated.
      const noAck=manager && ['SENT','SIMULATED'].includes(manager.delivery) && !c.ackAt && ms>=Date.parse(manager.sent)+sla.ack*3600000;
      const unresolved=ms>=Date.parse(c.due)+sla.resolve*3600000;
      if(noAck || unresolved) queueAlert(state,c,'Leadership',noAck?'Manager acknowledgement SLA missed':'Task unresolved after resolution SLA',now,settings);
      else state.alerts.filter(a=>a.cycleId===c.id && a.level==='Leadership' && ['QUEUED','FAILED'].includes(a.delivery)).forEach(a=>{a.delivery='CANCELLED';a.error='Manager acknowledged before delivery. Resolution SLA not reached.';});
    }
  });
  state.alerts.forEach(a=>{
    const c=state.cycles.find(c=>c.id===a.cycleId),t=c && state.tasks.find(t=>t.id===c.taskId);
    if((!c || c.status==='Completed' || !t || !t.active) && ['QUEUED','FAILED'].includes(a.delivery)){a.delivery='CANCELLED';a.error='Cycle completed or task inactive before delivery.';}
  });
  return state;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Recurring tasks').addItem('Set up automation','setup').addItem('Refresh / process updates','processTasks').addItem('Check installation','checkInstallation').addItem('Prepare timed demo','prepareTimedDemo').addItem('Stop timed demo','stopTimedDemo').addItem('Run isolated demo tests','runDemoTests').addItem('Retry FAILED emails','retryFailedEmails').addToUi();
}
function config_() {
  const ss=SpreadsheetApp.getActive();
  const rows=ss.getSheetByName('Settings').getDataRange().getValues();
  const p={};rows.slice(1).forEach(r=>p[r[0]]=r[1]);
  return {manager:String(p['Manager email']||'').trim(),leadership:String(p['Leadership email']||'').trim(),ackHours:Number(p['Acknowledgement hours']),resolveHours:Number(p['Resolution hours']),mode:String(p['Email mode']).toUpperCase(),holidays:String(p['Holidays']||'').split(',').map(x=>x.trim()).filter(Boolean),interval:Number(p['Automation interval minutes']||15),demoInbox:String(p['Demo test inbox']||'').trim(),demoMode:String(p['Demo email mode']||'DRY_RUN').toUpperCase(),demoAckMinutes:Number(p['Demo acknowledgement minutes']||1),demoResolveMinutes:Number(p['Demo resolution minutes']||3)};
}
function sheet_(name,headers) {
  const ss=SpreadsheetApp.getActive();const sh=ss.getSheetByName(name)||ss.insertSheet(name);
  if(sh.getLastRow()===0) sh.appendRow(headers);
  const actual=sh.getRange(1,1,1,headers.length).getValues()[0];
  if(actual.join('|')!==headers.join('|')) throw new Error('Unexpected headers on '+name+'. Restore the supplied column order.');
  return sh;
}
function rows_(sh) {return sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();}
function iso_(v) {return v instanceof Date?v.toISOString():String(v||'');}
function day_(v) {return v instanceof Date?Utilities.formatDate(v,'Asia/Kolkata','yyyy-MM-dd'):String(v||'');}
function time_(v) {return v instanceof Date?Utilities.formatDate(v,'Asia/Kolkata','HH:mm'):String(v||'');}
function readState_() {
  const tasks=rows_(sheet_('Task Master',TASK_HEADERS)).filter(r=>r[0]).map(r=>({id:String(r[0]),task:r[1],employee:r[2],email:r[3],frequency:r[4],period:Number(r[5]),first:day_(r[6]),time:time_(r[7]),proof:r[8],active:r[9]===true || String(r[9]).toUpperCase()==='TRUE'}));
  const cycles=rows_(sheet_('Employee Tasks',WORK_HEADERS)).map((r,i)=>({r:r,row:i+2})).filter(x=>x.r[0]).map(x=>{const r=x.r;return {id:r[0],taskId:r[1],task:r[2],employee:r[3],due:iso_(r[4]),status:r[5],required:r[6],proof:r[7],submit:r[8]===true,completed:iso_(r[9]),completedBy:r[10],ack:r[11]===true,note:r[12],ackAt:iso_(r[13]),ackBy:r[14],managerAt:iso_(r[15]),leaderAt:iso_(r[16]),error:r[17],_row:x.row,_submitted:r[8]===true};});
  const alerts=rows_(sheet_('Alert Log',ALERT_HEADERS)).filter(r=>r[0]).map(r=>({id:r[0],cycleId:r[1],level:r[2],reason:r[3],to:r[4],created:iso_(r[5]),delivery:r[6],sent:iso_(r[7]),error:r[8]}));
  cycles.forEach(c=>c._saved=cycleRow_(c));
  return {tasks:tasks,cycles:cycles,alerts:alerts};
}
function date_(v) {return v?new Date(v):'';}
function cycleRow_(c) {return [c.id,c.taskId,c.task,c.employee,date_(c.due),c.status,c.required,c.proof,c.submit,date_(c.completed),c.completedBy,c.ack,c.note,date_(c.ackAt),c.ackBy,date_(c.managerAt),date_(c.leaderAt),c.error];}
function alertRow_(a) {return [a.id,a.cycleId,a.level,a.reason,a.to,date_(a.created),a.delivery,date_(a.sent),a.error];}
function persistCycles_(state,existing) {
  const sh=sheet_('Employee Tasks',WORK_HEADERS);
  const required=sh.getLastRow()+state.cycles.length-existing;
  if(sh.getMaxRows()<required) sh.insertRowsAfter(sh.getMaxRows(),required-sh.getMaxRows());
  state.cycles.forEach((c,i)=>{
    const row=c._row || sh.getLastRow()+1;c._row=row;
    if(i>=existing) sh.getRange(row,1,1,18).setValues([cycleRow_(c)]);
    else {
      // Leave employee proof and manager notes intact if someone edits while the scheduler runs.
      const saved=c._saved || [],same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
      if(saved[5]!==c.status)sh.getRange(row,6).setValue(c.status);
      if(c._submitted && !c.submit && String(sh.getRange(row,8).getValues()[0][0])===String(c.proof)) {sh.getRange(row,9).setValue(false);c._submitted=false;}
      const completion=[date_(c.completed),c.completedBy],monitoring=[date_(c.ackAt),c.ackBy,date_(c.managerAt),date_(c.leaderAt),c.error];
      if(!same(saved.slice(9,11),completion))sh.getRange(row,10,1,2).setValues([completion]);
      if(!same(saved.slice(13,18),monitoring))sh.getRange(row,14,1,5).setValues([monitoring]);
    }
    c._saved=cycleRow_(c);
  });
  if(state.cycles.length) {
    const checkbox=SpreadsheetApp.newDataValidation().requireCheckbox().build();
    const count=sh.getLastRow()-1;
    sh.getRange(2,9,count,1).setDataValidation(checkbox);
    sh.getRange(2,12,count,1).setDataValidation(checkbox);
    [5,10,14,16,17].forEach(col=>sh.getRange(2,col,count,1).setNumberFormat('dd-mmm-yyyy hh:mm'));
  }
}
function persistAlerts_(state) {
  const sh=sheet_('Alert Log',ALERT_HEADERS);
  if(sh.getMaxRows()<state.alerts.length+1) sh.insertRowsAfter(sh.getMaxRows(),state.alerts.length+1-sh.getMaxRows());
  if(state.alerts.length) sh.getRange(2,1,state.alerts.length,9).setValues(state.alerts.map(alertRow_));
}
function deliver_(state,settings,now) {
  state.alerts.forEach(a=>{
    if(a.delivery!=='QUEUED') return;
    const c=state.cycles.find(c=>c.id===a.cycleId);
    if(!c || c.status==='Completed') {a.delivery='CANCELLED';return;}
    const mode=String(c.taskId).startsWith('DEMO-RUN-')?settings.demoMode:settings.mode;
    if(mode==='DRY_RUN') {a.delivery='SIMULATED';a.sent=now;}
    else if(mode==='LIVE') {
      if(!a.to || !a.to.split(',').every(v=>realEmail(v.trim()))) {a.delivery='FAILED';a.error='Enter a real, valid recipient email address.';return;}
      if(MailApp.getRemainingDailyQuota()<a.to.split(',').length) {a.delivery='FAILED';a.error='Mail quota unavailable. Retry FAILED emails after quota recovers.';return;}
      // Persist before MailApp. An uncertain send stays SENDING and is never resent automatically.
      a.delivery='SENDING';persistAlerts_(state);SpreadsheetApp.flush();
      try {
        const ss=SpreadsheetApp.getActive(),work=ss.getSheetByName('Employee Tasks'),link=ss.getUrl()+'#gid='+work.getSheetId()+'&range=A'+c._row+':R'+c._row,sla=taskSla(c.taskId,settings);
        const stamp=t=>Utilities.formatDate(new Date(t),'Asia/Kolkata','dd-MMM-yyyy HH:mm')+' IST';
        const action=a.level==='Manager'?'Enter your follow-up action in column M and tick acknowledgement in L. Contact the employee and confirm completion.':'Review the overdue work and manager follow-up. Decide who will resolve it and by when.';
        const body='Task: '+c.task+'\nEmployee: '+c.employee+'\nCycle: '+c.id+'\nDue: '+stamp(c.due)+'\nReason: '+a.reason+'\nManager acknowledged: '+(c.ackAt?stamp(c.ackAt):'No')+'\nResolution deadline: '+stamp(Date.parse(c.due)+sla.resolve*3600000)+(a.level==='Manager'?'\nAcknowledgement deadline: '+stamp(Date.parse(now)+sla.ack*3600000):'')+'\n\n'+action+'\nThe task closes only after employee completion.\n\nOpen task row: '+link+'\nVerify the Cycle ID if the sheet has been sorted.';
        MailApp.sendEmail({to:a.to,subject:a.level+' alert: '+c.task+' ('+c.id+')',body:body});
        a.delivery='SENT';a.sent=now;
      } catch(e) {a.delivery='SENDING';a.error='Delivery uncertain: '+e.message+'. Check Sent mail before any manual retry.';}
    } else throw new Error('Email modes must be DRY_RUN or LIVE.');
    if(['SENT','SIMULATED'].includes(a.delivery)) {if(a.level==='Manager') c.managerAt=a.sent;else c.leaderAt=a.sent;}
    persistAlerts_(state);
  });
}
function processTasks() {
  const lock=LockService.getDocumentLock();lock.waitLock(30000);
  try {
    const ss=SpreadsheetApp.getActive();if(ss.getSpreadsheetTimeZone()!=='Asia/Kolkata') throw new Error('Run setup to set spreadsheet time zone to Asia/Kolkata.');
    const settings=config_();if(!(settings.ackHours>0 && settings.resolveHours>0)) throw new Error('SLA hours must be positive.');
    const state=readState_(),existing=state.cycles.length,now=new Date().toISOString();
    advance(state,now,settings);persistCycles_(state,existing);persistAlerts_(state);SpreadsheetApp.flush();
    deliver_(state,settings,now);persistCycles_(state,state.cycles.length);persistAlerts_(state);persistHistory_(state);syncEmployeePermissions_(state);
  } finally {lock.releaseLock();}
}
function handleEdit(e) {
  if(e && e.range.getSheet().getName()==='Employee Tasks' && e.range.getColumn()<=13 && e.range.getLastColumn()>=8) processTasks();
}
function setup() {
  const ss=SpreadsheetApp.getActive();ss.setSpreadsheetTimeZone('Asia/Kolkata');
  sheet_('Task Master',TASK_HEADERS);sheet_('Employee Tasks',WORK_HEADERS);sheet_('Alert Log',ALERT_HEADERS);sheet_('Completion History',HISTORY_HEADERS);
  const cfg=config_();validateState(readState_(),cfg);
  const interval=cfg.interval;if(![1,5,10,15,30].includes(interval))throw new Error('Automation interval must be 1, 5, 10, 15 or 30 minutes.');
  const existing=ScriptApp.getProjectTriggers();
  ['processTasks','handleEdit'].forEach(fn=>existing.filter(t=>t.getHandlerFunction()===fn).forEach(t=>ScriptApp.deleteTrigger(t)));
  ScriptApp.newTrigger('processTasks').timeBased().everyMinutes(interval).create();
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();
  const work=ss.getSheetByName('Employee Tasks');work.setFrozenRows(1);
  if(work.getFilter())work.getFilter().remove();
  work.getRange(1,1,work.getMaxRows(),18).createFilter();
  const manager=ss.getSheetByName('Manager Review');
  manager.getRange('A10:R').clearContent();
  manager.getRange('A10').setFormula('=IFERROR(FILTER(\'Employee Tasks\'!A2:R,\'Employee Tasks\'!F2:F="Overdue"),"No overdue tasks")');
  manager.getRange('A9:R9').setValues([WORK_HEADERS]);
  for(let r=2;r<=5;r++) manager.getRange(r,2,1,5).setFormulas([[
    '=COUNTIFS(\'Employee Tasks\'!D2:D,$A'+r+',\'Employee Tasks\'!F2:F,"Due")',
    '=COUNTIFS(\'Employee Tasks\'!D2:D,$A'+r+',\'Employee Tasks\'!F2:F,"Overdue")',
    '=COUNTIFS(\'Employee Tasks\'!D2:D,$A'+r+',\'Employee Tasks\'!F2:F,"Completed")',
    '=C'+r+'-COUNTIFS(\'Employee Tasks\'!D2:D,$A'+r+',\'Employee Tasks\'!F2:F,"Overdue",\'Employee Tasks\'!N2:N,">0")',
    '=COUNTIFS(\'Employee Tasks\'!D2:D,$A'+r+',\'Employee Tasks\'!F2:F,"Overdue",\'Employee Tasks\'!Q2:Q,">0")'
  ]]);
  protectInputs_();
  processTasks();
}
function protectInputs_() {
  const ss=SpreadsheetApp.getActive(),work=ss.getSheetByName('Employee Tasks'),manager=config_().manager;
  [work,ss.getSheetByName('Task Master'),ss.getSheetByName('Settings'),ss.getSheetByName('Alert Log'),ss.getSheetByName('Completion History'),ss.getSheetByName('Manager Review')].filter(Boolean).forEach(sh=>{
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).filter(p=>p.getDescription()==='Managed fields').forEach(p=>p.remove());
    const p=sh.protect().setDescription('Managed fields');p.removeEditors(p.getEditors());if(p.canDomainEdit())p.setDomainEdit(false);
    if(sh===work)p.setUnprotectedRanges([work.getRange('H2:I'),work.getRange('L2:M')]);
  });
  work.getProtections(SpreadsheetApp.ProtectionType.RANGE).filter(p=>p.getDescription()==='Manager input').forEach(p=>p.remove());
  const p=work.getRange('L2:M').protect().setDescription('Manager input');p.removeEditors(p.getEditors());if(p.canDomainEdit())p.setDomainEdit(false);
  if(manager && !/example\.(com|invalid)/i.test(manager))p.addEditor(manager);
}
function persistHistory_(state) {
  const sh=sheet_('Completion History',HISTORY_HEADERS),known=new Set(rows_(sh).filter(r=>r[0]).map(r=>r[0]));
  if(known.size!==rows_(sh).filter(r=>r[0]).length)throw new Error('Duplicate Cycle ID in Completion History.');
  state.cycles.filter(c=>c.status==='Completed' && !known.has(c.id)).forEach(c=>{
    sh.appendRow([c.id,c.taskId,c.employee,date_(c.completed),c.completedBy,String(c.proof)]);known.add(c.id);
  });
  if(sh.getLastRow()>1)sh.getRange(2,4,sh.getLastRow()-1,1).setNumberFormat('dd-mmm-yyyy hh:mm');
}
function syncEmployeePermissions_(state) {
  const sh=SpreadsheetApp.getActive().getSheetByName('Employee Tasks');
  const existing=sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).filter(p=>p.getDescription().startsWith('Employee input:'));
  const wanted=new Set();
  state.cycles.forEach(c=>{
    const t=state.tasks.find(t=>t.id===c.taskId),email=c.status==='Completed'?'':(t && realEmail(t.email)?t.email:'');
    const description='Employee input:'+c.id+':'+c._row+':'+email;wanted.add(description);
    if(existing.some(p=>p.getDescription()===description))return;
    const p=sh.getRange(c._row,8,1,2).protect().setDescription(description);p.removeEditors(p.getEditors());if(p.canDomainEdit())p.setDomainEdit(false);if(email)p.addEditor(email);
  });
  existing.filter(p=>!wanted.has(p.getDescription())).forEach(p=>p.remove());
}
function setSetting_(key,value) {
  const sh=SpreadsheetApp.getActive().getSheetByName('Settings'),rows=sh.getDataRange().getValues(),i=rows.findIndex(r=>r[0]===key);
  if(i<0)sh.appendRow([key,value,'']);else sh.getRange(i+1,2).setValue(value);
}
function prepareTimedDemo() {
  const settings=config_(),state=readState_();
  if(state.tasks.some(t=>t.active && t.id.startsWith('DEMO-RUN-')))throw new Error('Stop the existing timed demo before creating another.');
  if(settings.demoMode==='LIVE' && !realEmail(settings.demoInbox))throw new Error('Set Demo test inbox to your approved test email first.');
  if(!(settings.demoAckMinutes>0 && settings.demoResolveMinutes>settings.demoAckMinutes))throw new Error('Demo resolution minutes must exceed positive acknowledgement minutes.');
  const now=new Date(),due=new Date(now.getTime()+120000),day=localDay(due),time=Utilities.formatDate(due,'Asia/Kolkata','HH:mm'),prefix='DEMO-RUN-'+now.getTime();
  const sh=SpreadsheetApp.getActive().getSheetByName('Task Master');
  ['Complete after manager alert','No manager acknowledgement','Acknowledged but still unresolved'].forEach((label,i)=>sh.appendRow([prefix+'-'+(i+1),'Demo: '+label,'Employee '+['B','C','D'][i],settings.demoInbox,'Every 7 days',7,day,time,'Ticket ID',true]));
  const props=PropertiesService.getDocumentProperties();props.setProperty('PRE_DEMO_INTERVAL',String(settings.interval));
  setSetting_('Automation interval minutes',1);setup();
  SpreadsheetApp.getActive().toast('Three demo tasks due '+day+' '+time+' IST. Demo email mode: '+settings.demoMode+'. Use Stop timed demo afterwards.');
}
function stopTimedDemo() {
  const sh=SpreadsheetApp.getActive().getSheetByName('Task Master');rows_(sh).forEach((r,i)=>{if(String(r[0]).startsWith('DEMO-RUN-'))sh.getRange(i+2,10).setValue(false);});
  const props=PropertiesService.getDocumentProperties();setSetting_('Automation interval minutes',Number(props.getProperty('PRE_DEMO_INTERVAL')||15));props.deleteProperty('PRE_DEMO_INTERVAL');setSetting_('Demo email mode','DRY_RUN');setup();
}
function checkInstallation() {
  const ss=SpreadsheetApp.getActive(),s=readState_(),cfg=config_(),triggers=ScriptApp.getProjectTriggers(),rows=[['Check','Result','Detail']];
  const add=(name,pass,detail)=>rows.push([name,pass?'PASS':'NEEDS ACTION',detail]);
  add('Spreadsheet time zone',ss.getSpreadsheetTimeZone()==='Asia/Kolkata',ss.getSpreadsheetTimeZone());
  try {validateState(s,cfg);add('Task and record validation',true,'Dates, frequencies, holidays and unique IDs checked.');}catch(e){add('Task and record validation',false,e.message);}
  add('Manager email',realEmail(cfg.manager),realEmail(cfg.manager)?'Real email configured.':'Replace placeholder.');
  add('Leadership email',cfg.leadership.split(',').every(e=>realEmail(e.trim())),'Use approved recipient addresses.');
  add('Employee email permissions',s.tasks.filter(t=>t.active).every(t=>realEmail(t.email)),'Configure real employee emails, share as editors, then run setup.');
  add('Time trigger',triggers.filter(t=>t.getHandlerFunction()==='processTasks').length===1,'Expected exactly one scheduler for this installer.');
  add('Edit trigger',triggers.filter(t=>t.getHandlerFunction()==='handleEdit').length===1,'Expected exactly one edit trigger for this installer.');
  add('Email quota',MailApp.getRemainingDailyQuota()>0,String(MailApp.getRemainingDailyQuota())+' recipients remaining for this account.');
  add('Uncertain sends',!s.alerts.some(a=>a.delivery==='SENDING'),'Check Sent mail before retrying a SENDING alert.');
  rows.push(['Actual inbox delivery','NOT VERIFIED','SENT means MailApp accepted the call. Confirm the email in the test inbox.']);
  const sh=ss.getSheetByName('Setup Check')||ss.insertSheet('Setup Check');sh.clearContents();sh.getRange(1,1,rows.length,3).setValues(rows);sh.getRange(1,1,rows.length,3).setFontFamily('Arial').setFontSize(11).setFontWeight('normal').setWrap(true);sh.setColumnWidths(1,2,220);sh.setColumnWidth(3,600);
  return rows;
}
function retryFailedEmails() {
  const lock=LockService.getDocumentLock();lock.waitLock(30000);
  try {const s=readState_();s.alerts.filter(a=>a.delivery==='FAILED').forEach(a=>{a.delivery='QUEUED';a.error='';});persistAlerts_(s);} finally {lock.releaseLock();}
  processTasks();
}

function runCoreTests() {
  const results=[],cfg={manager:'manager@example.com',leadership:'leadership@example.com',ackHours:2,resolveHours:24,holidays:[]};
  const make=(freq='Every 7 days',period=7,first='2026-10-07')=>({tasks:[{id:'TEST',task:'Test task',employee:'Employee B',frequency:freq,period:period,first:first,time:'18:00',proof:freq==='Daily'?'WhatsApp update text or screenshot link':'Ticket ID',active:true}],cycles:[],alerts:[]});
  const tick=(s,t)=>advance(s,t,cfg);
  const deliver=(s,t)=>s.alerts.filter(a=>a.delivery==='QUEUED').forEach(a=>{a.delivery='SIMULATED';a.sent=t;});
  const check=(name,condition,detail)=>{if(!condition) throw new Error('FAIL: '+name);results.push([name,'PASS',detail,'Local shared-engine simulation']);};
  [7,15,30].forEach(n=>{const s=make('Every '+n+' days',n);tick(s,'2026-10-07T17:00:00+05:30');s.cycles[0].proof='TKT-'+n;s.cycles[0].submit=true;tick(s,'2026-10-07T17:01:00+05:30');check('1. Recurring '+n+' days',s.cycles[0].status==='Completed' && s.cycles[1].id==='TEST|'+addDays('2026-10-07',n),'Current closed. Next due '+addDays('2026-10-07',n)+'.');});
  const s=make();tick(s,'2026-10-07T17:00:00+05:30');s.cycles[0].proof='TKT-101';s.cycles[0].submit=true;tick(s,'2026-10-07T17:02:00+05:30');check('2. Single-point completion',s.cycles[0].completed && s.cycles[0].proof==='TKT-101','One proof entry and Submit closes current cycle.');
  const d=make('Daily',1,'2026-10-09');tick(d,'2026-10-09T17:00:00+05:30');d.cycles[0].proof='Shared stock update in Operations group at 17:00';d.cycles[0].submit=true;tick(d,'2026-10-09T17:01:00+05:30');check('3. Daily completion',d.cycles[0].status==='Completed' && d.cycles[1].id==='TEST|2026-10-12','Friday completed with update text. Next cycle Monday.');
  const m=make();tick(m,'2026-10-07T18:00:00+05:30');check('7a. Deadline boundary',m.alerts.length===0,'No overdue email at exact deadline.');tick(m,'2026-10-07T18:01:00+05:30');deliver(m,'2026-10-07T18:01:00+05:30');check('4. Same-day manager alert',m.alerts.length===1 && m.alerts[0].level==='Manager','Manager notification simulated at 18:01 same day.');
  m.cycles[0].ack=true;m.cycles[0].note='Called employee. Finish by tomorrow 18:00.';tick(m,'2026-10-07T19:00:00+05:30');check('5. Manager acknowledgement',!!m.cycles[0].ackAt && m.cycles[0].status==='Overdue','Acknowledged at 19:00. Task remains overdue until employee completes.');
  tick(m,'2026-10-08T18:00:00+05:30');deliver(m,'2026-10-08T18:00:00+05:30');check('6a. Unresolved leadership escalation',m.alerts.filter(a=>a.level==='Leadership').length===1,'Acknowledged but still open at due plus 24 hours.');
  const a=make();tick(a,'2026-10-07T18:01:00+05:30');deliver(a,'2026-10-07T18:01:00+05:30');tick(a,'2026-10-07T20:00:00+05:30');check('7b. Acknowledgement boundary',a.alerts.length===1,'No escalation before two hours from notification.');tick(a,'2026-10-07T20:01:00+05:30');deliver(a,'2026-10-07T20:01:00+05:30');check('6b. Missing acknowledgement',a.alerts.length===2,'Leadership notification simulated at manager sent plus two hours.');
  const before=JSON.stringify([a.cycles.map(c=>c.id),a.alerts.map(x=>x.id)]);tick(a,'2026-10-07T20:01:00+05:30');tick(a,'2026-10-07T20:01:00+05:30');check('8. No duplicate cycles or alerts',before===JSON.stringify([a.cycles.map(c=>c.id),a.alerts.map(x=>x.id)]),'Repeated runs retain 2 cycles and 2 unique alerts.');
  const done=s.cycles[0].completed;tick(s,'2026-10-07T21:00:00+05:30');check('8b. No duplicate completion',s.cycles[0].completed===done && s.alerts.length===0,'Completion timestamp remains unchanged. No alert for completed work.');
  const invalid=make();tick(invalid,'2026-10-07T17:00:00+05:30');invalid.cycles[0].submit=true;tick(invalid,'2026-10-07T17:01:00+05:30');check('Additional. Missing proof',invalid.cycles[0].status==='Due' && !!invalid.cycles[0].error,'Blank proof rejected, cycle stays open.');
  const future=make();tick(future,'2026-10-07T17:00:00+05:30');future.cycles[1].submit=true;future.cycles[1].proof='TKT-FUTURE';tick(future,'2026-10-07T17:01:00+05:30');check('Additional. Future completion',future.cycles[1].status==='Upcoming' && !!future.cycles[1].error,'Future cycle submission rejected.');
  const closed=make();tick(closed,'2026-10-07T18:01:00+05:30');deliver(closed,'2026-10-07T18:01:00+05:30');closed.cycles[0].proof='TKT-DONE';closed.cycles[0].submit=true;tick(closed,'2026-10-07T19:00:00+05:30');tick(closed,'2026-10-08T19:00:00+05:30');check('Additional. Resolution cancels escalation',closed.alerts.length===1,'Completed after manager alert, before escalation. No leadership email.');
  const h=make('Daily',1,'2026-10-09');cfg.holidays=['2026-10-12'];tick(h,'2026-10-09T17:00:00+05:30');check('Additional. Holiday skip',h.cycles[1].id==='TEST|2026-10-13','Weekend and Monday holiday skipped.');cfg.holidays=[];
  const backlog=make('Every 7 days',7,'2026-09-23');tick(backlog,'2026-10-07T17:00:00+05:30');check('Additional. Missed cycle backlog',backlog.cycles.length===4 && backlog.cycles.filter(c=>c.status==='Overdue').length===2,'Missed cycles retained separately, plus current and next cycle.');
  const short=make('Daily',1);tick(short,'2026-10-07T17:00:00+05:30');short.cycles[0].proof='done';short.cycles[0].submit=true;tick(short,'2026-10-07T17:01:00+05:30');check('Daily evidence quality',short.cycles[0].status==='Due' && !!short.cycles[0].error,'A one-word daily attestation is rejected.');
  const stale=make();tick(stale,'2026-10-07T18:01:00+05:30');deliver(stale,'2026-10-07T18:01:00+05:30');tick(stale,'2026-10-07T20:01:00+05:30');stale.cycles[0].ack=true;stale.cycles[0].note='Manager reviewed before email delivery.';tick(stale,'2026-10-07T20:02:00+05:30');check('Stale leadership alert cancellation',stale.alerts[1].delivery==='CANCELLED','Queued acknowledgement escalation cancelled when manager reviews.');tick(stale,'2026-10-08T18:00:00+05:30');check('Resolution after cancelled alert',stale.alerts.length===2 && stale.alerts[1].delivery==='QUEUED' && stale.alerts[1].reason==='Task unresolved after resolution SLA','Same unique leadership ID reused when resolution SLA later fails.');
  const late=make();tick(late,'2026-10-08T17:00:00+05:30');late.cycles[0].proof='TKT-LATE';late.cycles[0].submit=true;tick(late,'2026-10-08T17:01:00+05:30');check('Late completion preserves schedule',late.cycles[1].id==='TEST|2026-10-14','Completion on 8 October keeps next scheduled due on 14 October.');
  const badTicket=make();tick(badTicket,'2026-10-07T17:00:00+05:30');badTicket.cycles[0].proof='not a ticket';badTicket.cycles[0].submit=true;tick(badTicket,'2026-10-07T17:01:00+05:30');check('Ticket format validation',badTicket.cycles[0].status==='Due' && !!badTicket.cycles[0].error,'Ticket with spaces rejected before completion.');
  const mustThrow=(name,fn,detail)=>{let threw=false;try{fn();}catch(e){threw=true;}check(name,threw,detail);};
  const impossible=make('Every 7 days',7,'2026-02-30');mustThrow('Invalid calendar date',()=>tick(impossible,'2026-10-07T17:00:00+05:30'),'30 February rejected instead of silently rolling into March.');
  const mismatch=make('Every 7 days',15);mustThrow('Frequency mismatch',()=>tick(mismatch,'2026-10-07T17:00:00+05:30'),'7 day label with 15 day period rejected.');
  const duplicateTask=make();duplicateTask.tasks.push(Object.assign({},duplicateTask.tasks[0]));mustThrow('Duplicate task IDs',()=>tick(duplicateTask,'2026-10-07T17:00:00+05:30'),'Duplicate master ID stops the run before creation.');
  const duplicateCycle=make();tick(duplicateCycle,'2026-10-07T17:00:00+05:30');duplicateCycle.cycles.push(Object.assign({},duplicateCycle.cycles[0]));mustThrow('Duplicate cycle IDs',()=>tick(duplicateCycle,'2026-10-07T17:00:00+05:30'),'Duplicate cycle stops the run.');
  const duplicateAlert=make();tick(duplicateAlert,'2026-10-07T18:01:00+05:30');duplicateAlert.alerts.push(Object.assign({},duplicateAlert.alerts[0]));mustThrow('Duplicate alert IDs',()=>tick(duplicateAlert,'2026-10-07T18:02:00+05:30'),'Duplicate alert stops the run before delivery.');
  const paused=make();tick(paused,'2026-10-07T18:01:00+05:30');paused.tasks[0].active=false;tick(paused,'2026-10-07T18:02:00+05:30');check('Inactive task cancels unsent alert',paused.alerts[0].delivery==='CANCELLED','Deactivated task does not send an already queued message.');
  check('Email validation',realEmail('manager@company.com') && !realEmail('manager@example.com') && !realEmail('test@company.invalid') && !realEmail('not an email'),'Placeholder, reserved and malformed recipients rejected.');
  const demo=make();demo.tasks[0].id='DEMO-RUN-TEST';cfg.demoInbox='test@company.com';cfg.demoAckMinutes=1;cfg.demoResolveMinutes=3;tick(demo,'2026-10-07T18:01:00+05:30');deliver(demo,'2026-10-07T18:01:00+05:30');tick(demo,'2026-10-07T18:02:00+05:30');check('Timed demonstration routing',demo.alerts.length===2 && demo.alerts.every(a=>a.to==='test@company.com'),'Demo-only inbox and one-minute acknowledgement SLA used. Normal SLA stays unchanged.');
  return results;
}
function runDemoTests() {
  const r=runCoreTests();const sh=SpreadsheetApp.getActive().getSheetByName('Test Cases');
  sh.clearContents();sh.getRange(1,1,r.length+1,4).setValues([['Test','Result','Observed result','Execution method']].concat(r));
  SpreadsheetApp.getActive().toast(r.length+' isolated engine tests passed. No emails were sent.');
}
