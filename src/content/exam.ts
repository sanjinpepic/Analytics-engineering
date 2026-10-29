/**
 * The licence exam: 30 unseen tasks, 3 per discipline, in workday order. ~75 minutes.
 * Auto-graded items score locally; open answers are graded by Claude from the exported report.
 */
import type { Item } from './types';

const PAYMENTS_MODEL_BUGGY = `-- One row per order: what the customer actually paid, net of refunds.
with payments as (

    select * from {{ ref('stg_shop__payments') }}

)

select
    order_id,
    sum(case when payment_status = 'success' then amount_cents else 0 end)
      + sum(case when payment_status = 'refunded' then amount_cents else 0 end) as net_paid_cents,
    count(*) filter (where payment_status = 'failed')                           as failed_attempts
from payments
group by 1
`;

const PAYMENTS_MODEL_FIXED = PAYMENTS_MODEL_BUGGY.replace(
  `      + sum(case when payment_status = 'refunded' then amount_cents else 0 end) as net_paid_cents,`,
  `      - sum(case when payment_status = 'refunded' then amount_cents else 0 end) as net_paid_cents,`,
);

const PAYMENTS_UNIT_TEST = `version: 2

models:
  - name: int_orders__payments
    description: One row per order with net paid amount (successes minus refunds) and failed attempts.
    columns:
      - name: order_id
        data_tests: [unique, not_null]

unit_tests:
  - name: refunds_reduce_net_paid
    description: Failed attempts don't count, refunds subtract, split payments add up.
    model: int_orders__payments
    given:
      - input: ref('stg_shop__payments')
        rows:
          - {payment_id: 1, order_id: 10, payment_status: failed, amount_cents: 2500}
          - {payment_id: 2, order_id: 10, payment_status: success, amount_cents: 2500}
          - {payment_id: 3, order_id: 11, payment_status: success, amount_cents: 1000}
          - {payment_id: 4, order_id: 11, payment_status: refunded, amount_cents: 1000}
          - {payment_id: 5, order_id: 12, payment_status: success, amount_cents: 800}
          - {payment_id: 6, order_id: 12, payment_status: success, amount_cents: 700}
    expect:
      rows:
        - {order_id: 10, net_paid_cents: 2500, failed_attempts: 1}
        - {order_id: 11, net_paid_cents: 0, failed_attempts: 0}
        - {order_id: 12, net_paid_cents: 1500, failed_attempts: 0}
`;

const STATUS_COUNTS_STARTER = `{% set statuses = ['placed', 'shipped', 'completed', 'returned', 'cancelled'] %}

-- One row per customer_id in fct_orders, with one count column per status, in this order:
--   customer_id, placed_orders, shipped_orders, completed_orders, returned_orders, cancelled_orders
-- Generate the five count columns with a Jinja for-loop over \`statuses\`.

select
    customer_id
from {{ ref('fct_orders') }}
group by 1
`;

const STATUS_COUNTS_SOLUTION = `{% set statuses = ['placed', 'shipped', 'completed', 'returned', 'cancelled'] %}

select
    customer_id
    {%- for status in statuses %},
    sum(case when order_status = '{{ status }}' then 1 else 0 end) as {{ status }}_orders
    {%- endfor %}
from {{ ref('fct_orders') }}
group by 1
`;

export const EXAM_TIME_LIMIT_MIN = 75;

