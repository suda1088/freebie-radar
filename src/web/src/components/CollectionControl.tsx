import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Play, Radio, RefreshCw } from "lucide-react";
import type { Source } from "../types.ts";
import "../collection-control.css";

type Result = { sourceId:string;status:"ok"|"degraded"|"failed"|"skipped";fetched:number;inserted:number;error:string|null };
type Snapshot = {
 scheduler:{enabled:boolean;tickMs:number;busy:boolean;lastTickAt:string|null;lastError:string|null};
 batch:null|{id:string;status:"running"|"completed"|"failed"|"interrupted";startedAt:string;finishedAt:string|null;total:number;completed:number;currentSourceId:string|null;results:Result[];error:string|null};
 activeSourceIds:string[];
};
function beijing(value:string|null) {
 if(!value||!Number.isFinite(Date.parse(value)))return "暂无记录";
 return new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false});
}
export function CollectionControl({sources,onNotify}:{sources:Source[];onNotify?:(message:string)=>void}) {
 const [data,setData]=useState<Snapshot|null>(null),[starting,setStarting]=useState(false),[error,setError]=useState("");
 const alive=useRef(true),startLock=useRef(false),pending=useRef(new Set<AbortController>()),completedId=useRef<string|null>(null);
 const apply=useCallback((snapshot:Snapshot)=>{
  if(!alive.current)return;
  setData(snapshot);
  if(snapshot.batch?.status==="running") completedId.current=snapshot.batch.id;
  else if(snapshot.batch&&completedId.current===snapshot.batch.id){completedId.current=null;window.dispatchEvent(new Event("radar:collection-completed"));}
 },[]);
 const read=useCallback(async()=>{
  const controller=new AbortController();pending.current.add(controller);
  try {
   const response=await fetch("/api/collection",{cache:"no-store",signal:controller.signal});
   if(!response.ok)throw Error(response.status===401?"登录已失效，请重新登录":response.status===403?"没有权限读取采集状态":`无法读取采集状态（HTTP ${response.status}）`);
   const snapshot=await response.json() as Snapshot;apply(snapshot);return snapshot;
  } finally {pending.current.delete(controller);}
 },[apply]);
 useEffect(()=>{
  alive.current=true;let timer:number|undefined;
  const tick=async()=>{let running=false;try{const snapshot=await read();running=snapshot.batch?.status==="running";if(alive.current)setError("");}catch(e){if(alive.current&&!(e instanceof DOMException&&e.name==="AbortError"))setError(e instanceof Error?e.message:"无法读取采集状态");}finally{if(alive.current)timer=window.setTimeout(()=>void tick(),running?2000:5000);}};
  void tick();return()=>{alive.current=false;window.clearTimeout(timer);for(const controller of pending.current)controller.abort();pending.current.clear();};
 },[read]);
 const start=async()=>{
  if(startLock.current||starting||data?.batch?.status==="running")return;
  startLock.current=true;setStarting(true);setError("");
  const controller=new AbortController();pending.current.add(controller);
  try {
   const response=await fetch("/api/collection/run",{method:"POST",headers:{"content-type":"application/json"},body:"{}",signal:controller.signal});
   if(!response.ok){const body=await response.json().catch(()=>({})) as {error?:string};throw Error(body.error??`启动失败（HTTP ${response.status}）`);}
   const snapshot=await response.json() as Snapshot;apply(snapshot);onNotify?.(snapshot.batch?.status==="running"?"采集任务已在后台运行，可离开此页":"本轮采集任务已完成");
  } catch(e) {
   if(alive.current){setError("启动结果暂未确认，正在核对后台状态；不会自动重复提交。");try{const state=await read();if(state.batch?.status==="running")setError("已发现后台正在运行的任务，请查看进度。此前网络响应未完成。");else setError((e instanceof Error?e.message:"启动失败")+"；未确认本次是否已执行，请先查看任务记录再决定是否重试。");}catch{setError("无法确认启动结果。请恢复网络并刷新状态，不要连续点击启动。");}}
  } finally {pending.current.delete(controller);startLock.current=false;if(alive.current)setStarting(false);}
 };
 const enabled=sources.filter(s=>s.enabled).length,batch=data?.batch,running=batch?.status==="running";
 const name=(id:string)=>sources.find(s=>s.id===id)?.name??id;
 const count=(status:Result["status"])=>batch?.results.filter(r=>r.status===status).length??0;
 return <section className="soda-collection-control" aria-label="采集调度与一键任务">
  <header><span className="collection-symbol"><Radio size={21}/></span><div><h3>让发现按时到来</h3><p>自动采集按各来源的间隔运行；也可以主动收集一轮。</p></div><span className={"collection-scheduler-state "+(data?.scheduler.enabled?"on":"off")}><i/>{data?data.scheduler.enabled?"自动采集已开启":"自动采集已关闭":"正在读取调度状态"}</span></header>
  <div className="collection-command"><div><strong>{enabled} 个已启用来源</strong><p>一键采集会忽略本轮是否到期，依次尝试已启用项；未启用来源不参与。</p></div><button type="button" className="collection-start" disabled={!data||starting||running||enabled===0} onClick={()=>void start()}>{starting||running?<Loader2 size={16} className="animate-spin"/>:<Play size={15}/>}<span>{starting?"正在启动…":running?"本轮采集中…":"一键采集已启用来源"}</span></button></div>
  <div className="collection-runtime"><span>调度巡检：{data?Math.round(data.scheduler.tickMs/1000):"—"} 秒</span><span>最近巡检（北京时间）：{beijing(data?.scheduler.lastTickAt??null)}</span>{data?.scheduler.busy&&<span>自动采集轮次执行中</span>}{Boolean(data?.activeSourceIds.length)&&<span>{data!.activeSourceIds.length} 个来源执行或排队中</span>}</div>
  <p className="collection-note">间隔是到期条件，不保证整点启动；来源按队列执行，网络等待会推迟开始时间。已在采集的相同来源复用当前任务，缺少登录态的来源会注明跳过。新内容仍遵循你现有的 AI 审核与推送规则。</p>
  {(error||data?.scheduler.lastError)&&<p className="collection-error" role="alert">{error||data?.scheduler.lastError}</p>}
  {batch&&<div className="collection-batch" aria-live="polite"><div className="collection-batch-heading"><strong>{running?<Loader2 size={15} className="animate-spin"/>:<Check size={15}/>} {running?"本轮进度":batch.status==="completed"?"最近一轮已结束":batch.status==="interrupted"?"最近一轮被重启中断":"最近一轮未正常完成"}</strong><span>{batch.completed} / {batch.total}</span></div><progress max={Math.max(1,batch.total)} value={batch.completed} aria-label="采集来源完成数"/><p className="collection-current">{running?(batch.currentSourceId?`正在处理：${name(batch.currentSourceId)}`:"正在准备下一个来源…"):`结束时间（北京时间）：${beijing(batch.finishedAt)}`}</p><div className="collection-totals"><span>成功 {count("ok")}</span><span>部分异常 {count("degraded")}</span><span>失败 {count("failed")}</span><span>跳过 {count("skipped")}</span><span>新增 {batch.results.reduce((n,r)=>n+r.inserted,0)} 条</span></div>{batch.error&&<p className="collection-error">{batch.error}</p>}<details><summary>查看逐来源结果<ChevronDown size={13}/></summary><ul>{batch.results.map(result=><li key={result.sourceId}><strong>{name(result.sourceId)}</strong><span>{({ok:"成功",degraded:"部分异常",failed:"失败",skipped:"跳过"} as const)[result.status]} · 抓取 {result.fetched} · 新增 {result.inserted}</span>{result.error&&<p>{result.error}</p>}</li>)}</ul>{!batch.results.length&&<p className="collection-current">本轮暂无完成的来源。</p>}</details></div>}
  <button type="button" className="collection-read" onClick={()=>void read().catch(e=>{if(alive.current)setError(e instanceof Error?e.message:"无法刷新状态");})}><RefreshCw size={13}/>刷新状态（不会启动采集）</button>
 </section>;
}