/**
 * Parses a dbt-lite project (dbt_project.yml, models/**.sql + yml, tests/*.sql, macros/*.sql)
 * and renders Jinja through nunjucks, which shares Jinja2's syntax for everything a
 * typical dbt project uses: {{ }}, {% if %}, {% for %}, {% set %}, {% macro %}, filters.
 */
import nunjucks from 'nunjucks';
import * as yaml from 'js-yaml';
import type {
  ColumnSpec,
  GenericTestNode,
  ModelConfig,
  ModelNode,
  ParsedProject,
  ProjectFiles,
  SingularTestNode,
  SourceTable,
  TestSpec,
  UnitTestNode,
} from './types';

const env = new nunjucks.Environment(null, { autoescape: false, throwOnUndefined: false });

export class CompileError extends Error {}

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function basename(path: string): string {
  return path.split('/').pop()!.replace(/\.(sql|yml|yaml)$/, '');
}

function layerOf(path: string): ModelNode['layer'] {
  if (path.includes('/staging/')) return 'staging';
  if (path.includes('/intermediate/')) return 'intermediate';
  if (path.includes('/marts/')) return 'marts';
  return 'other';
}

/** Normalise one entry of a `data_tests:` / `tests:` list. */
export function normaliseTest(entry: unknown): TestSpec | null {
  if (typeof entry === 'string') return { kind: entry, args: {}, severity: 'error' };
  if (!isDict(entry)) return null;
  const [kind, body] = Object.entries(entry)[0] ?? [];
  if (!kind) return null;
  const b = isDict(body) ? body : {};
  const config = isDict(b.config) ? b.config : {};
  // dbt >= 1.10 nests test arguments under `arguments:`; older projects put them inline.
  const args = isDict(b.arguments) ? { ...b.arguments } : { ...b };
  delete args.config;
  delete args.arguments;
  const severity = String(config.severity ?? args.severity ?? 'error').toLowerCase() === 'warn' ? 'warn' : 'error';
  delete args.severity;
  const where = (config.where ?? args.where) as string | undefined;
  delete args.where;
  return { kind, args, severity, where };
}

function testName(spec: TestSpec, target: string, column?: string): string {
  const k = spec.kind.replace(/^dbt_utils\./, 'dbt_utils_');
  const base = column ? `${k}_${target}_${column}` : `${k}_${target}`;
  if (spec.kind === 'accepted_values' && Array.isArray(spec.args.values)) {
    return `${base}__${(spec.args.values as unknown[]).map(String).join('__')}`.slice(0, 80);
  }
  if (spec.kind === 'relationships') {
    const to = String(spec.args.to ?? '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
    return `${base}__${spec.args.field ?? ''}__${to}`;
  }
  return base;
}

function parseColumns(raw: unknown): ColumnSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isDict).map((c) => ({
    name: String(c.name),
    description: c.description as string | undefined,
    data_type: c.data_type as string | undefined,
    tests: ((c.data_tests ?? c.tests ?? []) as unknown[]).map(normaliseTest).filter((t): t is TestSpec => !!t),
  }));
}

