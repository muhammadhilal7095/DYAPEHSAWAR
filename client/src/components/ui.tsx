import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, X } from 'lucide-react';
import { humanize } from '../lib/format';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ───────── Buttons ─────────
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'warning' | 'success';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-white text-ink border border-line hover:bg-gray-50 shadow-sm',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
  ghost: 'text-ink-2 hover:bg-gray-100',
};
export function Button({ variant = 'primary', size = 'md', loading, icon, children, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
export function LinkButton({ to, variant = 'primary', size = 'md', icon, children, className }: { to: string; variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition whitespace-nowrap', size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm', variants[variant], className)}>
      {icon}
      {children}
    </Link>
  );
}

// ───────── Form fields ─────────
const inputCls = (err?: string) =>
  cx(
    'w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink placeholder:text-gray-400 shadow-sm transition focus:outline-none focus:ring-2 disabled:bg-gray-50 disabled:text-ink-3',
    err ? 'border-red-400 focus:ring-red-200' : 'border-line focus:border-brand focus:ring-brand-100',
  );

export function Field({ label, error, hint, required, children, className, htmlFor }: { label?: ReactNode; error?: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      {label && (
        <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink-2">
          {label} {required && <span className="text-red-600" aria-hidden>*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-600" role="alert">
          <AlertCircle className="size-3.5" aria-hidden /> {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

type Common = { label?: ReactNode; error?: string; hint?: ReactNode; wrapClass?: string };
export function Input({ label, error, hint, wrapClass, required, ...p }: InputHTMLAttributes<HTMLInputElement> & Common) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapClass} htmlFor={p.id ?? id}>
      <input id={p.id ?? id} required={required} aria-invalid={!!error} {...p} className={cx(inputCls(error), p.className)} />
    </Field>
  );
}
export function Textarea({ label, error, hint, wrapClass, required, rows = 3, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & Common) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapClass} htmlFor={p.id ?? id}>
      <textarea id={p.id ?? id} rows={rows} required={required} aria-invalid={!!error} {...p} className={cx(inputCls(error), p.className)} />
    </Field>
  );
}
export function Select({ label, error, hint, wrapClass, required, options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & Common & { options: { value: string; label: string }[]; placeholder?: string }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapClass} htmlFor={p.id ?? id}>
      <select id={p.id ?? id} required={required} aria-invalid={!!error} {...p} className={cx(inputCls(error), 'pr-8', p.className)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function Checkbox({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-0.5 size-4 rounded border-gray-300 accent-[var(--brand)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="text-sm text-ink-2">
        {label}
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </label>
    </div>
  );
}

// ───────── Layout blocks ─────────
export function Card({ title, actions, children, className, bodyClass, subtitle, id }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section id={id} className={cx('print-card scroll-mt-20 rounded-xl border border-line bg-card shadow-sm', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="text-xs text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link to={back} className="no-print mb-1 inline-flex items-center gap-1 text-xs font-medium text-ink-3 hover:text-brand">
            <ChevronLeft className="size-3.5" /> Back
          </Link>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-ink-3">{subtitle}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KV({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-4 gap-y-3 sm:gap-x-6', cols === 3 ? 'grid-cols-2 lg:grid-cols-3' : cols === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink [overflow-wrap:anywhere]">{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden /> {label}
    </div>
  );
}
export function Empty({ title = 'Nothing here yet', children, icon }: { title?: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="text-gray-300">{icon ?? <Info className="size-8" />}</div>
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children && <div className="text-sm text-ink-3">{children}</div>}
    </div>
  );
}
export function ErrorBox({ error }: { error: any }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
      <AlertCircle className="mt-0.5 size-4 shrink-0" /> <span>{error.message ?? String(error)}</span>
    </div>
  );
}
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'success' | 'danger'; children: ReactNode }) {
  const t = { info: 'border-blue-200 bg-blue-50 text-blue-800', warning: 'border-amber-200 bg-amber-50 text-amber-900', success: 'border-emerald-200 bg-emerald-50 text-emerald-800', danger: 'border-red-200 bg-red-50 text-red-800' }[tone];
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle;
  return (
    <div className={cx('flex items-start gap-2 rounded-lg border p-3 text-sm', t)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ───────── Status badges (label always shown — never colour alone) ─────────
const tones: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  orange: 'bg-orange-50 text-orange-700 ring-orange-600/25',
  gray: 'bg-gray-100 text-gray-700 ring-gray-500/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
};
const STATUS_TONE: Record<string, string> = {
  APPROVED: 'green', VERIFIED: 'green', COMPLETED: 'green', SENT: 'green', OPERATIONAL: 'green', AVAILABLE: 'green', RESOLVED: 'green', CLOSED: 'gray', MITIGATED: 'green', IMPLEMENTED: 'green',
  ON_SCHEDULE: 'green', EXCELLENT: 'green', GOOD: 'green', SATISFACTORY: 'blue', FULLY_COMPLIANT: 'green', ACTIVE: 'green',
  PENDING_REVIEW: 'amber', UNDER_REVIEW: 'blue', PENDING_FINAL: 'violet', UNDER_VERIFICATION: 'blue', PENDING: 'amber', PENDING_ASSIGNMENT: 'amber', AWAITING_ARRIVAL: 'blue',
  SCHEDULED: 'blue', IN_PROGRESS: 'blue', CHECKED_IN: 'violet', OPEN: 'amber', MONITORING: 'blue', PLANNED: 'gray', ACTION_REQUIRED: 'orange',
  RETURNED: 'orange', SLIGHTLY_DELAYED: 'amber', PARTIALLY_COMPLIANT: 'amber', NEEDS_IMPROVEMENT: 'orange', MEDIUM: 'amber', UNDER_MAINTENANCE: 'orange', MAINTENANCE: 'orange',
  REJECTED: 'red', DECLINED: 'red', FAILED: 'red', SIGNIFICANTLY_DELAYED: 'red', NON_COMPLIANT: 'red', UNSATISFACTORY: 'red', CRITICAL: 'red', HIGH: 'orange', NO_SHOW: 'red', NOT_EFFECTIVE: 'red',
  CHANGES_REQUESTED: 'orange', REPORT_REVIEW: 'violet', AWAITING_START: 'blue', AWAITING_VERIFICATION: 'violet', SUBMITTED: 'amber', MISSED: 'red', PRESENT: 'green', ABSENT: 'red', LEAVE: 'amber', ASSIGNED: 'amber', ACKNOWLEDGED: 'blue', NORMAL: 'gray', URGENT: 'red',
  DRAFT: 'gray', CANCELLED: 'gray', NOT_STARTED: 'gray', NONE: 'gray', NOT_APPLICABLE: 'gray', NOT_ASSESSED: 'gray', LOW: 'gray', UNAVAILABLE: 'gray', PENDING_VERIFICATION: 'amber',
};
const LABELS: Record<string, string> = { AWAITING_START: 'Approved — Awaiting Start', AWAITING_VERIFICATION: 'Awaiting Verification', SUBMITTED: 'Submitted for Review', REPORT_REVIEW: 'Report Under Review', PENDING_FINAL: 'Pending Final Approval', RETURNED: 'Returned for Revision', NONE: 'Not started', AWAITING_ARRIVAL: 'Awaiting Arrival', NO_SHOW: 'No-Show', UNDER_VERIFICATION: 'Under Verification' };

export function Badge({ status, label, tone }: { status?: string | null; label?: string; tone?: keyof typeof tones }) {
  const s = status ?? '';
  const t = tone ?? (STATUS_TONE[s] as keyof typeof tones) ?? 'gray';
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[t])}>
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label ?? LABELS[s] ?? humanize(s)}
    </span>
  );
}

