import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Loader2, Play, Settings2 } from "lucide-react";
import type { Source, Run } from "../types.ts";
import { formatInterval, timeAgo } from "../lib/sources.ts";
import { sourceDueLabel, sourceNeedsSetup, sourceMatchesView, type SourceView } from "../lib/source-status.ts";
import { Select } from "./Select.tsx";
import { FailureNote } from "./FailureNote.tsx";
import { SaveStatus, type SaveState } from "./SaveStatus.tsx";
import "../usability-polish.css";
const intervals=[60,90,120,300,900,1800,3600,21600];
export function SourceCatalog({sources,runs,filter,view,cookieReady,onToggle,onInterval,onCollect,onConfigure,renderEditor}:{
 sources:Source[];runs:Run[];filter:string;view:SourceView;cookieReady:(s:Source)=>boolean|undefined;
 onToggle:(id:string,v:boolean)=>Promise<void>;onInterval:(id:string,v:number)=>Promise<void>;onCollect:(id:string)=>Promise<void>;
 onConfigure:()=>void;renderEditor:(s:Source,onDone:()=>void)=>ReactNode;
}) {
 const [active,setActive]=useState<string[]>([]),[editing,setEditing]=useState<string|null>(null),[expanded,setExpanded]=useState<string|null>(null),[clock,setClock]=useState(Date.now),[status,setStatus]=useState<Record<string,SaveState>>({}),[collecting,setCollecting]=useState<string[]>([]),[errors,setErrors]=useState<Record<string,string>>({});
 const [stateError,setStateError]=useState(false);
 useEffect(()=>{let alive=true,timer:number;const controller=new AbortController();const read=async()=>{try{const response=await fetch("/api/collection",{cache:"no-store",signal:controller.signal});if(!response.ok)throw Error();const data=await response.json() as {activeSourceIds:string[]};if(alive){setActive(data.activeSourceIds);setStateError(false);}}catch{if(alive)setStateError(true);}finally{if(alive){setClock(Date.now());timer=window.setTimeout(()=>void read(),5000);}}};void read();return()=>{alive=false;clearTimeout(timer);controller.abort();};},[]);
 const missing=(s:Source)=>sourceNeedsSetup(s,cookieReady(s));
 const visible=sources.filter(s=>(!filter||(s.name+" "+s.id+" "+s.kind).toLowerCase().includes(filter.toLowerCase()))&&sourceMatchesView(s,view,active.includes(s.id)||collecting.includes(s.id),Boolean(missing(s))));
 const success=(id:string)=>runs.filter(r=>r.source_id===id&&r.status==="ok"&&r.finished_at).map(r=>r.finished_at!).sort().at(-1)??null;
 async function save(id:string,action:()=>Promise<void>){setStatus(x=>({...x,[id]:"saving"}));setErrors(x=>({...x,[id]:""}));try{await action();setStatus(x=>({...x,[id]:"saved"}));}catch{setStatus(x=>({...x,[id]:"error"}));setErrors(x=>({...x,[id]:"保存失败，当前值以服务端返回结果为准；请重试。"}));}}
 async function collect(id:string){if(collecting.includes(id))return;setCollecting(x=>[...x,id]);setErrors(x=>({...x,[id]:""}));try{await onCollect(id);}catch{setErrors(x=>({...x,[id]:"本次采集未成功，请查看采集记录。"}));}finally{setCollecting(x=>x.filter(v=>v!==id));}}
 return <div className="soda-source-catalog" aria-label="来源管理列表"><p className="source-catalog-note">预计到期仅按最近启动时间和周期计算，不是保证开跑时间；串行队列、网络等待和缺少配置都会影响执行。{stateError&&<strong> 正在采集状态暂时不可读，请刷新确认。</strong>}</p>{!visible.length&&<div className="soda-empty" role="status"><h3>没有符合条件的来源</h3><p>试试清空名称搜索或切换来源分组。</p></div>}
 {visible.map(s=>{const busy=active.includes(s.id)||collecting.includes(s.id),need=missing(s),open=expanded===s.id,edit=editing===s.id;return <section key={s.id} className="source-catalog-entry" data-source-id={s.id}>
 <div className="source-catalog-summary"><span className={"source-catalog-dot "+(busy?"busy":need?"missing":s.last_status==="failed"||s.last_status==="degraded"?"error":s.enabled?"on":"off")}/><div className="source-catalog-name"><h4>{s.name}</h4><p>{busy?"执行或排队中":need??(s.last_status==="ok"?"最近采集成功":s.last_status==="failed"?"最近采集失败":s.last_status==="degraded"?"最近采集部分异常":"暂无运行结果")} · {s.items} 条在库</p><small>{sourceDueLabel(s,clock,busy,Boolean(need))}</small></div><button type="button" className="source-catalog-expand" aria-expanded={open||edit} aria-label={"查看来源详情："+s.name} onClick={()=>setExpanded(open?null:s.id)}><span>详情</span><ChevronDown size={16}/></button></div>
 <div className="source-catalog-controls"><div className="source-catalog-switch"><button role="switch" aria-checked={s.enabled} aria-label={"启用来源："+s.name} type="button" disabled={status[s.id]==="saving"} onClick={()=>void save(s.id,()=>onToggle(s.id,!s.enabled))}><i/></button><span>{s.enabled?"已启用":"已停用"}</span></div><label className="source-catalog-interval"><span>采集周期</span><Select aria-label="采集间隔" value={s.interval_sec} disabled={status[s.id]==="saving"} onValueChange={v=>void save(s.id,()=>onInterval(s.id,Number(v)))}>{!intervals.includes(s.interval_sec)&&<option value={s.interval_sec}>{formatInterval(s.interval_sec)}</option>}{intervals.map(v=><option key={v} value={v}>{formatInterval(v)}</option>)}</Select></label><div className="source-catalog-actions"><button type="button" onClick={()=>setEditing(edit?null:s.id)}><Settings2 size={14}/>{edit?"收起编辑":"编辑配置"}</button>{need?<button type="button" onClick={s.kind==="ingest"?onConfigure:()=>setEditing(s.id)}>补齐配置</button>:<button type="button" disabled={busy} onClick={()=>void collect(s.id)}>{busy?<Loader2 size={14} className="animate-spin"/>:<Play size={13}/>}立即采集</button>}</div></div>
 <div className="source-catalog-feedback"><SaveStatus state={status[s.id]??"idle"}/>{errors[s.id]&&<p role="alert">{errors[s.id]}</p>}</div>
 {(open||edit)&&<div className="source-catalog-details"><dl><div><dt>来源编号</dt><dd>{s.id}</dd></div><div><dt>采集类型</dt><dd>{s.kind}</dd></div><div><dt>最近启动</dt><dd>{s.last_run_at?timeAgo(s.last_run_at):"尚无记录"}</dd></div></dl>{need&&<p className="source-missing-note">{need}。只展示提示，不会自动创建或修改凭据。</p>}{s.last_error&&<FailureNote error={s.last_error} sourceId={s.id} lastSuccess={success(s.id)}/>}</div>}
 {edit&&<div className="source-catalog-editor">{renderEditor(s,()=>setEditing(null))}</div>}
 </section>})}</div>;
}