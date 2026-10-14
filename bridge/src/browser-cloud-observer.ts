import { z } from "zod";
import {
  DEFAULT_CLOUD_CHAT_TITLE, MAX_DYNAMIC_CLOUD_CHATS, cloudEventId, localCloudChatThreadId,
  type CloudSnapshot, type CloudTerminal,
} from "./desktop-cloud-protocol.js";
const turnId = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/u);
export const browserObservationSchema = z.object({
  version:z.literal(1), kind:z.literal("observation"), url:z.string().max(300), documentId:z.string().uuid(),
  observedAt:z.number().int().nonnegative(), extractionMs:z.number().nonnegative().max(10000),
  identity:z.string().max(128).optional(), title:z.string().max(200).optional(),
  model:z.string().min(1).max(128).optional(),
  effort:z.object({label:z.string().min(1).max(64),index:z.number().int().min(0).max(9).optional(),max:z.number().int().min(0).max(9).optional()}).strict().optional(),
  models:z.array(z.string().min(1).max(128)).max(24).optional(), efforts:z.array(z.string().max(64)).max(10).optional(),
  inputReady:z.boolean().optional(),
  generationActive:z.boolean().optional(),
  nativeVoice:z.boolean().optional(),
  visibility:z.enum(["visible","hidden"]),blocked:z.boolean(),
  turns:z.array(z.object({id:turnId,reply:z.string().max(4000),role:z.enum(["user","assistant"]).optional(), prompts:z.array(z.object({id:turnId,text:z.string().max(4000)}).strict()).max(10).optional(),completed:z.boolean(),
    evidence:z.literal("response-actions-without-stop").nullable()}).strict()).max(20),
}).strict();
export type BrowserObservation=z.infer<typeof browserObservationSchema>;
const modelName=/^[A-Za-z0-9_.:/ -]{1,128}$/u;
/** Model/effort the page reports for a Codex cloud chat (never Dot). Unknown effort labels become "Level n". */
export function cloudModelFields(value:Pick<BrowserObservation,"model"|"effort"|"models"|"efforts">):Pick<CloudSnapshot,"cloudModel"|"cloudModels"|"cloudEffort"|"cloudEfforts">{
  const models=(value.models??[]).filter(m=>modelName.test(m)&&!/^Default/iu.test(m));
  const cloudModel=value.model&&modelName.test(value.model)?value.model:undefined;
  if(cloudModel&&!models.includes(cloudModel))models.push(cloudModel);
  const efforts=value.efforts?.map((label,i)=>label.trim()||`Level ${i+1}`);
  const index=value.effort?.index;
  const effort=value.effort&&index!==undefined?{index,label:value.effort.label}:undefined;
  return {...(cloudModel?{cloudModel}:{}),...(models.length?{cloudModels:models.slice(0,24)}:{}),
    ...(effort?{cloudEffort:effort}:{}),...(efforts?.length?{cloudEfforts:efforts}:{})};
}
export class BrowserCloudObserver {
  private documentId="";
  private requests=new Map<string,string>();
  linkRequest(messageId:string,requestId:string):void{this.requests.set(messageId,requestId);if(this.requests.size>256)this.requests.delete(this.requests.keys().next().value!);}
  private known=new Set<string>();
  private pending=new Set<string>();
  private latest:BrowserObservation|null=null;
  constructor(private readonly target:{threadId:string;title:string;url?:string;dotNamespace?:string;sendEnabled?:boolean},
    private readonly snapshot:(value:CloudSnapshot,at:number)=>void,
    private readonly terminal:(value:CloudTerminal)=>void){}
  /** Dynamic chats follow the page title; the target object is owned by the registry. */
  setTitle(title:string):void{(this.target as {title:string}).title=title;}
  accept(value:BrowserObservation):{baseline:boolean;turns:number;completed:number;pending:number} {
    const expected=this.target.url ?? `https://chatgpt.com/local/${this.target.threadId}`;
    if(this.target.dotNamespace && value.identity!==this.target.dotNamespace)throw new Error("Wrong Dot identity");
    if(value.url!==expected || value.observedAt>Date.now()+5000 || Date.now()-value.observedAt>10000)throw new Error("Unexpected or stale browser observation");
    const baseline=this.documentId!==value.documentId;
    if(baseline){this.documentId=value.documentId;this.known.clear();this.pending.clear();}
    const previousLast=this.latest?.turns.at(-1)?.id;
    const previousIndex=value.turns.findIndex(t=>t.id===previousLast);
    this.latest=value;
    if(value.blocked){this.pending.clear();this.known.clear();this.documentId="";this.snapshot({threadId:this.target.threadId,title:this.target.title,status:"notLoaded",messages:[]},value.observedAt);return {baseline:true,turns:0,completed:0,pending:0};}
    // Empty initial/loading pages cannot establish a history baseline. A new
    // document always baselines history and never replays old completion alerts.
    if(!value.turns.length){
      if(!this.target.dotNamespace && value.generationActive!==undefined)
        this.snapshot({threadId:this.target.threadId,title:this.target.title,status:value.generationActive?"active":"idle",inputReady:Boolean(this.target.sendEnabled&&value.inputReady),nativeVoice:value.nativeVoice===true,...cloudModelFields(value),messages:[]},value.observedAt);
      this.documentId="";return {baseline:true,turns:0,completed:0,pending:0};}
    let completed=0;
    const parents=new Map<string,string>();
    let latestUser:string|undefined;
    for(const turn of value.turns){
      if(turn.role==="user")latestUser=turn.id;
      parents.set(turn.id,this.target.dotNamespace ? latestUser??turn.id : turn.id);
    }
    const terminals:CloudTerminal[]=[];
    for(const [index,turn] of value.turns.entries()){
      if(this.target.dotNamespace && turn.role!=="user" && !baseline && !this.known.has(turn.id) && previousIndex>=0 && index>previousIndex)this.pending.add(turn.id);
      // Initial content can hydrate in stages. Even apparently unfinished
      // baseline turns are history; only turns first observed later can alert.
      if(turn.role!=="user" && !baseline && !turn.completed && !this.known.has(turn.id))this.pending.add(turn.id);
      if(turn.completed && turn.evidence && turn.reply && this.pending.has(turn.id)){
        this.pending.delete(turn.id);completed++;
        terminals.push({eventId:cloudEventId(this.target.threadId,turn.id,"terminal.completed"),threadId:this.target.threadId,turnId:turn.id,
          ...(this.requests.has(parents.get(turn.id)!)?{requestId:this.requests.get(parents.get(turn.id)!)!}:{}),
          kind:"terminal.completed",turnScope:"topLevel",title:this.target.title,detail:turn.reply.slice(0,400),
          occurredAt:value.observedAt,nativeCompletedAt:null,observedAt:value.observedAt,source:"browser-ui"});
      }
      this.known.add(turn.id);
    }
    if(this.known.size>256)this.known=new Set([...this.known].slice(-128));
    // Final text is sent with its actual stable cloud turn ID. UI observation
    // timestamps are never represented as native/server completion timestamps.
    // Pending history is receipt/completion evidence, not proof of ongoing generation.
    // Legacy receivers with a ready composer also prove that generation has ended.
    const working=this.target.dotNamespace ? this.pending.size>0 :
      value.generationActive ?? (value.inputReady===true ? false : this.pending.size>0);
    this.snapshot({threadId:this.target.threadId,title:this.target.title,status:working?"active":"idle",
      inputReady:Boolean(this.target.sendEnabled && value.inputReady),
      ...(value.nativeVoice !== undefined ? { nativeVoice: value.nativeVoice === true } : {}),
      ...(this.target.dotNamespace?{}:cloudModelFields(value)),
      messages:value.turns.flatMap(t=>[
        ...(t.prompts??[]).map(p=>({id:`user:${p.id}`,turnId:t.id,...(this.requests.has(p.id)?{watchRequestId:this.requests.get(p.id)!}:{}),role:"user" as const,kind:"message" as const,text:p.text,
          phase:"unknown" as const,approvalId:null,canControl:false as const,resolved:true as const})),
        ...(t.completed&&t.reply?[{id:`browser:${t.id}`,turnId:parents.get(t.id)!,...(this.requests.has(t.id)?{watchRequestId:this.requests.get(t.id)!}:{}),role:t.role??"assistant",kind:"message" as const,text:t.reply,
          phase:t.role==="user"?"unknown" as const:"final_answer" as const,approvalId:null,canControl:false as const,resolved:true as const}]:[])
      ]).slice(-20)},value.observedAt);
    for(const event of terminals)this.terminal(event);
    return {baseline,turns:value.turns.length,completed,pending:this.pending.size};
  }
}

