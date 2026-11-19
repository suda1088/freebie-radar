import assert from "node:assert/strict";
import { test } from "node:test";
import { explainFailure } from "../src/web/src/lib/failures.ts";

test("generic 403 never claims exhausted quota or verified Cloudflare challenge", () => {
 for(const source of ["github-free-for-dev","rss-deepflood",""]) {
  const r=explainFailure("Error: 全部 feed 失败: HTTP 403",source);
  assert.equal(r.title,"上游拒绝访问");assert.equal(r.inferred,true);
  assert.doesNotMatch(r.reason,/已耗尽|包含人机验证/);
 }
});
test("explicit evidence distinguishes quota exhaustion from challenge", () => {
 assert.equal(explainFailure("API rate limit exceeded for this address","github-selfhosted").title,"上游配额已耗尽");
 assert.equal(explainFailure("HTTP 403 cf-mitigated: challenge Just a moment...").title,"上游要求验证");
});
test("429, invalid credentials and missing setup give different guidance", () => {
 assert.equal(explainFailure("AI HTTP 429: group requests-per-minute").title,"请求过于频繁");
 assert.equal(explainFailure("HTTP 401").title,"登录或凭据需要检查");
 assert.equal(explainFailure("Cookie 已失效，请重新粘贴更新").title,"登录或凭据需要检查");
 assert.equal(explainFailure("未配置 channels").title,"必要配置尚未完成");
});
test("unknown text stays unknown and status matching avoids incidental numbers", () => {
 assert.equal(explainFailure("Received 403 items in 429 ms").title,"任务未完成");
 assert.equal(explainFailure("Unexpected result").inferred,true);
 assert.equal(explainFailure("connect timeout").title,"连接或响应超时");
 assert.equal(explainFailure("HTTP 503").title,"上游服务暂时异常");
});