/** Content model shared by theory practice, the workday, the SQL gym and the exam. */

export type DomainId =
  | 'sql'
  | 'modeling'
  | 'dbt'
  | 'quality'
  | 'semantic'
  | 'warehouse'
  | 'orchestration'
  | 'workflow'
  | 'governance'
  | 'business';

export type Difficulty = 1 | 2 | 3;

interface ItemBase {
  /** Globally unique, stable id (used for progress + reports), e.g. "sql.window-running-total". */
  id: string;
  domain: DomainId;
  difficulty: Difficulty;
  title: string;
  /** Markdown. */
  prompt: string;
  /** Markdown, revealed after answering (practice) or in the report (exam). */
  explanation?: string;
}

export interface McqItem extends ItemBase {
  kind: 'mcq';
  /** Markdown (inline). */
  options: string[];
  /** Indexes of correct options. More than one => multi-select. */
  correct: number[];
}

export interface OrderItem extends ItemBase {
  kind: 'order';
  /** Steps in the CORRECT order; shown shuffled. */
  steps: string[];
}

export interface SqlItem extends ItemBase {
  kind: 'sql';
  starter?: string;
  /** Reference solution; its result set is the answer key. */
  solution: string;
  /** If true the row order must match too. */
  ordered?: boolean;
  /** If true, column names must match the solution's (case-insensitive). */
  checkColumnNames?: boolean;
  hints?: string[];
  /** Relations worth looking at, e.g. ["prod.fct_orders"]. */
  tables?: string[];
}

export interface NumericItem extends ItemBase {
  kind: 'numeric';
  /** SQL that computes the answer (single value); the stored `answer` is only a fallback. */
  solution: string;
  tolerance?: number;
  unit?: string;
  starter?: string;
  hints?: string[];
}

export type DbtCheck =
  | {
      type: 'model-equals';
      /** Model built in the exercise schema. */
      model: string;
      /** Reference SQL (may reference raw.* and prod.*). */
      sql: string;
      checkColumnNames?: boolean;
      label?: string;
    }
  | { type: 'tests-pass'; label?: string; /** substrings of test names that must exist and pass */ require: string[]; /** substrings that must exist and FAIL or WARN (e.g. a test that should catch planted bad rows) */ mustCatch?: string[] }
  | { type: 'build-ok'; label?: string }
  | { type: 'file-matches'; file: string; patterns: string[]; label: string; mustNot?: boolean }
  | { type: 'config'; model: string; key: string; equals: unknown; label: string }
  | { type: 'incremental-equivalence'; model: string; label?: string };

export interface DbtItem extends ItemBase {
  kind: 'dbt';
  /** File overrides applied on top of the reference project; null deletes a file. */
  files: Record<string, string | null>;
  /** File opened in the editor first. */
  openFile: string;
  /** The command the Check button runs, e.g. "dbt build -s stg_shop__orders+". Runs with --defer to prod. */
  command: string;
  checks: DbtCheck[];
  /** Overrides that make every check pass (used by the content verifier and "show solution"). */
  solutionFiles: Record<string, string | null>;
  hints?: string[];
}

export interface OpenItem extends ItemBase {
  kind: 'open';
  /** What a strong answer covers — shown to Claude in the report, and to the learner after submitting in practice. */
  rubric: string[];
  placeholder?: string;
  minWords?: number;
  /** A model answer shown after submitting in practice mode. */
  sampleAnswer?: string;
}

export type Item = McqItem | OrderItem | SqlItem | NumericItem | DbtItem | OpenItem;

export interface TheorySection {
  heading: string;
  /** Markdown. Fenced code blocks: ```sql / ```yaml / ```jinja / ```python / ```bash. A ```sql run block gets a "Run in SQL gym" button. */
  body: string;
}

export interface TheoryModule {
  id: string;
  domain: DomainId;
  title: string;
  /** One sentence. */
  summary: string;
  minutes: number;
  sections: TheorySection[];
  keyTerms: { term: string; definition: string }[];
  /** Markdown: what changed in this area in 2024–2026 (snapshot as of mid-2026). */
  landscape: string;
  practice: Item[];
}
