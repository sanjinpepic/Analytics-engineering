import type { DomainId } from './types';

export interface Domain {
  id: DomainId;
  name: string;
  short: string;
  /** CSS custom property holding the discipline colour. */
  color: string;
  /** Foreground colour that reads on `color`. */
  onColor: string;
  /** What the reference job ad asks for, verbatim-ish. */
  jobAd: string;
  description: string;
}

/** The ten disciplines. Order = order of appearance in the workday. */
export const DOMAINS: Domain[] = [
  {
    id: 'quality',
    name: 'Testing and data contracts',
    short: 'Quality',
    color: 'var(--d-quality)',
    onColor: 'var(--on-d-quality)',
    jobAd: 'Testing; data contracts; modular, tested models',
    description: 'Generic, singular and unit tests, source freshness, model contracts, incident triage.',
  },
  {
    id: 'business',
    name: 'Business translation',
    short: 'Business',
    color: 'var(--d-business)',
    onColor: 'var(--on-d-business)',
    jobAd: 'Strong business acumen; partner with domain teams to codify business logic',
    description: 'Requirements intake, metric definitions, edge cases, stakeholder communication.',
  },
  {
    id: 'sql',
    name: 'SQL',
    short: 'SQL',
    color: 'var(--d-sql)',
    onColor: 'var(--on-d-sql)',
    jobAd: 'Expertise with SQL',
    description: 'Joins, aggregation, window functions, CTEs, dates, deduplication, profiling.',
  },
  {
    id: 'modeling',
    name: 'Dimensional modelling',
    short: 'Modelling',
    color: 'var(--d-modeling)',
    onColor: 'var(--on-d-modeling)',
    jobAd: 'Dimensional modeling; translate domain logic into scalable data structures',
    description: 'Grain, facts and dimensions, SCDs, layered architecture, naming conventions.',
  },
  {
    id: 'dbt',
    name: 'dbt and SQLMesh',
    short: 'dbt',
    color: 'var(--d-dbt)',
    onColor: 'var(--on-d-dbt)',
    jobAd: 'Expertise with dbt, SQLMesh or similar (modeling, testing, macros, docs)',
    description: 'ref/source, materialisations, Jinja & macros, incremental models, packages, SQLMesh concepts.',
  },
  {
    id: 'warehouse',
    name: 'Warehouses, performance and cost',
    short: 'Warehouse',
    color: 'var(--d-warehouse)',
    onColor: 'var(--on-d-warehouse)',
    jobAd: 'Cloud warehouses (Snowflake, BigQuery, Redshift, Databricks); optimise query performance and warehouse cost',
    description: 'Columnar engines, partitioning & clustering, pruning, incremental strategies, cost models.',
  },
  {
    id: 'workflow',
    name: 'Git, CI/CD and conventions',
    short: 'Workflow',
    color: 'var(--d-workflow)',
    onColor: 'var(--on-d-workflow)',
    jobAd: 'Version-controlled practices; GitHub Actions; develop guidelines and conventions',
    description: 'Branching, code review, Slim CI, environments, linting, IaC basics, style guides.',
  },
  {
    id: 'orchestration',
    name: 'ELT and orchestration',
    short: 'Orchestration',
    color: 'var(--d-orchestration)',
    onColor: 'var(--on-d-orchestration)',
    jobAd: 'Modern ELT and orchestration (Airflow, Dagster, Prefect)',
    description: 'EL tools, CDC, scheduling, asset-based orchestration, backfills, late data.',
  },
  {
    id: 'semantic',
    name: 'Metrics, semantic layer and BI',
    short: 'Metrics and BI',
    color: 'var(--d-semantic)',
    onColor: 'var(--on-d-semantic)',
    jobAd: 'Metrics/semantic layers; BI tools (Looker, Tableau, Power BI, Hex, Metabase)',
    description: 'Metric definitions, MetricFlow / LookML concepts, exposures, BI modelling.',
  },
  {
    id: 'governance',
    name: 'Docs, lineage and governance',
    short: 'Governance',
    color: 'var(--d-governance)',
    onColor: 'var(--on-d-governance)',
    jobAd: 'Automate documentation, lineage and governance standards',
    description: 'Documentation, lineage, access & PII, model governance (contracts, versions, groups), AI-readiness.',
  },
];

export const DOMAIN_BY_ID = Object.fromEntries(DOMAINS.map((d) => [d.id, d])) as Record<DomainId, Domain>;
