import assert from "node:assert/strict";
import {test} from "node:test";
import {sourceDueLabel,sourceNeedsSetup,sourceMatchesView} from "../src/web/src/lib/source-status.ts";
import type {Source} from "../src/web/src/types.ts";
const now=Date.parse("2026-11-15T10:00:00Z");
const s={id:"test",name:"test",kind:"rss",enabled:true,interval_sec:300,last_run_at:"2026-11-15T09:59:00Z",config:{feeds:[{url:"https://example.invalid"}]},last_status:"failed",last_error:"HTTP 403",items:0,latest_item_at:null} as Source;
test("source schedule is explicitly estimated, never guaranteed or guessed",()=>{
 assert.match(sourceDueLabel(s,now),/预计到期/);
 assert.match(sourceDueLabel({...s,last_run_at:"2026-11-15T09:00:00Z"},now),/已到期.*队列/);
 assert.match(sourceDueLabel({...s,last_run_at:null},now),/尚无/);
 assert.match(sourceDueLabel({...s,last_run_at:"invalid"},now),/未知/);
 assert.match(sourceDueLabel({...s,enabled:false},now,true),/已停用/);
 assert.match(sourceDueLabel(s,now,true),/执行或排队/);
});
test("source grouping distinguishes missing, disabled and running without inventing cookie readiness",()=>{
 assert.equal(sourceNeedsSetup(s),null);
 assert.match(sourceNeedsSetup({...s,config:{}})!,/订阅/);
 assert.match(sourceNeedsSetup({...s,kind:"telegram",config:{channels:[]}})!,/频道/);
 assert.equal(sourceNeedsSetup({...s,kind:"ingest"},undefined),null);
 assert.match(sourceNeedsSetup({...s,kind:"ingest"},false)!,/登录态/);
 assert(sourceMatchesView(s,"error",false,false));
 assert(!sourceMatchesView(s,"ok",false,false));
 assert(sourceMatchesView(s,"running",true,false));
 assert(sourceMatchesView(s,"missing",false,true));
});
