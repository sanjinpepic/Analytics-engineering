import { ArrowDown, ArrowUp, Check, CircleAlert, Eye, EyeOff, Lightbulb, Play, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DbtItem, Item, McqItem, NumericItem, OpenItem, OrderItem, SqlItem } from '../../content/types';
import { query, type QueryResult } from '../../lib/duckdb';
import { applyOverrides, exerciseFiles, gradeDbt, gradeMcq, gradeNumeric, gradeOpenLocally, gradeOrder, gradeSql, numericAnswer, type Grade } from '../../lib/grading';
import type { ProjectFiles, RunResult } from '../../lib/dbt/types';
import { useProgress, type AttemptStatus } from '../../store/progress';
import { DbtWorkspace } from '../dbt/DbtWorkspace';
import { Markdown } from '../Markdown';
import { ResultMeta, ResultTable } from '../ResultTable';
import { SchemaPanel } from '../SchemaPanel';
import { SqlEditor } from '../SqlEditor';
import { NeedsWarehouse } from '../Warehouse';
import { Button, DifficultyMark, DomainTag, Kbd, StatusPill, cx } from '../ui';
import { CodeBlock } from '../CodeBlock';

export type Mode = 'practice' | 'exam';

export interface ExamHooks {
  answer: unknown;
  files?: ProjectFiles;
  onAnswer: (a: { answer: unknown; grade: Grade }) => void;
  onFiles?: (files: ProjectFiles) => void;
}

const KIND_LABEL: Record<Item['kind'], string> = {
  mcq: 'Multiple choice',
  order: 'Put in order',
  sql: 'Write SQL',
  numeric: 'Query & answer',
  dbt: 'dbt task',
  open: 'Written answer',
};

function statusOf(g: Grade): AttemptStatus {
  return g.correct ? 'correct' : g.score > 0 ? 'partial' : 'incorrect';
}

export function ItemView({ item, mode = 'practice', exam, index }: { item: Item; mode?: Mode; exam?: ExamHooks; index?: number }) {
  const progress = useProgress((s) => s.progress[item.id]);
  const record = useProgress((s) => s.record);
  const [grade, setGrade] = useState<Grade | null>(null);
  const isMulti = item.kind === 'mcq' && item.correct.length > 1;

  const submit = (answer: unknown, g: Grade, extra?: { hintsUsed?: number; revealed?: boolean }) => {
    setGrade(g);
    if (mode === 'exam') exam?.onAnswer({ answer, grade: g });
    else record(item.id, { status: item.kind === 'open' ? 'submitted' : statusOf(g), score: g.score, answer, ...extra });
  };

  const solved = mode === 'practice' && progress?.status === 'correct';
  return (
    <article className="border border-line bg-surface" aria-labelledby={`item-${item.id}`}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-2.5">
        <DomainTag domain={item.domain} compact />
        <DifficultyMark level={item.difficulty} />
        <span className="text-[12.5px] text-ink-3">{KIND_LABEL[item.kind]}</span>
        {mode === 'practice' && progress && (
          <span className="ml-auto">
            {progress.status === 'correct' && (
              <StatusPill tone="ok">
                <Check size={12} aria-hidden /> Solved
              </StatusPill>
            )}
            {progress.status === 'partial' && <StatusPill tone="warn">Partly right</StatusPill>}
            {progress.status === 'incorrect' && <StatusPill tone="bad">Not yet</StatusPill>}
            {progress.status === 'submitted' && <StatusPill tone="info">Submitted</StatusPill>}
          </span>
        )}
      </header>
      <div className="px-5 pt-4 pb-5">
        <h2 id={`item-${item.id}`} className="text-[18px] leading-snug font-[650] text-ink">
          {index !== undefined && <span className="mr-2 text-ink-3 tnum">{index}.</span>}
          {item.title}
        </h2>
        <div className="mt-2 max-w-[75ch]">
          <Markdown compact>{item.prompt}</Markdown>
          {isMulti && !/select all|select the|select every/i.test(item.prompt) && <p className="mt-2 text-[13px] font-medium text-ink-2">Select all that apply.</p>}
        </div>
        <div className="mt-4">
          {item.kind === 'mcq' && <McqView item={item} mode={mode} initial={(mode === 'exam' ? exam?.answer : progress?.answer) as number[] | undefined} onSubmit={submit} />}
          {item.kind === 'order' && <OrderView item={item} mode={mode} initial={(mode === 'exam' ? exam?.answer : progress?.answer) as string[] | undefined} onSubmit={submit} />}
          {item.kind === 'sql' && (
            <NeedsWarehouse>
              <SqlView item={item} mode={mode} initial={(mode === 'exam' ? exam?.answer : progress?.answer) as string | undefined} onSubmit={submit} />
            </NeedsWarehouse>
          )}
          {item.kind === 'numeric' && (
            <NeedsWarehouse>
              <NumericView item={item} mode={mode} initial={(mode === 'exam' ? exam?.answer : progress?.answer) as string | undefined} onSubmit={submit} />
            </NeedsWarehouse>
          )}
          {item.kind === 'dbt' && (
            <NeedsWarehouse label="the dbt project">
              <DbtView item={item} mode={mode} exam={exam} onSubmit={submit} />
            </NeedsWarehouse>
          )}
          {item.kind === 'open' && <OpenView item={item} mode={mode} initial={(mode === 'exam' ? exam?.answer : progress?.answer) as string | undefined} onSubmit={submit} />}
        </div>

        {grade && <Feedback item={item} grade={grade} mode={mode} />}
        {!grade && solved && item.explanation && (
          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer text-[13px] font-medium text-ink-2">Show the explanation again</summary>
            <div className="mt-2 max-w-[75ch]">
              <Markdown compact>{item.explanation}</Markdown>
            </div>
          </details>
        )}
      </div>
    </article>
  );
}

