import { ArrowRight, Check, SkipForward } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DRILL_BY_ID, generateDrill, randomSeed } from '../content/drills';
import { DOMAIN_BY_ID } from '../content/domains';
import type { Item } from '../content/types';
import { ItemView } from '../components/items/ItemView';
import { Page } from '../components/Shell';
import { Button, ButtonLink, PageHeader, cx } from '../components/ui';
import { BOX_DAYS, MAX_BOX, dueLabel } from '../lib/srs';
import { useProgress } from '../store/progress';
import { PRACTICE_BY_ID, reviewEntries, type ReviewEntry } from '../lib/review';

function itemFor(e: ReviewEntry, seed: number): Item | null {
  if (e.template) return generateDrill(e.template, seed);
  return e.itemId ? PRACTICE_BY_ID[e.itemId] : null;
}

export function ReviewPage() {
  const progress = useProgress((s) => s.progress);
  const srs = useProgress((s) => s.srs);
  const entries = useMemo(() => reviewEntries(progress, srs), [progress, srs]);
  const now = Date.now();
  const due = entries.filter((e) => e.entry.due <= now);
  const upcoming = entries.filter((e) => e.entry.due > now);
  const [session, setSession] = useState<{ queue: ReviewEntry[]; seeds: number[]; i: number; results: ('ok' | 'miss' | 'skip')[] } | null>(null);
  const [answered, setAnswered] = useState<'ok' | 'miss' | null>(null);

  const boxes = Array.from({ length: MAX_BOX }, (_, i) => entries.filter((e) => e.entry.box === i + 1).length);

  const start = () => {
    const queue = due.slice(0, 25);
    setSession({ queue, seeds: queue.map(() => randomSeed()), i: 0, results: [] });
    setAnswered(null);
  };
  const advance = (r: 'ok' | 'miss' | 'skip') => {
    if (!session) return;
    setSession({ ...session, i: session.i + 1, results: [...session.results, r] });
    setAnswered(null);
  };

  if (session && session.i < session.queue.length) {
    const e = session.queue[session.i];
    const item = itemFor(e, session.seeds[session.i]);
    return (
      <Page wide>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-[34px] leading-[1.05] uppercase">Review</h1>
            <p className="mt-1 text-[13.5px] text-ink-2 tnum">
              {session.i + 1} of {session.queue.length} · box {e.entry.box} ({BOX_DAYS[e.entry.box]}-day gap){e.template ? ' · a new question for this drill skill' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {answered ? (
              <Button variant="primary" onClick={() => advance(answered)}>
                Next <ArrowRight size={14} aria-hidden />
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => advance('skip')}>
                <SkipForward size={14} aria-hidden /> Skip for now
              </Button>
            )}
            <Button variant="ghost" onClick={() => setSession(null)}>
              End review
            </Button>
          </div>
        </div>
        <ol className="mb-5 flex gap-[3px]" aria-label="Review progress">
          {session.queue.map((q, i) => {
            const r = session.results[i];
            return (
              <li
                key={q.key}
                className={cx('h-2 flex-1', r === 'ok' ? 'bg-ok' : r === 'miss' ? 'bg-bad' : r === 'skip' ? 'bg-line-strong' : i === session.i ? 'bg-[var(--ink)]' : 'bg-surface-3')}
                title={q.title}
              />
            );
          })}
        </ol>
        {item ? (
          <ItemView key={`${e.key}-${session.i}`} item={item} fresh onGraded={(g) => setAnswered(g.correct ? 'ok' : 'miss')} />
        ) : (
          <p className="text-ink-2">This item no longer exists. Skip it.</p>
        )}
      </Page>
    );
  }

  const finished = session && session.i >= session.queue.length;
  return (
    <Page>
      <PageHeader
        title="Review"
        lead="Spaced repetition for everything you practise. Missed items come back tomorrow; each correct review moves an item to the next box and stretches the gap (1, 3, 7, 16, 35, then 90 days). Drill skills come back as a new question, so you re-learn the move rather than an answer."
      />

      {finished && (
        <div className="mt-6 bg-ok-soft px-4 py-3 text-[14px] text-ink" role="status">
          <strong className="font-semibold">Review done.</strong> {session.results.filter((r) => r === 'ok').length} right, {session.results.filter((r) => r === 'miss').length} to see again tomorrow
          {session.results.some((r) => r === 'skip') && `, ${session.results.filter((r) => r === 'skip').length} skipped`}.
        </div>
      )}

      <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" aria-label="Review status">
        <div>
          <h2 className="text-[17px] font-[680] text-ink">Boxes</h2>
          <ol className="mt-3 grid grid-cols-6 gap-[3px]">
            {boxes.map((n, i) => (
              <li key={i} className="bg-surface px-2 py-3 text-center">
                <span className="block text-[11.5px] text-ink-3 tnum">{BOX_DAYS[i + 1]} d</span>
                <span className="block text-[24px] font-[700] text-ink tnum">{n}</span>
                <span className="mt-1 block h-1.5" style={{ background: i < 2 ? 'var(--d-dbt)' : i < 4 ? 'var(--d-semantic)' : 'var(--d-quality)' }} aria-hidden />
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[12.5px] text-ink-3">Items move right as you keep getting them right; a miss sends one back to the 1-day box.</p>
        </div>
        <div className="self-start border border-line bg-surface p-5">
          <p className="text-[13px] text-ink-2">Due now</p>
          <p className="text-[40px] leading-none font-[700] text-ink tnum">{due.length}</p>
          {due.length > 0 ? (
            <Button variant="primary" className="mt-4 w-full" onClick={start}>
              Start review{due.length > 25 ? ' (25 at a time)' : ''}
            </Button>
          ) : entries.length ? (
            <p className="mt-3 text-[13.5px] text-ink-2">
              <Check size={14} className="mr-1 inline text-ok" aria-hidden />
              Nothing due. Next item {upcoming[0] ? dueLabel(upcoming[0].entry.due, now) : 'when you practise more'}.
            </p>
          ) : (
            <div className="mt-3 text-[13.5px] text-ink-2">
              <p>Nothing scheduled yet. Answer some practice questions and they’ll start coming back here.</p>
              <ButtonLink to="/drills" className="mt-3">
                Start with a drill
              </ButtonLink>
            </div>
          )}
        </div>
      </section>

      {entries.length > 0 && (
        <section className="mt-10" aria-labelledby="schedule">
          <h2 id="schedule" className="text-[17px] font-[680] text-ink">
            Schedule
          </h2>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {entries.slice(0, 40).map((e) => {
              const item = e.itemId ? PRACTICE_BY_ID[e.itemId] : null;
              const domain = item ? DOMAIN_BY_ID[item.domain] : e.template ? DOMAIN_BY_ID[DRILL_BY_ID[e.template].domain] : null;
              return (
                <li key={e.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                  {domain && <span className="inline-block size-3 shrink-0" style={{ background: domain.color }} aria-hidden />}
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{e.title}</span>
                  <span className="text-[12px] text-ink-3 tnum">box {e.entry.box}</span>
                  <span className={cx('w-24 text-right text-[12.5px] tnum', e.entry.due <= now ? 'font-semibold text-bad' : 'text-ink-3')}>{dueLabel(e.entry.due, now)}</span>
                </li>
              );
            })}
          </ul>
          {entries.length > 40 && <p className="mt-2 text-[12.5px] text-ink-3">and {entries.length - 40} more.</p>}
        </section>
      )}
      <p className="mt-8 text-[12.5px] text-ink-3">
        Written answers aren’t scheduled; Claude grades those. Exam tasks never come back here, so <Link to="/exam">the exam</Link> stays unseen.
      </p>
    </Page>
  );
}
