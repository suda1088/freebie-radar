import assert from "node:assert/strict";
import {after,test} from "node:test";
process.env.DATABASE_PATH=":memory:";
process.env.ENABLE_COLLECTION_SCHEDULER="true";
process.env.ENABLE_SCHEDULER="false";
process.env.SOURCE_GAP_MS="1";
process.env.PUSH_CHANNEL="none";
const {migrate,run,get,all,closeDb}=await import("../src/server/db.ts");
const {ensureSources,runSource,activeSourceIds}=await import("../src/server/collectors/index.ts");
const {initCollectionJobs,startCollectionBatch,collectionSnapshot}=await import("../src/server/collection-jobs.ts");
const {listDueSourceIds,startIntervalScheduler,stopIntervalScheduler}=await import("../src/server/cron.ts");
const {config}=await import("../src/server/config.ts");
const {Hono}=await import("hono");
const {registerApi}=await import("../src/server/routes.ts");
const {registerSiteAuth}=await import("../src/server/site-auth.ts");
migrate();ensureSources();initCollectionJobs();
after(()=>{stopIntervalScheduler();closeDb();});
const summary=(id:string)=>({sourceId:id,status:"ok" as const,fetched:2,inserted:1,skipped:1,durationMs:1,error:null,cursor:null});
async function until(check:()=>boolean) {for(let i=0;i<500;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw new Error("test condition not reached");}
function source(id:string,kind="mock",enabled=1,last:string|null=null) {run("INSERT INTO sources(id,name,kind,enabled,config,created_at,interval_sec,last_run_at) VALUES(?,?,?,?,?, ?,60,?)",id,id,kind,enabled,JSON.stringify({fail:false}),new Date().toISOString(),last);}

test("batch starts enabled snapshot once, duplicate starts reuse it, disabled while waiting is skipped",async()=>{
 run("UPDATE sources SET enabled=0");source("batch-one");source("batch-two");source("batch-off","mock",0);source("batch-cookie","ingest");
 let release!:()=>void;const seen:string[]=[];
 const deps={collect:async(id:string)=>{seen.push(id);if(id==="batch-one")await new Promise<void>(r=>release=r);return summary(id);}};
 const first=startCollectionBatch(deps);assert(first.started);assert.equal(first.batch.total,3);
 await until(()=>Boolean(release));const duplicate=startCollectionBatch(deps);assert.equal(duplicate.started,false);assert.equal(duplicate.batch.id,first.batch.id);
 run("UPDATE sources SET enabled=0 WHERE id='batch-two'");release();await until(()=>collectionSnapshot().batch?.status!=="running");
 const batch=collectionSnapshot().batch!;assert.equal(batch.status,"completed");assert.equal(batch.completed,3);assert.deepEqual(seen,["batch-one"]);assert.equal(batch.results.filter(x=>x.status==="skipped").length,2);assert(!batch.results.some(x=>x.sourceId==="batch-off"));
});
test("one failure is recorded without abandoning remaining enabled sources",async()=>{
 run("UPDATE sources SET enabled=0");source("failure-one");source("failure-two");const seen:string[]=[];
 startCollectionBatch({collect:async id=>{seen.push(id);if(id==="failure-one")throw Error("fixture unavailable");return summary(id);}});
 await until(()=>collectionSnapshot().batch?.status!=="running");const batch=collectionSnapshot().batch!;assert.deepEqual(seen,["failure-one","failure-two"]);assert.equal(batch.results[0]?.status,"failed");assert.equal(batch.results[1]?.status,"ok");assert.equal(batch.completed,2);
});
test("incomplete stored batch is marked interrupted on next startup, not silently resumed",()=>{
 const batch={id:"restart-fixture",status:"running",startedAt:"2099-01-01T00:00:00Z",finishedAt:null,total:4,completed:1,currentSourceId:"unknown",results:[],error:null};run("INSERT INTO collection_jobs VALUES(?,?,?,?)",batch.id,batch.status,batch.startedAt,JSON.stringify(batch));initCollectionJobs();const saved=JSON.parse(get<{snapshot:string}>("SELECT snapshot FROM collection_jobs WHERE id=?",batch.id)!.snapshot);assert.equal(saved.status,"interrupted");assert.equal(saved.completed,1);assert.match(saved.error,/重启/);run("DELETE FROM collection_jobs WHERE id=?",batch.id);
});
test("same-source manual and scheduled callers share one promise and one real run",async()=>{
 source("dedup-rss","rss",1);run("UPDATE sources SET config=? WHERE id='dedup-rss'",JSON.stringify({feeds:[{id:"fixture",url:"https://fixture.invalid/rss"}]}));
 let release!:()=>void;let calls=0;
 const http={text:async()=>{calls++;await new Promise<void>(r=>release=r);return {status:200,body:'<?xml version="1.0"?><rss version="2.0"><channel><title>fixture</title></channel></rss>',url:"https://fixture.invalid/rss",headers:new Headers(),bytes:Buffer.alloc(0),contentType:"application/xml"};},raw:async()=>{throw Error("unused");},json:async<T>()=>{throw Error("unused");}};
 const a=runSource("dedup-rss",{http,log:()=>{}}),b=runSource("dedup-rss",{http,log:()=>{}});assert.strictEqual(a,b);await until(()=>Boolean(release));assert(activeSourceIds().includes("dedup-rss"));release();await a;assert.equal(calls,1);assert.equal(get<{n:number}>("SELECT count(*) n FROM runs WHERE source_id='dedup-rss'")!.n,1);assert(!activeSourceIds().includes("dedup-rss"));
});
test("due query respects enabled flag, actual interval, missing login setup and active-source exclusions",async()=>{
 run("UPDATE sources SET enabled=0");const past=new Date(Date.now()-120000).toISOString();source("due-source","mock",1,past);source("future-source","mock",1,new Date().toISOString());source("disabled-due","mock",0,past);source("unconfigured-ingest","ingest",1,past);
 const due=listDueSourceIds();assert(due.includes("due-source"));assert(!due.includes("future-source"));assert(!due.includes("disabled-due"));assert(!due.includes("unconfigured-ingest"));
 run("UPDATE sources SET enabled=0 WHERE id<>'due-source'");assert.equal(config.enableScheduler,false);assert.equal(config.enableCollectionScheduler,true);startIntervalScheduler({tickMs:20,log:()=>{}});await until(()=>Boolean(get("SELECT id FROM runs WHERE source_id='due-source' AND status<>'running'")));assert(get("SELECT last_run_at FROM sources WHERE id='due-source'")!);assert.equal(get<{n:number}>("SELECT count(*) n FROM runs WHERE source_id='due-source'")!.n,1);
 run("UPDATE sources SET last_run_at=? WHERE id='due-source'",past);
 await until(()=>get<{n:number}>("SELECT count(*) n FROM runs WHERE source_id='due-source' AND status='ok'")!.n===2);
 stopIntervalScheduler();assert.equal(get<{n:number}>("SELECT count(*) n FROM runs WHERE source_id='due-source'")!.n,2);
});
test("collect-all GET/POST require login and same-origin; malformed payload rejected without task start",async()=>{
 const app=new Hono();registerSiteAuth(app,{enabled:true,password:"fixture-pass",origin:"http://localhost"});registerApi(app);
 assert.equal((await app.request('/api/collection')).status,401);assert.equal((await app.request('/api/collection/run',{method:'POST',body:'{}'})).status,401);
 const login=await app.request('/auth/login',{method:'POST',headers:{origin:'http://localhost','content-type':'application/x-www-form-urlencoded'},body:'password=fixture-pass'});const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
 const headers={cookie,origin:'http://localhost','content-type':'application/json'};assert.equal((await app.request('/api/collection',{headers})).status,200);
 assert.equal((await app.request('/api/collection/run',{method:'POST',headers:{...headers,origin:'https://evil.invalid'},body:'{}'})).status,403);
 assert.equal((await app.request('/api/collection/run',{method:'POST',headers,body:'{"ids":["anything"]}'})).status,400);
 run("UPDATE sources SET enabled=0");const result=await app.request('/api/collection/run',{method:'POST',headers,body:'{}'});assert.equal(result.status,202);await until(()=>collectionSnapshot().batch?.status!=="running");assert.equal(collectionSnapshot().batch?.total,0);
});