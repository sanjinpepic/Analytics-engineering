/** Grading for every item kind. SQL results are compared as multisets by column position. */
import { exec, query, quoteIdent, resetSchema, type Cell, type QueryResult } from './duckdb';
import { parseProject } from './dbt/parser';
import { runDbt, parseCommand } from './dbt/runner';
import { TIDEPOOL_PROJECT } from './dbt/tidepoolProject';
import type { ProjectFiles, RunResult } from './dbt/types';
import type { DbtCheck, DbtItem, McqItem, NumericItem, OrderItem, SqlItem } from '../content/types';

export interface CheckOutcome {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface Grade {
  /** 0..1 */
  score: number;
  correct: boolean;
  feedback: string;
  checks?: CheckOutcome[];
}

function norm(v: Cell): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return norm(Number(s));
  return s.replace(/ 00:00:00$/, '');
}

export interface CompareResult {
  ok: boolean;
  message: string;
}

/** Compare two result sets. Column names are ignored unless `checkNames`. */
export function compareResults(actual: QueryResult, expected: QueryResult, opts: { ordered?: boolean; checkNames?: boolean } = {}): CompareResult {
  if (actual.columns.length !== expected.columns.length) {
    return { ok: false, message: `Expected ${expected.columns.length} column${expected.columns.length === 1 ? '' : 's'} (${expected.columns.join(', ')}), got ${actual.columns.length} (${actual.columns.join(', ')}).` };
  }
  if (opts.checkNames) {
    const a = actual.columns.map((c) => c.toLowerCase());
    const e = expected.columns.map((c) => c.toLowerCase());
    const missing = e.filter((c) => !a.includes(c));
    if (missing.length) return { ok: false, message: `Column names should be: ${expected.columns.join(', ')}. Missing: ${missing.join(', ')}.` };
    // reorder actual to expected order for comparison
    const idx = e.map((c) => a.indexOf(c));
    actual = { ...actual, columns: expected.columns, rows: actual.rows.map((r) => idx.map((i) => r[i])) };
  }
  if (actual.rows.length !== expected.rows.length) {
    return { ok: false, message: `Expected ${expected.rows.length} row${expected.rows.length === 1 ? '' : 's'}, got ${actual.rows.length}.` };
  }
  const a = actual.rows.map((r) => r.map(norm).join(' │ '));
  const e = expected.rows.map((r) => r.map(norm).join(' │ '));
  if (opts.ordered) {
    for (let i = 0; i < e.length; i++) {
      if (a[i] !== e[i]) {
        const sorted = [...a].sort().join('\n') === [...e].sort().join('\n');
        return { ok: false, message: sorted ? 'The right rows, but in the wrong order. Check your ORDER BY.' : `Row ${i + 1} differs. Expected: ${e[i]} — got: ${a[i]}.` };
      }
    }
    return { ok: true, message: 'Result matches exactly.' };
  }
  const as = [...a].sort();
  const es = [...e].sort();
  for (let i = 0; i < es.length; i++) {
    if (as[i] !== es[i]) {
      const extra = a.filter((x) => !e.includes(x));
      const sample = extra[0] ?? as[i];
      return { ok: false, message: `Same number of rows, but the values differ. For example, your result has: ${sample}` };
    }
  }
  return { ok: true, message: 'Result matches.' };
}

export function gradeMcq(item: McqItem, selected: number[]): Grade {
  const correct = new Set(item.correct);
  const sel = new Set(selected);
  if (item.correct.length === 1) {
    const ok = sel.size === 1 && correct.has(selected[0]);
    return { score: ok ? 1 : 0, correct: ok, feedback: ok ? 'Correct.' : 'Not quite.' };
  }
  let hits = 0;
  let wrong = 0;
  for (const s of sel) (correct.has(s) ? hits++ : wrong++);
  const exact = hits === correct.size && wrong === 0;
  const score = Math.max(0, (hits - wrong) / correct.size);
  return { score: exact ? 1 : score, correct: exact, feedback: exact ? 'Correct — all of them.' : `${hits} of ${correct.size} correct options selected${wrong ? `, ${wrong} incorrect` : ''}.` };
}

