import assert from "node:assert/strict";
import {test} from "node:test";
import {buildFeedQuery,type FeedQueryInput} from "../src/web/src/lib/feed-query.ts";
const now=Date.parse("2026-11-15T13:00:00Z");
const defaults:FeedQueryInput={debounced:"",source:"",categories:[],lang:"all",sort:"newest",range:"auto",priceCap:"auto",preset:"verified",kindFilter:"auto",obtain:"auto",minScore:"all",unreadOnly:false,savedOnly:false};
const q=(patch:Partial<FeedQueryInput>={})=>new URLSearchParams(buildFeedQuery({...defaults,...patch},now));
test("extracted verified and free defaults retain their independent acquisition and date constraints",()=>{
 const verified=q();assert.equal(verified.get("kind"),"freebie");assert.equal(verified.get("obtain"),"free,conditional");assert.equal(verified.get("maxAgeDays"),"7");assert.equal(verified.get("aiOnly"),"1");
 const free=q({preset:"free"});assert.equal(free.get("freeOnly"),"1");assert.equal(free.get("obtain"),"free");assert.equal(free.get("maxAgeDays"),"14");assert.equal(free.has("aiOnly"),false);
});
test("every quick/channel preset keeps saved scope and only discovery all defaults to hiding rejected",()=>{
 for(const preset of ["verified","free","deal","opensource","news","info","codes","urgent","hidden","all"]){assert.equal(q({savedOnly:true,preset}).get("starred"),"1",preset);}
 assert.equal(q({savedOnly:true,preset:"all"}).has("hideRejected"),false);assert.equal(q({preset:"all"}).get("hideRejected"),"1");assert.equal(q({preset:"codes"}).get("hasCodes"),"1");assert.equal(q({preset:"urgent"}).get("expiring"),"1");assert.equal(q({preset:"hidden"}).get("status"),"ignored");
});
test("explicit controls override preset defaults without dropping source, category or saved scope",()=>{
 const result=q({savedOnly:true,preset:"verified",kindFilter:"opensource",obtain:"trial",priceCap:"30",range:"3d",source:"rss-fixture",categories:["ai","dev"],lang:"zh",sort:"score",debounced:"example gift",minScore:"60",unreadOnly:true});
 for(const[k,v]of Object.entries({starred:"1",kind:"opensource",obtain:"trial",maxPrice:"30",source:"rss-fixture",category:"ai,dev",lang:"zh",sort:"score",search:"example gift",minScore:"60",unread:"1",limit:"100"}))assert.equal(result.get(k),v,k);
 assert.equal(result.get("since"),new Date(now-3*86400000).toISOString());assert.equal(result.has("maxAgeDays"),false);
});
test("query generation is deterministic and never mutates the filter object",()=>{
 const input={...defaults,categories:["ai"],range:"7d"};const before=JSON.stringify(input);assert.equal(buildFeedQuery(input,now),buildFeedQuery(input,now));assert.equal(JSON.stringify(input),before);
});