/**
 * The practice drive: one simulated workday at Tidepool Coffee Co. (synthetic company).
 * Wed 1 July 2026. Every event belongs to one discipline; together they cover all ten.
 */
import type { DomainId, Item } from './types';

export interface WorkdayEvent {
  id: string;
  time: string;
  end: string;
  domain: DomainId;
  title: string;
  /** One line for the programme strip. */
  tagline: string;
  /** The message or situation that kicks the event off (Markdown). */
  brief: { from: string; channel: string; body: string };
  /** Theory module to revise first. */
  moduleId: DomainId;
  items: Item[];
}

const BROKEN_STG_ORDERS = `-- PR #212 "simplify stg_shop__orders" (merged yesterday by Sam)
-- removed the CTEs because "the source is already clean"

select
    id                       as order_id,
    customer_id,
    ordered_at,
    cast(ordered_at as date) as order_date,
    status                   as order_status,
    currency,
    shipping_cents,
    discount_code,
    discount_cents,
    _loaded_at
from {{ source('shop', 'orders') }}
`;

const FIXED_STG_ORDERS = `with source as (

    select * from {{ source('shop', 'orders') }}

),

deduplicated as (

    -- the connector re-delivers rows; the latest load is the truth
    select *
    from source
    qualify row_number() over (partition by id order by _loaded_at desc) = 1

)

select
    id                       as order_id,
    customer_id,
    ordered_at,
    cast(ordered_at as date) as order_date,
    status                   as order_status,
    currency,
    shipping_cents,
    discount_code,
    discount_cents,
    _loaded_at
from deduplicated
`;

const ORDER_HISTORY_STARTER = `-- One row per customer who has at least one COMPLETED order.
-- Only customers that exist in stg_shop__customers.
--
-- Columns (in this order):
--   customer_id, signup_source, is_test_account,
--   first_completed_order_at, second_completed_order_at (null if none),
--   completed_orders

with customers as (

    select * from {{ ref('stg_shop__customers') }}

),

orders as (

    select * from {{ ref('fct_orders') }}

)

select 1 as todo
`;

const ORDER_HISTORY_SOLUTION = `with customers as (

    select * from {{ ref('stg_shop__customers') }}

),

completed_orders as (

    select
        customer_id,
        ordered_at,
        row_number() over (partition by customer_id order by ordered_at, order_id) as completed_order_number
    from {{ ref('fct_orders') }}
    where order_status = 'completed'

)

select
    customers.customer_id,
    customers.signup_source,
    customers.is_test_account,
    min(completed_orders.ordered_at)                                                    as first_completed_order_at,
    max(case when completed_orders.completed_order_number = 2 then completed_orders.ordered_at end) as second_completed_order_at,
    count(*)                                                                            as completed_orders
from completed_orders
inner join customers using (customer_id)
group by 1, 2, 3
`;

const ORDER_HISTORY_REFERENCE = `with completed as (
  select customer_id, ordered_at,
         row_number() over (partition by customer_id order by ordered_at, order_id) as rn
  from prod.fct_orders where order_status = 'completed'
)
select c.customer_id, c.signup_source, c.is_test_account,
       min(ordered_at) as first_completed_order_at,
       max(case when rn = 2 then ordered_at end) as second_completed_order_at,
       count(*) as completed_orders
from completed join prod.stg_shop__customers c using (customer_id)
group by 1, 2, 3`;

const MARTS_YML_TESTS_STARTER = `version: 2

models:
  - name: fct_orders
    description: >
      One row per order. amount_usd uses the latest business-day FX rate on or before
      the order date. Includes every status; filter order_status yourself.
    columns:
      - name: order_id
        description: Primary key.
        data_tests: [unique, not_null]
      - name: customer_id
        # TODO: every order should point at a known customer (stg_shop__customers.customer_id).
        #       We know ~6 legacy guest-checkout orders don't. Make the test report them
        #       without failing the nightly build.
      - name: order_status
        # TODO: only placed, shipped, completed, returned, cancelled are valid
      - name: amount_usd
        # TODO: must never be null (it would mean an FX rate is missing)
      - name: customer_order_number
        description: 1 for the customer's first order (any status), 2 for the second, ...

  - name: dim_customers
    description: One row per customer with lifetime order stats (cancelled orders excluded).
    columns:
      - name: customer_id
        data_tests: [unique, not_null]
      - name: lifetime_value_usd
        description: Sum of completed orders in USD.

  - name: dim_products
    columns:
      - name: product_id
        data_tests: [unique, not_null]

  - name: fct_order_items
    columns:
      - name: order_item_id
        data_tests: [unique, not_null]
`;

const MARTS_YML_TESTS_SOLUTION = `version: 2

models:
  - name: fct_orders
    description: >
      One row per order. amount_usd uses the latest business-day FX rate on or before
      the order date. Includes every status; filter order_status yourself.
    columns:
      - name: order_id
        description: Primary key.
        data_tests: [unique, not_null]
      - name: customer_id
        data_tests:
          - relationships:
              arguments:
                to: ref('stg_shop__customers')
                field: customer_id
              config:
                severity: warn
      - name: order_status
        data_tests:
          - accepted_values:
              arguments:
                values: [placed, shipped, completed, returned, cancelled]
      - name: amount_usd
        data_tests: [not_null]
      - name: customer_order_number
        description: 1 for the customer's first order (any status), 2 for the second, ...

  - name: dim_customers
    description: One row per customer with lifetime order stats (cancelled orders excluded).
    columns:
      - name: customer_id
        data_tests: [unique, not_null]
      - name: lifetime_value_usd
        description: Sum of completed orders in USD.

  - name: dim_products
    columns:
      - name: product_id
        data_tests: [unique, not_null]

  - name: fct_order_items
    columns:
      - name: order_item_id
        data_tests: [unique, not_null]
`;

const FCT_ORDERS_MACRO_SOLUTION = `{{ config(materialized='table') }}

with orders as (

    select * from {{ ref('int_orders__amounts') }}

),

fx as (

    select * from {{ ref('stg_finance__fx_rates') }}

),

customers as (

    select customer_id, is_test_account from {{ ref('stg_shop__customers') }}

)

select
    orders.order_id,
    orders.customer_id,
    orders.ordered_at,
    orders.order_date,
    orders.order_status,
    orders.currency,
    orders.item_count,
    orders.discount_code,
    {{ cents_to_dollars('orders.total_cents') }}            as amount_local,
    round({{ cents_to_dollars('orders.total_cents') }} * fx.usd_per_unit, 2) as amount_usd,
    coalesce(customers.is_test_account, false)              as is_test_account,
    row_number() over (
        partition by orders.customer_id
        order by orders.ordered_at, orders.order_id
    )                                                       as customer_order_number
from orders
asof left join fx
    on orders.currency = fx.currency
    and orders.order_date >= fx.rate_date
left join customers
    on orders.customer_id = customers.customer_id
`;

const CONTRACT_YML_STARTER = `version: 2

models:
  - name: dim_customers
    description: One row per customer with lifetime order stats (cancelled orders excluded).
    config:
      contract:
        enforced: true
    columns:
      - name: customer_id
        data_type: integer
        data_tests: [unique, not_null]
      - name: email
        data_type: varchar
      - name: country_code
        data_type: varchar
      - name: signup_source
        data_type: varchar
      - name: created_at
        data_type: date
      - name: is_test_account
        data_type: boolean
      - name: first_order_at
        data_type: timestamp
      - name: last_order_at
        data_type: timestamp
      - name: total_orders
        data_type: bigint
      - name: lifetime_value_usd
        data_type: integer
`;

