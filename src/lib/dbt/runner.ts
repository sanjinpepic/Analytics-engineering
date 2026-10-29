/**
 * Executes dbt-lite commands against DuckDB-WASM:
 *   dbt build | run | test | compile | source freshness
 * with --select / --exclude (name, +name+, path:, tag:, state:modified, config.materialized:),
 * --full-refresh and --defer (unbuilt refs resolve to the prod schema).
 */
import { exec, query, quoteIdent, relationKind, sqlString, type Cell } from '../duckdb';
import { CompileError, ancestors, descendants, parseProject, refName, render, sourceName, topoSort } from './parser';
import type { GenericTestNode, LogLine, ModelNode, NodeResult, ParsedProject, ProjectFiles, RunResult, TestSpec, UnitTestNode } from './types';

/** The scenario clock: the simulated workday starts at 08:30 on Wed 1 July 2026. */
export const SCENARIO_NOW = '2026-07-01 08:30:00';

export interface RunOptions {
  command: 'build' | 'run' | 'test' | 'compile' | 'freshness';
  select?: string;
  exclude?: string;
  fullRefresh?: boolean;
  targetSchema: string;
  /** Schema with production relations to defer to, e.g. 'prod'. */
  deferSchema?: string | null;
  /** Baseline files ("main branch") for state:modified. */
  baseline?: ProjectFiles;
  onLog?: (line: LogLine) => void;
}

export interface CommandLine {
  options: Omit<RunOptions, 'targetSchema' | 'onLog' | 'baseline'>;
  error?: string;
}

/** Parse e.g. `dbt build -s stg_orders+ --full-refresh`. */
export function parseCommand(input: string): CommandLine {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens[0] === 'dbt') tokens.shift();
  const cmd = tokens.shift();
  let command: RunOptions['command'];
  if (cmd === 'build' || cmd === 'run' || cmd === 'test' || cmd === 'compile') command = cmd;
  else if (cmd === 'source' && tokens[0] === 'freshness') {
    tokens.shift();
    command = 'freshness';
  } else return { options: { command: 'build' }, error: `Unknown command '${cmd ?? ''}'. Try: dbt build, dbt run, dbt test, dbt compile, dbt source freshness.` };
  const options: CommandLine['options'] = { command, deferSchema: null };
  const sel: string[] = [];
  const exc: string[] = [];
  let mode: 'select' | 'exclude' | null = null;
  for (const t of tokens) {
    if (t === '-s' || t === '--select' || t === '-m' || t === '--models') mode = 'select';
    else if (t === '--exclude') mode = 'exclude';
    else if (t === '--full-refresh') {
      options.fullRefresh = true;
      mode = null;
    } else if (t === '--defer') {
      options.deferSchema = 'prod';
      mode = null;
    } else if (t.startsWith('--state')) mode = null;
    else if (t.startsWith('-')) return { options, error: `Unsupported flag '${t}' in this sandbox. Supported: -s/--select, --exclude, --full-refresh, --defer.` };
    else if (mode === 'select') sel.push(t);
    else if (mode === 'exclude') exc.push(t);
    else return { options, error: `Unexpected argument '${t}'.` };
  }
  if (sel.length) options.select = sel.join(' ');
  if (exc.length) options.exclude = exc.join(' ');
  return { options };
}

function clock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function dots(left: string, right: string, width = 72): string {
  const n = Math.max(3, width - left.length);
  return `${left} ${'.'.repeat(n)} ${right}`;
}

