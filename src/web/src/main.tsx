import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { initializeSiteAuth, installAuthFetch } from "./lib/auth.ts";
import "./styles.css";

async function start() {
  await initializeSiteAuth();
  installAuthFetch();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start().catch(() => {
  document.getElementById("root")!.textContent = "登录状态暂时无法验证，请刷新页面重试。";
});
