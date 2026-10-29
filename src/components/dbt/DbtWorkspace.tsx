import { FileCode2, FileText, FolderOpen, Hammer, Play, Plus, RotateCcw, TestTube2, Workflow, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { exec, query, type QueryResult } from '../../lib/duckdb';
import { parseProject } from '../../lib/dbt/parser';
import { compileForPreview, compileInline, parseCommand, runDbt } from '../../lib/dbt/runner';
import { sortedPaths } from '../../lib/dbt/tidepoolProject';
import type { LogLine, ProjectFiles, RunResult } from '../../lib/dbt/types';
import { CodeBlock } from '../CodeBlock';
import { ResultMeta, ResultTable } from '../ResultTable';
import { SqlEditor } from '../SqlEditor';
import { Button, Kbd, cx } from '../ui';
import { Lineage } from './Lineage';

type Tab = 'log' | 'preview' | 'compiled' | 'lineage' | 'query';

export interface DbtWorkspaceProps {
  files: ProjectFiles;
  onChange: (files: ProjectFiles) => void;
  targetSchema: string;
  baseline: ProjectFiles;
  initialFile?: string;
  defaultCommand?: string;
  onReset?: () => void;
  /** Rendered at the right end of the command bar (e.g. a Check button). */
  actions?: React.ReactNode;
  /** A run produced outside (e.g. by grading) to show in the log. */
  externalRun?: RunResult | null;
  height?: number | string;
  /** Show the "pending events" EL sync helper. */
  showSync?: boolean;
}

const QUICK = [
  { label: 'build', cmd: 'dbt build', icon: Hammer },
  { label: 'run', cmd: 'dbt run', icon: Play },
  { label: 'test', cmd: 'dbt test', icon: TestTube2 },
];

export function DbtWorkspace({ files, onChange, targetSchema, baseline, initialFile, defaultCommand = 'dbt build', onReset, actions, externalRun, height = 640, showSync }: DbtWorkspaceProps) {
  const paths = useMemo(() => sortedPaths(files), [files]);
  const [active, setActive] = useState(initialFile && files[initialFile] !== undefined ? initialFile : paths.find((p) => p.endsWith('.sql')) ?? paths[0]);
  const [command, setCommand] = useState(defaultCommand);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [tab, setTab] = useState<Tab>('log');
  const [preview, setPreview] = useState<{ result?: QueryResult; error?: string; model?: string } | null>(null);
  const [compiled, setCompiled] = useState<{ sql?: string; error?: string; model?: string } | null>(null);
  const [scratch, setScratch] = useState("select * from {{ ref('fct_orders') }} limit 20");
  const [scratchResult, setScratchResult] = useState<{ result?: QueryResult; error?: string } | null>(null);
  const [newFile, setNewFile] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (externalRun) {
      setLog(externalRun.log);
      setLastRun(externalRun);
      setTab('log');
    }
  }, [externalRun]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const project = useMemo(() => parseProject(files), [files]);
  const activeModel = active?.endsWith('.sql') && active.startsWith('models/') ? active.split('/').pop()!.replace('.sql', '') : null;

  const run = async (cmdText = command) => {
    const parsed = parseCommand(cmdText);
    setTab('log');
    if (parsed.error) {
      setLog([{ at: '', text: parsed.error, tone: 'error' }]);
      return;
    }
    setRunning(true);
    setLog([]);
    try {
      const res = await runDbt(files, { ...parsed.options, targetSchema, deferSchema: parsed.options.deferSchema ?? 'prod', baseline, onLog: (l) => setLog((prev) => [...prev, l]) });
      setLastRun(res);
    } catch (e) {
      setLog((prev) => [...prev, { at: '', text: `Unexpected error: ${(e as Error).message}`, tone: 'error' }]);
    } finally {
      setRunning(false);
    }
  };

  const doPreview = async () => {
    if (!activeModel) return;
    setTab('preview');
    setPreview({ model: activeModel });
    try {
      const sql = await compileForPreview(files, activeModel, targetSchema, 'prod');
      const result = await query(`select * from (${sql}) as preview limit 200`);
      setPreview({ result, model: activeModel });
    } catch (e) {
      setPreview({ error: (e as Error).message, model: activeModel });
    }
  };

  const doCompile = async () => {
    if (!activeModel) return;
    setTab('compiled');
    try {
      setCompiled({ sql: await compileForPreview(files, activeModel, targetSchema, 'prod'), model: activeModel });
    } catch (e) {
      setCompiled({ error: (e as Error).message, model: activeModel });
    }
  };

  const runScratch = async (text = scratch) => {
    setTab('query');
    try {
      const sql = await compileInline(files, text, targetSchema, 'prod');
      setScratchResult({ result: await query(sql) });
    } catch (e) {
      setScratchResult({ error: (e as Error).message });
    }
  };

  const syncEvents = async () => {
    setTab('log');
    const r = await query('select count(*) from ingest.events_pending where event_id not in (select event_id from raw.events)');
    const n = Number(r.rows[0][0]);
    await exec('insert into raw.events select * from ingest.events_pending where event_id not in (select event_id from raw.events)');
    setLog((prev) => [...prev, { at: '', text: `EL sync: delivered ${n} pending event${n === 1 ? '' : 's'} into raw.events.`, tone: 'info' }]);
  };

  const modified = (p: string) => baseline[p] === undefined || baseline[p] !== files[p];

  const folders = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const p of paths) {
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir)!.push(p);
    }
    return [...groups.entries()];
  }, [paths]);

  const addFile = (name: string) => {
    let p = name.trim().replace(/^\/+/, '');
    if (!p) return;
    if (!/\.(sql|ya?ml)$/.test(p)) p += '.sql';
    if (!p.includes('/')) p = `models/marts/${p}`;
    if (files[p] === undefined) onChange({ ...files, [p]: p.endsWith('.sql') ? `select\n    *\nfrom {{ ref('fct_orders') }}\n` : 'version: 2\n\nmodels:\n  - name: \n' });
    setActive(p);
    setNewFile(null);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'log', label: 'Log' },
    { id: 'preview', label: 'Preview' },
    { id: 'compiled', label: 'Compiled SQL' },
    { id: 'lineage', label: 'Lineage' },
    { id: 'query', label: 'Query' },
  ];

  return (
    <div className="flex flex-col border border-line bg-surface" style={{ height }}>
      {/* command bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-2 py-2">
        <form
          className="flex min-w-[260px] flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <label htmlFor={`cmd-${targetSchema}`} className="sr-only">
            dbt command
          </label>
          <div className="flex h-9 flex-1 items-center rounded-[3px] border border-line-strong bg-surface px-2 font-mono text-[13px]">
            <span className="mr-2 text-ink-3" aria-hidden>
              $
            </span>
            <input id={`cmd-${targetSchema}`} value={command} onChange={(e) => setCommand(e.target.value)} className="h-full w-full bg-transparent text-ink outline-none" spellCheck={false} />
          </div>
          <Button type="submit" variant="primary" disabled={running}>
            <Play size={14} aria-hidden /> {running ? 'Running…' : 'Run'}
          </Button>
        </form>
        <div className="flex items-center gap-1">
          {QUICK.map((q) => (
            <Button
              key={q.label}
              size="sm"
              variant="ghost"
              disabled={running}
              onClick={() => {
                setCommand(q.cmd);
                run(q.cmd);
              }}
              title={q.cmd}
            >
              <q.icon size={13} aria-hidden /> {q.label}
            </Button>
          ))}
          {showSync && (
            <Button size="sm" variant="ghost" onClick={syncEvents} title="Deliver events waiting in ingest.events_pending">
              <Workflow size={13} aria-hidden /> EL sync
            </Button>
          )}
          {onReset && (
            <Button size="sm" variant="ghost" onClick={onReset} title="Restore the starting files">
              <RotateCcw size={13} aria-hidden /> Reset
            </Button>
          )}
        </div>
        {actions}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* file tree */}
        <nav aria-label="Project files" className="hidden w-[230px] shrink-0 overflow-auto border-r border-line bg-surface-2/60 py-2 md:block">
          {folders.map(([dir, ps]) => (
            <div key={dir} className="mb-1.5">
              <div className="flex items-center gap-1.5 px-3 py-0.5 text-[11.5px] text-ink-3">
                <FolderOpen size={12} aria-hidden /> {dir || 'project'}
              </div>
              <ul>
                {ps.map((p) => {
                  const name = p.split('/').pop()!;
                  return (
                    <li key={p}>
                      <button
                        type="button"
                        onClick={() => setActive(p)}
                        aria-current={active === p ? 'true' : undefined}
                        className={cx(
                          'flex w-full items-center gap-1.5 py-[3px] pr-2 pl-6 text-left font-mono text-[12px]',
                          active === p ? 'bg-primary-soft text-ink' : 'text-ink-2 hover:bg-surface-3',
                        )}
                      >
                        {name.endsWith('.sql') ? <FileCode2 size={12} className="shrink-0 text-ink-3" aria-hidden /> : <FileText size={12} className="shrink-0 text-ink-3" aria-hidden />}
                        <span className="truncate">{name}</span>
                        {modified(p) && <span className="ml-auto size-1.5 shrink-0 bg-warn" title="Changed from main" aria-label="modified" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="px-3 pt-1">
            {newFile === null ? (
              <button type="button" onClick={() => setNewFile('')} className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
                <Plus size={12} aria-hidden /> New file
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addFile(newFile);
                }}
                className="flex items-center gap-1"
              >
                <input
                  autoFocus
                  aria-label="New file path"
                  value={newFile}
                  onChange={(e) => setNewFile(e.target.value)}
                  placeholder="models/marts/my_model.sql"
                  className="h-7 w-full rounded-[3px] border border-line-strong bg-surface px-1.5 font-mono text-[11.5px] text-ink"
                />
                <button type="button" aria-label="Cancel" onClick={() => setNewFile(null)} className="text-ink-3 hover:text-ink">
                  <X size={13} />
                </button>
              </form>
            )}
          </div>
        </nav>

        {/* editor + panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
            <label className="flex min-w-0 items-center gap-2 md:hidden">
              <span className="sr-only">File</span>
              <select value={active} onChange={(e) => setActive(e.target.value)} className="h-8 max-w-full rounded-[3px] border border-line bg-surface font-mono text-[12px] text-ink">
                {paths.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <span className="hidden truncate font-mono text-[12px] text-ink-2 md:inline">{active}</span>
            {activeModel && (
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" onClick={doPreview} title="Compile and preview this model (Ctrl/Cmd+Enter)">
                  Preview <Kbd>⌘↵</Kbd>
                </Button>
                <Button size="sm" variant="ghost" onClick={doCompile}>
                  Compile
                </Button>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-[3] overflow-auto">
            {active && (
              <SqlEditor
                key={active}
                value={files[active] ?? ''}
                onChange={(v) => onChange({ ...files, [active]: v })}
                onRun={() => (activeModel ? doPreview() : run())}
                language={active.endsWith('.sql') ? 'sql' : 'yaml'}
                minHeight="100%"
                ariaLabel={`Editor for ${active}`}
              />
            )}
          </div>
          <div className="flex min-h-0 flex-[2] flex-col border-t border-line">
            <div role="tablist" aria-label="Output" className="flex items-center gap-1 border-b border-line bg-surface-2 px-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cx('-mb-px border-b-2 px-2.5 py-1.5 text-[12.5px] font-medium', tab === t.id ? 'border-primary text-ink' : 'border-transparent text-ink-3 hover:text-ink')}
                >
                  {t.label}
                </button>
              ))}
              {lastRun && (
                <span className={cx('ml-auto text-[12px] font-medium', lastRun.ok ? 'text-ok' : 'text-bad')}>
                  {lastRun.command} {lastRun.ok ? 'passed' : 'failed'}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto" role="tabpanel">
              {tab === 'log' && (
                <div ref={logRef} className="h-full overflow-auto bg-code px-3 py-2 font-mono text-[12px] leading-[1.6]" aria-live="polite">
                  {log.length === 0 && !running && (
                    <p className="text-ink-3">
                      Run a command such as <span className="text-ink">dbt build -s {activeModel ?? 'stg_shop__orders'}+</span>. Models build into the <span className="text-ink">{targetSchema}</span> schema; unbuilt refs read from prod.
                    </p>
                  )}
                  {log.map((l, i) => (
                    <div
                      key={i}
                      className={cx(
                        'whitespace-pre-wrap',
                        l.tone === 'ok' && 'text-ok',
                        l.tone === 'error' && 'text-bad',
                        l.tone === 'warn' && 'text-warn',
                        l.tone === 'skip' && 'text-warn',
                        l.tone === 'muted' && 'text-ink-3',
                        l.tone === 'info' && 'text-primary',
                        l.tone === 'plain' && 'text-ink-2',
                      )}
                    >
                      {l.at && <span className="mr-2 text-ink-3">{l.at}</span>}
                      {l.text}
                    </div>
                  ))}
                </div>
              )}
              {tab === 'preview' && (
                <div className="p-2">
                  {!preview && <p className="p-2 text-[13px] text-ink-3">Open a model and press Preview to see its first 200 rows.</p>}
                  {preview?.error && <pre className="p-2 font-mono text-[12px] whitespace-pre-wrap text-bad">{preview.error}</pre>}
                  {preview?.result && (
                    <>
                      <div className="mb-1 flex justify-between px-1">
                        <span className="font-mono text-[12px] text-ink-2">{preview.model}</span>
                        <ResultMeta result={preview.result} />
                      </div>
                      <ResultTable result={preview.result} compact />
                    </>
                  )}
                  {preview && !preview.result && !preview.error && <div className="skeleton h-24 w-full" />}
                </div>
              )}
              {tab === 'compiled' && (
                <div className="p-2">
                  {!compiled && <p className="p-2 text-[13px] text-ink-3">Press Compile to see the SQL your Jinja renders to.</p>}
                  {compiled?.error && <pre className="p-2 font-mono text-[12px] whitespace-pre-wrap text-bad">{compiled.error}</pre>}
                  {compiled?.sql && <CodeBlock code={compiled.sql} info="sql" />}
                </div>
              )}
              {tab === 'lineage' && <Lineage project={project} results={lastRun?.results} selected={activeModel ?? undefined} onOpen={(p) => setActive(p)} />}
              {tab === 'query' && (
                <div className="flex h-full flex-col">
                  <div className="border-b border-line">
                    <SqlEditor value={scratch} onChange={setScratch} onRun={runScratch} minHeight="70px" maxHeight="120px" ariaLabel="Scratch query (Jinja allowed)" />
                  </div>
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[12px] text-ink-3">Ad-hoc query; ref() and source() work. Ctrl/Cmd+Enter runs.</span>
                    <Button size="sm" onClick={() => runScratch()}>
                      <Play size={12} aria-hidden /> Run query
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
                    {scratchResult?.error && <pre className="font-mono text-[12px] whitespace-pre-wrap text-bad">{scratchResult.error}</pre>}
                    {scratchResult?.result && <ResultTable result={scratchResult.result} compact />}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {project.errors.length > 0 && (
        <div role="alert" className="border-t border-line bg-bad-soft px-3 py-1.5 text-[12px] text-bad">
          {project.errors[0]}
          {project.errors.length > 1 && ` (+${project.errors.length - 1} more)`}
        </div>
      )}
    </div>
  );
}
