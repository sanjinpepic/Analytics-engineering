import type { TheoryModule } from '../types';

export const sqlModule: TheoryModule = {
  id: 'sql',
  domain: 'sql',
  title: 'Analytic SQL for analytics engineers',
  summary:
    'Grain-aware joins, aggregation, NULL logic, window functions, deduplication and date work: the SQL that decides whether a number is right.',
  minutes: 22,
  sections: [
    {
      heading: 'Think in grain before you write a join',
      body: `The single most useful habit in analytics SQL is to say, out loud, **what one row means** before and after every step. \`prod.fct_orders\` is one row per order. \`prod.stg_shop__payments\` is one row per payment attempt, and at Tidepool an order can have a failed attempt followed by a successful one. Join the two and the result is no longer one row per order: it is one row per payment, and every order-level measure is repeated once per payment. That is **fan-out**, and it is the most common reason a dashboard number is quietly too high.

\`\`\`sql run
-- Joining an order-grain table to a payment-grain table repeats amount_usd
with joined as (
    select o.order_id, o.amount_usd, p.payment_id
    from prod.fct_orders as o
    join prod.stg_shop__payments as p on p.order_id = o.order_id
)
select
    count(*)                         as joined_rows,
    count(distinct order_id)         as orders,
    round(sum(amount_usd), 2)        as fanned_out_usd,
    (select round(sum(amount_usd), 2)
       from prod.fct_orders
      where order_id in (select order_id from joined)) as correct_usd
from joined
\`\`\`

The fix is never \`select distinct\` and never \`sum(distinct amount_usd)\` (two different orders can have the same amount). The fix is to **bring the many side to the grain of the one side first**, then join:

\`\`\`sql run
with payments_per_order as (
    select
        order_id,
        count(*)                                                         as payment_attempts,
        sum(case when payment_status = 'success' then amount_cents end) as paid_cents
    from prod.stg_shop__payments
    group by order_id
)
select
    o.order_id, o.amount_usd, p.payment_attempts, p.paid_cents
from prod.fct_orders as o
left join payments_per_order as p using (order_id)
order by p.payment_attempts desc nulls last, o.order_id
limit 5
\`\`\`

Rules of thumb that hold up in practice:

- **Know the key of each side.** If you cannot name the column(s) that make a row unique, you cannot predict the join result. Test it: \`count(*)\` vs \`count(distinct key)\`.
- **One-to-many joins are fine for row-level questions** ("list every payment with its order date"). They are dangerous only when you then aggregate a measure from the one side.
- **Check row counts around every join** while developing. A left join should never change the row count of the left table if the right side is unique on the join key. If it does, your assumption was wrong.
- **\`left join\` plus a \`where\` on the right table is an inner join.** \`where p.payment_status = 'success'\` removes the rows where \`p\` is NULL. Put the condition in the \`on\` clause if you want to keep unmatched left rows.

Interview pitfall: when asked "why is revenue doubled?", candidates jump to duplicates in the source. Sometimes that is it (raw.orders really does contain re-delivered rows), but first check whether a join changed the grain.`,
    },
    {
      heading: 'Aggregation and conditional aggregation',
      body: `\`group by\` collapses rows to the grain of the grouping columns. Every non-aggregated column in the select must be in the group by (DuckDB, Snowflake and Databricks also accept \`group by all\`, which is handy in exploration and slightly risky in models because adding a column silently changes the grain).

**Conditional aggregation** puts a condition inside the aggregate, so one pass over the table produces many metrics side by side. It replaces a pile of filtered subqueries and is how most pivoted reports are built:

\`\`\`sql run
select
    date_trunc('month', order_date)                                as order_month,
    count(*)                                                       as orders,
    count(*) filter (where order_status = 'completed')             as completed,
    sum(case when order_status = 'returned' then 1 else 0 end)     as returned,
    round(
        count(*) filter (where order_status = 'returned')
        / nullif(count(*) filter (where order_status in ('completed', 'returned')), 0)
    , 3)                                                           as return_rate
from prod.fct_orders
where not is_test_account
  and order_date >= date '2026-01-01'
group by 1
order by 1
\`\`\`

Things to notice:

- \`filter (where ...)\` is standard SQL and works in DuckDB and Postgres. Snowflake has \`count_if\`, BigQuery has \`countif\`; \`sum(case when ... then 1 else 0 end)\` works everywhere.
- The return rate's **denominator is a decision**: returned / (completed + returned) is "of orders that reached the customer, how many came back". Dividing by all orders, including cancelled and in-flight ones, gives a different and usually misleading number. Write the denominator down.
- \`nullif(x, 0)\` turns a zero denominator into NULL so the division yields NULL instead of an error.
- Watch integer division. In Postgres and Redshift \`3 / 4\` is \`0\`. DuckDB, Snowflake and BigQuery return a decimal or float for \`/\`, but multiply by \`1.0\` or cast when you write portable code.

\`having\` filters after aggregation (\`having count(*) > 1\` is the classic duplicate finder); \`where\` filters before. Filtering on an aggregate in \`where\` is a syntax error, and filtering on a raw column in \`having\` is legal in some engines but confusing. Keep each in its lane.`,
    },
    {
      heading: 'NULL semantics: three-valued logic traps',
      body: `NULL means "unknown", and any comparison with unknown is unknown, not false. \`where\` keeps only rows where the predicate is **true**, so unknowns disappear without an error. The traps an interviewer will reach for:

| Expression | Result | Why |
|---|---|---|
| \`NULL = NULL\` | NULL | two unknowns are not known to be equal |
| \`discount_code <> 'WELCOME10'\` on a NULL code | NULL | so orders without a code are dropped |
| \`count(*)\` | all rows | counts rows |
| \`count(discount_code)\` | non-NULL values | ignores NULLs |
| \`avg(x)\` | mean of non-NULL values | NULLs are not treated as 0 |
| \`x not in (1, 2, NULL)\` | never true | \`x <> NULL\` is unknown for every x |
| \`sum(x)\` over zero rows / all-NULL | NULL | not 0; wrap in \`coalesce\` if 0 is meant |

The \`not in\` trap deserves a demo. Tidepool has a few customers with no country. Ask "which of our target markets have no customers yet?" with \`not in\` and you get nothing:

\`\`\`sql run
with target_markets(country_code) as (
    values ('US'), ('GB'), ('IE'), ('ES')
)
select
    (select count(*) from target_markets
      where country_code not in (select country_code from prod.stg_shop__customers)) as not_in_count,
    (select count(*) from target_markets as t
      where not exists (
          select 1 from prod.stg_shop__customers as c
           where c.country_code = t.country_code)) as not_exists_count
\`\`\`

\`not exists\` (or a left join with \`where right.key is null\`, or DuckDB's \`anti join\`) does what you meant. In practice: **never use \`not in\` with a subquery**. Use it only with a literal list you control.

Null-safe comparison is \`is distinct from\` / \`is not distinct from\` (DuckDB, Postgres, Snowflake, BigQuery; Snowflake also has \`equal_null\`). It treats two NULLs as equal and NULL vs a value as different, which is exactly what you want when comparing two versions of a row in a snapshot or a change-detection query.

\`\`\`sql run
select
    count(*)                                                        as orders,
    count(discount_code)                                            as orders_with_code,
    count(*) filter (where discount_code <> 'WELCOME10')            as not_welcome_naive,
    count(*) filter (where discount_code is distinct from 'WELCOME10') as not_welcome_null_safe
from prod.stg_shop__orders
\`\`\`

Finally, \`avg\` ignoring NULLs is a feature when NULL means "not applicable" and a bug when NULL means "zero". A conversion rate computed as \`avg(converted_flag)\` where non-converters have NULL instead of 0 will report 100%.`,
    },
    {
      heading: 'Window functions: ranking, LAG and LEAD',
      body: `A window function computes a value **per row** using other rows, without collapsing them. Anatomy: \`fn() over (partition by ... order by ... frame)\`. Partition defines the group, order defines the sequence, frame defines which rows in the sequence are visible.

The three ranking functions differ only on ties:

\`\`\`sql run
select
    customer_id,
    total_orders,
    row_number() over (order by total_orders desc, customer_id) as row_num,
    rank()       over (order by total_orders desc)              as rnk,
    dense_rank() over (order by total_orders desc)              as dense_rnk
from prod.dim_customers
where not is_test_account
order by total_orders desc, customer_id
limit 10
\`\`\`

- \`row_number\` always produces 1, 2, 3 ... and breaks ties arbitrarily unless you add a tie-breaker. **Always add a deterministic tie-breaker** (here \`customer_id\`), or the same query can return different rows on different runs, which makes tests flaky and incremental models non-deterministic.
- \`rank\` gives ties the same number and leaves gaps (1, 1, 3).
- \`dense_rank\` gives ties the same number without gaps (1, 1, 2). Use it for "top 3 distinct values".

\`lag\` and \`lead\` look at the previous or next row in the partition. They are the workhorse of retention, churn and "time between events" questions:

\`\`\`sql run
select
    customer_id,
    order_id,
    order_date,
    lag(order_date) over (partition by customer_id order by ordered_at, order_id) as prev_order_date,
    order_date - lag(order_date) over (partition by customer_id order by ordered_at, order_id) as days_since_prev
from prod.fct_orders
where order_status <> 'cancelled'
order by customer_id, ordered_at
limit 10
\`\`\`

The first order per customer has a NULL \`prev_order_date\`. That is correct, and it is also the cheapest "is first order" flag you will ever write (\`fct_orders.customer_order_number\` is the \`row_number\` version of the same idea). \`first_value\`, \`last_value\` and \`nth_value\` exist too; \`last_value\` is a trap with the default frame, covered next.`,
    },
    {
      heading: 'Frames: running totals, moving averages, ROWS vs RANGE',
      body: `When a window has \`order by\` but no explicit frame, the SQL standard default is \`range between unbounded preceding and current row\`. **RANGE means "all rows with an order value up to and including mine", so ties are included together.** A running total over \`order_date\` at order grain jumps by a whole day at once, and every order on that day shows the same total:

\`\`\`sql run
select
    order_id,
    order_date,
    amount_usd,
    sum(amount_usd) over (order by order_date)                                         as default_range_frame,
    sum(amount_usd) over (order by order_date, order_id rows between unbounded preceding and current row) as rows_frame
from prod.fct_orders
order by order_date, order_id
limit 8
\`\`\`

\`rows\` counts physical rows; \`range\` works on the values of the order-by column. That difference matters again for moving averages. Aggregate to one row per day first, then:

\`\`\`sql run
with daily as (
    select order_date, sum(amount_usd) as revenue_usd
    from prod.fct_orders
    where order_status = 'completed' and not is_test_account
    group by order_date
)
select
    order_date,
    round(revenue_usd, 2) as revenue_usd,
    round(sum(revenue_usd) over (order by order_date rows between unbounded preceding and current row), 2) as running_total,
    round(avg(revenue_usd) over (order by order_date rows between 6 preceding and current row), 2)  as avg_last_7_rows,
    round(avg(revenue_usd) over (order by order_date range between interval 6 days preceding and current row), 2) as avg_last_7_days
from daily
order by order_date
limit 14
\`\`\`

If a day has no completed orders, it has no row, so "the last 7 rows" can span 9 calendar days. The \`range\` version uses calendar time correctly, but averages only the days that exist, so a zero-revenue day is still missing from the denominator. **The robust pattern is a date spine plus \`coalesce(revenue, 0)\`, then a \`rows\` frame**, covered in the dates section.

Other practical notes:

- \`last_value(x) over (order by t)\` with the default frame returns the current row's value, because the frame ends at the current row. Use \`rows between unbounded preceding and unbounded following\`, or flip the order and use \`first_value\`.
- Interval-based \`range\` frames are well supported in DuckDB and Postgres. BigQuery's \`range\` needs a single numeric order-by (people use \`unix_date(order_date)\`). Check your engine's docs before relying on it.
- Ranking functions (\`row_number\`, \`rank\`) ignore frames entirely.`,
    },
    {
      heading: 'QUALIFY and deduplication',
      body: `\`qualify\` filters on the result of a window function, the way \`having\` filters on aggregates. It is supported in DuckDB, Snowflake, BigQuery and Databricks. Postgres does not have it: wrap the window in a subquery and filter outside.

The canonical use is **"keep the latest version of each key"**. Tidepool's EL connector re-delivers order rows, sometimes with a newer status. Profile first:

\`\`\`sql run
select
    id,
    status,
    _loaded_at,
    row_number() over (partition by id order by _loaded_at desc) as version_rank
from raw.orders
qualify count(*) over (partition by id) > 1
order by id, _loaded_at
limit 10
\`\`\`

Then deduplicate in staging, as \`stg_shop__orders\` does:

\`\`\`sql
select *
from {{ source('shop', 'orders') }}
qualify row_number() over (partition by id order by _loaded_at desc) = 1
\`\`\`

Decisions hidden in that one line, each of which an interviewer may probe:

- **Which column orders "latest"?** \`_loaded_at\` (when we received it) and \`updated_at\` (when the source changed it) can disagree. \`stg_shop__customers\` uses \`updated_at desc, _loaded_at desc\` so a late re-delivery of an old version does not win.
- **Is the order deterministic?** If two rows share the same \`_loaded_at\`, add another tie-breaker or you will get flip-flopping results.
- **Exact duplicates vs versions.** If rows are byte-identical, \`select distinct\` is fine. If they are versions of the same entity, you need the window.
- **Where should it live?** Deduplicate once, as early as possible (staging), and put a \`unique\` test on the key immediately after. Do not let every downstream model re-solve it.

\`select distinct\` added late in a model "because there were duplicates" is a smell. It hides a grain problem upstream and costs a sort or hash over the whole result.`,
    },
    {
      heading: 'Dates: spines, gaps, sessionisation and ASOF joins',
      body: `**Date spines.** Aggregations only produce rows for dates that have data. Charts then draw a straight line across missing days, and moving averages are computed over the wrong window. Generate every date, then left join the facts to it:

\`\`\`sql run
with spine as (
    select cast(d as date) as order_date
    from generate_series(date '2026-06-01', date '2026-06-14', interval 1 day) as t(d)
),
se_orders as (
    select o.order_date, count(*) as orders
    from prod.fct_orders as o
    join prod.dim_customers as c using (customer_id)
    where c.country_code = 'SE'
    group by 1
)
select spine.order_date, coalesce(se_orders.orders, 0) as orders
from spine
left join se_orders using (order_date)
order by 1
\`\`\`

In dbt, \`dbt_utils.date_spine\` generates this portably; most teams materialise a \`dim_dates\` table once and reuse it. Note that \`coalesce(x, 0)\` is right for additive counts and wrong for something like "average basket size", where a day with no orders has no basket.

**Sessionisation** is the gaps-and-islands pattern applied to events: order each visitor's events by time, flag an event as starting a new session when the gap since the previous one exceeds a threshold (30 minutes is the web-analytics convention), then a running sum of the flags numbers the sessions.

\`\`\`sql run
with flagged as (
    select
        anonymous_id,
        event_ts,
        event_name,
        case
            when event_ts - lag(event_ts) over (partition by anonymous_id order by event_ts, event_id)
                 <= interval 30 minutes then 0
            else 1
        end as is_new_session
    from prod.stg_segment__events
)
select
    anonymous_id, event_ts, event_name, is_new_session,
    sum(is_new_session) over (partition by anonymous_id order by event_ts
                              rows between unbounded preceding and current row) as session_number
from flagged
order by anonymous_id, event_ts
limit 12
\`\`\`

The first event per visitor has a NULL lag, the comparison is NULL, and the \`else 1\` correctly starts session 1. Real implementations also split sessions at midnight or on a new \`utm_source\`, and must decide how to stitch \`anonymous_id\` to \`customer_id\` after login.

**ASOF joins** match each row to the most recent row on the other side at or before its timestamp. Tidepool's FX table has business days only, so a Saturday order needs Friday's rate:

\`\`\`sql run
select o.order_id, o.order_date, dayname(o.order_date) as weekday, fx.rate_date, fx.usd_per_unit
from prod.fct_orders as o
asof left join prod.stg_finance__fx_rates as fx
    on o.currency = fx.currency
   and o.order_date >= fx.rate_date
where o.currency = 'EUR' and dayofweek(o.order_date) in (0, 6)
order by o.order_date
limit 5
\`\`\`

DuckDB writes \`asof join ... on key and a.ts >= b.ts\`; Snowflake writes \`asof join ... match_condition (a.ts >= b.ts) on a.key = b.key\`. BigQuery has no ASOF join, so you either forward-fill the rate table over a date spine (often the better modelling choice anyway) or use a range join plus \`qualify row_number()\`.`,
    },
    {
      heading: 'Set operations and profiling a new table',
      body: `**Set operations** combine whole result sets with matching column lists:

- \`union all\` stacks rows and keeps duplicates. It is what you want 95% of the time (stacking sources, adding the USD row to FX rates).
- \`union\` (BigQuery: \`union distinct\`) also deduplicates, which costs a sort or hash and can silently drop legitimate identical rows.
- \`intersect\` and \`except\` (Snowflake also accepts \`minus\`) answer "in both" and "in A but not B". They compare **whole rows** and treat NULLs as equal, unlike \`=\`. That makes \`except\` a great reconciliation tool: \`(old except new) union all (new except old)\` lists every differing row between two versions of a model.
- DuckDB's \`union by name\` matches columns by name instead of position; useful when stacking tables whose columns drifted.

\`\`\`sql run
-- Customers who ordered in Q1 2026 but not in Q2 2026
select count(*) as lapsed_customers
from (
    select customer_id from prod.fct_orders where order_date between date '2026-01-01' and date '2026-03-31'
    except
    select customer_id from prod.fct_orders where order_date between date '2026-04-01' and date '2026-06-30'
)
\`\`\`

**Profiling** is the first thing you do with any new table, before writing a single model. One query answers most of the important questions: what is the grain, which columns are NULL, what range do dates cover, which categories exist.

\`\`\`sql run
select
    count(*)                                   as row_count,
    count(distinct id)                         as distinct_ids,
    count(*) - count(customer_id)              as null_customer_ids,
    count(distinct customer_id)                as distinct_customers,
    min(ordered_at)                            as first_order_at,
    max(ordered_at)                            as last_order_at,
    count(distinct status)                     as statuses,
    count(*) filter (where discount_cents > 0) as discounted_orders
from raw.orders
\`\`\`

\`row_count > distinct_ids\` tells you immediately that \`raw.orders\` is not unique on \`id\`. Follow up with a \`group by status\` for value distributions, an anti join against customers for orphans (Tidepool has legacy guest-checkout orders whose customer does not exist), and \`min\`/\`max\` on every numeric column for impossible values. In DuckDB, \`summarize raw.orders\` produces a per-column profile in one statement. In practice, paste your profiling results into the PR description of the first staging model: it documents your assumptions and becomes the basis for your tests.`,
    },
    {
      heading: 'Dialect notes: DuckDB, Snowflake, BigQuery',
      body: `Most analytic SQL is portable. The differences that bite when you move between warehouses:

| Task | DuckDB | Snowflake | BigQuery |
|---|---|---|---|
| Truncate to month | \`date_trunc('month', d)\` | \`date_trunc('month', d)\` | \`date_trunc(d, month)\` (argument order flipped) |
| Days between dates | \`date_diff('day', a, b)\` or \`b - a\` | \`datediff('day', a, b)\` | \`date_diff(b, a, day)\` |
| Generate dates | \`generate_series(d1, d2, interval 1 day)\` | \`generator(rowcount => n)\` + \`dateadd\` | \`unnest(generate_date_array(d1, d2))\` |
| Conditional count | \`count(*) filter (where ...)\` / \`count_if\` | \`count_if(...)\` | \`countif(...)\` |
| All columns but one | \`select * exclude (col)\` | \`select * exclude (col)\` | \`select * except (col)\` |
| Window filter | \`qualify\` | \`qualify\` | \`qualify\` |
| As-of join | \`asof join ... on k and a.t >= b.t\` | \`asof join ... match_condition (...) on ...\` | none: range join + \`qualify\` |
| Safe cast | \`try_cast(x as int)\` | \`try_cast(x as int)\` | \`safe_cast(x as int64)\` |
| Identifier quoting | \`"col"\` | \`"COL"\` (unquoted names fold to upper case) | backticks |

Habits that keep SQL portable and reviewable: lower-case keywords and snake_case names (a style choice, but pick one and lint it with SQLFluff or similar), explicit column lists in marts rather than \`select *\`, CTEs named after what they contain, and one logical step per CTE. In dbt, prefer cross-database macros (\`dbt.date_trunc\`, \`dbt.datediff\`, \`dbt_utils.date_spine\`) only where you genuinely need portability; most teams target a single warehouse and are better served by readable native SQL.`,
    },
  ],
  keyTerms: [
    { term: 'Grain', definition: 'What one row of a table or query result represents, e.g. one row per order. Every join and aggregation either preserves or changes it.' },
    { term: 'Fan-out', definition: 'Row multiplication caused by joining to the many side of a one-to-many relationship, which double-counts measures from the one side when you then aggregate.' },
    { term: 'Conditional aggregation', definition: 'Putting a condition inside an aggregate (FILTER, CASE, COUNT_IF) to compute several filtered metrics in one pass.' },
    { term: 'Three-valued logic', definition: 'SQL predicates evaluate to true, false or unknown (NULL); WHERE keeps only true, so NULL comparisons silently drop rows.' },
    { term: 'IS DISTINCT FROM', definition: 'Null-safe inequality: treats two NULLs as equal and NULL vs a value as different.' },
    { term: 'Window function', definition: 'A function computed per row over a set of related rows (partition, order, frame) without collapsing them.' },
    { term: 'Window frame', definition: 'The subset of the ordered partition visible to a window function. ROWS counts physical rows; RANGE works on order-by values and includes ties.' },
    { term: 'QUALIFY', definition: 'A clause that filters rows on the result of a window function, e.g. keeping row_number() = 1 for deduplication.' },
    { term: 'Date spine', definition: 'A generated table with one row per date (or other period) used to left join facts so that periods without data still appear.' },
    { term: 'Gaps and islands', definition: 'The pattern of grouping consecutive rows into runs using LAG to flag breaks and a running sum to number the runs; sessionisation is one instance.' },
    { term: 'ASOF join', definition: 'A join that matches each row to the latest row on the other side whose timestamp is at or before its own, e.g. the most recent FX rate.' },
    { term: 'Anti join', definition: 'Rows of A with no match in B, written as NOT EXISTS or LEFT JOIN ... WHERE b.key IS NULL; the safe replacement for NOT IN with a subquery.' },
  ],
  landscape: `**Snapshot as of mid-2026.** Analytic SQL itself changes slowly; the tooling around it has moved fast.

- **DuckDB went mainstream** as the local analytics engine: for prototyping models, testing in CI, and querying Parquet or Iceberg files directly. In 2025 the DuckDB team released **DuckLake**, a lakehouse format that keeps table metadata in a SQL database. It is worth knowing DuckDB's "friendly SQL" extensions (\`group by all\`, \`exclude\`, \`qualify\`, \`asof join\`, \`union by name\`) because several cloud warehouses have adopted similar conveniences.
- **Open table formats.** Apache Iceberg became the de-facto open table format, so the same tables are increasingly queried by more than one engine. Writing SQL that is clear about types, time zones and NULL handling matters more when you do not control every consumer.
- **SQL transpilation and parsing** went from niche to infrastructure. SQLGlot (now part of Fivetran after it acquired Tobiko Data in 2025) powers dialect translation and column-level lineage in several tools, and dbt Labs' Rust-based **dbt Fusion** engine (beta since May 2025, built on the SDF acquisition) parses SQL to catch errors before it reaches the warehouse.
- **LLM-written SQL** is now everyday reality. It makes the skills in this module more valuable, not less: generated queries are usually syntactically fine and wrong in exactly the ways covered here (fan-out, NULL logic, frames, denominators). Reviewing SQL for grain is a core AE skill in 2026.`,
  practice: [
    {
      kind: 'mcq',
      id: 'sql.not-in-null-trap',
      domain: 'sql',
      difficulty: 2,
      title: 'The NOT IN surprise',
      prompt: `A marketing manager asks which of four target countries have no Tidepool customers yet. You run:

\`\`\`sql
select country_code
from target_markets
where country_code not in (select country_code from prod.stg_shop__customers)
\`\`\`

It returns zero rows, but you know Ireland has no customers. What is the most likely cause?`,
      options: [
        'At least one customer has a NULL `country_code`, so `x NOT IN (..., NULL)` is never true',
        'NOT IN is case-sensitive, so `ie` does not match `IE`',
        'The subquery returns duplicate country codes, which NOT IN cannot handle',
        'NOT IN requires the subquery to be correlated with the outer query',
      ],
      correct: [0],
      explanation: `\`x not in (a, b, NULL)\` expands to \`x <> a and x <> b and x <> NULL\`. The last term is unknown for every x, so the whole predicate is never true and every row is filtered out. Tidepool has a dozen customers with no country. Use \`not exists\` or a left anti join instead. Duplicates in the subquery do not change the result of IN or NOT IN. Case sensitivity would affect a single value, not empty the result, and NOT IN does not need correlation.`,
    },
    {
      kind: 'mcq',
      id: 'sql.count-variants',
      domain: 'sql',
      difficulty: 1,
      title: 'COUNT variants',
      prompt: `\`prod.stg_shop__orders\` has 1,134 rows; 917 have a NULL \`discount_code\` and the rest use one of four codes. Select **all** statements that are true.`,
      options: [
        '`count(*)` returns 1,134',
        '`count(discount_code)` returns 217',
        '`count(distinct discount_code)` returns 5, because NULL counts as a distinct value',
        "`count(*) filter (where discount_code <> 'WELCOME10')` includes the 917 orders without a code",
      ],
      correct: [0, 1],
      explanation: `\`count(*)\` counts rows; \`count(col)\` counts non-NULL values (1,134 - 917 = 217). \`count(distinct col)\` also ignores NULLs, so it returns 4, not 5. \`discount_code <> 'WELCOME10'\` is unknown when the code is NULL, so those 917 rows are excluded; use \`is distinct from\` if you meant to include them.`,
    },
    {
      kind: 'mcq',
      id: 'sql.fan-out-payments',
      domain: 'sql',
      difficulty: 2,
      title: 'Revenue went up after a join',
      prompt: `A colleague adds payment method to the revenue report by joining \`fct_orders\` (one row per order) to \`stg_shop__payments\` (one row per payment attempt) on \`order_id\`, then sums \`amount_usd\`. Revenue is now about 16% higher than finance's figure. What is the best fix?`,
      options: [
        'Aggregate payments to one row per order (e.g. pick the successful payment method) before joining, then sum `amount_usd`',
        'Change `sum(amount_usd)` to `sum(distinct amount_usd)`',
        'Add `select distinct` to the final query',
        'Switch the join to a left join so orders without payments are kept',
      ],
      correct: [0],
      explanation: `Orders with a failed attempt followed by a success have two payment rows, so their order amount is counted twice: classic fan-out. Bring the payment side to order grain first, then join one-to-one. \`sum(distinct)\` would also collapse different orders that happen to have the same amount. \`select distinct\` on the final aggregated row does nothing, and on detail rows it only works if the rows are fully identical, which they are not (payment ids differ). A left join changes which orders are included but does not stop the duplication.`,
    },
    {
      kind: 'mcq',
      id: 'sql.rank-functions',
      domain: 'sql',
      difficulty: 1,
      title: 'Top three, with ties',
      prompt: `You want "customers with the three highest order counts", and if several customers tie on an order count they should all be included. Order counts are 9, 9, 8, 7, 7, 6. Which expression, filtered to \`<= 3\`, returns the customers with 9, 9 and 8 only?`,
      options: [
        '`rank() over (order by total_orders desc)`',
        '`dense_rank() over (order by total_orders desc)`',
        '`row_number() over (order by total_orders desc)`',
        '`ntile(3) over (order by total_orders desc)`',
      ],
      correct: [0],
      explanation: `\`rank\` gives 1, 1, 3, 4, 4, 6, so \`<= 3\` keeps 9, 9, 8: "top three customers, ties included". \`dense_rank\` gives 1, 1, 2, 3, 3, 4, so \`<= 3\` also keeps both 7s: that answers "customers with the top three distinct order counts", a different question. \`row_number\` keeps exactly three rows and breaks ties arbitrarily. \`ntile(3)\` splits the rows into three buckets and is unrelated to ranking ties.`,
    },
    {
      kind: 'mcq',
      id: 'sql.default-frame-ties',
      domain: 'sql',
      difficulty: 3,
      title: 'The running total that jumps',
      prompt: `At order grain you write \`sum(amount_usd) over (order by order_date) as running_revenue\`. A reviewer notices that every order on the same day shows the same running total, which already includes all of that day's orders. Why, and what fixes it?`,
      options: [
        'With ORDER BY and no frame, the default frame is RANGE ... CURRENT ROW, which includes all peers with the same order_date; use ROWS and a unique tie-breaker in the ORDER BY',
        'The window lacks a PARTITION BY, so the engine treats each date as its own partition',
        'SUM over a window always aggregates by the ORDER BY column; use a self-join instead',
        'The engine is non-deterministic; adding ORDER BY to the outer query fixes it',
      ],
      correct: [0],
      explanation: `The standard default frame is \`range between unbounded preceding and current row\`. RANGE is value-based, so all rows with the same \`order_date\` are peers and are included together. \`order by order_date, order_id rows between unbounded preceding and current row\` produces a true row-by-row running total. A missing PARTITION BY means one partition over the whole table, not one per date. Window sums do not group by the order column, and an outer ORDER BY changes presentation, not the computed values.`,
    },
    {
      kind: 'mcq',
      id: 'sql.qualify-latest',
      domain: 'sql',
      difficulty: 1,
      title: 'Keep the latest version',
      prompt: `\`raw.orders\` contains re-delivered rows: the same \`id\` can appear several times with increasing \`_loaded_at\`. Which query keeps exactly one row per order, the most recently loaded one?`,
      options: [
        '`select * from raw.orders qualify row_number() over (partition by id order by _loaded_at desc) = 1`',
        '`select distinct * from raw.orders`',
        '`select * from raw.orders qualify rank() over (partition by id order by _loaded_at) = 1`',
        '`select id, max(_loaded_at), max(status) from raw.orders group by id`',
      ],
      correct: [0],
      explanation: `\`row_number\` partitioned by the key and ordered by load time descending, filtered to 1, keeps the latest version. \`select distinct *\` only removes byte-identical rows; re-deliveries with a newer status survive. Ordering ascending keeps the oldest version, and \`rank\` could keep several rows on ties. \`max(status)\` picks the alphabetically largest status ("shipped" beats "completed"), not the status from the latest row: mixing columns from different versions is a subtle bug.`,
    },
    {
      kind: 'mcq',
      id: 'sql.left-join-where',
      domain: 'sql',
      difficulty: 2,
      title: 'The left join that went inner',
      prompt: `You want every customer, with their count of completed orders (zero if none):

\`\`\`sql
select c.customer_id, count(o.order_id) as completed_orders
from prod.dim_customers c
left join prod.fct_orders o on o.customer_id = c.customer_id
where o.order_status = 'completed'
group by 1
\`\`\`

Customers with no completed orders are missing. Why?`,
      options: [
        "For unmatched customers `o.order_status` is NULL, the WHERE predicate is not true, so those rows are removed; move the condition into the ON clause",
        '`count(o.order_id)` returns NULL for customers without orders, and GROUP BY drops NULL groups',
        'LEFT JOIN only keeps unmatched rows when the join key is nullable',
        'GROUP BY 1 groups by the first table only, so the joined rows are discarded',
      ],
      correct: [0],
      explanation: `The WHERE clause runs after the join. Unmatched customers have NULLs in every \`o\` column, \`NULL = 'completed'\` is unknown, and the row is dropped, turning the left join into an inner join. Customers with only cancelled orders are also dropped. Put \`and o.order_status = 'completed'\` in the ON clause. \`count(col)\` returns 0, not NULL, for a group with no non-NULL values, and GROUP BY does not drop NULL groups. The other two options describe behaviour that does not exist.`,
    },
    {
      kind: 'mcq',
      id: 'sql.asof-fx',
      domain: 'sql',
      difficulty: 2,
      title: 'Weekend FX rates',
      prompt: `\`stg_finance__fx_rates\` has one row per business day per currency. Orders happen every day. Converting with a plain equi-join on \`(currency, order_date = rate_date)\` leaves weekend orders without a rate. Select **all** reasonable fixes.`,
      options: [
        'An ASOF join matching the latest `rate_date <= order_date` for the same currency',
        'Forward-fill the rates onto a daily date spine in a model, then equi-join',
        "`coalesce(usd_per_unit, 1)` for the missing rows",
        'An inner join instead of a left join, so the weekend rows are excluded from revenue',
      ],
      correct: [0, 1],
      explanation: `Both the ASOF join (what \`fct_orders\` does) and a forward-filled daily rate table give each order the most recent business-day rate. The spine approach also works on warehouses without ASOF joins and gives you a reusable, testable model. Defaulting to 1.0 treats every currency as USD: a SEK order would be overstated about tenfold. An inner join silently drops weekend revenue, a much worse error than a slightly stale rate.`,
    },
    {
      kind: 'mcq',
      id: 'sql.avg-of-flags',
      domain: 'sql',
      difficulty: 2,
      title: 'The 100% conversion rate',
      prompt: `An analyst computes checkout conversion as \`avg(converted)\`, where \`converted\` is built with \`case when order_completed then 1 end\`. The result is exactly 1.0. What happened?`,
      options: [
        'The CASE has no ELSE, so non-converters are NULL; AVG ignores NULLs and averages only the 1s',
        'AVG over integers rounds to the nearest whole number',
        'AVG needs a GROUP BY to compute a ratio',
        'The flag should be boolean; AVG over integers is not defined',
      ],
      correct: [0],
      explanation: `\`case when ... then 1 end\` yields NULL for non-matching rows. \`avg\` skips NULLs, so the denominator is only the converters and the result is 1. Add \`else 0\`, or compute \`count_if(...) / count(*)\` explicitly so the denominator is visible. AVG over integers returns a decimal or float in modern warehouses, works without GROUP BY over the whole table, and is perfectly defined on integers.`,
    },
    {
      kind: 'mcq',
      id: 'sql.distinct-bandage',
      domain: 'sql',
      difficulty: 3,
      title: 'Review: SELECT DISTINCT as a fix',
      prompt: `In a PR, a model joining \`fct_orders\` to \`stg_segment__events\` produced duplicate order rows, and the author "fixed" it by adding \`select distinct\` to the final CTE. The \`unique\` test on \`order_id\` now passes. What is the strongest review comment?`,
      options: [
        'The duplicates reveal that the join is one-to-many; DISTINCT hides it, will break as soon as any event-level column differs, and costs a full dedup. Aggregate or pick one event per order before joining',
        'Approve: the unique test passing proves the model is correct',
        'Replace DISTINCT with GROUP BY on all columns, which is faster and semantically safer',
        'Add `qualify row_number() over (partition by order_id order by order_id) = 1` instead',
      ],
      correct: [0],
      explanation: `DISTINCT only collapses rows that are identical in every selected column. It works today by coincidence and becomes wrong the moment someone selects an event-level column. It also hides the real question: which event should be attached to an order? A passing unique test shows the symptom is gone, not that the logic is right. GROUP BY on every column is the same operation as DISTINCT. A row_number ordered by the partition key itself is non-deterministic: it picks an arbitrary event and can change between runs.`,
    },
    {
      kind: 'order',
      id: 'sql.sessionisation-steps',
      domain: 'sql',
      difficulty: 2,
      title: 'Build sessions from events',
      prompt: `Put the steps for sessionising \`stg_segment__events\` (30-minute inactivity rule) in the right order.`,
      steps: [
        'Partition events by visitor (anonymous_id) and order them by event_ts with a tie-breaker',
        'Use LAG to get each event’s previous event_ts within the visitor',
        'Flag an event as a new session when there is no previous event or the gap exceeds 30 minutes',
        'Take a running SUM of the flag over the same window to number sessions per visitor',
        'Group by visitor and session number to get session start, end, event count and landing page',
      ],
      explanation: `This is gaps-and-islands: compute the gap with LAG, turn breaks into 1/0 flags, and a running sum of the flags assigns an island (session) number. Only then can you aggregate to session grain. Aggregating before numbering is impossible because sessions do not exist yet as a column.`,
    },
    {
      kind: 'open',
      id: 'sql.profile-new-source',
      domain: 'sql',
      difficulty: 3,
      title: 'Profile a new source',
      prompt: `Tidepool's finance team starts loading a new table, \`raw.refunds\`, and asks you to add refunds to revenue reporting next week. Before writing any model, what profiling queries do you run, and what would each one tell you? Be specific about grain, keys, NULLs, relationships to existing tables and dates.`,
      placeholder: 'List the checks you would run and what each would reveal…',
      minWords: 80,
      rubric: [
        'Establishes the grain: compares count(*) with count(distinct candidate key) and looks for duplicate or re-delivered rows',
        'Profiles NULL rates and value distributions for key columns (status, reason, currency, amount sign)',
        'Checks relationships: orphan refunds without a matching order or payment, and refunds per order (one-to-many risk for later joins)',
        'Checks date coverage and plausibility: min/max timestamps, refunds dated before their order, timezone, late arrival via load timestamp',
        'Checks amounts: currency, cents vs units, negative vs positive convention, refunds exceeding the order amount',
        'Turns findings into documented assumptions and tests (unique, not_null, relationships) before modelling',
      ],
      sampleAnswer: `First the grain: count(*) vs count(distinct refund_id), and if they differ, group by id having count(*) > 1 to see whether duplicates are re-deliveries (compare _loaded_at) or genuine versions. Then column profiles: NULL counts per column, distinct values and counts for status, reason and currency, and min/max/sign of amount_cents, so I know whether refunds are stored as positive or negative and in cents or units. Next, relationships: an anti join to stg_shop__orders and stg_shop__payments for orphans, and refunds per order (max and distribution) because partial refunds make this one-to-many with orders and any join to fct_orders would fan out. Dates: min/max of created_at, refunds earlier than their order's ordered_at, timezone of the timestamp, and the gap between created_at and _loaded_at to see how late data arrives, which drives an incremental lookback. Finally compare refund totals with the existing 'refunded' payments and with finance's own monthly total. I would write the findings into the staging PR and turn each assumption into a test: unique and not_null on the id, relationships to orders, accepted_values on status, and a singular test that refunds never exceed the order amount.`,
    },
  ],
};
