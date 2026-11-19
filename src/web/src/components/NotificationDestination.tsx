import { useEffect, useRef, useState } from "react";
import { getToken } from "../lib/auth.ts";
import { SaveStatus, type SaveState } from "./SaveStatus.tsx";
import "./notification-destination.css";

type Channel = "none" | "telegram" | "qqbot";
type SecretAction = "keep" | "replace" | "clear";
type Destination = {
  channel: Channel; ready?: boolean; encryptionReady?: boolean;
  telegram: { chatId: string; botTokenConfigured: boolean };
  qqbot: { appId: string; targetType: "group" | "channel" | "c2c" | null; targetId: string | null; sandbox: boolean; appSecretConfigured: boolean };
};
const headers = () => ({ "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) });

export function NotificationDestination({ onSaved }: { onSaved: () => void }) {
  const [data, setData] = useState<Destination | null>(null);
  const [error, setError] = useState("");
  const [channel, setChannel] = useState<Channel>("none");
  const [chatId, setChatId] = useState("");
  const [appId, setAppId] = useState("");
  const [targetType, setTargetType] = useState<"group" | "channel" | "c2c">("group");
  const [targetId, setTargetId] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [tgAction, setTgAction] = useState<SecretAction>("keep");
  const [qqAction, setQqAction] = useState<SecretAction>("keep");
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [visible, setVisible] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [testConfirm, setTestConfirm] = useState(false);
  const [testing, setTesting] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const apply = (d: Destination) => {
    setData(d); setChannel(d.channel); setChatId(d.telegram.chatId || "");
    setAppId(d.qqbot.appId || ""); setTargetType(d.qqbot.targetType || "group"); setTargetId(d.qqbot.targetId || ""); setSandbox(d.qqbot.sandbox);
    setToken(""); setSecret(""); setTgAction("keep"); setQqAction("keep"); setDirty(false); setTestConfirm(false);
  };
  const load = async () => {
    setError("");
    try { const response = await fetch("/api/notifications", { headers: headers() }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "无法读取发送目标"); apply(body); }
    catch (e) { setError(e instanceof Error ? e.message : "无法读取发送目标"); }
  };
  useEffect(() => { void load(); }, []);
  const changed = () => { setDirty(true); setTestConfirm(false); setSaveState("idle"); setMessage(""); };
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saveState === "saving") return;
    setSaveState("saving"); setError(""); setMessage("");
    const action = (mode: SecretAction, value: string) => mode === "replace" ? { action: mode, value } : { action: mode };
    const body = channel === "telegram" ? { channel, telegram: { chatId, botToken: action(tgAction, token) } }
      : channel === "qqbot" ? { channel, qqbot: { appId, targetType, targetId, sandbox, appSecret: action(qqAction, secret) } } : { channel };
    try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: headers(), body: JSON.stringify(body) }); const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败，输入仍保留");
      apply(result); setSaveState("saved"); setMessage("目标已保存；自动推送开关由下方规则单独控制。"); onSaved();
    } catch (e) { setSaveState("error"); setError(e instanceof Error ? e.message : "保存失败，输入仍保留"); requestAnimationFrame(() => errorRef.current?.focus()); }
  }
  async function sendTest() {
    if (!testConfirm || dirty || testing) return;
    setTesting(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/notifications/test", { method: "POST", headers: headers(), body: JSON.stringify({ channel: data?.channel, confirmed: true }) }); const result = await response.json();
      if (!response.ok) throw new Error(result.error || "测试发送失败"); setMessage("服务商已确认接受测试消息，请在目标会话核对。"); setTestConfirm(false);
    } catch (e) { setError(e instanceof Error ? e.message : "测试失败"); } finally { setTesting(false); }
  }
  if (!data) return <section className="panel destination-editor"><h2>发送目标</h2>{error ? <><p role="alert">{error}</p><button type="button" onClick={() => void load()}>重新读取目标</button></> : <p role="status">正在读取发送目标…</p>}</section>;
  const secretMode = channel === "telegram" ? tgAction : qqAction;
  const setSecretMode = (mode: SecretAction) => { if (channel === "telegram") setTgAction(mode); else setQqAction(mode); changed(); };
  const hasSecret = channel === "telegram" ? data.telegram.botTokenConfigured : data.qqbot.appSecretConfigured;
  return <section className="panel destination-editor">
    <div className="destination-heading"><div><p className="settings-step">1 · 发送目标</p><h2 id="destination-title">让消息送到你的机器人</h2><p className="settings-help">选择渠道，保存接收位置，再单独验证连接。</p></div><SaveStatus state={saveState} /></div>
    <form aria-labelledby="destination-title" onSubmit={save}>
      <fieldset><legend>通知渠道</legend><div className="destination-options">{([['none', '暂停渠道'], ['telegram', 'Telegram Bot'], ['qqbot', '腾讯官方 QQ Bot']] as const).map(([value, label]) => <label key={value}><input type="radio" name="notification-channel" value={value} checked={channel === value} onChange={() => { setChannel(value); changed(); }} />{label}</label>)}</div></fieldset>
      {channel === "telegram" && <fieldset><legend>Telegram 接收位置</legend><label htmlFor="destination-chat">Chat ID<input id="destination-chat" name="chatId" value={chatId} onChange={e => { setChatId(e.target.value); changed(); }} required maxLength={256} autoCapitalize="none" spellCheck={false} aria-describedby="destination-chat-help" /></label><p id="destination-chat-help" className="settings-help">填写机器人有权发言的私聊或群组 Chat ID；群组可能以 -100 开头。</p></fieldset>}
      {channel === "qqbot" && <fieldset><legend>官方 QQ Bot 应用与接收位置</legend><label htmlFor="destination-app">AppID<input id="destination-app" name="appId" value={appId} onChange={e => { setAppId(e.target.value); changed(); }} required maxLength={128} autoCapitalize="none" spellCheck={false} /></label><label htmlFor="destination-target-type"><span id="destination-type-label">接收场景</span><select aria-labelledby="destination-type-label" id="destination-target-type" name="targetType" value={targetType} onChange={e => { setTargetType(e.target.value as typeof targetType); changed(); }}><option value="group">QQ群机器人</option><option value="c2c">QQ 单聊机器人</option><option value="channel">QQ 频道子频道</option></select></label><label htmlFor="destination-target">{targetType === "channel" ? "子频道 ID" : targetType === "group" ? "group_openid" : "user_openid"}<input id="destination-target" name="targetId" value={targetId} onChange={e => { setTargetId(e.target.value); changed(); }} required maxLength={256} autoCapitalize="none" spellCheck={false} aria-describedby="destination-qq-help" /></label><p id="destination-qq-help" className="settings-help">群与单聊需要腾讯事件提供的 OpenID。主动通知受应用权限、接收方允许开关与平台额度限制；频道发送还可能需要已有的在线连接。</p><label className="destination-check"><input type="checkbox" name="sandbox" checked={sandbox} onChange={e => { setSandbox(e.target.checked); changed(); }} />使用官方沙箱环境（兼容性待验证）</label></fieldset>}
      {channel !== "none" && <fieldset><legend>{channel === "telegram" ? "Bot Token" : "AppSecret"}</legend><p className="settings-help">{hasSecret ? "已有凭据，仅显示保存状态。" : "尚未配置凭据。"}保存成功后输入会清空；不会回传原文。</p><label htmlFor="destination-secret-action"><span id="destination-secret-label">凭据操作</span><select aria-labelledby="destination-secret-label" id="destination-secret-action" name="secretAction" value={secretMode} onChange={e => setSecretMode(e.target.value as SecretAction)}><option value="keep">保留已保存的凭据</option><option value="replace">填写或替换凭据</option><option value="clear">清除凭据并使目标未就绪</option></select></label>{secretMode === "replace" && <><label htmlFor="destination-secret">{channel === "telegram" ? "新的 Bot Token" : "新的 AppSecret"}<input id="destination-secret" name="credential" type={visible ? "text" : "password"} autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={channel === "telegram" ? token : secret} onChange={e => { if (channel === "telegram") setToken(e.target.value); else setSecret(e.target.value); changed(); }} required maxLength={4096} /></label><button type="button" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "隐藏凭据" : "显示凭据"}</button></>}{secretMode === "clear" && <p className="destination-notice">保存后将删除此渠道的凭据，后续发送暂停。</p>}</fieldset>}
      {data.encryptionReady === false && channel !== "none" && <p className="destination-notice">服务器尚未配置独立的通知加密密钥，暂不能保存机器人凭据。</p>}
      <div className="destination-actions"><button type="submit" className="destination-primary" disabled={saveState === "saving"}>{saveState === "saving" ? "正在保存…" : "保存发送目标"}</button><span className="settings-help">{dirty ? "有未保存的修改" : `当前渠道：${data.channel === "qqbot" ? "QQ Bot" : data.channel === "telegram" ? "Telegram" : "暂停"}`}</span></div>
    </form>
    <div className="destination-test"><h3>验证已保存的目标</h3><p className="settings-help">测试会向当前目标发送一条真实消息。先保存修改，再确认接收位置。</p><label className="destination-check"><input type="checkbox" checked={testConfirm} disabled={dirty || data.channel === "none"} onChange={e => setTestConfirm(e.target.checked)} />我确认向已保存的目标发送测试消息</label><button type="button" onClick={() => void sendTest()} disabled={!testConfirm || dirty || testing || data.channel === "none"}>{testing ? "发送中…" : "发送一条测试消息"}</button></div>
    {message && <p role="status">{message}</p>}{error && <p role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
  </section>;
}