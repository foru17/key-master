import {
  ArrowUpRight,
  Braces,
  CloudDownload,
  Copy,
  Ellipsis,
  FileText,
  Fingerprint,
  KeyRound,
  ListFilter,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { type CSSProperties, type FormEvent, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAction, useData } from "./api";
import {
  Button,
  Confirm,
  Empty,
  ErrorBox,
  Field,
  Modal,
  PageHeading,
  Pill,
  SecretDialog,
  Skeleton,
  TableHead,
  useToast,
} from "./components";
import { formatBytes, formatRemaining, IpBadge, RelativeTime } from "./identity";
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
type GrantStatus = "active" | "expired" | "revoked";
const grantStatus = (item: Grant): GrantStatus =>
  item.revokedAt !== null ? "revoked" : item.expiresAt <= Date.now() ? "expired" : "active";
function GrantRow({ item, onEdit }: { item: Grant; onEdit: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const action = useAction(`grants/${item.id}`, "DELETE", () => toast(t("saved")));
  const status = grantStatus(item);
  const [ip = item.subject, family] = item.subject.split("|");
  return (
    <div className={`tr management-row${status === "active" ? "" : " is-muted"}`}>
      <div className="td primary">
        <IpBadge ip={ip} info={item.ipInfo} />
      </div>
      <div className="td" data-label={t("client")}>
        {family ? (
          <span className="tag mono">{family}</span>
        ) : (
          <span className="muted">{t("anyClient")}</span>
        )}
      </div>
      <div className="td" data-label={t("colScope")}>
        <code className="cell-mono truncate" title={item.scope.join(", ")}>
          {item.scope.join(", ")}
        </code>
      </div>
      <div className="td" data-label={t("grantedBy")}>
        <span className="cell-mono muted truncate" title={item.grantedBy}>
          {item.grantedBy}
        </span>
      </div>
      <div className="td status-cell" data-label={t("status")}>
        <Pill value={status} />
        <span className="cell-mono muted" title={new Date(item.expiresAt).toISOString()}>
          {status === "active" ? (
            t("timeLeft", { value: formatRemaining(item.expiresAt, i18n.language) })
          ) : (
            <RelativeTime value={status === "revoked" ? item.revokedAt : item.expiresAt} />
          )}
        </span>
      </div>
      <div className="td actions">
        <Button onClick={onEdit}>{t(status === "active" ? "edit" : "renew")}</Button>
        {status === "active" ? (
          <Confirm
            disabled={action.isPending}
            label={t("revoke")}
            onConfirm={() => action.mutate({})}
          />
        ) : (
          <span className="action-spacer" aria-hidden="true">
            <Button className="danger quiet" tabIndex={-1}>
              {t("revoke")}
            </Button>
          </span>
        )}
      </div>
      {action.error && (
        <div className="td row-error">
          <ErrorBox error={action.error} />
        </div>
      )}
    </div>
  );
}
export function Grants() {
  const { t } = useTranslation();
  const query = useData<Grant[]>("grants");
  const [form, setForm] = useState<Grant | "new" | null>(null);
  const [view, setView] = useState<"all" | "active" | "inactive">("all");
  const items = [...(query.data ?? [])].sort(
    (a, b) =>
      Number(grantStatus(b) === "active") - Number(grantStatus(a) === "active") ||
      b.createdAt - a.createdAt,
  );
  const counts = {
    all: items.length,
    active: items.filter((g) => grantStatus(g) === "active").length,
    inactive: items.filter((g) => grantStatus(g) !== "active").length,
  };
  const visible = items.filter(
    (g) => view === "all" || (view === "active") === (grantStatus(g) === "active"),
  );
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
      ) : items.length ? (
        <>
          <div className="toolbar">
            <fieldset className="segmented" aria-label={t("status")}>
              {(["all", "active", "inactive"] as const).map((v) => (
                <button type="button" key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                  {v === "all" ? t("allPolicies") : t(v)}
                  <span className="segment-count">{counts[v]}</span>
                </button>
              ))}
            </fieldset>
          </div>
          <div className="data-table is-grid t-grants">
            <TableHead
              columns={[
                t("colOrigin"),
                t("client"),
                t("colScope"),
                t("grantedBy"),
                t("status"),
                null,
              ]}
            />
            {visible.length ? (
              visible.map((item) => (
                <GrantRow key={item.id} item={item} onEdit={() => setForm(item)} />
              ))
            ) : (
              <Empty title={t("grantsNoMatch")} hint={t("grantsEmptyHint")} />
            )}
          </div>
        </>
      ) : (
        <div className="data-table">
          <Empty title={t("grantsEmpty")} hint={t("grantsEmptyHint")}>
            <Button onClick={() => setForm("new")}>{t("newGrant")}</Button>
          </Empty>
        </div>
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
  const status =
    item.revokedAt !== null
      ? "revoked"
      : item.expiresAt !== null && item.expiresAt < Date.now()
        ? "expired"
        : "active";
  return (
    <div className={`tr management-row${status === "active" ? "" : " is-muted"}`}>
      <div className="td primary">
        <span className="stack">
          <strong className="truncate">{item.label}</strong>
          <span className="muted">{t(item.kind)}</span>
        </span>
      </div>
      <div className="td" data-label={t("colScope")}>
        <code className="cell-mono truncate" title={item.scope.join(", ")}>
          {item.scope.join(", ")}
        </code>
      </div>
      <div className="td" data-label={t("usage")}>
        <svg
          className="sparkline"
          viewBox="0 0 98 24"
          role="img"
          aria-label={`${t("usage")}: ${usage.reduce((a, b) => a + b, 0)}`}
        >
          <title>{t("usage")}</title>
          {usage.map((n, i) => (
            <rect
              key={String(i)}
              x={i * 14}
              y={24 - Math.max(2, (n / max) * 22)}
              width="10"
              height={Math.max(2, (n / max) * 22)}
              rx="2"
              fill={n ? "var(--chart-1)" : "var(--border)"}
            />
          ))}
        </svg>
      </div>
      <div className="td" data-label={t("colLastUsed")}>
        <span className="cell-mono muted">
          <RelativeTime value={item.lastUsedAt} empty={t("never")} />
        </span>
      </div>
      <div className="td status-cell" data-label={t("status")}>
        <Pill value={status} />
        <span className="cell-mono muted">
          {item.expiresAt === null ? t("noExpiry") : <RelativeTime value={item.expiresAt} />}
        </span>
      </div>
      <div className="td actions">
        {status === "revoked" ? (
          <span className="action-spacer" aria-hidden="true">
            <Button className="danger quiet" tabIndex={-1}>
              {t("revoke")}
            </Button>
          </span>
        ) : (
          <Confirm
            disabled={action.isPending}
            label={t("revoke")}
            onConfirm={() => action.mutate({})}
          />
        )}
      </div>
      {action.error && (
        <div className="td row-error">
          <ErrorBox error={action.error} />
        </div>
      )}
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
      ) : query.data?.length ? (
        <div className="data-table is-grid t-tokens">
          <TableHead
            columns={[t("label"), t("colScope"), t("usage"), t("colLastUsed"), t("status"), null]}
          />
          {query.data.map((item) => (
            <TokenRow key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="data-table">
          <Empty title={t("tokensEmpty")} hint={t("tokensEmptyHint")}>
            <Button onClick={() => setForm(true)}>{t("newToken")}</Button>
          </Empty>
        </div>
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
            pattern="\/[A-Za-z0-9._\/\-]+"
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
        {resource && (
          <div className="fingerprint-box">
            <div className="fingerprint-head">
              <Fingerprint size={15} />
              <strong className="fingerprint-title">{t("fingerprintLabel")}</strong>
              <span className="muted">· {formatBytes(resource.size)}</span>
            </div>
            <code>SHA-256 {resource.hash}</code>
            <p className="muted">{t("contentSafety")}</p>
          </div>
        )}
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
const kindIcons = { file: FileText, inline: Braces, upstream: CloudDownload } as const;
const policies = ["approval", "token_only", "public"] as const;
function PolicyPill({ policy }: { policy: Resource["policy"] }) {
  const { t } = useTranslation();
  return (
    <span className={`policy-pill policy-${policy}`}>
      <i />
      {t(policy)}
    </span>
  );
}
function ResourceSwitch({ item }: { item: Resource }) {
  const { t } = useTranslation();
  const toast = useToast();
  const id = useId();
  const action = useAction(`resources/${item.id}`, "PUT", () => toast(t("saved")));
  const set = (enabled: boolean) =>
    action.mutate({ ...item, content_type: item.contentType, enabled });
  return (
    <div className="resource-state">
      {item.enabled ? (
        <>
          <button
            type="button"
            role="switch"
            aria-checked="true"
            aria-label={t("disable")}
            className="switch on"
            popoverTarget={id}
            disabled={action.isPending}
          >
            <i />
          </button>
          <div id={id} popover="auto" className="confirm-popover">
            <h3>{t("confirmTitle")}</h3>
            <p>{t("disableHelp")}</p>
            <div className="actions">
              <Button popoverTarget={id} popoverTargetAction="hide">
                {t("cancel")}
              </Button>
              <Button
                className="danger"
                popoverTarget={id}
                popoverTargetAction="hide"
                onClick={() => set(false)}
              >
                {t("confirm")}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked="false"
          aria-label={t("enable")}
          className="switch"
          disabled={action.isPending}
          onClick={() => set(true)}
        >
          <i />
        </button>
      )}
      <span className={item.enabled ? "state-label on" : "state-label"}>
        {t(item.enabled ? "enabled" : "disabled")}
      </span>
      <ErrorBox error={action.error} />
    </div>
  );
}
function ResourceMenu({ item }: { item: Resource }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const id = useId();
  const anchor = `--menu-${id.replace(/[^A-Za-z0-9]/g, "")}`;
  const remove = useAction(`resources/${item.id}`, "DELETE", () => toast(t("saved")));
  const copy = (value: string) =>
    void navigator.clipboard
      .writeText(value)
      .then(() => toast(t("copied")))
      .catch(() => toast(t("error")));
  return (
    <>
      <Button
        className="icon-button row-menu-trigger"
        aria-label={t("moreActions")}
        popoverTarget={id}
        style={{ anchorName: anchor } as CSSProperties}
      >
        <Ellipsis size={17} />
      </Button>
      <div
        id={id}
        popover="auto"
        className="dropdown row-menu"
        style={{ positionAnchor: anchor } as CSSProperties}
      >
        <Button popoverTarget={id} popoverTargetAction="hide" onClick={() => copy(item.slug)}>
          {t("copyPath")}
          <Copy size={14} />
        </Button>
        <Button
          popoverTarget={id}
          popoverTargetAction="hide"
          onClick={() => navigate(`/requests?resource=${encodeURIComponent(item.slug)}`)}
        >
          {t("viewRequests")}
          <ListFilter size={14} />
        </Button>
        <Button popoverTarget={id} popoverTargetAction="hide" onClick={() => copy(item.hash)}>
          {t("copyFingerprint")}
          <Fingerprint size={14} />
        </Button>
        <hr />
        <Confirm
          label={t("remove")}
          description={t("deleteHelp")}
          disabled={remove.isPending}
          onConfirm={() => remove.mutate({})}
        />
      </div>
      <ErrorBox error={remove.error} />
    </>
  );
}
function ResourceRow({ item, onEdit }: { item: Resource; onEdit: () => void }) {
  const { t } = useTranslation();
  const Icon = kindIcons[item.kind];
  return (
    <div className={`tr resource-row${item.enabled ? "" : " is-muted"}`}>
      <div className="td primary">
        <span className="resource-main">
          <span className="kind-icon" title={t(item.kind)}>
            <Icon size={15} />
          </span>
          <span className="stack">
            <strong className="mono truncate">{item.slug}</strong>
            <span className="muted truncate" title={item.source}>
              {t(item.kind)} · <span className="mono">{item.source}</span>
            </span>
          </span>
        </span>
      </div>
      <div className="td" data-label={t("policy")}>
        <PolicyPill policy={item.policy} />
      </div>
      <div className="td num" data-label={t("requests24h")}>
        <span className="cell-mono">
          {item.requests24h ?? "—"}
          {item.denied24h ? (
            <span className="deny-count"> · {t("deniedCount", { count: item.denied24h })}</span>
          ) : null}
        </span>
      </div>
      <div className="td hide-md" data-label={t("lastRequest")}>
        <span className="cell-mono muted">
          {item.lastRequestAt === undefined ? "—" : <RelativeTime value={item.lastRequestAt} />}
        </span>
      </div>
      <div className="td num hide-md" data-label={t("size")}>
        <span className="cell-mono muted" title={`SHA-256 ${item.hash}`}>
          {formatBytes(item.size)}
        </span>
      </div>
      <div className="td" data-label={t("status")}>
        <ResourceSwitch item={item} />
      </div>
      <div className="td actions">
        <Button className="quiet" onClick={onEdit}>
          <Pencil size={14} />
          {t("edit")}
        </Button>
        <ResourceMenu item={item} />
      </div>
    </div>
  );
}
export function Resources() {
  const { t } = useTranslation();
  const query = useData<Resource[]>("resources");
  const [form, setForm] = useState<Resource | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [policy, setPolicy] = useState<Resource["policy"] | "all">("all");
  const items = query.data ?? [];
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: items.length };
    for (const p of policies) result[p] = items.filter((item) => item.policy === p).length;
    return result;
  }, [items]);
  const needle = search.trim().toLowerCase();
  const visible = items.filter(
    (item) =>
      (policy === "all" || item.policy === policy) &&
      (!needle ||
        item.slug.toLowerCase().includes(needle) ||
        item.source.toLowerCase().includes(needle)),
  );
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
      ) : items.length ? (
        <>
          <div className="toolbar resource-toolbar">
            <div className="search-input">
              <Search size={15} />
              <input
                aria-label={t("resourceSearch")}
                placeholder={t("resourceSearch")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <fieldset className="segmented" aria-label={t("policy")}>
              {(["all", ...policies] as const).map((p) => (
                <button
                  type="button"
                  key={p}
                  aria-pressed={policy === p}
                  onClick={() => setPolicy(p)}
                >
                  {p === "all" ? t("allPolicies") : t(p)}
                  <span className="segment-count">{counts[p]}</span>
                </button>
              ))}
            </fieldset>
            <span className="toolbar-summary">
              {t("resourceTotal", { count: items.length })} ·{" "}
              {t("resourceEnabled", { count: items.filter((item) => item.enabled).length })}
            </span>
          </div>
          <div className="data-table is-grid t-resources">
            <TableHead
              columns={[
                t("resourceColumn"),
                t("policy"),
                t("requests24h"),
                t("lastRequest"),
                t("size"),
                t("status"),
                null,
              ]}
            />
            {visible.length ? (
              visible.map((item) => (
                <ResourceRow key={item.id} item={item} onEdit={() => setForm(item)} />
              ))
            ) : (
              <Empty title={t("resourcesNoMatch")} hint={t("emptyHint")}>
                <Button
                  onClick={() => {
                    setSearch("");
                    setPolicy("all");
                  }}
                >
                  {t("clearFilters")}
                </Button>
              </Empty>
            )}
          </div>
        </>
      ) : (
        <div className="data-table">
          <Empty>
            <Button onClick={() => setForm("new")}>{t("newResource")}</Button>
          </Empty>
        </div>
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
