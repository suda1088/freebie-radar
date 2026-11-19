export type FailureExplanation = { title: string; reason: string; action: string; inferred: boolean };
/** Interpret recorded evidence only. HTTP status alone cannot prove a challenge or exhausted quota. */
export function explainFailure(error: string, sourceId = ""): FailureExplanation {
  const text = error.toLowerCase();
  if (/rate limit exceeded|rate.?limit.?remaining[^0-9]*0|配额.*耗尽/.test(text)) return { title: "上游配额已耗尽", reason: "响应明确提示请求配额已用完。", action: sourceId.startsWith("github") ? "等待配额重置，或在来源配置中使用你自己的 GitHub Token；不要连续手动重试。" : "查看上游配额与重置时间，重置前减少请求。", inferred: false };
  if (/cf-mitigated|just a moment|challenge-platform|人机验证|captcha/.test(text)) return { title: "上游要求验证", reason: "响应包含人机验证或挑战页面的特征。", action: "先在浏览器确认来源是否正常开放；普通采集请求可能无法通过验证，反复重试通常无效。", inferred: false };
  if (/(?:http|status|返回|error)[ :：=-]*429\b|too many requests|限流/.test(text)) return { title: "请求过于频繁", reason: "上游正在限制请求频率或并发。", action: "等待后再尝试；如果持续发生，可按上游限制调低请求频率或并发。本页不会自动更改配置。", inferred: false };
  if (/(?:http|status|返回|error)[ :：=-]*403\b/.test(text)) return { title: "上游拒绝访问", reason: "403 可能与权限、访问策略或配额有关，仅凭状态码不能确定原因。", action: sourceId.startsWith("github") ? "核对 GitHub 配额和凭据状态；打开原始记录确认原因后再处理。" : "检查来源在浏览器中能否访问，并核对其公开访问规则或登录要求。", inferred: true };
  if (/(?:http|status|返回|error)[ :：=-]*401\b|cookie.*(?:失效|过期)|凭据.*(?:失效|过期)/.test(text)) return { title: "登录或凭据需要检查", reason: "记录提示鉴权失败或登录状态过期。", action: "在对应来源重新登录或核对凭据。本页不会创建、替换或展示你的密钥。", inferred: false };
  if (/未配置|not configured|missing.*(?:token|channel|key)/.test(text)) return { title: "必要配置尚未完成", reason: "当前任务缺少所需配置。", action: "根据原始记录补齐需要的来源或服务配置，再按需运行。", inferred: false };
  if (/timeout|timed out|超时/.test(text)) return { title: "连接或响应超时", reason: "来源未能在规定时间内完成响应。", action: "稍后重试并检查来源可用性；超时不一定表示来源永久失效。", inferred: false };
  if (/(?:http|status|返回|error)[ :：=-]*5\d\d\b/.test(text)) return { title: "上游服务暂时异常", reason: "记录包含上游服务器错误。", action: "稍后再试；若持续发生，检查该来源服务状态。", inferred: false };
  return { title: "任务未完成", reason: "记录暂不足以自动判断具体原因。", action: "展开原始记录核对详情，再决定是否需要调整配置。", inferred: true };
}