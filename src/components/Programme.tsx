import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DOMAIN_BY_ID } from '../content/domains';
import type { Item } from '../content/types';
import { WORKDAY, type WorkdayEvent } from '../content/workday';
import { useProgress, type Attempt } from '../store/progress';
import { Pictogram } from './Pictogram';
import { cx } from './ui';

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export function itemDone(item: Item, a?: Attempt) {
  if (!a) return false;
  return item.kind === 'open' ? a.status === 'submitted' : a.status === 'correct';
}

export function eventProgress(e: WorkdayEvent, progress: Record<string, Attempt>) {
  const done = e.items.filter((i) => itemDone(i, progress[i.id])).length;
  return { done, total: e.items.length };
}

export function nextEvent(progress: Record<string, Attempt>): WorkdayEvent | null {
  return WORKDAY.find((e) => eventProgress(e, progress).done < e.items.length) ?? null;
}

/**
 * The signature programme strip: the workday as flag-coloured events on a time axis.
 * Wide screens get a proportional schedule; narrower screens a horizontally scrolling row.
 */
export function ProgrammeStrip({ current, compact }: { current?: string; compact?: boolean }) {
  const progress = useProgress((s) => s.progress);
  return (
    <div>
      {/* proportional schedule */}
      <div className="relative hidden xl:block">
        <ol className="flex w-full gap-[3px]" aria-label="Workday programme">
          {WORKDAY.map((e) => (
            <li key={e.id} style={{ flexGrow: mins(e.end) - mins(e.time), flexBasis: 0 }} className="min-w-[88px]">
              <EventCell e={e} done={eventProgress(e, progress).done} current={current === e.id} compact={compact} />
            </li>
          ))}
        </ol>
      </div>
      {/* scrolling row */}
      <ol className="flex snap-x gap-[3px] overflow-x-auto pb-1 xl:hidden" aria-label="Workday programme">
        {WORKDAY.map((e) => (
          <li key={e.id} className={cx('shrink-0 snap-start', compact ? 'w-[96px]' : 'w-[128px]')}>
            <EventCell e={e} done={eventProgress(e, progress).done} current={current === e.id} compact={compact} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function EventCell({ e, done, current, compact }: { e: WorkdayEvent; done: number; current: boolean; compact?: boolean }) {
  const d = DOMAIN_BY_ID[e.domain];
  const total = e.items.length;
  const complete = done === total;
  return (
    <Link
      to={`/workday/${e.id}`}
      aria-current={current ? 'step' : undefined}
      title={`${e.time}–${e.end} · ${e.title} · ${done}/${total} done`}
      className={cx('flex h-full flex-col bg-surface no-underline outline-offset-1 transition-colors duration-150 hover:bg-surface-2', current && 'ring-2 ring-[var(--ink)] ring-inset')}
    >
      {/* the flag band: full discipline colour, with the event's pictogram */}
      <span className={cx('flex items-center justify-between px-2', compact ? 'h-6' : 'h-7')} style={{ background: d.color, color: d.onColor }}>
        <span className="text-[11.5px] font-semibold tnum">{e.time}</span>
        {complete ? <Check size={14} strokeWidth={3} aria-label="complete" /> : <Pictogram domain={e.domain} size={14} />}
      </span>
      <span className={cx('flex flex-1 flex-col gap-1 px-2', compact ? 'py-1.5' : 'pt-2 pb-2')}>
        <span className={cx('font-cond leading-[1.15] font-[650] text-ink', compact ? 'line-clamp-2 text-[12.5px]' : 'line-clamp-3 text-[14px]')}>{e.title}</span>
        {!compact && (
          <span className="mt-auto flex items-center gap-2 text-[11px] text-ink-3 tnum">
            <span className="h-[3px] flex-1 bg-surface-3" aria-hidden>
              <span className="band-fill block h-full bg-[var(--ink-2)]" style={{ width: `${(done / total) * 100}%` }} />
            </span>
            {done}/{total}
          </span>
        )}
      </span>
    </Link>
  );
}
