import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Belt } from '../../shared/types';
import { beltKey, useT } from '../i18n';
import { Icon, type IconName } from './Icon';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ button ---

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl2 font-medium transition-colors ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-series disabled:opacity-50 disabled:pointer-events-none select-none ' +
  'whitespace-nowrap';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-series text-white hover:brightness-110 active:brightness-95',
  secondary: 'bg-raised text-ink ring-1 ring-hairline hover:bg-plane',
  ghost: 'text-ink-soft hover:bg-raised hover:text-ink',
  danger: 'bg-critical text-white hover:brightness-110',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // 44px minimum height on md/lg: these are tapped on a phone, often by
  // someone holding it one-handed on the mat.
  const sizes = {
    sm: 'h-9 px-3 text-sm',
    md: 'h-11 px-4 text-[0.95rem]',
    lg: 'h-12 px-5 text-base w-full',
  };
  return (
    <button
      type="button"
      className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], sizes[size], className)}
      {...rest}
    >
      {icon && <Icon name={icon} className="size-4 shrink-0" />}
      {children}
    </button>
  );
}

// -------------------------------------------------------------------- card ---

export function Card({
  className,
  children,
  as: As = 'div',
}: {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'li';
}) {
  return (
    <As className={cx('rounded-xl2 bg-surface ring-1 ring-hairline shadow-card', className)}>
      {children}
    </As>
  );
}

export function SectionTitle({
  children,
  action,
  hint,
}: {
  children: ReactNode;
  action?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-ink-soft">{children}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------- badges ---

export type Tone = 'neutral' | 'good' | 'warning' | 'serious' | 'critical' | 'info';

const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-plane text-ink-soft',
  good: 'bg-good-tint text-ink',
  warning: 'bg-warning-tint text-ink',
  serious: 'bg-serious-tint text-ink',
  critical: 'bg-critical-tint text-ink',
  info: 'bg-series-tint text-ink',
};

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-axis',
  good: 'bg-good',
  warning: 'bg-warning',
  serious: 'bg-serious',
  critical: 'bg-critical',
  info: 'bg-series',
};

/**
 * A status chip. The label is always rendered and the text wears an ink token,
 * never the status colour — the coloured dot (and optional icon) sits beside
 * it. That keeps meaning off colour alone, which matters because `warning` is
 * deliberately sub-3:1 on the light surface.
 */
export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_BG[tone],
        className,
      )}
    >
      {icon ? (
        <Icon name={icon} className="size-3.5 shrink-0" />
      ) : (
        <span className={cx('size-2 shrink-0 rounded-full', TONE_DOT[tone])} />
      )}
      {children}
    </span>
  );
}

/**
 * Belt and stripe count. The name is always written out and the stripes are
 * drawn as discrete marks, so the grade never rests on the belt colour alone —
 * which matters most for a white belt with no stripes, whose pill is otherwise
 * a blank shape on a pale surface.
 */
