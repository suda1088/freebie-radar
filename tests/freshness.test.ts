import assert from "node:assert/strict";
import {test} from "node:test";
import {freshnessOf,recordedTime,formatRecordedTime} from "../src/web/src/lib/freshness.ts";
const now=Date.parse("2026-11-15T06:30:00Z");
test("expiry boundary is inclusive; exactly24h and1ms beyond use different labels",()=>{
 assert.equal(freshnessOf({expires_at:"2026-11-15T06:30:00Z"},now).state,"expired");
 assert.equal(freshnessOf({expires_at:"2026-11-16T06:30:00Z"},now).state,"soon");
 assert.equal(freshnessOf({expires_at:"2026-11-16T06:30:00.001Z"},now).state,"dated");
});
test("missing, invalid and timezone-ambiguous records stay unknown",()=>{
 for(const v of [null,"","bad","2026-11-15","2026-11-15T14:30:00","2026-02-30T14:30:00Z","2026-11-15T24:30:00Z"]){assert.equal(recordedTime(v),null,String(v));assert.equal(freshnessOf({expires_at:v},now).state,"unknown");}
 assert.match(freshnessOf({expires_at:"bad"},now).deadline,/无法解析/);
});
test("timestamps with explicit offsets are equal and displayed in Beijing time",()=>{
 assert.equal(recordedTime("2026-11-15T14:30:00+08:00"),now);
 assert.match(formatRecordedTime(now),/14:30/);
});
test("recent capture never claims independent availability verification",()=>{
 const r=freshnessOf({last_seen_at:"2026-11-15T06:29:00Z"},now);assert.equal(r.seenLabel,"最近采集：1 分钟前");assert.match(r.caveat,/不代表已核验/);assert.equal(r.state,"unknown");
});
test("old, unknown and future capture records require caution without fabricated age",()=>{
 assert.equal(freshnessOf({last_seen_at:"2026-11-08T06:30:00Z"},now).needsReview,true);
 assert.equal(freshnessOf({},now).seenLabel,"最近采集时间未知");
 const future=freshnessOf({last_seen_at:"2026-11-15T07:30:00Z"},now);assert.equal(future.seenLabel,"采集记录时间异常");assert.equal(future.needsReview,true);
});
test("expired, news and ordinary entries use same honest source-date policy",()=>{
 const r=freshnessOf({expires_at:"2026-11-14T06:30:00Z",last_seen_at:"2026-11-15T06:29:00Z"},now);assert.equal(r.state,"expired");assert.match(r.caveat,/是否延期/);assert.equal(r.needsReview,true);
});