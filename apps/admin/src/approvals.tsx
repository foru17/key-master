import { ArrowUpRight, Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAction, useData } from "./api";
import {
  Button,
  Confirm,
  Empty,
  ErrorBox,
  PageHeading,
  Pill,
  SecretDialog,
  Skeleton,
  TableHead,
  useToast,
} from "./components";
import { ClientBadge, formatDuration, formatRemaining, IpBadge, RelativeTime } from "./identity";
import type { IpInfo, Issued, Pending, Settings } from "./types";

export function ApprovalRow({
  item,
  onIssued,
}: {
  item: Pending;
  onIssued: (value: Issued) => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const settings = useData<Settings>("settings");
  const action = useAction<Partial<Issued>>(`approvals/${item.id}`, "POST", (data) => {
    toast(`${item.subject} · ${t("approvalSaved")}`);
    if (data.secret) onIssued(data as Issued);
  });
  const durations = settings.data?.durations.options ?? [600, 3600];
  const [ip = item.subject, family] = item.subject.split("|");
  return (
    <div className="tr approval-item">
      <div className="td primary">
        <IpBadge ip={ip} info={item.ipInfo} />
      </div>
      <div className="td" data-label={t("client")}>
        <ClientBadge client={item.client} fallback={family} />
      </div>
      <div className="td" data-label={t("resource")}>
        <code className="cell-mono truncate" title={item.slugs.join(", ")}>
          {item.slugs.join(", ")}
        </code>
      </div>
      <div className="td" data-label={t("colExpiresIn")}>
        <span className="cell-mono muted" title={new Date(item.expiresAt).toISOString()}>
          {formatRemaining(item.expiresAt, i18n.language)}
        </span>
      </div>
      <div className="td actions">
        {durations.map((d) => (
          <Button
            key={d}
            disabled={action.isPending}
            onClick={() => action.mutate({ action: "allow", duration: d })}
          >
            <Check size={14} />
            {t("allow")} {d % 3600 === 0 ? `${d / 3600}h` : `${d / 60}m`}
          </Button>
        ))}
        <Button
          disabled={action.isPending}
          onClick={() => action.mutate({ action: "device_token" })}
        >
          {t("device")}
          <ArrowUpRight size={13} />
        </Button>
        <Confirm
          disabled={action.isPending}
          label={t("deny")}
          onConfirm={() => action.mutate({ action: "deny" })}
        />
        <Button
          className="always-action"
          disabled={action.isPending}
          onClick={() => action.mutate({ action: "always" })}
        >
          {t("alwaysAllowIp")}
        </Button>
      </div>
      {action.error && (
        <div className="td row-error">
          <ErrorBox error={action.error} />
        </div>
      )}
    </div>
  );
}
export function PendingList({ items }: { items: Pending[] }) {
  const { t } = useTranslation();
  const [issued, setIssued] = useState<Issued | null>(null);
  return (
    <>
      {items.length ? (
        <div className="data-table is-grid t-pending">
          <TableHead
            columns={[t("colOrigin"), t("client"), t("resource"), t("colExpiresIn"), null]}
          />
          {items.map((item) => (
            <ApprovalRow key={item.id} item={item} onIssued={setIssued} />
          ))}
        </div>
      ) : (
        <div className="data-table">
          <Empty title={t("allClear")} hint={t("allClearHint")} />
        </div>
      )}
      {issued && <SecretDialog issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}
type Decision = {
  id: string;
  subject: string;
  action: string;
  actor: string;
  durationS: number;
  ts: number;
  ipInfo?: IpInfo | null;
};
function DecisionRow({ row }: { row: Decision }) {
  const { t, i18n } = useTranslation();
  const [ip = row.subject, family] = row.subject.split("|");
  return (
    <div className="tr">
      <div className="td primary">
        <IpBadge ip={ip} info={row.ipInfo} />
      </div>
      <div className="td" data-label={t("client")}>
        {family ? <span className="cell-mono">{family}</span> : <span className="muted">—</span>}
      </div>
      <div className="td" data-label={t("decision")}>
        <Pill value={row.action} />
      </div>
      <div className="td" data-label={t("colDuration")}>
        <span className="cell-mono">
          {row.action === "always" ? t("permanent") : formatDuration(row.durationS, i18n.language)}
        </span>
      </div>
      <div className="td" data-label={t("actor")}>
        <span className="cell-mono muted truncate" title={row.actor}>
          {row.actor}
        </span>
      </div>
      <div className="td end" data-label={t("time")}>
        <span className="cell-mono muted">
          <RelativeTime value={row.ts} />
        </span>
      </div>
    </div>
  );
}
export function Approvals() {
  const { t } = useTranslation();
  const query = useData<{ pending: Pending[]; recent: Decision[] }>("approvals");
  return (
    <>
      <PageHeading title={t("approvals")} description={t("approvalsDesc")} />
      <ErrorBox error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <Skeleton />
      ) : (
        query.data && (
          <>
            <section className="section">
              <div className="section-head">
                <h2>{t("needsYou")}</h2>
                <span className="count">{query.data.pending.length}</span>
              </div>
              <PendingList items={query.data.pending} />
            </section>
            <section className="section">
              <div className="section-head">
                <h2>{t("recent")}</h2>
                <span className="count">{query.data.recent.length}</span>
              </div>
              {query.data.recent.length ? (
                <div className="data-table is-grid t-decisions">
                  <TableHead
                    columns={[
                      t("colOrigin"),
                      t("client"),
                      t("decision"),
                      t("colDuration"),
                      t("actor"),
                      t("time"),
                    ]}
                  />
                  {query.data.recent.map((row) => (
                    <DecisionRow key={row.id} row={row} />
                  ))}
                </div>
              ) : (
                <div className="data-table">
                  <Empty title={t("recentEmpty")} hint={t("recentEmptyHint")} />
                </div>
              )}
            </section>
          </>
        )
      )}
    </>
  );
}