// ───────── Stat tile ─────────
export function Stat({ label, value, hint, to, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; to?: string; icon?: ReactNode; tone?: 'brand' | 'green' | 'amber' | 'red' | 'blue' | 'gray' }) {
  const ring = { brand: 'text-brand bg-brand-50', green: 'text-emerald-700 bg-emerald-50', amber: 'text-amber-700 bg-amber-50', red: 'text-red-700 bg-red-50', blue: 'text-blue-700 bg-blue-50', gray: 'text-gray-600 bg-gray-100' }[tone ?? 'brand'];
  const body = (
    <div className="flex h-full items-start justify-between gap-3 rounded-xl border border-line bg-card p-4 shadow-sm transition hover:shadow-md print-card">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
        <p className="tabular mt-1 text-2xl font-semibold text-ink">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      </div>
      {icon && <div className={cx('rounded-lg p-2', ring)}>{icon}</div>}
    </div>
  );
  return to ? <Link to={to} className="block focus-visible:rounded-xl">{body}</Link> : body;
}

// ───────── Executive KPI tile, stat strip and detail header ─────────
type KpiTone = 'brand' | 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'violet';
const kpiTone: Record<KpiTone, { accent: string; chip: string; icon: string }> = {
  brand: { accent: 'border-t-brand', chip: 'bg-brand-50 text-brand', icon: 'text-brand' },
  blue: { accent: 'border-t-blue-600', chip: 'bg-blue-50 text-blue-700', icon: 'text-blue-700' },
  green: { accent: 'border-t-emerald-600', chip: 'bg-emerald-50 text-emerald-700', icon: 'text-emerald-700' },
  amber: { accent: 'border-t-amber-500', chip: 'bg-amber-50 text-amber-700', icon: 'text-amber-700' },
  red: { accent: 'border-t-red-600', chip: 'bg-red-50 text-red-700', icon: 'text-red-700' },
  gray: { accent: 'border-t-gray-300', chip: 'bg-gray-100 text-gray-600', icon: 'text-gray-600' },
  violet: { accent: 'border-t-violet-600', chip: 'bg-violet-50 text-violet-700', icon: 'text-violet-700' },
};