/** Resolve a selector string into a set of model names. */
export function selectModels(project: ParsedProject, select: string | undefined, exclude: string | undefined, baseline?: ProjectFiles): Set<string> {
  const all = new Set(project.models.keys());
  const evalTerm = (term: string): Set<string> => {
    const m = term.match(/^(\d*\+)?(.+?)(\+\d*)?$/)!;
    const up = !!m[1];
    const down = !!m[3];
    const base = m[2];
    let hits = new Set<string>();
    if (base.startsWith('path:')) {
      const p = base.slice(5).replace(/\/$/, '');
      for (const n of project.models.values()) if (n.path === p || n.path.startsWith(`${p}/`) || n.path === `${p}.sql`) hits.add(n.name);
    } else if (base.startsWith('tag:')) {
      const t = base.slice(4);
      for (const n of project.models.values()) if (n.config.tags.includes(t)) hits.add(n.name);
    } else if (base.startsWith('config.materialized:')) {
      const t = base.slice('config.materialized:'.length);
      for (const n of project.models.values()) if (n.config.materialized === t) hits.add(n.name);
    } else if (base.startsWith('state:modified')) {
      for (const n of project.models.values()) {
        const before = baseline?.[n.path];
        if (before === undefined || before.trim() !== n.raw.trim()) hits.add(n.name);
      }
    } else if (base.includes('*')) {
      const re = new RegExp(`^${base.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`);
      for (const n of all) if (re.test(n)) hits.add(n);
    } else if (project.models.has(base)) {
      hits.add(base);
    }
    const expanded = new Set(hits);
    if (up) for (const h of hits) for (const a of ancestors(project, h)) expanded.add(a);
    if (down) for (const h of hits) for (const d of descendants(project, h)) expanded.add(d);
    hits = expanded;
    return hits;
  };
  let chosen = new Set<string>();
  if (!select) chosen = new Set(all);
  else for (const t of select.split(/\s+/)) for (const n of evalTerm(t)) chosen.add(n);
  if (exclude) for (const t of exclude.split(/\s+/)) for (const n of evalTerm(t)) chosen.delete(n);
  return chosen;
}

/** Names of relations present in a schema. */
async function relationsIn(schema: string): Promise<Set<string>> {
  const r = await query(
    `select table_name from duckdb_tables() where schema_name = ${sqlString(schema)} union all select view_name from duckdb_views() where schema_name = ${sqlString(schema)}`,
  );
  return new Set(r.rows.map((x) => String(x[0])));
}

interface Ctx {
  project: ParsedProject;
  opts: RunOptions;
  selected: Set<string>;
  targetRels: Set<string>;
  deferRels: Set<string>;
}

function resolver(ctx: Ctx, current: string) {
  return (name: string): string => {
    if (!ctx.project.models.has(name)) throw new CompileError(`Model '${current}' depends on a node named '${name}' which was not found`);
    const { targetSchema, deferSchema } = ctx.opts;
    if (ctx.selected.has(name)) return `${targetSchema}.${name}`;
    if (ctx.targetRels.has(name)) return `${targetSchema}.${name}`;
    if (deferSchema && ctx.deferRels.has(name)) return `${deferSchema}.${name}`;
    return `${targetSchema}.${name}`;
  };
}

function sourceResolver(ctx: Ctx, current: string) {
  return (s: string, t: string): string => {
    const src = ctx.project.sources.get(`${s}.${t}`);
    if (!src) throw new CompileError(`Model '${current}' depends on a source named '${s}.${t}' which was not found`);
    return `${src.schema}.${src.identifier}`;
  };
}

export async function compileModel(project: ParsedProject, model: ModelNode, ctx: Ctx, isIncremental: boolean): Promise<string> {
  return render(model.raw, project.macros, {
    ref: resolver(ctx, model.name),
    source: sourceResolver(ctx, model.name),
    isIncremental,
    thisRelation: `${ctx.opts.targetSchema}.${model.name}`,
    vars: project.vars,
    targetSchema: ctx.opts.targetSchema,
  });
}

const TYPE_ALIASES: Record<string, string> = {
  int: 'INTEGER',
  integer: 'INTEGER',
  int4: 'INTEGER',
  bigint: 'BIGINT',
  int8: 'BIGINT',
  string: 'VARCHAR',
  text: 'VARCHAR',
  varchar: 'VARCHAR',
  bool: 'BOOLEAN',
  boolean: 'BOOLEAN',
  float: 'DOUBLE',
  double: 'DOUBLE',
  float8: 'DOUBLE',
  numeric: 'DECIMAL',
  decimal: 'DECIMAL',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
  datetime: 'TIMESTAMP',
};
function normType(t: string): string {
  const base = t.trim().toLowerCase().replace(/\(.*\)$/, '');
  const mapped = TYPE_ALIASES[base] ?? base.toUpperCase();
  return mapped.startsWith('DECIMAL') ? 'DECIMAL' : mapped;
}

