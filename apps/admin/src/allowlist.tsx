import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAction, useData } from "./api";
import {
  Button,
  Confirm,
  Empty,
  ErrorBox,
  Field,
  Modal,
  Pill,
  Skeleton,
  TableHead,
  useToast,
} from "./components";
import { RelativeTime } from "./identity";
import type { AllowlistEntry } from "./types";

function AllowlistForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const action = useAction("allowlist", "POST", () => {
    toast(t("saved"));
    onClose();
  });
  return (
    <Modal title={t("newAllowlist")} onClose={onClose}>
      <p>{t("allowlistHelp")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          action.mutate({
            value: data.get("value"),
            label: data.get("label"),
            scope: String(data.get("scope"))
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          });
        }}
      >
        <Field label={t("allowlistValue")}>
          <input name="value" placeholder="home.example.com" required maxLength={253} />
        </Field>
        <Field label={t("label")}>
          <input name="label" required maxLength={200} />
        </Field>
        <Field label={t("scope")}>
          <input name="scope" defaultValue="*" required />
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
function AllowlistRow({ item }: { item: AllowlistEntry }) {
  const { t } = useTranslation();
  const toast = useToast();
  const action = useAction(`allowlist/${item.id}`, "DELETE", () => toast(t("saved")));
  return (
    <div className="tr">
      <div className="td primary allowlist-identity">
        <strong>{item.label}</strong>
        <code className="cell-mono">{item.value}</code>
        <span className="muted cell-mono" title={t("scope")}>
          {item.scope.join(", ")}
        </span>
      </div>
      <div className="td" data-label={t("kind")}>
        <Pill value={`allowlistKind_${item.kind}`} />
      </div>
      <div className="td" data-label={t("resolvedIps")}>
        <span
          className="cell-mono allowlist-addresses"
          title={item.resolvedAt === null ? undefined : new Date(item.resolvedAt).toISOString()}
        >
          {item.resolved.join(", ") || (item.kind === "host" ? t("awaitingDns") : "—")}
        </span>
      </div>
      <div className="td" data-label={t("lastMatched")}>
        <span className="cell-mono muted">
          <RelativeTime value={item.lastMatchedAt} />
        </span>
      </div>
      <div className="td" data-label={t("source")}>
        <span className="muted">{t(`allowlistSource_${item.source}`)}</span>
      </div>
      <div className="td actions">
        <Confirm
          label={t("removeAllowlist")}
          description={t("removeAllowlistHelp")}
          disabled={action.isPending}
          onConfirm={() => action.mutate({})}
        />
      </div>
      {action.error && (
        <div className="td row-error">
          <ErrorBox error={action.error} />
        </div>
      )}
    </div>
  );
}
export function AllowlistSection() {
  const { t } = useTranslation();
  const query = useData<AllowlistEntry[]>("allowlist");
  const [form, setForm] = useState(false);
  const entries = query.data?.filter((item) => item.revokedAt === null) ?? [];
  return (
    <section className="section allowlist-section" aria-label={t("allowlist")}>
      <div className="section-head">
        <h2>{t("allowlist")}</h2>
        <span className="count">{entries.length}</span>
        <Button className="section-action" onClick={() => setForm(true)}>
          <Plus size={14} />
          {t("newAllowlist")}
        </Button>
      </div>
      <p className="section-description">{t("allowlistDesc")}</p>
      <ErrorBox error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <Skeleton />
      ) : entries.length ? (
        <div className="data-table is-grid t-allowlist">
          <TableHead
            columns={[
              t("allowlistNetwork"),
              t("kind"),
              t("resolvedIps"),
              t("lastMatched"),
              t("source"),
              null,
            ]}
          />
          {entries.map((item) => (
            <AllowlistRow key={item.id} item={item} />
          ))}
        </div>
      ) : (
        !query.error && (
          <div className="data-table">
            <Empty title={t("allowlistEmpty")} hint={t("allowlistDesc")} />
          </div>
        )
      )}
      {form && <AllowlistForm onClose={() => setForm(false)} />}
    </section>
  );
}
