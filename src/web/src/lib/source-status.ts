import type { Source } from "../types.ts";
export type SourceView = "all" | "ok" | "error" | "disabled" | "missing" | "running";
export function sourceNeedsSetup(source:Source, cookieReady?:boolean): string|null {
 if(source.kind==="ingest")return cookieReady===false?"需要配置登录态":null;
 if(source.kind==="telegram"&&(!Array.isArray(source.config.channels)||source.config.channels.length===0))return "尚未填写频道";
 if(source.kind==="rss"&&(!Array.isArray(source.config.feeds)||source.config.feeds.length===0))return "尚未填写订阅地址";
 return null;
}
export function sourceDueLabel(source:Pick<Source,"enabled"|"interval_sec"|"last_run_at">,now:number,active=false,missing=false){
 if(!source.enabled)return "已停用，不参与自动采集";
 if(missing)return "补齐配置后才能采集";
 if(active)return "执行或排队中";
 if(!source.last_run_at)return "尚无运行记录，等待调度";
 const last=Date.parse(source.last_run_at);
 if(!Number.isFinite(last)||!Number.isFinite(source.interval_sec)||source.interval_sec<=0)return "到期时间未知";
 const due=last+source.interval_sec*1000;
 if(due<=now)return "已到期，等待队列调度";
 return "预计到期 "+new Date(due).toLocaleTimeString("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hour12:false})+"（北京时间）";
}
export function sourceMatchesView(source:Source,view:SourceView,active:boolean,missing:boolean){
 if(view==="disabled")return !source.enabled;
 if(view==="running")return active;
 if(view==="missing")return missing;
 if(view==="error")return source.last_status==="failed"||source.last_status==="degraded";
 if(view==="ok")return source.enabled&&source.last_status==="ok"&&!missing;
 return true;
}