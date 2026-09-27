import { useQueryClient } from "@tanstack/react-query";
import { Check, Send, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, useData } from "./api";
import { Confirm, ErrorBox, Field, PageHeading, Skeleton, useToast } from "./components";
import type { Settings as SettingsData } from "./types";

function SettingsForm({ initial }: { initial: SettingsData }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const toast = useToast();
  const client = useQueryClient();
  async function save(value: SettingsData) {
    setPending(true);
    setError(null);
    const previous = client.getQueryData(["settings"]);
    await client.cancelQueries({ queryKey: ["settings"] });
    client.setQueryData(["settings"], value);
    try {
      await api("admin/settings", "PUT", value);
      toast(t("saved"));
      void client.invalidateQueries();
    } catch (error) {
      client.setQueryData(["settings"], previous);
      setError(error as Error);
    } finally {
      setPending(false);
    }
  }
  const notice = (key: keyof SettingsData["notice"], value: string) =>
    setDraft({ ...draft, notice: { ...draft.notice, [key]: value } });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(draft);
      }}
    >
      <div className="settings-grid">
        <div>
          <section className="panel settings-panel">
            <h2>
              <ShieldCheck size={18} />
              {t("security")}
            </h2>
            <div className="switch-row">
              <div>
                <strong>{t("observe")}</strong>
                <p>{t("observeHelp")}</p>
              </div>
              <input
                type="checkbox"
                role="switch"
                aria-checked={draft.observe_mode}
                aria-label={t("observe")}
                checked={draft.observe_mode}
                onChange={(e) => setDraft({ ...draft, observe_mode: e.target.checked })}
              />
            </div>
          </section>
          <section className="panel settings-panel">
            <h2>{t("durations")}</h2>
            <div className="form-grid">
              {(["grant_default", "block", "pending"] as const).map((key, i) => (
                <Field
                  key={key}
                  label={t(["defaultDuration", "blockDuration", "pendingDuration"][i] ?? "")}
                >
                  <input
                    type="number"
                    min="1"
                    max={key === "pending" ? 86400 : 31536000}
                    required
                    value={draft.durations[key]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        durations: { ...draft.durations, [key]: Number(e.target.value) },
                      })
                    }
                  />
                </Field>
              ))}
              {[0, 1].map((index) => (
                <Field key={index} label={t(index === 0 ? "shortDuration" : "longDuration")}>
                  <input
                    type="number"
                    min="1"
                    max="31536000"
                    required
                    value={draft.durations.options[index]}
                    onChange={(e) => {
                      const options: [number, number] = [...draft.durations.options];
                      options[index] = Number(e.target.value);
                      setDraft({ ...draft, durations: { ...draft.durations, options } });
                    }}
                  />
                </Field>
              ))}
            </div>
          </section>
          <section className="panel settings-panel">
            <h2>{t("notice")}</h2>
            <Field label={t("contactText")}>
              <input
                value={draft.notice.contact_text}
                onChange={(e) => notice("contact_text", e.target.value)}
              />
            </Field>
            <Field label={t("contactUrl")}>
              <input
                type="url"
                placeholder="https://example.com/contact"
                value={draft.notice.contact_url}
                onChange={(e) => notice("contact_url", e.target.value)}
              />
            </Field>
            <Field label={t("footer")}>
              <input
                value={draft.notice.footer}
                onChange={(e) => notice("footer", e.target.value)}
              />
            </Field>
          </section>
        </div>
        <div>
          <section className="panel settings-panel preview-panel">
            <h2>{t("preview")}</h2>
            {["light", "dark"].map((theme) => (
              <div key={theme} data-theme={theme} className="notice-preview">
                <small>
                  key-master · 403 <span>{t(theme)}</span>
                </small>
                <h3>{t("noticeTitle")}</h3>
                <p>{draft.notice.contact_text || t("noticeContact")}</p>
                <div className="notice-meta">
                  <span>{t("requestId")}</span>
                  <code>01EXAMPLE7REQUEST</code>
                  <code>2026-01-01T12:00:00Z</code>
                </div>
                <footer>{draft.notice.footer || t("noticeSample")}</footer>
              </div>
            ))}
          </section>
          <section className="panel settings-panel">
            <h2>
              <Send size={17} />
              {t("telegram")}
            </h2>
            <dl className="detail-list">
              <div>
                <dt>{t("status")}</dt>
                <dd>{t(initial.telegram.connected ? "connected" : "unavailable")}</dd>
              </div>
              <div>
                <dt>{t("mode")}</dt>
                <dd>{initial.telegram.mode}</dd>
              </div>
              <div>
                <dt>{t("username")}</dt>
                <dd>{initial.telegram.username ?? t("unreported")}</dd>
              </div>
              <div>
                <dt>{t("owners")}</dt>
                <dd>{initial.telegram.ownerChats.join(", ") || "—"}</dd>
              </div>
            </dl>
          </section>
          <p className="muted about">
            key-master {initial.version} · {t("selfHosted")}
          </p>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="settings-footer">
        <span className="muted">{t("settingsDesc")}</span>
        {draft.observe_mode && !initial.observe_mode ? (
          <Confirm
            label={t("save")}
            description={t("observeHelp")}
            disabled={pending}
            onConfirm={() => void save(draft)}
          />
        ) : (
          <button type="submit" className="primary" disabled={pending}>
            <Check size={16} />
            {t("save")}
          </button>
        )}
      </div>
    </form>
  );
}
export function Settings() {
  const { t } = useTranslation();
  const query = useData<SettingsData>("settings");
  return (
    <>
      <PageHeading title={t("settings")} description={t("settingsDesc")} />
      <ErrorBox error={query.error} retry={() => void query.refetch()} />
      {query.data ? <SettingsForm initial={query.data} /> : <Skeleton />}
    </>
  );
}
