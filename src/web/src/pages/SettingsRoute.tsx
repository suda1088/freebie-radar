import { SettingsDirectory, settingLinks } from "../components/WorkspaceChrome.tsx";
import type { WorkspacePage } from "./PageHeading.tsx";

export function SettingsRoute({ page, onPage }: { page: WorkspacePage; onPage: (page: WorkspacePage) => void }) {
  const entry = settingLinks.find(link => link.key === page);
  return <><SettingsDirectory page={page} onPage={onPage}/><div className="v3-settings-intro"><span>设置 / {entry?.label}</span><p>{entry?.description}</p></div></>;
}