export function BeltBadge({
  belt,
  stripes,
  className,
}: {
  belt: Belt;
  stripes: number;
  className?: string;
}) {
  const t = useT();
  return (
    <span
      data-belt={belt}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold',
        'ring-1 ring-[color:var(--belt-ring)]',
        className,
      )}
      style={{ background: 'var(--belt-bg)', color: 'var(--belt-ink)' }}
    >
      {t(beltKey(belt))}
      {stripes > 0 && (
        <span className="flex items-center gap-[2px]" aria-label={`${stripes}`}>
          {Array.from({ length: stripes }, (_, i) => (
            <span key={i} className="block h-3 w-[3px] rounded-sm bg-current opacity-90" />
          ))}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- stat tile ---

/**
 * Stat tile: label, value, optional sub-line. Values use the font's default
 * proportional figures — tabular figures look loose at display sizes and are
 * reserved for columns that must align.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: IconName;
  onClick?: () => void;
}) {
  const interactive = !!onClick;
  return (
    <Card
      className={cx(
        'p-3',
        interactive && 'cursor-pointer transition-colors hover:bg-raised',
      )}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onClick?.();
                }
              }
            : undefined
        }
      >
        <div className="flex items-center gap-1.5 text-xs text-ink-muted">
          {icon && <Icon name={icon} className="size-3.5" />}
          <span>{label}</span>
        </div>
        <div className="mt-1 text-2xl font-semibold leading-none text-ink">{value}</div>
        {sub && (
          <div className="mt-1.5 flex items-center gap-1 text-xs">
            {tone !== 'neutral' && (
              <span className={cx('size-1.5 rounded-full', TONE_DOT[tone])} />
            )}
            <span className="text-ink-soft">{sub}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Meter. The track is a lighter step of the fill's own ramp so the state reads
 * across the whole bar rather than only where it is filled.
 */
export function Meter({
  value,
  tone = 'info',
  label,
  className,
}: {
  /** 0–1. */
  value: number;
  tone?: Tone;
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const fill: Record<Tone, string> = {
    neutral: 'bg-axis',
    good: 'bg-good',
    warning: 'bg-warning',
    serious: 'bg-serious',
    critical: 'bg-critical',
    info: 'bg-series',
  };
  const track: Record<Tone, string> = {
    neutral: 'bg-plane',
    good: 'bg-good-tint',
    warning: 'bg-warning-tint',
    serious: 'bg-serious-tint',
    critical: 'bg-critical-tint',
    info: 'bg-series-tint',
  };
  return (
    <div
      className={cx('h-2 w-full overflow-hidden rounded-full', track[tone], className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cx('h-full rounded-full transition-[width] duration-300', fill[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// -------------------------------------------------------------- form fields ---

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-ink">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>
      )}
    </label>
  );
}

const CONTROL =
  'w-full rounded-xl2 bg-raised text-ink ring-1 ring-hairline px-3 h-11 ' +
  'placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-series';

export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, 'h-auto min-h-20 py-2', className)} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROL, 'appearance-none pe-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-start"
    >
      <span
        className={cx(
          'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-series' : 'bg-axis',
        )}
      >
        <span
          className={cx(
            'absolute size-5 rounded-full bg-white transition-all',
            checked ? 'start-[1.125rem]' : 'start-0.5',
          )}
        />
      </span>
      <span className="text-sm text-ink">{label}</span>
    </button>
  );
}

/** Segmented control — the mobile-friendly stand-in for a row of radios. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx(
        'no-scrollbar flex gap-1 overflow-x-auto rounded-xl2 bg-plane p-1 ring-1 ring-hairline',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-sm transition-colors',
              active ? 'bg-surface font-semibold text-ink shadow-card' : 'text-ink-soft',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className="tnum text-xs text-ink-muted">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------- bottom sheet ---

/**
 * Bottom sheet. On a phone this is reachable with a thumb; on a wide screen it
 * becomes a centred dialog.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          'relative max-h-[92dvh] w-full overflow-y-auto bg-surface shadow-sheet outline-none',
          'rounded-t-2xl sm:max-w-lg sm:rounded-2xl',
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-hairline bg-surface px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="close">
            <Icon name="x" className="size-4" />
          </Button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <div
            className="sticky bottom-0 border-t border-hairline bg-surface px-4 py-3"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  tone = 'critical',
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  tone?: 'critical' | 'primary';
  busy?: boolean;
}) {
  const t = useT();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            className="flex-1"
            variant={tone === 'critical' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t('common.saving') : confirmLabel}
          </Button>
        </div>
      }
    >
      {body && <div className="text-sm text-ink-soft">{body}</div>}
    </Sheet>
  );
}

// ---------------------------------------------------------------- feedback ---

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin text-ink-muted', className)} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingBlock() {
  const t = useT();
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-muted">
      <Spinner />
      {t('common.loading')}
    </div>
  );
}

export function EmptyState({
  icon = 'info',
  children,
  action,
}: {
  icon?: IconName;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-plane text-ink-muted">
        <Icon name={icon} className="size-5" />
      </span>
      <p className="text-sm text-ink-soft">{children}</p>
      {action}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const message = useMemo(() => {
    // Imported lazily to avoid a cycle: api -> i18n -> ui -> api.
    const code = (error as { code?: string } | null)?.code;
    if (code === 'network') return t('err.network');
    if (code === 'forbidden') return t('err.forbidden');
    return t('err.generic');
  }, [error, t]);

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-critical-tint text-ink">
        <Icon name="alert" className="size-5" />
      </span>
      <p className="text-sm text-ink-soft">{message}</p>
      {onRetry && (
        <Button icon="refresh" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- toasts ---

interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastApi {
  show: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const show = useCallback((message: string, tone: Tone = 'good') => {
    const id = next.current++;
    setToasts((all) => [...all, { id, message, tone }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 3500);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              'pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-card ring-1 ring-hairline',
              TONE_BG[toast.tone],
            )}
          >
            <span className={cx('size-2 shrink-0 rounded-full', TONE_DOT[toast.tone])} />
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
