import { useEffect, useState } from "react";
import { Clock3, Leaf, RefreshCw } from "lucide-react";
import { freshnessOf, formatRecordedTime, type FreshnessInput } from "../lib/freshness.ts";
import "../freshness.css";
function useFreshnessClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") update(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return now;
}
export function FreshnessCard({item,detail=false}:{item:FreshnessInput;detail?:boolean}) {
  const info = freshnessOf(item,useFreshnessClock());
  if (detail) return <section className={"soda-freshness detail " + info.state} aria-label="资源保鲜档案" data-state={info.state}>
    <header><Leaf size={18}/><div><h3>资源保鲜档案</h3><p>把时间证据分开看，不把收录当作有效保证。</p></div><span className="soda-freshness-tag">{info.deadlineLabel}</span></header>
    <dl><div><dt>记录中的截止时间</dt><dd>{info.deadline}{info.expires!==null&&<small>北京时间 · 以原站最新说明为准</small>}</dd></div><div><dt>最近采集到</dt><dd>{info.seen===null?"未知":formatRecordedTime(info.seen)}{info.seen!==null&&<small>{info.seenLabel}</small>}</dd></div><div><dt>首次收录</dt><dd>{info.first===null?"未知":formatRecordedTime(info.first)}{info.first!==null&&<small>北京时间</small>}</dd></div><div><dt>实际有效性核验</dt><dd>暂无独立核验记录<small>请打开原文核对领取条件</small></dd></div></dl><p className="soda-freshness-disclaimer">{info.caveat}</p>
  </section>;
  return <div className={"soda-freshness compact " + info.state} data-state={info.state} aria-label="资源保鲜信息"><span className="soda-freshness-tag" title={info.deadline}><Clock3 size={12}/>{info.deadlineLabel}</span><span className="soda-freshness-seen" title={info.seen===null?"最近采集时间未知":formatRecordedTime(info.seen)+"（北京时间）；不是有效性核验"}><RefreshCw size={11}/>{info.seenLabel}</span>{info.needsReview&&info.state!=="expired"&&<span className="soda-freshness-review">建议核对原文</span>}</div>;
}