import { AlertCircle, Check, Copy, KeyRound, ShieldCheck, X } from "lucide-react";
import {
  cloneElement,
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { formatTimestamp } from "../../../packages/core/src/time";
import type { Issued } from "./types";
export const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function Button({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props}>
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  drawer = false,
  locked = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  drawer?: boolean;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { t } = useTranslation();
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={drawer ? "modal drawer" : "modal"}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        {!locked && (
          <Button className="icon-button" aria-label={t("close")} onClick={onClose}>
            <X size={19} />
          </Button>
        )}
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Confirm({
  label,
  onConfirm,
  description,
  disabled = false,
}: {
  label: string;
  onConfirm: () => void;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const { t } = useTranslation();
  return (
    <>
      <Button className="danger quiet" popoverTarget={id} disabled={disabled}>
        {label}
      </Button>
      <div id={id} popover="auto" className="confirm-popover">
        <h3>{t("confirmTitle")}</h3>
        <p>{description ?? t("destructive")}</p>
        <div className="actions">
          <Button popoverTarget={id} popoverTargetAction="hide">
            {t("cancel")}
          </Button>
          <Button
            className="danger"
            popoverTarget={id}
            popoverTargetAction="hide"
            onClick={onConfirm}
          >
            {t("confirm")}
          </Button>
        </div>
      </div>
    </>
  );
}
export function Empty({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="empty">
      <span className="empty-icon">
        <ShieldCheck size={18} />
      </span>
      <h3>{title ?? t("empty")}</h3>
      <p>{hint ?? t("emptyHint")}</p>
      {children}
    </div>
  );
}
/** Header row for a grid table; every row of the same table shares its column template. */
export function TableHead({ columns }: { columns: (string | null)[] }) {
  return (
    <div className="thead">
      {columns.map((label, i) => (
        <span key={String(i)} className={label ? undefined : "visually-hidden"}>
          {label}
        </span>
      ))}
    </div>
  );
}
export function Skeleton() {
  const { t } = useTranslation();
  return (
    <div className="skeletons" aria-label={t("loading")} role="status">
      {[1, 2, 3, 4].map((i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
export function ErrorBox({ error, retry }: { error: Error | null; retry?: () => void }) {
  const { t } = useTranslation();
  return error ? (
    <div role="alert" className="error">
      <AlertCircle size={17} />
      <span>{error.message}</span>
      {retry && <Button onClick={retry}>{t("retry")}</Button>}
    </div>
  ) : null;
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}
export function Pill({ value }: { value: string }) {
  const { t } = useTranslation();
  const tone =
    value === "deny_pending" || value === "device_token"
      ? value === "device_token"
        ? "info"
        : "pending"
      : value.startsWith("allow") || value === "active" || value === "enabled"
        ? "allow"
        : value.startsWith("deny") || value === "revoked"
          ? "deny"
          : "neutral";
  return (
    <span className={`pill ${tone}`}>
      <i />
      {t(value, { defaultValue: value })}
    </span>
  );
}
export function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            toast(t("copied"));
          })
          .catch(() => toast(t("error")));
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />} {t("copy")}
    </Button>
  );
}
export function SecretDialog({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal title={t("secretTitle")} onClose={onClose}>
      <div className="dialog-symbol">
        <KeyRound size={24} />
      </div>
      <p>{t("secretNote")}</p>
      <div className="secret">
        <code>{issued.secret}</code>
        <CopyButton value={issued.secret} />
      </div>
      <h3>{t("readyUrls")}</h3>
      {issued.urls.map((url) => (
        <div className="secret" key={url}>
          <code>{url}</code>
          <CopyButton value={url} />
        </div>
      ))}
      <Button className="primary full" onClick={onClose}>
        {t("close")}
      </Button>
    </Modal>
  );
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Timestamp({ value }: { value: number | null }) {
  const { i18n, t } = useTranslation();
  if (value === null) return <span className="mono">{t("never")}</span>;
  const iso = new Date(value).toISOString();
  return (
    <time className="mono timestamp" dateTime={iso} title={iso}>
      {formatTimestamp(value, i18n.language)}
    </time>
  );
}
