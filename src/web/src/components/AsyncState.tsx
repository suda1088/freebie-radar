import "../usability-polish.css";
import { RefreshCw } from "lucide-react";
export function LoadingCards({label="正在读取内容"}:{label?:string}) {
 return <div className="soda-loading-cards" role="status" aria-label={label} aria-busy="true"><span className="soda-loading-label">{label}…</span>{Array.from({length:4},(_,i)=><div key={i} className="soda-skeleton-card" aria-hidden="true"><i/><b/><b/><p/><p/><small/></div>)}</div>;
}
export function LoadFailure({message,onRetry}:{message:string;onRetry:()=>void}) {
 return <div className="soda-load-failure" role="alert"><strong>这次没有读取成功</strong><p>{message}</p><button type="button" onClick={onRetry}><RefreshCw size={14}/>重新读取</button><small>读取失败不表示内容已被删除，重试不会修改配置。</small></div>;
}