async function checkContract(model: ModelNode, sql: string): Promise<string | null> {
  if (!model.config.contract?.enforced) return null;
  const desc = await query(`describe ${sql}`);
  const actual = new Map(desc.rows.map((r) => [String(r[0]), String(r[1])]));
  const rows: string[] = [];
  for (const c of model.columns) {
    if (!c.data_type) {
      rows.push(`| ${c.name} | — | (missing data_type) | every column in an enforced contract needs a data_type |`);
      continue;
    }
    const a = actual.get(c.name);
    if (!a) rows.push(`| ${c.name} | — | ${c.data_type} | missing in definition |`);
    else if (normType(a) !== normType(c.data_type)) rows.push(`| ${c.name} | ${a} | ${c.data_type} | data type mismatch |`);
  }
  const declared = new Set(model.columns.map((c) => c.name));
  for (const a of actual.keys()) if (!declared.has(a)) rows.push(`| ${a} | ${actual.get(a)} | — | missing in contract |`);
  if (!rows.length) return null;
  return `This model has an enforced contract that failed.\nPlease ensure the name, data_type, and number of columns in your contract match the columns in your model's definition.\n\n| column_name | definition_type | contract_type | mismatch_reason |\n${rows.join('\n')}`;
}

async function materialize(model: ModelNode, sql: string, ctx: Ctx): Promise<{ action: string; incremental: boolean }> {
  const schema = ctx.opts.targetSchema;
  const rel = `${schema}.${quoteIdent(model.name)}`;
  const mat = model.config.materialized === 'ephemeral' ? 'view' : model.config.materialized;
  const existing = await relationKind(schema, model.name);
  if (mat === 'view') {
    if (existing === 'table') await exec(`drop table ${rel}`);
    await exec(`create or replace view ${rel} as ${sql}`);
    return { action: 'created sql view model', incremental: false };
  }
  if (mat === 'table' || (mat === 'incremental' && (existing !== 'table' || ctx.opts.fullRefresh))) {
    if (existing === 'view') await exec(`drop view ${rel}`);
    await exec(`create or replace table ${rel} as ${sql}`);
    return { action: mat === 'incremental' ? 'created sql incremental model' : 'created sql table model', incremental: false };
  }
  // incremental run against an existing table
  const tmp = quoteIdent(`${model.name}__dbt_tmp`);
  await exec(`create or replace temp table ${tmp} as ${sql}`);
  const keys = model.config.unique_key === undefined ? [] : Array.isArray(model.config.unique_key) ? model.config.unique_key : [model.config.unique_key];
  const strategy = model.config.incremental_strategy ?? (keys.length ? 'merge' : 'append');
  if (keys.length && strategy !== 'append') {
    const tuple = keys.map((k) => quoteIdent(String(k))).join(', ');
    await exec(`delete from ${rel} where (${tuple}) in (select ${tuple} from ${tmp})`);
  }
  await exec(`insert into ${rel} by name select * from ${tmp}; drop table ${tmp};`);
  const count = await query(`select count(*) from ${rel}`);
  return { action: `incremental ${strategy} into model (now ${count.rows[0][0]} rows)`, incremental: true };
}

/** SQL for a generic test; returns failing rows. */
export function genericTestSql(t: GenericTestNode, relation: string, resolveRefExpr: (expr: string) => string): string {
  const s: TestSpec = t.spec;
  const col = t.column ? quoteIdent(t.column) : '';
  const rel = s.where ? `(select * from ${relation} where ${s.where})` : relation;
  const a = s.args;
  switch (s.kind) {
    case 'unique':
      return `select ${col} as unique_field, count(*) as n_records from ${rel} where ${col} is not null group by ${col} having count(*) > 1`;
    case 'not_null':
      return `select * from ${rel} where ${col} is null`;
    case 'accepted_values': {
      const values = (Array.isArray(a.values) ? a.values : []).map((v) => (typeof v === 'number' ? String(v) : sqlString(String(v)))).join(', ');
      return `select ${col} as value_field, count(*) as n_records from ${rel} where ${col} not in (${values || 'null'}) group by ${col}`;
    }
    case 'relationships': {
      const to = resolveRefExpr(String(a.to ?? ''));
      const field = quoteIdent(String(a.field ?? 'id'));
      return `select child.${col} as from_field from ${rel} as child left join ${to} as parent on child.${col} = parent.${field} where child.${col} is not null and parent.${field} is null`;
    }
    case 'dbt_utils.expression_is_true':
    case 'expression_is_true':
      return `select * from ${rel} where not (${a.expression ?? 'true'})`;
    case 'dbt_utils.unique_combination_of_columns': {
      const cols = (Array.isArray(a.combination_of_columns) ? a.combination_of_columns : []).map((c) => quoteIdent(String(c))).join(', ');
      return `select ${cols}, count(*) as n_records from ${rel} group by ${cols} having count(*) > 1`;
    }
    case 'dbt_utils.not_constant':
      return `select count(distinct ${col}) as n from ${rel} having count(distinct ${col}) <= 1`;
    case 'dbt_utils.accepted_range': {
      const conds: string[] = [];
      if (a.min_value !== undefined) conds.push(`${col} < ${a.min_value}`);
      if (a.max_value !== undefined) conds.push(`${col} > ${a.max_value}`);
      return `select * from ${rel} where ${conds.join(' or ') || 'false'}`;
    }
    case 'dbt_utils.recency': {
      const field = quoteIdent(String(a.field ?? t.column));
      return `select max(${field}) as most_recent from ${rel} having max(${field}) < timestamp '${SCENARIO_NOW}' - interval ${Number(a.interval ?? 1)} ${String(a.datepart ?? 'day')}`;
    }
    default:
      throw new CompileError(`Generic test '${s.kind}' is not available in this sandbox. Available: unique, not_null, accepted_values, relationships, dbt_utils.expression_is_true, dbt_utils.unique_combination_of_columns, dbt_utils.accepted_range, dbt_utils.not_constant, dbt_utils.recency.`);
  }
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return sqlString(v.toISOString().slice(0, 19).replace('T', ' '));
  return sqlString(String(v));
}