export const EXAM: Item[] = [
  // ------------------------------------------------------------------ quality
  {
    id: 'exam.quality.volume',
    kind: 'mcq',
    domain: 'quality',
    difficulty: 2,
    title: 'Half the rows vanished',
    prompt: `Overnight, \`fct_orders\` went from ~1,070 rows to ~530. All tests passed: \`unique\` and \`not_null\` on \`order_id\`, \`accepted_values\` on status. Which kind of check would have caught it?`,
    options: [
      'A relationships test on customer_id',
      'A volume / anomaly check (e.g. row count or freshness compared with recent history, via dbt_expectations, Elementary or an observability tool)',
      'Another unique test on a different column',
      'A model contract',
    ],
    correct: [1],
    explanation: 'Schema tests check **validity** of the rows that exist. They are silent when rows are missing. Volume and anomaly checks compare against history and catch dropped partitions, broken joins and upstream outages. A contract checks shape, not completeness.',
  },
  {
    id: 'exam.quality.unit-test',
    kind: 'dbt',
    domain: 'quality',
    difficulty: 3,
    title: 'Make the unit test pass',
    prompt: `\`int_orders__payments\` computes what each order actually paid. Its **unit test** (\`models/intermediate/_int_payments.yml\`) describes the intended behaviour, and it fails.

Read the unit test failure, then fix the **model** (not the test). The check runs \`dbt build -s int_orders__payments\`.`,
    files: {
      'models/intermediate/int_orders__payments.sql': PAYMENTS_MODEL_BUGGY,
      'models/intermediate/_int_payments.yml': PAYMENTS_UNIT_TEST,
    },
    openFile: 'models/intermediate/int_orders__payments.sql',
    command: 'dbt build -s int_orders__payments',
    checks: [
      { type: 'file-matches', file: 'models/intermediate/_int_payments.yml', patterns: ['net_paid_cents: 0, failed_attempts: 0', 'net_paid_cents: 1500'], label: 'The unit test expectations are unchanged' },
      { type: 'tests-pass', require: ['int_orders__payments::refunds_reduce_net_paid', 'unique_int_orders__payments_order_id'], label: 'Unit test and primary key tests pass' },
      {
        type: 'model-equals',
        model: 'int_orders__payments',
        sql: `select order_id,
  sum(case when payment_status = 'success' then amount_cents else 0 end) - sum(case when payment_status = 'refunded' then amount_cents else 0 end) as net_paid_cents,
  count(*) filter (where payment_status = 'failed') as failed_attempts
from prod.stg_shop__payments group by 1`,
        checkColumnNames: true,
        label: 'Model output is correct on real data',
      },
    ],
    solutionFiles: { 'models/intermediate/int_orders__payments.sql': PAYMENTS_MODEL_FIXED },
    explanation: 'Refunds were **added** to the successful amount instead of subtracted. The unit test pins the intended behaviour with tiny hand-written rows (a failed retry, a full refund, a split payment) and fails before bad data is built.',
  },
  {
    id: 'exam.quality.contract-proposal',
    kind: 'open',
    domain: 'quality',
    difficulty: 3,
    title: 'Propose a data contract',
    prompt: `Finance will build revenue reporting on \`fct_orders\` and asks for "a data contract". Outline what the contract should contain, how you'd **enforce** each part technically, and how **changes** will be handled.`,
    minWords: 80,
    rubric: [
      'Schema: columns, data types, primary key, nullability; enforced via dbt model contract (contract: enforced) and constraints',
      'Semantics: definitions of each money column (amount_usd FX method, which statuses, test accounts), documented in YAML/semantic layer',
      'Quality guarantees and SLAs: tests (unique/not_null/relationships/accepted_values), freshness SLA (e.g. by 06:00 UTC), volume checks; alerting',
      'Ownership & support: producing team/owner, consumer list, escalation path',
      'Change management: versioning for breaking changes (dbt model versions, deprecation dates), CI that blocks breaking changes, communication process',
      'Upstream: the contract depends on source contracts/expectations with the shop backend team (e.g. CDC schema changes)',
    ],
  },
  // ------------------------------------------------------------------ business
  {
    id: 'exam.business.revenue-drop',
    kind: 'open',
    domain: 'business',
    difficulty: 2,
    title: '"Why did revenue drop last week?"',
    prompt: `Monday, 09:05. The CEO posts in #leadership: *"Revenue was down 18% last week. Why?"* and tags you. Write how you respond in the first hour: your reply, the questions you ask (if any), and your investigation plan in order.`,
    minWords: 70,
    rubric: [
      'Acknowledges quickly with an ETA and avoids speculating before checking',
      'Rules out a data problem first (freshness, failed jobs, late-arriving data, FX, test accounts, definition changes) before treating it as a business change',
      'Clarifies which revenue (gross/net, bookings vs completed, currency), which comparison (WoW vs same week last year, seasonality, holidays)',
      'Decomposes the change: orders × AOV, new vs returning customers, channel/country/product mix, conversion funnel and traffic',
      'Communicates findings concisely with confidence levels and next steps, and records the answer for reuse',
    ],
  },
  {
    id: 'exam.business.two-numbers',
    kind: 'mcq',
    domain: 'business',
    difficulty: 2,
    title: 'Two dashboards, two revenues',
    prompt: `The Finance dashboard says May revenue was $41.2k; the Growth dashboard says $44.9k. Both read from the warehouse. What's the most effective next step?`,
    options: [
      'Tell everyone to use the Finance number because Finance owns revenue',
      'Average the two numbers',
      'Trace both definitions (statuses included, returns, gross vs net of discounts, FX method, timezone cut-off, test accounts), reconcile the difference, agree one governed definition with both owners, and point both dashboards to it',
      'Rebuild the Growth dashboard in a different BI tool',
    ],
    correct: [2],
    explanation: 'Metric disagreements are almost always **definition** differences. Reconcile them explicitly (a waterfall that accounts for the $3.7k gap), get the owners to agree, and centralise the definition (semantic layer / mart) so it cannot drift again.',
  },
  {
    id: 'exam.business.return-rate',
    kind: 'numeric',
    domain: 'business',
    difficulty: 2,
    title: 'Q1 problem-order rate',
    prompt: 'Operations asks: of all orders **placed in Q1 2026** (any status, excluding test accounts), what **fraction** ended up **cancelled or returned**? Give at least 3 decimals.',
    solution: `select avg(case when order_status in ('cancelled', 'returned') then 1.0 else 0 end)
from prod.fct_orders
where not is_test_account and order_date between date '2026-01-01' and date '2026-03-31'`,
    tolerance: 0.0015,
    explanation: 'Denominator = all orders placed in the period, numerator = those cancelled or returned. Fixing the denominator is half the job in any rate question.',
  },
  // ------------------------------------------------------------------ sql
  {
    id: 'exam.sql.top-ltv-per-country',
    kind: 'sql',
    domain: 'sql',
    difficulty: 2,
    title: 'Best customer per country',
    prompt: `From \`prod.dim_customers\` (excluding test accounts and customers with no country), return the customer with the **highest lifetime_value_usd per country_code** (ties: lowest customer_id). Columns: \`country_code\`, \`customer_id\`, \`lifetime_value_usd\`.`,
    solution: `select country_code, customer_id, lifetime_value_usd
from prod.dim_customers
where not is_test_account and country_code is not null
qualify row_number() over (partition by country_code order by lifetime_value_usd desc, customer_id) = 1`,
    tables: ['prod.dim_customers'],
  },
  {
    id: 'exam.sql.rolling-visitors',
    kind: 'sql',
    domain: 'sql',
    difficulty: 3,
    title: '7-day rolling visitors',
    prompt: `For each day in **June 2026**, return \`event_date\`, \`visitors\` (distinct \`anonymous_id\` with any event that day, from \`prod.stg_segment__events\`), and \`visitors_7d_avg\`: the average of that day and the **6 previous calendar days**, where days without any events count as 0. Order by event_date.`,
    solution: `with days as (
    select d::date as event_date from generate_series(date '2026-05-26', date '2026-06-30', interval 1 day) as g(d)
),
daily as (
    select cast(event_ts as date) as event_date, count(distinct anonymous_id) as visitors
    from prod.stg_segment__events group by 1
),
filled as (
    select days.event_date, coalesce(daily.visitors, 0) as visitors
    from days left join daily using (event_date)
)
select event_date, visitors,
       avg(visitors) over (order by event_date rows between 6 preceding and current row) as visitors_7d_avg
from filled
qualify event_date >= date '2026-06-01'
order by event_date`,
    ordered: true,
    tables: ['prod.stg_segment__events'],
    explanation: 'Two traps: (1) days with zero activity must exist as rows, so use a date spine, or `rows between 6 preceding` spans more than 7 calendar days; (2) the spine must start 6 days **before** June so June 1st has a full window.',
  },
  {
    id: 'exam.sql.not-in-null',
    kind: 'mcq',
    domain: 'sql',
    difficulty: 2,
    title: 'The empty result',
    prompt: `This query returns **zero rows**, although you know many customers have never ordered:

\`\`\`sql
select customer_id from prod.stg_shop__customers
where customer_id not in (select customer_id from prod.stg_shop__orders)
\`\`\`

Assume \`stg_shop__orders.customer_id\` contains a NULL. Why is the result empty?`,
    options: [
      'NOT IN does not work on integer columns',
      'If the subquery returns any NULL, `x NOT IN (…, NULL)` evaluates to NULL (not TRUE) for every row, so nothing passes the WHERE',
      'The subquery is correlated',
      'DuckDB requires DISTINCT inside NOT IN',
    ],
    correct: [1],
    explanation: '`x NOT IN (a, b, NULL)` means `x <> a AND x <> b AND x <> NULL`, and the last comparison is NULL, so the whole predicate is never TRUE. Use `NOT EXISTS` or a `LEFT JOIN … IS NULL`, which are null-safe. (In this dataset the column has no NULLs. It is a classic interview question.)',
  },
  // ------------------------------------------------------------------ modeling
  {
    id: 'exam.modeling.snapshot-fact',
    kind: 'mcq',
    domain: 'modeling',
    difficulty: 2,
    title: 'Inventory levels',
    prompt: 'You model warehouse **stock on hand per product per day**. What kind of fact table is this, and how does `units_on_hand` aggregate?',
    options: [
      'Transactional fact; fully additive',
      'Periodic snapshot fact; semi-additive: you can sum across products for one day, but not across days (use the end-of-period or average value over time)',
      'Accumulating snapshot; non-additive',
      'Factless fact; not aggregable',
    ],
    correct: [1],
    explanation: 'Balances and levels (stock, MRR, account balances) are **periodic snapshots** with **semi-additive** measures. Summing stock across 30 days gives a meaningless number. Take the last value or average over the period.',
  },
  {
    id: 'exam.modeling.revenue-by-historic-country',
    kind: 'sql',
    domain: 'modeling',
    difficulty: 3,
    title: 'Revenue by country at order time',
    prompt: `Build the customer versions as an SCD2 from **\`raw.customers\`** (\`valid_from\` = \`updated_at\`, \`valid_to\` = next version's \`updated_at\`) and attribute **completed** order revenue in **H1 2026** (\`prod.fct_orders\`, non-test) to the customer's country **at the time of the order**. Columns: \`country\` (use \`'unknown'\` for null), \`revenue_usd\`.`,
    solution: `with versions as (
    select id as customer_id, country, updated_at as valid_from,
           lead(updated_at) over (partition by id order by updated_at) as valid_to
    from raw.customers
)
select coalesce(v.country, 'unknown') as country, sum(o.amount_usd) as revenue_usd
from prod.fct_orders o
join versions v
  on o.customer_id = v.customer_id
 and o.ordered_at >= v.valid_from
 and (o.ordered_at < v.valid_to or v.valid_to is null)
where o.order_status = 'completed' and not o.is_test_account
  and o.order_date between date '2026-01-01' and date '2026-06-30'
group by 1`,
    tables: ['raw.customers', 'prod.fct_orders'],
    hints: ['A half-open interval [valid_from, valid_to) avoids double-matching at the boundary.'],
    explanation: 'Point-in-time joins use a half-open interval `>= valid_from and < valid_to`. A closed interval double-counts orders that land exactly on a change timestamp.',
  },
  {
    id: 'exam.modeling.obt',
    kind: 'mcq',
    domain: 'modeling',
    difficulty: 3,
    title: 'Star schema or one big table?',
    prompt: 'The BI team wants a single wide `orders_obt` table (orders with all customer and product attributes denormalised) "because joins are slow". Which response reflects good modelling judgement? **Select all that apply.**',
    options: [
      'Keep conformed facts and dimensions as the governed core; build wide tables downstream of them for specific consumption needs',
      'Never denormalise; BI tools must always join',
      'Wide tables are fine in columnar warehouses (unused columns aren\'t scanned), but they duplicate logic and grain mistakes multiply, so derive them from the star rather than from raw',
      'SCD2 attributes in a wide table need a decision: as-of-order-time or current value; name the column accordingly',
    ],
    correct: [0, 2, 3],
    explanation: 'Modern columnar engines make OBTs cheap to query, so the real risk is **governance**: duplicated logic and drifting definitions. Build them *from* the dimensional core, and be explicit about historical vs current attributes.',
  },
  // ------------------------------------------------------------------ dbt
  {
    id: 'exam.dbt.jinja-loop',
    kind: 'dbt',
    domain: 'dbt',
    difficulty: 2,
    title: 'Generate columns with Jinja',
    prompt: `Complete \`models/marts/customer_status_counts.sql\`: one row per \`customer_id\` with one count column per status (\`placed_orders\`, \`shipped_orders\`, \`completed_orders\`, \`returned_orders\`, \`cancelled_orders\`), **generated with a Jinja for-loop** over the \`statuses\` list. Column names are checked.`,
    files: { 'models/marts/customer_status_counts.sql': STATUS_COUNTS_STARTER },
    openFile: 'models/marts/customer_status_counts.sql',
    command: 'dbt build -s customer_status_counts',
    checks: [
      { type: 'file-matches', file: 'models/marts/customer_status_counts.sql', patterns: ['\\{%-?\\s*for\\s+\\w+\\s+in\\s+statuses'], label: 'Uses a for-loop over statuses' },
      {
        type: 'model-equals',
        model: 'customer_status_counts',
        sql: `select customer_id,
  count(*) filter (where order_status = 'placed') as placed_orders,
  count(*) filter (where order_status = 'shipped') as shipped_orders,
  count(*) filter (where order_status = 'completed') as completed_orders,
  count(*) filter (where order_status = 'returned') as returned_orders,
  count(*) filter (where order_status = 'cancelled') as cancelled_orders
from prod.fct_orders group by 1`,
        checkColumnNames: true,
        label: 'One row per customer with the five counts',
      },
    ],
    solutionFiles: { 'models/marts/customer_status_counts.sql': STATUS_COUNTS_SOLUTION },
    explanation: 'Loops remove copy-paste for pivots. Mind the comma placement: generate a leading comma per column, or use `loop.last`. In real projects `dbt_utils.pivot` or `get_column_values` can derive the list from data, at the cost of an extra query at compile time.',
  },
  {
    id: 'exam.dbt.materialization',
    kind: 'mcq',
    domain: 'dbt',
    difficulty: 2,
    title: 'Pick materialisations',
    prompt: 'Match the most sensible default: (a) a light rename/cast staging model over a small table; (b) a heavy mart queried by dashboards all day; (c) a 2-billion-row event fact that grows daily.',
    options: [
      '(a) table, (b) view, (c) table',
      '(a) view, (b) table, (c) incremental',
      '(a) incremental, (b) ephemeral, (c) view',
      '(a) ephemeral, (b) view, (c) table rebuilt hourly',
    ],
    correct: [1],
    explanation: 'Views are cheap for light transformations that are rarely queried directly. Tables suit marts that are read often (compute once, read many times). Incremental suits large, append-mostly facts. Ephemeral models are inlined as CTEs and have no relation to query or test, so use them sparingly.',
  },
  {
    id: 'exam.dbt.sqlmesh',
    kind: 'mcq',
    domain: 'dbt',
    difficulty: 3,
    title: 'SQLMesh vs dbt',
    prompt: 'Which statements about **SQLMesh** are accurate? **Select all that apply.**',
    options: [
      'It parses SQL (via SQLGlot) so it understands column-level lineage and can classify changes as breaking or non-breaking',
      '`sqlmesh plan` shows the impact of changes on an environment before applying them; virtual data environments reuse already-computed tables via views instead of rebuilding them',
      'It cannot run models that were written for dbt',
      'Incremental models are typically declared by kind (e.g. INCREMENTAL_BY_TIME_RANGE) and SQLMesh tracks which intervals have been processed',
    ],
    correct: [0, 1, 3],
    explanation: 'SQLMesh understands SQL semantically, plans changes, uses virtual environments (pointer swaps rather than rebuilds) and tracks processed intervals for time-based incremental models. It also ships a dbt adapter mode that can load existing dbt projects, so option 3 is false.',
  },
  // ------------------------------------------------------------------ warehouse
  {
    id: 'exam.warehouse.delta-small-files',
    kind: 'mcq',
    domain: 'warehouse',
    difficulty: 2,
    title: 'Lakehouse small files',
    prompt: 'A Delta table on Databricks written by a streaming job has become slow to query. The table has hundreds of thousands of tiny files. What helps most?',
    options: [
      'Compacting files (e.g. OPTIMIZE) and clustering data on common filter columns (Z-ordering or liquid clustering), plus tuning the writer to produce fewer, larger files',
      'Converting the table to CSV',
      'Adding more columns',
      'Querying it with SELECT * so all files are read sequentially',
    ],
    correct: [0],
    explanation: 'Many small files mean high per-file overhead and poor data skipping. Compaction plus clustering on filter columns restores pruning. The same "small files problem" exists for Iceberg tables (rewrite data files / compaction).',
  },
  {
    id: 'exam.warehouse.redshift-dist',
    kind: 'mcq',
    domain: 'warehouse',
    difficulty: 3,
    title: 'Redshift distribution',
    prompt: 'On Redshift (provisioned), a large `fct_order_items` joins a large `fct_orders` on `order_id`, and queries show heavy network redistribution. What is the classic fix?',
    options: [
      'DISTSTYLE ALL on both tables',
      'Distribute both tables on the join key (DISTKEY order_id) so matching rows are co-located on the same slice, checking for skew',
      'Add an index on order_id',
      'Use more CTEs',
    ],
    correct: [1],
    explanation: 'Co-locating large tables on their common join key avoids broadcasting or redistributing rows. `ALL` is for small dimensions. Redshift has no traditional indexes; sort keys help range filters. Check skew: a DISTKEY with a few hot values overloads some slices.',
  },
  {
    id: 'exam.warehouse.cost-plan',
    kind: 'open',
    domain: 'warehouse',
    difficulty: 3,
    title: 'Cut the dbt bill',
    prompt: 'Data Platform says the dbt project is now the largest line item in the warehouse bill and asks you to cut it by 30% this quarter without hurting SLAs. Describe your plan, from measurement to changes.',
    minWords: 80,
    rubric: [
      'Measure first: attribute cost per model/job (query history, query tags/labels, dbt artifacts, run timings) and find the top offenders',
      'Model-level changes: incremental for large facts (correct unique_key / late-data handling), right materialisations, prune unnecessary columns/joins, fix fan-outs, pre-aggregate',
      'Physical design: partitioning/clustering, pruning-friendly filters, compaction where relevant',
      'Run less: align schedules with real SLAs, state-aware / Slim CI builds in CI, defer, avoid full refreshes, skip unchanged models',
      'Compute config: right-size warehouses / slots, auto-suspend, separate workloads, BI caching',
      'Track the result (cost dashboard, budgets/alerts) and agree trade-offs with stakeholders',
    ],
  },
  // ------------------------------------------------------------------ workflow
  {
    id: 'exam.workflow.ci-schema',
    kind: 'mcq',
    domain: 'workflow',
    difficulty: 2,
    title: 'Where does CI build?',
    prompt: 'Your GitHub Actions CI job runs `dbt build` for each pull request. Where should it write its tables?',
    options: [
      'Into the production schema, so reviewers see real numbers',
      'Into an isolated, PR-specific schema (e.g. `ci_pr_214`) using a CI target with limited permissions, deferring unchanged models to prod and dropping the schema when the PR closes',
      'Into each developer\'s personal dev schema',
      'It should not write anything; CI should only lint',
    ],
    correct: [1],
    explanation: 'CI must never touch prod. A per-PR schema isolates concurrent PRs, defer avoids rebuilding the world, a least-privilege CI role limits the blast radius, and cleanup keeps the warehouse tidy. Lint-only CI misses broken SQL and failing tests.',
  },
  {
    id: 'exam.workflow.guidelines',
    kind: 'mcq',
    domain: 'workflow',
    difficulty: 2,
    title: 'What belongs in the style guide?',
    prompt: 'You are writing your team\'s analytics engineering guidelines. Which items belong there? **Select all that apply.**',
    options: [
      'Layering and naming conventions (stg_<source>__<entity>, int_, fct_, dim_) and folder structure',
      'Minimum testing: primary key unique + not_null on every model; sources declared with freshness where it matters',
      'SQL style enforced by a linter (e.g. SQLFluff) rather than by review comments',
      'Which colour scheme each analyst uses in their IDE',
      'PR template and review checklist (grain, joins, tests, docs, performance impact)',
    ],
    correct: [0, 1, 2, 4],
    explanation: 'Guidelines standardise what makes models predictable and reviewable: structure, naming, testing minimums, automated style, review expectations. Automate what you can (linting, dbt-project-evaluator) so reviews focus on logic. Personal IDE themes don\'t belong there.',
  },
  {
    id: 'exam.workflow.terraform',
    kind: 'mcq',
    domain: 'workflow',
    difficulty: 3,
    title: 'Terraform or dbt?',
    prompt: 'Which of these are better managed as infrastructure-as-code (e.g. Terraform) than inside the dbt project? **Select all that apply.**',
    options: [
      'Creating warehouses / compute clusters and their size and auto-suspend settings',
      'Roles, service accounts and their high-level privileges (e.g. the CI role, the BI role)',
      'The SQL logic of fct_orders',
      'Masking/row-access policies and tags that span many teams\' objects',
    ],
    correct: [0, 1, 3],
    explanation: 'Infrastructure and access foundations (compute, roles, users, policies) belong in reviewed IaC with plans and state. dbt owns transformation logic and can apply model-level `grants` on the objects it creates. Platform engineers usually own the Terraform; AEs contribute to and review it.',
  },
  // ------------------------------------------------------------------ orchestration
  {
    id: 'exam.orchestration.deletes',
    kind: 'mcq',
    domain: 'orchestration',
    difficulty: 2,
    title: 'Hard deletes in the source',
    prompt: 'The shop backend **hard-deletes** cancelled draft orders. Your EL tool replicates with a cursor on `updated_at`. What happens in the warehouse, and what is the usual fix?',
    options: [
      'The deleted rows disappear automatically from the warehouse',
      'Cursor-based replication never sees the delete, so the rows stay forever. Use log-based CDC (which emits delete events / soft-delete flags such as a `_deleted` column), or periodic full re-syncs, and filter soft-deleted rows in staging',
      'The warehouse throws an error',
      'dbt snapshots delete them',
    ],
    correct: [1],
    explanation: 'A cursor on `updated_at` only sees inserts and updates. Log-based CDC reads the database log, including deletes, and many tools mark them with a soft-delete flag. Handle that flag explicitly in staging.',
  },
  {
    id: 'exam.orchestration.granularity',
    kind: 'mcq',
    domain: 'orchestration',
    difficulty: 3,
    title: 'One task or one per model?',
    prompt: 'In Airflow you can run the dbt project as **one task** (`dbt build`) or as **one task per model** (e.g. generated from the manifest, as tools like Cosmos do). Which trade-off is accurate?',
    options: [
      'Per-model tasks are always better',
      'One task is simpler and lets dbt handle ordering, but retries/visibility are all-or-nothing; per-model tasks give granular retries, observability and cross-system dependencies, at the cost of scheduler overhead and more moving parts',
      'One task cannot run tests',
      'Per-model tasks make SQL faster',
    ],
    correct: [1],
    explanation: 'This is a real design decision. Many teams start with selector-based jobs (e.g. `dbt build -s tag:hourly`) and move to asset- or model-level orchestration (Dagster assets, Cosmos) when they need granular retries, lineage in the orchestrator and cross-tool dependencies.',
  },
  {
    id: 'exam.orchestration.backfill',
    kind: 'order',
    domain: 'orchestration',
    difficulty: 2,
    title: 'Backfill a logic change',
    prompt: 'You fixed the FX logic in a large incremental model; history since January is wrong. Order the steps.',
    steps: [
      'Merge the fix with tests (incl. a unit test for the FX edge case) and confirm the incremental run handles new data correctly',
      'Estimate cost and impact; tell consumers which period will change and when',
      'Backfill the affected period (full refresh, or batches/partitions, e.g. with microbatch or --vars for a date range)',
      'Validate: reconcile totals before/after against the source and check downstream models',
      'Announce completion and note the change in the model\'s changelog/docs',
    ],
    explanation: 'Fix forward first, then rebuild history in controlled batches with stakeholders informed, then validate. Silent historical restatements destroy trust in reported numbers.',
  },
  // ------------------------------------------------------------------ semantic
  {
    id: 'exam.semantic.avg-active-subs',
    kind: 'numeric',
    domain: 'semantic',
    difficulty: 3,
    title: 'Average active subscriptions',
    prompt: `Finance wants the **average number of active subscriptions per day in June 2026** (all currencies). A subscription is active on day *d* if \`started_at <= d\` and (\`cancelled_at\` is null or \`cancelled_at > d\`). Exclude broken rows where \`cancelled_at < started_at\`. Use \`prod.stg_shop__subscriptions\`. Give at least 2 decimals.`,
    solution: `with days as (
    select d::date as day from generate_series(date '2026-06-01', date '2026-06-30', interval 1 day) as g(d)
),
subs as (
    select * from prod.stg_shop__subscriptions where cancelled_at is null or cancelled_at >= started_at
)
select avg(active) from (
    select days.day, count(subs.subscription_id) as active
    from days
    left join subs on subs.started_at <= days.day and (subs.cancelled_at is null or subs.cancelled_at > days.day)
    group by 1
)`,
    tolerance: 0.006,
    explanation: 'A semi-additive measure over time: count per day (point-in-time), then average across days. Counting distinct subscriptions active at any point in June overstates it.',
  },
  {
    id: 'exam.semantic.symmetric',
    kind: 'mcq',
    domain: 'semantic',
    difficulty: 2,
    title: 'Fan-out in the BI layer',
    prompt: 'In a BI model, an explore joins `orders` (one row per order) to `order_items` (many per order). A user picks **total order shipping** and **items sold**. What prevents shipping from being multiplied by the number of items?',
    options: [
      'Nothing; users should know not to do that',
      'Defining the relationship (one-to-many) and primary keys so the tool can de-duplicate measures from the "one" side, e.g. Looker\'s symmetric aggregates, or a semantic layer that aggregates each measure at its own grain before joining',
      'Using AVG instead of SUM',
      'Hiding the order_items view',
    ],
    correct: [1],
    explanation: 'Semantic layers prevent fan-out when they know keys and relationships. Looker uses symmetric aggregates (distinct sums keyed on the primary key). MetricFlow aggregates measures per semantic model before joining. Without that, metrics on the "one" side are inflated.',
  },
  {
    id: 'exam.semantic.llm',
    kind: 'mcq',
    domain: 'semantic',
    difficulty: 3,
    title: 'Metrics for AI agents',
    prompt: 'Leadership wants an LLM assistant that answers "what was revenue by channel last month?" in Slack. What is the most robust architecture?',
    options: [
      'Give the LLM read access to all raw tables and let it write SQL',
      'Expose governed metrics and dimensions through the semantic layer (e.g. via its API or an MCP server); the agent selects metrics/dimensions/filters and the semantic layer generates the SQL, with access controls and documented definitions',
      'Fine-tune a model on last year\'s dashboards',
      'Export the marts to a spreadsheet the LLM can read',
    ],
    correct: [1],
    explanation: 'Grounding the agent in **defined** metrics avoids hallucinated definitions and inconsistent joins. The model chooses *what* to ask, and the semantic layer controls *how* it is computed and who can see it. Also send only the data needed to the LLM provider.',
  },
  // ------------------------------------------------------------------ governance
  {
    id: 'exam.governance.access',
    kind: 'mcq',
    domain: 'governance',
    difficulty: 2,
    title: 'Model access in dbt Mesh',
    prompt: 'In a multi-project dbt setup, the Finance project should be able to `ref()` your `fct_orders`, but not your intermediate models. How do you express that?',
    options: [
      'Put the intermediate models in a different folder',
      'Assign models to a group with an owner; set `access: public` on fct_orders (ideally with a contract and versions) and keep intermediate models `protected` or `private`',
      'Rename intermediate models with a leading underscore',
      'Revoke warehouse SELECT on the intermediate tables',
    ],
    correct: [1],
    explanation: 'dbt model governance: **groups** (ownership), **access** modifiers (`private` within the group, `protected` within the project, `public` across projects), **contracts** and **versions** for public interfaces. Warehouse grants control data access. dbt access controls who may build on a model.',
  },
  {
    id: 'exam.governance.lineage',
    kind: 'mcq',
    domain: 'governance',
    difficulty: 2,
    title: 'Before renaming a column',
    prompt: 'You want to rename `fct_orders.amount_local` to `amount_order_currency`. What should you check first?',
    options: [
      'Nothing; renames are safe in dbt',
      'Column-level lineage and exposures: which downstream models, dashboards, metrics and external consumers use the column; then deprecate via a model version or alias period and communicate',
      'Only the models in the same folder',
      'Whether the column has a description',
    ],
    correct: [1],
    explanation: 'Renames are breaking changes for every consumer. Column-level lineage (dbt Explorer, catalogs, SQLGlot-based tools) plus exposures show the blast radius. Ship it as a new version, or with the old column kept for a deprecation window.',
  },
  {
    id: 'exam.governance.guidelines',
    kind: 'open',
    domain: 'governance',
    difficulty: 3,
    title: 'Governance standards for a growing team',
    prompt: 'You are the first AE in a 4-domain company (shop, marketing, finance, product). Outline the **documentation, lineage and governance standards** you would put in place in your first 90 days, and how you would automate their enforcement.',
    minWords: 90,
    rubric: [
      'Ownership: every model has an owner/group; domains map to folders or projects; clear public interfaces (marts) vs internal models',
      'Documentation standards: descriptions required for public models and their columns, grain stated, doc blocks for shared definitions; enforced in CI (e.g. dbt-project-evaluator, custom checks)',
      'Lineage & catalog: dbt docs/Explorer or a catalog (DataHub, Atlan, OpenMetadata, Unity Catalog) published automatically; exposures for key dashboards',
      'Access & PII: classification/tagging, masking policies, role-based access managed in code (Terraform/grants), least privilege',
      'Quality & contracts for public models: tests, contracts, freshness SLAs, alerting and an incident process',
      'Prioritisation: sequencing over 90 days (start with the most-used marts), lightweight process, measured adoption',
    ],
  },
];
