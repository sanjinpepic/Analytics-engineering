/**
 * Licence exam, Form B: 30 further unseen tasks with the same structure as Form A
 * (3 per discipline, workday order), so a retake measures skill rather than memory.
 */
import type { Item } from './types';

const SUBS_TEST_STARTER = `-- Singular test: return every subscription row that breaks the rule
-- "a subscription cannot be cancelled before it started".
-- A singular test passes when it returns zero rows.

select 1 as todo
where false
`;

const SUBS_TEST_SOLUTION = `select subscription_id, started_at, cancelled_at
from {{ ref('stg_shop__subscriptions') }}
where cancelled_at < started_at
`;

const CONVERSION_MODEL_STARTER = `-- One row per signup_source (non-test customers only):
--   signup_source, customers, ordering_customers, conversion
-- ordering_customers = customers with at least one non-cancelled order (total_orders > 0 in dim_customers)
-- conversion = ordering_customers / customers, computed with your safe_divide macro

select 1 as todo
`;

const CONVERSION_MODEL_SOLUTION = `select
    signup_source,
    count(*)                                            as customers,
    count(*) filter (where total_orders > 0)             as ordering_customers,
    {{ safe_divide('count(*) filter (where total_orders > 0)', 'count(*)') }} as conversion
from {{ ref('dim_customers') }}
where not is_test_account
group by 1
`;

const SAFE_DIVIDE_STARTER = `-- Write a macro safe_divide(numerator, denominator) that returns null when the denominator is 0.
`;

const SAFE_DIVIDE_SOLUTION = `{% macro safe_divide(numerator, denominator) -%}
    case when ({{ denominator }}) = 0 then null else ({{ numerator }}) * 1.0 / ({{ denominator }}) end
{%- endmacro %}
`;

