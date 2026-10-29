import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DOMAINS } from '../content/domains';
import { PRACTICE_ITEMS } from '../content/catalog';
import { EXAM } from '../content/exam';
import { Page } from '../components/Shell';
import { ProgrammeStrip, nextEvent } from '../components/Programme';
import { Pictogram } from '../components/Pictogram';
import { PosterLettering } from '../components/Poster';
import { useDueCount } from '../lib/review';
import { ButtonLink, Meter } from '../components/ui';
import { LEVELS, practiceLevel, practiceMastery, scoreExam } from '../lib/scoring';
import { useProgress } from '../store/progress';

export function Home() {
  const progress = useProgress((s) => s.progress);
  const history = useProgress((s) => s.examHistory);
  const live = useProgress((s) => s.exam);
  const next = nextEvent(progress);
  const due = useDueCount();
  const mastery = practiceMastery(PRACTICE_ITEMS, progress);
  const practice = practiceLevel(mastery);
  const lastExam = history[0] ? scoreExam(history[0], EXAM) : null;
  const level = lastExam?.level ?? (Object.keys(progress).length ? practice.level : null);
  const levelIdx = level ? LEVELS.findIndex((l) => l.code === level.code) : -1;
  const attempted = Object.keys(progress).length;

  return (
    <>
      <section aria-labelledby="day-title" className="bg-[var(--poster)] px-4 pt-6 pb-8 sm:px-8">
        <div className="mx-auto max-w-[1500px]">
          <div className="ticked-frame">
            <ProgrammeStrip current={next?.id} />
          </div>
          <div className="mt-8">
            <PosterLettering id="day-title" title="The analytics engineer’s day" subtitle="Tidepool Coffee Co." meta="1 July 2026 · 08:30 — 17:30" />
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            {next ? (
              <ButtonLink to={`/workday/${next.id}`} variant="poster" className="h-11 px-5 text-[15px]">
                Continue: {next.time} {next.title} <ArrowRight size={16} aria-hidden />
              </ButtonLink>
            ) : (
              <ButtonLink to="/exam" variant="poster" className="h-11 px-5 text-[15px]">
                Day complete: sit the licence exam <ArrowRight size={16} aria-hidden />
              </ButtonLink>
            )}
            {due > 0 ? (
              <ButtonLink to="/review" variant="poster" className="h-11 px-5 text-[15px]">
                {due} to review
              </ButtonLink>
            ) : (
              <span className="text-[13px] text-[var(--rail-ink-2)]">Ten disciplines · every task runs for real · a synthetic company</span>
            )}
          </div>
        </div>
      </section>

    <Page wide>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="standings">
          <div className="flex items-baseline justify-between border-b border-line pb-2">
            <h2 id="standings" className="text-[17px] font-[680] text-ink">
              Discipline standings
            </h2>
            <span className="text-[12.5px] text-ink-3">Practice mastery, weighted by difficulty</span>
          </div>
          <table className="w-full table-fixed border-collapse text-[14px]">
            <colgroup>
              <col />
              <col className="w-[30%]" />
              <col className="w-14" />
              <col className="w-16 max-sm:w-0" />
            </colgroup>
            <thead className="sr-only">
              <tr>
                <th>Discipline</th>
                <th>Job-ad requirement</th>
                <th>Mastery</th>
                <th>Tried</th>
              </tr>
            </thead>
            <tbody>
              {DOMAINS.map((d) => {
                const m = mastery.find((x) => x.domain === d.id)!;
                return (
                  <tr key={d.id} className="border-b border-line">
                    <td className="py-2.5 pr-3 align-middle">
                      <Link to={`/theory/${d.id}`} className="flex items-center gap-2.5 no-underline">
                        <span className="inline-flex size-7 shrink-0 items-center justify-center" style={{ background: d.color, color: d.onColor }} aria-hidden>
                          <Pictogram domain={d.id} size={16} />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-[620] text-ink hover:underline">{d.name}</span>
                          <span className="block truncate text-[12px] text-ink-3 max-sm:hidden">{d.jobAd}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 align-middle">
                      <Meter value={m.pct ?? 0} color={d.color} label={`${d.name} mastery`} />
                    </td>
                    <td className="w-12 py-2.5 text-right align-middle font-semibold text-ink tnum">{m.pct === null ? '—' : `${Math.round(m.pct * 100)}%`}</td>
                    <td className="w-16 py-2.5 pl-2 text-right align-middle text-[12px] text-ink-3 tnum max-sm:hidden">
                      {m.answered}/{m.total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[12.5px] text-ink-3">
            {attempted ? `${attempted} practice items attempted.` : 'Nothing attempted yet.'} Practice pulls from the workday, theory modules and SQL gym; the exam uses a separate, unseen pool.
          </p>
        </section>

        <aside aria-labelledby="licence" className="self-start border border-line bg-surface">
          <div className="border-b border-line px-5 py-3">
            <h2 id="licence" className="text-[17px] font-[680] text-ink">
              Licence status
            </h2>
            <p className="mt-0.5 text-[12.5px] text-ink-3">{lastExam ? `From your exam on ${new Date(history[0].finishedAt!).toLocaleDateString()}` : level ? 'Estimated from practice so far' : 'Practise or sit the exam to get a level'}</p>
          </div>
          <ol className="px-5 py-3">
            {[...LEVELS].reverse().map((l) => {
              const i = LEVELS.indexOf(l);
              const reached = levelIdx >= i;
              const isCurrent = levelIdx === i;
              return (
                <li key={l.code} className="flex items-center gap-3 py-1.5">
                  <span className={`inline-flex h-7 w-9 shrink-0 items-center justify-center text-[12px] font-bold ${isCurrent ? 'bg-[var(--ink)] text-[var(--surface)]' : reached ? 'bg-surface-3 text-ink' : 'border border-line text-ink-3'}`}>{l.code}</span>
                  <span className="min-w-0">
                    <span className={`block text-[14px] ${isCurrent ? 'font-[680] text-ink' : 'text-ink-2'}`}>{l.plate}</span>
                    <span className="block text-[12px] text-ink-3">{l.role}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {level && <p className="border-t border-line px-5 py-3 text-[13px] leading-relaxed text-ink-2">{level.description}</p>}
          <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
            <ButtonLink to={live ? '/exam/run' : '/exam'} variant="primary">
              {live ? 'Resume exam' : 'Sit the licence exam'}
            </ButtonLink>
            {history.length > 0 && <ButtonLink to="/report">Send results to Claude</ButtonLink>}
          </div>
          <p className="px-5 pb-4 text-[12px] text-ink-3">
            {EXAM.length} unseen tasks · about 75 minutes · written answers graded by Claude
          </p>
        </aside>
      </div>
    </Page>
    </>
  );
}