/** Headline figure with a coloured top edge; links to the matching list when `to` is given. */
export function KpiTile({ label, value, note, to, icon, tone = 'brand', title }: { label: string; value: ReactNode; note?: ReactNode; to?: string; icon?: ReactNode; tone?: KpiTone; title?: string }) {
  const t = kpiTone[tone];
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</span>
        {icon && <span className={cx('rounded-lg p-1.5', t.chip)}>{icon}</span>}
      </span>
      <span className="tabular mt-1 text-3xl font-bold tracking-tight text-ink">{value}</span>
      {note && <span className="mt-auto pt-1 text-xs text-ink-3">{note}</span>}
    </>
  );
  const cls = cx('group flex h-full flex-col rounded-xl border border-t-4 border-line bg-white p-4 shadow-sm transition', to && 'hover:shadow-md', t.accent);
  return to ? <Link to={to} title={title} className={cls}>{body}</Link> : <div title={title} className={cls}>{body}</div>;
}

export interface StripItem { key?: string; label: string; value: ReactNode; note?: ReactNode; icon?: ReactNode; tone?: KpiTone; to?: string; onClick?: () => void; active?: boolean; title?: string }

/** A row of related figures in one bordered panel (stages, secondary metrics); items may link or act as filters. */
export function StatStrip({ title, subtitle, items, arrows }: { title?: string; subtitle?: ReactNode; items: StripItem[]; arrows?: boolean }) {
  const cols = items.length >= 5 ? 'lg:grid-cols-5' : items.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3';
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      {(title || subtitle) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {subtitle && <p className="text-xs text-ink-3">{subtitle}</p>}
        </div>
      )}
      <ol className={cx('grid grid-cols-2 sm:grid-cols-3', cols)}>
        {items.map((x, i) => {
          const inner = (
            <>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase leading-tight tracking-wider text-ink-3">
                {x.icon && <span className={cx('shrink-0', kpiTone[x.tone ?? 'gray'].icon)}>{x.icon}</span>}{x.label}
              </span>
              <span className="tabular mt-1 block text-2xl font-bold tracking-tight text-ink">{x.value}</span>
              {x.note && <span className="block text-xs text-ink-3">{x.note}</span>}
            </>
          );
          const cls = cx('block h-full px-4 py-3.5 text-left transition', (x.to || x.onClick) && 'hover:bg-gray-50', x.active && 'bg-brand-50/70 shadow-[inset_0_-2px_0_var(--brand)]');
          return (
            <li key={x.key ?? x.label} title={x.title} className={cx('relative border-b border-line sm:border-r lg:border-b-0', i === items.length - 1 && items.length % 2 === 1 && 'max-sm:col-span-2')}>
              {x.to ? <Link to={x.to} className={cls}>{inner}</Link> : x.onClick ? <button type="button" onClick={x.onClick} aria-pressed={x.active} className={cx(cls, 'w-full')}>{inner}</button> : <div className={cls}>{inner}</div>}
              {arrows && i < items.length - 1 && <ChevronRight className="absolute -right-2.5 top-1/2 z-10 hidden size-5 -translate-y-1/2 rounded-full bg-white text-ink-3 ring-1 ring-line lg:block" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Branded header band for record pages: back link, reference, title, badges, actions — then optional facts and footer. */
export function DetailHeader({ back, backLabel, reference, title, badges, actions, thumb, children }: { back?: string; backLabel?: string; reference?: ReactNode; title: ReactNode; badges?: ReactNode; actions?: ReactNode; thumb?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <div className="relative bg-gradient-to-br from-brand-700 via-brand-800 to-[#062a1a] px-5 py-5 text-white sm:px-6">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-4 max-sm:basis-full">
            {thumb && <img src={thumb} alt="" className="hidden size-24 shrink-0 rounded-xl object-cover shadow-lg ring-2 ring-white/20 sm:block" />}
            <div className="min-w-0">
              {back && <Link to={back} className="no-print inline-flex items-center gap-1 text-xs font-medium text-white/65 hover:text-white">← {backLabel ?? 'Back'}</Link>}
              {reference && <p className="mt-2 font-mono text-xs tracking-wide text-emerald-200/90">{reference}</p>}
              <h1 className="mt-0.5 text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{title}</h1>
              {badges && <div className="mt-3 flex flex-wrap items-center gap-2">{badges}</div>}
            </div>
          </div>
          {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Grid of labelled facts used under a DetailHeader (2 columns on phones, 4 on wide screens). */
export function FactGrid({ items }: { items: { icon?: ReactNode; label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 border-b border-line xl:grid-cols-4 [&>div]:border-b [&>div]:border-line [&>div:nth-child(odd)]:border-r xl:[&>div]:border-r xl:[&>div:nth-child(4n)]:border-r-0">
      {items.map((f) => {
        const empty = f.value === null || f.value === undefined || f.value === '' || f.value === '—';
        return (
          <div key={f.label} className="-mb-px flex min-w-0 gap-3 px-4 py-3 sm:px-5 sm:py-3.5">
            {f.icon && <span className="mt-0.5 hidden size-8 shrink-0 place-items-center rounded-lg bg-gray-50 text-ink-3 ring-1 ring-line sm:grid">{f.icon}</span>}
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{f.label}</dt>
              <dd className={cx('mt-0.5 line-clamp-3 break-words text-sm', empty ? 'italic text-ink-3' : 'font-medium text-ink')}>{empty ? 'Not set' : f.value}</dd>
            </div>
          </div>
        );
      })}
    </dl>
  );
}

// ───────── Tabs ─────────
export function Tabs({ tabs, value, onChange }: { tabs: { value: string; label: ReactNode; count?: number }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="no-print mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition', t.value === value ? 'border-brand text-brand' : 'border-transparent text-ink-3 hover:text-ink')}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 text-xs text-ink-2">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ───────── Pagination ─────────
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm text-ink-3">
      <span>
        {total === 0 ? 'No records' : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" icon={<ChevronLeft className="size-4" />} />
        <span className="px-2 tabular">
          {page} / {pages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" icon={<ChevronRight className="size-4" />} />
      </div>
    </div>
  );
}

// ───────── Modal & confirm ─────────
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', w)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-gray-100" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const ConfirmCtx = createContext<(o: { title: string; message: ReactNode; confirmLabel?: string; tone?: Variant }) => Promise<boolean>>(async () => false);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<null | { title: string; message: ReactNode; confirmLabel?: string; tone?: Variant; resolve: (v: boolean) => void }>(null);
  const confirm = useCallback((o: any) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title} size="sm" footer={<><Button variant="secondary" onClick={() => close(false)}>Cancel</Button><Button variant={state?.tone ?? 'primary'} onClick={() => close(true)}>{state?.confirmLabel ?? 'Confirm'}</Button></>}>
        <div className="text-sm text-ink-2">{state?.message}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ───────── Toasts ─────────
type Toast = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[2000] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg', t.tone === 'success' ? 'bg-emerald-700' : t.tone === 'error' ? 'bg-red-700' : 'bg-gray-800')}>
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Collects field errors from an ApiError for form display. */
export function useFormErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const capture = (e: any) => {
    setErrors(e?.fields ?? {});
    setFormError(e?.message ?? 'Something went wrong');
    if (e?.fields && Object.keys(e.fields).length) {
      setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 30);
    }
  };
  const clear = () => {
    setErrors({});
    setFormError(null);
  };
  return { errors, formError, capture, clear, setErrors };
}

export function Grid({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const c = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols];
  return <div className={cx('grid grid-cols-1 gap-4', c, className)}>{children}</div>;
}
