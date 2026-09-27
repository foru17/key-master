import { ArrowUpRight, Check, Clock3 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAction, useData } from "./api";
import {
  Button,
  Confirm,
  Empty,
  ErrorBox,
  PageHeading,
  SecretDialog,
  Skeleton,
  Timestamp,
  useToast,
} from "./components";
import {
  ClientBadge,
  flag,
  formatDuration,
  IpBadge,
  networkLabel,
  ScopeChip,
  useLocation,
} from "./identity";
import type { IpInfo, Issued, Pending, Settings } from "./types";
export function ApprovalRow({
  item,
  onIssued,
}: {
  item: Pending;
  onIssued: (value: Issued) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const settings = useData<Settings>("settings");
  const action = useAction<Partial<Issued>>(`approvals/${item.id}`, "POST", (data) => {
    toast(`${item.subject} · ${t("approvalSaved")}`);
    if (data.secret) onIssued(data as Issued);
  });
  const durations = settings.data?.durations.options ?? [600, 3600];
  const [ip, family] = item.subject.split("|");
  const place = useLocation(item.ipInfo);
  const network = networkLabel(item.ipInfo);
  return (
    <div className="approval-item">
      <div className="approval-identity">
        <span className="pending-mark">
          <Clock3 size={17} />
        </span>
        <div className="approval-body">
          <div className="approval-title">
            <strong className="mono">{ip}</strong>
            {item.ipInfo && item.ipInfo.scope !== "public" ? (
              <ScopeChip info={item.ipInfo} />
            ) : place ? (
              <span className="approval-origin">
                {flag(item.ipInfo?.country)} {place}
              </span>
            ) : null}
          </div>
          {network && <p className="approval-network">{network}</p>}
          <p className="approval-meta">
            <ClientBadge client={item.client} fallback={family} />
            <code>{item.slugs.join(", ")}</code>
          </p>
        </div>
      </div>
      <div className="actions approval-actions">
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
      </div>
      <ErrorBox error={action.error} />
    </div>
  );
}
export function PendingList({ items }: { items: Pending[] }) {
  const { t } = useTranslation();
  const [issued, setIssued] = useState<Issued | null>(null);
  return (
    <>
      {items.length ? (
        <div>
          {items.map((item) => (
            <ApprovalRow key={item.id} item={item} onIssued={setIssued} />
          ))}
        </div>
      ) : (
        <Empty title={t("allClear")} />
      )}
      {issued && <SecretDialog issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}
export function Approvals() {
  const { t, i18n } = useTranslation();
  const query = useData<{
    pending: Pending[];
    recent: {
      id: string;
      subject: string;
      action: string;
      actor: string;
      durationS: number;
      ts: number;
      ipInfo?: IpInfo | null;
    }[];
  }>("approvals");
  return (
    <>
      <PageHeading title={t("approvals")} description={t("approvalsDesc")} />
      <ErrorBox error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <Skeleton />
      ) : (
        query.data && (
          <>
            <section className="panel">
              <div className="section-head">
                <h2>{t("needsYou")}</h2>
                <span className="count">{query.data.pending.length}</span>
              </div>
              <PendingList items={query.data.pending} />
            </section>
            <section className="panel">
              <div className="section-head">
                <h2>{t("recent")}</h2>
              </div>
              {query.data.recent.length ? (
                <div className="data-list">
                  {query.data.recent.map((row) => (
                    <div className="data-row" key={row.id}>
                      <IpBadge ip={row.subject.split("|")[0] ?? row.subject} info={row.ipInfo} />
                      <span>
                        {t(row.action, { defaultValue: row.action })} ·{" "}
                        {formatDuration(row.durationS, i18n.language)}
                      </span>
                      <span className="muted">{row.actor}</span>
                      <Timestamp value={row.ts} />
                    </div>
                  ))}
                </div>
              ) : (
                <Empty />
              )}
            </section>
          </>
        )
      )}
    </>
  );
}
