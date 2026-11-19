import { Check, Loader2, AlertCircle } from "lucide-react";
export type SaveState = "idle" | "saving" | "saved" | "error";
export function SaveStatus({state,message}:{state:SaveState;message?:string}) {
 if(state==="idle")return null;
 return <span className={"soda-save-status "+state} role={state==="error"?"alert":"status"} aria-live="polite">{state==="saving"?<Loader2 size={13} className="animate-spin"/>:state==="error"?<AlertCircle size={13}/>:<Check size={13}/>}<span>{message??({saving:"保存中…",saved:"已保存",error:"保存失败，请重试"} as const)[state]}</span></span>;
}