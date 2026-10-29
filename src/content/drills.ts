/**
 * Generated SQL drills: templates with parameters (period, dimension, metric, window…) drawn
 * from a seed. Every seed is a fresh question whose answer key is the reference query, so the
 * learner practises the skill, not a memorised answer.
 */
import { mulberry32, pick, type Rng } from '../lib/prng';
import type { Difficulty, DomainId, SqlItem } from './types';

export interface DrillSpec {
  title: string;
  prompt: string;
  solution: string;
  ordered?: boolean;
  tables: string[];
}

export interface DrillTemplate {
  id: string;
  skill: string;
  domain: DomainId;
  difficulty: Difficulty;
  /** What the template trains, shown in the skill list. */
  summary: string;
  hints: string[];
  explanation: string;
  build: (rng: Rng) => DrillSpec;
}

// ------------------------------------------------------------------ parameter helpers
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Period {
  label: string;
  start: string;
  end: string;
}

function lastDay(y: number, m: number): string {
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function ym(y: number, m: number) {
  return `${y}-${String(m).padStart(2, '0')}`;
}
/** A month between Mar 2025 and Jun 2026 (enough orders to be interesting). */
function month(rng: Rng, from = [2025, 3], to = [2026, 6]): Period & { y: number; m: number } {
  const all: [number, number][] = [];
  for (let y = from[0]; y <= to[0]; y++) for (let m = 1; m <= 12; m++) if ((y > from[0] || m >= from[1]) && (y < to[0] || m <= to[1])) all.push([y, m]);
  const [y, m] = pick(rng, all);
  return { y, m, label: `${MONTH_NAMES[m - 1]} ${y}`, start: `${ym(y, m)}-01`, end: lastDay(y, m) };
}
function quarter(rng: Rng): Period {
  const q = pick(rng, [
    [2025, 1],
    [2025, 2],
    [2025, 3],
    [2025, 4],
    [2026, 1],
    [2026, 2],
  ] as const);
  const [y, n] = q;
  return { label: `Q${n} ${y}`, start: `${ym(y, (n - 1) * 3 + 1)}-01`, end: lastDay(y, n * 3) };
}
function period(rng: Rng): Period {
  const k = rng();
  if (k < 0.45) return month(rng);
  if (k < 0.85) return quarter(rng);
  return pick(rng, [
    { label: 'the second half of 2025', start: '2025-07-01', end: '2025-12-31' },
    { label: 'the first half of 2026', start: '2026-01-01', end: '2026-06-30' },
    { label: '2025', start: '2025-01-01', end: '2025-12-31' },
  ]);
}

interface StatusFilter {
  phrase: string;
  where: string;
}
const STATUSES: StatusFilter[] = [
  { phrase: 'completed orders', where: "o.order_status = 'completed'" },
  { phrase: 'non-cancelled orders', where: "o.order_status <> 'cancelled'" },
  { phrase: 'orders of any status', where: 'true' },
];

interface Metric {
  key: string;
  label: string;
  col: string;
  sql: string;
}
const METRICS: Metric[] = [
  { key: 'orders', label: 'number of orders', col: 'orders', sql: 'count(*)' },
  { key: 'revenue', label: 'revenue in USD (sum of amount_usd)', col: 'revenue_usd', sql: 'sum(o.amount_usd)' },
  { key: 'customers', label: 'distinct customers', col: 'customers', sql: 'count(distinct o.customer_id)' },
  { key: 'aov', label: 'average order value in USD', col: 'aov_usd', sql: 'avg(o.amount_usd)' },
];

interface Dim {
  label: string;
  plural: string;
  col: string;
  expr: string;
  join: boolean;
  note?: string;
}
const DIMS: Dim[] = [
  { label: 'signup source', plural: 'signup sources', col: 'signup_source', expr: 'c.signup_source', join: true },
  { label: 'country', plural: 'countries', col: 'country_code', expr: "coalesce(c.country_code, 'unknown')", join: true, note: "Use `'unknown'` when the customer has no country." },
  { label: 'currency', plural: 'currencies', col: 'currency', expr: 'o.currency', join: false },
];

const ORDERS_FROM = (d: Dim | null) => (d?.join || d === null ? 'prod.fct_orders o\njoin prod.stg_shop__customers c using (customer_id)' : 'prod.fct_orders o');

function between(p: Period, col = 'o.order_date') {
  return `${col} between date '${p.start}' and date '${p.end}'`;
}

function lines(...xs: (string | false | undefined)[]) {
  return xs.filter((x): x is string => typeof x === 'string').join('\n');
}

// ------------------------------------------------------------------ templates
export const DRILL_TEMPLATES: DrillTemplate[] = [
  {
    id: 'topn',
    skill: 'Top N by a metric',
    domain: 'sql',
    difficulty: 1,
    summary: 'Filter, group, aggregate, order and limit, with a deterministic tie-break.',
    hints: ['Filter status, period and test accounts in WHERE, then GROUP BY the dimension.', 'ORDER BY the metric descending, then the dimension ascending, and LIMIT.'],
    explanation: 'The everyday shape: filter → group → aggregate → order → limit. Always add a tie-breaker so LIMIT returns the same rows every time.',
    build(rng) {
      const d = pick(rng, DIMS);
      const m = pick(rng, METRICS);
      const s = pick(rng, STATUSES);
      const p = period(rng);
      const n = pick(rng, [3, 5]);
      return {
        title: `Top ${n} ${d.plural} by ${m.key === 'aov' ? 'AOV' : m.key}`,
        prompt: lines(
          `Return the **top ${n} ${d.plural}** by **${m.label}** for **${s.phrase}** placed in **${p.label}**. Exclude test accounts.`,
          '',
          `Columns: \`${d.col}\`, \`${m.col}\`. Order by \`${m.col}\` descending, ties broken by \`${d.col}\` ascending.`,
          d.note ? `\n${d.note}` : '',
        ),
        solution: `select ${d.expr} as ${d.col}, ${m.sql} as ${m.col}
from ${ORDERS_FROM(d)}
where not o.is_test_account and ${s.where} and ${between(p)}
group by 1
order by 2 desc, 1
limit ${n}`,
        ordered: true,
        tables: ['prod.fct_orders', ...(d.join ? ['prod.stg_shop__customers'] : [])],
      };
    },
  },
  {
    id: 'monthly',
    skill: 'Monthly trend',
    domain: 'sql',
    difficulty: 1,
    summary: 'date_trunc to a month grain and aggregate.',
    hints: ["date_trunc('month', order_date)::date gives the first day of the month."],
    explanation: 'Truncate timestamps to the grain you report at, and group by the truncated value, not by a formatted string, so ordering and joins keep working.',
    build(rng) {
      const a = month(rng, [2025, 3], [2026, 1]);
      const span = pick(rng, [3, 4, 6]);
      const endM = new Date(Date.UTC(a.y, a.m - 1 + span - 1, 1));
      const b = { y: endM.getUTCFullYear(), m: endM.getUTCMonth() + 1 };
      const end = b.y > 2026 || (b.y === 2026 && b.m > 6) ? { y: 2026, m: 6 } : b;
      const m = pick(rng, METRICS);
      const s = pick(rng, STATUSES);
      const label = `${MONTH_NAMES[end.m - 1]} ${end.y}`;
      return {
        title: `Monthly ${m.key === 'aov' ? 'AOV' : m.key}`,
        prompt: lines(
          `For **${s.phrase}** (exclude test accounts), return the **${m.label}** per month from **${a.label}** to **${label}** inclusive.`,
          '',
          `Columns: \`month\` (the first day of the month, as a date), \`${m.col}\`. Order by month.`,
        ),
        solution: `select date_trunc('month', o.order_date)::date as month, ${m.sql} as ${m.col}
from prod.fct_orders o
where not o.is_test_account and ${s.where}
  and o.order_date between date '${a.start}' and date '${lastDay(end.y, end.m)}'
group by 1
order by 1`,
        ordered: true,
        tables: ['prod.fct_orders'],
      };
    },
  },
  {
    id: 'share',
    skill: 'Share of total',
    domain: 'sql',
    difficulty: 2,
    summary: 'A window over an aggregate: value / sum(value) over ().',
    hints: ['sum(count(*)) over () puts the grand total on every row.'],
    explanation: '`x / sum(x) over ()` after GROUP BY computes shares in one pass. The window runs after aggregation, so it sees one row per group.',
    build(rng) {
      const d = pick(rng, DIMS);
      const m = pick(rng, METRICS.filter((x) => x.key !== 'aov' && x.key !== 'customers'));
      const s = pick(rng, STATUSES);
      const p = period(rng);
      return {
        title: `Share of ${m.key} by ${d.label}`,
        prompt: lines(
          `For **${s.phrase}** in **${p.label}** (exclude test accounts), return per ${d.label}: \`${d.col}\`, \`${m.col}\` (${m.label}) and \`share\`, that value as a fraction (0–1) of the total across all ${d.plural}.`,
          d.note ? `\n${d.note}` : '',
        ),
        solution: `select ${d.expr} as ${d.col}, ${m.sql} as ${m.col}, ${m.sql} / sum(${m.sql}) over () as share
from ${ORDERS_FROM(d)}
where not o.is_test_account and ${s.where} and ${between(p)}
group by 1`,
        tables: ['prod.fct_orders', ...(d.join ? ['prod.stg_shop__customers'] : [])],
      };
    },
  },
  {
    id: 'running',
    skill: 'Running total',
    domain: 'sql',
    difficulty: 2,
    summary: 'Cumulative sum with an explicit ROWS frame.',
    hints: ['sum(sum(x)) over (order by day rows between unbounded preceding and current row)'],
    explanation: 'A running total is a window over the daily aggregate. Spell out `rows between unbounded preceding and current row`: the default RANGE frame treats tied ORDER BY values as one peer group.',
    build(rng) {
      const p = month(rng);
      const m = pick(rng, METRICS.filter((x) => x.key === 'orders' || x.key === 'revenue'));
      const s = pick(rng, STATUSES);
      return {
        title: `Running ${m.key} in ${p.label}`,
        prompt: lines(
          `For **${s.phrase}** in **${p.label}** (exclude test accounts), return each day that had orders with its daily ${m.label} and a running total from the start of the month.`,
          '',
          `Columns: \`order_date\`, \`${m.col}\`, \`running_${m.col}\`. Order by date.`,
        ),
        solution: `select o.order_date, ${m.sql} as ${m.col},
       sum(${m.sql}) over (order by o.order_date rows between unbounded preceding and current row) as running_${m.col}
from prod.fct_orders o
where not o.is_test_account and ${s.where} and ${between(p)}
group by 1
order by 1`,
        ordered: true,
        tables: ['prod.fct_orders'],
      };
    },
  },
  {
    id: 'moving-avg',
    skill: 'Moving average with a date spine',
    domain: 'sql',
    difficulty: 3,
    summary: 'generate_series spine, zero-fill, then a ROWS window.',
    hints: ['Build every calendar day with generate_series, starting k−1 days before the month so day 1 has a full window.', 'LEFT JOIN the daily counts onto the spine and coalesce to 0.'],
    explanation: 'Without a spine, `rows between k-1 preceding` silently spans more than k calendar days whenever a day has no rows. Generate the dates, zero-fill, then average. Starting the spine early gives the first days a full window.',
    build(rng) {
      const p = month(rng);
      const k = pick(rng, [3, 5, 7]);
      const m = pick(rng, METRICS.filter((x) => x.key === 'orders' || x.key === 'revenue'));
      const s = pick(rng, STATUSES);
      return {
        title: `${k}-day moving ${m.key}`,
        prompt: lines(
          `For every calendar day in **${p.label}**, return the daily ${m.label} for **${s.phrase}** (exclude test accounts; days without orders count as 0) and its **${k}-day moving average**: that day plus the ${k - 1} previous calendar days.`,
          '',
          `Columns: \`day\` (date), \`${m.col}\`, \`moving_avg\`. Order by day.`,
        ),
        solution: `with days as (
    select d::date as day from generate_series(date '${p.start}' - interval ${k - 1} day, date '${p.end}', interval 1 day) as g(d)
),
daily as (
    select o.order_date as day, ${m.sql} as v
    from prod.fct_orders o
    where not o.is_test_account and ${s.where}
    group by 1
),
filled as (
    select days.day, coalesce(daily.v, 0) as v from days left join daily using (day)
)
select day, v as ${m.col}, avg(v) over (order by day rows between ${k - 1} preceding and current row) as moving_avg
from filled
qualify day >= date '${p.start}'
order by day`,
        ordered: true,
        tables: ['prod.fct_orders'],
      };
    },
  },
  {
    id: 'growth',
    skill: 'Period-over-period growth',
    domain: 'sql',
    difficulty: 2,
    summary: 'lag() over a monthly aggregate.',
    hints: ['Aggregate to month first, then lag(value) over (order by month).'],
    explanation: 'Compute growth on the aggregate, not the raw rows: `value / lag(value) over (order by month) - 1`. If months can be missing, join to a month spine first.',
    build(rng) {
      const y = pick(rng, [2025, 2026]);
      const [a, b] = y === 2025 ? pick(rng, [[3, 8], [6, 12], [4, 9]] as const) : [1, 6];
      const m = pick(rng, METRICS.filter((x) => x.key !== 'aov'));
      const s = pick(rng, STATUSES);
      return {
        title: `Month-over-month ${m.key} growth`,
        prompt: lines(
          `For **${s.phrase}** (exclude test accounts) from **${MONTH_NAMES[a - 1]} ${y}** to **${MONTH_NAMES[b - 1]} ${y}**, return per month the ${m.label}, the previous month's value and the growth.`,
          '',
          `Columns: \`month\` (date), \`${m.col}\`, \`prev_${m.col}\` (null for the first month), \`growth\` (fraction, e.g. 0.12 = +12%; null for the first month). Order by month.`,
        ),
        solution: `with monthly as (
    select date_trunc('month', o.order_date)::date as month, ${m.sql} as v
    from prod.fct_orders o
    where not o.is_test_account and ${s.where}
      and o.order_date between date '${y}-${String(a).padStart(2, '0')}-01' and date '${lastDay(y, b)}'
    group by 1
)
select month, v as ${m.col}, lag(v) over (order by month) as prev_${m.col}, v / lag(v) over (order by month) - 1 as growth
from monthly
order by month`,
        ordered: true,
        tables: ['prod.fct_orders'],
      };
    },
  },
  {
    id: 'top-per-group',
    skill: 'Top N per group',
    domain: 'sql',
    difficulty: 2,
    summary: 'row_number() partitioned by the group.',
    hints: ['row_number() over (partition by category order by units desc, product_name)', 'Filter the rank in an outer query or with QUALIFY.'],
    explanation: '`row_number()` gives exactly N per group; `rank()`/`dense_rank()` can return more on ties. Choose deliberately and add a tie-breaker.',
    build(rng) {
      const n = pick(rng, [1, 2, 3]);
      const p = period(rng);
      const metric = pick(rng, [
        { col: 'units', label: 'units sold', sql: 'sum(i.quantity)' },
        { col: 'orders', label: 'number of orders containing the product', sql: 'count(distinct i.order_id)' },
      ]);
      return {
        title: `Top ${n} product${n > 1 ? 's' : ''} per category`,
        prompt: lines(
          `For **completed** orders placed in **${p.label}**, return the **top ${n} product${n > 1 ? 's' : ''} per category** by **${metric.label}**.`,
          '',
          `Columns: \`category\`, \`product_name\`, \`${metric.col}\`, \`rank_in_category\` (1…${n}; ties broken by product_name). Use \`prod.fct_order_items\` and \`prod.dim_products\`.`,
        ),
        solution: `select p.category, p.product_name, ${metric.sql} as ${metric.col},
       row_number() over (partition by p.category order by ${metric.sql} desc, p.product_name) as rank_in_category
from prod.fct_order_items i
join prod.dim_products p using (product_id)
where i.order_status = 'completed' and cast(i.ordered_at as date) between date '${p.start}' and date '${p.end}'
group by 1, 2
qualify rank_in_category <= ${n}`,
        tables: ['prod.fct_order_items', 'prod.dim_products'],
      };
    },
  },
  {
    id: 'anti-join',
    skill: 'Anti-join ("never…")',
    domain: 'sql',
    difficulty: 2,
    summary: 'Customers with no matching row: NOT EXISTS or LEFT JOIN … IS NULL.',
    hints: ['A filter on the joined table belongs in the ON clause, not WHERE, or the LEFT JOIN becomes an inner join.', 'Then keep the rows where the joined key IS NULL.'],
    explanation: '"Never" questions need an anti-join: `NOT EXISTS`, or `LEFT JOIN … ON <match and filter> WHERE right.key IS NULL`. Putting the filter in WHERE silently drops exactly the customers you want.',
    build(rng) {
      const q = pick(rng, [
        { phrase: 'a completed order', title: 'Never completed an order', cond: "o.order_status = 'completed'" },
        { phrase: 'a non-cancelled order', title: 'Never placed a non-cancelled order', cond: "o.order_status <> 'cancelled'" },
        { phrase: 'an order with a discount code', title: 'Never used a discount code', cond: 'o.discount_code is not null' },
        { phrase: 'an order that was returned', title: 'Never returned an order', cond: "o.order_status = 'returned'" },
      ]);
      const d = pick(rng, DIMS.filter((x) => x.join));
      const signup = pick(rng, [quarter(rng), quarter(rng), { label: '2025', start: '2025-01-01', end: '2025-12-31' }]);
      return {
        title: q.title,
        prompt: lines(
          `Per ${d.label}, how many customers who **signed up in ${signup.label}** (by \`created_at\`; excluding test accounts, from \`prod.stg_shop__customers\`) have **never placed ${q.phrase}**?`,
          '',
          `Columns: \`${d.col}\`, \`customers\`.`,
          d.note ? `\n${d.note}` : '',
        ),
        solution: `select ${d.expr} as ${d.col}, count(*) as customers
from prod.stg_shop__customers c
left join prod.fct_orders o
  on o.customer_id = c.customer_id and ${q.cond}
where not c.is_test_account and o.order_id is null
  and cast(c.created_at as date) between date '${signup.start}' and date '${signup.end}'
group by 1`,
        tables: ['prod.stg_shop__customers', 'prod.fct_orders'],
      };
    },
  },
  {
    id: 'latest-per-key',
    skill: 'Latest row per key',
    domain: 'sql',
    difficulty: 2,
    summary: 'Deduplicate with row_number() / QUALIFY.',
    hints: ['qualify row_number() over (partition by <key> order by <timestamp> desc, <id> desc) = 1'],
    explanation: 'The staging-model classic. Pick the latest row per natural key with a deterministic order (timestamp, then id), then aggregate.',
    build(rng) {
      const v = pick(rng, [
        {
          title: 'Latest payment status',
          prompt: "For every order in `prod.stg_shop__payments`, take its **most recent** payment row (latest `created_at`, ties by highest `payment_id`). Count orders by that row's **{col}**.",
          col: pick(rng, ['payment_status', 'payment_method']),
          table: 'prod.stg_shop__payments',
          key: 'order_id',
          order: 'created_at desc, payment_id desc',
        },
        {
          title: 'Latest customer version',
          prompt: '`raw.customers` has one row per change. Take each customer\'s **latest** version (latest `updated_at`, ties by latest `_loaded_at`) and count customers by **{col}**.',
          col: pick(rng, ['country', 'signup_source']),
          table: 'raw.customers',
          key: 'id',
          order: 'updated_at desc, _loaded_at desc',
        },
      ]);
      const colExpr = v.col === 'country' ? "coalesce(country, 'unknown')" : v.col;
      const p = period(rng);
      const scope = v.table === 'raw.customers' ? { phrase: `customers created in ${p.label}`, col: 'created_at' } : { phrase: `payments whose latest row was created in ${p.label}`, col: 'created_at' };
      return {
        title: v.title,
        prompt: lines(v.prompt.replace('{col}', `\`${v.col}\``), '', `Only count ${scope.phrase} (by \`${scope.col}\` of the latest row).`, '', `Columns: \`${v.col}\`, \`n\`.${v.col === 'country' ? " Use `'unknown'` for a missing country." : ''}`),
        solution: `select ${colExpr} as ${v.col}, count(*) as n
from (
    select * from ${v.table}
    qualify row_number() over (partition by ${v.key} order by ${v.order}) = 1
)
where cast(${scope.col} as date) between date '${p.start}' and date '${p.end}'
group by 1`,
        tables: [v.table],
      };
    },
  },
  {
    id: 'repeat-window',
    skill: 'Repeat within N days',
    domain: 'semantic',
    difficulty: 3,
    summary: 'Cohort by first event, then look for a second event in a window.',
    hints: ['Find each customer\'s first completed order, then check for another completed order within the window (EXISTS, self-join or lead()).'],
    explanation: 'Define the cohort on the first qualifying event, then measure the follow-up relative to each customer\'s own start date. Compute the rate from summed counts, never by averaging rates.',
    build(rng) {
      const q = quarter(rng);
      const days = pick(rng, [30, 60, 90, 180]);
      const d = pick(rng, DIMS.filter((x) => x.join));
      // every cohort member needs a full observation window before the data ends (2026-06-30)
      const windowEnds = new Date(Date.parse(`${q.end}T00:00:00Z`) + days * 86_400_000);
      const cohort = windowEnds <= new Date('2026-06-30T00:00:00Z') ? q : { label: 'Q3 2025', start: '2025-07-01', end: '2025-09-30' };
      return {
        title: `${days}-day repeat rate by ${d.label}`,
        prompt: lines(
          `Cohort: non-test customers whose **first completed order** was in **${cohort.label}**. A customer **repeats** if they placed another completed order within **${days} days** after the first (\`first < ordered_at <= first + ${days} days\`).`,
          '',
          `Per ${d.label}, return \`${d.col}\`, \`cohort_customers\`, \`repeat_customers\`, \`repeat_rate\` (fraction 0–1).`,
          d.note ? `\n${d.note}` : '',
        ),
        solution: `with firsts as (
    select o.customer_id, ${d.expr} as ${d.col}, min(o.ordered_at) as first_at
    from prod.fct_orders o
    join prod.stg_shop__customers c using (customer_id)
    where o.order_status = 'completed' and not c.is_test_account
    group by 1, 2
    having cast(min(o.ordered_at) as date) between date '${cohort.start}' and date '${cohort.end}'
),
flagged as (
    select f.*, exists (
        select 1 from prod.fct_orders o2
        where o2.customer_id = f.customer_id and o2.order_status = 'completed'
          and o2.ordered_at > f.first_at and o2.ordered_at <= f.first_at + interval ${days} day
    ) as rep
    from firsts f
)
select ${d.col}, count(*) as cohort_customers, count(*) filter (where rep) as repeat_customers, avg(case when rep then 1.0 else 0 end) as repeat_rate
from flagged
group by 1`,
        tables: ['prod.fct_orders', 'prod.stg_shop__customers'],
      };
    },
  },
  {
    id: 'funnel-step',
    skill: 'Funnel step conversion',
    domain: 'semantic',
    difficulty: 2,
    summary: 'Distinct visitors per step and the conversion between two steps.',
    hints: ['count(distinct anonymous_id) filter (where event_name = …) per device.'],
    explanation: 'Conversion = visitors who did B among those who did A. FILTER (or conditional count distinct) computes both steps in one pass. A strict funnel would also require B to happen after A.',
    build(rng) {
      const p = month(rng, [2026, 4], [2026, 6]);
      const [a, b] = pick(rng, [
        ['page_view', 'product_viewed'],
        ['product_viewed', 'add_to_cart'],
        ['add_to_cart', 'checkout_started'],
        ['checkout_started', 'order_completed'],
        ['product_viewed', 'order_completed'],
      ] as const);
      return {
        title: `${a} → ${b} by device`,
        prompt: lines(
          `For events in **${p.label}** (\`prod.stg_segment__events\`), per \`device\`: how many distinct visitors (\`anonymous_id\`) had a **${a}** event, how many of *those* also had a **${b}** event in the same month, and the conversion rate.`,
          '',
          `Columns: \`device\`, \`visitors_${a}\`, \`visitors_both\`, \`conversion\` (fraction 0–1).`,
        ),
        solution: `with v as (
    select anonymous_id, device,
           bool_or(event_name = '${a}') as did_a,
           bool_or(event_name = '${b}') as did_b
    from prod.stg_segment__events
    where event_ts >= timestamp '${p.start}' and event_ts < timestamp '${p.end}' + interval 1 day
    group by 1, 2
)
select device, count(*) filter (where did_a) as visitors_${a},
       count(*) filter (where did_a and did_b) as visitors_both,
       count(*) filter (where did_a and did_b) / count(*) filter (where did_a) as conversion
from v
group by 1`,
        tables: ['prod.stg_segment__events'],
      };
    },
  },
  {
    id: 'sessions',
    skill: 'Sessionisation',
    domain: 'sql',
    difficulty: 3,
    summary: 'lag() to flag gaps, running sum to number sessions.',
    hints: ['Flag a new session when lag(event_ts) is null or the gap exceeds the threshold.', 'A running sum of the flag numbers sessions per anonymous_id.'],
    explanation: 'Flag boundaries with `lag()`, number them with a running `sum()` of the flags. It is the gaps-and-islands pattern, and it works for sessions, outages and streaks.',
    build(rng) {
      const p = month(rng, [2026, 4], [2026, 6]);
      const gap = pick(rng, [15, 30, 60]);
      return {
        title: `Sessions with a ${gap}-minute gap`,
        prompt: lines(
          `Take only events from **${p.label}** in \`prod.stg_segment__events\`. A new session starts for an \`anonymous_id\` at its first event, or when more than **${gap} minutes** passed since its previous event (order by \`event_ts\`, then \`event_id\`).`,
          '',
          'Per `device`, return `device`, `sessions`, `avg_events_per_session`.',
        ),
        solution: `with e as (
    select *, lag(event_ts) over (partition by anonymous_id order by event_ts, event_id) as prev_ts
    from prod.stg_segment__events
    where event_ts >= timestamp '${p.start}' and event_ts < timestamp '${p.end}' + interval 1 day
),
s as (
    select *, sum(case when prev_ts is null or event_ts - prev_ts > interval ${gap} minute then 1 else 0 end)
              over (partition by anonymous_id order by event_ts, event_id rows between unbounded preceding and current row) as session_no
    from e
)
select device, count(distinct anonymous_id || '-' || session_no) as sessions,
       count(*) / count(distinct anonymous_id || '-' || session_no) as avg_events_per_session
from s
group by 1`,
        tables: ['prod.stg_segment__events'],
      };
    },
  },
  {
    id: 'weekday',
    skill: 'Day-of-week pattern',
    domain: 'sql',
    difficulty: 1,
    summary: 'Date part extraction and grouping.',
    hints: ['isodow(order_date) returns 1 for Monday … 7 for Sunday.'],
    explanation: 'Date-part functions differ by warehouse (`isodow`, `dayofweek`, `EXTRACT(DAYOFWEEK …)`), and so do their numbering conventions. State the convention in the output so readers don\'t have to guess.',
    build(rng) {
      const p = period(rng);
      const m = pick(rng, METRICS.filter((x) => x.key !== 'customers'));
      const s = pick(rng, STATUSES);
      return {
        title: `${m.key === 'aov' ? 'AOV' : m.key[0].toUpperCase() + m.key.slice(1)} by weekday`,
        prompt: lines(
          `For **${s.phrase}** in **${p.label}** (exclude test accounts), return the **${m.label}** per ISO weekday.`,
          '',
          `Columns: \`weekday\` (1 = Monday … 7 = Sunday), \`${m.col}\`. Order by weekday.`,
        ),
        solution: `select isodow(o.order_date) as weekday, ${m.sql} as ${m.col}
from prod.fct_orders o
where not o.is_test_account and ${s.where} and ${between(p)}
group by 1
order by 1`,
        ordered: true,
        tables: ['prod.fct_orders'],
      };
    },
  },
  {
    id: 'pivot',
    skill: 'Pivot with conditional aggregation',
    domain: 'sql',
    difficulty: 2,
    summary: 'count(*) filter (where …) / sum(case when …) per column.',
    hints: ["count(*) filter (where o.order_status = 'completed') as completed_orders"],
    explanation: 'Conditional aggregation pivots rows into columns in a single pass. In dbt you would generate these columns with a Jinja loop.',
    build(rng) {
      const d = pick(rng, DIMS);
      const p = period(rng);
      const statuses = pick(rng, [
        ['completed', 'cancelled', 'returned'],
        ['completed', 'returned'],
        ['shipped', 'completed', 'cancelled'],
      ]);
      return {
        title: `Order statuses by ${d.label}`,
        prompt: lines(
          `For orders placed in **${p.label}** (exclude test accounts), return one row per ${d.label} with the number of orders in each status as separate columns.`,
          '',
          `Columns, in order: \`${d.col}\`, ${statuses.map((x) => `\`${x}_orders\``).join(', ')}.`,
          d.note ? `\n${d.note}` : '',
        ),
        solution: `select ${d.expr} as ${d.col},
       ${statuses.map((x) => `count(*) filter (where o.order_status = '${x}') as ${x}_orders`).join(',\n       ')}
from ${ORDERS_FROM(d)}
where not o.is_test_account and ${between(p)}
group by 1`,
        tables: ['prod.fct_orders', ...(d.join ? ['prod.stg_shop__customers'] : [])],
      };
    },
  },
  {
    id: 'days-between',
    skill: 'Time between events',
    domain: 'sql',
    difficulty: 2,
    summary: 'lead() to put the next event on the same row.',
    hints: ['lead(ordered_at) over (partition by customer_id order by ordered_at, order_id)', "date_diff('day', a, b) counts day boundaries."],
    explanation: '`lead()` puts the next event on the current row; keep each customer\'s first row and measure the gap. Decide up front which events count (here: the status filter).',
    build(rng) {
      const s = pick(rng, STATUSES.slice(0, 2));
      const d = pick(rng, DIMS.filter((x) => x.join));
      const year = pick(rng, [2025, 2026]);
      return {
        title: `Days to second order by ${d.label}`,
        prompt: lines(
          `Using **${s.phrase}** of non-test customers, find each customer's first and second order. Keep customers whose **first** such order was in **${year}** and who have a second one. Per ${d.label}, return \`${d.col}\`, \`customers\`, \`avg_days_to_second\` (whole days between the two \`ordered_at\` dates, using \`date_diff('day', …)\`).`,
          d.note ? `\n${d.note}` : '',
        ),
        solution: `with ranked as (
    select o.customer_id, ${d.expr} as ${d.col}, o.ordered_at,
           lead(o.ordered_at) over (partition by o.customer_id order by o.ordered_at, o.order_id) as next_at,
           row_number() over (partition by o.customer_id order by o.ordered_at, o.order_id) as n
    from prod.fct_orders o
    join prod.stg_shop__customers c using (customer_id)
    where not c.is_test_account and ${s.where}
)
select ${d.col}, count(*) as customers, avg(date_diff('day', ordered_at, next_at)) as avg_days_to_second
from ranked
where n = 1 and next_at is not null and year(ordered_at) = ${year}
group by 1`,
        tables: ['prod.fct_orders', 'prod.stg_shop__customers'],
      };
    },
  },
  {
    id: 'mrr',
    skill: 'Point-in-time MRR',
    domain: 'semantic',
    difficulty: 3,
    summary: 'Active-at-date logic, annual plans normalised, broken rows excluded.',
    hints: ['Active at D: started_at <= D and (cancelled_at is null or cancelled_at > D).', 'Annual plans: amount_cents / 12.'],
    explanation: 'MRR is a point-in-time, semi-additive measure: sum it across subscriptions at one date, never across dates. Normalise annual plans and filter rows that violate basic invariants (cancelled before started).',
    build(rng) {
      const p = month(rng, [2025, 6], [2026, 6]);
      const ccy = pick(rng, ['USD', 'EUR', 'GBP']);
      return {
        title: `${ccy} MRR at end of ${p.label}`,
        prompt: lines(
          `From \`prod.stg_shop__subscriptions\`, for **${ccy}** subscriptions only, compute the state at **${p.end}** (end of ${p.label}): a subscription is active if \`started_at <= '${p.end}'\` and (\`cancelled_at\` is null or later than that date). Annual plans count as \`amount_cents / 12\` per month. Exclude rows where \`cancelled_at < started_at\`.`,
          '',
          'Return one row: `active_subscriptions`, `mrr` (in currency units, not cents).',
        ),
        solution: `select count(*) as active_subscriptions,
       sum(case when plan = 'annual' then amount_cents / 12.0 else amount_cents end) / 100.0 as mrr
from prod.stg_shop__subscriptions
where currency = '${ccy}'
  and (cancelled_at is null or cancelled_at >= started_at)
  and started_at <= date '${p.end}'
  and (cancelled_at is null or cancelled_at > date '${p.end}')`,
        tables: ['prod.stg_shop__subscriptions'],
      };
    },
  },
];

export const DRILL_BY_ID = Object.fromEntries(DRILL_TEMPLATES.map((t) => [t.id, t])) as Record<string, DrillTemplate>;

/** Build the concrete drill for a template and seed. Same inputs, same question. */
export function generateDrill(templateId: string, seed: number): SqlItem {
  const t = DRILL_BY_ID[templateId];
  const spec = t.build(mulberry32(seed * 7919 + templateId.length * 104729));
  return {
    id: `gen.${t.id}.${seed}`,
    kind: 'sql',
    domain: t.domain,
    difficulty: t.difficulty,
    title: spec.title,
    prompt: spec.prompt,
    solution: spec.solution,
    ordered: spec.ordered,
    tables: spec.tables,
    hints: t.hints,
    explanation: t.explanation,
  };
}

export function templateOf(itemId: string): string | null {
  const m = itemId.match(/^gen\.([a-z0-9-]+)\.\d+$/);
  return m ? m[1] : null;
}

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999_999);
}