const CONTRACT_YML_SOLUTION = CONTRACT_YML_STARTER.replace('      - name: created_at\n        data_type: date', '      - name: created_at\n        data_type: timestamp').replace(
  '      - name: lifetime_value_usd\n        data_type: integer',
  '      - name: lifetime_value_usd\n        data_type: double',
);

const PAGE_VIEWS_STARTER = `{{
    config(
        materialized='incremental',
        unique_key='event_id'
    )
}}

-- Web analytics reads this table all day; rebuilding 3 months of events every hour
-- is what made last month's warehouse bill jump. One row per page_view event.

select
    event_id,
    anonymous_id,
    customer_id,
    event_ts,
    page_path,
    utm_source,
    device,
    _loaded_at
from {{ ref('stg_segment__events') }}
where event_name = 'page_view'

{% if is_incremental() %}
  -- only process new events
  and event_ts > (select max(event_ts) from {{ this }})
{% endif %}
`;

const PAGE_VIEWS_SOLUTION = PAGE_VIEWS_STARTER.replace(
  `  -- only process new events
  and event_ts > (select max(event_ts) from {{ this }})`,
  `  -- filter on when rows ARRIVED, not when they happened: mobile events land days late
  and _loaded_at > (select max(_loaded_at) from {{ this }})`,
);

