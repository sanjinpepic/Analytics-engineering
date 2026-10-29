import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DOMAIN_BY_ID } from '../content/domains';
import type { Item } from '../content/types';
import { WORKDAY, type WorkdayEvent } from '../content/workday';
import { useProgress, type Attempt } from '../store/progress';
import { Pictogram } from './Pictogram';
import { cx } from './ui';

const DAY_START = 8 * 60 + 30;
const DAY_END = 17 * 60 + 30;
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
 * The signature programme strip: the workday as colour-banded events on a time axis.
 * Wide screens get a proportional horizontal schedule; narrow screens a stacked timetable.
 */
export function ProgrammeStrip({ current, compact }: { current?: string; compact?: boolean }) {
  const progress = useProgress((s) => s.progress);
  const hours = Array.from({ length: 10 }, (_, i) => 9 + i).filter((h) => h * 60 <= DAY_END);
  return (
    <div>
      {/* horizontal schedule */}
      <div className="relative hidden md:block">
        {!compact && (
          <div className="relative mb-1 h-4 text-[11px] text-ink-3 tnum" aria-hidden>
            <span className="absolute left-0">08:30</span>
            {hours.map((h) => (
              <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h * 60 - DAY_START) / (DAY_END - DAY_START)) * 100}%` }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
            <span className="absolute right-0">17:30</span>
          </div>
        )}
        <ol className="flex w-full gap-[3px]" aria-label="Workday programme">
          {WORKDAY.map((e) => {
            const d = DOMAIN_BY_ID[e.domain];
            const width = mins(e.end) - mins(e.time);
            const { done, total } = eventProgress(e, progress);
            const complete = done === total;
            const isCurrent = current === e.id;
            return (
              <li key={e.id} style={{ flexGrow: width, flexBasis: 0 }} className="min-w-0">
                <Link
                  to={`/workday/${e.id}`}
                  aria-current={isCurrent ? 'step' : undefined}
                  title={`${e.time}–${e.end} · ${e.title} · ${done}/${total} done`}
                  className={cx(
                    'group flex h-full flex-col bg-surface no-underline outline-offset-1 transition-colors duration-150 hover:bg-surface-2',
                    isCurrent && 'ring-2 ring-[var(--ink)] ring-inset',
                  )}
                >
                  <span className="relative block h-2 bg-surface-3" aria-hidden>
                    <span className="band-fill absolute inset-y-0 left-0" style={{ width: `${(done / total) * 100}%`, background: d.color }} />
                    <span className="absolute inset-0 opacity-25" style={{ background: d.color }} />
                  </span>
                  <span className={cx('flex flex-1 flex-col gap-1 px-2', compact ? 'py-1.5' : 'pt-2 pb-2.5')}>
                    <span className="flex items-center justify-between gap-1">
                      <span className="text-[11.5px] font-semibold text-ink-2 tnum">{e.time}</span>
                      {complete ? <Check size={13} className="shrink-0 text-ok" aria-label="complete" /> : <span style={{ color: d.color }}><Pictogram domain={e.domain} size={compact ? 13 : 15} /></span>}
                    </span>
                    {!compact && <span className="font-cond line-clamp-3 text-[14px] leading-[1.15] font-[650] text-ink">{e.title}</span>}
                    {!compact && (
                      <span className="mt-auto text-[11px] text-ink-3 tnum">
                        {done}/{total}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
      {/* stacked timetable on small screens */}
      <ol className="space-y-[3px] md:hidden" aria-label="Workday programme">
        {WORKDAY.map((e) => {
          const d = DOMAIN_BY_ID[e.domain];
          const { done, total } = eventProgress(e, progress);
          return (
            <li key={e.id}>
              <Link to={`/workday/${e.id}`} aria-current={current === e.id ? 'step' : undefined} className={cx('flex items-center gap-3 bg-surface px-3 py-2.5 no-underline', current === e.id && 'ring-2 ring-[var(--ink)] ring-inset')}>
                <span className="inline-flex size-7 shrink-0 items-center justify-center" style={{ background: d.color, color: d.onColor }} aria-hidden>
                  <Pictogram domain={e.domain} size={15} />
                </span>
                <span className="w-11 text-[12px] font-semibold text-ink-2 tnum">{e.time}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-[620] text-ink">{e.title}</span>
                  <span className="block text-[12px] text-ink-3">{d.short}</span>
                </span>
                <span className="text-[12px] text-ink-3 tnum">
                  {done === total ? <Check size={14} className="text-ok" aria-label="complete" /> : `${done}/${total}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
