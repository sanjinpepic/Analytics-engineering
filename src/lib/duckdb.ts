/**
 * DuckDB-WASM wrapper: one in-browser warehouse per tab.
 *
 * Schemas:
 *   raw   — the seeded source tables (what the EL tool loads)
 *   prod  — the reference dbt project, built at start-up ("yesterday's prod")
 *   dev   — the learner's workspace builds (their dbt dev target)
 *   ex_<id> — throwaway schemas for graded exercises
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { generateDataset, toCsv } from './dataset';

export type Cell = string | number | boolean | null;

export interface QueryResult {
  columns: string[];
  types: string[];
  rows: Cell[][];
  elapsedMs: number;
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;
// DuckDB connections are not re-entrant; serialise every statement.
let queue: Promise<unknown> = Promise.resolve();

async function createDb(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
  return db;
}

async function getConn() {
  if (!dbPromise) dbPromise = createDb();
  if (!connPromise) connPromise = dbPromise.then((db) => db.connect());
  return connPromise;
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}

/** Format an Arrow value into a plain JS cell (dates and timestamps become ISO-like strings). */
function toCell(value: unknown, typeName: string): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (/^Date/i.test(typeName) && typeof value === 'number') {
    return new Date(value).toISOString().slice(0, 10);
  }
  if (/^Timestamp/i.test(typeName)) {
    const ms = typeof value === 'number' ? value : Number(value);
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'object' && value !== null && 'toJSON' in value) return JSON.stringify((value as { toJSON(): unknown }).toJSON());
  return String(value);
}

/** Run one or more SQL statements; returns the result of the last one. */
export function query(sql: string): Promise<QueryResult> {
  const run = async () => {
    const conn = await getConn();
    const t0 = performance.now();
    const table = await conn.query(sql);
    const fields = table.schema.fields;
    const columns = fields.map((f) => f.name);
    const types = fields.map((f) => String(f.type));
    const rows: Cell[][] = [];
    const cols = fields.map((_, i) => table.getChildAt(i));
    for (let r = 0; r < table.numRows; r++) {
      rows.push(cols.map((c, i) => toCell(c?.get(r), types[i])));
    }
    return { columns, types, rows, elapsedMs: performance.now() - t0 };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/** Execute without caring about the result. */
export async function exec(sql: string): Promise<void> {
  await query(sql);
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function sqlString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

let warehousePromise: Promise<void> | null = null;

/** Boot DuckDB and load the raw layer (idempotent). The prod build runs separately (see warehouse.ts). */
export function initRawLayer(onProgress?: (msg: string) => void): Promise<void> {
  if (warehousePromise) return warehousePromise;
  warehousePromise = (async () => {
    onProgress?.('Starting DuckDB…');
    const db = await (dbPromise ??= createDb());
    await getConn();
    onProgress?.('Generating Tidepool Coffee Co. data…');
    const ds = generateDataset();
    await exec('create schema if not exists raw; create schema if not exists ingest; create schema if not exists prod; create schema if not exists dev;');
    for (const t of ds.tables) {
      onProgress?.(`Loading raw.${t.name}…`);
      const schema = t.schema ?? 'raw';
      const file = `${schema}_${t.name}.csv`;
      await db.registerFileText(file, toCsv(t));
      const colSpec = t.columns.map((c) => `${sqlString(c.name)}: ${sqlString(c.type)}`).join(', ');
      await exec(
        `create or replace table ${schema}.${t.name} as select * from read_csv(${sqlString(file)}, header = true, columns = {${colSpec}}, timestampformat = '%Y-%m-%d %H:%M:%S', dateformat = '%Y-%m-%d');`,
      );
      const comment = sqlString(t.description);
      await exec(`comment on table ${schema}.${t.name} is ${comment};`);
      for (const c of t.columns) {
        if (c.description) await exec(`comment on column ${schema}.${t.name}.${quoteIdent(c.name)} is ${sqlString(c.description)};`);
      }
    }
  })();
  warehousePromise.catch(() => {
    warehousePromise = null;
  });
  return warehousePromise;
}

export interface ColumnInfo {
  name: string;
  type: string;
  comment: string | null;
}
export interface RelationInfo {
  schema: string;
  name: string;
  kind: 'table' | 'view';
  comment: string | null;
  columns: ColumnInfo[];
}

/** Catalog of every relation in the given schemas. */
export async function listRelations(schemas: string[]): Promise<RelationInfo[]> {
  if (schemas.length === 0) return [];
  const list = schemas.map(sqlString).join(', ');
  const tables = await query(
    `select schema_name, table_name, 'table' as kind, comment from duckdb_tables() where schema_name in (${list})
     union all
     select schema_name, view_name, 'view', comment from duckdb_views() where schema_name in (${list}) and not internal
     order by 1, 2`,
  );
  const cols = await query(
    `select schema_name, table_name, column_name, data_type, comment from duckdb_columns() where schema_name in (${list}) order by schema_name, table_name, column_index`,
  );
  const byRel = new Map<string, ColumnInfo[]>();
  for (const [s, t, c, ty, cm] of cols.rows) {
    const key = `${s}.${t}`;
    if (!byRel.has(key)) byRel.set(key, []);
    byRel.get(key)!.push({ name: String(c), type: String(ty), comment: (cm as string) || null });
  }
  return tables.rows.map(([s, t, k, cm]) => ({
    schema: String(s),
    name: String(t),
    kind: k as 'table' | 'view',
    comment: (cm as string) || null,
    columns: byRel.get(`${s}.${t}`) ?? [],
  }));
}

export async function relationExists(schema: string, name: string): Promise<boolean> {
  const r = await query(
    `select count(*) from (select table_name as n from duckdb_tables() where schema_name = ${sqlString(schema)} union all select view_name from duckdb_views() where schema_name = ${sqlString(schema)}) where n = ${sqlString(name)}`,
  );
  return Number(r.rows[0][0]) > 0;
}

export async function relationKind(schema: string, name: string): Promise<'table' | 'view' | null> {
  const r = await query(
    `select 'table' from duckdb_tables() where schema_name = ${sqlString(schema)} and table_name = ${sqlString(name)}
     union all select 'view' from duckdb_views() where schema_name = ${sqlString(schema)} and view_name = ${sqlString(name)}`,
  );
  return (r.rows[0]?.[0] as 'table' | 'view') ?? null;
}

/** Drop a schema and everything in it (used to reset exercise sandboxes). */
export async function resetSchema(schema: string): Promise<void> {
  await exec(`drop schema if exists ${quoteIdent(schema)} cascade; create schema ${quoteIdent(schema)};`);
}
