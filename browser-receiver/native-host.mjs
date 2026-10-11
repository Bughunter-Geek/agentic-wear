import {readFileSync,writeFileSync,renameSync,appendFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {BrowserCloudObservers,browserObservationSchema} from '../bridge/dist/browser-cloud-observer.js';
import {DesktopCloudTransport} from '../bridge/dist/desktop-cloud-adapter.js';
import {autoCloudChatsEnabled,readDesktopCloudConfig,desktopCloudConfigPath,desktopCloudSocketPath,cloudSendResultSchema,readPrivateJson,writePrivateJson} from '../bridge/dist/desktop-cloud-protocol.js';
const manifest=JSON.parse(readFileSync(new URL('./extension/manifest.json',import.meta.url)));
const extensionId=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
if(process.argv[2]!==`chrome-extension://${extensionId}/`)process.exit(2);
const config=await readDesktopCloudConfig(desktopCloudConfigPath());if(!config?.enabled)process.exit(2);
const logPath=join(homedir(),'.agentic-wear','browser-receiver-status.json'),receiptPath=join(homedir(),'.agentic-wear','browser-send-receipts.json');
const hostLogPath=join(homedir(),'.agentic-wear','desktop-cloud-host.log'),loggedFailures=new Set();
// One line per distinct failure; codes and schema paths only, never field values or message text.
function hostLog(kind,detail){
 const key=kind+':'+detail;if(loggedFailures.has(key)||loggedFailures.size>200)return;loggedFailures.add(key);
 try{
  let size=0;try{size=statSync(hostLogPath).size;}catch{}
  if(size>200*1024)writeFileSync(hostLogPath,'',{mode:0o600});
  appendFileSync(hostLogPath,JSON.stringify({at:Date.now(),pid:process.pid,kind,detail})+'\n',{mode:0o600});
 }catch{}
}
const issueSummary=error=>(error?.issues??[]).slice(0,6).map(i=>`${(i.path??[]).filter(p=>typeof p==='number'||/^[A-Za-z]{1,32}$/.test(String(p))).join('.')}:${i.code}`).join(',')||'unknown';
const OPTIONAL_MODEL_FIELDS=['model','effort','models','efforts'];
const stored=await readPrivateJson(receiptPath);
const receipts=new Map(stored?.pairBinding===config.pairBinding?stored.entries:[]),waiting=new Map(),pages=new Map();
let persistChain=Promise.resolve();
function persist(){const value={pairBinding:config.pairBinding,entries:[...receipts].slice(-1024)};persistChain=persistChain.then(()=>writePrivateJson(receiptPath,value));return persistChain;}
function status(fields){const tmp=logPath+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify({pid:process.pid,at:Date.now(),...fields}),{mode:0o600});renameSync(tmp,logPath);}
function reply(x){const b=Buffer.from(JSON.stringify(x)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);process.stdout.write(Buffer.concat([h,b]));}
async function send(command){
 const target=config.targets.find(t=>t.threadId===command.threadId),url=target?.url??`https://chatgpt.com/local/${command.threadId}`,page=pages.get(url);
 const base={requestId:command.requestId,threadId:command.threadId};
 const hash=createHash('sha256').update(JSON.stringify([command.threadId,command.text])).digest('hex'),old=receipts.get(command.requestId);
 if(old){
  if(old.hash!==hash)return {...base,outcome:'rejected',message:'Request identity was reused with different content.'};
  if(old.result.outcome==='uncertain' && old.baseline && page && !page.blocked && Date.now()-page.observedAt<60000){
   const messages=page.turns.flatMap(t=>t.role==='user'?[{id:t.id,turnId:t.id,text:t.reply}]:(t.prompts||[]).map(p=>({...p,turnId:t.id})));
   const found=messages.find(m=>!old.baseline.includes(m.id)&&createHash('sha256').update(JSON.stringify([command.threadId,m.text])).digest('hex')===hash);
   if(found){old.result={...base,outcome:'accepted',messageId:found.id,nativeTurnId:found.turnId,message:'Previously submitted message found in browser history.'};await persist();}
  }
  return old.result;
 }
 if(command.checkOnly)return {...base,outcome:'uncertain',message:'No browser receipt is available. Nothing was sent by this status check.'};
 const sendEnabled=target?target.sendEnabled:observers.isDynamicThread(command.threadId);
 if(!sendEnabled||!page||page.blocked||!page.inputReady||Date.now()-page.observedAt>60000||Date.now()>=command.expiresAt)return {...base,outcome:'rejected',message:'The browser chat is unavailable or its composer is busy.'};
 const uncertain={...base,outcome:'uncertain',message:'A prior send may have happened. Check the chat before retrying.'};
 const baseline=page.turns.flatMap(t=>t.role==='user'?[t.id]:(t.prompts||[]).map(p=>p.id));
 receipts.set(command.requestId,{hash,baseline,result:uncertain});await persist();
 const result=await new Promise(resolve=>{
  const timer=setTimeout(()=>{waiting.delete(command.requestId);resolve(uncertain);},Math.max(1,command.expiresAt-Date.now()+500));
  waiting.set(command.requestId,{resolve,timer,threadId:command.threadId});
  reply({...command,url,documentId:page.documentId});
 });
 receipts.set(command.requestId,{hash,baseline,result});await persist();return result;
}
const transport=new DesktopCloudTransport(config,desktopCloudSocketPath(desktopCloudConfigPath()),(event,fields)=>{
 process.stderr.write(JSON.stringify({event,at:Date.now(),...fields})+'\n');
},send);
// Config targets plus, unless autoCloudChats is false, one observer per open chatgpt.com/local/<uuid> tab (max 8).
const observers=new BrowserCloudObservers(config.targets,autoCloudChatsEnabled(config),(s,t)=>transport.snapshot(s,t),e=>transport.terminal(e),url=>pages.delete(url));
transport.start();let input=Buffer.alloc(0);
// Native-clock observations are not subject to hidden page timer throttling.
const heartbeat=setInterval(()=>reply({kind:'observe'}),10000);heartbeat.unref();
process.stdin.on('data',b=>{
 input=Buffer.concat([input,b]);
 while(input.length>=4){const n=input.readUInt32LE(0);if(n>240000)process.exit(3);if(input.length<n+4)return;
  let raw;
  try{raw=JSON.parse(input.subarray(4,4+n));}catch{hostLog('frame','invalid_json');status({status:'invalid_frame'});transport.reset();process.exit(4);}
  input=input.subarray(4+n);
  try{
   if(raw?.kind==='send-result'){
    const parsed=cloudSendResultSchema.safeParse(raw.result);
    if(!parsed.success){hostLog('send-result',issueSummary(parsed.error));continue;}
    const result=parsed.data,pending=waiting.get(result.requestId);
    if(pending&&pending.threadId===result.threadId){clearTimeout(pending.timer);waiting.delete(result.requestId);pending.resolve(result);}continue;
   }
   // A bad observation is never fatal: drop optional model fields and retry, else ignore it.
   let parsed=browserObservationSchema.safeParse(raw);
   if(!parsed.success){
    hostLog('observation',issueSummary(parsed.error));
    if(raw&&typeof raw==='object'){
     const stripped={...raw};for(const key of OPTIONAL_MODEL_FIELDS)delete stripped[key];
     parsed=browserObservationSchema.safeParse(stripped);
     if(!parsed.success)hostLog('observation-stripped',issueSummary(parsed.error));
    }
    if(!parsed.success){status({status:'ignored_observation'});reply({status:'ignored'});continue;}
   }
   const d=parsed.data,observer=observers.resolve(d);
   if(!observer){status({status:'ignored_observation'});reply({status:'ignored'});continue;}
   for(const [requestId,receipt] of receipts){if(receipt.result.outcome==='accepted'&&receipt.result.messageId)observer.linkRequest(receipt.result.messageId,requestId);}
   let result;
   try{result=observer.accept(d);}
   catch(error){hostLog('accept',String(error?.message??'error').slice(0,80));status({status:'ignored_observation'});reply({status:'ignored'});continue;}
   pages.set(d.url,d);
   status({status:d.blocked?'blocked':'ready',...result,observedAt:d.observedAt,visibility:d.visibility,extractionMs:d.extractionMs,
    pages:[...pages].map(([url,p])=>({url,documentId:p.documentId,blocked:p.blocked,inputReady:p.inputReady,observedAt:p.observedAt,messages:p.turns.length,userMessages:p.turns.reduce((n,t)=>n+(t.role==='user'?1:(t.prompts?.length||0)),0),lastTurnId:p.turns.at(-1)?.id})),rssBytes:process.memoryUsage().rss});reply({status:d.blocked?'blocked':'ready'});
  }catch(error){hostLog('handler',String(error?.message??'error').slice(0,80));status({status:'ignored_observation'});}
 }
});
process.stdin.on('end',()=>{transport.close();process.exit(0);});
