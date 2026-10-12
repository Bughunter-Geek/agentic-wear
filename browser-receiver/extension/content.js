(() => {
  const DOT='https://chatgpt.com/dots/home', NAMESPACE='fa24ed5a57dc8199b97f68f7d0098d11';
  const LOCAL=/^https:\/\/chatgpt\.com\/local\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const TARGET=location.href;
  if(TARGET!==DOT&&!LOCAL.test(TARGET))return;
  // The worker may inject this file into a tab that already has it (extension reload,
  // or an in-page navigation to another chat). Same URL: keep the running instance.
  // Different URL: retire the old instance so only one answers commands.
  const previous=window.__agenticWearCloudReceiver;
  if(previous&&previous.version==='0.3.8'&&previous.url===TARGET&&previous.alive&&chrome.runtime?.id)return;
  if(previous&&previous.stop)previous.stop();
  const isDot=TARGET===DOT, documentId=crypto.randomUUID();
  let scheduled=false,last='',lastSent=0,sending=false,retired=false;
  const nativeVoice=isDot?window.AgenticWearVoiceController?.create({documentId,url:TARGET,identity:()=>dotIdentity()?NAMESPACE:null,changed:()=>schedule()}):null;
  const chatTitle=()=>{
    const text=(document.title||'').replace(/\s*[|\u2013\u2014-]\s*ChatGPT\s*$/i,'').trim().slice(0,200);
    return text&&!/^ChatGPT$/i.test(text)?text:'Codex cloud chat';
  };
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
      !!document.querySelector('[data-orbit-profile-trigger=true][aria-label="Open Lumen’s profile"], [data-orbit-profile-trigger=true][aria-label="Close Lumen’s profile"]');
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
  // ---- Model / reasoning selection (Codex cloud pages only; Dot never uses any of this) ----
  // Radix menu structure observed on the real page; see the build 89 contract.
  const MODEL_NAME=/^[A-Za-z0-9_.:/ -]{1,64}$/;
  let lastModelControl=null,catalogModel=null,models=[],efforts=[],maxEffort=null,lastLearnAt=0,lastInteraction=0,selfDriving=false,learning=null;
  const LEARN_REFRESH_MS=30*60*1000,LEARN_QUIET_MS=10000;
  // Real user activity in the page (our own synthetic events are ignored via selfDriving).
  for(const type of ['pointerdown','pointermove','mousedown','keydown','wheel','touchstart'])
    document.addEventListener(type,()=>{if(!selfDriving)lastInteraction=Date.now();},{capture:true,passive:true});
  const aliases=new Map();
  // Yield a task so React can commit without a chained background-page timer.
  // A frozen page may still resume late; callers must check their deadline.
  const nextTask=()=>new Promise(resolve=>{
    const channel=new MessageChannel();
    channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};
    channel.port2.postMessage(null);
  });
  const norm=s=>(s||'').replace(/\s+/g,' ').trim();
  const text=e=>norm(e.innerText||e.textContent);
  function modelButton(){
    if(isDot)return null;
    if(openMenuEl()&&lastModelControl?.isConnected)return lastModelControl;
    const candidate=b=>{
      const name=b.getAttribute('aria-label')||visiblePair(b)?.model||text(b);
      return /^(Loading model|GPT(?:-|\s)|Daybreak(?:\s|$)|Auto(?:\s|$))/i.test(name)||models.some(m=>name===m||name.startsWith(m+' '));
    };
    // The model popover can be portalled outside main. Permission menus beside
    // the composer are not model controls, even when they are the only menu.
    for(let el=editor();el&&el!==document.body;el=el.parentElement){
      const near=[...el.querySelectorAll('button, [role=button]')].filter(candidate);
      if(near.length===1)return lastModelControl=near[0];if(near.length>1)return null;
    }
    const all=[...document.querySelectorAll('button, [role=button]')].filter(candidate);
    return all.length===1?(lastModelControl=all[0]):null;
  }
  function parseModelText(value){
    const known=[...models].sort((a,b)=>b.length-a.length).find(m=>value===m||value.startsWith(m+' '));
    if(known)return {model:known,label:value.slice(known.length).trim()};
    const i=value.lastIndexOf(' ');
    return i<0?{model:value,label:''}:{model:value.slice(0,i),label:value.slice(i+1)};
  }
  const effortIndexOf=label=>{
    if(!label)return null;
    const key=label.toLowerCase(),i=efforts.findIndex(l=>l&&l.toLowerCase()===key);
    return i>=0?i:(aliases.has(key)?aliases.get(key):null);
  };
  // Hidden = aria-hidden, display:none, visibility:hidden or opacity 0 on the element or any ancestor up to the button.
  function hiddenWithin(el,root){
    for(let n=el;n&&n!==root.parentElement;n=n.parentElement){
      if(n.getAttribute&&n.getAttribute('aria-hidden')==='true')return true;
      const style=window.getComputedStyle(n);
      if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return true;
    }
    return false;
  }
  // Real button: the model name is the first visible leaf; the current effort label is a
  // leaf with an sr-only class; the global effort names are hidden leaves. Older shape:
  // a visible element with exactly two leaf children (model, effort).
  function visiblePair(button){
    const leaves=[...button.querySelectorAll('*')].filter(e=>!e.children.length&&norm(e.textContent));
    const srLeaf=leaves.find(e=>e.matches('[class*=sr-only]')&&!hiddenWithin(e,button)&&!e.parentElement.closest('[class*=sr-only]'));
    if(srLeaf){
      const modelLeaf=leaves.find(e=>e!==srLeaf&&!e.closest('[class*=sr-only]')&&!hiddenWithin(e,button));
      if(modelLeaf)return {model:norm(modelLeaf.textContent),label:norm(srLeaf.textContent)};
    }
    for(const el of button.querySelectorAll('*')){
      if(el.children.length!==2||el.closest('[class*=sr-only]'))continue;
      const [a,b]=el.children;
      if(a.children.length||b.children.length)continue;
      const model=norm(a.textContent),label=norm(b.textContent);
      if(model&&label)return {model,label};
    }
    return null;
  }
  function readCurrent(){
    const button=modelButton();if(!button)return null;
    const value=text(button);if(!value||/^Loading model/i.test(value))return null;
    const explicit=button.getAttribute('aria-label');
    const pair=explicit&&/^(GPT(?:-|\s)|Daybreak(?:\s|$)|Auto(?:\s|$))/i.test(explicit)?parseModelText(norm(explicit)):visiblePair(button);
    if(pair&&/^Loading/i.test(pair.model))return null;
    const parsed=pair||parseModelText(value);
    if(!MODEL_NAME.test(parsed.model))return null;
    const label=parsed.label.slice(0,64);
    return {model:parsed.model,label,index:catalogModel===parsed.model?effortIndexOf(label):null};
  }
  const openMenuEl=()=>document.querySelector('[role=menu][data-state=open]');
  const radioName=r=>r.getAttribute('aria-label')||text(r);
  function readMenu(menu){
    const slider=menu.querySelector('[role=slider]');
    const sliderState=slider?{min:Number(slider.getAttribute('aria-valuemin')),max:Number(slider.getAttribute('aria-valuemax')),now:Number(slider.getAttribute('aria-valuenow'))}:null;
    const radios=[...menu.querySelectorAll('[role=menuitemradio]')];
    const selected=radios.find(r=>r.getAttribute('aria-checked')==='true'||r.dataset.modelSelected==='true');
    const statusEl=menu.querySelector('span[role=status]');
    const m=statusEl&&/^(.*),\s*(\d+)\s+of\s+(\d+)\.?$/.exec(text(statusEl));
    const status=m?{...parseModelText(m[1]),pos:Number(m[2]),total:Number(m[3])}:null;
    return {slider:sliderState,radios,model:selected?radioName(selected):(status?status.model:null),status};
  }
  // The animated composer label keeps its ordered label catalogue in sibling
  // leaves, including unsupported endpoints. Align it to the menu's CURRENT
  // slider position and range; never assume global labels equal model options.
  function effortLabels(button,current,slider){
    if(!button||!current?.label||!slider||!Number.isInteger(slider.now)||slider.min!==0)return null;
    const count=slider.max+1,candidates=[];
    for(const parent of button.querySelectorAll('*')){
      const children=[...parent.children];
      if(children.length<count||children.length>12)continue;
      const labels=children.map(e=>norm(e.textContent));
      if(labels.some(l=>!l||l.length>64)||new Set(labels).size!==labels.length)continue;
      const at=labels.indexOf(current.label),offset=at-slider.now;
      if(at<0||offset<0||offset+count>labels.length)continue;
      candidates.push(labels.slice(offset,offset+count));
    }
    // Some animation versions wrap each label in several spans rather than
    // keeping sibling leaves. Match an unambiguous ordered leaf window too.
    const leaves=[...button.querySelectorAll('*')].filter(e=>!e.children.length).map(e=>norm(e.textContent)).filter(Boolean);
    for(let at=0;at<leaves.length;at++){
      if(leaves[at]!==current.label)continue;
      const offset=at-slider.now,labels=leaves.slice(offset,offset+count);
      if(offset<0||labels.length!==count||new Set(labels).size!==count)continue;
      if(labels.some(l=>l===current.model||/^Select\b/i.test(l)||!/^[A-Za-z][A-Za-z -]{0,63}$/.test(l)))continue;
      candidates.push(labels);
    }
    const unique=[...new Set(candidates.map(x=>JSON.stringify(x)))];
    return unique.length===1?JSON.parse(unique[0]):null;
  }
  // Remember everything an open menu shows. Read-only: never changes a setting.
  function learnFromMenu(menu){
    const state=readMenu(menu);
    for(const r of state.radios){const name=radioName(r);if(MODEL_NAME.test(name)&&!/^Default/i.test(name)&&!models.includes(name))models.push(name);}
    if(state.model&&MODEL_NAME.test(state.model)&&!/^Default/i.test(state.model)&&!models.includes(state.model))models.push(state.model);
    models=models.slice(-24);
    const buttonCurrent=readCurrent();
    // Opening the real menu changes the button label to "Select effort".
    // Its selected radio/status is authoritative while the popover is open.
    const current=state.model?{model:state.model,label:state.status?.label||(buttonCurrent?.model===state.model?buttonCurrent.label:'')}:buttonCurrent;
    if(current&&catalogModel!==current.model){catalogModel=current.model;efforts=[];maxEffort=null;aliases.clear();}
    if(state.slider&&Number.isFinite(state.slider.max)&&state.slider.max>=0&&state.slider.max<=9)maxEffort=state.slider.max;
    if(state.status&&state.status.label&&state.status.pos>=1&&state.status.pos<=10)efforts[state.status.pos-1]=state.status.label;
    const labels=effortLabels(modelButton(),current,state.slider);
    if(labels){efforts=labels;labels.forEach((label,i)=>aliases.set(label.toLowerCase(),i));}
    if(current&&current.label&&state.slider&&Number.isInteger(state.slider.now)){
      const known=aliases.get(current.label.toLowerCase());
      if(known===undefined||known===state.slider.now){
        aliases.set(current.label.toLowerCase(),state.slider.now);
        efforts[state.slider.now]=current.label;
      }
    }
    return state;
  }
  async function openMenu(deadline=Date.now()+2500){
    if(Date.now()>=deadline)return false;
    if(openMenuEl())return true;
    const button=modelButton();if(!button)return false;
    const fire=(type,Ctor)=>button.dispatchEvent(new (window[Ctor]||MouseEvent)(type,{bubbles:true,cancelable:true,button:0,ctrlKey:false,pointerType:'mouse'}));
    for(const attempt of [()=>fire('pointerdown','PointerEvent'),()=>button.click(),()=>{button.focus();button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}]){
      if(Date.now()>=deadline)return false;
      attempt();
      if(await waitFor(openMenuEl,Math.min(deadline,Date.now()+450)))return Date.now()<deadline;
    }
    return false;
  }
  async function closeMenu(deadline=Date.now()+1500){
    if(!openMenuEl())return true;
    if(Date.now()>=deadline)return false;
    (document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    return !!await waitFor(()=>!openMenuEl(),deadline);
  }
  // One read-only pass while the tab is hidden: learn the model list, effort range and label.
  function learn(){
    lastLearnAt=Date.now();
    learning=(async()=>{
      selfDriving=true;
      const deadline=Date.now()+2500;
      try{
        if(!await openMenu(deadline))return;
        let menu=openMenuEl();
        if(menu&&!menu.querySelector('[role=menuitemradio]')){
          const toggle=menu.querySelector('[data-model-picker-view-toggle=true]');
          if(toggle&&Date.now()<deadline){toggle.click();await waitFor(()=>openMenuEl()?.querySelector('[role=menuitemradio]'),deadline);menu=openMenuEl()||menu;}
        }
        if(menu&&Date.now()<deadline)learnFromMenu(menu);
      }catch{}finally{await closeMenu();selfDriving=false;learning=null;scheduled=false;lastSent=0;schedule();}
    })();
  }
  async function applySettings(want,deadline){
    selfDriving=true;
    try{return await applySettingsInner(want,deadline);}finally{selfDriving=false;}
  }
  async function applySettingsInner(want,deadline){
    const active=()=>Date.now()<deadline;
    const fail=async()=>{await closeMenu();return false;};
    try{
      if(!active()||!await openMenu(deadline))return fail();
      let menu=openMenuEl();let state=learnFromMenu(menu);
      if(want.model!==undefined&&state.model!==want.model){
        let radio=state.radios.find(r=>radioName(r)===want.model);
        if(!radio){
          const toggle=menu.querySelector('[data-model-picker-view-toggle=true]');
          if(toggle&&active()){
            toggle.click();
            radio=await waitFor(()=>openMenuEl()&&readMenu(openMenuEl()).radios.find(r=>radioName(r)===want.model),deadline);
          }
        }
        if(!radio||!active())return fail();
        radio.click();
        if(!await waitFor(()=>readCurrent()?.model===want.model||(openMenuEl()&&readMenu(openMenuEl()).model===want.model),deadline)||!active())return fail();
        if(!openMenuEl()&&!await openMenu(deadline))return fail();
        menu=openMenuEl();state=learnFromMenu(menu);
        if(state.model!==want.model)return fail();
        const baselineSlider=state.slider;
        if(!await closeMenu(deadline)||!active())return false;
        const baseline=await waitFor(()=>{const c=readCurrent();return c?.model===want.model&&c.label?c:null;},deadline);
        if(!baseline||!active())return false;
        const labels=effortLabels(modelButton(),baseline,baselineSlider);
        if(labels){efforts=labels;labels.forEach((label,i)=>aliases.set(label.toLowerCase(),i));}
        if(!await openMenu(deadline))return false;
        menu=openMenuEl();state=learnFromMenu(menu);
        if(state.model!==want.model)return fail();
      }
      // Hold the intended label fixed before moving the slider. Learning later
      // observations must never redefine a requested Light as another label.
      const expectedLabel=want.effortIndex===undefined?null:efforts[want.effortIndex]||null;
      if(want.effortIndex!==undefined){
        if(!state.slider||want.effortIndex<state.slider.min||want.effortIndex>state.slider.max)return fail();
        for(let step=0;state.slider.now!==want.effortIndex&&step<10;step++){
          if(!active())return fail();
          const slider=openMenuEl()?.querySelector('[role=slider]');if(!slider)return fail();
          const before=state.slider.now,delta=want.effortIndex>before?1:-1;
          slider.focus();slider.dispatchEvent(new KeyboardEvent('keydown',{key:delta>0?'ArrowRight':'ArrowLeft',bubbles:true,cancelable:true}));
          const changed=await waitFor(()=>{const m=openMenuEl(),v=m&&readMenu(m);return v?.slider?.now===before+delta?v:null;},deadline);
          if(!changed||!active())return fail();
          state=changed;
        }
        if(state.slider.now!==want.effortIndex)return fail();
      }
      const finalSlider=state.slider?state.slider.now:null,statusLabel=state.status?.label||'';
      if(!await closeMenu(deadline)||!active())return false;
      // Observe the committed label, not an arbitrary animation delay.
      const current=await waitFor(()=>{
        const c=readCurrent();if(!c||(want.model!==undefined&&c.model!==want.model))return null;
        if(want.effortIndex===undefined)return c;
        if(finalSlider!==want.effortIndex||!c.label)return null;
        const known=effortIndexOf(c.label);
        if(expectedLabel&&c.label.toLowerCase()!==expectedLabel.toLowerCase()&&known!==want.effortIndex)return null;
        if(known!==null&&known!==want.effortIndex)return null;
        if(known===null&&c.label.toLowerCase()!==statusLabel.toLowerCase())return null;
        return c;
      },deadline);
      if(!current||!active())return false;
      if(want.effortIndex!==undefined&&effortIndexOf(current.label)===null)aliases.set(current.label.toLowerCase(),want.effortIndex);
      return true;
    }catch{return fail();}
  }
  function modelFields(){
    if(isDot)return {};
    const current=readCurrent();
    const same=current&&catalogModel===current.model;
    // The animated catalogue is mounted only while the menu is CLOSED.
    // Align it using the range/index learned from the menu, after it closes.
    if(same&&!openMenuEl()&&current.index!==null&&maxEffort!==null){
      const labels=effortLabels(modelButton(),current,{min:0,max:maxEffort,now:current.index});
      if(labels){efforts=labels;labels.forEach((label,i)=>aliases.set(label.toLowerCase(),i));}
    }
    return {
      ...(current?{model:current.model,effort:{label:current.label||'Unknown',...(current.index!==null?{index:current.index}:{}),...(same&&maxEffort!==null?{max:maxEffort}:{})}}:{}),
      ...(models.length?{models:[...models]}:{}),
      ...(same&&maxEffort!==null?{efforts:Array.from({length:maxEffort+1},(_,i)=>efforts[i]||'')}:{}),
    };
  }
  // Read-only learning pass: only when nobody is looking at or using this page.
  function canLearn(){
    if(isDot||sending||learning||selfDriving||openMenuEl())return false;
    const now=Date.now();
    if(lastLearnAt&&now-lastLearnAt<LEARN_REFRESH_MS&&catalogModel===readCurrent()?.model)return false;
    if(!(document.visibilityState==='hidden'||!document.hasFocus()))return false;
    if(now-lastInteraction<LEARN_QUIET_MS)return false;
    return !blocked()&&!!modelButton()&&!!readCurrent();
  }
  function inspect(){
    scheduled=false;if(retired)return;
    if(!chrome.runtime?.id){handle.stop();return;}
    if(location.href!==TARGET)return;
    if(canLearn())learn();
    const started=performance.now(), unavailable=blocked(), composer=editor();
    const model={version:1,kind:'observation',url:TARGET,documentId,visibility:document.visibilityState,blocked:unavailable,
      ...(isDot?{identity:NAMESPACE,nativeVoice:Boolean(nativeVoice?.available())}:{title:chatTitle()}),inputReady:!unavailable&&!sending&&!learning&&!stopped()&&!!composer&&!clean(composer),...(unavailable?{}:modelFields()),turns:unavailable?[]:readTurns()};
    const encoded=JSON.stringify(model),now=Date.now();
    if(encoded===last&&now-lastSent<3000)return;
    last=encoded;lastSent=now;
    try{
      Promise.resolve(chrome.runtime.sendMessage({...model,observedAt:now,extractionMs:Math.round((performance.now()-started)*100)/100})).catch(()=>{last='';});
    }catch(error){
      // sendMessage throws synchronously once the extension was reloaded.
      if(/Extension context invalidated/i.test(String(error&&error.message)))handle.stop();else last='';
    }
  }
  const userMessages=()=>readTurns().flatMap(t=>t.role==='user'?[{id:t.id,turnId:t.id,text:t.reply}]:(t.prompts||[]).map(p=>({...p,turnId:t.id})));
  function waitFor(predicate,deadline){return new Promise(resolve=>{
    let done=false,timer;
    const check=()=>{const value=predicate();if(value||Date.now()>=deadline){done=true;observer.disconnect();clearTimeout(timer);resolve(value||null);}};
    const observer=new MutationObserver(check);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
    timer=setTimeout(check,Math.max(0,deadline-Date.now()));check();if(done)observer.disconnect();
  });}
  async function send(command){
    let verifiedSelection;
    const result=(outcome,message,messageId,nativeTurnId)=>({requestId:command.requestId,threadId:command.threadId,outcome,message,...(messageId?{messageId}:{}),...(nativeTurnId?{nativeTurnId}:{}),...((outcome==='accepted'||outcome==='uncertain')&&verifiedSelection?{verifiedSelection}:{})});
    if(command.url!==TARGET||command.documentId!==documentId||Date.now()>=command.expiresAt||blocked())return result('rejected','The browser chat changed or is unavailable.');
    if(learning)await learning;
    if(Date.now()>=command.expiresAt)return result('rejected','The send request expired before editing the chat. Your Watch draft is kept.');
    if(sending||stopped())return result('rejected','The chat is busy. Wait for the current response.');
    const composer=editor();
    if(!composer||clean(composer))return result('rejected','The desktop composer has a draft or is unavailable. Your Watch draft is kept.');
    if(typeof command.text!=='string'||!command.text.trim()||command.text.length>4000)return result('rejected','Invalid message.');
    const oldIds=new Set(userMessages().map(m=>m.id));
    sending=true;let clicked=false;
    try{
      const want={};
      if(!isDot){
        if(typeof command.model==='string'&&command.model)want.model=command.model;
        if(Number.isInteger(command.effortIndex)&&command.effortIndex>=0&&command.effortIndex<=9)want.effortIndex=command.effortIndex;
      }
      if(want.model!==undefined||want.effortIndex!==undefined){
        const current=readCurrent();
        const needs=!current||(want.model!==undefined&&current.model!==want.model)||(want.effortIndex!==undefined&&current.index!==want.effortIndex);
        if(needs&&!await applySettings(want,command.expiresAt))return result('rejected',"Couldn't switch the cloud chat's model; nothing was sent. Your draft is kept.");
      }
      if(Date.now()>=command.expiresAt)return result('rejected','The send request expired before typing. Your Watch draft is kept.');
      composer.focus({preventScroll:true});
      const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(composer);selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand('insertText',false,command.text))return result('rejected','The browser editor did not accept text.');
      // Let ProseMirror and React commit the input transaction before reading
      // Send readiness. A synchronously enabled button can retain the old empty-draft handler.
      await nextTask();
      const button=await waitFor(()=>{
        if(blocked()||editor()!==composer||clean(composer)!==command.text.trim())return null;
        const buttons=[...document.querySelectorAll('main button[aria-label="Send"]')].filter(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true');
        return buttons.length===1?buttons[0]:null;
      },Math.min(command.expiresAt,Date.now()+3000));
      if(!button||Date.now()>=command.expiresAt||blocked()||stopped()||clean(composer)!==command.text.trim())return result('rejected','The send control was unavailable; text remains in the browser draft.');
      // Re-read immediately before Send: a concurrent desktop change must not
      // turn a verified Watch choice into a send under another configuration.
      if(!isDot){
        const current=readCurrent();
        if((want.model!==undefined&&current?.model!==want.model)||(want.effortIndex!==undefined&&current?.index!==want.effortIndex))
          return result('rejected','The cloud model settings changed before sending. Your draft is kept.');
        if(current)verifiedSelection={model:current.model,...(current.index!==null?{effortIndex:current.index}:{}),...(current.label?{effortLabel:current.label}:{})};
      }
      clicked=true;button.click();
      const posted=await waitFor(()=>{
        if(blocked()||clean(composer))return null;
        return userMessages().find(m=>!oldIds.has(m.id)&&m.text===command.text.trim());
      },command.expiresAt);
      return posted?result('accepted','Message appeared in the browser chat.',posted.id,posted.turnId):result('uncertain','Send was clicked but the posted message could not be verified. Check the chat before retrying.');
    }catch{return result(clicked?'uncertain':'rejected',clicked?'Send outcome is uncertain. Check the chat before retrying.':'The editor refused the message. Check its draft.');}
    finally{sending=false;inspect();}
  }
  const onCommand=(command,sender,respond)=>{
    if(sender.id!==chrome.runtime.id)return;
    if(command?.kind==='native-voice-check'){respond({ready:Boolean(nativeVoice?.available())});return;}
    if(command?.kind==='native-voice'){void nativeVoice?.command(command).then(respond);return true;}
    if(command?.kind==='native-voice-lost'){nativeVoice?.cancel();respond({closed:true});return;}
    if(command?.kind==='observe'){lastSent=0;inspect();respond({documentId});return;}
    if(command?.kind!=='send')return;
    void send(command).then(respond);return true;
  };
  chrome.runtime.onMessage?.addListener(onCommand);
  function schedule(){if(!retired&&!scheduled){scheduled=true;queueMicrotask(inspect);}}
  const pageObserver=new MutationObserver(schedule);
  pageObserver.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-turn-key','aria-busy','data-message-id','disabled']});
  document.addEventListener('visibilitychange',schedule);const tick=setInterval(inspect,1000);
  const handle={url:TARGET,version:'0.3.8',alive:true,stop(){
    if(retired)return;
    retired=true;handle.alive=false;
    nativeVoice?.stop();
    clearInterval(tick);pageObserver.disconnect();document.removeEventListener('visibilitychange',schedule);
    try{chrome.runtime.onMessage?.removeListener(onCommand);}catch{}
  }};
  window.__agenticWearCloudReceiver=handle;
  schedule();
})();