export function gradeOrder(item: OrderItem, order: string[]): Grade {
  const n = item.steps.length;
  let inPlace = 0;
  order.forEach((s, i) => {
    if (item.steps[i] === s) inPlace++;
  });
  const ok = inPlace === n;
  // partial credit: share of adjacent pairs in the right relative order
  let pairs = 0;
  for (let i = 0; i < n - 1; i++) if (item.steps.indexOf(order[i]) < item.steps.indexOf(order[i + 1])) pairs++;
  return { score: ok ? 1 : pairs / (n - 1) >= 0.75 ? 0.5 : 0, correct: ok, feedback: ok ? 'Correct order.' : `${inPlace} of ${n} steps are in the right position.` };
}

export async function gradeSql(item: SqlItem, sql: string): Promise<Grade & { actual?: QueryResult; expected?: QueryResult }> {
  if (!sql.trim()) return { score: 0, correct: false, feedback: 'Write a query first.' };
  let actual: QueryResult;
  try {
    actual = await query(sql);
  } catch (e) {
    return { score: 0, correct: false, feedback: `Your query failed: ${(e as Error).message}` };
  }
  const expected = await query(item.solution);
  const cmp = compareResults(actual, expected, { ordered: item.ordered, checkNames: item.checkColumnNames });
  return { score: cmp.ok ? 1 : 0, correct: cmp.ok, feedback: cmp.message, actual, expected };
}

export async function numericAnswer(item: NumericItem): Promise<number> {
  const r = await query(item.solution);
  return Number(r.rows[0][0]);
}

export async function gradeNumeric(item: NumericItem, value: string): Promise<Grade> {
  const v = Number(String(value).replace(/[, %$]/g, ''));
  if (!value.trim() || Number.isNaN(v)) return { score: 0, correct: false, feedback: 'Enter a number.' };
  const answer = await numericAnswer(item);
  const tol = item.tolerance ?? 0.005;
  const ok = Math.abs(v - answer) <= Math.max(tol, Math.abs(answer) * 1e-9);
  return { score: ok ? 1 : 0, correct: ok, feedback: ok ? 'Correct.' : 'That is not the right value. Re-check filters and duplicates.' };
}