export function refName(expr: string): string | null {
  const m = expr.match(/ref\(\s*['"]([\w.]+)['"]\s*\)/);
  return m ? m[1] : null;
}
export function sourceName(expr: string): [string, string] | null {
  const m = expr.match(/source\(\s*['"]([\w]+)['"]\s*,\s*['"]([\w]+)['"]\s*\)/);
  return m ? [m[1], m[2]] : null;
}

/** Folder-level config from dbt_project.yml (`models: <project>: staging: +materialized: view`). */
function folderConfig(projectYml: Dict, projectName: string, path: string): Dict {
  const models = isDict(projectYml.models) ? projectYml.models : {};
  let node: unknown = models[projectName];
  const out: Dict = {};
  const take = (d: Dict) => {
    for (const [k, v] of Object.entries(d)) if (k.startsWith('+')) out[k.slice(1)] = v;
  };
  if (!isDict(node)) return out;
  take(node);
  const parts = path.replace(/^models\//, '').split('/').slice(0, -1);
  for (const p of parts) {
    node = isDict(node) ? node[p] : undefined;
    if (!isDict(node)) break;
    take(node);
  }
  return out;
}

export interface RenderContext {
  ref: (name: string) => string;
  source: (source: string, table: string) => string;
  isIncremental: boolean;
  thisRelation: string;
  vars: Record<string, unknown>;
  onConfig?: (cfg: Dict) => void;
  targetSchema: string;
}

function surrogateKey(fields: unknown): string {
  const list = Array.isArray(fields) ? fields.map(String) : [String(fields)];
  const parts = list.map((f) => `coalesce(cast(${f} as varchar), '_dbt_utils_surrogate_key_null_')`);
  return `md5(${parts.join(" || '-' || ")})`;
}

function stripKeywords(args: unknown[]): Dict {
  const last = args[args.length - 1];
  if (isDict(last) && last.__keywords) {
    const { __keywords, ...rest } = last;
    void __keywords;
    return rest;
  }
  return {};
}

/** Render a Jinja SQL template. Line numbers in errors refer to the user's file. */
export function render(sql: string, macros: string, ctx: RenderContext): string {
  const prefix = macros ? `${macros}\n` : '';
  const offset = prefix ? prefix.split('\n').length - 1 : 0;
  const context = {
    ref: (name: string) => ctx.ref(name),
    source: (s: string, t: string) => ctx.source(s, t),
    config: (...args: unknown[]) => {
      ctx.onConfig?.(stripKeywords(args));
      return '';
    },
    var: (name: string, dflt?: unknown) => {
      if (name in ctx.vars) return ctx.vars[name];
      if (dflt !== undefined) return dflt;
      throw new CompileError(`Required var '${name}' not found in dbt_project.yml vars and no default given`);
    },
    is_incremental: () => ctx.isIncremental,
    this: ctx.thisRelation,
    target: { name: ctx.targetSchema, schema: ctx.targetSchema, type: 'duckdb' },
    dbt_utils: {
      generate_surrogate_key: surrogateKey,
    },
    run_started_at: '2026-07-01 08:30:00',
    env_var: (_name: string, dflt = '') => dflt,
  };
  try {
    return env.renderString(prefix + sql, context).slice(prefix.length ? 0 : 0).trim().replace(/;\s*$/, '');
  } catch (e) {
    if (e instanceof CompileError) throw e;
    let msg = e instanceof Error ? e.message : String(e);
    msg = msg.replace(/\[Line (\d+), Column (\d+)\]/g, (_m, l, c) => `[line ${Math.max(1, Number(l) - offset)}, col ${c}]`);
    msg = msg.replace(/\(unknown path\)\s*/g, '').replace(/^Template render error:\s*/i, '');
    throw new CompileError(`Jinja error: ${msg.trim()}`);
  }
}

/** Parse the whole project: models, sources, tests, macros, vars. */
export function parseProject(files: ProjectFiles): ParsedProject {
  const errors: string[] = [];
  let projectYml: Dict = {};
  try {
    const loaded = yaml.load(files['dbt_project.yml'] ?? 'name: tidepool');
    projectYml = isDict(loaded) ? loaded : {};
  } catch (e) {
    errors.push(`dbt_project.yml: ${(e as Error).message}`);
  }
  const name = String(projectYml.name ?? 'tidepool');
  const vars = isDict(projectYml.vars) ? projectYml.vars : {};

  const macros = Object.entries(files)
    .filter(([p]) => p.startsWith('macros/') && p.endsWith('.sql'))
    .map(([, c]) => c)
    .join('\n');

  const models = new Map<string, ModelNode>();
  for (const [path, raw] of Object.entries(files)) {
    if (!path.startsWith('models/') || !path.endsWith('.sql')) continue;
    const n = basename(path);
    if (models.has(n)) errors.push(`Two models named '${n}' (${models.get(n)!.path} and ${path}). Model names must be unique.`);
    const fc = folderConfig(projectYml, name, path);
    models.set(n, {
      type: 'model',
      name: n,
      path,
      raw,
      columns: [],
      modelTests: [],
      refs: [],
      sources: [],
      config: { materialized: (fc.materialized as ModelConfig['materialized']) ?? 'view', tags: toList(fc.tags), ...omit(fc, ['materialized', 'tags']) },
      layer: layerOf(path),
    });
  }

  const sources = new Map<string, SourceTable>();
  const tests: GenericTestNode[] = [];
  const unitTests: UnitTestNode[] = [];
  const ymlModelEntries: [string, Dict][] = [];

  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith('models/') || !/\.ya?ml$/.test(path)) continue;
    let doc: unknown;
    try {
      doc = yaml.load(content);
    } catch (e) {
      errors.push(`${path}: YAML error — ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
    if (!isDict(doc)) continue;
    for (const s of (doc.sources as unknown[]) ?? []) {
      if (!isDict(s)) continue;
      const sname = String(s.name);
      for (const t of (s.tables as unknown[]) ?? []) {
        if (!isDict(t)) continue;
        const tname = String(t.name);
        const st: SourceTable = {
          source: sname,
          name: tname,
          schema: String(s.schema ?? sname),
          identifier: String(t.identifier ?? tname),
          description: t.description as string | undefined,
          loadedAtField: (t.loaded_at_field ?? s.loaded_at_field) as string | undefined,
          freshness: (t.freshness ?? s.freshness) as SourceTable['freshness'],
          columns: parseColumns(t.columns),
        };
        sources.set(`${sname}.${tname}`, st);
        for (const c of st.columns) {
          for (const spec of c.tests) {
            const tn = testName(spec, `source_${sname}_${tname}`, c.name);
            tests.push({ type: 'test', id: `test.${tn}`, name: tn, attachedTo: `source:${sname}.${tname}`, column: c.name, spec, dependsOn: depsOf(spec) });
          }
        }
      }
    }
    for (const m of (doc.models as unknown[]) ?? []) {
      if (isDict(m)) ymlModelEntries.push([path, m]);
    }
    for (const u of (doc.unit_tests as unknown[]) ?? []) {
      if (!isDict(u)) continue;
      const given = Array.isArray(u.given) ? u.given.filter(isDict).map((g) => ({ input: String(g.input), rows: (Array.isArray(g.rows) ? g.rows : []).filter(isDict) })) : [];
      const expect = isDict(u.expect) ? { rows: (Array.isArray(u.expect.rows) ? u.expect.rows : []).filter(isDict) } : { rows: [] };
      unitTests.push({ type: 'unit_test', id: `unit_test.${u.name}`, name: String(u.name), model: String(u.model), given, expect, description: u.description as string | undefined });
    }
  }

  for (const [path, m] of ymlModelEntries) {
    const node = models.get(String(m.name));
    if (!node) {
      errors.push(`${path}: properties for model '${m.name}' but no models/**/${m.name}.sql exists.`);
      continue;
    }
    node.description = m.description as string | undefined;
    node.columns = parseColumns(m.columns);
    node.modelTests = ((m.data_tests ?? m.tests ?? []) as unknown[]).map(normaliseTest).filter((t): t is TestSpec => !!t);
    if (isDict(m.config)) Object.assign(node.config, m.config, { tags: [...node.config.tags, ...toList(m.config.tags)] });
    for (const c of node.columns) {
      for (const spec of c.tests) {
        const tn = testName(spec, node.name, c.name);
        tests.push({ type: 'test', id: `test.${tn}`, name: tn, attachedTo: `model:${node.name}`, column: c.name, spec, dependsOn: depsOf(spec) });
      }
    }
    for (const spec of node.modelTests) {
      const tn = testName(spec, node.name);
      tests.push({ type: 'test', id: `test.${tn}`, name: tn, attachedTo: `model:${node.name}`, spec, dependsOn: depsOf(spec) });
    }
  }

  // Parse pass: render each model once to discover refs, sources and inline config().
  for (const node of models.values()) {
    const refs = new Set<string>();
    const srcs: [string, string][] = [];
    for (const m of node.raw.matchAll(/ref\(\s*['"]([\w.]+)['"]\s*\)/g)) refs.add(m[1]);
    try {
      render(node.raw, macros, {
        ref: (r) => {
          refs.add(r);
          return `__ref__${r}`;
        },
        source: (s, t) => {
          srcs.push([s, t]);
          return `__source__${s}_${t}`;
        },
        isIncremental: false,
        thisRelation: `__this__`,
        vars,
        targetSchema: 'dev',
        onConfig: (cfg) => {
          const tags = toList(cfg.tags);
          Object.assign(node.config, cfg, { tags: [...node.config.tags, ...tags] });
        },
      });
    } catch (e) {
      errors.push(`${node.path}: ${(e as Error).message}`);
    }
    node.refs = [...refs];
    node.sources = srcs;
  }

  const singularTests: SingularTestNode[] = Object.entries(files)
    .filter(([p]) => p.startsWith('tests/') && p.endsWith('.sql'))
    .map(([p, raw]) => ({
      type: 'singular_test',
      id: `test.${basename(p)}`,
      name: basename(p),
      path: p,
      raw,
      refs: [...raw.matchAll(/ref\(\s*['"]([\w.]+)['"]\s*\)/g)].map((m) => m[1]),
    }));

  for (const node of models.values()) {
    for (const r of node.refs) {
      if (!models.has(r)) errors.push(`${node.path}: Model '${node.name}' depends on a node named '${r}' which was not found.`);
    }
    for (const [s, t] of node.sources) {
      if (!sources.has(`${s}.${t}`)) errors.push(`${node.path}: Model '${node.name}' depends on a source named '${s}.${t}' which was not found.`);
    }
  }

  return { name, models, sources, tests, singularTests, unitTests, macros, vars, errors };
}

function depsOf(spec: TestSpec): string[] {
  if (spec.kind === 'relationships' && typeof spec.args.to === 'string') {
    const r = refName(spec.args.to);
    return r ? [r] : [];
  }
  return [];
}

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return [v];
  return [];
}

function omit(d: Dict, keys: string[]): Dict {
  const out: Dict = {};
  for (const [k, v] of Object.entries(d)) if (!keys.includes(k)) out[k] = v;
  return out;
}

/** Children map for the model DAG. */
export function childrenOf(project: ParsedProject): Map<string, string[]> {
  const ch = new Map<string, string[]>();
  for (const m of project.models.values()) ch.set(m.name, []);
  for (const m of project.models.values()) for (const r of m.refs) ch.get(r)?.push(m.name);
  return ch;
}

export function descendants(project: ParsedProject, name: string): Set<string> {
  const ch = childrenOf(project);
  const out = new Set<string>();
  const stack = [...(ch.get(name) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    stack.push(...(ch.get(n) ?? []));
  }
  return out;
}

export function ancestors(project: ParsedProject, name: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(project.models.get(name)?.refs ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n)) continue;
    out.add(n);
    stack.push(...(project.models.get(n)?.refs ?? []));
  }
  return out;
}

/** Topological order; throws on cycles. */
export function topoSort(project: ParsedProject, subset?: Set<string>): string[] {
  const names = [...project.models.keys()].filter((n) => !subset || subset.has(n));
  const set = new Set(names);
  const indeg = new Map<string, number>();
  for (const n of names) indeg.set(n, project.models.get(n)!.refs.filter((r) => set.has(r)).length);
  const layerRank = { staging: 0, intermediate: 1, marts: 2, other: 3 };
  const ready = names.filter((n) => indeg.get(n) === 0);
  const out: string[] = [];
  const ch = childrenOf(project);
  const sortReady = () =>
    ready.sort((a, b) => layerRank[project.models.get(a)!.layer] - layerRank[project.models.get(b)!.layer] || a.localeCompare(b));
  sortReady();
  while (ready.length) {
    const n = ready.shift()!;
    out.push(n);
    for (const c of ch.get(n) ?? []) {
      if (!set.has(c)) continue;
      indeg.set(c, indeg.get(c)! - 1);
      if (indeg.get(c) === 0) {
        ready.push(c);
        sortReady();
      }
    }
  }
  if (out.length !== names.length) {
    const stuck = names.filter((n) => !out.includes(n));
    throw new CompileError(`Found a cycle in the DAG involving: ${stuck.join(', ')}`);
  }
  return out;
}
