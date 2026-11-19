import { explainFailure } from "../lib/failures.ts";
export function FailureNote({error,sourceId="",lastSuccess,compact=false}:{error:string;sourceId?:string;lastSuccess?:string|null;compact?:boolean}) {
 const info=explainFailure(error,sourceId);
 const date=lastSuccess ? new Date(lastSuccess) : null;
 const time=date&&!Number.isNaN(date.getTime())?date.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}):null;
 return <div className={"soda-failure-note"+(compact?" compact":"")}><strong>{info.title}</strong><p>{info.reason}</p><p className="soda-failure-action">建议：{info.action}</p>{lastSuccess!==undefined&&<span className="soda-last-success">{time?`当前记录内最近成功（北京时间）：${time}`:"当前可用记录中未找到成功采集"}</span>}<details><summary>查看原始记录{info.inferred?" · 原因待确认":""}</summary><pre>{error}</pre></details></div>;
}