export const EXAM_B: Item[] = [
  // ------------------------------------------------------------------ quality
  {
    id: 'examb.quality.stale-mart',
    kind: 'mcq',
    domain: 'quality',
    difficulty: 2,
    title: 'Fresh sources, stale dashboard',
    prompt: '`dbt source freshness` passes every morning, yet the Growth dashboard still shows yesterday\'s numbers until about 11:00. What is the most likely gap, and the check that closes it?',
    options: [
      'Source freshness is broken; switch to a different EL tool',
      'Source freshness only proves the raw data arrived. The mart was rebuilt late (or the BI extract refreshed late). Add a recency check on the mart itself (e.g. `dbt_utils.recency` or a freshness check on the model\'s max timestamp) and alert on the BI refresh',
      'The dashboard has too many charts',
      'The unique tests are too slow',
    ],
    correct: [1],
    explanation: 'Freshness is layered: sources, models and the BI cache can each be stale independently. Test freshness where people consume the data, not only where it lands.',
  },
  {
    id: 'examb.quality.singular-test',
    kind: 'dbt',
    domain: 'quality',
    difficulty: 3,
    title: 'Catch impossible subscriptions',
    prompt: `Finance found subscriptions that were "cancelled before they started". Complete the **singular test** \`tests/assert_subscription_dates_valid.sql\` so it returns exactly the offending rows of \`stg_shop__subscriptions\` (use \`ref()\`).

The check runs \`dbt test -s stg_shop__subscriptions\` and expects your test to flag the real bad rows: no more, no fewer.`,
    files: { 'tests/assert_subscription_dates_valid.sql': SUBS_TEST_STARTER },
    openFile: 'tests/assert_subscription_dates_valid.sql',
    command: 'dbt test -s stg_shop__subscriptions',
    checks: [
      { type: 'file-matches', file: 'tests/assert_subscription_dates_valid.sql', patterns: ["ref\\(\\s*['\"]stg_shop__subscriptions['\"]\\s*\\)"], label: 'Uses ref() to the staging model' },
      { type: 'test-failures', test: 'assert_subscription_dates_valid', failures: 2, label: 'Flags exactly the invalid rows' },
    ],
    solutionFiles: { 'tests/assert_subscription_dates_valid.sql': SUBS_TEST_SOLUTION },
    explanation: 'A singular test is just a query that returns the rows breaking a rule. Zero rows means pass. The generic alternative is `dbt_utils.expression_is_true` with `cancelled_at is null or cancelled_at >= started_at`. Mind the NULLs: an active subscription (cancelled_at null) is valid.',
  },
  {
    id: 'examb.quality.rename-upstream',
    kind: 'open',
    domain: 'quality',
    difficulty: 3,
    title: 'An upstream rename is coming',
    prompt: 'The shop backend team will rename `orders.status` to `orders.order_state` next sprint, with new values (`PAID`, `SHIPPED`, `DONE`, `REFUNDED`, `VOID`). Describe how you handle it end to end so no dashboard breaks or silently changes meaning.',
    minWords: 80,
    rubric: [
      'Absorb the change in staging: map the new column and values to the existing order_status vocabulary in stg_shop__orders, so marts and metrics keep the same interface',
      'Handle the transition window: support both columns/values (coalesce) or coordinate the cut-over date; backfill or historical consistency for old rows',
      'Tests guard the mapping: accepted_values on the mapped status, a test that no unmapped values slip through (fail on unknown), source schema/contract checks',
      'Process: ask the producer for a data contract / advance notice, agree a timeline, communicate to consumers, add CI checks for upstream schema drift',
      'Verification: compare counts/revenue by status before and after the change; a rollback plan',
    ],
  },
  // ------------------------------------------------------------------ business
  {
    id: 'examb.business.churn',
    kind: 'mcq',
    domain: 'business',
    difficulty: 2,
    title: '"What is our churn?"',
    prompt: 'The CFO asks "what\'s our churn?" for the subscription business. Which clarifications change the answer the most? **Select all that apply.**',
    options: [
      'Customer churn (share of subscribers lost) or revenue churn (share of MRR lost), and gross or net of expansion',
      'The period and the denominator: subscribers at the start of the month, or the average over the month',
      'Whether annual plans count as churned only at the end of their term, and how pauses/downgrades are treated',
      'Which font the board deck uses',
    ],
    correct: [0, 1, 2],
    explanation: 'Churn has several legitimate definitions that can differ by a factor of two. Agree on customer vs revenue churn, gross vs net, the period, the denominator and how annual plans count, then write it down.',
  },
  {
    id: 'examb.business.discount-aov',
    kind: 'numeric',
    domain: 'business',
    difficulty: 2,
    title: 'Discounted AOV',
    prompt: 'Marketing asks: what was the **average order value in USD** of **completed** orders placed in **Q1 2026** **with a discount code** (excluding test accounts)? Use `prod.fct_orders.amount_usd`. Give 2 decimals.',
    solution: `select avg(amount_usd) from prod.fct_orders
where order_status = 'completed' and not is_test_account and discount_code is not null
  and order_date between date '2026-01-01' and date '2026-03-31'`,
    tolerance: 0.006,
    explanation: 'Each filter changes the answer: status, test accounts, period and the discount flag. `amount_usd` is already net of the discount and includes shipping. State that when you report it.',
  },
  {
    id: 'examb.business.active-subscriber',
    kind: 'open',
    domain: 'business',
    difficulty: 2,
    title: 'Define "active subscriber"',
    prompt: 'Write the glossary entry for **Active subscribers** that Finance, Growth and the board deck will all use. Be specific enough that two analysts would get the same number.',
    minWords: 50,
    rubric: [
      'Point-in-time definition: counted at a specific date (e.g. end of day/month, UTC), not "during" a period',
      'Rule: started_at <= date and (cancelled_at is null or cancelled_at > date); one row per subscription or per customer stated explicitly',
      'Edge cases: data errors (cancelled before started) excluded, pauses/trials/grace periods, multiple subscriptions per customer, annual vs monthly treated the same for counting',
      'Owner, source model and where it lives (semantic layer metric), plus how it relates to MRR',
    ],
  },
  // ------------------------------------------------------------------ sql
  {
    id: 'examb.sql.top-product-per-currency',
    kind: 'sql',
    domain: 'sql',
    difficulty: 2,
    title: 'Best seller per currency',
    prompt: `For **completed** order lines placed in **Q2 2026**, return the product with the highest revenue **in local currency** for each \`currency\` (ties: product_name ascending). Use \`prod.fct_order_items\` (\`line_amount_local\`) and \`prod.dim_products\`.

Columns: \`currency\`, \`product_name\`, \`revenue_local\`.`,
    solution: `select i.currency, p.product_name, sum(i.line_amount_local) as revenue_local
from prod.fct_order_items i
join prod.dim_products p using (product_id)
where i.order_status = 'completed' and cast(i.ordered_at as date) between date '2026-04-01' and date '2026-06-30'
group by 1, 2
qualify row_number() over (partition by i.currency order by sum(i.line_amount_local) desc, p.product_name) = 1`,
    tables: ['prod.fct_order_items', 'prod.dim_products'],
    explanation: 'Summing local amounts is only valid within one currency, which is why the partition is per currency. To compare across currencies, convert first.',
  },
  {
    id: 'examb.sql.new-vs-returning',
    kind: 'sql',
    domain: 'sql',
    difficulty: 3,
    title: 'New vs returning customers',
    prompt: `Per month of **H1 2026**, split customers who placed a **non-cancelled** order that month into **new** (their first-ever non-cancelled order was in that month) and **returning** (it was earlier). Exclude test accounts.

Columns: \`month\` (date), \`new_customers\`, \`returning_customers\`. Order by month.`,
    solution: `with o as (
    select customer_id, date_trunc('month', order_date)::date as month
    from prod.fct_orders
    where order_status <> 'cancelled' and not is_test_account
),
firsts as (
    select customer_id, min(month) as first_month from o group by 1
)
select o.month,
       count(distinct o.customer_id) filter (where o.month = f.first_month) as new_customers,
       count(distinct o.customer_id) filter (where o.month > f.first_month) as returning_customers
from o join firsts f using (customer_id)
where o.month between date '2026-01-01' and date '2026-06-01'
group by 1
order by 1`,
    ordered: true,
    tables: ['prod.fct_orders'],
    explanation: 'Compute each customer\'s first month over all history before filtering to the reporting window. Filtering first would make every customer look "new" in January.',
  },
  {
    id: 'examb.sql.rows-vs-range',
    kind: 'mcq',
    domain: 'sql',
    difficulty: 2,
    title: 'ROWS vs RANGE',
    prompt: `You compute a running total over orders: \`sum(amount_usd) over (order by order_date)\`. Several orders share the same \`order_date\`. What does each of those rows show?

(With an ORDER BY and no explicit frame, the default is \`RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW\`.)`,
    options: [
      'A strictly increasing total, one order at a time',
      'The same value on every row of that date: the total through the end of that date, because RANGE treats rows with equal ORDER BY values as peers',
      'NULL for the duplicates',
      'An error, because the ORDER BY key is not unique',
    ],
    correct: [1],
    explanation: 'RANGE includes all peers of the current row. For an order-by-order running total, use `rows between unbounded preceding and current row` with a unique tie-breaker (e.g. `order by ordered_at, order_id`).',
  },
  // ------------------------------------------------------------------ modeling
  {
    id: 'examb.modeling.discount-allocation',
    kind: 'mcq',
    domain: 'modeling',
    difficulty: 2,
    title: 'Order-level discount, line-level fact',
    prompt: 'Discounts exist only at **order** level, but Merchandising wants **net revenue per product** from `fct_order_items`. What is the sound modelling choice?',
    options: [
      'Repeat the full order discount on every line',
      'Allocate the order discount to lines in proportion to each line\'s share of the order subtotal, document the rule, and test that allocated discounts sum back to the order discount',
      'Ignore discounts at line level forever',
      'Divide the discount by the number of products in the catalogue',
    ],
    correct: [1],
    explanation: 'When a measure exists at a coarser grain, either keep it at that grain or allocate it with a documented rule. Then test that the allocation reconciles. Repeating it on every line is fan-out double counting.',
  },
  {
    id: 'examb.modeling.surrogate-keys',
    kind: 'mcq',
    domain: 'modeling',
    difficulty: 3,
    title: 'Choosing a surrogate key',
    prompt: '`fct_order_items` needs a primary key, and the source line `id` is not trustworthy across re-syncs. Which approach is best?',
    options: [
      '`row_number() over ()` computed at build time',
      'A deterministic hash of the natural key, e.g. `dbt_utils.generate_surrogate_key([\'order_id\', \'product_id\'])`, with a unique test proving the natural key really is unique',
      'A random UUID generated per build',
      'The order_id alone',
    ],
    correct: [1],
    explanation: 'Keys must be stable across rebuilds so incremental merges, snapshots and downstream joins keep working. Row numbers and random UUIDs change on every build. Hash the natural key, and test its uniqueness.',
  },
  {
    id: 'examb.modeling.order-lifecycle',
    kind: 'sql',
    domain: 'modeling',
    difficulty: 3,
    title: 'Order lifecycle (accumulating snapshot)',
    prompt: `Build an accumulating-snapshot style result for orders placed in **March 2026**: one row per order with its milestones from \`prod.stg_shop__payments\`.

Columns: \`order_id\`, \`ordered_at\`, \`paid_at\` (first **success** payment \`created_at\`, null if none), \`refunded_at\` (first **refunded** row, null if none), \`seconds_to_pay\` (between ordered_at and paid_at, null if unpaid). Use \`prod.stg_shop__orders\` for the orders.`,
    solution: `select o.order_id, o.ordered_at,
       min(p.created_at) filter (where p.payment_status = 'success') as paid_at,
       min(p.created_at) filter (where p.payment_status = 'refunded') as refunded_at,
       date_diff('second', o.ordered_at, min(p.created_at) filter (where p.payment_status = 'success')) as seconds_to_pay
from prod.stg_shop__orders o
left join prod.stg_shop__payments p using (order_id)
where o.order_date between date '2026-03-01' and date '2026-03-31'
group by 1, 2`,
    tables: ['prod.stg_shop__orders', 'prod.stg_shop__payments'],
    explanation: 'An accumulating snapshot has one row per process instance and a column per milestone, filled in as it happens. Conditional `min()` collapses the event rows, and the LEFT JOIN keeps orders with no payments.',
  },
  // ------------------------------------------------------------------ dbt
  {
    id: 'examb.dbt.safe-divide',
    kind: 'dbt',
    domain: 'dbt',
    difficulty: 2,
    title: 'Write and use a macro',
    prompt: `1. In \`macros/safe_divide.sql\`, write a macro \`safe_divide(numerator, denominator)\` that renders SQL returning **null when the denominator is 0**, otherwise the division.
2. Complete \`models/marts/fct_signup_conversion.sql\`: one row per \`signup_source\` (non-test customers, from \`dim_customers\`) with \`customers\`, \`ordering_customers\` (customers with \`total_orders > 0\`) and \`conversion\` = ordering_customers / customers **using your macro**.

Column names are checked. The check runs \`dbt build -s fct_signup_conversion\`.`,
    files: { 'macros/safe_divide.sql': SAFE_DIVIDE_STARTER, 'models/marts/fct_signup_conversion.sql': CONVERSION_MODEL_STARTER },
    openFile: 'macros/safe_divide.sql',
    command: 'dbt build -s fct_signup_conversion',
    checks: [
      { type: 'file-matches', file: 'macros/safe_divide.sql', patterns: ['\\{%-?\\s*macro\\s+safe_divide\\s*\\('], label: 'Defines the safe_divide macro' },
      { type: 'file-matches', file: 'models/marts/fct_signup_conversion.sql', patterns: ['safe_divide\\('], label: 'The model uses the macro' },
      {
        type: 'model-equals',
        model: 'fct_signup_conversion',
        sql: `select signup_source, count(*) as customers, count(*) filter (where total_orders > 0) as ordering_customers,
  (count(*) filter (where total_orders > 0)) * 1.0 / count(*) as conversion
from prod.dim_customers where not is_test_account group by 1`,
        checkColumnNames: true,
        label: 'Correct counts and conversion per signup source',
      },
    ],
    solutionFiles: { 'macros/safe_divide.sql': SAFE_DIVIDE_SOLUTION, 'models/marts/fct_signup_conversion.sql': CONVERSION_MODEL_SOLUTION },
    explanation: 'Macros receive SQL fragments as strings and return SQL. Wrap the arguments in parentheses so expressions such as `a - b` survive, and multiply by `1.0` to avoid integer division on warehouses that truncate.',
  },
  {
    id: 'examb.dbt.selectors',
    kind: 'mcq',
    domain: 'dbt',
    difficulty: 2,
    title: 'Graph operators',
    prompt: 'Which selection builds `fct_orders` **and everything it depends on**, but nothing downstream of it?',
    options: ['`dbt build -s fct_orders+`', '`dbt build -s +fct_orders`', '`dbt build -s @fct_orders`', '`dbt build -s fct_orders`'],
    correct: [1],
    explanation: '`+model` adds ancestors and `model+` adds descendants. `@model` adds descendants plus all of their ancestors, which is useful in CI for building everything a change could affect.',
  },
  {
    id: 'examb.dbt.snapshots',
    kind: 'mcq',
    domain: 'dbt',
    difficulty: 3,
    title: 'Snapshot strategy',
    prompt: 'You snapshot `raw.customers` to keep history. When is the **check** strategy the better choice than **timestamp**?',
    options: [
      'Always; it is faster',
      'When the source has no reliable `updated_at` (it isn\'t bumped on every change), so changes must be detected by comparing the listed columns',
      'When the table is large',
      'When you want to ignore changes',
    ],
    correct: [1],
    explanation: 'The timestamp strategy trusts `updated_at` and is cheap. The check strategy compares the configured columns, which is robust when timestamps can\'t be trusted, at the cost of comparing more data. Also decide how hard deletes should be represented.',
  },
  // ------------------------------------------------------------------ warehouse
  {
    id: 'examb.warehouse.bq-cluster',
    kind: 'mcq',
    domain: 'warehouse',
    difficulty: 2,
    title: 'Partitioned, but still expensive',
    prompt: 'A 5 TB BigQuery events table is partitioned by `event_date`. A popular dashboard filters a **year** of data by `customer_id`, and each query still scans most of the year. What helps most?',
    options: [
      'Add more partitions by hour',
      'Cluster the table by `customer_id` (with the date partitioning kept) so blocks that can\'t match the filter are skipped',
      'Use `SELECT DISTINCT`',
      'Move the table to a different dataset',
    ],
    correct: [1],
    explanation: 'Partitioning prunes by date; clustering sorts data within partitions so filters on the clustered columns can skip blocks. Use partitioning for the time filter and clustering for the selective filter.',
  },
  {
    id: 'examb.warehouse.slow-merge',
    kind: 'mcq',
    domain: 'warehouse',
    difficulty: 3,
    title: 'The merge that keeps getting slower',
    prompt: 'An incremental model with `unique_key` and the merge strategy gets slower every week, although each run only brings a day of new rows. What is the likely cause and fix?',
    options: [
      'The warehouse is ageing; resize it',
      'The MERGE scans the whole target table to find matches. Restrict the target side to recent partitions (e.g. dbt `incremental_predicates`, or a partition-aware strategy such as insert_overwrite / microbatch) and cluster or partition on the key or date',
      'Switch to a view',
      'Remove the unique_key so duplicates are allowed',
    ],
    correct: [1],
    explanation: 'Without a predicate on the destination, each merge reads the growing target. Pruning the target side keeps runs proportional to new data, not to history.',
  },
  {
    id: 'examb.warehouse.diagnose',
    kind: 'order',
    domain: 'warehouse',
    difficulty: 2,
    title: 'Diagnosing a slow model',
    prompt: 'Order the steps for fixing a model that recently became slow.',
    steps: [
      'Reproduce and measure: run time, bytes/credits, row counts before and after',
      'Read the query profile to find the most expensive operator (scan, join, sort, spill)',
      'Check the data behind it: grain of the joined tables, row explosion, missing pruning filters',
      'Apply the smallest fix (pre-aggregate, prune columns, fix the join, incremental, clustering)',
      'Re-measure, and add a guard (row-count or uniqueness test, cost alert)',
    ],
    explanation: 'Measure, then locate, then explain, then fix, then prevent. Changing warehouse size before reading the profile usually just buys time at a higher price.',
  },
  // ------------------------------------------------------------------ workflow
  {
    id: 'examb.workflow.downstream-ci',
    kind: 'mcq',
    domain: 'workflow',
    difficulty: 2,
    title: 'CI fails on a model you didn\'t touch',
    prompt: 'You changed `stg_shop__orders`. Slim CI (`state:modified+`) fails on `fct_channel_roas`, a model owned by another team that you never opened. What should you do?',
    options: [
      'Exclude fct_channel_roas from CI so your PR can merge',
      'Treat it as a real signal: your change altered something that model depends on (a column, type, grain or value). Fix your change or coordinate with the owner before merging',
      'Rerun CI until it passes',
      'Merge anyway; their model is their problem',
    ],
    correct: [1],
    explanation: 'Building downstream models in CI exists to catch exactly this. A failure there is your change\'s blast radius. Contracts and model versions on public models make the agreement explicit.',
  },
  {
    id: 'examb.workflow.wap',
    kind: 'mcq',
    domain: 'workflow',
    difficulty: 3,
    title: 'Write–audit–publish',
    prompt: 'What does a **write-audit-publish** (blue/green) deployment of the warehouse give you?',
    options: [
      'Faster SQL',
      'Builds and tests run in a staging copy; only if the tests pass is that copy swapped in (or published) as production, so consumers never see a half-built or failing state',
      'Automatic documentation',
      'It removes the need for tests',
    ],
    correct: [1],
    explanation: 'WAP separates building from publishing. Variants include zero-copy clones plus a swap (Snowflake), dataset/view swaps, branch-based table formats (Iceberg/Nessie-style), and SQLMesh virtual environments.',
  },
  {
    id: 'examb.workflow.pr-description',
    kind: 'open',
    domain: 'workflow',
    difficulty: 2,
    title: 'Write the PR description',
    prompt: 'Write the pull request description for the fix to this morning\'s incident (deduplicating `stg_shop__orders`), as you would want a reviewer to read it.',
    minWords: 60,
    rubric: [
      'What and why: the duplicate re-delivered rows, the failing unique test, the impact (skipped marts, stale dashboards)',
      'How: dedupe on id keeping the latest _loaded_at (and why not select distinct)',
      'Validation: tests run, row counts before/after, downstream models built (state:modified+), comparison with prod',
      'Risk and rollout: what changes for consumers (none expected), follow-ups (CI on PRs, a test that would have caught it)',
      'Reviewer guidance: what to focus on; link to the incident / post-mortem',
    ],
  },
  // ------------------------------------------------------------------ orchestration
  {
    id: 'examb.orchestration.trigger',
    kind: 'mcq',
    domain: 'orchestration',
    difficulty: 2,
    title: 'When should dbt start?',
    prompt: 'The nightly dbt build is scheduled at 05:00 because "the shop sync usually finishes by 04:30". Twice this month the sync ran late and dbt built on partial data. Best fix?',
    options: [
      'Move dbt to 06:00',
      'Trigger the build from the sync\'s completion (a sensor or data-aware asset dependency in the orchestrator), and keep a freshness gate before publishing',
      'Run dbt every 10 minutes',
      'Ask the EL vendor to be faster',
    ],
    correct: [1],
    explanation: 'Time-based offsets encode a hope. Event- or data-aware triggers (Airflow sensors/assets, Dagster asset dependencies, dbt Cloud job chaining) start work when the inputs are actually ready.',
  },
  {
    id: 'examb.orchestration.microbatch',
    kind: 'mcq',
    domain: 'orchestration',
    difficulty: 3,
    title: 'Microbatch incremental models',
    prompt: 'Which statements about dbt\'s **microbatch** incremental strategy (dbt 1.9+) are accurate? **Select all that apply.**',
    options: [
      'You configure an `event_time` column and a `batch_size` (e.g. day), and dbt processes the model in time-bounded batches',
      'A failed batch can be retried without reprocessing the batches that succeeded',
      'Targeted backfills can be run for a time range (e.g. `--event-time-start` / `--event-time-end`)',
      'It removes the need to think about late-arriving data',
    ],
    correct: [0, 1, 2],
    explanation: 'Microbatch makes time the unit of work: batches, retries and backfills by range. Late data still needs a decision, such as a `lookback` setting or reprocessing recent batches.',
  },
  {
    id: 'examb.orchestration.late-events',
    kind: 'numeric',
    domain: 'orchestration',
    difficulty: 2,
    title: 'How late is late?',
    prompt: 'Events waiting in `ingest.events_pending` will arrive on the next sync. **How many of them have an `event_ts` earlier than the latest `event_ts` already in `raw.events`?** (That is how many rows an incremental filter on `event_ts > max(event_ts)` would silently drop.)',
    solution: `select count(*) from ingest.events_pending where event_ts < (select max(event_ts) from raw.events)`,
    explanation: 'Late arrivals are rows whose event time is behind the high-water mark when they land. Filter incrementals on load time, or reprocess a lookback window with a unique key.',
  },
  // ------------------------------------------------------------------ semantic
  {
    id: 'examb.semantic.arppu',
    kind: 'sql',
    domain: 'semantic',
    difficulty: 3,
    title: 'ARPPU in two periods',
    prompt: `Average revenue per paying customer (ARPPU), per \`signup_source\`, side by side for **H2 2025** and **H1 2026**: revenue (\`amount_usd\` of **completed**, non-test orders placed in the period) divided by the number of distinct customers with such an order in that period.

Columns: \`signup_source\`, \`arppu_2025h2\`, \`arppu_2026h1\`.`,
    solution: `select c.signup_source,
       sum(o.amount_usd) filter (where o.order_date between date '2025-07-01' and date '2025-12-31')
         / count(distinct o.customer_id) filter (where o.order_date between date '2025-07-01' and date '2025-12-31') as arppu_2025h2,
       sum(o.amount_usd) filter (where o.order_date between date '2026-01-01' and date '2026-06-30')
         / count(distinct o.customer_id) filter (where o.order_date between date '2026-01-01' and date '2026-06-30') as arppu_2026h1
from prod.fct_orders o
join prod.stg_shop__customers c using (customer_id)
where o.order_status = 'completed' and not o.is_test_account
group by 1`,
    tables: ['prod.fct_orders', 'prod.stg_shop__customers'],
    explanation: 'A ratio metric: aggregate the numerator and the denominator for the same slice, then divide. FILTER lets you compute two periods in one pass without a self-join.',
  },
  {
    id: 'examb.semantic.avg-of-avgs',
    kind: 'mcq',
    domain: 'semantic',
    difficulty: 2,
    title: 'Global AOV',
    prompt: 'A dashboard shows AOV per country. Someone adds a "global AOV" tile that averages the nine country AOVs. Why is that wrong, and what is right?',
    options: [
      'It is right as long as every country is included',
      'It weights each country equally regardless of order count. Global AOV = total revenue / total orders, computed from the summed parts (define AOV as a ratio metric)',
      'It should use the median of the country AOVs',
      'It should exclude the smallest country',
    ],
    correct: [1],
    explanation: 'Averages of averages ignore weights. Ratios must be re-aggregated from their numerator and denominator at whatever grain is asked, which is exactly what a semantic layer\'s ratio metric does.',
  },
  {
    id: 'examb.semantic.where-it-lives',
    kind: 'mcq',
    domain: 'semantic',
    difficulty: 3,
    title: 'Mart or semantic layer?',
    prompt: 'Which of these belong in the **semantic layer** (metric definitions) rather than being materialised as columns in a mart? **Select all that apply.**',
    options: [
      'Conversion rate = ordering customers / customers, sliceable by any dimension',
      'Revenue = sum(amount_usd) with the agreed filters (completed, non-test)',
      'The deduplication of re-delivered order rows',
      'Average order value as a ratio of revenue to orders',
    ],
    correct: [0, 1, 3],
    explanation: 'Aggregations and ratios that must stay correct at any grain belong in metrics. Row-level cleaning (dedupe, type casting, business keys) belongs in the transformation layer (staging and marts) that the semantic layer reads from.',
  },
  // ------------------------------------------------------------------ governance
  {
    id: 'examb.governance.erasure',
    kind: 'mcq',
    domain: 'governance',
    difficulty: 2,
    title: 'A right-to-erasure request',
    prompt: 'A customer invokes their GDPR right to erasure. Their email appears in the shop database, `raw.customers` (CDC history), a snapshot of customers, and `dim_customers`. What is a sound approach?',
    options: [
      'Delete the row from dim_customers only',
      'Delete or anonymise at the source and propagate it: remove or hash PII in raw history and snapshots too (they keep old versions), rebuild downstream models, follow your retention policy for backups, and log the request',
      'Do nothing; analytics data is exempt',
      'Add a filter in the BI tool',
    ],
    correct: [1],
    explanation: 'History tables (CDC, snapshots) keep PII long after the mart forgets it. A documented erasure process covers every layer. Minimising PII in analytics models in the first place makes this far easier.',
  },
  {
    id: 'examb.governance.versions',
    kind: 'mcq',
    domain: 'governance',
    difficulty: 2,
    title: 'When to version a model',
    prompt: '`fct_orders` is a public, contracted model used by Finance. Which change calls for a **new model version** (with a deprecation window for the old one)?',
    options: [
      'Adding a new column `has_discount`',
      'Changing the grain from one row per order to one row per order line, or removing/renaming `amount_usd`',
      'Fixing a typo in a column description',
      'Speeding up the SQL without changing its output',
    ],
    correct: [1],
    explanation: 'Breaking changes (grain, removed or renamed columns, changed types or meaning) get a new version so consumers can migrate on their own schedule. Additive changes don\'t need one.',
  },
  {
    id: 'examb.governance.llm-controls',
    kind: 'open',
    domain: 'governance',
    difficulty: 3,
    title: 'Governance before an AI assistant launches',
    prompt: 'The company wants an LLM assistant that answers business questions over the warehouse, using several LLM providers. List the governance controls you would require before launch, and why.',
    minWords: 80,
    rubric: [
      'Ground answers in governed metrics/semantic layer and documented models; restrict the agent to curated, described datasets',
      'Access control: the assistant inherits the user\'s permissions (row/column-level security), no service account with blanket access',
      'PII and data-residency rules for sending data to LLM providers: minimisation, masking, provider agreements, logging',
      'Quality and trust: evaluation set of known questions, citations to the metric/model used, a way to flag wrong answers',
      'Monitoring and audit: query logs, cost controls, ownership and an incident process',
    ],
  },
];
