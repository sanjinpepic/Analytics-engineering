import { ArrowLeft, ArrowRight, BookOpen, Check, MessageSquare } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { DOMAIN_BY_ID } from '../content/domains';
import { WORKDAY } from '../content/workday';
import { THEORY_BY_ID } from '../content/theory';
import { ItemView } from '../components/items/ItemView';
import { Markdown } from '../components/Markdown';
import { Pictogram } from '../components/Pictogram';
import { ProgrammeStrip, eventProgress } from '../components/Programme';
import { Page } from '../components/Shell';
import { ButtonLink } from '../components/ui';
import { useProgress } from '../store/progress';

export function WorkdayEventPage() {
  const { id } = useParams();
  const idx = WORKDAY.findIndex((e) => e.id === id);
  const progress = useProgress((s) => s.progress);
  if (idx < 0) return <Navigate to="/" replace />;
  const e = WORKDAY[idx];
  const d = DOMAIN_BY_ID[e.domain];
  const prev = WORKDAY[idx - 1];
  const next = WORKDAY[idx + 1];
  const { done, total } = eventProgress(e, progress);
  const mod = THEORY_BY_ID[e.moduleId];

  return (
    <Page wide>
      <ProgrammeStrip current={e.id} compact />
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center" style={{ background: d.color, color: d.onColor }} aria-hidden>
              <Pictogram domain={e.domain} size={22} />
            </span>
            <div>
              <h1 className="font-display text-[34px] leading-[1.05] uppercase text-ink">{e.title}</h1>
              <p className="mt-1 text-[13px] font-semibold text-ink-2 tnum">
                {e.time}–{e.end} · {d.name}
              </p>
            </div>
          </div>

          <section aria-label="Situation" className="mt-6 border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-[13px]">
              <MessageSquare size={14} className="text-ink-3" aria-hidden />
              <span className="font-semibold text-ink">{e.brief.from}</span>
              <span className="text-ink-3">in {e.brief.channel}</span>
            </div>
            <div className="max-w-[75ch] px-4 py-3">
              <Markdown compact>{e.brief.body}</Markdown>
            </div>
          </section>

          <div className="mt-6 space-y-6">
            {e.items.map((item, i) => (
              <ItemView key={item.id} item={item} index={i + 1} />
            ))}
          </div>

          <nav aria-label="Workday navigation" className="mt-8 flex flex-wrap justify-between gap-3 border-t border-line pt-5">
            {prev ? (
              <ButtonLink to={`/workday/${prev.id}`}>
                <ArrowLeft size={14} aria-hidden /> {prev.time} {prev.title}
              </ButtonLink>
            ) : (
              <span />
            )}
            {next ? (
              <ButtonLink to={`/workday/${next.id}`} variant="primary">
                Next: {next.time} {next.title} <ArrowRight size={14} aria-hidden />
              </ButtonLink>
            ) : (
              <ButtonLink to="/exam" variant="primary">
                End of the day: sit the licence exam <ArrowRight size={14} aria-hidden />
              </ButtonLink>
            )}
          </nav>
        </div>

        <aside className="space-y-4 self-start lg:sticky lg:top-6">
          <div className="border border-line bg-surface p-4">
            <p className="text-[13px] text-ink-2">Progress in this event</p>
            <p className="mt-1 text-[26px] font-[700] text-ink tnum">
              {done}
              <span className="text-[16px] font-normal text-ink-3">/{total}</span>
            </p>
            <ul className="mt-3 space-y-1.5">
              {e.items.map((it, i) => {
                const a = progress[it.id];
                const ok = a && (it.kind === 'open' ? a.status === 'submitted' : a.status === 'correct');
                return (
                  <li key={it.id} className="flex items-center gap-2 text-[13px]">
                    <span className={`inline-flex size-4 shrink-0 items-center justify-center text-[10px] font-bold ${ok ? 'bg-ok text-[var(--surface)]' : a ? 'bg-warn-soft text-warn' : 'border border-line-strong text-ink-3'}`} aria-hidden>
                      {ok ? <Check size={11} strokeWidth={3} /> : i + 1}
                    </span>
                    <a href={`#item-${it.id}`} className="truncate text-ink-2 no-underline hover:text-ink hover:underline">
                      {it.title}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
          {mod && (
            <Link to={`/theory/${mod.id}`} className="block border border-line bg-surface p-4 no-underline hover:bg-surface-2">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <BookOpen size={14} aria-hidden /> Revise first
              </p>
              <p className="mt-1 text-[14px] text-ink">{mod.title}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">{mod.minutes} min read</p>
            </Link>
          )}
        </aside>
      </div>
    </Page>
  );
}
