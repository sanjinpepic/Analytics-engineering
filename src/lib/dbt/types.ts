/** Types for the in-browser mini dbt ("dbt-lite"). */

/** A dbt project as a flat map of path -> file contents. */
export type ProjectFiles = Record<string, string>;

export type Materialization = 'view' | 'table' | 'incremental' | 'ephemeral';

export interface ModelConfig {
  materialized: Materialization;
  unique_key?: string | string[];
  incremental_strategy?: 'merge' | 'append' | 'delete+insert';
  tags: string[];
  contract?: { enforced?: boolean };
  /** Anything else passed to config() is kept for display. */
  [key: string]: unknown;
}

export interface ColumnSpec {
  name: string;
  description?: string;
  data_type?: string;
  tests: TestSpec[];
}

export interface TestSpec {
  /** unique | not_null | accepted_values | relationships | dbt_utils.expression_is_true | ... */
  kind: string;
  args: Record<string, unknown>;
  severity: 'error' | 'warn';
  where?: string;
}

export interface ModelNode {
  type: 'model';
  name: string;
  path: string;
  raw: string;
  description?: string;
  columns: ColumnSpec[];
  modelTests: TestSpec[];
  /** filled in by parse */
  refs: string[];
  sources: [string, string][];
  config: ModelConfig;
  layer: 'staging' | 'intermediate' | 'marts' | 'other';
}

export interface SourceTable {
  source: string;
  name: string;
  schema: string;
  identifier: string;
  description?: string;
  loadedAtField?: string;
  freshness?: { warn_after?: { count: number; period: string }; error_after?: { count: number; period: string } };
  columns: ColumnSpec[];
}

export interface GenericTestNode {
  type: 'test';
  id: string;
  name: string;
  /** model or source the test is attached to: "model:fct_orders" | "source:shop.orders" */
  attachedTo: string;
  column?: string;
  spec: TestSpec;
  /** extra model dependencies (e.g. relationships target) */
  dependsOn: string[];
}

export interface SingularTestNode {
  type: 'singular_test';
  id: string;
  name: string;
  path: string;
  raw: string;
  refs: string[];
}

export interface UnitTestNode {
  type: 'unit_test';
  id: string;
  name: string;
  model: string;
  given: { input: string; rows: Record<string, unknown>[] }[];
  expect: { rows: Record<string, unknown>[] };
  description?: string;
}

export interface ParsedProject {
  name: string;
  models: Map<string, ModelNode>;
  sources: Map<string, SourceTable>; // key "source.table"
  tests: GenericTestNode[];
  singularTests: SingularTestNode[];
  unitTests: UnitTestNode[];
  macros: string;
  vars: Record<string, unknown>;
  errors: string[];
}

export type NodeStatus = 'success' | 'error' | 'pass' | 'fail' | 'warn' | 'skipped';

export interface NodeResult {
  id: string;
  name: string;
  kind: 'model' | 'test' | 'unit_test' | 'source_freshness';
  status: NodeStatus;
  message: string;
  failures?: number;
  relation?: string;
  materialized?: Materialization;
  compiledSql?: string;
  ms: number;
}

export interface LogLine {
  at: string;
  text: string;
  tone: 'plain' | 'ok' | 'error' | 'warn' | 'skip' | 'muted' | 'info';
}

export interface RunResult {
  command: string;
  results: NodeResult[];
  log: LogLine[];
  ok: boolean;
  elapsedMs: number;
}
