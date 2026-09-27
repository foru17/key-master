import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 sm:px-12">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 py-7 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-700 font-bold text-white"
            aria-hidden="true"
          >
            k
          </span>
          <span className="text-lg font-semibold tracking-tight">key-master</span>
        </div>
        <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">
          PHASE 01
        </span>
      </header>
      <main className="flex flex-1 flex-col justify-center py-16 sm:py-24">
        <p className="mb-5 text-xs font-semibold tracking-[0.18em] text-indigo-700 dark:text-indigo-300">
          YOUR RESOURCES. YOUR PERMISSION.
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          A quieter place
          <br />
          to manage access.
        </h1>
        <p className="mt-5 text-xl font-medium text-slate-700 dark:text-slate-200" lang="zh">
          每一次访问，都由你掌控。
        </p>
        <div className="mt-10 max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <span
              className="h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400"
              aria-hidden="true"
            />
            Admin preview <span className="text-slate-500 dark:text-slate-400">/</span>
            <span lang="zh">管理台预览</span>
          </div>
          <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
            This is the first-phase placeholder. Resource approvals are managed through Telegram.
            The administration interface will arrive in a later phase.
          </p>
          <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300" lang="zh">
            当前为第一阶段占位页面。请通过 Telegram 管理资源授权，完整管理界面将在后续阶段开放。
          </p>
        </div>
        <p className="mt-8 text-xs tracking-wide text-slate-500 dark:text-slate-400">
          SELF-HOSTED · NO TELEMETRY{" "}
          <span className="ml-2" lang="zh">
            自托管 · 无遥测
          </span>
        </p>
      </main>
      <footer className="border-t border-slate-200 py-6 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        key-master <span className="mx-2">/</span> Access, with intention.{" "}
        <span className="ml-2" lang="zh">
          让授权清晰可控。
        </span>
      </footer>
    </div>
  );
}
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
