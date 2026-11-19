import assert from "node:assert/strict";
import {test} from "node:test";
import {savedRoute,feedHash,withSavedScope} from "../src/web/src/lib/feed-scope.ts";
test("saved scope persists independently of every preset and query constraint",()=>{
 for(const preset of ["all","codes","urgent","hidden","free","deal","news","info","opensource","verified"]){
  const q=new URLSearchParams({preset,hasCodes:"1",source:"test",search:"gift",sort:"score"});
  const result=withSavedScope(q,true);assert.equal(result.get("starred"),"1");assert.equal(result.get("source"),"test");assert.equal(q.has("starred"),false);
  const route=savedRoute(feedHash(true,preset));assert.equal(route.saved,true);assert.equal(route.preset,preset);
 }
});
test("discover explicitly removes saved scope while reload keeps valid saved filter",()=>{
 assert.equal(withSavedScope(new URLSearchParams("starred=1&search=gift"),false).has("starred"),false);
 assert.deepEqual(savedRoute("#saved/codes"),{saved:true,preset:"codes"});
 assert.deepEqual(savedRoute("#saved"),{saved:true,preset:"all"});
 assert.deepEqual(savedRoute("#saved/invalid"),{saved:true,preset:"all"});
 assert.equal(savedRoute("#ops").saved,false);assert.equal(feedHash(false,"codes"),"");
});
