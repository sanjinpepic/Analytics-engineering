import { ArrowLeft, ArrowRight, Check, Play } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { GYM } from '../content/gym';
import { ItemView } from '../components/items/ItemView';
import { ResultMeta, ResultTable } from '../components/ResultTable';
import { SchemaPanel } from '../components/SchemaPanel';
import { Page } from '../components/Shell';
import { SqlEditor } from '../components/SqlEditor';
import { NeedsWarehouse } from '../components/Warehouse';
import { Button, ButtonLink, DifficultyMark, DomainTag, Kbd, PageHeader, StatusPill } from '../components/ui';
import { query, type QueryResult } from '../lib/duckdb';
import { useProgress } from '../store/progress';

const LEVEL_NAMES = { 1: 'Foundation', 2: 'Working AE', 3: 'Senior' } as const;

export function GymIndex() {
  const progress = useProgress((s) => s.progress);
  return (
    <Page>
      <PageHeader
        title="SQL gym"
        lead="Graded SQL drills against the Tidepool warehouse. Your result set is compared with a reference answer; column names don’t matter unless the task says so, and row order only matters when it asks for an ORDER BY."
        actions={
          <>
            <ButtonLink to="/drills" variant="primary">
              Endless drills
            </ButtonLink>
            <ButtonLink to="/gym/playground">
              <Play size={14} aria-hidden /> Open the playground
            </ButtonLink>
          </>
        }
      />
      {([1, 2, 3] as const).map((lvl) => {
        const items = GYM.filter((g) => g.difficulty === lvl);
        return (
          <section key={lvl} className="mt-8" aria-labelledby={`lvl-${lvl}`}>
            <div className="flex items-baseline justify-between border-b border-line pb-2">
              <h2 id={`lvl-${lvl}`} className="text-[17px] font-[680] text-ink">
                {LEVEL_NAMES[lvl]}
              </h2>
              <span className="text-[12.5px] text-ink-3 tnum">
                {items.filter((i) => progress[i.id]?.status === 'correct').length}/{items.length} solved
              </span>
            </div>
            <ul className="divide-y divide-line">
              {items.map((g) => {
                const a = progress[g.id];
                return (
                  <li key={g.id}>
                    <Link to={`/gym/${g.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 no-underline hover:bg-surface/60">
                      <span className="min-w-0 flex-1 text-[15px] font-[600] text-ink">{g.title}</span>
                      <DomainTag domain={g.domain} compact />
                      <span className="w-24 text-right">
                        {a?.status === 'correct' ? (
                          <StatusPill tone="ok">
                            <Check size={12} aria-hidden /> Solved
                          </StatusPill>
                        ) : a ? (
                          <StatusPill tone="warn">Tried</StatusPill>
                        ) : (
                          <span className="text-[12.5px] text-ink-3">Not started</span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </Page>
  );
}

export function GymItemPage() {
  const { id } = useParams();
  const idx = GYM.findIndex((g) => g.id === id);
  if (idx < 0) return <Navigate to="/gym" replace />;
  const item = GYM[idx];
  const prev = GYM[idx - 1];
  const next = GYM[idx + 1];
  return (
    <Page wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/gym" className="text-[13px] text-ink-3 no-underline hover:text-ink">
          SQL gym
        </Link>
        <DifficultyMark level={item.difficulty} />
      </div>
      <ItemView key={item.id} item={item} />
      <nav aria-label="Drill navigation" className="mt-6 flex justify-between gap-3">
        {prev ? (
          <ButtonLink to={`/gym/${prev.id}`}>
            <ArrowLeft size={14} aria-hidden /> {prev.title}
          </ButtonLink>
        ) : (
          <span />
        )}
        {next && (
          <ButtonLink to={`/gym/${next.id}`} variant="primary">
            {next.title} <ArrowRight size={14} aria-hidden />
          </ButtonLink>
        )}
      </nav>
    </Page>
  );
}

export function Playground() {
  const draft = useProgress((s) => s.gymDraft);
  const setDraft = useProgress((s) => s.setGymDraft);
  const [sql, setSql] = useState(draft || "-- The warehouse: raw.* (sources) and prod.* (built dbt models)\nselect order_status, count(*) as orders, sum(amount_usd) as revenue_usd\nfrom prod.fct_orders\ngroup by 1\norder by 2 desc");
  const [res, setRes] = useState<{ result?: QueryResult; error?: string } | null>(null);
  const run = async (text = sql) => {
    setDraft(sql);
    try {
      setRes({ result: await query(text) });
    } catch (e) {
      setRes({ error: (e as Error).message });
    }
  };
  return (
    <Page wide>
      <PageHeader title="SQL playground" lead="Free querying against the warehouse. DuckDB SQL: QUALIFY, ASOF JOIN, FILTER, generate_series, date_trunc and friends all work. Ctrl/Cmd+Enter runs the selection or the whole editor." />
      <NeedsWarehouse>
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <div className="border border-line">
              <SqlEditor value={sql} onChange={setSql} onRun={(t) => run(t)} minHeight="260px" maxHeight="520px" ariaLabel="Playground SQL" />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Button variant="primary" onClick={() => run()}>
                <Play size={14} aria-hidden /> Run <Kbd>Ctrl ↵</Kbd>
              </Button>
              {res?.result && <ResultMeta result={res.result} />}
            </div>
            <div className="mt-3">
              {res?.error && <pre className="bg-bad-soft px-3 py-2 font-mono text-[12.5px] whitespace-pre-wrap text-bad">{res.error}</pre>}
              {res?.result && <ResultTable result={res.result} />}
            </div>
          </div>
          <aside className="h-[640px] min-h-0 border border-line bg-surface p-2" aria-label="Tables">
            <SchemaPanel schemas={['raw', 'prod', 'dev']} onInsert={(t) => setSql((s) => `${s}${s.endsWith(' ') || s.endsWith('\n') ? '' : ' '}${t}`)} />
          </aside>
        </div>
      </NeedsWarehouse>
    </Page>
  );
}
