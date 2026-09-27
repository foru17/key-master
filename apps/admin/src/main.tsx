import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./i18n";
import "./style.css";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  Check,
  FileBox,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  Search,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  SunMoon,
  X,
} from "lucide-react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { themeCss } from "../../../packages/core/src/theme";
import { api, queryClient, useData } from "./api";
import { Approvals } from "./approvals";
import { Button, ErrorBox, Modal, Skeleton, ToastContext } from "./components";
import { Grants, Resources, Tokens } from "./manage";
import { Overview } from "./overview";
import { Requests } from "./requests";
import { Settings } from "./settings";
import type { Pending, Settings as SettingsData } from "./types";

const navigation = [
  { path: "overview", Icon: LayoutDashboard },
  { path: "requests", Icon: ListFilter },
  { path: "approvals", Icon: ShieldCheck },
  { path: "grants", Icon: Activity },
  { path: "tokens", Icon: KeyRound },
  { path: "resources", Icon: FileBox },
  { path: "settings", Icon: SettingsIcon },
];
function Login({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api("auth/request-code", "POST", {});
      setStep(2);
    } catch (error) {
      setError(error as Error);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await api("auth/verify", "POST", { code });
      onSuccess();
    } catch (error) {
      setError(error as Error);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (step === 2) inputs.current[0]?.focus();
  }, [step]);
  return (
    <Modal title={t(step === 1 ? "loginTitle" : "verifyTitle")} onClose={() => {}} locked>
      <div className="login-mark">
        <KeyRound size={27} />
      </div>
      <p className="login-tagline">{t("loginDesc")}</p>
      <p>{t(step === 1 ? "loginHelp" : "verifyHelp")}</p>
      {step === 1 ? (
        <Button className="primary full" disabled={busy} onClick={() => void send()}>
          <Send size={16} />
          {t("sendCode")}
        </Button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <div
            className="code-inputs"
            onPaste={(e) => {
              e.preventDefault();
              const value = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
              setCode(value);
              inputs.current[Math.min(value.length, 5)]?.focus();
            }}
          >
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <input
                key={index}
                ref={(node) => {
                  inputs.current[index] = node;
                }}
                aria-label={`${t("code")} ${index + 1}`}
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                maxLength={6}
                value={code[index] ?? ""}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !code[index])
                    inputs.current[Math.max(0, index - 1)]?.focus();
                }}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "");
                  if (value.length > 1) {
                    setCode(value.slice(0, 6));
                    inputs.current[5]?.focus();
                  } else {
                    const next = code.padEnd(6, " ").split("");
                    next[index] = value || " ";
                    setCode(next.join("").trimEnd());
                    if (value) inputs.current[Math.min(5, index + 1)]?.focus();
                  }
                }}
              />
            ))}
          </div>
          <button type="submit" className="primary full" disabled={busy || !/^\d{6}$/.test(code)}>
            {t("verify")}
            <ArrowUpRight size={16} />
          </button>
          <Button className="quiet full" disabled={busy} onClick={() => void send()}>
            {t("resend")}
          </Button>
        </form>
      )}
      <ErrorBox error={error} />
      <div className="login-footer">
        <ShieldCheck size={14} />
        {t("secureSession")}
      </div>
    </Modal>
  );
}
function Palette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchInput.current?.focus();
  }, []);
  const pages = navigation.filter((n) => t(n.path).toLowerCase().includes(search.toLowerCase()));
  return (
    <Modal title={t("shortcuts")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate(
            search.startsWith("/")
              ? `/requests?resource=${encodeURIComponent(search)}`
              : `/requests?q=${encodeURIComponent(search)}`,
          );
          onClose();
        }}
      >
        <div className="search-input palette-input">
          <Search size={18} />
          <input
            ref={searchInput}
            aria-label={t("search")}
            placeholder={t("searchHint")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {pages.map(({ path, Icon }) => (
          <Button
            className="palette-result"
            key={path}
            onClick={() => {
              navigate(`/${path}`);
              onClose();
            }}
          >
            <Icon size={17} />
            {t(path)}
            <ArrowUpRight size={15} />
          </Button>
        ))}
        {search && (
          <button type="submit" className="palette-result">
            <Search size={17} />
            {t("requests")}: {search}
            <span>↵</span>
          </button>
        )}
      </form>
    </Modal>
  );
}
function AuthenticatedShell({ onLogout }: { onLogout: () => void }) {
  const [palette, setPalette] = useState(false);
  const [mobile, setMobile] = useState(false);
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const polls = useRef(0);
  const events = useQuery({
    queryKey: ["events"],
    queryFn: () => {
      polls.current++;
      return api<{ pending: Pending[] }>("admin/events");
    },
    refetchInterval: () => (polls.current < 10000 ? 5000 : false),
  });
  const settings = useData<SettingsData>("settings");
  const [theme, setTheme] = useState(localStorage.getItem("km_theme") ?? "system");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("km_theme", theme);
  }, [theme]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const pending = events.data?.pending.length ?? 0;
  const previous = useRef("");
  useEffect(() => {
    const ids = events.data?.pending.map((p) => p.id).join(",") ?? "";
    if (previous.current !== ids) {
      previous.current = ids;
      void queryClient.invalidateQueries({
        predicate: (q) =>
          ["approvals", "overview"].some((p) => String(q.queryKey[0]).startsWith(p)),
      });
    }
  }, [events.data]);
  const nav = (
    <>
      <NavLink className="brand" to="/overview">
        <span className="brand-mark">
          <KeyRound size={19} />
        </span>
        key-master
      </NavLink>
      <div className="workspace-label">{t("workspace")}</div>
      <nav aria-label={t("menu")}>
        {navigation.map(({ path, Icon }) => (
          <NavLink
            key={path}
            to={`/${path}`}
            onClick={() => setMobile(false)}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            <Icon size={18} />
            <span>{t(path)}</span>
            {path === "approvals" && pending > 0 && (
              <span className="count" key={pending}>
                {pending}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="status-dot" />
        <span>{t("selfHosted")}</span>
      </div>
    </>
  );
  const page = location.pathname.split("/")[1] || "overview";
  return (
    <>
      <aside className="sidebar">{nav}</aside>
      {mobile && (
        <Modal title="key-master" onClose={() => setMobile(false)} drawer>
          <div className="mobile-nav">{nav}</div>
        </Modal>
      )}
      <div className="app-main">
        <header className="topbar">
          <Button
            className="icon-button mobile-menu"
            aria-label={t("menu")}
            onClick={() => setMobile(true)}
          >
            <Menu size={19} />
          </Button>
          <span className="breadcrumb">
            <span>{t("workspace")}</span> <span>/</span> <strong>{t(page)}</strong>
          </span>
          <div className="topbar-actions">
            <Button className="search-trigger" onClick={() => setPalette(true)}>
              <Search size={16} />
              <span>{t("search")}</span>
              <kbd>⌘ K</kbd>
            </Button>
            {settings.data?.observe_mode && <span className="observe-chip">{t("observe")}</span>}
            <div className="menu-wrap">
              <Button className="icon-button" popoverTarget="theme-menu" aria-label={t("theme")}>
                <SunMoon size={18} />
              </Button>
              <div id="theme-menu" popover="auto" className="dropdown">
                {["light", "dark", "system"].map((value) => (
                  <Button
                    key={value}
                    popoverTarget="theme-menu"
                    popoverTargetAction="hide"
                    onClick={() => setTheme(value)}
                  >
                    {t(value)}
                    {theme === value && <Check size={14} />}
                  </Button>
                ))}
              </div>
            </div>
            <Button
              className="language-button"
              onClick={() => {
                const lng = i18n.language === "en" ? "zh" : "en";
                void i18n.changeLanguage(lng);
                localStorage.setItem("km_language", lng);
                document.documentElement.lang = lng;
              }}
            >
              {i18n.language === "en" ? "中" : "EN"}
            </Button>
            <Button className="avatar" popoverTarget="account-menu" aria-label={t("account")}>
              KM
            </Button>
            <div id="account-menu" popover="auto" className="dropdown">
              <Button
                onClick={() => {
                  void api("auth/logout", "POST", {}).then(() => {
                    queryClient.clear();
                    onLogout();
                  });
                }}
              >
                <LogOut size={16} />
                {t("logout")}
              </Button>
            </div>
          </div>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/grants" element={<Grants />} />
            <Route path="/tokens" element={<Tokens />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </main>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </>
  );
}
function App() {
  const { t } = useTranslation();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    void api("admin/session")
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false));
    const expired = () => {
      setAuthenticated(false);
      queryClient.clear();
    };
    window.addEventListener("km:unauthorized", expired);
    return () => window.removeEventListener("km:unauthorized", expired);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  return (
    <ToastContext.Provider
      value={(message) => {
        setToast(message);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 5000);
      }}
    >
      {authenticated ? (
        <AuthenticatedShell onLogout={() => setAuthenticated(false)} />
      ) : (
        <>
          <div className="empty-shell" inert>
            <aside className="sidebar">
              <div className="brand">
                <span className="brand-mark">
                  <KeyRound size={19} />
                </span>
                key-master
              </div>
              {navigation.map(({ path, Icon }) => (
                <div className="nav-link" key={path}>
                  <Icon size={18} />
                  {t(path)}
                </div>
              ))}
            </aside>
            <div className="app-main">
              <header className="topbar">key-master</header>
              <main className="content">
                <Skeleton />
              </main>
            </div>
          </div>
          {authenticated === false && (
            <Login
              onSuccess={() => {
                queryClient.clear();
                setAuthenticated(true);
              }}
            />
          )}
        </>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <Button className="icon-button" onClick={() => setToast("")} aria-label={t("close")}>
            <X size={16} />
          </Button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
const style = document.createElement("style");
style.textContent = themeCss;
document.head.append(style);
document.documentElement.dataset.theme = localStorage.getItem("km_theme") ?? "system";
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/admin">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