export const WORKDAY: WorkdayEvent[] = [
  {
    id: 'incident',
    time: '08:30',
    end: '09:15',
    domain: 'quality',
    title: 'Overnight build failed',
    tagline: 'Triage a failing test and fix it',
    moduleId: 'quality',
    brief: {
      from: 'dbt job alert',
      channel: '#data-alerts',
      body: `**FAILED** — job \`nightly_prod\` at 05:12 UTC · 1 of 33 data tests failed

\`\`\`
FAIL 25 unique_stg_shop__orders_order_id
SKIP  int_orders__amounts, fct_orders, fct_order_items, dim_customers
\`\`\`

Yesterday afternoon Sam merged PR #212 *"simplify stg_shop__orders"*. The Growth dashboards read \`fct_orders\` and \`dim_customers\`, and the weekly revenue email goes out at 10:00.`,
    },
    items: [
      {
        id: 'wd.incident.first-move',
        kind: 'mcq',
        domain: 'quality',
        difficulty: 1,
        title: 'Your first move',
        prompt: `It's 08:30. Before touching any code, what is the most useful first thing to do?`,
        options: [
          'Re-run the nightly job — tests are sometimes flaky',
          'Check what is affected downstream (which marts were skipped, which dashboards and the 10:00 email read them) and post a short heads-up in the stakeholder channel',
          'Revert PR #212 immediately without looking',
          'Set the unique test to `severity: warn` so the job goes green',
        ],
        correct: [1],
        explanation: `Assess impact and communicate first: the marts were **skipped**, so prod still serves yesterday's data, which is stale but not wrong. Knowing that the 10:00 email depends on \`fct_orders\` tells you how urgent the fix is. A uniqueness failure on a primary key is deterministic, not flaky, so re-running wastes 20 minutes. Downgrading the test hides real duplicates that would double-count revenue. Reverting is a valid fix, but only after you understand the failure.`,
      },
      {
        id: 'wd.incident.status-changed',
        kind: 'numeric',
        domain: 'sql',
        difficulty: 2,
        title: 'What exactly is duplicated?',
        prompt: `Investigate \`raw.orders\`. The test says 25 order ids appear more than once.

**For how many of those duplicated order ids did the \`status\` change between deliveries?**

This tells you whether a plain \`select distinct\` would have been enough.`,
        starter: `select id, count(*) as deliveries, count(distinct status) as statuses
from raw.orders
group by id
having count(*) > 1
order by deliveries desc`,
        solution: `select count(*) from (select id from raw.orders group by id having count(*) > 1 and count(distinct status) > 1)`,
        hints: ['Group raw.orders by id and look at count(distinct status) for ids with more than one row.'],
        explanation: `Some re-delivered rows carry a **newer status** (placed → completed), and every re-delivery has a different \`_loaded_at\`. So \`select distinct\` keeps both rows. Deduplicate by key and keep the latest load: \`qualify row_number() over (partition by id order by _loaded_at desc) = 1\`.`,
      },
      {
        id: 'wd.incident.fix-stg-orders',
        kind: 'dbt',
        domain: 'quality',
        difficulty: 2,
        title: 'Fix stg_shop__orders',
        prompt: `Restore one row per order in \`stg_shop__orders\`: when the connector re-delivered an order, keep the **most recently loaded** row. Keep the same columns.

Then run the check. It runs \`dbt build -s stg_shop__orders+\` (the model and everything downstream), deferring unbuilt refs to prod.`,
        files: { 'models/staging/stg_shop__orders.sql': BROKEN_STG_ORDERS },
        openFile: 'models/staging/stg_shop__orders.sql',
        command: 'dbt build -s stg_shop__orders+',
        checks: [
          { type: 'tests-pass', require: ['unique_stg_shop__orders_order_id', 'not_null_stg_shop__orders_order_id'], label: 'Primary key tests on stg_shop__orders pass' },
          { type: 'model-equals', model: 'stg_shop__orders', sql: 'select * from prod.stg_shop__orders', checkColumnNames: true, label: 'Exactly one row per order, latest delivery kept' },
          { type: 'build-ok', label: 'Downstream models rebuild with no errors' },
        ],
        solutionFiles: { 'models/staging/stg_shop__orders.sql': FIXED_STG_ORDERS },
        hints: [
          'DuckDB, Snowflake, BigQuery and Databricks support QUALIFY: filter on a window function without a subquery.',
          'row_number() over (partition by id order by _loaded_at desc) = 1',
        ],
        explanation: `The fix is to deduplicate on the natural key and keep the latest \`_loaded_at\`. Put it in **staging**, the first model touching the source, so every downstream model inherits it. Ask for a regression guard too: the unique test you just saw fail *is* that guard. The process gap is that PR #212 should have failed CI, because Slim CI with \`state:modified+\` would have run this test before the merge.`,
      },
      {
        id: 'wd.incident.freshness',
        kind: 'mcq',
        domain: 'quality',
        difficulty: 2,
        title: 'Reading a freshness result',
        prompt: `While you're there you run \`dbt source freshness\`:

\`\`\`
1 of 3 freshness of shop.customers ... [WARN · last load 2026-06-29 19:27 · 37.0h old]
2 of 3 freshness of shop.orders    ... [PASS · 8.8h old]
3 of 3 freshness of segment.events ... [PASS]
\`\`\`

\`shop.customers\` has \`warn_after: 24h, error_after: 72h\`. What does this tell you, and what do you do?`,
        options: [
          'Nothing is wrong; WARN is informational and can be ignored',
          'The customers replication is lagging: today\'s new or changed customers are missing, so new customers\' orders will show without their latest attributes. Raise it with the platform team and flag it as a caveat on anything customer-level today',
          'The orders table is stale, because freshness on customers implies freshness on orders',
          'dim_customers will fail its unique test',
        ],
        correct: [1],
        explanation: `Freshness compares \`max(loaded_at_field)\` with now. A WARN means the EL feed for customers is behind (here, CDC lag) but not yet past the error threshold. Orders are fresh, so orders can reference customers whose latest version (email, country) hasn't arrived. That is a caveat, not a test failure, and the owner of the connector (Data Platform) needs to know.`,
      },
      {
        id: 'wd.incident.runbook',
        kind: 'order',
        domain: 'quality',
        difficulty: 1,
        title: 'Incident runbook',
        prompt: 'Put the incident steps in a sensible order.',
        steps: [
          'Detect: alert fires (failed test / freshness)',
          'Assess impact using lineage: which models, dashboards and people are affected',
          'Communicate: short status in the stakeholder channel with what is stale and an ETA',
          'Fix the root cause in a branch, with a test that would have caught it',
          'Deploy and re-run / backfill affected models, verify the numbers',
          'Write a short post-mortem and close the gap (e.g. CI on PRs)',
        ],
        explanation: 'Impact and communication come before the fix, because people need to know whether to trust the 10:00 email. The post-mortem matters most when it changes the process, here by adding Slim CI so this PR could not have merged.',
      },
    ],
  },
  {
    id: 'intake',
    time: '09:15',
    end: '10:00',
    domain: 'business',
    title: 'Stand-up and a vague request',
    tagline: 'Turn an ask into a metric spec',
    moduleId: 'business',
    brief: {
      from: 'Priya Raman · Head of Growth (synthetic)',
      channel: 'Direct message',
      body: `Hey! For Thursday's board deck I need **repeat purchase rate by acquisition channel**. My gut says referral is crushing it and we should move budget out of paid social. Can you get me the numbers by tomorrow? Just a table is fine.`,
    },
    items: [
      {
        id: 'wd.intake.questions',
        kind: 'mcq',
        domain: 'business',
        difficulty: 2,
        title: 'Which questions matter?',
        prompt: `You get to ask Priya a handful of questions before you build. **Select the four that most change the number.**`,
        options: [
          'What counts as a "repeat": a second order within a time window (e.g. 90 days of the first), or ever?',
          'Which orders count: completed only, or also returned / cancelled ones?',
          'Should I build it as a CTE or a subquery?',
          'Which customers form the cohort (e.g. first order in 2025), so recent customers aren\'t penalised for having had less time to repeat?',
          '"Acquisition channel": the signup_source field, or the UTM of the first session?',
          'Would you like the table in Looker or Hex?',
        ],
        correct: [0, 1, 3, 4],
        explanation: `Definition (window), inclusion (statuses, test accounts), cohort (fair observation window) and the channel attribution all **change the number**, so the stakeholder has to decide them. CTE versus subquery is your implementation detail. The BI tool is a delivery detail you can settle later. Asking "what decision will this inform?" is also strong: here it is a budget shift away from paid social, which tells you precision matters.`,
      },
      {
        id: 'wd.intake.spec',
        kind: 'open',
        domain: 'business',
        difficulty: 2,
        title: 'Write the metric spec',
        prompt: `Priya replies: *"90 days, completed orders, 2025 customers, signup_source is fine. Exclude our internal test accounts."*

Write the **metric definition** you'll build and share back with her: name, plain-English definition, formula, grain/dimensions, filters, edge cases, owner, and any caveats she should know before the board sees it.`,
        placeholder: 'Metric: Repeat purchase rate (90-day)…',
        minWords: 60,
        rubric: [
          'Precise definition: share of customers whose first completed order was in 2025 who placed a second completed order within 90 days of the first',
          'Formula with numerator and denominator and grain (per signup_source; also an overall total that is NOT the average of channel rates)',
          'Filters: completed orders only, test accounts excluded, orphan orders (unknown customers) excluded; timezone (UTC) stated',
          'Edge cases: customers whose first order is late in 2025 still have a full 90 days (data runs to June 2026); returns after the second order; channel = signup_source not marketing touch',
          'Caveats: small sample sizes per channel (e.g. partner has few customers), correlation not causation for the budget decision',
          'Ownership / where it will live (defined once, e.g. a metric in the semantic layer) and a sign-off from Priya',
        ],
        sampleAnswer: `**Repeat purchase rate (90-day), by signup channel.** Owner: Growth (Priya); built by Analytics Engineering.

**Definition.** Of customers whose *first completed order* was placed in calendar year 2025 (UTC), the share who placed a *second completed order* within 90 days of the first.

**Formula.** repeat_customers / cohort_customers, where cohort = customers with first completed order in 2025 and repeat = cohort customers with another completed order in (first_order_at, first_order_at + 90 days].

**Dimensions.** signup_source (organic, paid_search, paid_social, referral, partner) plus an overall total, calculated from the totals, not as an average of channel rates.

**Filters.** Completed orders only (returned and cancelled orders don't count). Internal @tidepool.test accounts are excluded. Orders from unknown customers (6 legacy guest orders) are excluded.

**Caveats.** Channel = the signup field, not marketing attribution. Partner and paid_social cohorts are small (dozens of customers), so differences of a few points are noise. This shows association, not that moving budget would change behaviour. I'd suggest showing counts next to rates.`,
        explanation: 'A good spec is short and unambiguous, and the stakeholder signs it off before you build. Defining the metric once (later, in the semantic layer) means the board deck, the dashboard and next quarter all agree.',
      },
      {
        id: 'wd.intake.today',
        kind: 'mcq',
        domain: 'business',
        difficulty: 2,
        title: '"Just give me something today"',
        prompt: `Priya: *"Honestly a rough number today is fine, we can make it perfect later."* What's the best response?`,
        options: [
          'Refuse: nothing ships without a dbt model and tests',
          'Send a quick query result immediately, without caveats, to keep her happy',
          'Agree to a quick, clearly labelled first cut today (definition, filters and known caveats stated), and plan the modelled, tested version as the source for the board deck',
          'Ask her to file a ticket and wait for sprint planning',
        ],
        correct: [2],
        explanation: 'Speed and rigour are not opposites. A labelled first cut with a written definition unblocks her without creating an untraceable number. The board deck should use the governed version. Refusing outright or sending numbers without caveats both damage trust.',
      },
    ],
  },
  {
    id: 'profiling',
    time: '10:00',
    end: '11:00',
    domain: 'sql',
    title: 'Profile the sources',
    tagline: 'Know the data before modelling it',
    moduleId: 'sql',
    brief: {
      from: 'You',
      channel: 'Notebook',
      body: 'Before building the repeat-rate model, profile the raw tables it depends on. Every answer below is a single number. Use the SQL scratchpad on each card.',
    },
    items: [
      {
        id: 'wd.profiling.cdc-versions',
        kind: 'numeric',
        domain: 'sql',
        difficulty: 1,
        title: 'CDC history',
        prompt: '`raw.customers` is change-data-capture history. **How many customers have more than one row?**',
        starter: 'select id, count(*) from raw.customers group by id order by 2 desc',
        solution: 'select count(*) from (select id from raw.customers group by id having count(*) > 1)',
        explanation: 'Each update to a customer writes a new row. Staging keeps the latest version with `qualify row_number() over (partition by id order by updated_at desc) = 1`. A snapshot or SCD2 model would keep every version.',
      },
      {
        id: 'wd.profiling.orphans',
        kind: 'numeric',
        domain: 'sql',
        difficulty: 1,
        title: 'Orphan orders',
        prompt: '**How many deduplicated orders (`prod.stg_shop__orders`) have a `customer_id` that does not exist in `prod.stg_shop__customers`?**',
        solution: 'select count(*) from prod.stg_shop__orders o left join prod.stg_shop__customers c using (customer_id) where c.customer_id is null',
        hints: ['An anti-join: LEFT JOIN customers and keep rows where the customer side is null (or use NOT EXISTS).'],
        explanation: 'These are the legacy guest-checkout orders. An inner join silently drops them, which is right for a customer metric but wrong for total revenue. Decide on purpose, and make it visible with a `relationships` test.',
      },
      {
        id: 'wd.profiling.null-country',
        kind: 'numeric',
        domain: 'sql',
        difficulty: 1,
        title: 'Missing countries',
        prompt: 'What **fraction** (0–1) of customers in `prod.stg_shop__customers` have no country? Give at least 3 decimals.',
        solution: 'select avg(case when country_code is null then 1.0 else 0 end) from prod.stg_shop__customers',
        tolerance: 0.0015,
        explanation: '`avg(case when … then 1.0 else 0 end)` is the idiomatic way to get a share. Watch out: `count(country_code)` skips nulls, so `count(country_code) / count(*)` gives the share **with** a country.',
      },
      {
        id: 'wd.profiling.messy-emails',
        kind: 'numeric',
        domain: 'sql',
        difficulty: 1,
        title: 'Messy emails',
        prompt: 'How many rows in `raw.customers` have an email that is **not** already lower-case and trimmed?',
        solution: 'select count(*) from raw.customers where email <> lower(trim(email))',
        explanation: 'Normalise identifiers once, in staging (`lower(trim(email))`), so joins and distinct counts work downstream.',
      },
      {
        id: 'wd.profiling.status-mix',
        kind: 'sql',
        domain: 'sql',
        difficulty: 1,
        title: 'Status mix',
        prompt: `From \`prod.fct_orders\`, return one row per \`order_status\` with:

1. \`order_status\`
2. \`orders\`: number of orders
3. \`share\`: that count as a fraction of all orders (0–1)

Exclude test accounts.`,
        solution: `select order_status, count(*) as orders, count(*) / sum(count(*)) over () as share
from prod.fct_orders
where not is_test_account
group by order_status`,
        tables: ['prod.fct_orders'],
        hints: ['A window over an aggregate: sum(count(*)) over () gives the grand total on every row.'],
        explanation: '`sum(count(*)) over ()` computes the total across groups without a second query. Note the 7% cancellation rate: it matters for any order-based metric.',
      },
    ],
  },
  {
    id: 'modelling',
    time: '11:00',
    end: '12:30',
    domain: 'modeling',
    title: 'Model the customer',
    tagline: 'Pick the grain, build the model',
    moduleId: 'modeling',
    brief: {
      from: 'You',
      channel: 'Plan',
      body: 'The repeat-rate metric needs, per customer, their first and second completed order. That logic will be reused (retention, LTV), so it belongs in a model, not in a one-off query.',
    },
    items: [
      {
        id: 'wd.modelling.grain',
        kind: 'mcq',
        domain: 'modeling',
        difficulty: 1,
        title: 'Choose the grain',
        prompt: 'What should the grain of `int_customers__order_history` be?',
        options: ['One row per order', 'One row per customer', 'One row per customer per month', 'One row per signup_source'],
        correct: [1],
        explanation: 'The question is about customers ("did this customer come back?"), so the reusable building block is one row per customer with their first and second completed order. Per-channel rates are an aggregation **on top** of it. Building at channel grain would bake one report into the model.',
      },
      {
        id: 'wd.modelling.order-history',
        kind: 'dbt',
        domain: 'modeling',
        difficulty: 2,
        title: 'Build int_customers__order_history',
        prompt: `Create the intermediate model \`int_customers__order_history\`: **one row per customer with at least one completed order** (only customers that exist in \`stg_shop__customers\`), with columns, in this order:

| column | meaning |
|---|---|
| \`customer_id\` | |
| \`signup_source\` | |
| \`is_test_account\` | |
| \`first_completed_order_at\` | timestamp of their first completed order |
| \`second_completed_order_at\` | timestamp of their second completed order, null if none |
| \`completed_orders\` | number of completed orders |

Use \`ref()\` for both inputs. Column names are checked.`,
        files: { 'models/intermediate/int_customers__order_history.sql': ORDER_HISTORY_STARTER },
        openFile: 'models/intermediate/int_customers__order_history.sql',
        command: 'dbt build -s int_customers__order_history',
        checks: [
          { type: 'file-matches', file: 'models/intermediate/int_customers__order_history.sql', patterns: ["ref\\(\\s*['\"]fct_orders['\"]\\s*\\)", "ref\\(\\s*['\"]stg_shop__customers['\"]\\s*\\)"], label: 'Uses ref() for its inputs (no hard-coded schemas)' },
          { type: 'build-ok', label: 'Model builds' },
          { type: 'model-equals', model: 'int_customers__order_history', sql: ORDER_HISTORY_REFERENCE, checkColumnNames: true, label: 'One correct row per customer' },
        ],
        solutionFiles: { 'models/intermediate/int_customers__order_history.sql': ORDER_HISTORY_SOLUTION },
        hints: [
          'Number each customer\'s completed orders with row_number() over (partition by customer_id order by ordered_at, order_id).',
          'Then group by customer: min(ordered_at) is the first; max(case when n = 2 then ordered_at end) is the second.',
        ],
        explanation: `A window function numbers each customer's completed orders, then a group-by collapses to customer grain. Tie-break with \`order_id\` so the result is deterministic. The inner join to customers drops the orphan orders on purpose, so document that in the model's YAML.`,
      },
      {
        id: 'wd.modelling.scd',
        kind: 'mcq',
        domain: 'modeling',
        difficulty: 2,
        title: 'Customers who move',
        prompt: `Finance asks for **revenue by customer country at the time of the order**. Some customers changed country (see the CDC history). \`dim_customers\` keeps only the latest version. What do you build?`,
        options: [
          'Nothing — use dim_customers.country_code; it is close enough',
          'A type 2 slowly changing dimension (valid_from / valid_to per customer version) and join orders on customer_id and ordered_at between valid_from and valid_to',
          'A type 1 SCD that overwrites the country',
          'Store country on every event row in raw.events',
        ],
        correct: [1],
        explanation: `"At the time of the order" is the textbook case for **SCD type 2**: keep each version with a validity range and join on the time. Type 1 (overwrite) is what \`dim_customers\` already does, and it rewrites history. In dbt you'd build this with a snapshot, or here directly from the CDC rows using \`lead(updated_at) over (partition by id order by updated_at)\` as \`valid_to\`.`,
      },
      {
        id: 'wd.modelling.where-logic',
        kind: 'mcq',
        domain: 'modeling',
        difficulty: 2,
        title: 'Where does the 90-day flag live?',
        prompt: 'Where should the definition of "repeated within 90 days" live so the board deck, the Growth dashboard and next quarter\'s analysis agree?',
        options: [
          'In each dashboard as a calculated field',
          'In a governed layer: a column or metric defined once in the dbt project / semantic layer, with documentation, that BI tools read',
          'In a spreadsheet the Growth team maintains',
          'In the raw layer, by asking engineering to add a column to the orders table',
        ],
        correct: [1],
        explanation: 'Business logic is defined **once**, in code, under version control, and every consumer reads it. Calculated fields in each BI tool drift apart. Pushing analytics logic into the source app couples product releases to reporting.',
      },
    ],
  },
  {
    id: 'platform-lunch',
    time: '12:30',
    end: '13:30',
    domain: 'orchestration',
    title: 'Lunch with the platform team',
    tagline: 'EL, CDC and orchestration',
    moduleId: 'orchestration',
    brief: {
      from: 'Jonas Berg · Data Platform (synthetic)',
      channel: 'Lunch',
      body: '"The customers WARN was our CDC connector: the replication slot lagged after a Postgres failover. Re-deliveries like this morning\'s happen when a sync retries. Also, we\'re finally moving the cron jobs to a proper orchestrator. Want to help design it?"',
    },
    items: [
      {
        id: 'wd.lunch.idempotent',
        kind: 'mcq',
        domain: 'orchestration',
        difficulty: 2,
        title: 'Retries and re-deliveries',
        prompt: 'EL syncs retry and can deliver the same rows twice. Which property of your models makes that harmless?',
        options: [
          'Materialising everything as views',
          'Idempotency: running the same model twice on the same inputs gives the same result (dedupe on keys, merge on unique_key rather than blind appends)',
          'Running dbt more often',
          'Turning on the warehouse result cache',
        ],
        correct: [1],
        explanation: 'Idempotent transformations (deduplicate in staging; `merge` or `delete+insert` on a unique key in incremental models) make retries, re-deliveries and backfills safe. Blind `append` incrementals are where duplicates sneak in.',
      },
      {
        id: 'wd.lunch.assets',
        kind: 'mcq',
        domain: 'orchestration',
        difficulty: 2,
        title: 'Why asset-based orchestration?',
        prompt: `Jonas is choosing between cron-style task DAGs and **asset-based** orchestration (e.g. Dagster software-defined assets with the dbt integration, or Airflow 3 assets). What is the main benefit for an AE?`,
        options: [
          'It makes SQL run faster',
          'The orchestrator understands each dbt model/table as an asset with upstream dependencies, so it can run things when their inputs update, show lineage and freshness, and backfill partitions selectively',
          'It removes the need for tests',
          'It replaces the EL tool',
        ],
        correct: [1],
        explanation: 'Asset-based orchestration models *data* (tables, models, files) rather than opaque tasks. With dbt integration, each model becomes an asset: data-aware scheduling, lineage, freshness checks and partition backfills come built in.',
      },
      {
        id: 'wd.lunch.pipeline',
        kind: 'order',
        domain: 'orchestration',
        difficulty: 1,
        title: 'The nightly pipeline',
        prompt: 'Order the steps of a healthy nightly pipeline.',
        steps: [
          'EL sync loads new source data (CDC / API connectors)',
          'Check source freshness; stop or alert if inputs are stale',
          'dbt build: models and their tests in DAG order',
          'Refresh BI extracts / semantic layer caches',
          'Notify: success summary or alert with failing nodes',
        ],
        explanation: 'Freshness gates protect you from publishing yesterday\'s data as today\'s. `dbt build` interleaves tests with models so a failing test stops bad data from flowing downstream.',
      },
      {
        id: 'wd.lunch.backfill',
        kind: 'mcq',
        domain: 'orchestration',
        difficulty: 3,
        title: 'Backfill after an outage',
        prompt: 'The events connector was down for 3 days and has now delivered the missing data. Your events model is incremental, filtering on a 1-day lookback of `_loaded_at`. What do you do?',
        options: [
          'Nothing: the next incremental run picks up everything loaded since its last run, because the filter is on `_loaded_at`',
          'Always full-refresh after any outage',
          'Delete the 3 days from the target and wait for the connector to re-deliver again',
          'Switch the model to a view',
        ],
        correct: [0],
        explanation: 'Because the filter is on **load time** (`_loaded_at > max(_loaded_at)` in the target), late data loaded today is picked up today, whatever its event timestamp. With an event-time filter you would need a lookback window wide enough or a targeted backfill (e.g. a microbatch or partition backfill). Full refreshes work, but they are the expensive hammer.',
      },
    ],
  },
  {
    id: 'tests-contracts',
    time: '13:30',
    end: '14:30',
    domain: 'dbt',
    title: 'Tests, a macro and a contract',
    tagline: 'Harden the marts',
    moduleId: 'dbt',
    brief: {
      from: 'Sam Okafor · AE (synthetic)',
      channel: '#analytics-eng',
      body: 'Sorry about PR #212! While we\'re at it: `fct_orders` has almost no tests, the `/ 100.0` is copy-pasted everywhere, and Finance wants a guarantee that `dim_customers` won\'t change shape under them. Can you take those?',
    },
    items: [
      {
        id: 'wd.tests.fct-orders-tests',
        kind: 'dbt',
        domain: 'quality',
        difficulty: 2,
        title: 'Add tests to fct_orders',
        prompt: `In \`models/marts/_marts.yml\`, add tests to \`fct_orders\`:

- \`customer_id\` must reference \`stg_shop__customers.customer_id\`, but we **know** about 6 legacy guest orders. The test should report them **without failing the build**.
- \`order_status\` only allows \`placed, shipped, completed, returned, cancelled\`.
- \`amount_usd\` must never be null.

The check runs \`dbt build -s fct_orders\`.`,
        files: { 'models/marts/_marts.yml': MARTS_YML_TESTS_STARTER },
        openFile: 'models/marts/_marts.yml',
        command: 'dbt build -s fct_orders',
        checks: [
          { type: 'tests-pass', require: ['accepted_values_fct_orders_order_status', 'not_null_fct_orders_amount_usd'], mustCatch: ['relationships_fct_orders_customer_id'], label: 'accepted_values and not_null pass; relationships flags the orphan orders' },
          { type: 'build-ok', label: 'The build still succeeds (known orphans only warn)' },
        ],
        solutionFiles: { 'models/marts/_marts.yml': MARTS_YML_TESTS_SOLUTION },
        hints: [
          'Generic tests take arguments; since dbt 1.10 they go under `arguments:`, and severity goes under `config:`.',
          '- relationships:\n    arguments: {to: ref(\'stg_shop__customers\'), field: customer_id}\n    config: {severity: warn}',
        ],
        explanation: '`severity: warn` is right for a **known, accepted** exception that you still want visible. The real fix is upstream (migrating guest orders) or an explicit `where` filter. Never downgrade a test just to get green, as in the morning incident.',
      },
      {
        id: 'wd.tests.macro',
        kind: 'dbt',
        domain: 'dbt',
        difficulty: 2,
        title: 'Use the cents_to_dollars macro',
        prompt: `The project already has \`macros/cents_to_dollars.sql\`. Refactor \`fct_orders\` so both money columns use \`{{ cents_to_dollars(...) }}\` instead of hand-written \`/ 100.0\`. The output must not change.`,
        files: {},
        openFile: 'models/marts/fct_orders.sql',
        command: 'dbt build -s fct_orders',
        checks: [
          { type: 'file-matches', file: 'models/marts/fct_orders.sql', patterns: ['cents_to_dollars\\(\\s*[\'"][^\'"]+[\'"]'], label: 'fct_orders calls the macro' },
          { type: 'file-matches', file: 'models/marts/fct_orders.sql', patterns: ['/\\s*100\\.0'], mustNot: true, label: 'No hand-written / 100.0 left' },
          { type: 'model-equals', model: 'fct_orders', sql: 'select * from prod.fct_orders', checkColumnNames: true, label: 'Output unchanged' },
        ],
        solutionFiles: { 'models/marts/fct_orders.sql': FCT_ORDERS_MACRO_SOLUTION },
        hints: ['Macros receive the column as a string: {{ cents_to_dollars(\'orders.total_cents\') }}', 'Open macros/cents_to_dollars.sql to see the signature.'],
        explanation: 'Macros keep logic DRY and testable in one place. Don\'t over-abstract, though: a macro that hides a one-liner can make models harder to read. Here it standardises rounding, which is a real convention.',
      },
      {
        id: 'wd.tests.contract',
        kind: 'dbt',
        domain: 'governance',
        difficulty: 3,
        title: 'Enforce a model contract',
        prompt: `Finance consumes \`dim_customers\`. Sam started a **contract** in \`models/marts/_dim_customers.yml\`, but the build fails. Make the contract match the model's real output (don't change the model's SQL), keeping \`contract: enforced: true\`.

Read the error in the log: it tells you which columns don't match. (The \`dim_customers\` entry has already been moved out of \`_marts.yml\` into this file.)`,
        files: {
          'models/marts/_dim_customers.yml': CONTRACT_YML_STARTER,
          'models/marts/_marts.yml': MARTS_YML_TESTS_SOLUTION.replace(
            `  - name: dim_customers
    description: One row per customer with lifetime order stats (cancelled orders excluded).
    columns:
      - name: customer_id
        data_tests: [unique, not_null]
      - name: lifetime_value_usd
        description: Sum of completed orders in USD.

`,
            '',
          ),
        },
        openFile: 'models/marts/_dim_customers.yml',
        command: 'dbt build -s dim_customers',
        checks: [
          { type: 'file-matches', file: 'models/marts/_dim_customers.yml', patterns: ['contract:\\s*\\n\\s*enforced:\\s*true'], label: 'Contract is still enforced' },
          { type: 'build-ok', label: 'dim_customers builds with its contract' },
        ],
        solutionFiles: { 'models/marts/_dim_customers.yml': CONTRACT_YML_SOLUTION },
        hints: ['Run the check and read the mismatch table in the log.', 'created_at is a timestamp in the source; lifetime_value_usd is a sum of decimals.'],
        explanation: 'An enforced contract makes the build fail **before** a shape change reaches consumers. That is the technical half of a data contract. The organisational half is ownership, SLAs, semantics and a versioning policy (`versions:` in dbt) for breaking changes.',
      },
      {
        id: 'wd.tests.unit-vs-data',
        kind: 'mcq',
        domain: 'dbt',
        difficulty: 2,
        title: 'Unit test or data test?',
        prompt: 'Which situation calls for a **dbt unit test** rather than a data test?',
        options: [
          'Checking that order_id is unique in production data',
          'Verifying that your "second completed order" logic handles ties, cancelled orders between completed ones, and customers with one order, using small hand-written input rows, before the model is built',
          'Checking source freshness',
          'Making sure amount_usd is never null in prod',
        ],
        correct: [1],
        explanation: 'Unit tests (dbt 1.8+) check **logic** against fixed inputs (`given` → `expect`) and run before the model is built. They are ideal for tricky edge cases. Data tests check **data** after it is built (uniqueness, nulls, relationships).',
      },
    ],
  },
  {
    id: 'performance',
    time: '14:30',
    end: '15:30',
    domain: 'warehouse',
    title: 'Make it fast and cheap',
    tagline: 'Incremental models and cost',
    moduleId: 'warehouse',
    brief: {
      from: 'Jonas Berg · Data Platform (synthetic)',
      channel: '#data-platform',
      body: 'Warehouse spend is up a lot this month. The top offender is a page-view model rebuilt hourly from all events. I\'ve drafted it as incremental, but the web team says some mobile sessions are missing. Can you take a look?',
    },
    items: [
      {
        id: 'wd.perf.incremental-late-data',
        kind: 'dbt',
        domain: 'warehouse',
        difficulty: 3,
        title: 'Fix the incremental filter',
        prompt: `\`models/marts/fct_page_views.sql\` is incremental, but **late-arriving mobile events** (\`_loaded_at\` days after \`event_ts\`) are being dropped.

Fix the incremental logic so that after the next EL sync, an incremental run gives **exactly the same table as a full refresh**.

The check builds the model, delivers the pending events from \`ingest.events_pending\` into \`raw.events\`, runs the model incrementally, and compares it with a full refresh.`,
        files: { 'models/marts/fct_page_views.sql': PAGE_VIEWS_STARTER },
        openFile: 'models/marts/fct_page_views.sql',
        command: 'dbt build -s fct_page_views',
        checks: [
          { type: 'build-ok', label: 'Model builds' },
          { type: 'config', model: 'fct_page_views', key: 'materialized', equals: 'incremental', label: 'Still materialised as incremental' },
          { type: 'incremental-equivalence', model: 'fct_page_views', label: 'Incremental run after late data equals a full refresh' },
        ],
        solutionFiles: { 'models/marts/fct_page_views.sql': PAGE_VIEWS_SOLUTION },
        hints: [
          'Compare event_ts and _loaded_at for a few rows in ingest.events_pending.',
          'Either filter on _loaded_at, or use a lookback window on event_ts; unique_key makes re-processing safe.',
        ],
        explanation: `Filtering on **event time** (\`event_ts > max(event_ts)\`) drops anything that happened earlier but arrived later. Filter on **load time** (\`_loaded_at\`), or reprocess a lookback window (\`event_ts > max(event_ts) - interval 3 day\`) and let \`unique_key\` merge away the overlap. On BigQuery/Snowflake, add partitioning/clustering on the date so the merge only touches recent partitions.`,
      },
      {
        id: 'wd.perf.bigquery',
        kind: 'mcq',
        domain: 'warehouse',
        difficulty: 2,
        title: 'BigQuery bill',
        prompt: 'On BigQuery **on-demand** pricing, which change most reliably cuts the cost of a dashboard query on a 2 TB events table?',
        options: [
          'Adding `LIMIT 100` to the query',
          'Partitioning the table by event date (and clustering by a common filter column), and making sure the query filters on the partition column so only the needed partitions are scanned',
          'Using a bigger reservation',
          'Converting the CTEs into subqueries',
        ],
        correct: [1],
        explanation: 'On-demand BigQuery bills **bytes scanned**. `LIMIT` doesn\'t reduce bytes scanned on a normal table. Partition pruning plus clustering, and selecting only the columns you need, does. `require_partition_filter` stops accidental full scans.',
      },
      {
        id: 'wd.perf.snowflake',
        kind: 'mcq',
        domain: 'warehouse',
        difficulty: 2,
        title: 'Snowflake credits',
        prompt: 'A Snowflake virtual warehouse used only by the hourly dbt job is `LARGE` and runs 4 minutes each hour, with `AUTO_SUSPEND = 3600`. What is the quickest cost win?',
        options: [
          'Lower AUTO_SUSPEND to ~60 seconds so the warehouse stops billing right after the job finishes',
          'Make it X-LARGE so it finishes faster',
          'Add clustering keys to every table',
          'Switch every model to views',
        ],
        correct: [0],
        explanation: 'Snowflake bills credits per second while a warehouse is running (with a 60-second minimum). With a 1-hour auto-suspend it stays up the whole hour, so you pay for about 56 idle minutes. Right-size afterwards, using the query profile to see whether the job is CPU- or spill-bound. Clustering keys help large, selectively filtered tables and cost credits to maintain.',
      },
      {
        id: 'wd.perf.diagnose',
        kind: 'mcq',
        domain: 'warehouse',
        difficulty: 3,
        title: 'A slow model',
        prompt: 'A mart that used to take 2 minutes now takes 40, and its row count jumped 30×. What is the most likely culprit?',
        options: [
          'The warehouse is too small',
          'A join fan-out: a join to a table that is not unique on the join key (e.g. joining payments at order grain), multiplying rows',
          'Too many CTEs',
          'The result cache is disabled',
        ],
        correct: [1],
        explanation: 'A sudden row explosion points to a **fan-out**: joining to something with multiple rows per key. Check the grain of each joined relation (a unique test on the key), aggregate before joining, and use the query profile to find the exploding join.',
      },
    ],
  },
  {
    id: 'ship',
    time: '15:30',
    end: '16:15',
    domain: 'workflow',
    title: 'Ship it: PR and CI',
    tagline: 'Review, Slim CI, merge',
    moduleId: 'workflow',
    brief: {
      from: 'GitHub',
      channel: 'Pull request #214',
      body: 'Sam opened PR #214 *"add channel ROAS mart"* and asked for your review. CI is configured in GitHub Actions.',
    },
    items: [
      {
        id: 'wd.ship.review',
        kind: 'mcq',
        domain: 'workflow',
        difficulty: 2,
        title: 'Review PR #214',
        prompt: `Here is the new model in PR #214. **Select every issue you would raise in review.**

\`\`\`sql
-- models/marts/fct_channel_roas.sql
select
    c.signup_source as channel,
    sum(o.amount_usd) as revenue,
    sum(s.spend_usd) as spend,
    sum(o.amount_usd) / sum(s.spend_usd) as roas
from prod.fct_orders o
join prod.dim_customers c on o.customer_id = c.customer_id
join prod.stg_ads__marketing_spend s on s.channel = c.signup_source
group by 1
\`\`\``,
        options: [
          'Hard-coded `prod.` schemas instead of `ref()`: breaks dev/CI environments and lineage',
          'Joining daily spend rows to every order on channel alone fans out, so both revenue and spend are hugely inflated. Aggregate each side to channel (and period) before joining',
          'No filter on order_status or test accounts, so cancelled orders and QA accounts count as revenue',
          'Division by zero is possible for channels with no spend (e.g. organic); use a safe divide / nullif',
          'It uses table aliases',
        ],
        correct: [0, 1, 2, 3],
        explanation: `The fan-out is the big one: \`marketing_spend\` has one row per channel per day, so each order joins to ~550 spend rows. Aggregate both sides to the same grain first. Hard-coded schemas bypass \`ref()\`, which means no lineage, no state selection and no dev isolation. Organic and referral have no spend, so \`nullif(spend, 0)\`. Aliases are fine.`,
      },
      {
        id: 'wd.ship.slim-ci',
        kind: 'mcq',
        domain: 'workflow',
        difficulty: 2,
        title: 'Slim CI',
        prompt: 'Which command makes the CI job build and test only what the PR changed and everything downstream of it, reading unchanged upstream models from production?',
        options: [
          '`dbt build`',
          '`dbt build --select state:modified+ --defer --state ./prod-artifacts`',
          '`dbt run --select +state:modified`',
          '`dbt test --select state:modified`',
        ],
        correct: [1],
        explanation: '`state:modified+` selects changed nodes **and their descendants**. `--defer` with `--state` (the prod `manifest.json`) resolves `ref()`s to unchanged upstream models in prod instead of rebuilding them. `+state:modified` would select ancestors, which is wasteful. `dbt test` alone doesn\'t build anything.',
      },
      {
        id: 'wd.ship.selectors',
        kind: 'mcq',
        domain: 'dbt',
        difficulty: 2,
        title: 'What does state:modified+ pick?',
        prompt: 'In this project you changed only `stg_shop__orders.sql`. Which models does `dbt build -s state:modified+` build?',
        options: [
          'Only stg_shop__orders',
          'stg_shop__orders, int_orders__amounts, fct_orders, fct_order_items, dim_customers',
          'Every model in the project',
          'stg_shop__orders and stg_shop__customers',
        ],
        correct: [1],
        explanation: 'The `+` suffix adds all descendants: `int_orders__amounts` and `fct_order_items` read it directly, `fct_orders` reads the intermediate model, and `dim_customers` reads `fct_orders`. Try it in the dbt workspace: edit the file and run `dbt build -s state:modified+`.',
      },
      {
        id: 'wd.ship.flow',
        kind: 'order',
        domain: 'workflow',
        difficulty: 1,
        title: 'From branch to prod',
        prompt: 'Order the steps for shipping a model change.',
        steps: [
          'Create a feature branch and develop against your dev schema',
          'Run the changed models and their tests locally (dbt build -s my_model+)',
          'Open a PR with a description: what, why, how it was validated',
          'CI runs lint + Slim CI build in an isolated schema',
          'Peer review and approval',
          'Merge to main; the production job deploys it on its next run',
        ],
        explanation: 'Validate before review, and let CI prove it in isolation. Reviewers then spend their attention on logic and design rather than on "does it run".',
      },
    ],
  },
  {
    id: 'metric',
    time: '16:15',
    end: '17:00',
    domain: 'semantic',
    title: 'Define the metric',
    tagline: 'Compute and govern repeat rate',
    moduleId: 'semantic',
    brief: {
      from: 'You',
      channel: 'Deliverable',
      body: 'Priya signed off the spec this morning. Now produce the numbers, and decide how the metric should live in the semantic layer so the next request is self-serve.',
    },
    items: [
      {
        id: 'wd.metric.repeat-rate',
        kind: 'sql',
        domain: 'semantic',
        difficulty: 3,
        title: 'Repeat purchase rate by channel',
        prompt: `Compute the signed-off metric.

- **Cohort:** customers (excluding test accounts) whose **first completed order** was in calendar year **2025**.
- **Repeat:** the customer placed **another completed order within 90 days** after the first (\`first < ordered_at <= first + 90 days\`).
- Use \`prod.fct_orders\` and \`prod.stg_shop__customers\` (only customers that exist there).

Return one row per \`signup_source\` with columns:
1. \`signup_source\`
2. \`cohort_customers\`
3. \`repeat_customers\`
4. \`repeat_rate\` (fraction 0–1)`,
        starter: `with first_orders as (

    select
        customer_id,
        min(ordered_at) as first_completed_order_at
    from prod.fct_orders
    where order_status = 'completed'
    group by 1

)

select *
from first_orders
limit 10`,
        solution: `with first_orders as (
    select o.customer_id, c.signup_source, min(o.ordered_at) as first_at
    from prod.fct_orders o
    join prod.stg_shop__customers c using (customer_id)
    where o.order_status = 'completed' and not c.is_test_account
    group by 1, 2
    having year(min(o.ordered_at)) = 2025
),
flagged as (
    select f.*,
        exists (
            select 1 from prod.fct_orders o2
            where o2.customer_id = f.customer_id
              and o2.order_status = 'completed'
              and o2.ordered_at > f.first_at
              and o2.ordered_at <= f.first_at + interval 90 day
        ) as is_repeat
    from first_orders f
)
select signup_source,
       count(*) as cohort_customers,
       count(*) filter (where is_repeat) as repeat_customers,
       avg(case when is_repeat then 1.0 else 0 end) as repeat_rate
from flagged
group by 1`,
        tables: ['prod.fct_orders', 'prod.stg_shop__customers'],
        hints: [
          'Find each customer\'s first completed order first; filter the cohort on its year with HAVING.',
          'Then test for a second completed order in the 90-day window (EXISTS, or a self-join, or lead()).',
          'Exclude test accounts before taking the first order.',
        ],
        explanation: `Two subtleties: (1) the **cohort** is defined on the first *completed* order, so filter statuses before taking \`min()\`; (2) the window is relative to each customer's first order. Referral comes out on top, but cohorts per channel are small, so show the counts beside the rates. Don't average channel rates for the total; compute it from summed counts.`,
      },
      {
        id: 'wd.metric.metricflow',
        kind: 'mcq',
        domain: 'semantic',
        difficulty: 2,
        title: 'Which metric type?',
        prompt: 'In the dbt Semantic Layer (MetricFlow), how should `repeat_purchase_rate_90d` be defined so it aggregates correctly when sliced by channel, country or month?',
        options: [
          'As a simple metric that averages a precomputed rate column',
          'As a **ratio** metric: numerator = count of repeat customers, denominator = count of cohort customers, both as measures on a customer-grain semantic model',
          'As a cumulative metric',
          'As a hard-coded number in the YAML',
        ],
        correct: [1],
        explanation: 'Ratios must be computed **after** aggregation: sum the numerator and the denominator for whatever slice is requested, then divide. Averaging a precomputed rate column gives every customer, or every channel, equal weight in the wrong way.',
      },
      {
        id: 'wd.metric.overall',
        kind: 'numeric',
        domain: 'semantic',
        difficulty: 2,
        title: 'The overall number',
        prompt: 'Priya also wants a single headline number: the repeat rate across **all** channels for the same cohort (0–1, at least 3 decimals). Careful: it is **not** the average of the five channel rates.',
        solution: `with first_orders as (
    select o.customer_id, min(o.ordered_at) as first_at
    from prod.fct_orders o join prod.stg_shop__customers c using (customer_id)
    where o.order_status = 'completed' and not c.is_test_account
    group by 1 having year(min(o.ordered_at)) = 2025
)
select avg(case when exists (select 1 from prod.fct_orders o2 where o2.customer_id = f.customer_id and o2.order_status = 'completed' and o2.ordered_at > f.first_at and o2.ordered_at <= f.first_at + interval 90 day) then 1.0 else 0 end)
from first_orders f`,
        tolerance: 0.0015,
        explanation: 'sum(repeat_customers) / sum(cohort_customers). The unweighted mean of channel rates over-weights tiny channels like partner.',
      },
    ],
  },
  {
    id: 'handoff',
    time: '17:00',
    end: '17:30',
    domain: 'governance',
    title: 'Document and hand off',
    tagline: 'Docs, PII and the Slack reply',
    moduleId: 'governance',
    brief: {
      from: 'You',
      channel: 'End of day',
      body: 'Close the loop: send Priya the result with caveats, document the new model, and sort out a governance question that came up.',
    },
    items: [
      {
        id: 'wd.handoff.slack',
        kind: 'open',
        domain: 'business',
        difficulty: 2,
        title: 'Reply to Priya',
        prompt: `Write the Slack reply to Priya with the repeat-rate results (use your numbers from 16:15), what the numbers do and don't support for her budget idea, and what's next. Keep it skimmable, as a busy Head of Growth would read it.`,
        placeholder: 'Hi Priya — repeat purchase rate (90-day) for customers whose first completed order was in 2025…',
        minWords: 60,
        rubric: [
          'Leads with the answer: the headline overall rate and the per-channel rates, with counts',
          'Restates the definition in one line (cohort, 90-day window, completed orders, test accounts excluded)',
          'Caveats: small cohorts (partner, paid_social), association not causation, channel = signup field not attribution',
          'Relates it to the decision (moving budget out of paid social): what it supports, and what further analysis would make the case (CAC, payback, incrementality)',
          'Next steps and where the governed number lives (dashboard / semantic layer), and an offer to walk through it',
          'Tone: concise and friendly, no jargon dump, mentions the morning incident only if relevant (e.g. data now verified)',
        ],
        sampleAnswer: `Hi Priya. Repeat rate (90-day) for customers whose first completed order was in 2025: **about 54% overall** (192 customers). By channel: referral 80% (30 customers), organic 56% (72), paid social 45% (33), paid search 43% (40), partner 41% (17).

Definition: second completed order within 90 days of the first. Test accounts excluded, returns and cancellations don't count.

What it supports: referral customers clearly come back more often, and organic is above average. What it doesn't (yet): paid social is in line with paid search and partner, and with cohorts this small a few points is noise. It also doesn't prove that moving spend would buy more repeaters. To make the budget case I'd add CAC and 6-month revenue per customer by channel. I can have that by Wednesday.

The numbers are on the Growth dashboard as a governed metric, so the board deck and dashboard will match. Happy to walk through it tomorrow.`,
        explanation: 'Answer first, then the definition, then caveats tied to the decision, then next steps. The numbers matter less than the judgement you show about what they mean.',
      },
      {
        id: 'wd.handoff.docs',
        kind: 'open',
        domain: 'governance',
        difficulty: 2,
        title: 'Document the model',
        prompt: 'Write the YAML properties for `int_customers__order_history`: a model description and column descriptions, plus the tests you would add. (Free text, YAML or prose.)',
        placeholder: `models:\n  - name: int_customers__order_history\n    description: …`,
        minWords: 40,
        rubric: [
          'Model description states the grain (one row per customer with ≥1 completed order) and the inclusion rules (completed only, customers that exist; orphan orders excluded)',
          'Column descriptions are specific (e.g. second_completed_order_at null when none; tie-break by order_id)',
          'Primary key tests: unique + not_null on customer_id',
          'Sensible extra tests: completed_orders >= 1 (expression or accepted range), second > first when not null, relationships to stg_shop__customers',
          'Mentions ownership/consumers (e.g. owner group, used by the repeat-rate metric) or a doc block for reused definitions',
        ],
        sampleAnswer: `models:
  - name: int_customers__order_history
    description: >
      One row per customer with at least one completed order. Only customers present in
      stg_shop__customers; legacy guest orders (unknown customer_id) are excluded.
      Feeds the repeat_purchase_rate_90d metric. Owner: analytics-engineering.
    columns:
      - name: customer_id
        data_tests: [unique, not_null, {relationships: {arguments: {to: ref('stg_shop__customers'), field: customer_id}}}]
      - name: first_completed_order_at
        description: Timestamp (UTC) of the first completed order.
        data_tests: [not_null]
      - name: second_completed_order_at
        description: Second completed order (ties broken by order_id); null if only one.
      - name: completed_orders
        data_tests:
          - dbt_utils.accepted_range: {arguments: {min_value: 1}}`,
        explanation: 'Good docs state grain, inclusion rules and ownership, which is what the next person (or an LLM agent reading your catalog) needs. Tests are part of the documentation: they are guarantees that run.',
      },
      {
        id: 'wd.handoff.pii',
        kind: 'mcq',
        domain: 'governance',
        difficulty: 2,
        title: 'Email addresses in the mart',
        prompt: 'Marketing analysts want `dim_customers` (which contains `email`) in the BI tool for everyone in the company. What is the right governance move?',
        options: [
          'Give everyone access; it is internal',
          'Tag `email` as PII, apply a masking policy or exclude it from the broadly shared model, grant unmasked access only to roles that need it, and document the policy',
          'Delete the email column from the warehouse entirely',
          'Copy the table into a spreadsheet without emails each week',
        ],
        correct: [1],
        explanation: 'Classify, then control access: tag PII columns, mask or omit them in broadly shared models, and grant unmasked access by role (least privilege). Keep it documented and automated (policy tags / masking policies managed in code, e.g. Terraform or dbt `grants`/`meta`). Deleting it breaks legitimate uses such as CRM sync.',
      },
    ],
  },
];

export const WORKDAY_ITEMS: Item[] = WORKDAY.flatMap((e) => e.items);
