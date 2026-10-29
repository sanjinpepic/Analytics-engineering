import type { TheoryModule } from '../types';

export const orchestrationModule: TheoryModule = {
  id: 'orchestration',
  domain: 'orchestration',
  title: 'ELT and orchestration',
  summary:
    'How data gets from source systems into the warehouse, how CDC and late data behave, and how orchestrators like Airflow, Dagster and dbt jobs run the nightly pipeline reliably.',
  minutes: 24,
  sections: [
    {
      heading: 'ETL vs ELT, and where the AE sits',
      body: `**ETL** transformed data *before* loading it, on a separate server, because warehouse compute was expensive and fixed. **ELT** loads raw data first and transforms it *inside* the warehouse with SQL, because cloud warehouses made compute elastic and storage cheap.

ELT changed the job: the raw copy is always there, transformations are versioned SQL (dbt, SQLMesh), and you can rebuild history when logic changes. That is why analytics engineering exists as a role.

The modern pipeline has three layers:

| Layer | Job | Typical tools |
|---|---|---|
| **EL (extract-load)** | Copy source data into \`raw\` with minimal change | Fivetran, Airbyte, dlt, Stitch, warehouse-native connectors, custom Go/Python jobs |
| **T (transform)** | Clean, model, test, document | dbt, SQLMesh |
| **Activation / reverse ETL** | Push modelled data back into operational tools | Census, Hightouch, custom syncs |

An orchestrator (Airflow, Dagster, Prefect, dbt platform jobs) sits across all three and decides *what runs when, in what order, and what happens on failure*.

In practice, AEs rarely own the EL infrastructure, but you must understand how it behaves, because nearly every "the numbers are wrong" incident starts with a load that was late, duplicated or partial.`,
    },
    {
      heading: 'EL tools and change data capture',
      body: `**Managed EL (Fivetran, Stitch, Airbyte Cloud):** connectors maintained by the vendor, usage-based pricing (Fivetran prices on rows changed per month, so a noisy table can get expensive). **Open source / code-first:** Airbyte OSS, **dlt** (a Python library: you write a small pipeline, it handles schema inference, incremental state and loading). **Warehouse-native:** BigQuery Data Transfer Service, Snowflake and Databricks connectors. **Custom:** at a Go/Rust shop, product engineers may write events straight to Pub/Sub, Kinesis or object storage.

**Change data capture (CDC)** is how you copy only what changed.

| | Cursor-based (query-based) | Log-based |
|---|---|---|
| How | \`select * where updated_at > last_cursor\` | Read the database's replication log (Postgres WAL, MySQL binlog) |
| Catches hard deletes | No (a deleted row simply stops appearing) | Yes (delete events are in the log) |
| Catches intermediate states | No, only the latest at sync time | Yes, every change |
| Source load | Queries the source | Light, reads the log |
| Pitfall | Rows whose \`updated_at\` is not bumped are missed | Needs replication permissions, log retention |

**Metadata columns you will see:** \`_loaded_at\` / \`_fivetran_synced\` (when the row landed), \`_fivetran_deleted\` or \`_ab_cdc_deleted_at\` (**soft deletes**: the tool marks the row rather than removing it). Your staging model decides whether deleted rows are filtered out or kept with an \`is_deleted\` flag.

**Re-delivery and idempotency.** EL tools are *at-least-once*: after a retry or a resync, the same row can arrive twice. Tidepool's \`raw.orders\` has exactly this:

\`\`\`sql run
select id, count(*) as copies, min(_loaded_at) as first_load, max(_loaded_at) as last_load
from raw.orders
group by id
having count(*) > 1
order by copies desc, id
limit 10;
\`\`\`

The staging model must deduplicate deterministically, keeping the latest version:

\`\`\`sql run
select *
from raw.orders
qualify row_number() over (partition by id order by _loaded_at desc) = 1
limit 20;
\`\`\`

**Schema drift and resyncs.** Sources change without warning: a column is renamed, an enum gains a value, a JSON field changes type. Most EL tools add new columns automatically and keep renamed ones as new columns, so the old column quietly goes null. Defend in staging: select columns explicitly, cast types, and test accepted values on enums so a new \`status\` value fails loudly instead of disappearing from a \`case\` statement. When a connector does a **full resync** (after a schema change or a broken cursor), expect a burst of re-delivered rows and \`_loaded_at\` values that no longer mean "when it changed". Incremental models filtering on \`_loaded_at\` will reprocess everything, which is correct but expensive, so warn the platform team before triggering one on a large table.

**Reverse ETL** syncs modelled tables (e.g. \`dim_customers\` with LTV and churn risk) into CRMs, ad platforms or support tools. Treat those syncs as production consumers: contracts, tests and ownership apply, and a bad sync can email the wrong customers.`,
    },
    {
      heading: 'Orchestration concepts',
      body: `Every orchestrator implements the same handful of ideas. Learn them once:

- **DAG (directed acyclic graph):** tasks plus dependencies; no cycles.
- **Schedules vs triggers:** a **time schedule** (cron, "daily at 02:00 UTC") versus **event / data-aware triggers** (run when an upstream asset updates, a file lands, or a webhook fires). Data-aware is better when upstream timing varies.
- **Sensors:** tasks that wait for a condition (file exists, partition landed, upstream job succeeded). Use timeouts so a sensor cannot block forever.
- **Retries:** with backoff, for transient failures (network blips, warehouse throttling). Do not retry deterministic failures like a failed test five times.
- **Idempotency:** running a task twice with the same inputs leaves the same result. \`merge\` on a unique key or \`insert overwrite\` of a partition are idempotent; blind \`insert into\` is not.
- **Backfills:** re-running a pipeline for past intervals (e.g. every day of March) after a logic fix or an outage. Requires tasks parameterised by interval, not by "now".
- **SLAs / freshness targets:** "\`fct_orders\` is updated by 06:00 UTC" with alerting when it is missed.
- **Concurrency and pools:** limits so a backfill does not saturate the warehouse.

Interview pitfall: describing a pipeline that uses \`current_date\` inside tasks. That makes backfills impossible. Tasks should take the logical interval (\`data_interval_start\` in Airflow, the partition key in Dagster) as input.`,
    },
    {
      heading: 'Airflow, Dagster and Prefect',
      body: `**Apache Airflow** is the incumbent: Python-defined DAGs of **tasks** built from **operators** (BashOperator, provider operators for every cloud) or the TaskFlow \`@task\` decorator, with explicit dependencies (\`a >> b\`). It is task-centric: Airflow knows tasks ran, not what data they produced. **Airflow 3.0** (April 2025) added DAG versioning, a new UI, and renamed datasets to **assets** for data-aware scheduling. Managed options include Astronomer, Google Cloud Composer and Amazon MWAA.

\`\`\`python
# Airflow 3-style DAG: load, then build dbt, then refresh BI
from datetime import datetime
from airflow.sdk import dag, task
from airflow.providers.standard.operators.bash import BashOperator

@dag(schedule="0 2 * * *", start_date=datetime(2026, 1, 1), catchup=False,
     default_args={"retries": 2})
def tidepool_nightly():
    @task
    def trigger_el_sync():
        ...  # call the EL tool's API and wait for the sync to finish

    dbt_build = BashOperator(
        task_id="dbt_build",
        bash_command="dbt build --target prod --select tag:nightly",
    )

    @task
    def refresh_bi_cache():
        ...  # call the BI tool's API to refresh extracts / caches

    trigger_el_sync() >> dbt_build >> refresh_bi_cache()

tidepool_nightly()
\`\`\`

**Dagster** is **asset-centric**: you declare **software-defined assets** (tables, files, models) and their dependencies, and Dagster works out what to run. It has first-class **partitions** (daily, by region) for backfills, **asset checks** for data quality, and **dagster-dbt**, which turns every dbt model into a Dagster asset so lineage spans EL, dbt and downstream Python.

\`\`\`python
from dagster import AssetExecutionContext, DailyPartitionsDefinition, asset, asset_check, AssetCheckResult
from dagster_dbt import DbtCliResource, DbtProject, dbt_assets

tidepool = DbtProject(project_dir="tidepool_dbt")
daily = DailyPartitionsDefinition(start_date="2026-01-01")

@asset(partitions_def=daily, group_name="ingest")
def raw_fx_rates(context: AssetExecutionContext) -> None:
    day = context.partition_key  # load exactly one day: idempotent and backfillable
    ...

@asset_check(asset=raw_fx_rates)
def fx_rates_not_empty() -> AssetCheckResult:
    row_count = 1  # in reality: query the warehouse
    return AssetCheckResult(passed=row_count > 0)

@dbt_assets(manifest=tidepool.manifest_path)
def tidepool_dbt_models(context: AssetExecutionContext, dbt: DbtCliResource):
    yield from dbt.cli(["build"], context=context).stream()
\`\`\`

**Prefect** is the most Pythonic: decorate ordinary functions with \`@flow\` and \`@task\`, get retries, caching and observability with little ceremony. Good for teams that mostly write Python scripts and want them to become reliable.

| | Airflow | Dagster | Prefect |
|---|---|---|---|
| Mental model | Tasks and schedules | Assets and their freshness | Python functions as flows |
| dbt integration | Bash/Cosmos-style operators | dagster-dbt (model = asset) | prefect-dbt / shell tasks |
| Strength | Ubiquity, ecosystem | Lineage, partitions, asset checks | Low ceremony |

In practice: whichever the employer uses, explain how you would make dbt runs idempotent, observable and backfillable in it.`,
    },
    {
      heading: 'Orchestrating dbt',
      body: `Two common anti-patterns: one giant \`dbt run\` with tests in a separate later step (bad data reaches marts before tests fail), and one orchestrator task per model (huge DAGs, slow scheduling). Better:

- **Use \`dbt build\`**, which runs models, tests, seeds and snapshots in DAG order and **skips downstream models when an upstream test fails**.
- **Split jobs by \`--select\`**, not by copying SQL: \`dbt build --select tag:hourly\`, \`--select +exposure:weekly_exec_dashboard\`, \`--select marts.finance+\`.
- **State-aware runs:** compare against production artifacts (\`manifest.json\`) and build only what changed, e.g. \`--select state:modified+ --defer --state prod-artifacts/\`. This is the core of Slim CI (see the workflow module), and the dbt platform has added state-aware orchestration in production jobs as well.
- **Source freshness first:** \`dbt source freshness\` (or a freshness check in the orchestrator) before building, so a stale upstream fails loudly rather than producing a "successful" run on old data.
- **dbt Cloud / dbt platform jobs:** deploy jobs on a schedule or triggered by another job's completion, CI jobs on pull requests, environment-level variables and credentials. Fine for dbt-only pipelines; use an external orchestrator when you need to coordinate EL, dbt, ML and BI together.

\`\`\`yaml
# models/marts/_marts__exposures.yml: lets you select everything a dashboard needs
exposures:
  - name: weekly_exec_dashboard
    type: dashboard
    owner: { name: Analytics, email: analytics@tidepool.example }
    depends_on:
      - ref('fct_orders')
      - ref('dim_customers')
\`\`\``,
    },
    {
      heading: 'Late-arriving data and lookback windows',
      body: `Data does not arrive in event-time order. Tidepool's mobile app buffers events offline and uploads them days later:

\`\`\`sql run
select
  device,
  count(*) as events,
  round(avg(date_diff('hour', event_ts, _loaded_at)), 1) as avg_hours_late,
  max(date_diff('hour', event_ts, _loaded_at)) as max_hours_late
from raw.events
group by device
order by max_hours_late desc;
\`\`\`

If an incremental model only picks up rows with \`event_ts > max(event_ts) in target\`, any event that arrives after a later event was processed is **lost forever**. Two fixes:

1. **Filter on load time, not event time:** \`where _loaded_at > (select max(_loaded_at) from {{ this }})\`. Catches every new arrival, but daily aggregates for past days must then be recomputed.
2. **Lookback window:** reprocess the last N days of event time on every run, with a \`merge\` on \`event_id\` or \`insert overwrite\` of those partitions so reprocessing is idempotent. Choose N from the data (the query above), not from a guess.

Either way, **communicate it**: dashboards for the last few days are provisional. Add a note to the dashboard, and consider a test that compares incremental output with a periodic full rebuild.

The same thinking applies to **FX rates** (no weekend rows: carry forward the last business day), **refunds** (arrive weeks after the order) and **subscription cancellations** (backdated). Ask for every source: *can a record about the past arrive today?*`,
    },
    {
      heading: 'Failure handling and on-call in practice',
      body: `Pipelines fail. What separates a mature team is how predictable the failure is.

**Classify failures before you alert on them:**

| Failure | Example | Response |
|---|---|---|
| Transient | Warehouse throttled, API timeout, network blip | Automatic retry with backoff; alert only after the last retry |
| Upstream data late | EL sync still running at 02:00 | Sensor waits up to a deadline; then warn, do not build on stale data |
| Data quality | \`unique\` test fails on \`fct_orders.order_id\` | No retry; downstream skipped; page the owner with the failing rows query |
| Code / config | A deploy broke compilation | No retry; revert or hotfix; the deploy pipeline should have caught it |

**Test severity is a routing decision.** \`severity: error\` stops dependants and pages someone; \`severity: warn\` posts to a channel and lets the run continue. Use error for things that make numbers wrong (duplicated keys, broken joins, missing currency rates) and warn for things worth a look (a small rise in null \`utm_source\`). If a warning has fired every day for a month, either fix it or delete it: alert fatigue is how real incidents get missed.

**Runbooks.** For each critical model, a short note: what it feeds, who to tell, how to rerun a single partition, how to check the source. The person on call at 06:30 is rarely the author.

**Rerun only what failed.** \`dbt retry\` re-runs the nodes that errored or were skipped in the previous invocation; orchestrators let you clear a failed task and its downstream. Rerunning the whole nightly job because one mart failed wastes an hour and warehouse credits.

In practice, track two numbers per month: how often the freshness SLA was missed, and how many incidents were found by stakeholders before the data team. The second should trend to zero.`,
    },
    {
      heading: 'Freshness SLAs and the nightly pipeline end to end',
      body: `A freshness SLA is a promise in business terms: "Yesterday's orders are in the exec dashboard by 07:00 London time on business days." Work backwards from it to schedule times, and alert *before* the promise is broken.

\`\`\`yaml
# models/staging/shop/_shop__sources.yml
sources:
  - name: shop
    schema: raw
    loaded_at_field: _loaded_at
    freshness:
      warn_after: { count: 6, period: hour }
      error_after: { count: 24, period: hour }
    tables:
      - name: orders
      - name: customers
\`\`\`

A typical Tidepool night:

| Time (UTC) | Step | On failure |
|---|---|---|
| 01:00 | EL syncs (shop DB via CDC, Segment events, ad spend, FX) | Retry with backoff; alert #data-alerts after final failure |
| 02:00 | \`dbt source freshness\` | Error stops the run; warn posts to Slack |
| 02:10 | \`dbt build --select tag:nightly\` (models + tests in DAG order) | Failed tests skip dependents; error tests page the on-call AE |
| 03:00 | BI cache / extract refresh (Looker PDTs, Tableau extracts) | Dashboards keep yesterday's data; status note posted |
| 03:15 | Reverse ETL syncs to CRM | Do not sync if upstream tests failed |
| 03:20 | Summary to Slack: run status, row counts, warnings, runtime | |

What makes this production-grade: each step is idempotent, the BI refresh depends on dbt success (not on the clock), alerts go to a channel with an owner, and run metadata (durations, row counts, test results) is shipped to observability tooling such as Grafana so you can see a model getting slower week by week.`,
    },
  ],
  keyTerms: [
    { term: 'ELT', definition: 'Extract and load raw data first, then transform it inside the warehouse with versioned SQL.' },
    { term: 'CDC', definition: 'Change data capture: replicating only inserts, updates and deletes from a source, via cursors or the database log.' },
    { term: 'Log-based CDC', definition: 'Reading the database replication log (WAL/binlog); captures hard deletes and every intermediate change.' },
    { term: 'Soft delete', definition: 'A row marked deleted with a flag or timestamp column instead of being removed.' },
    { term: 'At-least-once delivery', definition: 'A guarantee that every record arrives, possibly more than once; downstream must deduplicate.' },
    { term: 'Idempotent task', definition: 'A task that produces the same end state no matter how many times it runs for the same input interval.' },
    { term: 'Backfill', definition: 'Re-running a pipeline for historical intervals after a fix, outage or new model.' },
    { term: 'Sensor', definition: 'An orchestrator task that waits for a condition such as a file landing or an upstream job finishing.' },
    { term: 'Software-defined asset', definition: 'Dagster concept: a declared data object (table, model) with its dependencies and the code that produces it.' },
    { term: 'Lookback window', definition: 'Reprocessing the most recent N days on each incremental run to capture late-arriving data.' },
    { term: 'Freshness SLA', definition: 'A promise about how up to date a dataset is, monitored with source freshness checks and alerts.' },
    { term: 'Reverse ETL', definition: 'Syncing modelled warehouse data back into operational tools such as CRMs and ad platforms.' },
    { term: 'dbt build', definition: 'Runs models, tests, seeds and snapshots in DAG order, skipping dependents of failed tests.' },
  ],
  landscape: `*Snapshot as of mid-2026.*

- **Airflow 3.0 shipped in April 2025**, the biggest release in years: DAG versioning, a rebuilt UI, and "datasets" renamed to **assets**, nudging Airflow towards the data-aware, asset-centric model Dagster popularised.
- **Asset-centric orchestration went mainstream.** Dagster's asset model, partitions and asset checks influenced the whole category; "what data is stale?" increasingly replaces "which task failed?".
- **Consolidation of the modern data stack.** Fivetran acquired Census (reverse ETL) and Tobiko Data (SQLMesh) in 2025, and Fivetran and dbt Labs announced a merger in October 2025. Expect EL, transformation and activation to be bundled, and vendor choice to matter less than design skills.
- **dbt's engine and orchestration changed.** dbt Labs announced the Rust-based **dbt Fusion** engine (beta) in May 2025 after acquiring SDF Labs, alongside state-aware orchestration that skips models whose inputs have not changed.
- **Code-first EL grew.** Python libraries such as dlt became a common alternative to managed connectors for long-tail sources, and warehouses kept adding native connectors.
- **AI in pipelines.** LLM-assisted code generation and agents that read orchestration metadata (often via MCP servers) became common, which raises the value of well-named, well-documented assets.`,
  practice: [
    {
      kind: 'mcq',
      id: 'orchestration.cdc-hard-deletes',
      domain: 'orchestration',
      difficulty: 2,
      title: 'Deleted customers still showing',
      prompt: `Tidepool's customers table is replicated with cursor-based CDC (\`updated_at > last_cursor\`). Customers deleted in the app (GDPR requests) still appear in \`dim_customers\` months later. Why?`,
      options: [
        'Cursor-based CDC cannot see hard deletes: a deleted row simply stops being returned, so the warehouse keeps the last version',
        'dbt caches old rows in views',
        'The EL tool is re-delivering the rows every day',
        'The staging model is missing a `distinct`',
      ],
      correct: [0],
      explanation: `Query-based CDC only sees rows that still exist and have a newer \`updated_at\`. Hard deletes are invisible. Fixes: log-based CDC (delete events come through, usually as soft-delete flags), periodic full re-syncs, or an app-side soft delete. Views don't cache; re-delivery creates duplicates, not survival of deleted rows; \`distinct\` would not remove a row that should not exist.`,
    },
    {
      kind: 'mcq',
      id: 'orchestration.idempotent-task',
      domain: 'orchestration',
      difficulty: 1,
      title: 'Which load is idempotent?',
      prompt: 'A daily task loads FX rates for its logical date. Which implementation is idempotent if the task is retried?',
      options: [
        '`insert into fx_rates select ... where rate_date = :logical_date`',
        'Delete rows for `:logical_date` then insert them, in one transaction (or `insert overwrite` that partition)',
        '`insert into fx_rates select ... where rate_date = current_date`',
        'Append to a CSV in object storage each run',
      ],
      correct: [1],
      explanation: `Replacing exactly the interval's rows gives the same end state however many times it runs. Plain \`insert into\` duplicates on retry. Using \`current_date\` breaks both retries after midnight and backfills. Appending to a file duplicates too.`,
    },
    {
      kind: 'mcq',
      id: 'orchestration.late-mobile-events',
      domain: 'orchestration',
      difficulty: 2,
      title: 'Missing mobile sessions',
      prompt: `An incremental \`fct_events\` model filters \`where event_ts > (select max(event_ts) from {{ this }})\`. Product says mobile conversion looks permanently low for past days. Which changes fix it? Select all that apply.`,
      options: [
        'Filter on `_loaded_at` instead of `event_ts`, so every newly arrived row is picked up',
        'Reprocess a lookback window of the last N days of `event_ts`, merging on `event_id`',
        'Switch the schedule from daily to hourly',
        'Add `distinct` to the final select',
      ],
      correct: [0, 1],
      explanation: `Late mobile events have an \`event_ts\` older than the current max, so the filter drops them forever. Filtering on load time or reprocessing a lookback window (with an idempotent merge) captures them. Running more often makes it worse: the max moves forward faster. \`distinct\` addresses duplicates, not missing rows.`,
    },
    {
      kind: 'mcq',
      id: 'orchestration.dbt-build-vs-run',
      domain: 'orchestration',
      difficulty: 1,
      title: 'run then test',
      prompt: 'Your nightly job runs `dbt run` and then `dbt test`. Why do many teams switch to `dbt build`?',
      options: [
        '`dbt build` runs faster because it skips tests',
        '`dbt build` interleaves tests with models in DAG order and skips downstream models when an upstream test fails, so bad data does not propagate',
        '`dbt build` deploys to production automatically',
        '`dbt build` is required for incremental models',
      ],
      correct: [1],
      explanation: `With run-then-test, all marts are already rebuilt with bad data before any test fails. \`build\` tests each node right after building it and skips dependents of failures. It does not skip tests, deploy anything or relate to incremental models specifically.`,
    },
    {
      kind: 'mcq',
      id: 'orchestration.airflow-vs-dagster',
      domain: 'orchestration',
      difficulty: 2,
      title: 'Task-centric vs asset-centric',
      prompt: 'What is the key conceptual difference between classic Airflow DAGs and Dagster software-defined assets?',
      options: [
        'Airflow only supports SQL; Dagster only supports Python',
        'Airflow models tasks and their order; Dagster models the data assets produced and their dependencies, so it can reason about which data is stale',
        'Dagster cannot run on a schedule',
        'Airflow cannot retry failed tasks',
      ],
      correct: [1],
      explanation: `Airflow is fundamentally about tasks (though Airflow 3 assets move it towards data awareness); Dagster starts from the data. Both run Python and SQL, both schedule, both retry.`,
    },
    {
      kind: 'mcq',
      id: 'orchestration.bi-refresh-dependency',
      domain: 'orchestration',
      difficulty: 2,
      title: 'Dashboards refreshed too early',
      prompt: `The BI extract refresh is scheduled at 03:00 because dbt "usually finishes by 02:45". Twice this month the dashboards showed half-updated numbers. What is the best fix?`,
      options: [
        'Move the BI refresh to 04:00 to leave more buffer',
        'Trigger the BI refresh from the orchestrator only after the dbt build (and its tests) succeed',
        'Make the dbt warehouse bigger so it always finishes by 02:45',
        'Refresh the BI tool every 15 minutes',
      ],
      correct: [1],
      explanation: `Time-based coupling breaks whenever runtime varies. A dependency (or a data-aware trigger) guarantees order and lets you skip the refresh when tests fail. More buffer and a bigger warehouse reduce the frequency but not the failure mode; constant refreshes cost money and still race.`,
    },
    {
      kind: 'mcq',
      id: 'orchestration.backfill-design',
      domain: 'orchestration',
      difficulty: 3,
      title: 'Backfilling a logic fix',
      prompt: `You fixed currency conversion in a daily-partitioned \`fct_orders\` and must rebuild 18 months. Which practices matter most? Select all that apply.`,
      options: [
        'Tasks take the partition / logical date as input rather than calling `current_date`',
        'Each partition write is idempotent (overwrite or merge), so failed days can be safely retried',
        'Limit backfill concurrency (pools / max active runs) so production runs and BI are not starved',
        'Disable tests during the backfill to make it faster',
      ],
      correct: [0, 1, 2],
      explanation: `Parameterised, idempotent tasks with bounded concurrency make backfills safe and repeatable. Disabling tests is exactly when you need them most: you are rewriting history that finance has already seen. Reconcile totals before and after and communicate the change.`,
    },
    {
      kind: 'order',
      id: 'orchestration.nightly-pipeline-order',
      domain: 'orchestration',
      difficulty: 1,
      title: 'Order the nightly pipeline',
      prompt: 'Put the steps of a nightly pipeline in the correct order.',
      steps: [
        'EL tools sync source data into raw',
        'Check source freshness',
        'dbt build models and tests in DAG order',
        'Refresh BI caches / extracts',
        'Run reverse ETL syncs to operational tools',
        'Post run summary and alerts to Slack',
      ],
      explanation: `Load, verify the inputs are fresh, transform and test, then publish to consumers (BI first, then operational syncs that should not run on failed data), then report. Each publish step depends on the previous step succeeding.`,
    },
    {
      kind: 'mcq',
      id: 'orchestration.redelivery-dedup',
      domain: 'orchestration',
      difficulty: 1,
      title: 'Duplicated orders in raw',
      prompt: '`raw.orders` contains some order ids twice with different `_loaded_at` and sometimes a newer status. What should the staging model do?',
      options: [
        'Use `select distinct *`',
        'Keep one row per `id`, the one with the latest `_loaded_at`, using `row_number()` (e.g. with `qualify`)',
        'Keep the earliest row, since it was the original',
        'Ask the EL vendor to fix it and do nothing in the meantime',
      ],
      correct: [1],
      explanation: `\`distinct *\` does not remove versions that differ in status or \`_loaded_at\`. The earliest row has the stale status. Re-delivery is normal at-least-once behaviour, so staging should deduplicate deterministically on the latest load, and a uniqueness test on \`order_id\` guards it.`,
    },
    {
      kind: 'open',
      id: 'orchestration.design-freshness',
      domain: 'orchestration',
      difficulty: 3,
      title: 'Design for a freshness promise',
      prompt: `The CEO wants "yesterday's revenue by channel" on the exec dashboard by 07:00 London time every day. Sources: shop database (CDC via Fivetran), Segment events (mobile can be days late), ad spend (API, lands around 04:00 UTC), FX rates (business days only). Describe how you would orchestrate and monitor this so the promise is kept, and what you would tell the CEO about the numbers.`,
      rubric: [
        'Works backwards from the SLA with explicit steps (EL, freshness checks, dbt build, BI refresh) and dependencies rather than fixed clock times',
        'Uses source freshness / sensors on ad spend and shop data, with alerting before 07:00 to a named owner',
        'Handles late mobile events with a lookback window or load-time filter and marks recent days as provisional',
        'Handles FX gaps (carry forward last business day) and timezone (London day boundaries vs UTC)',
        'Makes tasks idempotent and retryable; BI refresh only after tests pass',
        'Sets expectations with the CEO about provisional numbers and what happens on failure',
      ],
      sampleAnswer: `Work back from 07:00 London. EL syncs from 03:00 UTC; a sensor waits for the ad spend load (with a timeout at 05:30) and dbt source freshness checks shop and Segment. Then dbt build --select +exposure:exec_dashboard runs models and tests in order; the BI refresh is triggered only on success. If anything fails or is still waiting at 05:30, the on-call AE gets a Slack alert, leaving time to fix or post a status note on the dashboard. Revenue days are defined in Europe/London, not UTC. FX uses the last available business-day rate for weekends. Mobile events can land days late, so the events model reprocesses a 3-day lookback with a merge on event_id, and channel attribution for the last 3 days is labelled provisional. Every task is idempotent so retries and backfills are safe. To the CEO: yesterday's revenue total is final barring refunds; channel split may shift slightly for a few days as mobile data arrives; if the data is late you will see a banner rather than wrong numbers.`,
      minWords: 90,
      placeholder: 'Schedule, dependencies, checks, alerts, and what you tell the CEO...',
    },
  ],
};
