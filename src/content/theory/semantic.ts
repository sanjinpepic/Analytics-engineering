import type { TheoryModule } from '../types';

export const semanticModule: TheoryModule = {
  id: 'semantic',
  domain: 'semantic',
  title: 'Metrics, semantic layers and BI',
  summary:
    'Defining metrics once, encoding them in a semantic layer such as MetricFlow or LookML, connecting BI tools to governed marts, and avoiding the aggregation traps that make numbers disagree.',
  minutes: 22,
  sections: [
    {
      heading: 'Why define metrics once',
      body: `Every company eventually has the meeting where three people bring three revenue numbers. Usually nobody made an arithmetic error: one excluded cancelled orders, one included test accounts, one converted currencies at today's rate. **The disagreement is about definitions, and definitions scattered across dashboards drift.**

A **semantic layer** is a place where metrics and the dimensions you can slice them by are defined once, in code, and then served to every consumer: BI tools, notebooks, spreadsheets, applications, and increasingly LLM agents. The benefits:

- **Consistency.** "Revenue" means one SQL expression, with one set of filters, everywhere.
- **Governance.** The definition is version-controlled, reviewed, owned and documented. Changing it is a PR, not a silent edit to a workbook.
- **Correct aggregation by construction.** The layer knows that AOV is a ratio of sums, that distinct customers cannot be summed across months, and which joins are safe, so a user dragging fields around cannot accidentally average averages.
- **Grounding for AI.** An LLM asked "what was revenue in Germany last quarter?" is far more reliable when it can call a governed metric with a dimension and a time grain than when it writes raw SQL over forty tables. Semantic layers exposed through APIs and MCP servers have become a standard way to give agents safe, consistent access to numbers.

The trade-off is real: a semantic layer is another system to model, maintain and teach. For a small team with one BI tool, defining metrics in that BI tool's modelling layer (LookML, a Power BI semantic model) plus well-designed marts may be enough. Once several tools or teams consume the same metrics, a shared layer pays for itself.

Where marts end and the semantic layer begins: marts hold **clean, conformed facts and dimensions at a known grain** (\`fct_orders\`, \`dim_customers\`). The semantic layer holds **how to aggregate them**: measures, metrics, and the relationships between tables. Do not pre-aggregate every metric into a mart; you lose the ability to slice it.`,
    },
    {
      heading: 'Anatomy of a metric, and metric types',
      body: `A metric definition that survives contact with stakeholders specifies:

| Part | Tidepool example: "Revenue" |
|---|---|
| Name and label | \`completed_revenue_usd\`, "Revenue (USD)" |
| Description | Sum of order totals (items + shipping - discounts) for completed orders, converted to USD at the latest business-day rate on or before the order date |
| Measure and aggregation | \`sum(amount_usd)\` |
| Filters | \`order_status = 'completed'\`, \`not is_test_account\` |
| Time dimension and grains | \`order_date\`; day, week, month, quarter |
| Allowed dimensions | country, signup source, discount code, customer order number |
| Owner | Finance analytics |
| Caveats | returns reverse revenue only after the return is processed; excludes gift card purchases' later redemption |

Writing this table is half the job, and it is a business conversation more than a technical one. The questions to ask: Which statuses count? Gross or net of discounts, refunds, tax, shipping? Which date: order, ship or payment? Which currency rule?

Common metric types (named as in MetricFlow, but the concepts are universal):

- **Simple**: one aggregated measure with optional filters. Revenue, order count, distinct ordering customers.
- **Ratio**: numerator metric divided by denominator metric, each aggregated **separately** at the requested grain and then divided. AOV = revenue / completed orders. Conversion rate, return rate.
- **Derived**: an expression over other metrics, including time offsets. Month-over-month growth = (revenue - revenue one month earlier) / revenue one month earlier. Gross margin = (revenue - cost) / revenue.
- **Cumulative**: a measure accumulated over a window or period-to-date. Revenue month-to-date, trailing 28-day active customers (which is a distinct count over a rolling window, not a sum of daily counts).
- **Conversion**: the share of entities that did event A and then event B within a window. Visitors who viewed a product and completed an order within 7 days. These need an entity to follow (visitor or customer) and a time window, and are notoriously hard to get right in hand-written SQL.

Tidepool's derived metric example, computed directly for intuition:

\`\`\`sql run
-- Blended vs paid customer acquisition cost: same numerator, two defensible denominators
with spend as (
    select date_trunc('month', spend_date) as month, sum(spend_usd) as spend_usd
    from prod.stg_ads__marketing_spend
    group by 1
),
new_customers as (
    select
        date_trunc('month', first_order_at) as month,
        count(*) as new_customers,
        count(*) filter (where signup_source in ('paid_search', 'paid_social')) as new_paid_customers
    from prod.dim_customers
    where first_order_at is not null and not is_test_account
    group by 1
)
select
    month,
    round(spend_usd)                                         as spend_usd,
    new_customers,
    new_paid_customers,
    round(spend_usd / new_customers, 2)                      as blended_cac,
    round(spend_usd / nullif(new_paid_customers, 0), 2)      as paid_cac
from spend
join new_customers using (month)
order by month desc
limit 6
\`\`\`

Same spend, two denominators, numbers more than twice apart. Neither is wrong; an undefined "CAC" is.`,
    },
    {
      heading: 'The dbt Semantic Layer and MetricFlow',
      body: `The dbt Semantic Layer is powered by **MetricFlow**. You describe your marts as **semantic models** in YAML, define **metrics** on top, and MetricFlow generates the SQL (including joins) for any valid combination of metrics, dimensions and time grains.

A semantic model maps one dbt model and declares:

- **Entities**: the join keys. \`primary\` (unique in this model), \`foreign\` (points to another model's primary entity), plus \`unique\` and \`natural\`. MetricFlow joins semantic models through shared entity names, and it only follows join paths that cannot fan out.
- **Dimensions**: \`categorical\` or \`time\` (with a granularity) attributes to group and filter by.
- **Measures**: aggregations of columns (\`sum\`, \`count_distinct\`, \`average\`, \`min\`, \`max\`, percentiles, ...). Semi-additive measures can declare a \`non_additive_dimension\` (e.g. take the last value per month).

\`\`\`yaml
semantic_models:
  - name: orders
    description: One row per order (grain = order_id).
    model: ref('fct_orders')
    defaults:
      agg_time_dimension: order_date
    entities:
      - name: order
        type: primary
        expr: order_id
      - name: customer
        type: foreign
        expr: customer_id
    dimensions:
      - name: order_date
        type: time
        type_params:
          time_granularity: day
      - name: order_status
        type: categorical
      - name: is_test_account
        type: categorical
    measures:
      - name: revenue_usd
        agg: sum
        expr: amount_usd
      - name: order_count
        agg: sum
        expr: 1
      - name: ordering_customers
        agg: count_distinct
        expr: customer_id

  - name: customers
    model: ref('dim_customers')
    entities:
      - name: customer
        type: primary
        expr: customer_id
    dimensions:
      - name: country_code
        type: categorical
      - name: signup_source
        type: categorical
\`\`\`

\`\`\`yaml
metrics:
  - name: completed_revenue_usd
    label: Revenue (USD)
    type: simple
    type_params:
      measure: revenue_usd
    filter: |
      {{ Dimension('order__order_status') }} = 'completed'
      and not {{ Dimension('order__is_test_account') }}

  - name: completed_orders
    label: Completed orders
    type: simple
    type_params:
      measure: order_count
    filter: |
      {{ Dimension('order__order_status') }} = 'completed'
      and not {{ Dimension('order__is_test_account') }}

  - name: average_order_value_usd
    label: Average order value (USD)
    type: ratio
    type_params:
      numerator: completed_revenue_usd
      denominator: completed_orders
\`\`\`

Because \`customers\` shares the \`customer\` entity, \`completed_revenue_usd\` can be grouped by \`customer__country_code\` without anyone writing a join. Queries ask for metrics by \`metric_time\` at a grain:

\`\`\`bash
# dbt Cloud CLI; locally with MetricFlow the equivalent command is: mf query ...
dbt sl query --metrics completed_revenue_usd,average_order_value_usd --group-by metric_time__month,customer__country_code
\`\`\`

Practical notes: entity and dimension names become part of a public API (\`customer__country_code\`), so name them carefully. Put filters that define the metric in the metric, not in each dashboard. The YAML specification has been evolving (including simplifications alongside dbt's newer engine), so check the current docs for exact keys; the concepts above are stable. Integrations exist for several BI and notebook tools (for example Tableau, Hex and spreadsheets), plus JDBC and GraphQL APIs for everything else.`,
    },
    {
      heading: 'LookML for comparison',
      body: `Looker's modelling language, **LookML**, was the original widely used semantic layer, and many job ads still list it. The vocabulary maps closely onto MetricFlow:

- A **view** maps to a table (or a derived table) and declares **dimensions** (columns, including \`dimension_group\` for time with timeframes) and **measures** (aggregations).
- An **explore** is the starting point users query from: a base view plus **joins** to other views, each with \`sql_on\` and a \`relationship\` (\`many_to_one\`, \`one_to_many\`, ...).
- A **model** file groups explores and the database connection.
- A **PDT** (persistent derived table) is a table Looker itself builds and refreshes from SQL, triggered by a \`datagroup\` or schedule. PDTs predate widespread dbt use; in a dbt shop, build these as dbt models instead and keep Looker for semantics, so transformation logic lives in one place.

\`\`\`
view: orders {
  sql_table_name: prod.fct_orders ;;

  dimension: order_id {
    primary_key: yes
    type: number
    sql: \${TABLE}.order_id ;;
  }

  dimension_group: ordered {
    type: time
    timeframes: [date, week, month, quarter]
    sql: \${TABLE}.ordered_at ;;
  }

  measure: completed_revenue_usd {
    type: sum
    sql: \${TABLE}.amount_usd ;;
    filters: [order_status: "completed"]
  }

  measure: ordering_customers {
    type: count_distinct
    sql: \${TABLE}.customer_id ;;
  }
}

explore: orders {
  join: customers {
    sql_on: \${orders.customer_id} = \${customers.customer_id} ;;
    relationship: many_to_one
  }
}
\`\`\`

The feature that matters most: **symmetric aggregates**. If an explore joins \`orders\` to \`order_items\` (one-to-many) and a user asks for revenue, a naive \`sum(amount_usd)\` would be fanned out. Looker detects the fan-out from the declared relationship and the view's \`primary_key\` and computes sums over distinct primary keys instead. It only works if every view declares a correct primary key and every join a correct relationship, which is why those two lines get scrutinised in LookML reviews.

**Cube** in a sentence: an open-source semantic layer (with a commercial cloud) where you define cubes, measures, dimensions and joins in YAML or JavaScript, served over SQL, REST and GraphQL APIs with a caching and pre-aggregation engine, often used for embedded analytics and applications.`,
    },
    {
      heading: 'How BI tools relate to marts and the semantic layer',
      body: `Every BI tool has some modelling layer of its own. The architectural question is how much logic lives there versus upstream.

| Tool | Its own modelling layer | Typical relationship to dbt |
|---|---|---|
| Looker | LookML: views, explores, measures; a full semantic layer | reads marts; LookML holds metric definitions; PDTs best replaced by dbt models |
| Tableau | data sources, relationships, calculated fields, published data sources | reads marts or extracts; can consume the dbt Semantic Layer through an integration |
| Power BI | semantic models (formerly "datasets") with DAX measures and relationships | imports or queries marts; DAX measures often duplicate warehouse logic, which is where drift starts |
| Hex | notebooks and apps mixing SQL, Python and charts; semantic layer integrations | queries marts directly or via a semantic layer; great for exploration and data apps |
| Metabase | models, saved metrics and segments, metadata on columns | reads marts; light modelling for self-serve questions |

A defensible default for a dbt team:

1. **All transformation in dbt.** Cleaning, joining, business logic, history. BI tools read marts, never raw or staging tables.
2. **Metric definitions in exactly one place**: the dbt Semantic Layer if several tools consume metrics, otherwise the main BI tool's modelling layer, documented and reviewed like code.
3. **BI-side logic only for presentation**: formatting, labels, chart-specific calculations that are not reused.
4. **Certify** the governed data sources or explores so users can tell the official number from someone's experiment.

In practice the hard part is not the architecture; it is the 200 legacy workbooks with their own calculated fields. Migrate the highest-traffic dashboards first, and track which ones read from governed sources.`,
    },
    {
      heading: 'Exposures and dashboard hygiene',
      body: `**Exposures** declare downstream uses of your dbt project (dashboards, notebooks, ML models, applications, reverse-ETL syncs) so they appear in lineage:

\`\`\`yaml
exposures:
  - name: weekly_revenue_dashboard
    label: Weekly revenue (exec)
    type: dashboard
    maturity: high
    url: https://bi.tidepool.example/dashboards/42
    description: Monday exec review. Revenue, AOV and new customers by country.
    depends_on:
      - ref('fct_orders')
      - ref('dim_customers')
      - metric('completed_revenue_usd')
    owner:
      name: Finance analytics
      email: finance-data@tidepool.example
\`\`\`

Why bother: when \`stg_shop__orders\` breaks or you plan a breaking change to \`dim_customers\`, lineage now shows the exec dashboard and its owner. \`dbt build -s +exposure:weekly_revenue_dashboard\` builds and tests everything that dashboard needs, which makes a good high-priority job. Some BI tools and catalogs can generate exposures automatically from their own lineage, which keeps them from going stale.

**Dashboard hygiene** checklist that separates trusted dashboards from abandoned ones:

- **Every number has a definition one click away**: tooltip or description with the metric definition, filters applied, and data freshness ("data through 30 Jun 2026, 06:10 UTC").
- **Governed sources only** for anything presented to leadership; no ad-hoc custom SQL tiles for core metrics.
- **State the time zone and the time basis** (order date vs ship date) on the dashboard.
- **Show denominators** next to rates (conversion 3.1% of 12,400 sessions) so small samples are obvious.
- **Default filters are visible**, especially "excludes test accounts" and "completed orders only".
- **An owner and a review date.** Archive dashboards nobody has opened in months; usage data from the BI tool makes this easy and saves warehouse cost.
- **Fewer, better tiles.** A dashboard answers a small set of decisions; exploration belongs in an explore or a notebook.`,
    },
    {
      heading: 'Aggregation pitfalls that make numbers disagree',
      body: `**Averaging averages.** AOV for a period is total revenue divided by total orders, not the mean of daily AOVs. The mean of daily AOVs weights a quiet day with three orders the same as a busy day with thirty:

\`\`\`sql run
with daily as (
    select order_date, sum(amount_usd) as revenue_usd, count(*) as orders
    from prod.fct_orders
    where order_status = 'completed' and not is_test_account
    group by order_date
)
select
    round(sum(revenue_usd) / sum(orders), 2) as aov_ratio_of_sums,
    round(avg(revenue_usd / orders), 2)      as aov_average_of_daily_aovs
from daily
\`\`\`

The gap is small here and can be large in reality (by country, by campaign, by product). Same rule for conversion rates, margins and any ratio: **aggregate numerator and denominator separately, divide last.** That is exactly what a ratio metric does.

**Non-additive metrics across dimensions.** Distinct counts do not sum. Monthly active customers summed over six months counts a loyal customer six times:

\`\`\`sql run
with orders as (
    select * from prod.fct_orders
    where order_status <> 'cancelled' and not is_test_account
      and order_date between date '2026-01-01' and date '2026-06-30'
),
monthly as (
    select date_trunc('month', order_date) as order_month, count(distinct customer_id) as active_customers
    from orders
    group by 1
)
select
    (select sum(active_customers) from monthly)    as sum_of_monthly_actives,
    (select count(distinct customer_id) from orders) as h1_active_customers
\`\`\`

The same applies to subtotals in a pivot table (countries' distinct customers do not add up to the total if customers can belong to several countries) and to ratios shown with a "total" row computed by summing rows.

**Fan-out double counting.** Joining orders to order items or payments before summing an order-level measure inflates it (see the SQL module). Semantic layers and Looker's symmetric aggregates prevent this only when entities, primary keys and relationships are declared correctly.

**Time zones.** Tidepool stores \`ordered_at\` in UTC. An Australian customer ordering at 08:00 Sydney time on Monday appears on Sunday in UTC. "Daily revenue" disagrees with the Shopify admin (which reports in the shop's time zone) for exactly this reason. Decide the reporting time zone per metric (often the company's head-office zone, or the customer's local zone for local-market reporting), convert explicitly, and name the column accordingly:

\`\`\`sql
-- Snowflake
select convert_timezone('UTC', 'Australia/Sydney', ordered_at) as ordered_at_sydney from fct_orders;
-- BigQuery
select datetime(ordered_at, 'Australia/Sydney') as ordered_at_sydney from fct_orders;
\`\`\`

Also watch week definitions (ISO weeks start Monday; some tools default to Sunday) and fiscal calendars.

**Choosing denominators.** Most metric arguments are denominator arguments. Conversion rate per session or per visitor? Return rate over all orders, shipped orders, or orders past the return window? Churn over subscribers at the start of the month, or the average during it? Pick one, write it in the definition, and show it on the dashboard. When a stakeholder asks for "the conversion rate", the senior move is to ask which decision it will inform, then choose the denominator that fits that decision.`,
    },
  ],
  keyTerms: [
    { term: 'Semantic layer', definition: 'A layer that defines metrics, dimensions and join relationships once and generates queries for any consumer, ensuring consistent definitions.' },
    { term: 'Metric', definition: 'A named, governed business calculation: a measure, its aggregation and filters, a time dimension, allowed dimensions, owner and description.' },
    { term: 'Measure', definition: 'An aggregation of a column in a semantic model (sum, count_distinct, average) that metrics are built from.' },
    { term: 'Entity', definition: 'In MetricFlow, a join key declared on a semantic model (primary, foreign, unique, natural) that defines how models relate.' },
    { term: 'Ratio metric', definition: 'A metric computed by aggregating a numerator and a denominator separately at the requested grain, then dividing.' },
    { term: 'Derived metric', definition: 'A metric defined as an expression over other metrics, optionally with time offsets, e.g. month-over-month growth.' },
    { term: 'Cumulative metric', definition: 'A metric accumulated over a rolling window or period-to-date, such as revenue month-to-date or trailing 28-day actives.' },
    { term: 'Conversion metric', definition: 'The share of entities that perform a base event and then a conversion event within a time window.' },
    { term: 'MetricFlow', definition: 'The engine behind the dbt Semantic Layer that compiles metric requests defined in YAML into SQL, including safe joins.' },
    { term: 'LookML explore', definition: 'A Looker query starting point: a base view plus declared joins and relationships that users can query from.' },
    { term: 'Symmetric aggregates', definition: 'Looker\'s technique for computing correct sums and averages through one-to-many joins, relying on declared primary keys.' },
    { term: 'Exposure', definition: 'A dbt declaration of a downstream consumer such as a dashboard, with owner and dependencies, shown in lineage and selectable.' },
    { term: 'Averaging averages', definition: 'The error of taking the mean of group-level ratios instead of dividing total numerator by total denominator.' },
  ],
  landscape: `**Snapshot as of mid-2026.**

- **Semantic layers became an AI story.** The pitch shifted from "consistent dashboards" to "trustworthy answers from LLM agents". MCP servers, including the dbt MCP server, let agents discover and query governed metrics and project metadata instead of writing raw SQL against arbitrary tables.
- **Open standards and open source.** In 2025 Snowflake launched the **Open Semantic Interchange (OSI)** initiative with partners including dbt Labs, aiming for a vendor-neutral way to exchange semantic model definitions between tools. dbt Labs also announced it would open-source **MetricFlow** under the Apache 2.0 licence. Details of the OSI specification and adoption are still settling, so check current status before relying on it.
- **Warehouses ship semantic features.** Several cloud platforms now offer native semantic or metric definitions alongside their AI assistants, so metric logic increasingly has more than one possible home. The governance question, which one is the source of truth, matters more than the choice of tool.
- **Consolidation.** Fivetran acquired Tobiko Data (SQLMesh) in 2025 and announced a merger with dbt Labs in October 2025, which puts transformation and the dbt Semantic Layer under one roof. LookML remains widely used, and Cube continues as an independent open-source option.
- **The fundamentals did not change.** Ratio metrics, semi-additive measures, fan-out and time zones are still where numbers go wrong. AI interfaces make those errors faster to produce, which makes correct definitions more valuable.`,
  practice: [
    {
      kind: 'mcq',
      id: 'semantic.average-of-averages',
      domain: 'semantic',
      difficulty: 1,
      title: 'Quarterly AOV',
      prompt: `A dashboard has a daily AOV table. A PM computes Q2 AOV by averaging the 91 daily AOV values. Finance gets a different number. Who is right, and why?`,
      options: [
        'Finance, if they divided total Q2 revenue by total Q2 orders: averaging daily ratios weights every day equally regardless of order volume',
        'The PM: averaging daily values smooths out outliers, so it is more accurate',
        'Both are equally valid; it is a matter of preference',
        'Neither: AOV can only be computed per order',
      ],
      correct: [0],
      explanation: `AOV for a period is sum(revenue) / sum(orders) over that period. The mean of daily AOVs gives a 3-order day the same weight as a 30-order day, so it only matches when every day has the same volume. "Smoothing" is not accuracy; it answers a different, rarely useful question ("what is a typical day's AOV"). AOV is by definition an aggregate over orders, not a per-order value.`,
    },
    {
      kind: 'mcq',
      id: 'semantic.distinct-not-additive',
      domain: 'semantic',
      difficulty: 2,
      title: 'H1 active customers',
      prompt: `Monthly active customers for January to June 2026 range from about 70 to 115 each month, summing to 533. The CEO's slide says "533 active customers in H1". A direct distinct count over H1 gives 343. What is the correct explanation?`,
      options: [
        'Distinct counts are non-additive: customers active in several months are counted once per month in the sum; H1 actives must be counted distinctly over the whole period',
        'The monthly numbers include cancelled orders; the H1 number does not',
        'The sum is right; the distinct count drops customers who changed country',
        'Distinct counts should be averaged, not summed, so H1 actives are 533 / 6',
      ],
      correct: [0],
      explanation: `A repeat customer active in four months adds four to the sum but one to the H1 distinct count. You cannot roll a distinct count up from a lower grain: you must recompute it at the target grain (or use mergeable sketches). Nothing about cancellations or countries explains the gap, and averaging monthly counts gives "average monthly actives", a different metric that is also not H1 actives.`,
    },
    {
      kind: 'mcq',
      id: 'semantic.metric-anatomy',
      domain: 'semantic',
      difficulty: 1,
      title: 'What a metric definition needs',
      prompt: `You are writing the definition of "Revenue" for Tidepool's semantic layer. Select **all** elements that belong in the definition itself.`,
      options: [
        'The filters that define it, e.g. completed orders only and test accounts excluded',
        'The aggregation and the column it applies to, e.g. sum of amount_usd',
        'The time dimension it is reported on (order date vs ship date)',
        'The chart type and colour used on the exec dashboard',
      ],
      correct: [0, 1, 2],
      explanation: `Filters, the aggregation of a specific measure, and the time basis all change the number, so they must be part of the governed definition (along with owner, description and allowed dimensions). Chart type and colour are presentation choices made in each BI tool; they do not change what revenue means.`,
    },
    {
      kind: 'mcq',
      id: 'semantic.ratio-metric-grain',
      domain: 'semantic',
      difficulty: 2,
      title: 'Why ratio metrics exist',
      prompt: `Instead of defining a ratio metric, a colleague adds an \`aov_usd\` column to a daily mart (revenue / orders per day) and exposes it as \`average(aov_usd)\` in the semantic layer. What goes wrong?`,
      options: [
        'Any query at a grain other than day (week, month, country) averages the daily ratios instead of recomputing revenue / orders at that grain',
        'Nothing, as long as the mart is rebuilt daily',
        'The semantic layer cannot aggregate columns created in marts',
        'It double-counts revenue because the mart and the metric both aggregate',
      ],
      correct: [0],
      explanation: `A ratio metric aggregates the numerator and denominator separately at whatever grain is requested and divides last. A stored daily ratio can only be correct at daily grain; averaging it for a month or by country is the averaging-averages error. Rebuild frequency does not fix the maths. Semantic layers can aggregate mart columns fine, and nothing here is summed twice.`,
    },
    {
      kind: 'mcq',
      id: 'semantic.symmetric-aggregates',
      domain: 'semantic',
      difficulty: 2,
      title: 'Inflated revenue in an explore',
      prompt: `In Looker, the \`orders\` explore joins \`order_items\`. When users add any order-item field, \`orders.total_revenue\` (type: sum) roughly doubles. What is the most likely fix?`,
      options: [
        'Declare `primary_key: yes` on `orders.order_id` and set the join relationship to `one_to_many`, so Looker applies symmetric aggregates',
        'Change the measure type from `sum` to `average`',
        'Convert the order_items view to a PDT',
        'Change the join type from left outer to inner',
      ],
      correct: [0],
      explanation: `Joining items fans out orders (each order appears once per line; Tidepool averages about 1.7 lines per order, and bigger orders have more lines, so the inflated sum is about twice the real one). Looker's symmetric aggregates sum each order once, but only when it knows the primary key and that the join is one-to-many. Averaging changes the metric's meaning. A PDT does not change the join cardinality. An inner join still fans out.`,
    },
    {
      kind: 'mcq',
      id: 'semantic.timezone-mismatch',
      domain: 'semantic',
      difficulty: 2,
      title: 'Daily revenue vs the shop admin',
      prompt: `Australian marketing says Tidepool's daily revenue for AU never matches the e-commerce admin, but weekly totals are close. \`ordered_at\` is stored in UTC and \`order_date\` is \`cast(ordered_at as date)\`. What is the most likely cause?`,
      options: [
        'Day boundaries: orders are bucketed by UTC date, while the admin reports in local time, so orders near midnight land on different days',
        'FX conversion differs between the two systems',
        'The admin includes test accounts',
        'Weekly totals are computed with ISO weeks, which fixes the rounding',
      ],
      correct: [0],
      explanation: `A morning order in Sydney is the previous day in UTC. Daily totals shift between days while weekly totals mostly agree, which is the signature of a time-zone boundary problem rather than a definition difference. FX or test-account differences would also show in weekly totals. ISO weeks are about which day starts the week, not about time zones. The fix is a documented reporting time zone and an explicit conversion.`,
    },
    {
      kind: 'mcq',
      id: 'semantic.cac-denominator',
      domain: 'semantic',
      difficulty: 3,
      title: 'Which CAC?',
      prompt: `The CMO asks for "CAC by month" to decide whether to increase paid social budget. Spend comes from ad platforms; new customers come from \`dim_customers.first_order_at\`. Select **all** sound statements.`,
      options: [
        'Blended CAC (all spend / all new customers) understates the cost of paid acquisition because organic and referral customers are in the denominator',
        'For a paid-social budget decision, a channel-level CAC (paid social spend / customers attributed to paid social) is closer to the question, with the attribution rule stated',
        'CAC should be computed per day and averaged to the month for stability',
        'Using signup month for spend and first-order month for customers is fine because both are monthly',
      ],
      correct: [0, 1],
      explanation: `The numerator is the same, but the denominator decides what the metric answers. Blended CAC is useful for overall efficiency; a budget decision about one channel needs that channel's spend over that channel's customers, with the attribution rule written down. Averaging daily CACs is averaging averages. Mixing time bases (spend month vs a different customer event month) without stating it creates inconsistent pairs; the definition must say which date links spend to customers.`,
    },
    {
      kind: 'mcq',
      id: 'semantic.where-to-define',
      domain: 'semantic',
      difficulty: 3,
      title: 'Two tools, two revenues',
      prompt: `Finance uses Power BI with DAX measures; product uses Hex notebooks with hand-written SQL; an LLM assistant is being piloted for ad-hoc questions. Revenue differs between all three. What is the best medium-term architecture?`,
      options: [
        'Define revenue once in a shared semantic layer on top of the dbt marts, have Hex and the assistant query it, and replace the Power BI measure with the governed definition or a reconciled, tested equivalent owned in one place',
        'Standardise everyone on Power BI and delete the other tools',
        'Add a `revenue` column to every mart so each tool can just sum it',
        'Let each team keep its definition but add a footnote to each dashboard',
      ],
      correct: [0],
      explanation: `The problem is multiple definitions, so the fix is one governed definition consumed by every tool, including the LLM assistant, which benefits most from a semantic API. Where a tool cannot consume the layer directly, the remaining copy must be owned and reconciled by tests. Forcing one tool ignores legitimate needs and does not help the assistant. A column on every mart still leaves filters and aggregation (net vs gross, which statuses) to each tool. Footnotes document the disagreement rather than resolving it.`,
    },
    {
      kind: 'mcq',
      id: 'semantic.exposures-value',
      domain: 'semantic',
      difficulty: 1,
      title: 'What exposures give you',
      prompt: `What is the main practical benefit of declaring the exec revenue dashboard as a dbt exposure?`,
      options: [
        'Lineage shows the dashboard and its owner downstream of the models it uses, and you can select everything it depends on (e.g. `+exposure:weekly_revenue_dashboard`)',
        'dbt refreshes the dashboard in the BI tool after each run',
        'The dashboard is automatically tested for correct numbers',
        'The BI tool reads metric definitions from the exposure',
      ],
      correct: [0],
      explanation: `Exposures are metadata: they make downstream consumers and owners visible in lineage and selectable, which helps with impact analysis, prioritised jobs and incident communication. dbt does not refresh or test the dashboard itself, and BI tools do not read metric logic from exposures (that is the semantic layer's job).`,
    },
    {
      kind: 'order',
      id: 'semantic.metric-rollout',
      domain: 'semantic',
      difficulty: 2,
      title: 'Introduce a governed metric',
      prompt: `Order the steps for introducing a governed "net revenue" metric that replaces three conflicting dashboard calculations.`,
      steps: [
        'Agree the definition with finance and the main consumers: filters, refunds, currency rule, time basis, owner',
        'Make sure the mart exposes the needed columns at a clear grain, with tests',
        'Define the measure and metric in the semantic layer with description and owner, and review it as a PR',
        'Reconcile the new metric against finance figures and explain differences from the old dashboard numbers',
        'Point the dashboards at the governed metric, certify them, and retire the old calculations',
      ],
      explanation: `The definition is a business agreement first. The data must exist cleanly in the mart before the semantic layer can aggregate it. Reconciliation before switching dashboards means stakeholders hear about number changes from you, with explanations, not discover them. Retiring the old calculations is what actually ends the disagreement.`,
    },
    {
      kind: 'open',
      id: 'semantic.define-active-customer',
      domain: 'semantic',
      difficulty: 3,
      title: 'Define "active customers"',
      prompt: `The CEO wants "active customers" on the weekly exec dashboard, by country, with a trend line. Tidepool sells one-off orders and subscriptions. Write the metric definition you would propose and explain the decisions and pitfalls you would raise with the CEO.`,
      placeholder: 'Propose the definition and explain the choices…',
      minWords: 100,
      rubric: [
        'Proposes a precise definition: what counts as activity (non-cancelled order and/or active subscription), the lookback window (e.g. trailing 90 days), exclusions (test accounts)',
        'Explains non-additivity: distinct counts cannot be summed across weeks or summed from daily values; country subtotals and handling of customers who moved',
        'Specifies the time basis and reporting time zone, and how the trailing window is computed per week (cumulative/rolling distinct count)',
        'Names an owner, documents the definition in the semantic layer, and shows it on the dashboard',
        'Raises the business question behind it and offers a companion metric if useful (e.g. new vs returning, or subscriber count separately)',
      ],
      sampleAnswer: `Proposed definition: an active customer is a non-test customer with at least one non-cancelled order or an active subscription in the trailing 90 days, counted at the end of each ISO week (Monday to Sunday, Europe/London reporting time). Ninety days fits a coffee repurchase cycle; 30 days would make one-off buyers flicker in and out. It is a distinct count over a rolling window, so in the semantic layer it is a cumulative metric over a 90-day window, not a sum of weekly or daily actives: summing weeks would count a loyal customer thirteen times. By country I would use the customer's country at the time of the activity, or state clearly that it is the current country. Country rows will add up to the total only if each customer has one country in the window, and the dashboard should say so. Subscribers and one-off buyers behave differently, so I would show the split as a companion breakdown. Finance analytics owns the definition, it lives in the semantic layer with a description, and the dashboard tile links to it. Before building, I would ask the CEO which decision this supports (retention investment, market expansion), because that might make "repeat customers" or "subscribers" the better headline metric.`,
    },
  ],
};
