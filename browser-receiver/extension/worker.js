const TARGETS=new Set(['https://chatgpt.com/local/01a1188b-a850-755b-91ec-717f6182900a','https://chatgpt.com/dots/home']);
let native;
const owners=new Map(),protectedTabs=new Set();
function release(id){for(const [url,owner] of owners)if(owner.tabId===id)owners.delete(url);}
chrome.tabs.onRemoved.addListener(id=>{protectedTabs.delete(id);release(id);});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url){release(id);if(protectedTabs.has(id)&&!TARGETS.has(change.url)){protectedTabs.delete(id);chrome.tabs.update(id,{autoDiscardable:true}).catch(()=>{});}}});
function connect(){
 if(native)return native;
 const port=chrome.runtime.connectNative('io.github.sirbughunter.agenticwear.cloud');native=port;
 port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(native===port)native=undefined;chrome.action.setBadgeText({text:'OFF'});});
 port.onMessage.addListener(message=>{
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
 if(sender.id!==chrome.runtime.id||sender.frameId!==0||!TARGETS.has(sender.url)||!sender.tab||message?.url!==sender.url)return;
 if(message.version!==1||message.kind!=='observation'||JSON.stringify(message).length>220000)return;
 const owner=owners.get(sender.url);if(owner&&owner.tabId!==sender.tab.id)return;
 owners.set(sender.url,{tabId:sender.tab.id,documentId:message.documentId});
 if(!protectedTabs.has(sender.tab.id)){protectedTabs.add(sender.tab.id);chrome.tabs.update(sender.tab.id,{autoDiscardable:false}).catch(()=>{protectedTabs.delete(sender.tab.id);chrome.action.setBadgeText({text:'TAB'});});}
 connect().postMessage(message);
});