function normCell(v: Cell | unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  const s = String(v);
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(Math.round(Number(s) * 1e6) / 1e6);
  return s.replace(/T(\d\d:\d\d:\d\d).*$/, ' $1').replace(/ 00:00:00$/, '');
}

async function runUnitTest(ut: UnitTestNode, ctx: Ctx): Promise<{ ok: boolean; message: string }> {
  const model = ctx.project.models.get(ut.model);
  if (!model) return { ok: false, message: `Unit test '${ut.name}' references model '${ut.model}' which does not exist.` };
  const ctes: string[] = [];
  const refMap = new Map<string, string>();
  const srcMap = new Map<string, string>();
  const realRef = resolver(ctx, model.name);
  const realSource = sourceResolver(ctx, model.name);
  for (const g of ut.given) {
    const r = refName(g.input);
    const s = sourceName(g.input);
    const real = r ? realRef(r) : s ? realSource(s[0], s[1]) : null;
    if (!real) return { ok: false, message: `Unsupported unit test input '${g.input}'. Use ref('model') or source('src', 'table').` };
    const [schema, name] = real.split('.');
    const colRes = await query(`select column_name, data_type from duckdb_columns() where schema_name = ${sqlString(schema)} and table_name = ${sqlString(name)} order by column_index`);
    if (!colRes.rows.length) return { ok: false, message: `Unit test input ${g.input} resolves to ${real}, which does not exist yet. Build it first (or use --defer).` };
    const cols = colRes.rows.map((x) => [String(x[0]), String(x[1])] as const);
    const cteName = `__dbt__unit__${(r ?? `${s![0]}_${s![1]}`).replace(/\W/g, '_')}`;
    const selects = g.rows.length
      ? g.rows.map((row) => `select ${cols.map(([c, ty]) => `cast(${literal(row[c])} as ${ty}) as ${quoteIdent(c)}`).join(', ')}`).join(' union all ')
      : `select ${cols.map(([c, ty]) => `cast(null as ${ty}) as ${quoteIdent(c)}`).join(', ')} where false`;
    ctes.push(`${cteName} as (${selects})`);
    if (r) refMap.set(r, cteName);
    else srcMap.set(`${s![0]}.${s![1]}`, cteName);
  }
  let compiled: string;
  try {
    compiled = render(model.raw, ctx.project.macros, {
      ref: (n) => {
        const hit = refMap.get(n);
        if (!hit) throw new CompileError(`Unit test '${ut.name}' is missing a 'given' input for ref('${n}').`);
        return hit;
      },
      source: (a, b) => {
        const hit = srcMap.get(`${a}.${b}`);
        if (!hit) throw new CompileError(`Unit test '${ut.name}' is missing a 'given' input for source('${a}', '${b}').`);
        return hit;
      },
      isIncremental: false,
      thisRelation: `${ctx.opts.targetSchema}.${model.name}`,
      vars: ctx.project.vars,
      targetSchema: ctx.opts.targetSchema,
    });
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const expectCols = [...new Set(ut.expect.rows.flatMap((r) => Object.keys(r)))];
  const sql = `with ${ctes.join(', ')} select ${expectCols.length ? expectCols.map(quoteIdent).join(', ') : '*'} from (${compiled}) as __dbt_unit_actual`;
  let actual;
  try {
    actual = await query(sql);
  } catch (e) {
    return { ok: false, message: `Runtime error: ${(e as Error).message}` };
  }
  const exp = ut.expect.rows.map((r) => expectCols.map((c) => normCell(r[c])).join(' | ')).sort();
  const act = actual.rows.map((r) => r.map(normCell).join(' | ')).sort();
  const same = exp.length === act.length && exp.every((v, i) => v === act[i]);
  if (same) return { ok: true, message: '' };
  const header = expectCols.join(' | ');
  return {
    ok: false,
    message: `actual differs from expected:\n\n  expected (${exp.length} rows):\n    ${header}\n    ${exp.join('\n    ') || '(none)'}\n\n  actual (${act.length} rows):\n    ${header}\n    ${act.slice(0, 12).join('\n    ') || '(none)'}`,
  };
}

/** Run a dbt-lite command. */
export async function runDbt(files: ProjectFiles, opts: RunOptions): Promise<RunResult> {
  const t0 = performance.now();
  const log: LogLine[] = [];
  const results: NodeResult[] = [];
  const push = (text: string, tone: LogLine['tone'] = 'plain') => {
    const line = { at: clock(), text, tone };
    log.push(line);
    opts.onLog?.(line);
  };
  const label = opts.command === 'freshness' ? 'source freshness' : opts.command;
  push(`Running with dbt-lite=1.10 (sandbox) · adapter=duckdb-wasm · target=${opts.targetSchema}${opts.deferSchema ? ` · defer→${opts.deferSchema}` : ''}`, 'muted');

  const project = parseProject(files);
  if (project.errors.length) {
    push('Encountered an error while parsing the project:', 'error');
    for (const e of project.errors) push(`  ${e}`, 'error');
    return { command: label, results, log, ok: false, elapsedMs: performance.now() - t0 };
  }

  await exec(`create schema if not exists ${quoteIdent(opts.targetSchema)}`);
  const selected = selectModels(project, opts.select, opts.exclude, opts.baseline);
  const ctx: Ctx = {
    project,
    opts,
    selected: opts.command === 'test' || opts.command === 'compile' ? new Set() : selected,
    targetRels: await relationsIn(opts.targetSchema),
    deferRels: opts.deferSchema ? await relationsIn(opts.deferSchema) : new Set(),
  };

  if (opts.command === 'freshness') {
    let i = 0;
    const srcs = [...project.sources.values()].filter((s) => s.loadedAtField && s.freshness);
    push(`Found ${srcs.length} sources with a freshness policy · scenario clock ${SCENARIO_NOW}`);
    let worst: 'pass' | 'warn' | 'error' = 'pass';
    for (const s of srcs) {
      i++;
      const r = await query(`select max(${s.loadedAtField}) as m, extract(epoch from (timestamp '${SCENARIO_NOW}' - max(${s.loadedAtField}))) / 3600.0 as age_h from ${s.schema}.${s.identifier}`);
      const age = Number(r.rows[0][1]);
      const hours = (p?: { count: number; period: string }) => (p ? p.count * (p.period.startsWith('day') ? 24 : p.period.startsWith('minute') ? 1 / 60 : 1) : Infinity);
      const status = age > hours(s.freshness?.error_after) ? 'error' : age > hours(s.freshness?.warn_after) ? 'warn' : 'pass';
      if (status === 'error') worst = 'error';
      else if (status === 'warn' && worst === 'pass') worst = 'warn';
      const tone = status === 'pass' ? 'ok' : status === 'warn' ? 'warn' : 'error';
      push(dots(`${i} of ${srcs.length} freshness of ${s.source}.${s.name}`, `[${status.toUpperCase()} · last load ${r.rows[0][0]} · ${age.toFixed(1)}h old]`), tone);
      results.push({ id: `source.${s.source}.${s.name}`, name: `${s.source}.${s.name}`, kind: 'source_freshness', status: status === 'error' ? 'error' : status === 'warn' ? 'warn' : 'pass', message: `${age.toFixed(1)} hours since last load`, ms: 0 });
    }
    push(worst === 'pass' ? 'Done. All sources are fresh.' : `Done. Freshness ${worst === 'error' ? 'ERROR' : 'WARN'} on at least one source.`, worst === 'pass' ? 'ok' : worst === 'warn' ? 'warn' : 'error');
    return { command: label, results, log, ok: worst !== 'error', elapsedMs: performance.now() - t0 };
  }

  let order: string[];
  try {
    order = topoSort(project, selected);
  } catch (e) {
    push((e as Error).message, 'error');
    return { command: label, results, log, ok: false, elapsedMs: performance.now() - t0 };
  }

  const runModels = opts.command === 'build' || opts.command === 'run';
  const runTests = opts.command === 'build' || opts.command === 'test';
  const testsFor = (m: string) => project.tests.filter((t) => t.attachedTo === `model:${m}`);
  const unitFor = (m: string) => project.unitTests.filter((u) => u.model === m);
  const singular = project.singularTests.filter((t) => t.refs.length === 0 || t.refs.some((r) => selected.has(r)));
  const sourceTests = !opts.select ? project.tests.filter((t) => t.attachedTo.startsWith('source:')) : [];

  if (opts.command === 'compile') {
    for (const name of order) {
      const m = project.models.get(name)!;
      try {
        const sql = await compileModel(project, m, ctx, false);
        results.push({ id: `model.${name}`, name, kind: 'model', status: 'success', message: 'compiled', compiledSql: sql, ms: 0 });
      } catch (e) {
        results.push({ id: `model.${name}`, name, kind: 'model', status: 'error', message: (e as Error).message, ms: 0 });
        push(`Compilation Error in model ${name}: ${(e as Error).message}`, 'error');
      }
    }
    push(`Compiled ${results.filter((r) => r.status === 'success').length} of ${order.length} models.`, 'ok');
    return { command: label, results, log, ok: results.every((r) => r.status === 'success'), elapsedMs: performance.now() - t0 };
  }

  const nModelSteps = runModels ? order.length : 0;
  const nTestSteps = runTests
    ? order.reduce((s, m) => s + testsFor(m).length + unitFor(m).length, 0) + singular.length + sourceTests.length
    : 0;
  const total = nModelSteps + nTestSteps;
  push(`Found ${project.models.size} models, ${project.tests.length + project.singularTests.length} data tests, ${project.unitTests.length} unit tests, ${project.sources.size} sources · selected ${selected.size} models`);
  if (total === 0) {
    push('Nothing to do. Check your --select (e.g. -s stg_shop__orders+ or -s path:models/marts).', 'warn');
    return { command: label, results, log, ok: true, elapsedMs: performance.now() - t0 };
  }
  push('');
  let step = 0;
  const blocked = new Set<string>();
  const block = (name: string) => {
    for (const d of descendants(project, name)) blocked.add(d);
  };

  const runGeneric = async (t: GenericTestNode) => {
    step++;
    const s0 = performance.now();
    try {
      let relation: string;
      if (t.attachedTo.startsWith('model:')) relation = resolver(ctx, t.attachedTo.slice(6))(t.attachedTo.slice(6));
      else {
        const [src, tbl] = t.attachedTo.slice(7).split('.');
        relation = sourceResolver(ctx, 'test')(src, tbl);
      }
      const sql = genericTestSql(t, relation, (expr) => {
        const r = refName(expr);
        if (r) return resolver(ctx, t.name)(r);
        const s = sourceName(expr);
        if (s) return sourceResolver(ctx, t.name)(s[0], s[1]);
        return expr;
      });
      const r = await query(`select count(*) from (${sql}) as dbt_internal_test`);
      const failures = Number(r.rows[0][0]);
      const ms = performance.now() - s0;
      const status = failures === 0 ? 'pass' : t.spec.severity === 'warn' ? 'warn' : 'fail';
      const tag = status === 'pass' ? `[PASS in ${(ms / 1000).toFixed(2)}s]` : `[${status.toUpperCase()} ${failures} in ${(ms / 1000).toFixed(2)}s]`;
      push(dots(`${step} of ${total} ${status === 'pass' ? 'PASS' : status.toUpperCase()} ${t.name}`, tag), status === 'pass' ? 'ok' : status === 'warn' ? 'warn' : 'error');
      results.push({ id: t.id, name: t.name, kind: 'test', status, failures, message: failures ? `Got ${failures} result${failures === 1 ? '' : 's'}, configured to ${t.spec.severity === 'warn' ? 'warn' : 'fail'} if != 0` : '', compiledSql: sql, ms });
      return status;
    } catch (e) {
      push(dots(`${step} of ${total} ERROR ${t.name}`, '[ERROR]'), 'error');
      push(`    ${(e as Error).message}`, 'error');
      results.push({ id: t.id, name: t.name, kind: 'test', status: 'error', message: (e as Error).message, ms: performance.now() - s0 });
      return 'error';
    }
  };

  for (const name of order) {
    const model = project.models.get(name)!;
    if (blocked.has(name)) {
      if (runModels) {
        step++;
        push(dots(`${step} of ${total} SKIP relation ${opts.targetSchema}.${name}`, '[SKIP]'), 'skip');
        results.push({ id: `model.${name}`, name, kind: 'model', status: 'skipped', message: 'Skipped due to an upstream failure', ms: 0 });
      }
      if (runTests) {
        for (const t of [...unitFor(name), ...testsFor(name)]) {
          step++;
          push(dots(`${step} of ${total} SKIP test ${t.name}`, '[SKIP]'), 'skip');
          results.push({ id: t.id, name: t.name, kind: t.type === 'unit_test' ? 'unit_test' : 'test', status: 'skipped', message: 'Skipped due to an upstream failure', ms: 0 });
        }
      }
      continue;
    }

    // unit tests run before the model is built
    if (runTests) {
      let unitFailed = false;
      for (const ut of unitFor(name)) {
        step++;
        const s0 = performance.now();
        const r = await runUnitTest(ut, ctx);
        const ms = performance.now() - s0;
        push(dots(`${step} of ${total} ${r.ok ? 'PASS' : 'FAIL'} ${model.name}::${ut.name}`, `[${r.ok ? 'PASS' : 'FAIL 1'} in ${(ms / 1000).toFixed(2)}s]`), r.ok ? 'ok' : 'error');
        if (!r.ok) {
          for (const l of r.message.split('\n')) push(`    ${l}`, 'error');
          unitFailed = true;
        }
        results.push({ id: ut.id, name: `${model.name}::${ut.name}`, kind: 'unit_test', status: r.ok ? 'pass' : 'fail', message: r.message, failures: r.ok ? 0 : 1, ms });
      }
      if (unitFailed && runModels) {
        blocked.add(name);
        block(name);
        step++;
        push(dots(`${step} of ${total} SKIP relation ${opts.targetSchema}.${name}`, '[SKIP]'), 'skip');
        results.push({ id: `model.${name}`, name, kind: 'model', status: 'skipped', message: 'Skipped because a unit test failed', ms: 0 });
        for (const t of testsFor(name)) {
          step++;
          push(dots(`${step} of ${total} SKIP test ${t.name}`, '[SKIP]'), 'skip');
          results.push({ id: t.id, name: t.name, kind: 'test', status: 'skipped', message: 'Skipped because the model was not built', ms: 0 });
        }
        continue;
      }
    }

    if (runModels) {
      step++;
      const s0 = performance.now();
      const relation = `${opts.targetSchema}.${name}`;
      const mat = model.config.materialized;
      push(dots(`${step} of ${total} START sql ${mat} model ${relation}`, '[RUN]'), 'muted');
      let compiled = '';
      try {
        const exists = (await relationKind(opts.targetSchema, name)) === 'table';
        const incremental = mat === 'incremental' && exists && !opts.fullRefresh;
        compiled = await compileModel(project, model, ctx, incremental);
        const contractError = await checkContract(model, compiled);
        if (contractError) throw new CompileError(contractError);
        const { action } = await materialize(model, compiled, ctx);
        ctx.targetRels.add(name);
        const ms = performance.now() - s0;
        push(dots(`${step} of ${total} OK ${action} ${relation}`, `[OK in ${(ms / 1000).toFixed(2)}s]`), 'ok');
        results.push({ id: `model.${name}`, name, kind: 'model', status: 'success', message: action, relation, materialized: mat, compiledSql: compiled, ms });
      } catch (e) {
        const ms = performance.now() - s0;
        const kind = e instanceof CompileError ? 'Compilation Error' : 'Runtime Error';
        push(dots(`${step} of ${total} ERROR creating sql ${mat} model ${relation}`, `[ERROR in ${(ms / 1000).toFixed(2)}s]`), 'error');
        push(`  ${kind} in model ${name} (${model.path})`, 'error');
        for (const l of (e as Error).message.split('\n')) push(`    ${l}`, 'error');
        results.push({ id: `model.${name}`, name, kind: 'model', status: 'error', message: `${kind}: ${(e as Error).message}`, relation, compiledSql: compiled, ms });
        block(name);
        if (runTests) {
          for (const t of testsFor(name)) {
            step++;
            push(dots(`${step} of ${total} SKIP test ${t.name}`, '[SKIP]'), 'skip');
            results.push({ id: t.id, name: t.name, kind: 'test', status: 'skipped', message: 'Skipped because the model failed to build', ms: 0 });
          }
        }
        continue;
      }
    }

    if (runTests) {
      let failed = false;
      for (const t of testsFor(name)) {
        const st = await runGeneric(t);
        if (st === 'fail' || st === 'error') failed = true;
      }
      if (failed && opts.command === 'build') block(name);
    }
  }

  if (runTests) {
    for (const t of sourceTests) await runGeneric(t);
    for (const t of singular) {
      step++;
      const s0 = performance.now();
      try {
        const sql = render(t.raw, project.macros, {
          ref: resolver(ctx, t.name),
          source: sourceResolver(ctx, t.name),
          isIncremental: false,
          thisRelation: '',
          vars: project.vars,
          targetSchema: opts.targetSchema,
        });
        const r = await query(`select count(*) from (${sql}) as dbt_internal_test`);
        const failures = Number(r.rows[0][0]);
        const ms = performance.now() - s0;
        push(dots(`${step} of ${total} ${failures ? 'FAIL' : 'PASS'} ${t.name}`, failures ? `[FAIL ${failures} in ${(ms / 1000).toFixed(2)}s]` : `[PASS in ${(ms / 1000).toFixed(2)}s]`), failures ? 'error' : 'ok');
        results.push({ id: t.id, name: t.name, kind: 'test', status: failures ? 'fail' : 'pass', failures, message: failures ? `Got ${failures} results, configured to fail if != 0` : '', compiledSql: sql, ms });
      } catch (e) {
        push(dots(`${step} of ${total} ERROR ${t.name}`, '[ERROR]'), 'error');
        push(`    ${(e as Error).message}`, 'error');
        results.push({ id: t.id, name: t.name, kind: 'test', status: 'error', message: (e as Error).message, ms: performance.now() - s0 });
      }
    }
  }

  const count = (s: string) => results.filter((r) => r.status === s).length;
  const errors = count('error') + count('fail');
  push('');
  const elapsed = (performance.now() - t0) / 1000;
  push(`Finished running ${results.length} nodes in ${elapsed.toFixed(2)}s.`, 'muted');
  push(
    errors ? `Completed with ${errors} error${errors === 1 ? '' : 's'}, ${count('warn')} warning${count('warn') === 1 ? '' : 's'} and ${count('skipped')} skipped.` : `Completed successfully.${count('warn') ? ` ${count('warn')} warning${count('warn') === 1 ? '' : 's'}.` : ''}`,
    errors ? 'error' : count('warn') ? 'warn' : 'ok',
  );
  push(`Done. PASS=${count('pass') + count('success')} WARN=${count('warn')} ERROR=${errors} SKIP=${count('skipped')} TOTAL=${results.length}`, errors ? 'error' : 'ok');
  return { command: label, results, log, ok: errors === 0, elapsedMs: performance.now() - t0 };
}

/** Compile a single model for preview (refs resolve to dev if built there, else prod). */
export async function compileForPreview(files: ProjectFiles, modelName: string, targetSchema: string, deferSchema: string | null): Promise<string> {
  const project = parseProject(files);
  const model = project.models.get(modelName);
  if (!model) throw new CompileError(`No model named '${modelName}'`);
  const ctx: Ctx = {
    project,
    opts: { command: 'compile', targetSchema, deferSchema },
    selected: new Set(),
    targetRels: await relationsIn(targetSchema),
    deferRels: deferSchema ? await relationsIn(deferSchema) : new Set(),
  };
  return compileModel(project, model, ctx, false);
}

/** Render an ad-hoc SQL snippet (may contain ref/source) like `dbt show --inline`. */
export async function compileInline(files: ProjectFiles, sql: string, targetSchema: string, deferSchema: string | null): Promise<string> {
  const project = parseProject(files);
  const ctx: Ctx = {
    project,
    opts: { command: 'compile', targetSchema, deferSchema },
    selected: new Set(),
    targetRels: await relationsIn(targetSchema),
    deferRels: deferSchema ? await relationsIn(deferSchema) : new Set(),
  };
  return render(sql, project.macros, {
    ref: resolver(ctx, 'inline'),
    source: sourceResolver(ctx, 'inline'),
    isIncremental: false,
    thisRelation: '',
    vars: project.vars,
    targetSchema,
  });
}
