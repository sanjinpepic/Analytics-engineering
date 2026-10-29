import { ArrowRight, Check, Clock } from 'lucide-react';
import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { DOMAIN_BY_ID } from '../content/domains';
import { THEORY, THEORY_BY_ID } from '../content/theory';
import { WORKDAY } from '../content/workday';
import type { DomainId } from '../content/types';
import { ItemView } from '../components/items/ItemView';
import { Markdown } from '../components/Markdown';
import { Pictogram } from '../components/Pictogram';
import { itemDone } from '../components/Programme';
import { Page } from '../components/Shell';
import { Button, ButtonLink, Meter, PageHeader } from '../components/ui';
import { useProgress } from '../store/progress';

export function TheoryIndex() {
  const progress = useProgress((s) => s.progress);
  const read = useProgress((s) => s.modulesRead);
  return (
    <Page>
      <PageHeader title="Theory" lead="Ten modules, one per discipline, in the order they come up in the workday. Each ends with practice questions; code marked “Run in SQL gym” executes against the Tidepool warehouse." />
      <ol className="mt-6 divide-y divide-line border-y border-line">
        {THEORY.map((m) => {
          const d = DOMAIN_BY_ID[m.domain];
          const done = m.practice.filter((i) => itemDone(i, progress[i.id])).length;
          const event = WORKDAY.find((e) => e.moduleId === m.id);
          return (
            <li key={m.id}>
              <Link to={`/theory/${m.id}`} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-4 py-4 no-underline hover:bg-surface/60 sm:grid-cols-[40px_minmax(0,1fr)_160px_110px]">
                <span className="inline-flex size-10 items-center justify-center" style={{ background: d.color, color: d.onColor }} aria-hidden>
                  <Pictogram domain={m.domain} size={22} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-[650] text-ink">{m.title}</span>
                  <span className="mt-0.5 block text-[13.5px] leading-snug text-ink-2">{m.summary}</span>
                  {event && <span className="mt-1 block text-[12px] text-ink-3 tnum">Used at {event.time} · {event.title}</span>}
                </span>
                <span className="hidden sm:block">
                  <Meter value={m.practice.length ? done / m.practice.length : 0} color={d.color} label={`${m.title} practice progress`} />
                  <span className="mt-1 block text-[12px] text-ink-3 tnum">
                    {done}/{m.practice.length} practice done
                  </span>
                </span>
                <span className="hidden items-center justify-end gap-1.5 text-[12.5px] text-ink-3 sm:flex">
                  {read[m.id] ? (
                    <>
                      <Check size={13} className="text-ok" aria-hidden /> Read
                    </>
                  ) : (
                    <>
                      <Clock size={13} aria-hidden /> {m.minutes} min
                    </>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Page>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function TheoryModulePage() {
  const { id } = useParams();
  const m = THEORY_BY_ID[id as DomainId];
  const markRead = useProgress((s) => s.markRead);
  const read = useProgress((s) => (m ? s.modulesRead[m.id] : undefined));
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);
  if (!m) return <Navigate to="/theory" replace />;
  const d = DOMAIN_BY_ID[m.domain];
  const idx = THEORY.indexOf(m);
  const next = THEORY[idx + 1];

  return (
    <Page wide>
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden self-start lg:sticky lg:top-8 lg:block">
          <Link to="/theory" className="text-[12.5px] text-ink-3 no-underline hover:text-ink">
            All modules
          </Link>
          <ol className="mt-3 space-y-1.5 border-l border-line">
            {m.sections.map((s) => (
              <li key={s.heading}>
                <a href={`#${slug(s.heading)}`} className="-ml-px block border-l border-transparent pl-3 text-[13px] leading-snug text-ink-2 no-underline hover:border-ink hover:text-ink">
                  {s.heading}
                </a>
              </li>
            ))}
            <li>
              <a href="#key-terms" className="-ml-px block border-l border-transparent pl-3 text-[13px] text-ink-2 no-underline hover:border-ink hover:text-ink">
                Key terms
              </a>
            </li>
            <li>
              <a href="#landscape" className="-ml-px block border-l border-transparent pl-3 text-[13px] text-ink-2 no-underline hover:border-ink hover:text-ink">
                The landscape, mid-2026
              </a>
            </li>
            <li>
              <a href="#practice" className="-ml-px block border-l border-transparent pl-3 text-[13px] font-medium text-ink no-underline hover:border-ink">
                Practice ({m.practice.length})
              </a>
            </li>
          </ol>
        </nav>

        <article className="min-w-0">
          <header className="flex items-start gap-4 border-b border-line pb-6">
            <span className="inline-flex size-12 shrink-0 items-center justify-center" style={{ background: d.color, color: d.onColor }} aria-hidden>
              <Pictogram domain={m.domain} size={26} />
            </span>
            <div className="max-w-[70ch]">
              <h1 className="font-display text-[34px] leading-[1.05] uppercase text-ink">{m.title}</h1>
              <p className="mt-1.5 text-[15.5px] leading-relaxed text-ink-2">{m.summary}</p>
              <p className="mt-2 text-[12.5px] text-ink-3">
                {m.minutes} min read · Job ad: “{d.jobAd}”
              </p>
            </div>
          </header>

          <div className="max-w-[75ch]">
            {m.sections.map((s) => (
              <section key={s.heading} id={slug(s.heading)} className="scroll-mt-6 pt-8">
                <h2 className="text-[21px] leading-snug font-[680] tracking-[-0.01em] text-ink">{s.heading}</h2>
                <div className="mt-3">
                  <Markdown>{s.body}</Markdown>
                </div>
              </section>
            ))}

            <section id="key-terms" className="scroll-mt-6 pt-10">
              <h2 className="text-[21px] font-[680] text-ink">Key terms</h2>
              <dl className="mt-3 divide-y divide-line border-y border-line">
                {m.keyTerms.map((t) => (
                  <div key={t.term} className="grid gap-1 py-2.5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-[14px] font-[640] text-ink">{t.term}</dt>
                    <dd className="text-[14px] leading-relaxed text-ink-2">{t.definition}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section id="landscape" className="scroll-mt-6 pt-10">
              <h2 className="text-[21px] font-[680] text-ink">The landscape, mid-2026</h2>
              <div className="mt-3 bg-surface p-5">
                <Markdown>{m.landscape}</Markdown>
                <p className="mt-3 text-[12px] text-ink-3">A snapshot. Vendors move fast, so check current docs before quoting specifics in an interview.</p>
              </div>
            </section>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3 border-y border-line py-4">
            {read ? (
              <span className="inline-flex items-center gap-1.5 text-[13.5px] text-ok">
                <Check size={15} aria-hidden /> Marked as read
              </span>
            ) : (
              <Button variant="primary" onClick={() => markRead(m.id)}>
                <Check size={14} aria-hidden /> Mark as read
              </Button>
            )}
            <span className="text-[13px] text-ink-3">Then test yourself below.</span>
          </div>

          <section id="practice" className="scroll-mt-6 pt-8" aria-labelledby="practice-h">
            <h2 id="practice-h" className="text-[21px] font-[680] text-ink">
              Practice
            </h2>
            <p className="mt-1 text-[14px] text-ink-2">Explanations appear after you answer. Written answers are graded by Claude when you export a report.</p>
            <div className="mt-5 space-y-6">
              {m.practice.map((item, i) => (
                <ItemView key={item.id} item={item} index={i + 1} />
              ))}
            </div>
          </section>

          {next && (
            <div className="mt-10 flex justify-end border-t border-line pt-5">
              <ButtonLink to={`/theory/${next.id}`} variant="primary">
                Next module: {next.title} <ArrowRight size={14} aria-hidden />
              </ButtonLink>
            </div>
          )}
        </article>
      </div>
    </Page>
  );
}
