/** SQL gym: graded drills against the Tidepool warehouse, from foundation to senior. */
import type { SqlItem } from './types';

export const GYM: SqlItem[] = [
  {
    id: 'gym.monthly-aov',
    kind: 'sql',
    domain: 'sql',
    difficulty: 1,
    title: 'Monthly revenue and AOV',
    prompt: `For **completed** orders in **2026** (exclude test accounts), return one row per month:

1. \`month\`: first day of the month (a date)
2. \`orders\`
3. \`revenue_usd\`: sum of \`amount_usd\`
4. \`aov_usd\`: average order value in USD

Order by month.`,
    solution: `select date_trunc('month', order_date)::date as month,
       count(*) as orders,
       sum(amount_usd) as revenue_usd,
       avg(amount_usd) as aov_usd
from prod.fct_orders
where order_status = 'completed'
  and not is_test_account
  and order_date >= date '2026-01-01'
group by 1
order by 1`,
    ordered: true,
    tables: ['prod.fct_orders'],
    hints: ["date_trunc('month', order_date) truncates to the month; cast to ::date."],
    explanation: 'Filter first (status, test accounts, period), then aggregate. AOV is `sum / count` per month, which here equals `avg(amount_usd)` because each row is one order.',
  },
  {
    id: 'gym.top-products',
    kind: 'sql',
    domain: 'sql',
    difficulty: 1,
    title: 'Best sellers',
    prompt: `Return the **5 products with the most units sold** in completed orders: \`product_name\`, \`units\`. Order by units descending, then product_name.`,
    solution: `select p.product_name, sum(i.quantity) as units
from prod.fct_order_items i
join prod.dim_products p using (product_id)
where i.order_status = 'completed'
group by 1
order by units desc, product_name
limit 5`,
    ordered: true,
    tables: ['prod.fct_order_items', 'prod.dim_products'],
    explanation: 'Item-grain facts carry the order status so you can filter without a join. A deterministic tie-breaker (`product_name`) makes `limit` reproducible.',
  },
  {
    id: 'gym.never-ordered',
    kind: 'sql',
    domain: 'sql',
    difficulty: 1,
    title: 'Signed up, never bought',
    prompt: `Per \`signup_source\`, how many customers (excluding test accounts) have **never placed a non-cancelled order**? Columns: \`signup_source\`, \`customers\`.`,
    solution: `select c.signup_source, count(*) as customers
from prod.stg_shop__customers c
where not c.is_test_account
  and not exists (
      select 1 from prod.fct_orders o
      where o.customer_id = c.customer_id and o.order_status <> 'cancelled'
  )
group by 1`,
    tables: ['prod.stg_shop__customers', 'prod.fct_orders'],
    hints: ['NOT EXISTS (correlated subquery) or a LEFT JOIN … WHERE o.order_id IS NULL. Beware of NOT IN with nulls.'],
    explanation: 'Anti-joins answer "who never…" questions. `NOT EXISTS` is null-safe; `NOT IN (subquery)` returns nothing if the subquery yields a single NULL.',
  },
  {
    id: 'gym.payment-retries',
    kind: 'sql',
    domain: 'sql',
    difficulty: 1,
    title: 'Payment retries',
    prompt: `How many orders had **at least one failed payment attempt followed by a successful one**? Return a single row with column \`orders\`.`,
    solution: `select count(*) as orders from (
    select order_id
    from prod.stg_shop__payments
    group by order_id
    having min(case when payment_status = 'failed' then created_at end)
         < max(case when payment_status = 'success' then created_at end)
)`,
    tables: ['prod.stg_shop__payments'],
    hints: ['Conditional aggregation: min(case when … failed …) and max(case when … success …) per order.'],
    explanation: 'Conditional aggregation turns event rows into per-entity facts in one pass. Cancelled orders only have failed attempts, so they correctly drop out.',
  },
  {
    id: 'gym.running-revenue',
    kind: 'sql',
    domain: 'sql',
    difficulty: 2,
    title: 'Running total',
    prompt: `For **June 2026**, return daily completed revenue and a running total: \`order_date\`, \`revenue_usd\`, \`running_revenue_usd\`. Only days with orders; exclude test accounts; order by date.`,
    solution: `select order_date,
       sum(amount_usd) as revenue_usd,
       sum(sum(amount_usd)) over (order by order_date rows between unbounded preceding and current row) as running_revenue_usd
from prod.fct_orders
where order_status = 'completed' and not is_test_account
  and order_date between date '2026-06-01' and date '2026-06-30'
group by 1
order by 1`,
    ordered: true,
    tables: ['prod.fct_orders'],
    explanation: 'A window over an aggregate: `sum(sum(x)) over (order by day)`. Write the frame explicitly (`rows between unbounded preceding and current row`). The default `range` frame treats ties as peers, which surprises people when dates repeat.',
  },
  {
    id: 'gym.days-to-second-order',
    kind: 'sql',
    domain: 'sql',
    difficulty: 2,
    title: 'Days to second order',
    prompt: `Using **non-cancelled** orders of non-test customers, compute per \`signup_source\` the **average number of days between a customer's first and second order** (customers with only one order don't count). Columns: \`signup_source\`, \`customers\`, \`avg_days_to_second\`.`,
    solution: `with o as (
    select f.customer_id, c.signup_source, f.ordered_at,
           lead(f.ordered_at) over (partition by f.customer_id order by f.ordered_at, f.order_id) as next_at,
           row_number() over (partition by f.customer_id order by f.ordered_at, f.order_id) as n
    from prod.fct_orders f
    join prod.stg_shop__customers c using (customer_id)
    where f.order_status <> 'cancelled' and not c.is_test_account
)
select signup_source,
       count(*) as customers,
       avg(date_diff('day', ordered_at, next_at)) as avg_days_to_second
from o
where n = 1 and next_at is not null
group by 1`,
    tables: ['prod.fct_orders', 'prod.stg_shop__customers'],
    hints: ['lead(ordered_at) over (partition by customer_id order by ordered_at) gives the next order on each row.', "date_diff('day', a, b) counts day boundaries."],
    explanation: "`lead()` puts the next order on the same row; keep each customer's first row. Note the `customer_order_number` column in fct_orders counts cancelled orders too, so it would be wrong here. Read the column docs.",
  },
  {
    id: 'gym.latest-payment',
    kind: 'sql',
    domain: 'sql',
    difficulty: 2,
    title: 'Latest payment per order',
    prompt: `For every order in \`prod.stg_shop__payments\`, take the **most recent payment row** (by \`created_at\`, ties broken by \`payment_id\` descending) and count orders per that latest \`payment_status\`. Columns: \`payment_status\`, \`orders\`.`,
    solution: `select payment_status, count(*) as orders
from (
    select *
    from prod.stg_shop__payments
    qualify row_number() over (partition by order_id order by created_at desc, payment_id desc) = 1
)
group by 1`,
    tables: ['prod.stg_shop__payments'],
    explanation: '`QUALIFY` filters on a window function without wrapping a subquery. It exists in Snowflake, BigQuery, Databricks and DuckDB. In Postgres/Redshift use a subquery with `where rn = 1`.',
  },
  {
    id: 'gym.dedupe-customers',
    kind: 'sql',
    domain: 'sql',
    difficulty: 2,
    title: 'Staging-style dedupe',
    prompt: `Write the core of a staging model on **\`raw.customers\`**: one row per customer (latest \`updated_at\`, ties by latest \`_loaded_at\`), with columns \`customer_id\`, \`email\` (lower-cased and trimmed), \`country_code\`.`,
    solution: `select id as customer_id, lower(trim(email)) as email, country as country_code
from raw.customers
qualify row_number() over (partition by id order by updated_at desc, _loaded_at desc) = 1`,
    tables: ['raw.customers'],
    explanation: 'Dedupe on the natural key, ordered by the change timestamp. Normalise identifiers at the same time. This is the most common staging pattern for CDC sources.',
  },
  {
    id: 'gym.top-per-category',
    kind: 'sql',
    domain: 'sql',
    difficulty: 2,
    title: 'Top 2 per category',
    prompt: `For each product \`category\`, return the **2 products with the most units sold** (completed orders): \`category\`, \`product_name\`, \`units\`, \`rank_in_category\` (1 or 2; ties broken by product_name).`,
    solution: `select category, product_name, units, rank_in_category
from (
    select p.category, p.product_name, sum(i.quantity) as units,
           row_number() over (partition by p.category order by sum(i.quantity) desc, p.product_name) as rank_in_category
    from prod.fct_order_items i
    join prod.dim_products p using (product_id)
    where i.order_status = 'completed'
    group by 1, 2
)
where rank_in_category <= 2`,
    tables: ['prod.fct_order_items', 'prod.dim_products'],
    explanation: 'Top-N per group = window function partitioned by the group. `row_number` gives exactly N; `rank`/`dense_rank` can return more on ties, so choose deliberately.',
  },
  {
    id: 'gym.mom-growth',
    kind: 'sql',
    domain: 'sql',
    difficulty: 2,
    title: 'Month-over-month growth',
    prompt: `Monthly completed orders (non-test) from **2025-07** to **2026-06**, with the previous month's count and growth: \`month\` (date), \`orders\`, \`prev_orders\`, \`growth\` (fraction, e.g. 0.12 for +12%; null when there's no previous month in the result). Order by month.`,
    solution: `with m as (
    select date_trunc('month', order_date)::date as month, count(*) as orders
    from prod.fct_orders
    where order_status = 'completed' and not is_test_account
      and order_date between date '2025-07-01' and date '2026-06-30'
    group by 1
)
select month, orders,
       lag(orders) over (order by month) as prev_orders,
       orders / lag(orders) over (order by month) - 1 as growth
from m
order by month`,
    ordered: true,
    tables: ['prod.fct_orders'],
    explanation: "`lag()` over the monthly aggregate gives the previous period. If months could be missing, join to a date spine first, or `lag` will compare against the wrong month.",
  },
  {
    id: 'gym.asof-fx',
    kind: 'sql',
    domain: 'sql',
    difficulty: 2,
    title: 'Weekend FX with an ASOF join',
    prompt: `\`raw.fx_rates\` only has **business days**. For **EUR** orders placed on a **Saturday or Sunday** in **March 2026** (\`prod.stg_shop__orders\`), return \`order_id\`, \`order_date\`, \`rate_date\` (the most recent rate on or before the order date) and \`usd_per_unit\`.`,
    solution: `select o.order_id, o.order_date, fx.rate_date, fx.usd_per_unit
from prod.stg_shop__orders o
asof join raw.fx_rates fx
  on fx.currency = o.currency and o.order_date >= fx.rate_date
where o.currency = 'EUR'
  and o.order_date between date '2026-03-01' and date '2026-03-31'
  and dayofweek(o.order_date) in (0, 6)`,
    tables: ['prod.stg_shop__orders', 'raw.fx_rates'],
    hints: ['DuckDB: ASOF JOIN … ON a.key = b.key AND a.ts >= b.ts picks the closest earlier match.', 'dayofweek(): 0 = Sunday, 6 = Saturday.'],
    explanation: 'An as-of join matches each row to the latest row at or before its timestamp. Without ASOF, use a correlated subquery or a window to forward-fill rates over a date spine. An equi-join on date drops every weekend order.',
  },
  {
    id: 'gym.sessionize',
    kind: 'sql',
    domain: 'sql',
    difficulty: 3,
    title: 'Sessionise events',
    prompt: `Sessionise \`prod.stg_segment__events\`: a new session starts for an \`anonymous_id\` when more than **30 minutes** have passed since its previous event (or on its first event). Return per \`device\`: \`device\`, \`sessions\`, \`avg_events_per_session\`.`,
    solution: `with e as (
    select *,
        case when lag(event_ts) over (partition by anonymous_id order by event_ts, event_id) is null
               or event_ts - lag(event_ts) over (partition by anonymous_id order by event_ts, event_id) > interval 30 minute
             then 1 else 0 end as is_new_session
    from prod.stg_segment__events
),
s as (
    select *, sum(is_new_session) over (partition by anonymous_id order by event_ts, event_id rows between unbounded preceding and current row) as session_number
    from e
)
select device,
       count(distinct anonymous_id || '-' || session_number) as sessions,
       count(*) / count(distinct anonymous_id || '-' || session_number) as avg_events_per_session
from s
group by 1`,
    tables: ['prod.stg_segment__events'],
    hints: ['Flag a session start with lag(event_ts) and a 30-minute gap.', 'A running sum of the flag numbers the sessions per anonymous_id.'],
    explanation: 'The classic pattern: **flag** boundaries with `lag()`, then **number** them with a running `sum()` of the flags. It is the same trick as gaps-and-islands.',
  },
  {
    id: 'gym.funnel',
    kind: 'sql',
    domain: 'semantic',
    difficulty: 2,
    title: 'June funnel',
    prompt: `For **June 2026**, count distinct visitors (\`anonymous_id\`) who performed each step at least once: \`product_viewed\`, \`add_to_cart\`, \`checkout_started\`, \`order_completed\`. Return \`step_number\` (1–4), \`event_name\`, \`visitors\`, \`pct_of_step_1\` (fraction). Order by step_number.`,
    solution: `with steps as (
    select * from (values (1, 'product_viewed'), (2, 'add_to_cart'), (3, 'checkout_started'), (4, 'order_completed')) as t(step_number, event_name)
),
counts as (
    select s.step_number, s.event_name, count(distinct e.anonymous_id) as visitors
    from steps s
    left join prod.stg_segment__events e
      on e.event_name = s.event_name
     and e.event_ts >= timestamp '2026-06-01' and e.event_ts < timestamp '2026-07-01'
    group by 1, 2
)
select step_number, event_name, visitors,
       visitors / first_value(visitors) over (order by step_number) as pct_of_step_1
from counts
order by step_number`,
    ordered: true,
    tables: ['prod.stg_segment__events'],
    explanation: 'A steps table (or spine) keeps all four rows even if one step had no events. This is a simple "did it ever" funnel. A strict funnel would require each step to happen after the previous one in the same session.',
  },
  {
    id: 'gym.retention',
    kind: 'sql',
    domain: 'semantic',
    difficulty: 3,
    title: 'Cohort retention grid',
    prompt: `Monthly retention for customers (non-test) whose **first completed order** was in **Jan–Jun 2025**. For each \`cohort_month\` (date) and \`months_since\` (0–6), return \`active_customers\`: cohort customers with a completed order in that month. Columns: \`cohort_month\`, \`months_since\`, \`active_customers\`. Include only combinations with at least one active customer.`,
    solution: `with completed as (
    select o.customer_id, date_trunc('month', o.order_date)::date as order_month
    from prod.fct_orders o
    where o.order_status = 'completed' and not o.is_test_account
),
cohorts as (
    select customer_id, min(order_month) as cohort_month
    from completed group by 1
    having min(order_month) between date '2025-01-01' and date '2025-06-01'
)
select c.cohort_month,
       date_diff('month', c.cohort_month, x.order_month) as months_since,
       count(distinct x.customer_id) as active_customers
from cohorts c
join completed x using (customer_id)
where date_diff('month', c.cohort_month, x.order_month) between 0 and 6
group by 1, 2`,
    tables: ['prod.fct_orders'],
    explanation: 'Cohort analysis = (1) assign each entity to a cohort by its first event, (2) measure activity relative to that start. `count(distinct)` matters because a customer can order twice in a month.',
  },
  {
    id: 'gym.mrr',
    kind: 'sql',
    domain: 'semantic',
    difficulty: 3,
    title: 'MRR from subscriptions',
    prompt: `Compute **USD** subscription MRR at each **month end** from January to June 2026, using \`prod.stg_shop__subscriptions\` with \`currency = 'USD'\` only.

- A subscription is active at month end if \`started_at <= month_end\` and (\`cancelled_at\` is null or \`cancelled_at > month_end\`).
- Annual plans are normalised to monthly (\`amount_cents / 12\`).
- Exclude broken rows where \`cancelled_at < started_at\`.

Columns: \`month_end\` (date), \`active_subscriptions\`, \`mrr_usd\` (dollars). Order by month_end.`,
    solution: `with months as (
    select (date_trunc('month', d) + interval 1 month - interval 1 day)::date as month_end
    from generate_series(date '2026-01-01', date '2026-06-01', interval 1 month) as g(d)
),
subs as (
    select * from prod.stg_shop__subscriptions
    where currency = 'USD' and (cancelled_at is null or cancelled_at >= started_at)
)
select m.month_end,
       count(s.subscription_id) as active_subscriptions,
       coalesce(sum(case when s.plan = 'annual' then s.amount_cents / 12.0 else s.amount_cents end), 0) / 100.0 as mrr_usd
from months m
left join subs s
  on s.started_at <= m.month_end and (s.cancelled_at is null or s.cancelled_at > m.month_end)
group by 1
order by 1`,
    ordered: true,
    tables: ['prod.stg_shop__subscriptions'],
    hints: ['Build a month spine with generate_series, then LEFT JOIN subscriptions active at each month end.', 'Normalise annual plans before summing.'],
    explanation: "MRR is a **point-in-time** (semi-additive) measure: you can sum it across subscriptions but not across months. The spine guarantees a row per month even when nothing is active, and annual plans must be normalised or MRR jumps in renewal months.",
  },
  {
    id: 'gym.scd2',
    kind: 'sql',
    domain: 'modeling',
    difficulty: 3,
    title: 'Build an SCD type 2',
    prompt: `From **\`raw.customers\`** (CDC history), build an SCD2 for customers **with more than one version**: \`customer_id\`, \`country\`, \`valid_from\` (\`updated_at\`), \`valid_to\` (the next version's \`updated_at\`, null for the current one), \`is_current\` (boolean).`,
    solution: `select id as customer_id, country,
       updated_at as valid_from,
       lead(updated_at) over (partition by id order by updated_at) as valid_to,
       lead(updated_at) over (partition by id order by updated_at) is null as is_current
from raw.customers
qualify count(*) over (partition by id) > 1`,
    tables: ['raw.customers'],
    explanation: '`lead()` closes each version at the start of the next. Joining facts to an SCD2: `on f.customer_id = d.customer_id and f.ts >= d.valid_from and (f.ts < d.valid_to or d.valid_to is null)`. dbt snapshots produce `dbt_valid_from` / `dbt_valid_to` the same way.',
  },
  {
    id: 'gym.streaks',
    kind: 'sql',
    domain: 'sql',
    difficulty: 3,
    title: 'Gaps and islands',
    prompt: `Find the **3 longest streaks of consecutive calendar days in 2026** on which at least one **referral** customer (non-test) placed a completed order. Return \`streak_start\`, \`streak_end\`, \`days\`. Order by days descending, then streak_start.`,
    solution: `with d as (
    select distinct o.order_date
    from prod.fct_orders o
    join prod.stg_shop__customers c using (customer_id)
    where o.order_status = 'completed' and not o.is_test_account and c.signup_source = 'referral'
      and o.order_date >= date '2026-01-01'
),
g as (
    select order_date, order_date - (row_number() over (order by order_date))::int as grp
    from d
)
select min(order_date) as streak_start, max(order_date) as streak_end, count(*) as days
from g
group by grp
order by days desc, streak_start
limit 3`,
    ordered: true,
    tables: ['prod.fct_orders', 'prod.stg_shop__customers'],
    hints: ['Subtract row_number() (as days) from each date: consecutive dates share the same result.'],
    explanation: 'Gaps-and-islands: `date - row_number()` is constant inside a run of consecutive dates, so it works as a group key. The same idea finds sessions, outages and subscription streaks.',
  },
  {
    id: 'gym.identity-stitching',
    kind: 'sql',
    domain: 'modeling',
    difficulty: 3,
    title: 'Identity stitching',
    prompt: `\`customer_id\` on events is only set **after** a visitor logs in. Stitch identities: any \`anonymous_id\` that was **ever** linked to a customer should have **all** its events attributed to that customer (each anonymous_id maps to at most one customer here).

Count \`order_completed\` events by whether they can be attributed to a customer after stitching: columns \`identity\` (\`'known'\` or \`'anonymous'\`) and \`events\`.`,
    solution: `with map as (
    select anonymous_id, max(customer_id) as stitched_customer_id
    from prod.stg_segment__events
    where customer_id is not null
    group by 1
)
select case when m.stitched_customer_id is not null then 'known' else 'anonymous' end as identity,
       count(*) as events
from prod.stg_segment__events e
left join map m using (anonymous_id)
where e.event_name = 'order_completed'
group by 1`,
    tables: ['prod.stg_segment__events'],
    explanation: 'Build an identity map (anonymous_id → customer_id) from identified events and join it back to everything. Real implementations handle many-to-many (shared devices) with rules or graph resolution, and keep the map as its own model.',
  },
  {
    id: 'gym.cac',
    kind: 'sql',
    domain: 'semantic',
    difficulty: 3,
    title: 'CAC by paid channel',
    prompt: `For **2026 H1** (Jan–Jun), compute customer acquisition cost for the paid channels \`paid_search\`, \`paid_social\` and \`partner\`:

- \`spend_usd\`: total spend in \`prod.stg_ads__marketing_spend\`
- \`new_customers\`: non-test customers with that \`signup_source\` whose **first completed order** was in H1 2026
- \`cac_usd\`: spend / new customers

Columns: \`channel\`, \`spend_usd\`, \`new_customers\`, \`cac_usd\`.`,
    solution: `with spend as (
    select channel, sum(spend_usd) as spend_usd
    from prod.stg_ads__marketing_spend
    where spend_date between date '2026-01-01' and date '2026-06-30'
    group by 1
),
new_customers as (
    select c.signup_source as channel, count(*) as new_customers
    from (
        select customer_id, min(order_date) as first_date
        from prod.fct_orders
        where order_status = 'completed' and not is_test_account
        group by 1
    ) f
    join prod.stg_shop__customers c using (customer_id)
    where f.first_date between date '2026-01-01' and date '2026-06-30'
    group by 1
)
select s.channel, s.spend_usd, coalesce(n.new_customers, 0) as new_customers,
       s.spend_usd / nullif(n.new_customers, 0) as cac_usd
from spend s
left join new_customers n using (channel)`,
    tables: ['prod.stg_ads__marketing_spend', 'prod.fct_orders', 'prod.stg_shop__customers'],
    hints: ['Aggregate spend and new customers separately to channel grain, then join (avoid fan-out).'],
    explanation: 'Aggregate each side to the same grain **before** joining: joining daily spend to customers multiplies rows. `nullif` guards the division. Real CAC debates are about attribution (signup field vs touch-based) and which costs to include. State them.',
  },
];