export type CloudObserverTarget={threadId:string;title:string;url?:string;dotNamespace?:string;sendEnabled?:boolean};
/**
 * Observers for the configured targets plus, when enabled, one per open
 * `https://chatgpt.com/local/<uuid>` tab (capped; the oldest-observed is evicted).
 * Observations for any other URL resolve to null and are ignored by the host.
 */
export class BrowserCloudObservers {
  private readonly fixed=new Map<string,BrowserCloudObserver>();
  private readonly dynamic=new Map<string,{observer:BrowserCloudObserver;threadId:string;observedAt:number}>();
  constructor(targets:readonly CloudObserverTarget[],private readonly auto:boolean,
    private readonly snapshot:(value:CloudSnapshot,at:number)=>void,
    private readonly terminal:(value:CloudTerminal)=>void,
    private readonly onEvict:(url:string)=>void=()=>{}){
    for(const target of targets)this.fixed.set(target.url??`https://chatgpt.com/local/${target.threadId}`,new BrowserCloudObserver(target,snapshot,terminal));
  }
  /** Observer for an observation, creating a dynamic one for a valid local chat URL; null when the page is not wanted. */
  resolve(value:Pick<BrowserObservation,"url"|"title"|"observedAt">):BrowserCloudObserver|null{
    const fixed=this.fixed.get(value.url);if(fixed)return fixed;
    if(!this.auto)return null;
    const threadId=localCloudChatThreadId(value.url);if(!threadId)return null;
    const title=value.title?.trim()||DEFAULT_CLOUD_CHAT_TITLE;
    let entry=this.dynamic.get(value.url);
    if(!entry){
      entry={observer:new BrowserCloudObserver({threadId,title,url:value.url,sendEnabled:true},this.snapshot,this.terminal),threadId,observedAt:value.observedAt};
      this.dynamic.set(value.url,entry);
      while(this.dynamic.size>MAX_DYNAMIC_CLOUD_CHATS){
        let oldest:string|undefined;
        for(const [url,candidate] of this.dynamic)if(url!==value.url&&(oldest===undefined||candidate.observedAt<this.dynamic.get(oldest)!.observedAt))oldest=url;
        if(oldest===undefined)break;
        this.dynamic.delete(oldest);this.onEvict(oldest);
      }
    }else{entry.observedAt=value.observedAt;entry.observer.setTitle(title);}
    return entry.observer;
  }
  /** True when the thread is an open dynamic cloud chat (sends are allowed). */
  isDynamicThread(threadId:string):boolean{for(const entry of this.dynamic.values())if(entry.threadId===threadId)return true;return false;}
  get dynamicCount():number{return this.dynamic.size;}
}
