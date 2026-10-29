import { BookOpen, CalendarClock, Database, Dumbbell, FileText, GraduationCap, Menu, Monitor, Moon, RotateCcw, Sun, TerminalSquare, X } from 'lucide-react';
import { useDueCount } from '../lib/review';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useProgress } from '../store/progress';
import { Mark } from './Pictogram';
import { useWarehouse } from './Warehouse';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Today', icon: CalendarClock, end: true },
  { to: '/theory', label: 'Theory', icon: BookOpen },
  { to: '/gym', label: 'SQL gym', icon: Database },
  { to: '/drills', label: 'Drills', icon: Dumbbell },
  { to: '/review', label: 'Review', icon: RotateCcw },
  { to: '/workspace', label: 'dbt workspace', icon: TerminalSquare },
  { to: '/exam', label: 'Licence exam', icon: GraduationCap },
  { to: '/report', label: 'Report', icon: FileText },
];

function useTheme() {
  const theme = useProgress((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}

function ThemeSwitch() {
  const theme = useProgress((s) => s.theme);
  const setTheme = useProgress((s) => s.setTheme);
  const opts = [
    { v: 'light' as const, icon: Sun, label: 'Light' },
    { v: 'system' as const, icon: Monitor, label: 'System' },
    { v: 'dark' as const, icon: Moon, label: 'Dark' },
  ];
  return (
    <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-[3px] bg-black/10 p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={theme === o.v}
          aria-label={o.label}
          title={o.label}
          onClick={() => setTheme(o.v)}
          className={cx('inline-flex size-7 items-center justify-center rounded-[2px] text-rail-ink-2', theme === o.v && 'bg-[var(--rail-active)] text-[var(--rail-active-ink)]')}
        >
          <o.icon size={14} aria-hidden />
        </button>
      ))}
    </div>
  );
}

function WarehouseStatus() {
  const s = useWarehouse();
  return (
    <p className="flex items-center gap-2 text-[12px] text-rail-ink-2" aria-live="polite">
      <span className={cx('inline-block size-2', s.state === 'ready' ? 'bg-[var(--d-quality)]' : s.state === 'error' ? 'bg-[var(--bad)]' : 'bg-[var(--d-warehouse)]')} aria-hidden />
      {s.state === 'ready' ? 'Warehouse ready · DuckDB' : s.state === 'error' ? 'Warehouse failed to start' : 'Warehouse starting…'}
    </p>
  );
}

function RailContent({ onNavigate }: { onNavigate?: () => void }) {
  const exam = useProgress((s) => s.exam);
  const due = useDueCount();
  return (
    <div className="flex h-full flex-col">
      <NavLink to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-4 pt-5 pb-6 no-underline">
        <Mark size={30} />
        <span className="leading-tight">
          <span className="block text-[16px] font-[720] tracking-[-0.01em] text-rail-ink">AE Licence</span>
          <span className="block text-[11.5px] text-rail-ink-2">Analytics engineering</span>
        </span>
      </NavLink>
      <nav aria-label="Main" className="flex-1 px-2">
        <ul className="space-y-0.5">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cx(
                    'flex h-9 items-center gap-2.5 rounded-[3px] px-2.5 text-[14px] font-medium no-underline transition-colors duration-150',
                    isActive ? 'bg-[var(--rail-active)] text-[var(--rail-active-ink)]' : 'text-rail-ink hover:bg-rail-hover',
                  )
                }
              >
                <n.icon size={16} aria-hidden />
                {n.label}
                {n.to === '/review' && due > 0 && <span className="ml-auto min-w-6 bg-[var(--rail-active)] px-1.5 text-center text-[11px] font-semibold text-[var(--rail-active-ink)] tnum">{due}</span>}
                {n.to === '/exam' && exam && <span className="ml-auto bg-[var(--rail-active)] px-1.5 text-[11px] font-semibold text-[var(--rail-active-ink)]">LIVE</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="space-y-3 px-4 pt-4 pb-5">
        <WarehouseStatus />
        <p className="text-[11.5px] leading-snug text-rail-ink-2">Tidepool Coffee Co. and its people and data are synthetic.</p>
        <ThemeSwitch />
      </div>
    </div>
  );
}

export function Shell() {
  useTheme();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    setOpen(false);
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  return (
    <div className="min-h-dvh bg-ground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] bg-rail lg:block">
        <RailContent />
      </aside>
      {/* mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-rail px-4 lg:hidden">
        <NavLink to="/" className="flex items-center gap-2 no-underline">
          <Mark size={26} />
          <span className="text-[15px] font-[720] text-rail-ink">AE Licence</span>
        </NavLink>
        <button type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex size-9 items-center justify-center text-rail-ink">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[260px] bg-rail">
            <RailContent onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <main id="main" tabIndex={-1} className="outline-none lg:pl-[232px]">
        <Outlet />
      </main>
    </div>
  );
}

export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={cx('mx-auto px-4 py-8 sm:px-8 lg:py-10', wide ? 'max-w-[1500px]' : 'max-w-[1180px]')}>{children}</div>;
}
