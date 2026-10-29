import type { TheoryModule } from '../types';

export const warehouseModule: TheoryModule = {
  id: 'warehouse',
  domain: 'warehouse',
  title: 'Warehouses, performance and cost',
  summary:
    'How cloud warehouses store and execute analytical queries, how the big four differ, and the habits that keep your models fast and your bill boring.',
  minutes: 24,
  sections: [
    {
      heading: 'OLTP vs OLAP: why the warehouse is shaped differently',
      body: `Your product database (Postgres, MySQL, DynamoDB) is **OLTP**: lots of tiny reads and writes, each touching one or a few rows, with strict transactional guarantees. It stores data **row by row** because "fetch order 4812 with all its fields" is the common question.

A warehouse is **OLAP**: few, large queries that touch millions of rows but only a handful of columns ("revenue by country by week"). Four design choices follow from that workload:

| Idea | What it means | Why AEs care |
|---|---|---|
| **Columnar storage** | Each column is stored contiguously, so a query reads only the columns it names | \`select *\` on a 200-column table reads 200 columns; naming 4 reads 4 |
| **Compression** | Similar values sit next to each other, so dictionary and run-length encoding shrink columns a lot | Low-cardinality columns (\`status\`, \`country_code\`) are nearly free to store and scan |
| **Separation of storage and compute** | Data lives in cheap object storage; compute clusters spin up, scale and shut down independently | You pay for compute *time* (or bytes scanned), so idle and wasteful queries are the cost |
| **MPP (massively parallel processing)** | A query is split across many workers, each scanning a slice, then results are shuffled and merged | Shuffles (big joins, \`count(distinct)\`, global sorts) are where queries get slow |

**Metadata** is the quiet fifth idea: warehouses keep min/max statistics per storage block (Snowflake micro-partitions, Parquet row groups, BigQuery partitions and clustered blocks). If a block's \`max(order_date)\` is before your filter, it is skipped entirely. That is **pruning**, and most performance work is about making pruning possible.

In practice: you rarely tune the engine. You tune *what you ask it to read*. The interview pitfall is talking about indexes as if the warehouse were Postgres; say "pruning, clustering and partitioning" instead.`,
    },
    {
      heading: 'The big four compared',
      body: `All four are columnar, MPP and separate storage from compute. They differ in **what you pay for** and **which physical-layout knobs you get**.

| | Snowflake | BigQuery | Redshift | Databricks SQL |
|---|---|---|---|---|
| Compute unit | Virtual warehouse (t-shirt sizes, each size doubles credits/hour) | Slots (units of CPU/memory) | Provisioned nodes (RA3) or Serverless capacity (RPUs) | SQL warehouses (classic, pro, serverless), billed in DBUs |
| Main pricing model | Credits per second while a warehouse runs (60-second minimum per resume) + storage | **On-demand**: bytes scanned; or **capacity** (editions with slot reservations / autoscaling) | Node-hours, or Serverless RPU-hours | DBUs while warehouse runs + your cloud storage |
| Physical layout | Automatic micro-partitions; optional **clustering keys** | **Partitioning** (date/timestamp/integer range) + **clustering** (up to four columns) | **Distribution** style/key + **sort keys** | Delta tables: partitioning, Z-ORDER, **liquid clustering** |
| Notable caches | Result cache (identical query, unchanged data, ~24h) + warehouse local disk cache | Cached query results for identical queries | Result cache | Disk/result caches, Photon engine |

**Snowflake.** Data is written into immutable **micro-partitions** (compressed, tens to hundreds of MB) with per-column min/max metadata. Natural load order often gives you good pruning on timestamps for free. **Clustering keys** tell Snowflake to keep a large table sorted by chosen columns in the background, which costs credits, so only add them to big tables where queries consistently filter on that column and the query profile shows poor pruning. Warehouses are sized independently per workload: a common setup is \`TRANSFORMING_WH\` for dbt, \`REPORTING_WH\` for BI, \`LOADING_WH\` for EL.

**BigQuery.** On-demand pricing charges for bytes read by the columns you reference, after partition pruning, so \`select *\` and unfiltered scans directly hit the bill. Note that \`limit 10\` does **not** reduce bytes scanned on an unclustered table. Partition big fact tables by date and set \`require_partition_filter = true\` so nobody can accidentally scan five years. Capacity (editions) pricing flips the incentive: you pay for slots over time, so concurrency and slot contention matter more than bytes.

**Redshift.** Older and more manual. **Distribution** decides which node a row lives on: \`KEY\` (co-locate rows that join on the same key), \`ALL\` (copy small dimensions to every node), \`EVEN\`, or \`AUTO\`. **Sort keys** enable block skipping like clustering does elsewhere. **RA3** nodes separate compute from managed storage; **Redshift Serverless** removes node management. If a Redshift query is slow, check for data being redistributed across nodes during joins.

**Databricks.** A **lakehouse**: data lives as open files (Parquet) with a **Delta Lake** transaction log in your own cloud storage, queried by Spark or by **SQL warehouses** using the **Photon** vectorised engine. **Unity Catalog** provides the governance layer (catalog.schema.table, grants, lineage). Small-file problems and \`OPTIMIZE\` / clustering are things you will meet here that Snowflake hides.

In practice, do not memorise prices. Know the *shape* of each bill: Snowflake punishes idle-but-running warehouses, on-demand BigQuery punishes bytes scanned, Redshift punishes bad distribution, Databricks punishes oversized always-on clusters and small files.`,
    },
    {
      heading: 'Open table formats, lakehouses and local dev with DuckDB',
      body: `**Open table formats** (Apache Iceberg, Delta Lake, Apache Hudi) put a metadata layer over Parquet files in object storage: snapshots, schema evolution, ACID commits, time travel and partition metadata. The point is that *several engines* can read and write the same table. Iceberg has become the default interchange format: Snowflake, BigQuery, Databricks, Redshift, Trino and DuckDB can all work with Iceberg tables to varying degrees, and a **catalog** (Apache Polaris, Unity Catalog, AWS Glue and others) tracks where each table's current metadata lives.

Why an AE should care:

- **Lock-in and multi-engine stacks.** A platform team on GCP and AWS may land data as Iceberg once and let different engines query it. Your dbt models might write to managed tables in one warehouse while a Spark job reads them.
- **Catalogs become the source of truth** for table location and permissions, which pushes governance below the warehouse.
- **Your modelling does not change.** Grain, keys, tests and naming are format-agnostic.

**DuckDB** is an in-process OLAP engine (the one running this app). It reads Parquet, CSV and Iceberg directly and is excellent for local development: run \`dbt-duckdb\` against sampled data on your laptop, prototype a model in seconds, unit-test macros in CI without warehouse credits. **MotherDuck** is a managed cloud service built on DuckDB. Treat DuckDB as a dev and small-data tool unless your data genuinely fits on one machine; dialect differences (date functions, \`qualify\` support, semi-structured types) mean you still need CI against the real warehouse.`,
    },
    {
      heading: 'Pruning, pushdown and reading less',
      body: `The cheapest byte is the one you never read. Three habits cover most cases.

**1. Filter on the layout column, directly.** Pruning works when the filter compares the partition or cluster column to a constant. Wrapping it in a function often defeats it.

\`\`\`sql
-- BigQuery: prunes partitions (ordered_at is the partition column)
select order_id, amount_usd
from analytics.fct_orders
where ordered_at >= timestamp '2026-05-01' and ordered_at < timestamp '2026-06-01';

-- Often scans everything: the function hides the column from the pruner
select order_id, amount_usd
from analytics.fct_orders
where format_timestamp('%Y-%m', ordered_at) = '2026-05';
\`\`\`

**2. Predicate pushdown.** Modern optimisers push filters down below joins and into scans, but not through everything. Filters applied *after* a window function, a \`distinct\`, or a non-deterministic expression usually cannot be pushed. In dbt, put the filter in the CTE that reads the source, not three CTEs later.

**3. Name your columns.** On a wide event table, \`select *\` is the single most common cost bug. In staging models it is acceptable to select explicitly from a source once; downstream, select only what you use.

Try a pruning-friendly shape here. In DuckDB the table is small, but the habit is the same:

\`\`\`sql run
select
  order_date,
  count(*) as orders,
  round(sum(amount_usd), 2) as revenue_usd
from prod.fct_orders
where order_date >= date '2026-05-01'
  and order_date < date '2026-06-01'
  and not is_test_account
group by order_date
order by order_date;
\`\`\`

A half-open range (\`>=\` start, \`<\` next start) is both prunable and correct for timestamps; \`between '2026-05-01' and '2026-05-31'\` silently drops everything after midnight on the 31st when the column is a timestamp.`,
    },
    {
      heading: 'Joins, windows and the expensive shapes',
      body: `**Join explosion (fan-out).** Joining two tables on a key that is not unique on at least one side multiplies rows. Summing an order-level amount after joining to order items double-counts revenue. Check the grain before you join:

\`\`\`sql run
select
  count(*) as joined_rows,
  count(distinct o.order_id) as distinct_orders
from prod.fct_orders o
join raw.order_items i on i.order_id = o.order_id;
\`\`\`

If \`joined_rows\` is much larger than \`distinct_orders\`, any \`sum(o.amount_usd)\` over this join is wrong. Fix it by aggregating the many side to the join grain *first*, then joining. Fan-out is also a performance problem: the shuffle grows with output rows.

**Window functions.** A window with \`partition by customer_id order by ordered_at\` needs data grouped and sorted per partition, which means a shuffle and a sort. They are fine, but:

- Compute them once in an intermediate model rather than in every downstream query.
- Avoid unbounded windows over the whole table (no \`partition by\`), which force everything onto one worker.
- Dedup with \`qualify row_number() over (...) = 1\` on the warehouses that support it; it is clearer than a self-join.

**Other expensive shapes:** \`count(distinct)\` on high-cardinality columns (consider approximate functions for exploratory work), \`order by\` on huge outputs nobody reads, cross joins hidden behind a missing join condition, and \`or\` across different columns in join predicates.

Interview pitfall: when asked "this model got slow, what do you do?", do not start with "make the warehouse bigger". Start with the query profile, then grain and fan-out, then pruning, then materialisation, and only then sizing.`,
    },
    {
      heading: 'Materialisation choice and incremental models',
      body: `Materialisation is the biggest cost lever an AE controls directly.

| Materialisation | Compute cost | When |
|---|---|---|
| **view** | Paid every time someone queries it | Staging models, light transforms, rarely-queried models |
| **table** | Paid once per build (full rebuild) | Marts queried by BI; small-to-medium data |
| **incremental** | Paid for new/changed rows per build (+ occasional full refresh) | Large, append-heavy facts (events, orders) where rebuilds are slow |
| **ephemeral** | Inlined as a CTE | Small reusable logic; hard to debug, use sparingly |
| **materialized view / dynamic table** | Warehouse maintains it | Simple aggregations needing freshness without dbt runs |

An incremental model on Tidepool's events might look like this (dbt, Snowflake-flavoured):

\`\`\`sql
{{ config(
    materialized = 'incremental',
    unique_key = 'event_id',
    incremental_strategy = 'merge',
    cluster_by = ['event_date']
) }}

select event_id, customer_id, event_name, event_ts, cast(event_ts as date) as event_date, device
from {{ ref('stg_segment__events') }}
{% if is_incremental() %}
  -- 3-day lookback: mobile events can land late
  where event_ts >= (select dateadd('day', -3, max(event_ts)) from {{ this }})
{% endif %}
\`\`\`

Trade-offs to say out loud: a \`merge\` still scans the target to find matches unless the warehouse can prune it (cluster or partition the target on the date you filter by, and on Snowflake/Databricks consider \`incremental_predicates\` to limit the merge scan). \`insert_overwrite\` by partition is often cheaper on BigQuery. Incremental models drift from a full rebuild if late data falls outside the lookback, so schedule a periodic full refresh or a reconciliation test.

In practice: start with views and tables. Go incremental when a table build is measurably slow or expensive, not because the table is called \`fct_\`.`,
    },
    {
      heading: 'Reading query profiles and EXPLAIN',
      body: `Every warehouse shows you what a query actually did. Learn to read one before guessing.

- **Snowflake Query Profile:** look at *partitions scanned vs partitions total* (pruning), *bytes spilled to local/remote storage* (warehouse too small or a huge join/sort), and which operator holds most of the time. An exploding join shows output rows far above input rows.
- **BigQuery execution details:** bytes processed, slot time consumed, stages with skew (one worker much slower than the average). A dry run tells you bytes before you run.
- **Redshift / Postgres-style \`EXPLAIN\`:** look for redistribution steps (\`DS_BCAST_INNER\`, \`DS_DIST_BOTH\`) and nested loops.
- **Databricks:** query profile in the SQL warehouse UI; files pruned, Photon coverage, spill.

\`\`\`sql
-- DuckDB / most engines: show the plan without running it
explain
select customer_id, count(*) from prod.fct_orders group by customer_id;

-- explain analyze actually runs it and reports per-operator timings
\`\`\`

The pattern to describe in interviews: *find the most expensive operator, explain why it is expensive (rows in, rows out, bytes, spill), change one thing, re-measure*. Bring the before/after numbers to the PR description.`,
    },
    {
      heading: 'Warehouse sizing, auto-suspend and cost attribution',
      body: `**Sizing.** On Snowflake, a bigger warehouse roughly halves runtime for parallelisable work at double the credits per hour, so total cost can stay flat while latency drops, until the query stops scaling. Signs you are undersized: spilling, queueing. Signs you are oversized: tiny queries on a large warehouse. Use **multi-cluster** (scale-out) for concurrency (many BI users), not for one slow query (scale-up).

**Auto-suspend and auto-resume.** A warehouse that stays up after the last query bills for nothing. Short auto-suspend for dbt and ad hoc warehouses is standard; BI warehouses may stay up a bit longer to keep caches warm. Balance against the per-resume minimum.

**Attribution.** You cannot cut what you cannot attribute. Tag every query:

\`\`\`yaml
# dbt_project.yml (Snowflake): query_tag is set per model or folder
models:
  tidepool:
    marts:
      +query_tag: 'dbt_marts'
# dbt-bigquery: job labels on models, and query comments as labels
#   +labels: {team: analytics, layer: marts}
#   query-comment: {job-label: true}
\`\`\`

Then query the usage views: Snowflake \`ACCOUNT_USAGE.QUERY_HISTORY\` and \`WAREHOUSE_METERING_HISTORY\`; BigQuery \`INFORMATION_SCHEMA.JOBS\` (bytes billed, slot milliseconds, labels). A weekly "top 20 most expensive models" report is the single most useful FinOps artefact an AE can own.

**FinOps habits:**

- Guardrails: Snowflake resource monitors, BigQuery \`maximum_bytes_billed\` and custom quotas, statement timeouts.
- Separate warehouses (or reservations) per workload so one runaway dashboard cannot starve dbt.
- Kill zombie models: if nothing has queried a mart in 90 days, propose deprecating it.
- Watch BI tools: a dashboard with 30 tiles refreshing every 15 minutes against a view can cost more than all of dbt.
- Prefer build-once tables for anything a BI tool hits repeatedly.`,
    },
    {
      heading: 'Working with Data Platform Engineers',
      body: `The ad says "collaborate with Data Platform Engineers to optimise query performance and warehouse cost". In practice the split is:

| Platform engineers usually own | AEs usually own |
|---|---|
| Accounts, networking, IAM, Terraform for warehouses and roles | Model SQL, grain, materialisation, incremental logic |
| Warehouse/reservation sizing policy, resource monitors | Which models run when, and on which warehouse |
| Ingestion infrastructure, orchestration runtime | Tests, docs, query tags on models |
| Observability (OTEL, Grafana), alert routing | Interpreting cost by model and fixing the expensive ones |

How to be a good partner:

1. **Bring evidence, not vibes.** "\`fct_sessions\` costs the most of any model this week; profile shows a full scan of \`events\` each run; proposal: incremental with a 3-day lookback, clustered on \`event_date\`."
2. **Propose the change in their language.** If they manage warehouses in Terraform, open a PR there or describe the exact setting.
3. **Agree on budgets and alerts** per workload, and on who gets paged.
4. **Share the cost dashboard** so cost becomes a normal part of model reviews.

A good senior signal: you can explain a cost spike end to end (which model, which change, which PR, which fix) without needing anyone to dig for you.`,
    },
  ],
  keyTerms: [
    { term: 'Columnar storage', definition: 'Storing each column contiguously so queries read only referenced columns; enables strong compression.' },
    { term: 'Separation of storage and compute', definition: 'Data sits in object storage while compute clusters scale and suspend independently, so you pay for compute time or bytes scanned.' },
    { term: 'MPP', definition: 'Massively parallel processing: a query is split across many workers, with data shuffled between them for joins and aggregations.' },
    { term: 'Pruning', definition: 'Skipping storage blocks or partitions whose min/max metadata cannot match the filter.' },
    { term: 'Micro-partition', definition: "Snowflake's immutable, compressed storage unit with per-column metadata used for pruning." },
    { term: 'Clustering key', definition: 'Columns a table is kept (approximately) sorted by, to improve pruning; costs background compute on Snowflake.' },
    { term: 'Partitioning (BigQuery)', definition: 'Splitting a table by date, timestamp or integer range so queries filtered on that column scan fewer bytes.' },
    { term: 'require_partition_filter', definition: 'BigQuery table option that rejects queries lacking a filter on the partition column.' },
    { term: 'Distribution key', definition: 'Redshift setting deciding which node stores each row; matching keys co-locate joins and avoid redistribution.' },
    { term: 'Slots', definition: 'BigQuery units of compute; the basis of capacity (editions) pricing as opposed to on-demand bytes scanned.' },
    { term: 'Open table format', definition: 'A metadata layer (Iceberg, Delta, Hudi) over Parquet files that adds ACID commits, snapshots and schema evolution readable by many engines.' },
    { term: 'Spill', definition: 'When an operator runs out of memory and writes intermediate data to disk; a sign of undersized compute or an oversized join/sort.' },
    { term: 'Query tag / job label', definition: 'Metadata attached to queries so cost can be attributed to models, teams or tools.' },
    { term: 'Fan-out', definition: 'Row multiplication from joining on a non-unique key; inflates sums and query cost.' },
  ],
  landscape: `*Snapshot as of mid-2026.*

- **Iceberg won the table-format debate, mostly.** Apache Iceberg became the de-facto open table format, with every major warehouse supporting it in some form. Databricks acquired Tabular (founded by Iceberg's creators) in 2024 while continuing to back Delta Lake, and both formats are converging in features.
- **Catalogs are the new battleground.** Snowflake originated Apache Polaris as an open Iceberg catalog, and Databricks open-sourced Unity Catalog in 2024. Who owns the catalog increasingly decides who owns governance.
- **Serverless and capacity-style pricing spread.** Serverless SQL options and autoscaling capacity models grew across vendors, making per-workload attribution and guardrails more important than picking a node size.
- **DuckDB grew up.** DuckDB became a standard local-development and CI engine, MotherDuck matured as a hosted option, and DuckDB released **DuckLake** in 2025, a lakehouse format that keeps table metadata in a SQL database.
- **Faster dbt tooling.** dbt Labs announced the Rust-based **dbt Fusion** engine (beta) in May 2025 after acquiring SDF Labs, promising faster parsing and SQL understanding (column-level awareness) that feeds cost and lineage tooling.
- **Consolidation.** Fivetran acquired Tobiko Data (SQLMesh) and Census in 2025, and Fivetran and dbt Labs announced a merger in October 2025, so expect the EL, transformation and activation layers to be sold increasingly as one stack.`,
  practice: [
    {
      kind: 'mcq',
      id: 'warehouse.bigquery-partition-pruning',
      domain: 'warehouse',
      difficulty: 2,
      title: 'Why did this query scan everything?',
      prompt: `On BigQuery (on-demand pricing), \`analytics.fct_orders\` is partitioned by \`date(ordered_at)\`. An analyst runs:

\`\`\`sql
select order_id, amount_usd
from analytics.fct_orders
where extract(year from ordered_at) = 2026
limit 100;
\`\`\`

The dry run shows the whole table's referenced columns will be scanned. What is the best fix?`,
      options: [
        'Rewrite the filter as a range on the partition column: `ordered_at >= timestamp \'2026-01-01\' and ordered_at < timestamp \'2027-01-01\'`',
        'Lower the `limit` to 10, since BigQuery bills by rows returned',
        'Add `order by ordered_at` so BigQuery reads partitions in order and stops early',
        'Switch the dataset to a larger slot reservation',
      ],
      correct: [0],
      explanation: `Pruning needs a filter the planner can compare against partition boundaries; wrapping the column in \`extract()\` can hide it, so a plain half-open range is the reliable fix. \`limit\` does not reduce bytes scanned on BigQuery (you pay for the columns read, not the rows returned). Adding \`order by\` makes it more expensive, not less. More slots change speed under capacity pricing, not on-demand bytes billed.`,
    },
    {
      kind: 'mcq',
      id: 'warehouse.snowflake-cost-shape',
      domain: 'warehouse',
      difficulty: 1,
      title: 'What drives a Snowflake bill?',
      prompt: 'On Snowflake, which factor most directly drives compute cost?',
      options: [
        'The number of bytes each query scans, regardless of warehouse size',
        'How long virtual warehouses are running, multiplied by their size',
        'The number of tables in the account',
        'The number of rows returned to the client',
      ],
      correct: [1],
      explanation: `Snowflake bills credits per second while a warehouse is running, at a rate that scales with its size. Bytes scanned matter indirectly (they make queries run longer) but are not the billing unit; that is BigQuery on-demand. Table count affects storage, not compute. Rows returned are irrelevant to billing.`,
    },
    {
      kind: 'mcq',
      id: 'warehouse.fanout-revenue',
      domain: 'warehouse',
      difficulty: 1,
      title: 'Revenue doubled overnight',
      prompt: `A new mart joins \`fct_orders\` to \`order_items\` on \`order_id\` to add \`category\`, then reports \`sum(amount_usd)\` by day. Revenue in the dashboard roughly doubled. What is the most likely cause?`,
      options: [
        'The warehouse result cache served stale numbers',
        'Order-level amounts were repeated once per order item (fan-out), inflating the sum',
        'Columnar compression changed the stored values',
        'The join should have been a `left join` to avoid duplicates',
      ],
      correct: [1],
      explanation: `\`order_id\` is unique in \`fct_orders\` but not in \`order_items\`, so each order's amount appears once per item. Aggregate items to the order grain first, or sum item-level amounts instead. A left join still fans out. Caches and compression never change values.`,
    },
    {
      kind: 'mcq',
      id: 'warehouse.select-star-cost',
      domain: 'warehouse',
      difficulty: 1,
      title: 'Wide tables',
      prompt: 'Why is `select *` on a 150-column event table particularly costly in a columnar warehouse?',
      options: [
        'Columnar engines must decompress every row into a row-store first',
        'Every one of the 150 columns is read, while a named-column query reads only the columns it references',
        'It disables the optimizer entirely',
        'It forces the warehouse to scale out to multiple clusters',
      ],
      correct: [1],
      explanation: `In a columnar store the scan cost is proportional to the columns referenced. \`select *\` reads them all, which on BigQuery on-demand is literally billed and on Snowflake means more I/O and time. It does not disable the optimizer or trigger multi-cluster scaling.`,
    },
    {
      kind: 'mcq',
      id: 'warehouse.slow-model-first-step',
      domain: 'warehouse',
      difficulty: 2,
      title: 'The model got slow',
      prompt: `\`fct_sessions\` went from 4 to 40 minutes after a PR last week. You are asked to fix it. Select all reasonable first steps.`,
      options: [
        'Open the query profile and find the operator with the most time, rows out, and any spill',
        'Compare row counts at each CTE against the previous version to spot a fan-out',
        'Immediately double the warehouse size so tonight\'s run finishes',
        'Diff the PR to see whether a filter moved below a window function or a join key changed',
      ],
      correct: [0, 1, 3],
      explanation: `Diagnose before you spend: the profile, row counts per step and the PR diff usually point straight at the cause (fan-out, lost pruning, a filter that can no longer be pushed down). Doubling the warehouse may be a temporary mitigation agreed with the platform team, but as a first step it hides the bug and doubles the rate you pay.`,
    },
    {
      kind: 'mcq',
      id: 'warehouse.incremental-merge-scan',
      domain: 'warehouse',
      difficulty: 3,
      title: 'Incremental but still expensive',
      prompt: `An incremental \`merge\` model on a 2-billion-row events table only processes ~3 days of new rows, yet each run still takes 25 minutes. The profile shows a full scan of the **target** table. What is the most likely issue and fix?`,
      options: [
        'The merge has to find matching keys in the target; without pruning on the target it scans it all. Cluster/partition the target on event date and limit the merge with an incremental predicate on that date',
        'Incremental models always scan the full source; switch to a view',
        'The `unique_key` should be removed so dbt appends instead, which is always correct',
        'The warehouse result cache is disabled for merge statements; enable it',
      ],
      correct: [0],
      explanation: `The \`is_incremental()\` filter limits the *source* side. The merge still has to look up keys in the target, and without a prunable predicate on the target it scans everything. Clustering or partitioning on the date plus an incremental predicate (e.g. only merge into the last N days) restores pruning. Dropping \`unique_key\` creates duplicates when late or re-delivered events arrive. A view would rescan the source on every query. The result cache does not apply to DML.`,
    },
    {
      kind: 'mcq',
      id: 'warehouse.multicluster-vs-scale-up',
      domain: 'warehouse',
      difficulty: 2,
      title: 'Monday morning queueing',
      prompt: `Every Monday at 9am, 60 people open the same Looker dashboards and queries queue on Snowflake's \`REPORTING_WH\`. Each individual query is fast once it starts. What is the most appropriate change?`,
      options: [
        'Scale up to a larger warehouse size',
        'Enable multi-cluster (scale-out) on the reporting warehouse with a sensible max cluster count',
        'Move the BI tool onto the dbt transforming warehouse',
        'Turn off auto-suspend on the reporting warehouse',
      ],
      correct: [1],
      explanation: `Queueing with fast individual queries is a concurrency problem, which multi-cluster scale-out solves. Scaling up helps single heavy queries. Sharing the transforming warehouse mixes workloads and makes attribution and contention worse. Disabling auto-suspend burns credits all week to solve a one-hour problem.`,
    },
    {
      kind: 'mcq',
      id: 'warehouse.cost-attribution',
      domain: 'warehouse',
      difficulty: 2,
      title: 'Who spent the money?',
      prompt: `Finance asks why warehouse spend rose 40% last month. Which setup lets you answer per model and per tool? Select all that apply.`,
      options: [
        'dbt query tags (Snowflake) or job labels (BigQuery) set per model or folder',
        'Separate warehouses or reservations for EL, dbt and BI workloads',
        'Querying usage views such as Snowflake `QUERY_HISTORY` or BigQuery `INFORMATION_SCHEMA.JOBS`',
        'Adding `-- cost` comments to the top of expensive models',
      ],
      correct: [0, 1, 2],
      explanation: `Tags/labels give per-model attribution, separate compute gives per-workload attribution, and the usage views are where the data lives. Plain SQL comments are not structured metadata; unless your dbt query-comment config turns them into labels, nothing aggregates them.`,
    },
    {
      kind: 'order',
      id: 'warehouse.optimise-model-steps',
      domain: 'warehouse',
      difficulty: 2,
      title: 'Optimise an expensive model',
      prompt: 'Put these steps for tackling the most expensive dbt model in a sensible order.',
      steps: [
        'Identify the model from cost attribution (query tags / job labels in usage views)',
        'Open its query profile and find the dominant operator, pruning ratio and spill',
        'Check grain and join keys for fan-out, and whether filters reach the scan',
        'Change one thing (filter placement, clustering, incremental strategy, materialisation)',
        'Re-measure runtime and bytes/credits and compare outputs against the old version',
        'Ship with before/after numbers in the PR and share with the platform team',
      ],
      explanation: `Attribute, diagnose, fix one variable, verify both cost and correctness, then communicate. Skipping the output comparison is how "optimisations" silently change numbers.`,
    },
    {
      kind: 'open',
      id: 'warehouse.platform-proposal',
      domain: 'warehouse',
      difficulty: 3,
      title: 'Pitch a cost fix to the platform team',
      prompt: `Tidepool's BigQuery bill (on-demand) has doubled. You find that \`fct_events\` is rebuilt as a full \`table\` every hour from a raw events table of several TB, and three Looker dashboards query \`stg_segment__events\` (a view) directly. Write the message you would send to the Data Platform Engineers proposing what to change and what you need from them.`,
      rubric: [
        'Quantifies or locates the cost with evidence (job labels / INFORMATION_SCHEMA, bytes billed per model or dashboard)',
        'Proposes making fct_events incremental (or insert_overwrite by partition) with partitioning on event date and a lookback for late mobile events',
        'Moves dashboards off the staging view onto a built, partitioned/clustered mart, possibly with require_partition_filter',
        'Asks platform for concrete things: guardrails (maximum_bytes_billed, quotas), labels, a reservation/editions discussion, or alerting',
        'Mentions verifying correctness (reconciling incremental vs full refresh) and a rollout plan',
        'Clear, collaborative tone with a specific ask rather than blame',
      ],
      sampleAnswer: `Hi team, the on-demand bill doubled and INFORMATION_SCHEMA.JOBS points at two things. (1) fct_events is a full table rebuild every hour, scanning the whole raw events table each time; it is the largest line by bytes billed. (2) Three Looker dashboards query the stg_segment__events view, so every tile refresh rescans raw events. My plan: make fct_events incremental with insert_overwrite on daily partitions, clustered by event_name, reprocessing the last 3 days because mobile events land late, plus a weekly full refresh and a row-count reconciliation test. Point the dashboards at a new partitioned mart with require_partition_filter. From you I'd like: maximum_bytes_billed on the Looker service account, job labels passed through from dbt into our billing export, and an alert when daily bytes exceed a threshold. Happy to pair on whether editions/capacity pricing would make sense once usage is stable. I'll share before/after bytes in the PR.`,
      minWords: 80,
      placeholder: 'Hi platform team, ...',
    },
    {
      kind: 'mcq',
      id: 'warehouse.open-table-format',
      domain: 'warehouse',
      difficulty: 2,
      title: 'Why Iceberg?',
      prompt: 'Your platform team wants to land raw data as Apache Iceberg tables in object storage. What is the main benefit for the analytics stack?',
      options: [
        'Iceberg tables are automatically faster than native warehouse tables for every query',
        'Multiple engines (warehouse, Spark, DuckDB) can read and write the same tables with ACID commits and snapshots, reducing lock-in',
        'Iceberg removes the need for a catalog',
        'Iceberg replaces dbt for transformations',
      ],
      correct: [1],
      explanation: `The value is interoperability: one copy of data, many engines, transactional metadata. Performance can be comparable but is not automatically better. Iceberg *needs* a catalog to track current metadata. It is a storage format, not a transformation tool.`,
    },
  ],
};