function Feedback({ item, grade, mode }: { item: Item; grade: Grade; mode: Mode }) {
  if (mode === 'exam') {
    return (
      <p className="mt-4 inline-flex items-center gap-2 text-[13px] text-ink-2" role="status">
        <Check size={14} className="text-ok" aria-hidden /> Answer saved. Results appear when you finish the exam.
      </p>
    );
  }
  const tone = item.kind === 'open' ? 'info' : grade.correct ? 'ok' : grade.score > 0 ? 'warn' : 'bad';
  const bg = { ok: 'bg-ok-soft', warn: 'bg-warn-soft', bad: 'bg-bad-soft', info: 'bg-primary-soft' }[tone];
  const fg = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-primary' }[tone];
  return (
    <div className={cx('mt-4 px-4 py-3', bg)} role="status">
      <p className={cx('flex items-center gap-2 text-[14px] font-semibold', fg)}>
        {tone === 'ok' ? <Check size={16} aria-hidden /> : tone === 'info' ? <Check size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
        {item.kind === 'open' ? 'Submitted' : grade.correct ? 'Correct' : grade.score > 0 ? 'Partly right' : 'Not yet'}
        <span className="font-normal text-ink-2">{grade.feedback}</span>
      </p>
      {grade.checks && (
        <ul className="mt-2 space-y-1">
          {grade.checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px]">
              {c.ok ? <Check size={14} className="mt-0.5 shrink-0 text-ok" aria-label="passed" /> : <X size={14} className="mt-0.5 shrink-0 text-bad" aria-label="failed" />}
              <span className="text-ink">
                {c.label}
                {c.detail && <span className="block text-ink-2">{c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {item.explanation && (grade.correct || item.kind === 'mcq' || item.kind === 'order' || item.kind === 'open') && (
        <div className="mt-3 max-w-[75ch] border-t border-black/5 pt-3">
          <Markdown compact>{item.explanation}</Markdown>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- MCQ
function McqView({ item, mode, initial, onSubmit }: { item: McqItem; mode: Mode; initial?: number[]; onSubmit: (a: unknown, g: Grade) => void }) {
  const multi = item.correct.length > 1;
  const [sel, setSel] = useState<number[]>(initial ?? []);
  const [checked, setChecked] = useState(false);
  const toggle = (i: number) => {
    setChecked(false);
    setSel((s) => (multi ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : [i]));
  };
  const reveal = checked && mode === 'practice';
  return (
    <fieldset>
      <legend className="sr-only">{multi ? 'Select all that apply' : 'Select one answer'}</legend>
      <ul className="space-y-2">
        {item.options.map((o, i) => {
          const on = sel.includes(i);
          const isRight = item.correct.includes(i);
          return (
            <li key={i}>
              <label
                className={cx(
                  'flex cursor-pointer items-start gap-3 border px-3.5 py-2.5 transition-colors duration-150',
                  on ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
                  reveal && isRight && 'border-ok bg-ok-soft',
                  reveal && on && !isRight && 'border-bad bg-bad-soft',
                )}
              >
                <input type={multi ? 'checkbox' : 'radio'} name={item.id} checked={on} onChange={() => toggle(i)} className="mt-1 accent-[var(--primary)]" />
                <span className="font-semibold text-ink-3 tnum">{String.fromCharCode(65 + i)}</span>
                <span className="min-w-0 flex-1 text-[14.5px] leading-relaxed text-ink [&_code]:rounded-[3px] [&_code]:bg-surface-3 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.86em]">
                  <InlineMd text={o} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!sel.length}
          onClick={() => {
            setChecked(true);
            onSubmit(sel, gradeMcq(item, sel));
          }}
        >
          {mode === 'exam' ? 'Save answer' : 'Check answer'}
        </Button>
      </div>
    </fieldset>
  );
}

/** Tiny inline markdown: `code`, **bold**, *italic*. */
export function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') ? (
          <code key={i}>{p.slice(1, -1)}</code>
        ) : p.startsWith('**') ? (
          <strong key={i} className="font-semibold">
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith('*') && p.length > 2 ? (
          <em key={i}>{p.slice(1, -1)}</em>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------- order
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  // never start in the solved order
  if (out.every((s, i) => s === arr[i])) out.push(out.shift()!);
  return out;
}

function OrderView({ item, mode, initial, onSubmit }: { item: OrderItem; mode: Mode; initial?: string[]; onSubmit: (a: unknown, g: Grade) => void }) {
  const [order, setOrder] = useState<string[]>(() => (initial?.length === item.steps.length ? initial : seededShuffle(item.steps, item.id)));
  const [checked, setChecked] = useState(false);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setChecked(false);
  };
  return (
    <div>
      <ol className="space-y-1.5">
        {order.map((s, i) => {
          const right = checked && mode === 'practice' ? item.steps[i] === s : null;
          return (
            <li key={s} className={cx('flex items-center gap-3 border bg-surface px-3 py-2', right === true ? 'border-ok bg-ok-soft' : right === false ? 'border-bad bg-bad-soft' : 'border-line')}>
              <span className="w-5 text-right font-semibold text-ink-3 tnum">{i + 1}</span>
              <span className="min-w-0 flex-1 text-[14.5px] text-ink">{s}</span>
              <span className="flex shrink-0 gap-1">
                <button type="button" aria-label={`Move "${s}" up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded-[3px] p-1 text-ink-2 hover:bg-surface-3 disabled:opacity-30">
                  <ArrowUp size={15} />
                </button>
                <button type="button" aria-label={`Move "${s}" down`} disabled={i === order.length - 1} onClick={() => move(i, 1)} className="rounded-[3px] p-1 text-ink-2 hover:bg-surface-3 disabled:opacity-30">
                  <ArrowDown size={15} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <Button
        className="mt-3"
        variant="primary"
        onClick={() => {
          setChecked(true);
          onSubmit(order, gradeOrder(item, order));
        }}
      >
        {mode === 'exam' ? 'Save order' : 'Check order'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- SQL
function HideButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[12px] font-medium text-ink-3 hover:bg-surface-3 hover:text-ink">
      <EyeOff size={12} aria-hidden /> Hide
    </button>
  );
}

/** Revealing a solution is remembered, so the item shows as revealed in progress and reports. */
function markRevealed(itemId: string, answer: unknown) {
  const prev = useProgress.getState().progress[itemId];
  useProgress.getState().record(itemId, { status: prev?.status ?? 'incorrect', score: prev?.score ?? 0, answer, revealed: true, attempts: 0 });
}

function useSchemaCompletion() {
  const [schema, setSchema] = useState<Record<string, string[]> | undefined>();
  useEffect(() => {
    query(`select schema_name || '.' || table_name, list(column_name order by column_index) from duckdb_columns() where schema_name in ('raw', 'prod') group by 1`).then((r) =>
      setSchema(Object.fromEntries(r.rows.map(([k, v]) => [String(k), JSON.parse(String(v)) as string[]]))),
    ).catch(() => undefined);
  }, []);
  return schema;
}

function SqlView({ item, mode, initial, onSubmit }: { item: SqlItem; mode: Mode; initial?: string; onSubmit: (a: unknown, g: Grade, extra?: { hintsUsed?: number; revealed?: boolean }) => void }) {
  const [sql, setSql] = useState(initial ?? item.starter ?? `-- ${item.tables?.length ? `Start from ${item.tables.join(', ')}` : 'Write your query here'}\nselect\n`);
  const [result, setResult] = useState<{ result?: QueryResult; error?: string } | null>(null);
  const [expected, setExpected] = useState<QueryResult | null>(null);
  const [hints, setHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [busy, setBusy] = useState(false);
  const schema = useSchemaCompletion();

  const run = async (text = sql) => {
    try {
      setResult({ result: await query(text) });
    } catch (e) {
      setResult({ error: (e as Error).message });
    }
  };
  const check = async () => {
    setBusy(true);
    const g = await gradeSql(item, sql);
    if (g.actual) setResult({ result: g.actual });
    else setResult({ error: g.feedback });
    if (mode === 'practice' && !g.correct && g.expected) setExpected(g.expected);
    onSubmit(sql, g, { hintsUsed: hints });
    setBusy(false);
  };

  return (
    <div>
      <div className="grid gap-3 lg:grid-cols-[1fr_250px]">
        <div className="min-w-0 border border-line">
          <SqlEditor value={sql} onChange={setSql} onRun={(t) => run(t)} minHeight="190px" maxHeight="420px" schema={schema} ariaLabel={`SQL for ${item.title}`} />
        </div>
        <aside className="hidden max-h-[420px] min-h-0 border border-line bg-surface-2 p-2 lg:block" aria-label="Tables">
          <SchemaPanel schemas={['prod', 'raw']} highlight={item.tables ?? []} onInsert={(t) => setSql((s) => `${s}${s.endsWith(' ') || s.endsWith('\n') ? '' : ' '}${t}`)} />
        </aside>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => run()}>
          <Play size={14} aria-hidden /> Run <Kbd>Ctrl ↵</Kbd>
        </Button>
        <Button variant="primary" onClick={check} disabled={busy}>
          {busy ? 'Checking…' : mode === 'exam' ? 'Save answer' : 'Check answer'}
        </Button>
        {mode === 'practice' && item.hints && hints < item.hints.length && (
          <Button variant="ghost" onClick={() => setHints((h) => h + 1)}>
            <Lightbulb size={14} aria-hidden /> Hint {hints + 1}/{item.hints.length}
          </Button>
        )}
        {mode === 'practice' && (
          <Button
            variant="ghost"
            aria-expanded={showSolution}
            onClick={() => {
              if (!showSolution) markRevealed(item.id, sql);
              setShowSolution((v) => !v);
            }}
          >
            {showSolution ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {showSolution ? 'Hide solution' : 'Show solution'}
          </Button>
        )}
      </div>
      {hints > 0 && (
        <ul className="mt-3 space-y-1.5">
          {item.hints!.slice(0, hints).map((h, i) => (
            <li key={i} className="flex gap-2 bg-warn-soft px-3 py-2 text-[13.5px] text-ink">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <InlineMd text={h} />
            </li>
          ))}
        </ul>
      )}
      {result && (
        <div className="mt-3">
          {result.error && (
            <div className="relative">
              <pre className="border border-bad/30 bg-bad-soft px-3 py-2 pr-20 font-mono text-[12.5px] whitespace-pre-wrap text-bad">{result.error}</pre>
              <span className="absolute top-1.5 right-2">
                <HideButton onClick={() => setResult(null)} />
              </span>
            </div>
          )}
          {result.result && (
            <>
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="text-[12.5px] font-medium text-ink-2">Your result</span>
                <span className="flex items-center gap-3">
                  <ResultMeta result={result.result} />
                  <HideButton onClick={() => setResult(null)} />
                </span>
              </div>
              <ResultTable result={result.result} compact />
            </>
          )}
        </div>
      )}
      {expected && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">Peek at the expected result ({expected.rows.length} rows)</summary>
          <div className="mt-2">
            <ResultTable result={expected} compact />
          </div>
        </details>
      )}
      {showSolution && (
        <div className="mt-3">
          <p className="text-[13px] font-medium text-ink-2">Reference solution (one of many correct ones). Solving it yourself afterwards still counts for practice, but this item is marked as revealed.</p>
          <CodeBlock code={item.solution} info="sql" />
          {item.explanation && <Markdown compact>{item.explanation}</Markdown>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- numeric
function NumericView({ item, mode, initial, onSubmit }: { item: NumericItem; mode: Mode; initial?: string; onSubmit: (a: unknown, g: Grade, extra?: { revealed?: boolean }) => void }) {
  const [sql, setSql] = useState(item.starter ?? '-- explore here, then type your answer below\nselect\n');
  const [result, setResult] = useState<{ result?: QueryResult; error?: string } | null>(null);
  const [value, setValue] = useState(initial ?? '');
  const [hints, setHints] = useState(0);
  const [solution, setSolution] = useState<number | null>(null);
  const schema = useSchemaCompletion();
  const run = async (text = sql) => {
    try {
      setResult({ result: await query(text) });
    } catch (e) {
      setResult({ error: (e as Error).message });
    }
  };
  return (
    <div>
      <div className="border border-line">
        <SqlEditor value={sql} onChange={setSql} onRun={(t) => run(t)} minHeight="120px" maxHeight="320px" schema={schema} ariaLabel={`Scratch SQL for ${item.title}`} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={() => run()}>
          <Play size={14} aria-hidden /> Run <Kbd>Ctrl ↵</Kbd>
        </Button>
        {mode === 'practice' && item.hints && hints < item.hints.length && (
          <Button variant="ghost" onClick={() => setHints((h) => h + 1)}>
            <Lightbulb size={14} aria-hidden /> Hint
          </Button>
        )}
      </div>
      {hints > 0 && (
        <ul className="mt-2 space-y-1.5">
          {item.hints!.slice(0, hints).map((h, i) => (
            <li key={i} className="bg-warn-soft px-3 py-2 text-[13.5px] text-ink">
              <InlineMd text={h} />
            </li>
          ))}
        </ul>
      )}
      {result && (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-end gap-3">
            {result.result && <ResultMeta result={result.result} />}
            <HideButton onClick={() => setResult(null)} />
          </div>
          {result.error && <pre className="bg-bad-soft px-3 py-2 font-mono text-[12.5px] whitespace-pre-wrap text-bad">{result.error}</pre>}
          {result.result && <ResultTable result={result.result} compact />}
        </div>
      )}
      <form
        className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          onSubmit(value, await gradeNumeric(item, value));
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-ink">Your answer{item.unit ? ` (${item.unit})` : ''}</span>
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9 w-48 rounded-[3px] border border-line-strong bg-surface px-2.5 font-mono text-[14px] text-ink tnum"
            placeholder="e.g. 42"
          />
        </label>
        <Button type="submit" variant="primary" disabled={!value.trim()}>
          {mode === 'exam' ? 'Save answer' : 'Check answer'}
        </Button>
        {mode === 'practice' && (
          <Button
            variant="ghost"
            aria-expanded={solution !== null}
            onClick={async () => {
              if (solution !== null) return setSolution(null);
              markRevealed(item.id, value);
              setSolution(await numericAnswer(item));
            }}
          >
            {solution !== null ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {solution !== null ? 'Hide answer' : 'Show answer'}
          </Button>
        )}
      </form>
      {solution !== null && (
        <div className="mt-3">
          <p className="text-[13.5px] text-ink">
            Answer: <span className="font-mono font-semibold tnum">{Number.isInteger(solution) ? solution : solution.toFixed(4)}</span>
          </p>
          <CodeBlock code={item.solution} info="sql" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dbt
function DbtView({ item, mode, exam, onSubmit }: { item: DbtItem; mode: Mode; exam?: ExamHooks; onSubmit: (a: unknown, g: Grade) => void }) {
  const stored = useProgress((s) => s.itemFiles[item.id]);
  const setItemFiles = useProgress((s) => s.setItemFiles);
  const start = useMemo(() => exerciseFiles(item), [item]);
  const files = (mode === 'exam' ? exam?.files : stored) ?? start;
  const setFiles = (f: ProjectFiles) => (mode === 'exam' ? exam?.onFiles?.(f) : setItemFiles(item.id, f));
  const schema = `ex_${item.id.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`.slice(0, 60);
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState(0);

  const check = async () => {
    setBusy(true);
    try {
      const g = await gradeDbt(item, files, schema);
      setRun(g.run);
      onSubmit(mode === 'exam' ? 'files' : 'files', g);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <DbtWorkspace
        files={files}
        onChange={setFiles}
        targetSchema={schema}
        baseline={start}
        initialFile={item.openFile}
        defaultCommand={item.command}
        onReset={() => setFiles(start)}
        externalRun={run}
        height={620}
        showSync={item.checks.some((c) => c.type === 'incremental-equivalence')}
        actions={
          <Button variant="primary" onClick={check} disabled={busy}>
            {busy ? 'Checking…' : mode === 'exam' ? 'Submit' : 'Check'}
          </Button>
        }
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        <span>
          <strong className="font-medium text-ink-2">Check</strong> runs <code className="font-mono text-ink-2">{item.command}</code> into its own schema, defers unbuilt models to prod, and evaluates {item.checks.length} check{item.checks.length === 1 ? '' : 's'}.
        </span>
        {mode === 'practice' && item.hints && hints < item.hints.length && (
          <Button size="sm" variant="ghost" onClick={() => setHints((h) => h + 1)}>
            <Lightbulb size={13} aria-hidden /> Hint
          </Button>
        )}
        {mode === 'practice' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm('Replace your files with the reference solution? Your edits to this task will be overwritten.')) {
                setFiles(applyOverrides(start, item.solutionFiles));
                useProgress.getState().record(item.id, { status: useProgress.getState().progress[item.id]?.status ?? 'incorrect', score: useProgress.getState().progress[item.id]?.score ?? 0, revealed: true, attempts: 0 });
              }
            }}
          >
            <Eye size={13} aria-hidden /> Load solution
          </Button>
        )}
      </div>
      {hints > 0 && (
        <ul className="mt-2 space-y-1.5">
          {item.hints!.slice(0, hints).map((h, i) => (
            <li key={i} className="bg-warn-soft px-3 py-2 font-mono text-[12.5px] whitespace-pre-wrap text-ink">
              {h}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- open
function OpenView({ item, mode, initial, onSubmit }: { item: OpenItem; mode: Mode; initial?: string; onSubmit: (a: unknown, g: Grade) => void }) {
  const [text, setText] = useState(initial ?? '');
  const [submitted, setSubmitted] = useState(false);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const min = item.minWords ?? 30;
  return (
    <div>
      <label className="block">
        <span className="sr-only">Your answer</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          placeholder={item.placeholder}
          className="w-full rounded-[3px] border border-line-strong bg-surface px-3 py-2.5 text-[14.5px] leading-relaxed text-ink placeholder:text-ink-3"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={!text.trim()}
          onClick={() => {
            setSubmitted(true);
            onSubmit(text, gradeOpenLocally(text, min));
          }}
        >
          {mode === 'exam' ? 'Save answer' : 'Submit'}
        </Button>
        <span className={cx('text-[12.5px] tnum', words < min ? 'text-ink-3' : 'text-ok')}>
          {words} / {min}+ words
        </span>
        <span className="text-[12.5px] text-ink-3">Claude grades written answers from your exported report.</span>
      </div>
      {submitted && mode === 'practice' && (
        <div className="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-2">
          <div>
            <h3 className="text-[13px] font-semibold text-ink">What a strong answer covers</h3>
            <ul className="mt-2 space-y-1.5 text-[13.5px] text-ink-2">
              {item.rubric.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[7px] size-1.5 shrink-0 bg-line-strong" aria-hidden />
                  {r}
                </li>
              ))}
            </ul>
          </div>
          {item.sampleAnswer && (
            <div>
              <h3 className="text-[13px] font-semibold text-ink">A model answer</h3>
              <div className="mt-2 bg-surface-2 p-3">
                <Markdown compact>{item.sampleAnswer}</Markdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
