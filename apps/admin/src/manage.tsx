import { ArrowUpRight, FileBox, KeyRound, Plus, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAction, useData } from "./api";
import {
  Button,
  Confirm,
  CopyButton,
  Empty,
  ErrorBox,
  Field,
  Modal,
  PageHeading,
  Pill,
  SecretDialog,
  Skeleton,
  Timestamp,
  useToast,
} from "./components";
import type { Grant, Issued, Resource, Token } from "./types";

const fields = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return new FormData(event.currentTarget);
};
const scopes = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
export function GrantForm({
  onClose,
  ip,
  grant,
}: {
  onClose: () => void;
  ip?: string;
  grant?: Grant;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const action = useAction(
    grant ? `grants/${grant.id}` : "grants",
    grant ? "PATCH" : "POST",
    () => {
      toast(t("saved"));
      onClose();
    },
  );
  return (
    <Modal title={t(grant ? "edit" : "newGrant")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          const f = fields(e);
          action.mutate({
            subjectKind: f.get("subjectKind"),
            subject: f.get("subject"),
            scope: scopes(f.get("scope")),
            duration: Number(f.get("duration")),
          });
        }}
      >
        <Field label={t("subjectKind")}>
          <select name="subjectKind" defaultValue={grant?.subjectKind ?? "ip"}>
            <option value="ip">{t("ip")}</option>
            <option value="ip_client">{t("ipClient")}</option>
          </select>
        </Field>
        <Field label={t("subject")}>
          <input
            name="subject"
            required
            defaultValue={grant?.subject ?? ip ?? ""}
            placeholder="203.0.113.7"
          />
        </Field>
        <Field label={t("scope")}>
          <input name="scope" required defaultValue={grant?.scope.join(", ") ?? "*"} />
        </Field>
        <Field label={t("duration")}>
          <input name="duration" type="number" min="1" max="31536000" defaultValue="600" required />
        </Field>
        <ErrorBox error={action.error} />
        <div className="form-footer">
          <Button onClick={onClose}>{t("cancel")}</Button>
          <button type="submit" className="primary" disabled={action.isPending}>
            {t("save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function GrantRow({ item, onEdit }: { item: Grant; onEdit: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const action = useAction(`grants/${item.id}`, "DELETE", () => toast(t("saved")));
  const status =
    item.revokedAt !== null ? "revoked" : item.expiresAt <= Date.now() ? "expired" : "active";
  return (
    <div className="management-row">
      <span className="resource-icon">
        <ShieldCheck size={18} />
      </span>
      <div className="identity">
        <strong className="mono">{item.subject}</strong>
        <p>
          <code>{item.scope.join(", ")}</code> · {item.grantedBy}
        </p>
      </div>
      <div>
        <Pill value={status} />
        <p className="muted">
          {status === "active" ? (
            <span
              title={new Date(item.expiresAt).toISOString()}
            >{`${Math.max(1, Math.ceil((item.expiresAt - Date.now()) / 60000))}m ${t("remaining")}`}</span>
          ) : (
            <Timestamp value={item.expiresAt} />
          )}
        </p>
      </div>
      <div className="actions">
        <Button onClick={onEdit}>{t("edit")}</Button>
        <Confirm
          disabled={status === "revoked" || action.isPending}
          label={t("revoke")}
          onConfirm={() => action.mutate({})}
        />
      </div>
      <ErrorBox error={action.error} />
    </div>
  );
}
export function Grants() {
  const { t } = useTranslation();
  const query = useData<Grant[]>("grants");
  const [form, setForm] = useState<Grant | "new" | null>(null);
  return (
    <>
      <PageHeading title={t("grants")} description={t("grantsDesc")}>
        <Button className="primary" onClick={() => setForm("new")}>
          <Plus size={16} />
          {t("newGrant")}
        </Button>
      </PageHeading>
      <ErrorBox error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <Skeleton />
      ) : (
        <section className="panel">
          {query.data?.length ? (
            query.data.map((item) => (
              <GrantRow key={item.id} item={item} onEdit={() => setForm(item)} />
            ))
          ) : (
            <Empty>
              <Button onClick={() => setForm("new")}>{t("newGrant")}</Button>
            </Empty>
          )}
        </section>
      )}
      {form && (
        <GrantForm {...(form !== "new" ? { grant: form } : {})} onClose={() => setForm(null)} />
      )}
    </>
  );
}
export function TokenForm({
  onClose,
  onIssued,
}: {
  onClose: () => void;
  onIssued: (issued: Issued) => void;
}) {
  const { t } = useTranslation();
  const action = useAction<Issued>("tokens", "POST", onIssued);
  return (
    <Modal title={t("newToken")} onClose={onClose}>
      <div className="dialog-symbol">
        <KeyRound size={24} />
      </div>
      <p>{t("tokensDesc")}</p>
      <form
        onSubmit={(e) => {
          const f = fields(e);
          const expiry = String(f.get("expiresAt") ?? "");
          action.mutate({
            label: f.get("label"),
            kind: f.get("kind"),
            scope: scopes(f.get("scope")),
            expiresAt: expiry ? new Date(expiry).getTime() : null,
          });
        }}
      >
        <Field label={t("label")}>
          <input name="label" placeholder="Example automation" maxLength={100} required />
        </Field>
        <Field label={t("kind")}>
          <select name="kind">
            <option value="machine">{t("machine")}</option>
            <option value="device">{t("device")}</option>
          </select>
        </Field>
        <Field label={t("scope")}>
          <input name="scope" defaultValue="/example-feed" required />
        </Field>
        <Field label={t("expiresInput")}>
          <input name="expiresAt" type="datetime-local" />
        </Field>
        <div className="note">
          <ShieldCheck size={17} />
          <span>{t("secretNote")}</span>
        </div>
        <ErrorBox error={action.error} />
        <div className="form-footer">
          <Button onClick={onClose}>{t("cancel")}</Button>
          <button className="primary" type="submit" disabled={action.isPending}>
            {t("issue")}
            <ArrowUpRight size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TokenRow({ item }: { item: Token }) {
  const { t } = useTranslation();
  const toast = useToast();
  const action = useAction(`tokens/${item.id}`, "DELETE", () => toast(t("saved")));
  const usage = Array.from(
    { length: 7 },
    (_, i) => item.usage.find((u) => u.day === i)?.count ?? 0,
  );
  const max = Math.max(1, ...usage);
  return (
    <div className="management-row token-row">
      <span className="resource-icon">
        <KeyRound size={18} />
      </span>
      <div className="identity">
        <strong>{item.label}</strong>
        <p>
          {t(item.kind)} · <code>{item.scope.join(", ")}</code>
        </p>
        <small className="muted">
          {t("lastUsed")}: <Timestamp value={item.lastUsedAt} />
        </small>
      </div>
      <div className="token-usage">
        <small>{t("usage")}</small>
        <svg
          viewBox="0 0 100 25"
          role="img"
          aria-label={`${t("usage")}: ${usage.reduce((a, b) => a + b, 0)}`}
        >
          <title>{t("usage")}</title>
          {usage.map((n, i) => (
            <rect
              key={String(i)}
              x={i * 14}
              y={24 - (n / max) * 22}
              width="8"
              height={Math.max(2, (n / max) * 22)}
              rx="2"
              fill="var(--sage)"
            />
          ))}
        </svg>
      </div>
      <div>
        <Pill
          value={
            item.revokedAt !== null
              ? "revoked"
              : item.expiresAt !== null && item.expiresAt < Date.now()
                ? "expired"
                : "active"
          }
        />
        <p className="muted">
          {item.expiresAt !== null ? <Timestamp value={item.expiresAt} /> : t("noExpiry")}
        </p>
      </div>
      <Confirm
        disabled={item.revokedAt !== null || action.isPending}
        label={t("revoke")}
        onConfirm={() => action.mutate({})}
      />
      <ErrorBox error={action.error} />
    </div>
  );
}
export function Tokens() {
  const { t } = useTranslation();
  const query = useData<Token[]>("tokens");
  const [form, setForm] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  return (
    <>
      <PageHeading title={t("tokens")} description={t("tokensDesc")}>
        <Button className="primary" onClick={() => setForm(true)}>
          <Plus size={16} />
          {t("newToken")}
        </Button>
      </PageHeading>
      <ErrorBox error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <Skeleton />
      ) : (
        <section className="panel">
          {query.data?.length ? (
            query.data.map((item) => <TokenRow key={item.id} item={item} />)
          ) : (
            <Empty>
              <Button onClick={() => setForm(true)}>{t("newToken")}</Button>
            </Empty>
          )}
        </section>
      )}
      {form && (
        <TokenForm
          onClose={() => setForm(false)}
          onIssued={(value) => {
            setForm(false);
            setIssued(value);
          }}
        />
      )}
      {issued && <SecretDialog issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}
export function ResourceForm({ resource, onClose }: { resource?: Resource; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const action = useAction(
    resource ? `resources/${resource.id}` : "resources",
    resource ? "PUT" : "POST",
    () => {
      toast(t("saved"));
      onClose();
    },
  );
  return (
    <Modal title={t(resource ? "edit" : "newResource")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          const f = fields(e);
          action.mutate({
            slug: f.get("slug"),
            kind: f.get("kind"),
            source: f.get("source"),
            content_type: f.get("content_type"),
            policy: f.get("policy"),
            enabled: f.get("enabled") === "on",
          });
        }}
      >
        <Field label={t("slug")}>
          <input
            name="slug"
            defaultValue={resource?.slug ?? ""}
            placeholder="/example-feed"
            pattern="/[A-Za-z0-9_/-]+"
            required
          />
        </Field>
        <div className="form-grid">
          <Field label={t("kind")}>
            <select name="kind" defaultValue={resource?.kind ?? "inline"}>
              {["inline", "file", "upstream"].map((v) => (
                <option key={v} value={v}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("policy")}>
            <select name="policy" defaultValue={resource?.policy ?? "approval"}>
              {["approval", "token_only", "public"].map((v) => (
                <option key={v} value={v}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t("contentType")}>
          <input
            name="content_type"
            defaultValue={resource?.contentType ?? "text/plain; charset=utf-8"}
            required
          />
        </Field>
        <Field label={t("sourceValue")}>
          <textarea name="source" defaultValue={resource?.source ?? ""} rows={4} required />
        </Field>
        <label className="switch-row">
          <span>{t("enabled")}</span>
          <input type="checkbox" name="enabled" defaultChecked={resource?.enabled ?? true} />
        </label>
        <ErrorBox error={action.error} />
        <div className="form-footer">
          <Button onClick={onClose}>{t("cancel")}</Button>
          <button type="submit" className="primary" disabled={action.isPending}>
            {t("save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ResourceRow({ item, onEdit }: { item: Resource; onEdit: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const action = useAction(`resources/${item.id}`, "PUT", () => toast(t("saved")));
  const remove = useAction(`resources/${item.id}`, "DELETE", () => toast(t("saved")));
  return (
    <div className="resource-row">
      <div className="management-row">
        <span className="resource-icon">
          <FileBox size={19} />
        </span>
        <div className="identity">
          <strong className="mono">{item.slug}</strong>
          <p>
            {t(item.kind)} · {t(item.policy)}
          </p>
        </div>
        <Pill value={item.enabled ? "enabled" : "disabled"} />
        <div className="actions">
          <Button onClick={onEdit}>{t("edit")}</Button>
          {item.enabled ? (
            <Confirm
              label={t("disable")}
              onConfirm={() =>
                action.mutate({ ...item, content_type: item.contentType, enabled: false })
              }
            />
          ) : (
            <Button
              onClick={() =>
                action.mutate({ ...item, content_type: item.contentType, enabled: true })
              }
            >
              {t("enable")}
            </Button>
          )}
          <Confirm label={t("remove")} onConfirm={() => remove.mutate({})} />
        </div>
      </div>
      <details className="fingerprint">
        <summary>
          {t("safePreview")} · {item.size} B
        </summary>
        <p>{t("contentSafety")}</p>
        <code>SHA-256 {item.hash}</code>
        <CopyButton value={item.hash} />
      </details>
      <ErrorBox error={action.error ?? remove.error} />
    </div>
  );
}
export function Resources() {
  const { t } = useTranslation();
  const query = useData<Resource[]>("resources");
  const [form, setForm] = useState<Resource | "new" | null>(null);
  return (
    <>
      <PageHeading title={t("resources")} description={t("resourcesDesc")}>
        <Button className="primary" onClick={() => setForm("new")}>
          <Plus size={16} />
          {t("newResource")}
        </Button>
      </PageHeading>
      <ErrorBox error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <Skeleton />
      ) : (
        <section className="panel">
          {query.data?.length ? (
            query.data.map((item) => (
              <ResourceRow key={item.id} item={item} onEdit={() => setForm(item)} />
            ))
          ) : (
            <Empty>
              <Button onClick={() => setForm("new")}>{t("newResource")}</Button>
            </Empty>
          )}
        </section>
      )}
      {form && (
        <ResourceForm
          {...(form !== "new" ? { resource: form } : {})}
          onClose={() => setForm(null)}
        />
      )}
    </>
  );
}
