import type { TheoryModule } from '../types';

export const dbtModule: TheoryModule = {
  id: 'dbt',
  domain: 'dbt',
  title: 'dbt and SQLMesh: transformation frameworks',
  summary:
    'How dbt projects, materialisations, macros, incremental models, snapshots and selectors work, and how SQLMesh approaches the same problems differently.',
  minutes: 26,
  sections: [
    {
      heading: 'Project anatomy: sources, ref and the DAG',
      body: `A dbt project is a folder of SQL \`select\` statements plus YAML. dbt's job is to turn each select into a table or view in the warehouse, in the right order, with tests and docs alongside. The pieces:

- \`dbt_project.yml\`: project name, folder-level configs (Tidepool sets staging and intermediate to views, marts to tables), vars.
- \`models/\`: one \`.sql\` file per model; the file name is the relation name.
- \`models/**/*.yml\`: sources, descriptions, tests, contracts, exposures, semantic models.
- \`macros/\`, \`seeds/\` (small CSVs), \`snapshots/\`, \`tests/\` (singular tests), \`analyses/\` (compiled but never run).
- \`packages.yml\` and \`profiles.yml\` (connection details, usually outside the repo; dbt Cloud stores them in the platform).

Two functions build the dependency graph:

\`\`\`jinja
-- models/staging/stg_shop__orders.sql
select * from {{ source('shop', 'orders') }}     -- a table loaded by the EL tool, declared in YAML

-- models/marts/fct_orders.sql
select * from {{ ref('int_orders__amounts') }}   -- another dbt model
\`\`\`

\`ref\` does three things: it resolves to the right schema for the current target (your dev schema or prod), it records a dependency edge, and with defer it can point at production when the upstream model is not built in your environment. **Never hard-code a schema-qualified table name in a model.** It silently breaks dev/prod separation and lineage.

The resulting **DAG** (directed acyclic graph) is what dbt uses to order execution, to select subsets of the project, and to draw lineage in the docs. A cycle is a compile error. When you run \`dbt compile\`, the Jinja is rendered into plain SQL under \`target/compiled/\`; reading compiled SQL is the first debugging step for any macro problem.

\`dbt parse\` and every run also write **artifacts**: \`manifest.json\` (every node, config and dependency), \`run_results.json\` (timings and statuses), and after \`dbt docs generate\`, \`catalog.json\` (warehouse column types). Slim CI, the docs site, observability tools and MCP servers all read these files.`,
    },
    {
      heading: 'Materialisations',
      body: `A materialisation is the strategy dbt uses to persist a model. Set it in \`dbt_project.yml\` per folder and override per model with \`{{ config(materialized='...') }}\`.

| Materialisation | What dbt creates | Use when | Watch out for |
|---|---|---|---|
| \`view\` | a view | staging and light intermediate models; always fresh, no storage | every query re-runs the logic; stacks of views get slow |
| \`table\` | a table rebuilt in full on every run | marts and anything queried often | rebuild cost grows with data |
| \`incremental\` | a table; first run builds it, later runs insert or merge only new or changed rows | large, append-mostly facts and events | correctness depends on your filter and strategy |
| \`ephemeral\` | nothing: inlined as a CTE into models that ref it | small reusable logic you never query directly | cannot be queried or inspected in the warehouse; hard to debug |
| \`materialized_view\` | a warehouse-managed materialised view (on Snowflake, the equivalent \`dynamic_table\`) | near-real-time aggregates where the platform supports it | feature support and refresh semantics differ per warehouse |

In practice: views in staging, tables in marts, incremental only when a table rebuild is genuinely too slow or too expensive. "Incremental everything" is a common over-engineering mistake. Each incremental model is a small stateful system that can drift from its full-refresh result, and you now own that.

Two other configs worth knowing: \`full_refresh: false\` protects a huge incremental table from an accidental \`--full-refresh\`, and \`persist_docs\` writes your YAML descriptions into warehouse table and column comments, so people using the warehouse UI or a BI tool see them too.`,
    },
    {
      heading: 'Jinja, macros and packages',
      body: `dbt renders every model through Jinja before sending SQL to the warehouse. \`{{ ... }}\` prints an expression, \`{% ... %}\` runs a statement (if, for, set), \`{# ... #}\` is a comment. A **macro** is a reusable Jinja function. Tidepool's project has one:

\`\`\`jinja
{% macro cents_to_dollars(column_name, scale=2) -%}
    round({{ column_name }} / 100.0, {{ scale }})
{%- endmacro %}
\`\`\`

Used as \`{{ cents_to_dollars('shipping_cents') }}\`, it compiles to \`round(shipping_cents / 100.0, 2)\`. The \`-\` in \`{%-\` and \`-%}\` trims whitespace. Loops generate repetitive SQL, such as pivoting payment methods to order grain:

\`\`\`jinja
{% set methods = ['card', 'paypal', 'gift_card', 'bank_transfer'] %}

select
    order_id,
    {% for m in methods %}
    sum(case when payment_method = '{{ m }}' and payment_status = 'success'
             then amount_cents else 0 end) as {{ m }}_paid_cents
    {%- if not loop.last %},{% endif %}
    {% endfor %}
from {{ ref('stg_shop__payments') }}
group by order_id
\`\`\`

You could fetch the list with \`dbt_utils.get_column_values\` instead, but that runs a query at compile time and makes the model's columns depend on the data. A hard-coded list plus an \`accepted_values\` test on \`payment_method\` is more predictable: a new method fails a test instead of silently adding a column.

Judgement on macros: they are great for genuinely repeated logic (unit conversion, standard audit columns, \`generate_schema_name\` overrides that control which schema models land in). They are terrible when they hide simple SQL behind indirection. If a reviewer has to open three macro files to understand a select, inline it.

**Packages** are dbt projects you install with \`dbt deps\` from \`packages.yml\`:

- \`dbt_utils\` (dbt Labs): \`generate_surrogate_key\`, \`date_spine\`, \`star\`, \`union_relations\`, \`pivot\`, plus generic tests such as \`unique_combination_of_columns\`, \`expression_is_true\`, \`accepted_range\` and \`recency\`.
- \`dbt_expectations\`: a large library of Great Expectations-style tests (row counts between, values matching regex, column pair comparisons, distribution checks).
- \`dbt-project-evaluator\` (dbt Labs): lints your DAG and project against best practices: models referencing sources directly from marts, staging models depending on other staging models, missing primary-key tests, undocumented models, naming convention violations. Running it in CI is a cheap way to keep a growing project tidy.
- Adapter-specific and source-specific packages exist too (e.g. for common SaaS sources); check maintenance status before depending on one.`,
    },
    {
      heading: 'Incremental models in depth',
      body: `An incremental model is a table that, after its first build, only processes new or changed rows. The skeleton:

\`\`\`jinja
{{ config(
    materialized='incremental',
    unique_key='event_id',
    incremental_strategy='merge',
    on_schema_change='append_new_columns'
) }}

select event_id, anonymous_id, customer_id, event_name, event_ts, device, _loaded_at
from {{ ref('stg_segment__events') }}

{% if is_incremental() %}
  -- reprocess a window to catch late-arriving rows; the merge on event_id makes it idempotent
  where _loaded_at > (select max(_loaded_at) - interval 3 day from {{ this }})
{% endif %}
\`\`\`

\`is_incremental()\` is true only when the target table already exists, the model is incremental, and you did not pass \`--full-refresh\`. \`{{ this }}\` is the existing target table. On the first run (or a full refresh) the \`where\` disappears and the whole history is built.

Why the three-day lookback? Tidepool's mobile events can arrive days after they happened:

\`\`\`sql run
select
    device,
    count(*)                                                       as events,
    count(*) filter (where _loaded_at - event_ts > interval 1 day) as arrived_over_a_day_late,
    round(max(epoch(_loaded_at) - epoch(event_ts)) / 3600, 1)      as max_delay_hours
from prod.stg_segment__events
group by device
\`\`\`

Filtering on \`event_ts > max(event_ts)\` would permanently miss any event that arrives after a later event was already loaded. Filtering on the load timestamp with a lookback window, and deduplicating via \`unique_key\`, catches them. The lookback must exceed the realistic maximum delay; measure it, as above, instead of guessing.

**Strategies** (availability varies by adapter):

| Strategy | What it does | Needs | Good for |
|---|---|---|---|
| \`append\` | inserts new rows, no dedup | nothing | immutable logs where duplicates are impossible or handled downstream |
| \`merge\` | upserts on \`unique_key\` | a reliable unique key | mutable entities (orders whose status changes); the common default |
| \`delete+insert\` | deletes target rows matching the new batch's keys, then inserts | \`unique_key\` | warehouses where merge is slow or unavailable; replacing whole keys |
| \`insert_overwrite\` | replaces whole partitions (e.g. days) touched by the new data | a partitioned table (BigQuery, Spark/Databricks) | large partitioned facts; cheaper than merge on BigQuery |
| \`microbatch\` (dbt 1.9+) | processes data in time batches by \`event_time\`, each batch replaced independently | \`event_time\`, \`batch_size\`, \`begin\`; optional \`lookback\` | large time-series; easy targeted backfills and retries per batch |

Microbatch deserves a closer look because it removes most of the hand-written \`is_incremental()\` logic:

\`\`\`jinja
{{ config(
    materialized='incremental',
    incremental_strategy='microbatch',
    event_time='event_ts',
    batch_size='day',
    begin='2026-04-01',
    lookback=3
) }}

select * from {{ ref('stg_segment__events') }}   -- dbt adds the batch time filter itself
\`\`\`

dbt runs one query per day, filters upstream models that also declare an \`event_time\`, and you can backfill a range with \`dbt run -s model --event-time-start 2026-05-01 --event-time-end 2026-05-08\`. Note what it filters on: **event time**, so an event arriving later than the lookback window is still missed. Lookback is the late-data dial in either approach.

Other knobs and failure modes:

- \`--full-refresh\` rebuilds from scratch. Do it after changing logic that affects historical rows; an incremental run only applies new logic to new rows, so old and new rows silently disagree.
- \`on_schema_change\`: \`ignore\` (default; new columns are not added), \`append_new_columns\`, \`sync_all_columns\` (also drops removed columns), \`fail\`. None of them backfill values for existing rows; that still needs a full refresh or a targeted backfill.
- \`incremental_predicates\` limit how much of the target a merge scans (e.g. only the last 7 days), a big cost saver on large tables.
- Test incremental models by comparing an incremental build against a full refresh on the same data. If they differ, your filter or key is wrong.`,
    },
    {
      heading: 'Snapshots and seeds',
      body: `**Snapshots** record how mutable source rows change over time, producing an SCD type 2 table. dbt compares the current source with the snapshot table each time \`dbt snapshot\` (or \`dbt build\`) runs and closes and opens versions. Since dbt 1.9 snapshots can be defined in YAML:

\`\`\`yaml
snapshots:
  - name: snap_shop__subscriptions
    relation: source('shop', 'subscriptions')
    config:
      unique_key: id
      strategy: check
      check_cols: [plan, amount_cents, cancelled_at]
\`\`\`

- \`strategy: timestamp\` uses an \`updated_at\` column and is preferred when the source has a trustworthy one. \`strategy: check\` compares listed columns (or \`all\`) and is the fallback.
- dbt adds \`dbt_valid_from\`, \`dbt_valid_to\`, \`dbt_scd_id\` and \`dbt_updated_at\`. The current version has \`dbt_valid_to\` NULL unless you configure a fixed end date.
- Since dbt 1.9 a \`hard_deletes\` option controls whether rows deleted in the source are ignored, invalidated, or recorded as a new version.
- **A snapshot only sees the states that exist when it runs.** If a subscription changes twice between nightly runs, the intermediate state is lost forever. If the source already provides change history (CDC, like Tidepool's \`raw.customers\`), build type 2 from that instead; it is complete and rebuildable.
- Snapshots are stateful and cannot be recreated from source, so never drop one casually, and snapshot raw sources (light or no transformation) rather than models with logic you might change.

**Seeds** are small CSV files in \`seeds/\` loaded with \`dbt seed\`: country-to-region mappings, a channel taxonomy, a list of internal test accounts, a fiscal calendar. They are version-controlled and reviewable, which is their point. They are not for data that changes outside code review or for anything over a few thousand rows; that belongs in a proper source.`,
    },
    {
      heading: 'Running dbt: selectors, build, defer and docs',
      body: `**Selection syntax** (\`-s\` / \`--select\`, \`--exclude\`) is how you run the part of the DAG you care about:

| Selector | Meaning |
|---|---|
| \`fct_orders\` | just that model |
| \`fct_orders+\` | the model and everything downstream |
| \`+fct_orders\` | the model and everything upstream |
| \`2+fct_orders\` | upstream, but only two levels |
| \`@stg_shop__orders\` | the model, its descendants, and all ancestors of those descendants |
| \`tag:finance\` | models tagged \`finance\` |
| \`path:models/marts\` | everything in a folder |
| \`source:shop+\` | everything downstream of the shop source |
| \`config.materialized:incremental\` | all incremental models |
| \`state:modified+\` | models changed versus a reference manifest, plus their descendants |
| \`tag:finance,config.materialized:table\` | intersection (comma); a space means union |

Complex selections can be named in \`selectors.yml\` and run with \`--selector\`.

**\`dbt build\`** runs seeds, snapshots, models and tests together in DAG order, and when a test fails, downstream nodes are skipped. That is the behaviour you want in production and CI: a broken staging model does not feed bad data into marts. \`dbt run\` followed by \`dbt test\` builds everything first and tests afterwards, so bad data has already reached the marts by the time a test complains. \`dbt retry\` re-runs only what failed or was skipped in the previous invocation.

**Defer and Slim CI** (covered in depth in the workflow module): with \`--state path/to/prod-artifacts\`, \`state:modified+\` selects only what your branch changed, and \`--defer\` makes \`ref\` to anything you did not build resolve to the production relation. A PR that changes one staging model then builds and tests only that model and its descendants, reading unchanged parents from prod. The Tidepool app runs your checks exactly this way.

**Docs**: \`dbt docs generate\` compiles the project and queries the warehouse for column metadata, producing \`manifest.json\` and \`catalog.json\`; \`dbt docs serve\` hosts the static site with model pages and the lineage graph. Long descriptions can live in \`{% docs %}\` blocks in Markdown files and be reused with \`doc('name')\`. dbt Cloud provides a hosted catalog on the same metadata. The quality of the docs is the quality of your YAML: describe the grain in every model description and the meaning, unit and additivity of every measure.`,
    },
    {
      heading: 'SQLMesh: plans, virtual environments and change categories',
      body: `SQLMesh is an open-source transformation framework built by Tobiko Data (acquired by Fivetran in 2025). It solves the same problem as dbt, SQL models in a DAG, with a different core idea: **SQLMesh understands your SQL and tracks state.**

**It parses SQL with SQLGlot.** Instead of treating a model as a Jinja template that produces a string, SQLMesh parses each query into an AST. That gives it **column-level lineage** for free, lets it transpile between dialects, and lets it compare two versions of a model semantically rather than as text.

**Plan and apply.** You do not just "run". \`sqlmesh plan dev\` compares your local project with the \`dev\` environment, lists directly and indirectly modified models, shows the SQL diff, and asks what date range to backfill. Applying the plan builds what is needed. \`sqlmesh run\` then processes any missing intervals on each model's cron schedule, because SQLMesh records which time intervals of each model have been processed.

**Change categorisation.** For each directly modified model, SQLMesh classifies the change:

- **Breaking**: downstream models must be rebuilt (e.g. changing a filter or the logic of an existing column).
- **Non-breaking**: only the changed model needs a rebuild (e.g. adding a new column nobody downstream uses yet).
- **Forward-only**: the change applies only to new intervals, with no backfill, for huge tables where reprocessing history is not worth it.

It can infer the category automatically from the column-level analysis, and you can override it.

**Virtual data environments.** Every model version is stored as a physical table named by a fingerprint of its logic. An environment (\`dev\`, \`prod\`, a PR environment) is just a set of views pointing at the right physical tables. Creating a dev environment for an unchanged model costs nothing (the view points at prod's table), and **promoting to prod is a view swap**: the tables you validated in dev become prod without recomputing. Compare that with the typical dbt flow, where CI builds in a temporary schema and production rebuilds the same models again after merge.`,
    },
    {
      heading: 'SQLMesh models, kinds, audits and tests',
      body: `A SQLMesh model is a SQL file with a \`MODEL\` header that carries the config dbt would put in \`config()\` and YAML:

\`\`\`sql
MODEL (
  name tidepool.fct_daily_revenue,
  kind INCREMENTAL_BY_TIME_RANGE (
    time_column order_date,
    lookback 3
  ),
  start '2025-01-01',
  cron '@daily',
  grain order_date,
  audits (
    not_null(columns := (order_date, revenue_usd)),
    unique_values(columns := (order_date))
  )
);

SELECT
  order_date,
  SUM(amount_usd) AS revenue_usd,
  COUNT(*)        AS completed_orders
FROM tidepool.fct_orders
WHERE order_status = 'completed'
  AND order_date BETWEEN @start_ds AND @end_ds
GROUP BY order_date
\`\`\`

Notice there is no \`ref()\`: SQLMesh reads dependencies from the parsed table names. \`@start_ds\` and \`@end_ds\` are macro variables filled per interval; SQLMesh decides which intervals are missing and runs only those.

**Model kinds**:

| Kind | Behaviour | dbt analogue |
|---|---|---|
| \`FULL\` | rebuilt every run | \`table\` |
| \`VIEW\` | a view | \`view\` |
| \`INCREMENTAL_BY_TIME_RANGE\` | processes time intervals, overwrites each interval | \`insert_overwrite\` / \`microbatch\` |
| \`INCREMENTAL_BY_UNIQUE_KEY\` | merges on a key | \`merge\` |
| \`SCD_TYPE_2\` (by time or by column) | maintains valid_from/valid_to history | snapshots |
| \`EMBEDDED\`, \`SEED\`, \`EXTERNAL\` | inlined CTE, CSV seed, external table | \`ephemeral\`, seed, source |

**Audits vs tests.** SQLMesh separates the two clearly:

- **Audits** run against the real data after a model is evaluated, like dbt data tests. By default they are **blocking**: a failing audit stops the plan or run, so bad data is not promoted. Built-ins include \`not_null\`, \`unique_values\`, \`accepted_values\` and \`number_of_rows\`, and you can write your own as SQL that returns failing rows.
- **Tests** are unit tests: YAML files with fixed input rows per upstream model and expected output rows, run by \`sqlmesh test\` (and during plans) without touching production data. They are the equivalent of dbt's unit tests.

SQLMesh can also load an existing dbt project, which is how many teams trial it. Python models and Jinja are supported, but its own macro system (\`@\` syntax, aware of the SQL AST) is the idiomatic choice.`,
    },
    {
      heading: 'dbt vs SQLMesh: a fair comparison',
      body: `| | dbt (Core / Fusion / Cloud) | SQLMesh |
|---|---|---|
| Model definition | SQL + Jinja templates, YAML for config, tests and docs | SQL with a \`MODEL\` header, SQL-aware macros; Python models; can read dbt projects |
| Understanding of SQL | Core renders strings; the Rust Fusion engine (beta since 2025) adds SQL parsing and static analysis | parses every model with SQLGlot from the start |
| Environments | schemas per target; CI builds in a temp schema; prod rebuilds after merge | virtual environments; promotion is a view swap with no recompute |
| State | stateless runs; state comes from comparing manifests (\`state:modified\`) | tracks processed intervals and model versions in a state store |
| Incremental | several strategies including microbatch; you write the filter or configure \`event_time\` | interval-based kinds; the framework computes missing intervals |
| Change impact | \`state:modified+\` (textual/config diff) | breaking vs non-breaking categorisation from column-level analysis |
| Lineage | model-level in Core; column-level in dbt Cloud and Fusion-based tooling | column-level built in |
| Testing | data tests, unit tests (1.8+), contracts | audits (blocking), unit tests |
| Ecosystem | very large: packages, adapters, integrations, community, job market | smaller, growing; strong for teams that want built-in state |
| Semantic layer | dbt Semantic Layer / MetricFlow | none built in; integrates with external tools |

**In practice**: dbt is the industry standard and what most job ads mean by "dbt/SQLMesh". Knowing it deeply is non-negotiable. SQLMesh's ideas (plans, virtual environments, interval tracking, semantic diffs) are worth understanding because they show what dbt workflows approximate with extra tooling, and because with Fivetran owning SQLMesh and announcing a merger with dbt Labs in October 2025, the ideas are likely to keep cross-pollinating. In an interview, a balanced answer beats tribalism: "dbt for ecosystem and hiring; SQLMesh where cost of rebuilds and environment management dominate; the concepts transfer."`,
    },
  ],
  keyTerms: [
    { term: 'ref()', definition: 'The dbt function that references another model, resolving it to the right schema for the target and recording a DAG dependency.' },
    { term: 'source()', definition: 'The dbt function that references a table loaded outside dbt, declared in YAML with optional freshness checks.' },
    { term: 'Materialisation', definition: 'How dbt persists a model: view, table, incremental, ephemeral or materialised view.' },
    { term: 'is_incremental()', definition: 'A macro that is true only when an incremental model already exists and is not being fully refreshed; used to add the new-rows filter.' },
    { term: 'unique_key', definition: 'The column(s) an incremental model uses to merge or delete+insert, making re-processing of overlapping rows idempotent.' },
    { term: 'Lookback window', definition: 'Deliberately reprocessing a recent period on each incremental run so that late-arriving rows are captured.' },
    { term: 'Microbatch', definition: 'A dbt incremental strategy (1.9+) that processes data in independent time batches by event_time, with built-in backfill and retry.' },
    { term: 'Snapshot', definition: 'A dbt resource that records changes to mutable source rows over time as SCD type 2, using a timestamp or check strategy.' },
    { term: 'Graph operators', definition: 'Selection syntax such as model+, +model, n+model and @model for choosing parts of the DAG.' },
    { term: 'Defer', definition: 'Resolving refs to unbuilt models against another environment (usually prod) using its manifest, enabling Slim CI.' },
    { term: 'Virtual data environment', definition: 'SQLMesh environments implemented as views over fingerprinted physical tables, so creating and promoting environments needs no recompute.' },
    { term: 'Breaking change', definition: 'In SQLMesh, a model change that requires downstream models to be rebuilt; contrasted with non-breaking and forward-only changes.' },
    { term: 'Audit (SQLMesh)', definition: 'A data check run against a model\'s real output after evaluation; blocking by default.' },
  ],
  landscape: `**Snapshot as of mid-2026.**

- **dbt Core releases.** dbt 1.8 (2024) added unit tests and renamed model-level \`tests:\` to \`data_tests:\`. dbt 1.9 added the \`microbatch\` incremental strategy and YAML-defined snapshots. dbt 1.10 moved generic test arguments under an \`arguments:\` key, which is the format Tidepool's YAML uses.
- **dbt Fusion.** dbt Labs acquired SDF Labs in January 2025 and announced the Rust-based **dbt Fusion** engine (beta) in May 2025. Fusion parses SQL, so it can catch column and type errors before anything runs, power column-level lineage, and speed up parsing on large projects. Expect stricter validation and a period where some older project patterns need cleanup.
- **Consolidation.** Fivetran acquired Tobiko Data, the company behind SQLMesh and SQLGlot, in 2025, and in October 2025 Fivetran and dbt Labs announced a merger. Both frameworks continue to exist; how their roadmaps converge is still unfolding, so treat specific predictions with caution.
- **Semantic and AI integration.** dbt Labs announced it would open-source MetricFlow under Apache 2.0 and joined Snowflake's Open Semantic Interchange initiative. The dbt MCP server lets LLM agents read project metadata, lineage and the semantic layer, which makes good descriptions and tests directly useful to AI tooling.
- **Lakehouse targets.** With Apache Iceberg as the de-facto open table format, more dbt and SQLMesh projects build into Iceberg tables managed by catalogs such as Apache Polaris or Unity Catalog, and DuckDB (including DuckLake, 2025) is common for local development and CI.`,
  practice: [
    {
      kind: 'mcq',
      id: 'dbt.ref-vs-hardcode',
      domain: 'dbt',
      difficulty: 1,
      title: 'Why ref()?',
      prompt: `A new joiner writes \`select * from prod.stg_shop__orders\` in a mart instead of \`{{ ref('stg_shop__orders') }}\`. It runs fine. Select **all** problems this causes.`,
      options: [
        'In dev, the mart reads prod data instead of the developer\'s own staging model, so their changes are not reflected',
        'dbt does not know about the dependency, so ordering, lineage and selectors like `stg_shop__orders+` miss it',
        'The query will fail in production because dbt rejects schema-qualified names',
        'It makes the model ephemeral',
      ],
      correct: [0, 1],
      explanation: `\`ref\` resolves to the current target's schema and records a DAG edge. A hard-coded name always points at prod, breaking dev/prod isolation, and dbt cannot order the model after its parent, show it in lineage, or select it as a descendant. dbt does not reject schema-qualified names, so nothing fails loudly, which is exactly why this bug survives. Materialisation is unaffected.`,
    },
    {
      kind: 'mcq',
      id: 'dbt.choose-materialization',
      domain: 'dbt',
      difficulty: 1,
      title: 'Pick a materialisation',
      prompt: `\`stg_shop__orders\` renames and deduplicates about a thousand rows and is only read by dbt models. \`fct_orders\` is queried by dashboards dozens of times a day. Which pairing is the sensible default?`,
      options: [
        'stg_shop__orders as a view, fct_orders as a table',
        'Both as incremental models, to minimise compute',
        'stg_shop__orders as a table, fct_orders as a view so it is always fresh',
        'Both ephemeral, to avoid creating objects in the warehouse',
      ],
      correct: [0],
      explanation: `Light staging logic as a view costs no storage and is always current; a frequently queried mart as a table means dashboards read precomputed results. Incremental adds stateful complexity that a small table does not need. A mart as a view re-runs all upstream logic on every dashboard query. An ephemeral mart cannot be queried at all, so dashboards could not use it.`,
    },
    {
      kind: 'mcq',
      id: 'dbt.late-arriving-events',
      domain: 'dbt',
      difficulty: 2,
      title: 'Missing mobile events',
      prompt: `An incremental events model uses \`where event_ts > (select max(event_ts) from {{ this }})\` with the \`append\` strategy. Product analytics reports that mobile event counts in the model are lower than in the raw table for the last few weeks. Mobile events can arrive up to three days late. What is the best fix?`,
      options: [
        'Filter on `_loaded_at` with a lookback window larger than the maximum delay, and switch to `merge` on `event_id` so reprocessed rows do not duplicate',
        'Keep the filter but schedule the job more often',
        'Switch to `delete+insert` without changing the filter',
        'Run `--full-refresh` once to backfill, and keep everything else as is',
      ],
      correct: [0],
      explanation: `A late event whose \`event_ts\` is older than the current max is skipped forever by an event-time high-water mark. Reprocessing a window based on load time catches it, and a unique key with merge makes the overlap idempotent. Running more often does not change the filter logic. Changing strategy alone keeps the broken filter. A full refresh fixes history once, but the gap reappears with the next late event.`,
    },
    {
      kind: 'mcq',
      id: 'dbt.logic-change-incremental',
      domain: 'dbt',
      difficulty: 2,
      title: 'Changing logic in an incremental model',
      prompt: `You change how \`amount_usd\` is calculated in a large incremental \`fct_orders_incremental\` (merge on \`order_id\`, 3-day lookback). After the next scheduled run, which statement is true?`,
      options: [
        'Only orders processed in that run (roughly the last three days) use the new logic; older rows keep the old values until you full-refresh or backfill',
        'dbt detects the SQL change and reprocesses all rows automatically',
        'on_schema_change will rewrite existing rows because the column changed',
        'The merge updates all rows because unique_key covers every order',
      ],
      correct: [0],
      explanation: `An incremental run only touches rows selected by the incremental filter, so history and recent data now disagree. You must plan a \`--full-refresh\` or a targeted backfill. dbt (unlike SQLMesh's breaking-change detection) does not reprocess history when SQL changes. \`on_schema_change\` reacts to added or removed columns, never recomputes values. A merge only updates the keys present in the new batch, not every key in the table.`,
    },
    {
      kind: 'mcq',
      id: 'dbt.strategy-choice',
      domain: 'dbt',
      difficulty: 3,
      title: 'Strategy for a partitioned BigQuery fact',
      prompt: `On BigQuery, \`fct_events\` is partitioned by \`event_date\`, holds billions of rows, and each run recomputes the last three days. Merge runs are scanning far too much. Which approach most directly fixes cost while staying correct for late data?`,
      options: [
        '`insert_overwrite` (or `microbatch` by day with a lookback), replacing only the affected date partitions',
        '`append`, since events are immutable',
        '`merge` with a bigger warehouse slot reservation',
        'Materialise as a view so nothing is stored',
      ],
      correct: [0],
      explanation: `Replacing whole partitions avoids a merge's key comparison against the target and scans only the partitions being rewritten; recomputing the last three days still captures late data. Append would duplicate the three-day overlap on every run. More slots make an expensive operation faster, not cheaper. A view over billions of rows moves the cost onto every query. (On merge, \`incremental_predicates\` restricting the target scan is the other valid lever.)`,
    },
    {
      kind: 'mcq',
      id: 'dbt.build-vs-run-test',
      domain: 'dbt',
      difficulty: 2,
      title: 'build vs run then test',
      prompt: `Production runs \`dbt run && dbt test\`. Last night \`stg_shop__orders\` started producing duplicate \`order_id\`s; the unique test failed, but dashboards had already shown inflated revenue for hours. What change helps most?`,
      options: [
        'Use `dbt build`, which tests each model right after building it and skips downstream nodes when a test fails',
        'Run `dbt test` before `dbt run`',
        'Set the unique test to `severity: warn`',
        'Add `--fail-fast` to `dbt test`',
      ],
      correct: [0],
      explanation: `\`dbt build\` interleaves models and tests in DAG order, so a failing test on staging stops \`fct_orders\` and its dependents from being rebuilt with bad data; dashboards keep yesterday's correct numbers. Testing before running checks yesterday's tables, not the new ones. Downgrading to warn makes the problem less visible. \`--fail-fast\` stops a command at the first failure, but with \`run\` then \`test\` the marts were already rebuilt.`,
    },
    {
      kind: 'mcq',
      id: 'dbt.graph-operators',
      domain: 'dbt',
      difficulty: 1,
      title: 'Select the right nodes',
      prompt: `You changed \`stg_shop__orders\` and want to build it and everything that depends on it, using production tables for anything upstream you did not build. Which command?`,
      options: [
        '`dbt build -s stg_shop__orders+ --defer --state prod-artifacts/`',
        '`dbt build -s +stg_shop__orders --defer --state prod-artifacts/`',
        '`dbt build -s stg_shop__orders`',
        '`dbt build -s @stg_shop__orders --full-refresh`',
      ],
      correct: [0],
      explanation: `\`model+\` selects the model and its descendants; \`--defer\` with a prod manifest makes refs to unselected models (like \`stg_shop__customers\`, which \`fct_orders\` also needs) resolve to prod. \`+model\` selects ancestors, the wrong direction. Selecting the model alone skips the marts you could break. \`@\` also builds every ancestor of the descendants, which is more than needed here, and \`--full-refresh\` rebuilds incrementals from scratch for no reason.`,
    },
    {
      kind: 'mcq',
      id: 'dbt.snapshot-limits',
      domain: 'dbt',
      difficulty: 3,
      title: 'Snapshot or CDC history?',
      prompt: `You need SCD type 2 history of customer country. \`raw.customers\` already contains one row per change (CDC). A colleague proposes a nightly dbt snapshot of \`stg_shop__customers\`. What is the strongest argument against it?`,
      options: [
        'The snapshot only captures the state at each run, misses intermediate changes, cannot be rebuilt if lost, and duplicates history the CDC table already has; build type 2 from CDC instead',
        'Snapshots cannot use the timestamp strategy on staging models',
        'Snapshots only work on sources, never on models',
        'dbt snapshots do not produce valid_from/valid_to columns',
      ],
      correct: [0],
      explanation: `A snapshot is a sampled, stateful record: changes between runs are lost and a dropped snapshot cannot be recreated. When complete change history already exists, deriving type 2 with \`lead()\` over CDC rows is more complete and fully rebuildable. Snapshots can use the timestamp strategy on any relation with a reliable updated_at, can point at models (though snapshotting raw sources is the recommended practice), and do produce \`dbt_valid_from\`/\`dbt_valid_to\`.`,
    },
    {
      kind: 'mcq',
      id: 'dbt.sqlmesh-virtual-env',
      domain: 'dbt',
      difficulty: 3,
      title: 'What does a SQLMesh promotion cost?',
      prompt: `In SQLMesh you changed one model in a \`dev\` environment, ran the plan, backfilled and validated it. You now run \`sqlmesh plan\` against prod with no further changes. What happens to that model?`,
      options: [
        'Prod is pointed at the already-built physical table (a view swap); nothing is recomputed because the model fingerprint matches',
        'SQLMesh rebuilds the model in the prod schema from scratch',
        'SQLMesh copies the dev table into prod with a CREATE TABLE AS',
        'Promotion is not possible; prod must be built by a separate scheduler',
      ],
      correct: [0],
      explanation: `Physical tables are keyed by a fingerprint of the model's logic, and environments are views over them. Promoting the same version reuses the table validated in dev, which is the core benefit of virtual data environments. A rebuild or a copy is what typical dbt deployments do after merge. Prod plans are standard SQLMesh workflow.`,
    },
    {
      kind: 'order',
      id: 'dbt.incremental-change-rollout',
      domain: 'dbt',
      difficulty: 2,
      title: 'Roll out a logic change to an incremental model',
      prompt: `Order the steps for safely changing the revenue logic of a large incremental model in dbt.`,
      steps: [
        'Change the SQL on a branch and add or update a unit test for the new logic',
        'Build the model with --full-refresh in your dev schema and compare it with prod (row counts, totals, sample diffs)',
        'Open a PR; Slim CI builds and tests state:modified+ with defer to prod',
        'Merge and run a planned --full-refresh (or targeted backfill) of the model and its descendants in prod',
        'Tell downstream owners that historical values changed, and why',
      ],
      explanation: `The full refresh in dev proves the new logic works on all history and lets you quantify the change. CI then verifies downstream models. After merge, the production table needs its own full refresh or backfill, because an ordinary incremental run would only apply the new logic to recent rows. Communication closes the loop because historical numbers move.`,
    },
    {
      kind: 'open',
      id: 'dbt.explain-incremental',
      domain: 'dbt',
      difficulty: 2,
      title: 'Explain incremental to a returner',
      prompt: `A teammate who last used dbt in 2022 asks: "Should I make our new \`fct_sessions\` model (about 50 million rows, built from events that can arrive three days late) incremental, and how?" Write your answer.`,
      placeholder: 'Explain whether and how you would make it incremental…',
      minWords: 80,
      rubric: [
        'Justifies incremental by size and rebuild cost, and notes the added complexity and drift risk',
        'Chooses a strategy and key appropriate to sessions (merge or delete+insert on session_id, or microbatch/insert_overwrite by day)',
        'Handles late data with a lookback window at least as long as the maximum delay, and notes that sessions spanning the boundary must be recomputed whole',
        'Mentions is_incremental(), {{ this }}, and when a --full-refresh is needed (logic changes)',
        'Proposes validating incremental output against a full refresh and adding tests (unique session_id)',
      ],
      sampleAnswer: `Yes, at 50 million rows and growing a full rebuild every run is wasteful, but incremental adds state you must manage, so do it deliberately. Sessions are derived from events, so a late event can change a session that already exists: the safest approach is to recompute whole recent days. I would use the microbatch strategy with event_time on the session start, batch_size day and a lookback of 3 (or insert_overwrite by day on BigQuery), or classic merge on session_id with an is_incremental() filter that selects events from the last three days by _loaded_at and rebuilds every session touching them. Sessions crossing the window boundary need care: include events back to the start of any session that has a late event. Add unique and not_null tests on session_id, and compare an incremental build against a full refresh in dev before shipping. When the sessionisation logic changes later, plan a --full-refresh; incremental runs will not rewrite history on their own.`,
    },
  ],
};
