import { randomUUID } from "node:crypto";
import { all, get, run } from "./db.ts";
import { config } from "./config.ts";
import { activeSourceIds, COLLECTORS, runSource, type RunSummary } from "./collectors/index.ts";
import { hasCookieConfiguredForSource } from "./cookie-store.ts";

export type BatchResult = {sourceId:string;status:"ok"|"degraded"|"failed"|"skipped";fetched:number;inserted:number;error:string|null};
export type CollectionBatch = {id:string;status:"running"|"completed"|"failed"|"interrupted";startedAt:string;finishedAt:string|null;total:number;completed:number;currentSourceId:string|null;results:BatchResult[];error:string|null};
export const collectionSchedulerState = { enabled:config.enableCollectionScheduler,tickMs:30_000,busy:false,lastTickAt:null as string|null,lastError:null as string|null };
const knownKinds = new Set(COLLECTORS.map(c=>c.kind));
export function initCollectionJobs() {
 if (active?.status === "running") return;
 run(`CREATE TABLE IF NOT EXISTS collection_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, started_at TEXT NOT NULL, snapshot TEXT NOT NULL)`);
 for(const row of all<{id:string;snapshot:string}>("SELECT id,snapshot FROM collection_jobs WHERE status='running'")) {
  const batch=JSON.parse(row.snapshot) as CollectionBatch;batch.status="interrupted";batch.finishedAt=new Date().toISOString();batch.currentSourceId=null;batch.error="服务重启中断了本轮任务；未执行的来源不会自动补跑，请按需重新发起。";save(batch);
 }
}
function save(batch:CollectionBatch) {
 run("INSERT INTO collection_jobs(id,status,started_at,snapshot) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,snapshot=excluded.snapshot",batch.id,batch.status,batch.startedAt,JSON.stringify(batch));
}
let active:CollectionBatch|null=null;
export const batchIsRunning = () => active?.status === "running";
export function collectionSnapshot() {
 const row=get<{snapshot:string}>("SELECT snapshot FROM collection_jobs ORDER BY started_at DESC,rowid DESC LIMIT 1");
 return {scheduler:{...collectionSchedulerState},batch:active??(row?JSON.parse(row.snapshot) as CollectionBatch:null),activeSourceIds:activeSourceIds()};
}
type Dependencies = {
 collect?:(id:string)=>Promise<RunSummary>;
 enabledSources?:()=>{id:string;kind:string}[];
 skipReason?:(id:string)=>string|null;
 now?:()=>Date;
};
export function sourceSkipReason(id:string):string|null {
 const source=get<{enabled:number;kind:string}>("SELECT enabled,kind FROM sources WHERE id=?",id);
 if(!source)return "来源已删除";
 if(!source.enabled)return "等待期间来源被停用，已跳过";
 if(!knownKinds.has(source.kind))return "此来源没有可用的采集器";
 if(config.enabledSources.length&&!config.enabledSources.includes(id))return "来源未被纳入服务端允许采集名单";
 if(source.kind==="ingest"&&!hasCookieConfiguredForSource(id))return "该来源需要登录态或回传执行器，尚未配置，无法主动采集";
 return null;
}
/** One process, one persisted batch; POST returns immediately and repeated running requests reuse it. */
export function startCollectionBatch(deps:Dependencies={}) {
 if(active?.status==="running")return {started:false,batch:active};
 const now=deps.now??(()=>new Date());
 const rows=deps.enabledSources?.()??all<{id:string;kind:string}>("SELECT id,kind FROM sources WHERE enabled=1 ORDER BY id");
 const batch:CollectionBatch={id:randomUUID(),status:"running",startedAt:now().toISOString(),finishedAt:null,total:rows.length,completed:0,currentSourceId:null,results:[],error:null};
 active=batch;save(batch);
 // Retain only latest20 terminal summaries; real per-source run history stays untouched.
 run("DELETE FROM collection_jobs WHERE status<>'running' AND id NOT IN (SELECT id FROM collection_jobs ORDER BY started_at DESC,rowid DESC LIMIT 20)");
 void execute().catch(error=>{
  batch.status="failed";batch.error=error instanceof Error?error.message:String(error);batch.currentSourceId=null;batch.finishedAt=now().toISOString();
  try{save(batch);}finally{active=null;}
 });
 async function execute() {
  for(const row of rows) {
   const reason=(deps.skipReason??sourceSkipReason)(row.id);
   if(reason) {batch.results.push({sourceId:row.id,status:"skipped",fetched:0,inserted:0,error:reason});batch.completed++;save(batch);continue;}
   batch.currentSourceId=row.id;save(batch);
   try {
    const result=await (deps.collect??((id:string)=>runSource(id,{enabledOnly:true})))(row.id);
    batch.results.push({sourceId:row.id,status:result.status,fetched:result.fetched,inserted:result.inserted,error:result.error});
   } catch(error) {const message=error instanceof Error?error.message:String(error);batch.results.push({sourceId:row.id,status:message==="source_disabled_before_start"?"skipped":"failed",fetched:0,inserted:0,error:message==="source_disabled_before_start"?"等待期间来源被停用，已跳过":message});}
   batch.completed++;batch.currentSourceId=null;save(batch);
  }
  batch.status="completed";batch.finishedAt=now().toISOString();save(batch);active=null;
 }
 return {started:true,batch};
}