/** Merge overrides onto the reference project. */
export function applyOverrides(base: ProjectFiles, overrides: Record<string, string | null>): ProjectFiles {
  const out: ProjectFiles = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

export function exerciseFiles(item: DbtItem): ProjectFiles {
  return applyOverrides(TIDEPOOL_PROJECT, item.files);
}

/** Run a dbt item's command in an isolated schema and evaluate its checks. */
export async function gradeDbt(item: DbtItem, files: ProjectFiles, schema: string): Promise<Grade & { run: RunResult }> {
  await resetSchema(schema);
  const cmd = parseCommand(item.command);
  const run = await runDbt(files, { ...cmd.options, targetSchema: schema, deferSchema: 'prod', baseline: TIDEPOOL_PROJECT });
  const checks: CheckOutcome[] = [];
  for (const c of item.checks) checks.push(await evalCheck(c, files, schema, run));
  const passed = checks.filter((c) => c.ok).length;
  const ok = passed === checks.length;
  // file checks are guard rails (use ref(), don't edit the test…): failing one voids the attempt;
  // partial credit only comes from checks that execute something.
  const guards = item.checks.map((c, i) => [c, checks[i]] as const).filter(([c]) => c.type === 'file-matches');
  const real = item.checks.map((c, i) => [c, checks[i]] as const).filter(([c]) => c.type !== 'file-matches');
  const partial = guards.some(([, r]) => !r.ok) || !real.length ? 0 : real.filter(([, r]) => r.ok).length / real.length;
  return {
    score: ok ? 1 : partial,
    correct: ok,
    feedback: ok ? 'All checks pass.' : `${passed} of ${checks.length} checks pass.`,
    checks,
    run,
  };
}

async function evalCheck(c: DbtCheck, files: ProjectFiles, schema: string, run: RunResult): Promise<CheckOutcome> {
  switch (c.type) {
    case 'build-ok': {
      const bad = run.results.filter((r) => r.status === 'error' || r.status === 'fail');
      return { label: c.label ?? 'dbt command completes without errors', ok: run.ok && bad.length === 0, detail: bad.map((b) => b.name).join(', ') || undefined };
    }
    case 'tests-pass': {
      const tests = run.results.filter((r) => r.kind === 'test' || r.kind === 'unit_test');
      const missing: string[] = [];
      const failing: string[] = [];
      for (const req of c.require) {
        const hits = tests.filter((t) => t.name.includes(req));
        if (!hits.length) missing.push(req);
        else if (hits.some((h) => h.status !== 'pass')) failing.push(req);
      }
      for (const req of c.mustCatch ?? []) {
        const hits = tests.filter((t) => t.name.includes(req));
        if (!hits.length) missing.push(req);
        else if (!hits.some((h) => h.status === 'fail' || h.status === 'warn')) failing.push(`${req} (should flag the bad rows)`);
      }
      const ok = !missing.length && !failing.length;
      return {
        label: c.label ?? 'Required tests exist and behave correctly',
        ok,
        detail: ok ? undefined : [missing.length ? `missing: ${missing.join(', ')}` : '', failing.length ? `not passing as expected: ${failing.join(', ')}` : ''].filter(Boolean).join(' · '),
      };
    }
    case 'model-equals': {
      const label = c.label ?? `${c.model} returns the expected rows`;
      try {
        const actual = await query(`select * from ${quoteIdent(schema)}.${quoteIdent(c.model)}`);
        const expected = await query(c.sql);
        const cmp = compareResults(actual, expected, { checkNames: c.checkColumnNames });
        return { label, ok: cmp.ok, detail: cmp.ok ? undefined : cmp.message };
      } catch (e) {
        return { label, ok: false, detail: `Could not read ${schema}.${c.model}: ${(e as Error).message}` };
      }
    }
    case 'file-matches': {
      const content = files[c.file] ?? '';
      const allMatch = c.patterns.every((p) => new RegExp(p, 'is').test(content));
      const ok = c.mustNot ? !c.patterns.some((p) => new RegExp(p, 'is').test(content)) : allMatch;
      return { label: c.label, ok };
    }
    case 'config': {
      const p = parseProject(files);
      const m = p.models.get(c.model);
      const v = m ? (m.config as Record<string, unknown>)[c.key] : undefined;
      const ok = JSON.stringify(v) === JSON.stringify(c.equals) || (typeof c.equals === 'string' && v === c.equals);
      return { label: c.label, ok, detail: ok ? undefined : `${c.key} is ${JSON.stringify(v)}` };
    }
    case 'incremental-equivalence': {
      const label = c.label ?? `${c.model}: incremental run after new data equals a full refresh`;
      // 1) build from scratch, 2) deliver pending events, 3) incremental run, 4) compare with full refresh
      const inc = `${schema}_inc`;
      const full = `${schema}_full`;
      try {
        await exec(`create or replace temp table __raw_events_backup as select * from raw.events`);
        await resetSchema(inc);
        await resetSchema(full);
        const r1 = await runDbt(files, { command: 'run', select: `+${c.model}`, targetSchema: inc, deferSchema: null });
        if (!r1.ok) throw new Error('initial build failed');
        await exec(`insert into raw.events select * from ingest.events_pending`);
        const r2 = await runDbt(files, { command: 'run', select: c.model, targetSchema: inc, deferSchema: null });
        if (!r2.ok) throw new Error('incremental run failed');
        const r3 = await runDbt(files, { command: 'run', select: `+${c.model}`, targetSchema: full, deferSchema: null, fullRefresh: true });
        if (!r3.ok) throw new Error('full refresh failed');
        const a = await query(`select * from ${inc}.${quoteIdent(c.model)}`);
        const b = await query(`select * from ${full}.${quoteIdent(c.model)}`);
        const cmp = compareResults(a, b, { checkNames: true });
        const incremental = r2.results.find((x) => x.name === c.model)?.message.startsWith('incremental');
        if (!incremental) return { label, ok: false, detail: 'The second run did not run incrementally — is the model materialized as incremental?' };
        return { label, ok: cmp.ok, detail: cmp.ok ? undefined : `After the late events arrived, the incremental table differs from a full rebuild: ${cmp.message}` };
      } catch (e) {
        return { label, ok: false, detail: (e as Error).message };
      } finally {
        await exec(`create or replace table raw.events as select * from __raw_events_backup; drop table if exists __raw_events_backup;`);
      }
    }
  }
}

/** Grade an open answer only for completeness (Claude grades the substance). */
export function gradeOpenLocally(text: string, minWords = 30): Grade {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const ok = words >= minWords;
  return { score: 0, correct: false, feedback: ok ? `${words} words — Claude will grade this from your report.` : `${words} words. Aim for at least ${minWords}.` };
}
