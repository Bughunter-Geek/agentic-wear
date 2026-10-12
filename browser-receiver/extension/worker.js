const DOT_URL='https://chatgpt.com/dots/home';
const LOCAL_URL=/^https:\/\/chatgpt\.com\/local\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isTarget=url=>typeof url==='string'&&(url===DOT_URL||LOCAL_URL.test(url));
let native;
const owners=new Map(),protectedTabs=new Set();
const voiceMutes=new Map();
async function restoreVoiceMute(callId){
 const lease=voiceMutes.get(callId);if(!lease)return;voiceMutes.delete(callId);
 if(lease.wasMuted)return;
 try{const tab=await chrome.tabs.get(lease.tabId);if(tab.mutedInfo?.reason==='extension'&&tab.mutedInfo?.extensionId===chrome.runtime.id)await chrome.tabs.update(lease.tabId,{muted:false});}catch{}
}
async function voiceCommand(message,port){
 const owner=owners.get(DOT_URL),fail={version:1,kind:'native-voice-event',url:DOT_URL,documentId:message.documentId,
  identity:owner?.identity,event:{callId:message.callId,threadId:message.threadId,state:'failed'}};
 if(!owner||owner.documentId!==message.documentId||message.url!==DOT_URL||Date.now()>=message.expiresAt){port.postMessage(fail);return;}
 try{
  if(message.action==='start'){
   const check=await chrome.tabs.sendMessage(owner.tabId,{kind:'native-voice-check'},{frameId:0});
   if(!check?.ready){port.postMessage(fail);return;}
   const tab=await chrome.tabs.get(owner.tabId);
   voiceMutes.set(message.callId,{tabId:owner.tabId,documentId:owner.documentId,wasMuted:tab.mutedInfo?.muted===true});
   if(!tab.mutedInfo?.muted)await chrome.tabs.update(owner.tabId,{muted:true});
  }
  const accepted=await chrome.tabs.sendMessage(owner.tabId,message,{frameId:0});
  if(accepted!==true&&message.action==='start'){port.postMessage(fail);await restoreVoiceMute(message.callId);}
  if(message.action==='stop')await restoreVoiceMute(message.callId);
 }catch{port.postMessage(fail);await restoreVoiceMute(message.callId);}
}
function voiceLost(){
 const owner=owners.get(DOT_URL);
 if(owner)chrome.tabs.sendMessage(owner.tabId,{kind:'native-voice-lost'},{frameId:0}).catch(()=>{});
 for(const callId of voiceMutes.keys())void restoreVoiceMute(callId);
}
function release(id){for(const [url,owner] of owners)if(owner.tabId===id)owners.delete(url);}
chrome.tabs.onRemoved.addListener(id=>{protectedTabs.delete(id);release(id);});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url){release(id);if(isTarget(change.url))inject(id);if(protectedTabs.has(id)&&!isTarget(change.url)){protectedTabs.delete(id);chrome.tabs.update(id,{autoDiscardable:true}).catch(()=>{});}}});
// Attach content.js to matching tabs that were open before the extension (re)loaded, or that
// navigated in-page to another chat. content.js guards against double injection itself.
function inject(tabId){
 try{chrome.tabs.get(tabId).then(tab=>{
  const prepare=tab.url===DOT_URL?chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'MAIN',files:['remote-peer.js','voice-hook.js']}):Promise.resolve();
  return prepare.then(()=>chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:['voice-controller.js','content.js']}));
 }).catch(()=>{});}catch{}
}
function attachOpenTabs(){
 try{chrome.tabs.query({url:['https://chatgpt.com/local/*',DOT_URL]}).then(tabs=>{
  for(const tab of tabs)if(tab.id!==undefined&&isTarget(tab.url))inject(tab.id);
 }).catch(()=>{});}catch{}
}
chrome.runtime.onInstalled.addListener(attachOpenTabs);
chrome.runtime.onStartup.addListener(attachOpenTabs);
function connect(){
 if(native)return native;
 const port=chrome.runtime.connectNative('io.github.sirbughunter.agenticwear.cloud');native=port;
 port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(native===port)native=undefined;voiceLost();chrome.action.setBadgeText({text:'OFF'});});
 port.onMessage.addListener(message=>{
  if(message?.kind==='native-voice'){void voiceCommand(message,port);return;}
  if(message?.kind==='native-voice-lost'){voiceLost();return;}
  if(message?.kind==='observe'){for(const owner of owners.values())chrome.tabs.sendMessage(owner.tabId,{kind:'observe'},{frameId:0}).catch(()=>{});return;}
  if(message?.kind==='send'){
   const owner=owners.get(message.url);
   const fail={requestId:message.requestId,threadId:message.threadId,outcome:'rejected',message:'The connected browser tab is unavailable.'};
   if(!owner||owner.documentId!==message.documentId||Date.now()>=message.expiresAt){port.postMessage({kind:'send-result',result:fail});return;}
   chrome.tabs.sendMessage(owner.tabId,message,{frameId:0}).then(result=>{
    port.postMessage({kind:'send-result',result:result||{...fail,outcome:'uncertain',message:'No browser acknowledgement. Check the chat before retrying.'}});
   }).catch(()=>{port.postMessage({kind:'send-result',result:{...fail,outcome:'uncertain',message:'The browser disconnected during send. Check the chat before retrying.'}});});
   return;
  }
  chrome.action.setBadgeText({text:message.status==='ready'?'ON':'…'});
 });return port;
}
chrome.runtime.onMessage.addListener((message,sender)=>{
 if(sender.id!==chrome.runtime.id||sender.frameId!==0||!isTarget(sender.url)||!sender.tab||message?.url!==sender.url)return;
 if(message.version===1&&message.kind==='native-voice-event'&&sender.url===DOT_URL){
  const owner=owners.get(DOT_URL);
  if(!owner||owner.tabId!==sender.tab.id||owner.documentId!==message.documentId||owner.identity!==message.identity||JSON.stringify(message).length>80000)return;
  connect().postMessage(message);
  if(['failed','closed'].includes(message.event?.state))void restoreVoiceMute(message.event.callId);
  return;
 }
 if(message.version!==1||message.kind!=='observation'||JSON.stringify(message).length>220000)return;
 const owner=owners.get(sender.url);if(owner&&owner.tabId!==sender.tab.id)return;
 owners.set(sender.url,{tabId:sender.tab.id,documentId:message.documentId,identity:message.identity});
 if(!protectedTabs.has(sender.tab.id)){protectedTabs.add(sender.tab.id);chrome.tabs.update(sender.tab.id,{autoDiscardable:false}).catch(()=>{protectedTabs.delete(sender.tab.id);chrome.action.setBadgeText({text:'TAB'});});}
 connect().postMessage(message);
});
