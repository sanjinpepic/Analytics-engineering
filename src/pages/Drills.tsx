import { ArrowRight, Check, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { DRILL_BY_ID, DRILL_TEMPLATES, generateDrill, randomSeed } from '../content/drills';
import { ItemView } from '../components/items/ItemView';
import { Page } from '../components/Shell';
import { NeedsWarehouse, useWarehouse } from '../components/Warehouse';
import { Button, DifficultyMark, DomainTag, PageHeader, cx } from '../components/ui';
import { query } from '../lib/duckdb';
import { useProgress, type DrillStat } from '../store/progress';

/** Weakest skills first: untried, then lowest solve rate, then least recently practised. */
function pickTemplate(stats: Record<string, DrillStat>): string {
  const scored = DRILL_TEMPLATES.map((t) => {
    const s = stats[t.id];
    const rate = s && s.attempts ? s.solved / s.attempts : -1;
    return { id: t.id, rate, last: s?.last ?? 0, jitter: Math.random() };
  }).sort((a, b) => a.rate - b.rate || a.last - b.last || a.jitter - b.jitter);
  return scored[Math.floor(Math.random() * Math.min(4, scored.length))].id;
}

export function DrillsIndex() {
  const stats = useProgress((s) => s.drillStats);
  return <Navigate to={`/drills/${pickTemplate(stats)}/${randomSeed()}`} replace />;
}

export function DrillPage() {
  const { tpl = '', seed = '' } = useParams();
  const navigate = useNavigate();
  const stats = useProgress((s) => s.drillStats);
  const progress = useProgress((s) => s.progress);
  const warehouse = useWarehouse();
  const template = DRILL_BY_ID[tpl];
  const seedNum = Number(seed);
  const item = useMemo(() => (template && Number.isFinite(seedNum) ? generateDrill(tpl, seedNum) : null), [template, tpl, seedNum]);
  const [checkedSeed, setCheckedSeed] = useState<string | null>(null);

  // A seed whose reference answer is empty is a dull question: quietly move to the next seed.
  useEffect(() => {
    if (!item || warehouse.state !== 'ready' || checkedSeed === item.id) return;
    let live = true;
    query(`select count(*) from (${item.solution}) as t`)
      .then((r) => {
        if (!live) return;
        if (Number(r.rows[0][0]) === 0) navigate(`/drills/${tpl}/${seedNum + 1}`, { replace: true });
        else setCheckedSeed(item.id);
      })
      .catch(() => live && setCheckedSeed(item.id));
    return () => {
      live = false;
    };
  }, [item, warehouse.state, checkedSeed, navigate, tpl, seedNum]);

  if (!template || !item) return <Navigate to="/drills" replace />;
  const st = stats[tpl];
  const solved = progress[item.id]?.status === 'correct';
  const next = () => navigate(`/drills/${tpl}/${randomSeed()}`);
  const other = () => {
    let t = pickTemplate(stats);
    if (t === tpl) t = pickTemplate(stats);
    navigate(`/drills/${t}/${randomSeed()}`);
  };
  const totalSolved = Object.values(stats).reduce((s, x) => s + x.solved, 0);

  return (
    <Page wide>
      <PageHeader
        title="Drills"
        lead="Endless SQL practice. Each skill is a template; every new question changes the period, dimension, metric or window, and is graded against a reference query. You practise the move, not a memorised answer."
        actions={
          <span className="text-[13px] text-ink-3 tnum">
            {totalSolved} solved across {Object.keys(stats).length} of {DRILL_TEMPLATES.length} skills
          </span>
        }
      />
      <div className="mt-6 grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label="Drill skills" className="self-start lg:sticky lg:top-6">
          <ul className="divide-y divide-line border-y border-line">
            {DRILL_TEMPLATES.map((t) => {
              const s = stats[t.id];
              const rate = s?.attempts ? Math.round((s.solved / s.attempts) * 100) : null;
              return (
                <li key={t.id}>
                  <Link
                    to={`/drills/${t.id}/${randomSeed()}`}
                    aria-current={t.id === tpl ? 'page' : undefined}
                    className={cx('flex items-center justify-between gap-3 px-2 py-2 no-underline', t.id === tpl ? 'bg-primary-soft' : 'hover:bg-surface/70')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-[600] text-ink">{t.skill}</span>
                      <span className="block text-[11.5px] text-ink-3">{['', 'Foundation', 'Working AE', 'Senior'][t.difficulty]}</span>
                    </span>
                    <span className="shrink-0 text-right text-[12px] text-ink-3 tnum">
                      {s ? (
                        <>
                          <span className="block font-semibold text-ink-2">{s.solved} solved</span>
                          {rate !== null && <span className="block">{rate}% of tries</span>}
                        </>
                      ) : (
                        'new'
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-line bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-[15px] font-[650] text-ink">{template.skill}</p>
              <p className="mt-0.5 text-[13px] text-ink-2">{template.summary}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-4">
                <DomainTag domain={template.domain} compact />
                <DifficultyMark level={template.difficulty} />
                {st && st.streak > 1 && <span className="text-[12.5px] font-semibold text-ok tnum">{st.streak} in a row</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant={solved ? 'primary' : 'secondary'} onClick={next}>
                {solved ? <Check size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />} {solved ? 'Next question' : 'Skip to a new question'}
              </Button>
              <Button variant="ghost" onClick={other}>
                <Shuffle size={14} aria-hidden /> Another skill
              </Button>
            </div>
          </div>
          <NeedsWarehouse>
            <ItemView key={item.id} item={item} />
          </NeedsWarehouse>
          <p className="mt-3 text-[12px] text-ink-3">
            Question <span className="font-mono">#{seed}</span> of this skill. The link reproduces exactly this question.
          </p>
        </div>
      </div>
    </Page>
  );
}
