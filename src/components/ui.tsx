import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { DOMAIN_BY_ID } from '../content/domains';
import type { DomainId } from '../content/types';
import { Pictogram } from './Pictogram';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'poster';
const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-[3px] font-medium text-sm h-9 px-3.5 transition-colors duration-150 disabled:opacity-50 select-none whitespace-nowrap';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-ink hover:bg-primary-hover',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-3 hover:text-ink',
  danger: 'bg-surface text-bad border border-line-strong hover:bg-bad-soft',
  /** cream on the orange poster field */
  poster: 'bg-[var(--rail-active)] text-[var(--rail-active-ink)] hover:bg-[var(--surface)] shadow-[0_3px_10px_-4px_rgba(0,0,0,0.35)]',
};

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }>(
  function Button({ variant = 'secondary', size = 'md', className, ...rest }, ref) {
    return <button ref={ref} type="button" className={cx(buttonBase, buttonVariants[variant], size === 'sm' && 'h-8 px-2.5 text-[13px]', className)} {...rest} />;
  },
);

export function ButtonLink({ to, variant = 'secondary', className, children }: { to: string; variant?: ButtonVariant; className?: string; children: React.ReactNode }) {
  return (
    <Link to={to} className={cx(buttonBase, buttonVariants[variant], 'no-underline', className)}>
      {children}
    </Link>
  );
}

/** Discipline identity: colour square + pictogram + name. */
export function DomainTag({ domain, compact }: { domain: DomainId; compact?: boolean }) {
  const d = DOMAIN_BY_ID[domain];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
      <span className="inline-flex size-[18px] items-center justify-center rounded-[2px]" style={{ background: d.color, color: d.onColor }}>
        <Pictogram domain={domain} size={12} />
      </span>
      {compact ? d.short : d.name}
    </span>
  );
}

export function DifficultyMark({ level }: { level: 1 | 2 | 3 }) {
  const label = level === 1 ? 'Foundation' : level === 2 ? 'Working AE' : 'Senior';
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3" title={`Difficulty: ${label}`}>
      <span className="inline-flex gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cx('h-[10px] w-[4px]', i <= level ? 'bg-ink-2' : 'bg-line-strong')} />
        ))}
      </span>
      {label}
    </span>
  );
}

export function StatusPill({ tone, children }: { tone: 'ok' | 'bad' | 'warn' | 'info' | 'muted'; children: React.ReactNode }) {
  const tones = {
    ok: 'bg-ok-soft text-ok',
    bad: 'bg-bad-soft text-bad',
    warn: 'bg-warn-soft text-warn',
    info: 'bg-primary-soft text-primary',
    muted: 'bg-surface-3 text-ink-2',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[12px] font-semibold', tones[tone])}>{children}</span>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-[3px] border border-line-strong bg-surface px-1 font-mono text-[11px] text-ink-2">{children}</kbd>;
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="max-w-3xl">
        <h1 className="font-display text-[34px] leading-[1.05] uppercase text-ink">{title}</h1>
        {lead && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Meter({ value, color, label }: { value: number; color: string; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="h-2 w-full bg-surface-3" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="h-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
