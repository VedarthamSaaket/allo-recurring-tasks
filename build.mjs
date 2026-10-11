import fs from 'node:fs/promises';
import vm from 'node:vm';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const out='/Users/darthiedarte/outputs/recurring-task-automation';
const source=await fs.readFile(out+'/Automation.gs','utf8');
const ctx={};vm.createContext(ctx);vm.runInContext(source,ctx);
const tests=ctx.runCoreTests();
const headers=name=>vm.runInContext(name,ctx);
const settings={manager:'manager@example.com',leadership:'leadership@example.com',ackHours:2,resolveHours:24,holidays:[]};
const tasks=[
 {id:'DAILY-01',task:'Daily Operations Update',employee:'Employee A',email:'employee.a@example.com',frequency:'Daily',period:1,first:'2026-10-07',time:'18:00',proof:'WhatsApp update text or screenshot link',active:true},
 {id:'PORTAL-07',task:'Portal Task A',employee:'Employee B',email:'employee.b@example.com',frequency:'Every 7 days',period:7,first:'2026-09-30',time:'18:00',proof:'Ticket ID',active:true},
 {id:'PORTAL-15',task:'Portal Task B',employee:'Employee C',email:'employee.c@example.com',frequency:'Every 15 days',period:15,first:'2026-10-07',time:'18:00',proof:'Ticket ID',active:true},
 {id:'PORTAL-30',task:'Portal Task C',employee:'Employee D',email:'employee.d@example.com',frequency:'Every 30 days',period:30,first:'2026-10-07',time:'18:00',proof:'Ticket ID',active:true},
 {id:'DEMO-ACK',task:'Demo: manager review missed',employee:'Employee B',email:'employee.b@example.com',frequency:'Every 7 days',period:7,first:'2026-10-07',time:'14:00',proof:'Ticket ID',active:true},
 {id:'DEMO-OPEN',task:'Demo: unresolved after 24 hours',employee:'Employee C',email:'employee.c@example.com',frequency:'Every 15 days',period:15,first:'2026-10-06',time:'16:00',proof:'Ticket ID',active:true}
];
const completed=ctx.newCycle(tasks[1],'2026-09-30');
Object.assign(completed,{status:'Completed',proof:'TKT-1001',completed:'2026-09-30T17:20:00+05:30',completedBy:'Employee B'});
const ack=ctx.newCycle(tasks[4],'2026-10-07');
const unresolved=ctx.newCycle(tasks[5],'2026-10-06');
Object.assign(unresolved,{ack:true,note:'Spoke to employee. Portal access issue being checked.',ackAt:'2026-10-06T17:00:00+05:30',ackBy:settings.manager});
const alert=(c,level,reason,t)=>({id:c.id+'|'+level,cycleId:c.id,level,reason,to:level==='Manager'?settings.manager:settings.leadership,created:t,delivery:'SIMULATED',sent:t,error:''});
const state={tasks,cycles:[completed,ack,unresolved],alerts:[alert(ack,'Manager','Task remains incomplete after deadline','2026-10-07T14:01:00+05:30'),alert(unresolved,'Manager','Task remains incomplete after deadline','2026-10-06T16:01:00+05:30')]};
ctx.advance(state,'2026-10-07T17:00:00+05:30',settings);
state.alerts.forEach(a=>{if(a.delivery==='QUEUED'){a.delivery='SIMULATED';a.sent='2026-10-07T17:00:00+05:30';}const c=state.cycles.find(c=>c.id===a.cycleId);if(a.level==='Manager')c.managerAt=a.sent;else c.leaderAt=a.sent;});
state.cycles.sort((a,b)=>Date.parse(a.due)-Date.parse(b.due));
const localDate=iso=>iso?new Date(Date.parse(iso)+330*60000):null;
const date=d=>new Date(d+'T00:00:00Z');
const workRows=state.cycles.map(c=>[c.id,c.taskId,c.task,c.employee,localDate(c.due),c.status,c.required,c.proof,c.submit,localDate(c.completed),c.completedBy,c.ack,c.note,localDate(c.ackAt),c.ackBy,localDate(c.managerAt),localDate(c.leaderAt),c.error]);
const sheets={
 'Employee Tasks':[headers('WORK_HEADERS'),...workRows],
 'Manager Review':[
 ['Assigned to','Due','Overdue','Completed','Manager review outstanding','Leadership alerted'],
 ...['Employee A','Employee B','Employee C','Employee D'].map(n=>[n,null,null,null,null,null]),
 ['Total',null,null,null,null,null],
 ['Review overdue tasks below. Enter the Cycle ID in a filter on Employee Tasks, add your action in M and tick L.'],
 ['The detail below is a saved demo snapshot. Google Sheets setup replaces it with a live FILTER view.'],
 headers('WORK_HEADERS'),
 ...workRows.filter(r=>r[5]==='Overdue')
 ],
 'Task Master':[headers('TASK_HEADERS'),...tasks.map(t=>[t.id,t.task,t.employee,t.email,t.frequency,t.period,date(t.first),t.time,t.proof,t.active])],
 'Settings':[
 ['Setting','Value','Meaning'],
 ['Manager email',settings.manager,'Replace with manager email before live testing.'],
 ['Leadership email',settings.leadership,'Replace with leadership email. Comma-separated recipients allowed.'],
 ['Acknowledgement hours',2,'Elapsed hours from manager email delivery.'],
 ['Resolution hours',24,'Elapsed hours from task deadline.'],
 ['Email mode','DRY_RUN','DRY_RUN logs simulated alerts. LIVE sends email.'],
 ['Holidays','','Comma-separated yyyy-mm-dd dates. Applies to Daily tasks only.'],
 ['Time zone','Asia/Kolkata','Fixed IST in this prototype. setup sets spreadsheet time zone.'],
 ['Demo as of',localDate('2026-10-07T17:00:00+05:30'),'Saved example data. Automation uses current time after installation.'],
 ['Schedule rule','Fixed due-date cadence','7, 15 and 30 day tasks use calendar days, measured from previous scheduled due date.'],
 ['Daily workdays','Monday to Friday','Weekends and Settings holidays skipped.'],
 ['Automation interval minutes',15,'Allowed: 1, 5, 10, 15 or 30. Run setup after changing. Timed demo uses 1 minute.'],
 ['Live email tested','No','31 engine tests and mocked adapter checks passed. Live Google verification is pending.'],
 ['Demo test inbox','','Use your approved test inbox for both demo manager and leadership messages.'],
 ['Demo email mode','DRY_RUN','Only DEMO-RUN tasks use this mode and test inbox. Normal email mode is separate.'],
 ['Demo acknowledgement minutes',1,'Timed demo only. Normal acknowledgement stays at 2 hours.'],
 ['Demo resolution minutes',3,'Timed demo only. Normal resolution stays at 24 hours.']
 ],
 'Alert Log':[headers('ALERT_HEADERS'),...state.alerts.map(a=>[a.id,a.cycleId,a.level,a.reason,a.to,localDate(a.created),a.delivery,localDate(a.sent),a.error])],
 'Completion History':[headers('HISTORY_HEADERS'),...state.cycles.filter(c=>c.status==='Completed').map(c=>[c.id,c.taskId,c.employee,localDate(c.completed),c.completedBy,c.proof])],
 'Setup Check':[
 ['Check','Result','Detail'],
 ['Google installation','NOT RUN','Import into Google Sheets and install the script.'],
 ['Time zone and inputs','NOT RUN','Recurring tasks > Check installation verifies these in Google.'],
 ['Edit and time triggers','NOT RUN','The check expects one of each for the installer.'],
 ['Employee permissions','NOT RUN','Set real employee emails, share as editors and run setup.'],
 ['Live inbox delivery','NOT VERIFIED','Confirm manager and leadership messages in the test inbox.'],
 ['Local engine tests','PASS',tests.length+' executed cases. Results are in Test Cases.'],
 ['Local adapter checks','PASS','Mock sheets, mail, permissions, history and repeat-run checks passed.'],
 ['Purpose','Read before submission','This sheet separates executed local tests from Google checks still to be done.']
 ],
 'Test Cases':[['Test','Result','Observed result','Execution method'],...tests],
 'Instructions':[
 ['Item','Instructions'],
 ['Employee pending list','Use Employee Tasks. Filter Assigned to and Status = Due or Overdue. Use a personal filter view in Google Sheets so other employees are unaffected.'],
 ['Ticket task','Complete the portal action first. Enter the Ticket ID in H, then tick Submit in I. The script timestamps completion and closes this cycle.'],
 ['Daily task','After posting to the WhatsApp group, paste the short update text or a screenshot link in H and tick I. Completion time is recorded automatically.'],
 ['Proof limitation','Daily text must contain at least 12 characters. Short yes or done entries are rejected. WhatsApp and portal evidence still needs human review.'],
 ['Minimum daily effort','One short proof entry and one checkbox. If screenshots are used, share the Drive link with the manager. No second completion register.'],
 ['Current and next cycles','Each task has a unique Task ID plus scheduled date Cycle ID. One future cycle is prepared. Earlier unfinished cycles remain pending. Completing late never moves the schedule.'],
 ['Manager monitoring','Manager Review shows counts for every employee and an overdue detail view. Manager works on the matching row in Employee Tasks for acknowledgement and action.'],
 ['Manager action','Read the alert, contact the employee, enter the follow-up action in M and tick L. N records acknowledgement time. Acknowledgement does not complete the task.'],
 ['Acknowledgement record','Manager input columns are protected for the configured manager and script installer after setup. Acknowledged by records the configured manager email.'],
 ['Employee permissions','After setup, H and I are restricted to the assigned employee email and owner. Completed rows are locked for employees. Completed by records the assigned employee, not a verified login.'],
 ['SLA: first alert','For a usual 18:00 deadline, the first successful 15 minute scheduler run after 18:00 queues one manager email per overdue cycle, on the same day under normal trigger operation.'],
 ['SLA: leadership','Escalate once if no acknowledgement 2 elapsed hours after manager email delivery, or the task stays open 24 elapsed hours after deadline. Use whichever condition is reached first.'],
 ['SLA reasoning','Two hours gives the manager time to notice and assign follow-up. One day allows resolution of portal issues. Calendar hours keep unresolved items visible even across weekends.'],
 ['Timing limitation','Apps Script triggers are not exact-time delivery guarantees. An outage, quota exhaustion or failure can delay a message. Monitor Apps Script Executions and Alert Log.'],
 ['Duplicate controls','Document lock serializes runs. Cycle and alert IDs are checked before insertion. Completed cycles keep the first timestamp. One manager and one leadership alert per cycle.'],
 ['Uncertain delivery','An email send marked SENDING is not automatically resent. Check Sent mail and recipient inbox first. This prevents duplicate retries after an uncertain send.'],
 ['Failed delivery','FAILED means send was not attempted due to invalid recipient or quota. Correct the cause, then use Recurring tasks > Retry FAILED emails. Completed cycles cancel queued alerts.'],
 ['Import','Upload the xlsx to Google Drive, open it with Google Sheets and use File > Save as Google Sheets. Apps Script is not embedded in the xlsx.'],
 ['Install script','Open Extensions > Apps Script. Replace Code.gs with Automation.gs contents. Save. Set project time zone to Asia/Kolkata.'],
 ['Set up','Keep Email mode DRY_RUN. Run setup from Apps Script as the sheet owner and authorize Google permissions. Reload the sheet to see the Recurring tasks menu.'],
 ['Installed automation','setup creates one installable edit trigger and one 15 minute time trigger for this installer. Run setup again safely as the same installer. Only one owner should install triggers.'],
 ['Edit behaviour','Proof and checkbox edits are processed by an installable trigger. Refresh / process updates is available if a checkbox is waiting or you need to inspect a validation error.'],
 ['Run the supplied tests','Use Recurring tasks > Run isolated demo tests. It runs '+tests.length+' engine cases without sending email or changing Employee Tasks.'],
 ['Live email demonstration','Use a separate copy. Set Demo test inbox and Demo email mode = LIVE. Prepare timed demo creates three fresh tasks with a 1 minute acknowledgement SLA and 3 minute resolution SLA.'],
 ['Before real use','Clear Employee Tasks and Alert Log demo data. Delete DEMO-ACK and DEMO-OPEN from Task Master. Set the four real first due dates and emails. Keep Task IDs stable, then run setup.'],
 ['Changing schedule','Change frequency / period for future operation carefully. Existing cycle due dates are preserved. Create a new Task ID and deactivate the old task if the schedule is being replaced.'],
 ['Inactive tasks','Active = FALSE stops new cycles and alerts. Existing open records stay visible for manager review.'],
 ['Excel behaviour','The xlsx is a plain editable template and saved demonstration. Recurrence, timestamps, checkboxes and email automation operate after Apps Script installation in Google Sheets.'],
 ['Source: installable triggers','https://developers.google.com/apps-script/guides/triggers/installable'],
 ['Source: service quotas','https://developers.google.com/apps-script/guides/services/quotas'],
 ['Source: MailApp','https://developers.google.com/apps-script/reference/mail/mail-app'],
 ['Completion history','Accepted proof and timestamp are copied automatically to the protected Completion History. The employee updates only Employee Tasks. Later edits cannot overwrite that history.'],
 ['Check installation','Recurring tasks > Check installation checks settings, recipients, IDs, trigger counts, quota and uncertain sends. Confirm actual email delivery separately.'],
 ['Stop timed demo','Use Recurring tasks > Stop timed demo afterwards. It deactivates demo tasks, keeps the evidence and restores the prior scheduler interval.'],
 ['Google Sheet visibility','All editors can view task data and the bound script. Input protections prevent ordinary editing mistakes. Personal filters do not provide data privacy.'],
 ['Source: sheet protection','https://developers.google.com/apps-script/reference/spreadsheet/protection']
 ]
};
const wb=Workbook.create();
for(const name of Object.keys(sheets))wb.worksheets.add(name);
for(const [name,rows] of Object.entries(sheets)){
 const sh=wb.worksheets.getItem(name),width=Math.max(...rows.map(r=>r.length));
 const matrix=rows.map(r=>Array.from({length:width},(_,i)=>r[i]??null));
 sh.getRangeByIndexes(0,0,matrix.length,width).values=matrix;
 const range=sh.getRangeByIndexes(0,0,matrix.length,width);
 range.format.font={name:'Arial',size:11,bold:false,color:'#000000'};
 range.format.verticalAlignment='top';range.format.rowHeight=22;range.format.columnWidth=22;
 sh.showGridLines=true;sh.freezePanes.freezeRows(1);
 if(name==='Employee Tasks' || name==='Manager Review') {
   sh.getRange('A:A').format.columnWidth=29;sh.getRange('B:B').format.columnWidth=16;
   sh.getRange('C:C').format.columnWidth=35;sh.getRange('D:D').format.columnWidth=17;
   sh.getRange('E:E').format.columnWidth=23;sh.getRange('G:H').format.columnWidth=36;
   sh.getRange('J:J').format.columnWidth=23;sh.getRange('M:M').format.columnWidth=42;
   sh.getRange('N:N').format.columnWidth=23;sh.getRange('P:Q').format.columnWidth=23;
   sh.getRange('R:R').format.columnWidth=32;
   range.format.wrapText=true;range.format.rowHeight=44;
   const first=name==='Employee Tasks'?2:10;
   if(rows.length>=first){for(const col of ['E','J','N','P','Q'])sh.getRange(`${col}${first}:${col}${rows.length}`).setNumberFormat('dd-mmm-yyyy hh:mm');}
 } else if(name==='Task Master'){
   sh.getRange('B:B').format.columnWidth=36;sh.getRange('D:D').format.columnWidth=32;sh.getRange('I:I').format.columnWidth=40;
   sh.getRange('G2:G7').setNumberFormat('dd-mmm-yyyy');range.format.wrapText=true;range.format.rowHeight=42;
   sh.getRange('E2:E200').dataValidation={rule:{type:'list',values:['Daily','Every 7 days','Every 15 days','Every 30 days']}};
   sh.getRange('J2:J200').dataValidation={rule:{type:'list',values:['TRUE','FALSE']}};
 } else if(name==='Settings'){
   sh.getRange('A:A').format.columnWidth=31;sh.getRange('B:B').format.columnWidth=36;sh.getRange('C:C').format.columnWidth=75;
   range.format.wrapText=true;range.format.rowHeight=42;
   sh.getRange('B9').setNumberFormat('dd-mmm-yyyy hh:mm');
   sh.getRange('B6').dataValidation={rule:{type:'list',values:['DRY_RUN','LIVE']}};
 } else if(name==='Alert Log'){
   sh.getRange('A:B').format.columnWidth=35;sh.getRange('D:D').format.columnWidth=44;sh.getRange('E:E').format.columnWidth=34;
   sh.getRange('F:F').format.columnWidth=23;sh.getRange('H:H').format.columnWidth=23;
   sh.getRange('F2:F5').setNumberFormat('dd-mmm-yyyy hh:mm');sh.getRange('H2:H5').setNumberFormat('dd-mmm-yyyy hh:mm');
   range.format.wrapText=true;range.format.rowHeight=44;
 } else if(name==='Completion History'){
   sh.getRange('A:A').format.columnWidth=30;sh.getRange('B:C').format.columnWidth=22;
   sh.getRange('D:D').format.columnWidth=24;sh.getRange('E:E').format.columnWidth=24;sh.getRange('F:F').format.columnWidth=50;
   sh.getRange('D2:D2').setNumberFormat('dd-mmm-yyyy hh:mm');range.format.wrapText=true;range.format.rowHeight=36;
 } else if(name==='Setup Check'){
   sh.getRange('A:A').format.columnWidth=30;sh.getRange('B:B').format.columnWidth=21;sh.getRange('C:C').format.columnWidth=90;
   range.format.wrapText=true;range.format.rowHeight=42;
 } else if(name==='Test Cases'){
   sh.getRange('A:A').format.columnWidth=43;sh.getRange('B:B').format.columnWidth=12;sh.getRange('C:C').format.columnWidth=80;sh.getRange('D:D').format.columnWidth=36;
   range.format.wrapText=true;range.format.rowHeight=42;
 } else if(name==='Instructions'){
   sh.getRange('A:A').format.columnWidth=31;sh.getRange('B:B').format.columnWidth=112;
   range.format.wrapText=true;range.format.rowHeight=48;
 }
}
const mgr=wb.worksheets.getItem('Manager Review');
for(let r=2;r<=5;r++){
 mgr.getRange(`B${r}:F${r}`).formulas=[[
  `=COUNTIFS('Employee Tasks'!$D$2:$D$5000,$A${r},'Employee Tasks'!$F$2:$F$5000,"Due")`,
  `=COUNTIFS('Employee Tasks'!$D$2:$D$5000,$A${r},'Employee Tasks'!$F$2:$F$5000,"Overdue")`,
  `=COUNTIFS('Employee Tasks'!$D$2:$D$5000,$A${r},'Employee Tasks'!$F$2:$F$5000,"Completed")`,
  `=C${r}-COUNTIFS('Employee Tasks'!$D$2:$D$5000,$A${r},'Employee Tasks'!$F$2:$F$5000,"Overdue",'Employee Tasks'!$N$2:$N$5000,">0")`,
  `=COUNTIFS('Employee Tasks'!$D$2:$D$5000,$A${r},'Employee Tasks'!$F$2:$F$5000,"Overdue",'Employee Tasks'!$Q$2:$Q$5000,">0")`
 ]];
}
mgr.getRange('B6:F6').formulas=[['=SUM(B2:B5)','=SUM(C2:C5)','=SUM(D2:D5)','=SUM(E2:E5)','=SUM(F2:F5)']];
mgr.getRange('A1:F6').format.columnWidth=26;mgr.getRange('A1:F6').format.rowHeight=44;
mgr.getRange('A7').format.rowHeight=58;mgr.getRange('A8').format.rowHeight=58;
// Keep the two plain instructions readable across otherwise empty columns.
mgr.getRange('A7').values=[['Acknowledge in Employee Tasks columns L and M.']];
mgr.getRange('B7:F7').values=[['Find the matching Cycle ID.','Enter manager action in M.','Tick acknowledgement in L.','Task stays open until completed.','']];
mgr.getRange('A8:F8').values=[['Saved demo detail below.','Google setup replaces it','with a live overdue view.','','','']];
wb.recalculate();
if(mgr.getRange('E6').values[0][0]!==1)throw new Error('Expected one outstanding manager review.');
// Verify the summary reacts to a new acknowledgement, then restore the saved demo.
const work=wb.worksheets.getItem('Employee Tasks');
const ackRow=state.cycles.findIndex(c=>c.id==='DEMO-ACK|2026-10-07')+2;
work.getRange(`N${ackRow}`).values=[[localDate('2026-10-07T17:00:00+05:30')]];
wb.recalculate();
if(mgr.getRange('E6').values[0][0]!==0)throw new Error('Manager summary failed acknowledgement recalculation.');
work.getRange(`N${ackRow}`).values=[[null]];wb.recalculate();
const inspect=await wb.inspect({kind:'table',range:'Manager Review!A1:F6',include:'values,formulas',tableMaxRows:6,tableMaxCols:6,maxChars:3000});
console.log(inspect.ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:40},summary:'Formula errors'});
console.log(errors.ndjson);
for(const name of Object.keys(sheets)){
 const width=name==='Employee Tasks'||name==='Manager Review'||name==='Completion History'?6:name==='Task Master'?5:name==='Alert Log'?5:name==='Test Cases'?4:name==='Settings'||name==='Setup Check'?3:2;
 const last=Math.min(sheets[name].length,name==='Instructions'?8:12);
 const col=String.fromCharCode(64+width);
 const preview=await wb.render({sheetName:name,range:`A1:${col}${last}`,scale:1,format:'png'});
 await fs.writeFile(out+'/preview-'+name.replaceAll(' ','-')+'.png',new Uint8Array(await preview.arrayBuffer()));
}
for(const [name,range,suffix] of [
 ['Employee Tasks','G1:R8','inputs'],
 ['Task Master','F1:J7','schedule'],
 ['Alert Log','F1:I5','delivery'],
 ['Instructions','A9:B19','instructions-middle'],
 ['Instructions','A20:B32','instructions-end'],
 ['Instructions','A33:B37','instructions-new'],
 ['Test Cases','A20:D32','extended-tests'],
 ['Settings','A13:C17','demo-settings']
]){
 const preview=await wb.render({sheetName:name,range,scale:1,format:'png'});
 await fs.writeFile(out+'/preview-'+suffix+'.png',new Uint8Array(await preview.arrayBuffer()));
}
const file=await SpreadsheetFile.exportXlsx(wb);await file.save(out+'/Recurring_Tasks.xlsx');
await fs.writeFile(out+'/test-results.json',JSON.stringify(tests,null,2));
await fs.writeFile(out+'/demo-state.json',JSON.stringify(state,null,2));
console.log('Saved workbook. '+tests.length+' engine tests passed. '+state.cycles.length+' cycles, '+state.alerts.length+' simulated alerts.');
