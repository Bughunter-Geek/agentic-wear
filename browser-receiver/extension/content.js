(() => {
  const CLOUD='https://chatgpt.com/local/01a1188b-a850-755b-91ec-717f6182900a';
  const DOT='https://chatgpt.com/dots/home', NAMESPACE='fa24ed5a57dc8199b97f68f7d0098d11';
  const TARGET=location.href;
  if(![CLOUD,DOT].includes(TARGET))return;
  const isDot=TARGET===DOT, documentId=crypto.randomUUID();
  let scheduled=false,last='',lastSent=0,sending=false;
  const label=e=>e.getAttribute('aria-label')||(e.innerText||e.textContent||'').trim();
  const clean=e=>{
    if(!e)return '';
    const clone=e.cloneNode(true);
    clone.querySelectorAll('.turn-action-controls,.message-inline-actions,[data-markdown-copy="exclude"],button,script,style,svg,[role=tooltip],[aria-hidden=true],[class*=sr-only]').forEach(n=>n.remove());
    return (clone.innerText||clone.textContent||'').trim().slice(0,4000);
  };
  const stopped=()=>[...document.querySelectorAll('button')].some(b=>/^Stop(?: generating| response)?$/.test(label(b)));
  const editor=()=>{
    const matches=[...document.querySelectorAll(isDot?'main .ProseMirror[contenteditable=true][aria-label="Message"]':'main .ProseMirror[contenteditable=true][data-codex-composer=true]')];
    return matches.length===1?matches[0]:null;
  };
  function dotIdentity(){
    const rows=[...document.querySelectorAll('main article.message-row[data-message-id]')];
    return rows.length>0 && rows.every(e=>e.dataset.messageId.startsWith(`${NAMESPACE}~${NAMESPACE}~CalpicoMessage~`)) &&
      !!document.querySelector('[data-orbit-profile-trigger=true][aria-label="Open Lumen’s profile"]');
  }
  function readTurns(){
    if(isDot){
      if(!dotIdentity())return [];
      // Dot keeps newest-first DOM order and flips it visually; order by on-screen top (oldest first) so the newest 20 are kept oldest->newest. Ties keep DOM order.
      const rows=[...document.querySelectorAll('main article.message-row[data-message-id]')].map((row,i)=>({row,i,top:row.getBoundingClientRect().top}))
        .sort((a,b)=>(a.top-b.top)||(a.i-b.i)).map(x=>x.row);
      return rows.flatMap(row=>{
        const match=/~Sentinel_([a-f0-9]{32})$/.exec(row.dataset.messageId);
        if(!match)return [];
        const body=row.querySelector('.message-body'), user=row.classList.contains('self');
        const complete=user||!!body?.querySelector('[data-action="reply"]');
        return [{id:`dot-${match[1]}`,role:user?'user':'assistant',reply:clean(body),completed:complete,
          evidence:complete?'response-actions-without-stop':null}];
      }).slice(-20);
    }
    return [...document.querySelectorAll('[data-turn-key]')].flatMap(root=>{
      const match=/^history-content:turn:([a-f0-9-]{36})$/.exec(root.getAttribute('data-turn-key'));
      if(!match)return [];
      const prompts=[...root.querySelectorAll('[data-user-message-bubble=true]')].map((e,i)=>({
        id:(e.closest('[data-content-search-unit-key]')?.getAttribute('data-content-search-unit-key')||`${match[1]}:${i}`),text:clean(e)
      })).filter(p=>p.text).slice(-10);
      const controls=[...root.querySelectorAll('.turn-action-controls')].filter(e=>[...e.querySelectorAll('button')].some(b=>label(b)==='Rate response'));
      const replies=controls.map(e=>clean(e.parentElement)).filter(Boolean);
      const complete=!stopped()&&replies.length>0;
      return [{id:match[1],prompts,reply:replies.at(-1)||'',completed:complete,evidence:complete?'response-actions-without-stop':null}];
    }).slice(-20);
  }
  function blocked(){return location.href!==TARGET || (isDot&&!dotIdentity()) || [...document.querySelectorAll('button')].some(e=>/^(Log in|Sign in)$/.test(label(e))) || document.body.innerText.includes('Couldn’t load messages');}
  function inspect(){
    scheduled=false;if(location.href!==TARGET)return;
    const started=performance.now(), unavailable=blocked(), composer=editor();
    const model={version:1,kind:'observation',url:TARGET,documentId,visibility:document.visibilityState,blocked:unavailable,
      ...(isDot?{identity:NAMESPACE}:{}),inputReady:!unavailable&&!sending&&!stopped()&&!!composer&&!clean(composer),turns:unavailable?[]:readTurns()};
    const encoded=JSON.stringify(model),now=Date.now();
    if(encoded===last&&now-lastSent<3000)return;
    last=encoded;lastSent=now;
    chrome.runtime.sendMessage({...model,observedAt:now,extractionMs:Math.round((performance.now()-started)*100)/100}).catch(()=>{last='';});
  }
  const userMessages=()=>readTurns().flatMap(t=>t.role==='user'?[{id:t.id,turnId:t.id,text:t.reply}]:(t.prompts||[]).map(p=>({...p,turnId:t.id})));
  function waitFor(predicate,deadline){return new Promise(resolve=>{
    let done=false,timer;
    const check=()=>{const value=predicate();if(value||Date.now()>=deadline){done=true;observer.disconnect();clearTimeout(timer);resolve(value||null);}};
    const observer=new MutationObserver(check);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
    timer=setTimeout(check,Math.max(0,deadline-Date.now()));check();if(done)observer.disconnect();
  });}
  async function send(command){
    const result=(outcome,message,messageId,nativeTurnId)=>({requestId:command.requestId,threadId:command.threadId,outcome,message,...(messageId?{messageId}:{}),...(nativeTurnId?{nativeTurnId}:{})});
    if(command.url!==TARGET||command.documentId!==documentId||Date.now()>=command.expiresAt||blocked())return result('rejected','The browser chat changed or is unavailable.');
    if(sending||stopped())return result('rejected','The chat is busy. Wait for the current response.');
    const composer=editor();
    if(!composer||clean(composer))return result('rejected','The desktop composer has a draft or is unavailable. Your Watch draft is kept.');
    if(typeof command.text!=='string'||!command.text.trim()||command.text.length>4000)return result('rejected','Invalid message.');
    const oldIds=new Set(userMessages().map(m=>m.id));
    sending=true;let clicked=false;
    try{
      composer.focus({preventScroll:true});
      const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(composer);selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('insertText',false,command.text))return result('rejected','The browser editor did not accept text.');
      // Let ProseMirror and React commit the input transaction before reading
      // Send readiness. A synchronously enabled button can retain the old empty-draft handler.
      await new Promise(resolve=>setTimeout(resolve,100));
      const button=await waitFor(()=>{
        if(blocked()||editor()!==composer||clean(composer)!==command.text.trim())return null;
        const buttons=[...document.querySelectorAll('main button[aria-label="Send"]')].filter(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true');
        return buttons.length===1?buttons[0]:null;
      },Math.min(command.expiresAt,Date.now()+3000));
      if(!button||Date.now()>=command.expiresAt||blocked()||stopped()||clean(composer)!==command.text.trim())return result('rejected','The send control was unavailable; text remains in the browser draft.');
      clicked=true;button.click();
      const posted=await waitFor(()=>{
        if(blocked()||clean(composer))return null;
        return userMessages().find(m=>!oldIds.has(m.id)&&m.text===command.text.trim());
      },command.expiresAt);
      return posted?result('accepted','Message appeared in the browser chat.',posted.id,posted.turnId):result('uncertain','Send was clicked but the posted message could not be verified. Check the chat before retrying.');
    }catch{return result(clicked?'uncertain':'rejected',clicked?'Send outcome is uncertain. Check the chat before retrying.':'The editor refused the message. Check its draft.');}
    finally{sending=false;inspect();}
  }
  chrome.runtime.onMessage?.addListener((command,sender,respond)=>{
    if(sender.id!==chrome.runtime.id)return;
    if(command?.kind==='observe'){lastSent=0;inspect();respond({documentId});return;}
    if(command?.kind!=='send')return;
    void send(command).then(respond);return true;
  });
  function schedule(){if(!scheduled){scheduled=true;queueMicrotask(inspect);}}
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-turn-key','aria-busy','data-message-id','disabled']});
  document.addEventListener('visibilitychange',schedule);setInterval(inspect,1000);schedule();
})();
