import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=await fs.readFile('Automation.gs','utf8');
const ctx={Date,console};vm.createContext(ctx);vm.runInContext(source,ctx);
const value=name=>vm.runInContext(name,ctx);
class Sheet {
 constructor(name,rows){this.name=name;this.rows=rows;this.maxRows=100;this.protections=[];}
 getProtections(){return this.protections;}
 getName(){return this.name;}
 getSheetId(){return 123;}
 getLastRow(){for(let i=this.rows.length-1;i>=0;i--)if(this.rows[i]?.some(v=>v!=='' && v!==undefined && v!==null))return i+1;return 0;}
 getLastColumn(){return Math.max(1,...this.rows.map(r=>r.length));}
 setFrozenRows(){return this;}
 setColumnWidths(){return this;}
 setColumnWidth(){return this;}
 clearContents(){this.rows=[];return this;}
 getFilter(){return this.filter||null;}
 protect(){return this.getRange(1,1).protect();}
 getMaxRows(){return this.maxRows;}
 insertRowsAfter(_,count){this.maxRows+=count;}
 getDataRange(){return this.getRange(1,1,this.getLastRow(),this.getLastColumn());}
 appendRow(row){this.rows.push(row);}
 getRange(row,col,height=1,width=1){
   if(typeof row==='string'){
     const m=row.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+)?)?$/);assert.ok(m,'Valid A1 range');
     const column=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
     col=column(m[1]);row=Number(m[2]);width=m[3]?column(m[3])-col+1:1;height=m[3]?(m[4]?Number(m[4])-row+1:this.maxRows-row+1):1;
   }
   const sh=this;
   return {
     getValues(){return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>sh.rows[row+i-1]?.[col+j-1]??''));},
     setValues(values){for(let i=0;i<height;i++){sh.rows[row+i-1]??=[];for(let j=0;j<width;j++)sh.rows[row+i-1][col+j-1]=values[i][j];}return this;},
     setValue(v){return this.setValues([[v]]);},
     setFormula(v){return this.setValue(v);},
     setFormulas(v){return this.setValues(v);},
     clearContent(){return this.setValues(Array.from({length:height},()=>Array(width).fill('')));},
     createFilter(){sh.filter={remove(){sh.filter=null;}};return sh.filter;},
     setFontFamily(){return this;},setFontSize(){return this;},setFontWeight(){return this;},setWrap(){return this;},
     setDataValidation(){return this;},
     setNumberFormat(){return this;},
     protect(){const p={description:'',editors:[],setDescription(v){this.description=v;return this;},getDescription(){return this.description;},getEditors(){return this.editors;},removeEditors(){this.editors=[];return this;},canDomainEdit(){return false;},setDomainEdit(){return this;},addEditor(v){this.editors.push(v);return this;},setUnprotectedRanges(v){this.unprotected=v;return this;},remove(){sh.protections=sh.protections.filter(x=>x!==this);}};sh.protections.push(p);return p;}
   };
 }
}
const today=ctx.localDay(new Date().toISOString());
const sheets={
 'Settings':new Sheet('Settings',[['Setting','Value'],['Manager email','manager@acme-test.com'],['Leadership email','leader@acme-test.com'],['Acknowledgement hours',2],['Resolution hours',24],['Email mode','LIVE'],['Holidays','']]),
 'Task Master':new Sheet('Task Master',[value('TASK_HEADERS'),['T7','Portal task','Employee B','b@acme-test.com','Every 7 days',7,today,'00:01','Ticket ID',true]]),
 'Employee Tasks':new Sheet('Employee Tasks',[value('WORK_HEADERS')]),
 'Alert Log':new Sheet('Alert Log',[value('ALERT_HEADERS')])
};
let sendCount=0;
const ss={getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=new Sheet(n,[]),getSpreadsheetTimeZone:()=> 'Asia/Kolkata',setSpreadsheetTimeZone(){},toast(){},getUrl:()=> 'https://sheets.test.invalid/prototype'};
ctx.SpreadsheetApp={getActive:()=>ss,flush(){},ProtectionType:{RANGE:'RANGE',SHEET:'SHEET'},newDataValidation:()=>({requireCheckbox(){return this;},build(){return {};}})};
ctx.LockService={getDocumentLock:()=>({waitLock(){},releaseLock(){}})};
ctx.Utilities={formatDate:(date,tz,format)=>{const d=new Date(date.getTime()+330*60000).toISOString();return format==='yyyy-MM-dd'?d.slice(0,10):format==='HH:mm'?d.slice(11,16):d.slice(0,10)+' '+d.slice(11,16);}};
ctx.MailApp={getRemainingDailyQuota:()=>100,sendEmail:message=>{assert.equal(message.to,'manager@acme-test.com');assert.ok(message.body.includes('#gid=123&range=A2:R2'));assert.ok(message.body.includes('Acknowledgement deadline:'));sendCount++;}};
ctx.processTasks();
assert.equal(sendCount,1,'Live adapter invokes MailApp once');
assert.equal(sheets['Employee Tasks'].rows.length,3,'Current and next cycles persisted');
assert.equal(sheets['Alert Log'].rows[1][6],'SENT','Delivery result persisted');
ctx.processTasks();ctx.processTasks();
assert.equal(sendCount,1,'Repeat scheduler does not invoke MailApp again');
assert.equal(sheets['Alert Log'].rows.length,2,'No duplicate log');
const row=sheets['Employee Tasks'].rows[1];
row[11]=true;row[12]='Contacted employee';ctx.processTasks();
assert.ok(row[13] instanceof Date,'Acknowledgement timestamp persisted');
assert.equal(row[11],true,'Checkbox validation does not clear acknowledgement');
row[7]='TKT-ADAPTER-1';row[8]=true;ctx.processTasks();
assert.equal(row[5],'Completed','Single-point proof and submit complete the cycle');
assert.equal(row[7],'TKT-ADAPTER-1','Proof preserved');
assert.equal(row[8],false,'Submit cleared after processing');
assert.ok(row[9] instanceof Date,'Completion timestamp persisted');
const completedAt=row[9].getTime();ctx.processTasks();
assert.equal(row[9].getTime(),completedAt,'Repeat run preserves timestamp');
assert.equal(sendCount,1,'Completed work does not send another alert');
assert.equal(sheets['Completion History'].rows.length,2,'One automatic completion history entry');
assert.equal(sheets['Completion History'].rows[1][5],'TKT-ADAPTER-1','Accepted proof is preserved in history');
const permissions=sheets['Employee Tasks'].protections;
assert.equal(permissions.length,2,'One input protection for each cycle, no duplicates');
assert.ok(permissions.some(p=>p.editors.includes('b@acme-test.com')),'Open cycle grants assigned employee');
assert.ok(permissions.some(p=>p.description.includes(today) && p.editors.length===0),'Completed cycle input locked for employee');
row[7]='CHANGED-AFTER-COMPLETION';ctx.processTasks();
assert.equal(sheets['Completion History'].rows[1][5],'TKT-ADAPTER-1','History never overwrites accepted proof');
// A scheduler reading Submit=false must not erase a checkbox tick made after that read.
const future=sheets['Employee Tasks'].rows[2];const state=ctx.readState_();future[8]=true;ctx.persistCycles_(state,state.cycles.length);
assert.equal(future[8],true,'Late input checkbox survives an older scheduler snapshot');
future[8]=false;
// Exercise setup, the diagnostic and the timed demo through their real adapter functions.
sheets['Manager Review']=new Sheet('Manager Review',[['Assigned to','Due','Overdue','Completed','Manager review outstanding','Leadership alerted'],['Employee A'],['Employee B'],['Employee C'],['Employee D'],['Total'],[],[],value('WORK_HEADERS'),['OLD SNAPSHOT'],['OLD SNAPSHOT']]);
let triggers=[];
ctx.ScriptApp={getProjectTriggers:()=>triggers,deleteTrigger:t=>triggers=triggers.filter(x=>x!==t),newTrigger:fn=>({timeBased(){this.type='CLOCK';return this;},everyMinutes(n){this.interval=n;return this;},forSpreadsheet(){this.type='EDIT';return this;},onEdit(){return this;},create(){const t={fn,type:this.type,interval:this.interval,getHandlerFunction(){return this.fn;}};triggers.push(t);return t;}})};
const props=new Map();ctx.PropertiesService={getDocumentProperties:()=>({setProperty:(k,v)=>props.set(k,v),getProperty:k=>props.get(k),deleteProperty:k=>props.delete(k)})};
ctx.setup();ctx.setup();
assert.equal(triggers.length,2,'Repeated setup keeps exactly two triggers');
assert.equal(triggers.find(t=>t.fn==='processTasks').interval,15,'Normal scheduler 15 minutes');
assert.equal(sheets['Manager Review'].rows[10][0],'','Old detail snapshot cleared before live FILTER');
assert.ok(sheets['Manager Review'].rows[9][0].startsWith('=IFERROR(FILTER('),'Native live report formula installed');
ctx.checkInstallation();
assert.ok(sheets['Setup Check'].rows.some(r=>r[0]==='Actual inbox delivery' && r[1]==='NOT VERIFIED'),'Diagnostic does not claim inbox delivery');
ctx.setSetting_('Demo test inbox','manager@acme-test.com');ctx.setSetting_('Demo email mode','DRY_RUN');ctx.prepareTimedDemo();
assert.equal(triggers.find(t=>t.fn==='processTasks').interval,1,'Timed demo installs one-minute scheduler');
assert.equal(sheets['Task Master'].rows.filter(r=>String(r[0]).startsWith('DEMO-RUN-')).length,3,'Three fresh demo tasks');
ctx.stopTimedDemo();
assert.equal(triggers.find(t=>t.fn==='processTasks').interval,15,'Stopping demo restores normal scheduler');
assert.equal(sheets['Task Master'].rows.filter(r=>String(r[0]).startsWith('DEMO-RUN-') && r[9]===true).length,0,'Demo tasks deactivated without deleting evidence');
assert.equal(sendCount,1,'Dry-run timed demo does not invoke mock email sender');
console.log('Google adapter mock checks passed: persistence, mail calls, acknowledgement, history, permissions, concurrent input, setup, diagnostics, timed demo, restoration and idempotency. No real email sent.');
