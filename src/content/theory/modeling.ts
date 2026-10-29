import type { TheoryModule } from '../types';

export const modelingModule: TheoryModule = {
  id: 'modeling',
  domain: 'modeling',
  title: 'Dimensional modelling and layered architecture',
  summary:
    'Kimball-style facts and dimensions, slowly changing dimensions and the staging-intermediate-marts layering that turns raw sources into tables people can trust.',
  minutes: 20,
  sections: [
    {
      heading: 'Grain first: the four design decisions',
      body: `Kimball's design process is four decisions, in this order, and the order matters:

1. **Pick the business process.** Not a department or a report: an activity that generates events. Taking an order, collecting a payment, a subscription renewing, a visitor browsing.
2. **Declare the grain.** One sentence: "one row per order line", "one row per customer per day". If you cannot say it in one sentence, you have two tables.
3. **Identify the dimensions.** The who, what, where, when and how that describe each row at that grain: customer, product, date, channel, device.
4. **Identify the facts.** The numeric measurements that are true at that grain: quantity, line amount, discount.

Grain comes before columns because it decides which columns are legal. At "one row per order", \`product_id\` is not a valid dimension (an order has many products), and \`quantity\` is a sum over lines. At "one row per order line", both are natural. Tidepool has both tables for that reason: \`fct_orders\` answers order-level questions (AOV, orders per customer, discount usage) and \`fct_order_items\` answers product questions (units by category, product mix).

**In practice:** pick the lowest grain the source supports and that people actually ask about. Atomic grain is the most flexible because you can always roll up, never down. But a fact at event-level grain with billions of rows may be the wrong thing to put behind a dashboard; add aggregated facts on top rather than raising the base grain.

Interview pitfall: being asked to "design a model for X" and jumping straight to a list of columns. Start by asking which process and which grain, then say it back. Interviewers listen for that sentence.

\`\`\`sql run
-- Two facts, two grains: the order-level total is not the sum of anything you can see per line
select
    (select count(*) from prod.fct_orders)                 as order_rows,
    (select count(distinct order_id) from prod.fct_orders) as distinct_orders,
    (select count(*) from prod.fct_order_items)            as order_item_rows,
    (select count(distinct order_id) from prod.fct_order_items) as orders_with_items
\`\`\``,
    },
    {
      heading: 'Four kinds of fact table',
      body: `| Type | Grain | Tidepool example | Typical measures | Loading pattern |
|---|---|---|---|---|
| **Transactional** | one row per event | \`fct_orders\`, \`fct_order_items\`, payments | amount, quantity | insert-only, append or merge on key |
| **Periodic snapshot** | one row per entity per period | subscriptions active at each month end, inventory per day | balance, active count, MRR | one new slice per period |
| **Accumulating snapshot** | one row per process instance, updated as it moves | an order with placed_at, shipped_at, completed_at, returned_at | durations between milestones, stage flags | rows updated in place |
| **Factless** | one row per event or coverage, no numeric measure | a customer viewed a product; a product was on promotion on a date | count of rows | append |

**Transactional** facts are the default and the most reusable. **Periodic snapshots** exist because some questions are about state, not events: "how many active subscriptions did we have at the end of each month?" cannot be answered by summing events without reconstructing state, so you build the state once:

\`\`\`sql run
with month_ends as (
    select last_day(cast(m as date)) as snapshot_date
    from generate_series(date '2026-01-01', date '2026-06-01', interval 1 month) as t(m)
)
select
    month_ends.snapshot_date,
    count(s.subscription_id)                     as active_subscriptions,
    sum(s.amount_cents) filter (where s.plan = 'monthly') / 100.0 as monthly_plan_amount_local
from month_ends
left join prod.stg_shop__subscriptions as s
    on s.started_at <= month_ends.snapshot_date
   and (s.cancelled_at is null or s.cancelled_at > month_ends.snapshot_date)
group by 1
order by 1
\`\`\`

(That amount mixes currencies, which is fine for a demo and wrong for a mart; convert to USD first.)

**Accumulating snapshots** are ideal for pipelines with a defined set of milestones (order fulfilment, a sales opportunity, a support ticket). They make "median days from placed to shipped" trivial. Their cost is that rows change after they are written, which makes incremental loading harder.

**Factless facts** record that something happened or was eligible. "Which products were viewed but never added to cart?" is a factless fact (views) compared with another fact (cart adds). Coverage tables ("which customers were eligible for the promotion") are the other use, and they are what lets you compute a proper denominator.`,
    },
    {
      heading: 'Additive, semi-additive and non-additive measures',
      body: `How a measure may be summed decides how BI tools and semantic layers are allowed to aggregate it.

- **Additive**: can be summed across every dimension. Revenue, quantity, shipping cents, order count. Most transactional facts are additive.
- **Semi-additive**: can be summed across some dimensions but **not across time**. Active subscriptions, account balance, inventory on hand. Summing month-end active subscriptions over six months gives a number that means nothing. Across time you take the last value (period-end), an average, or a max.
- **Non-additive**: cannot be summed across any dimension. Ratios (conversion rate, return rate, margin %), averages (AOV), and **distinct counts**. Daily unique visitors summed over a month is not monthly unique visitors, because the same visitor appears on many days.

The rule that follows: **store the additive components, compute the ratio at query time.** Store \`revenue_usd\` and \`order_count\` and let the BI tool or semantic layer compute \`revenue / orders\` at whatever grain the user asks for. If you store a pre-computed \`aov\` per day, someone will average it across days and get a mean of daily means, which weights a quiet Sunday equally with Black Friday.

For distinct counts you have three options: compute them from the atomic fact at query time (correct, can be slow), pre-aggregate at each grain you need (correct, rigid), or store approximate sketches (HyperLogLog via \`approx_count_distinct\` or warehouse-specific sketch functions) that can be merged across periods (approximate, flexible).

In practice, put the additivity in the column description and, if you use a semantic layer, encode it there (\`agg: sum\` vs a ratio metric vs a semi-additive measure with a \`non_additive_dimension\`). It is the most useful sentence you can write in a mart's documentation.`,
    },
    {
      heading: 'Dimensions and keys',
      body: `Dimensions hold the descriptive attributes people filter and group by. Good dimensions are **wide, flat and denormalised**: \`dim_customers\` carries country, signup source, first order date and lifetime value in one row, so users never need a chain of joins. Snowflaking (normalising a dimension into sub-tables) saves little storage in a columnar warehouse and costs every user a join.

**Natural vs surrogate keys.** The natural (business) key is what the source system uses: Tidepool's \`customer_id\`. A surrogate key is one the warehouse creates. Kimball insisted on integer surrogate keys; in modern ELT the usual practice is:

- Use the natural key when it is stable and unique across sources.
- Create a **hashed surrogate key** (\`dbt_utils.generate_surrogate_key(['source_system', 'customer_id'])\`) when combining sources whose ids could collide, when the grain is a combination of columns, or when the dimension is type 2 and each version needs its own key.
- Avoid sequence-generated integers in dbt models: they change on every rebuild and break anything that stored them.

**Conformed dimensions** are shared, identical dimensions used by several facts. If \`fct_orders\`, \`fct_sessions\` and \`fct_subscriptions\` all use the same \`dim_customers\` and the same \`dim_dates\`, users can line up orders, sessions and subscriptions by country and month and trust that "country" means the same thing in each. Without conformance you get three slightly different country columns and three slightly different answers.

**Degenerate dimensions** are dimension keys with no dimension table: \`order_id\` on \`fct_order_items\`, or an invoice number. They are useful for grouping lines back into their transaction; there is nothing else to describe, so no table.

**Junk dimensions** collect low-cardinality flags and codes (\`is_gift\`, \`payment_method\`, \`device\`, \`discount_code_type\`) into one small dimension of their combinations, instead of a dozen tiny dimension tables or a dozen flag columns on a huge fact. In columnar warehouses many teams simply keep these flags on the fact; know the term, use judgement.

**Role-playing dimensions** are one dimension used in several roles: \`dim_dates\` as order date, ship date and return date.`,
    },
    {
      heading: 'Slowly changing dimensions: type 1 and type 2',
      body: `Attributes change: a customer moves country, a product changes category. What should historical facts show?

- **Type 1, overwrite**: keep only the current value. Simple and right for corrections (a typo in a name) and for attributes nobody analyses historically. Revenue by country then means "by the customer's current country".
- **Type 2, add a row per version** with \`valid_from\`, \`valid_to\` and \`is_current\`. Facts can join to the version that was true when the event happened. Revenue by country then means "by the country the customer lived in when they ordered".
- Type 3 (a \`previous_value\` column) and the hybrids exist; type 1 and type 2 cover nearly all real work.

\`raw.customers\` is CDC history, so the versions already exist. Customer 16, for example, moved from DE to GB. Building type 2 from it is a \`lead\`:

\`\`\`sql run
select
    id                                                       as customer_id,
    country                                                  as country_code,
    updated_at                                               as valid_from,
    lead(updated_at) over (partition by id order by updated_at, _loaded_at) as valid_to,
    lead(updated_at) over (partition by id order by updated_at, _loaded_at) is null as is_current
from raw.customers
where id in (16, 44)
order by id, valid_from
\`\`\`

The point-in-time join from a fact to a type 2 dimension:

\`\`\`sql
select o.order_id, o.amount_usd, c.country_code as country_at_order
from fct_orders as o
left join dim_customers_history as c
    on  o.customer_id = c.customer_id
    and o.ordered_at >= c.valid_from
    and (o.ordered_at < c.valid_to or c.valid_to is null)
\`\`\`

Details that separate a working AE from a textbook answer:

- **Half-open intervals.** Use \`>= valid_from and < valid_to\` so a timestamp falls into exactly one version. Many teams set \`valid_to\` of the current row to a far-future date (\`9999-12-31\`) to avoid the \`or is null\`; either works, be consistent. dbt snapshots use NULL by default and dbt 1.9 added an option to use a fixed value instead.
- **Test it**: one current row per key, no overlapping intervals, no gaps. \`dbt_utils.mutually_exclusive_ranges\` checks the last two.
- **Where do versions come from?** CDC history (as here), dbt snapshots (which capture changes only when they run, so changes between runs are lost), or a SQLMesh \`SCD_TYPE_2\` model.
- **Do people actually want history?** Ask. Often finance wants "as it was" and marketing wants "as it is now". Offering both, a type 2 history table plus a type 1 current view, is common and cheap.`,
    },
    {
      heading: 'The bus matrix and conformance',
      body: `The **enterprise bus matrix** is Kimball's planning tool: business processes as rows, conformed dimensions as columns, a mark where a process uses a dimension.

| Business process (fact) | Date | Customer | Product | Channel | Device | Currency |
|---|---|---|---|---|---|---|
| Orders (\`fct_orders\`) | x | x | | x | | x |
| Order lines (\`fct_order_items\`) | x | x | x | | | x |
| Payments | x | x | | | | x |
| Subscriptions (monthly snapshot) | x | x | | | | x |
| Web sessions | x | x | | x | x | |
| Marketing spend | x | | | x | | |

Read down a column and you see which dimension, if inconsistent, would break the most analysis (date and customer, always). Read across a row and you see what you need before a fact can ship. Channel appearing on orders, sessions and spend is what makes "cost per acquired customer by channel" possible, and only if the three share one definition of channel. That is exactly the kind of thing that goes wrong in practice: ads platforms say "paid_social", Segment UTMs say "instagram", and signup source says something else again. The mapping belongs in one model, upstream of all three.

In practice nobody draws a giant bus matrix up front any more, but sketching one for a new domain takes ten minutes and is a superb way to scope work with stakeholders and spot missing conformance before it becomes three conflicting dashboards. It also maps neatly onto a semantic layer: facts become semantic models, conformed dimensions become shared entities.`,
    },
    {
      heading: 'Layered architecture: staging, intermediate, marts',
      body: `dbt Labs' project structure guide, which most teams follow with local variations, uses three layers. Tidepool's project is laid out exactly this way.

**Staging (\`models/staging/<source>/\`)**: one model per source table, named \`stg_<source>__<entity>\` with a double underscore: \`stg_shop__orders\`, \`stg_segment__events\`. Staging does light, mechanical work only: rename to your conventions (\`id\` to \`order_id\`), cast types, convert units (cents to dollars if that is your convention), normalise values (\`lower(trim(email))\`), and deduplicate re-delivered or CDC rows. **No joins and no business logic.** Usually materialised as views. Every later model selects from staging, never from \`source()\` directly.

**Intermediate (\`models/intermediate/\`)**: reusable building blocks with a purpose, named \`int_<entity>__<verb or description>\`, e.g. \`int_orders__amounts\` or \`int_payments_pivoted_to_orders\`. Joins, re-graining (pivoting payments to order grain), and business logic that more than one mart needs. Not exposed to end users.

**Marts (\`models/marts/<area>/\`)**: the tables people query, named \`fct_\` and \`dim_\` (some teams use plain business names like \`orders\` and \`customers\` instead). Wide, documented, tested, materialised as tables or incremental. A mart has a stated grain and an owner.

Other conventions worth adopting:

- Primary keys named \`<entity>_id\`; booleans prefixed \`is_\` / \`has_\`; timestamps suffixed \`_at\` and dates \`_date\`; money with the unit or currency in the name (\`amount_usd\`, \`shipping_cents\`).
- One YAML file per directory (\`_staging.yml\`, \`_marts.yml\`) holding descriptions and tests.
- A model should only reference the layer below it or its own layer. A mart selecting from a raw source, or a staging model joining another staging model, is a smell, and the dbt-project-evaluator package flags both.

Why bother? Each layer has one job, so a source change is fixed once in staging, business logic lives in one place, and marts stay simple enough to review.`,
    },
    {
      heading: 'Star schema vs One Big Table, and Data Vault',
      body: `**Star schema**: a fact table with foreign keys to dimension tables. Users join at query time.

**One Big Table (OBT)**: the fact pre-joined to its dimensions into one very wide table, e.g. \`orders_wide\` with every customer and product attribute on every row.

| | Star schema | One Big Table |
|---|---|---|
| Ease for end users | needs joins (BI semantic layers hide them) | trivial: one table, no joins |
| Query performance | joins on small dimensions are cheap in modern warehouses | scans only needed columns; no joins at all |
| Storage and rebuild cost | small | larger; any dimension change means rebuilding the wide table |
| Consistency | one dimension definition shared across facts | each wide table embeds its own copy of attributes |
| SCD history | natural with type 2 joins | must decide at build time which version to embed |
| Mixing grains | facts stay at their own grain | tempting to combine grains, which causes fan-out |

The pragmatic answer most teams land on: **model facts and conformed dimensions as a star, then publish wide tables on top** for specific consumers (a BI explore, a data science feature set, an LLM agent that needs one table). The star is the source of truth; the OBT is a convenient view of it. Columnar storage makes wide tables cheap to scan, but it does not solve the consistency problem.

**Data Vault** in one paragraph: a modelling method for the integration layer of large enterprises with many changing sources. It splits data into **hubs** (unique business keys), **links** (relationships between keys) and **satellites** (descriptive attributes with full history, per source). Loading is insert-only and highly parallel, and every change is auditable. The price is many more tables and joins, so you still build dimensional marts on top for consumption. It earns its keep where auditability and source volatility dominate (banks, insurers, large enterprises); for a company like Tidepool it is overkill, and saying so with reasons is a good interview answer.`,
    },
  ],
  keyTerms: [
    { term: 'Grain', definition: 'The precise meaning of one row in a fact table, declared before choosing dimensions or measures.' },
    { term: 'Fact table', definition: 'A table of measurements of a business process at a declared grain, with keys to the dimensions that describe each measurement.' },
    { term: 'Periodic snapshot', definition: 'A fact table with one row per entity per period that records state (balances, active counts) rather than events.' },
    { term: 'Accumulating snapshot', definition: 'A fact table with one row per process instance and a column per milestone, updated as the instance progresses.' },
    { term: 'Factless fact', definition: 'A fact table with no numeric measures, recording that an event or eligibility occurred; analysed by counting rows.' },
    { term: 'Semi-additive measure', definition: 'A measure that can be summed across some dimensions but not across time, such as an account balance or active subscriptions.' },
    { term: 'Conformed dimension', definition: 'A dimension shared with identical keys and meaning across several fact tables, enabling consistent drill-across analysis.' },
    { term: 'Surrogate key', definition: 'A warehouse-generated key (in dbt usually a hash of natural key columns) used when natural keys collide, are composite, or need versioning.' },
    { term: 'Degenerate dimension', definition: 'A dimension key stored on the fact with no dimension table, e.g. order_id on an order-line fact.' },
    { term: 'Junk dimension', definition: 'A small dimension holding combinations of low-cardinality flags and codes, instead of many tiny dimensions.' },
    { term: 'SCD type 2', definition: 'A slowly changing dimension that keeps one row per version of an entity with valid_from, valid_to and is_current, enabling point-in-time joins.' },
    { term: 'Bus matrix', definition: 'A grid of business processes against conformed dimensions used to plan a dimensional warehouse.' },
    { term: 'One Big Table (OBT)', definition: 'A fact pre-joined with its dimension attributes into one wide table for simple consumption.' },
  ],
  landscape: `**Snapshot as of mid-2026.** Kimball's ideas have aged remarkably well; what changed is where models live and who consumes them.

- **Open table formats and lakehouses.** Apache Iceberg became the de-facto open table format, with catalogs such as Apache Polaris and Unity Catalog, and DuckDB's DuckLake (2025) offered a lighter alternative. Marts are increasingly read by several engines, which raises the value of clear grain, stable keys and documented additivity.
- **Semantic layers pull modelling upwards.** With the dbt Semantic Layer, LookML, Cube and the Snowflake-led Open Semantic Interchange (OSI) initiative launched in 2025, entities, dimensions and measures are now defined in metadata as well as in tables. A clean star schema maps almost one-to-one onto semantic models; a pile of one-off wide tables does not.
- **LLM consumers.** Agents querying the warehouse (often via MCP servers) do far better against well-named, documented, conformed models than against raw or ad-hoc tables. "Model for humans and machines" is a common 2026 framing.
- **Tooling consolidation.** Fivetran acquired Tobiko Data (SQLMesh) in 2025 and announced a merger with dbt Labs in October 2025, so the two most popular transformation frameworks now sit under one corporate roof. Layered staging-intermediate-marts conventions remain the shared vocabulary across both.
- The OBT vs star debate has settled into "both": a governed star underneath, wide tables or semantic-layer views on top.`,
  practice: [
    {
      kind: 'mcq',
      id: 'modeling.declare-grain',
      domain: 'modeling',
      difficulty: 1,
      title: 'Which grain?',
      prompt: `The merchandising lead wants to know units sold and revenue by product category per week, and also which discount codes drive equipment sales. Which fact grain serves this best?`,
      options: [
        'One row per order line (order_id, product_id)',
        'One row per order',
        'One row per product per week',
        'One row per customer',
      ],
      correct: [0],
      explanation: `Product and category only exist at line level, and the discount code can be carried down from the order to each line, so one row per order line answers both questions and can be rolled up to weeks. Order grain cannot be split by product without fan-out. A product-week aggregate answers the first question but loses discount codes and cannot be re-cut later. Customer grain is the wrong process entirely.`,
    },
    {
      kind: 'mcq',
      id: 'modeling.semi-additive',
      domain: 'modeling',
      difficulty: 2,
      title: 'Summing active subscriptions',
      prompt: `A dashboard shows "active subscriptions" from a month-end periodic snapshot. A PM selects January to June and the tile shows the sum of the six month-end values. What is wrong and what should the tile show?`,
      options: [
        'Active subscriptions are semi-additive: they cannot be summed across time; show the value at the end of the selected period (or an average if that is the agreed definition)',
        'Nothing: the sum is the total number of subscriptions that existed in the period',
        'The snapshot should be daily so that the sum is more accurate',
        'Active subscriptions are non-additive and cannot be summed across any dimension, including plan',
      ],
      correct: [0],
      explanation: `A subscription active in all six months is counted six times, so the sum means nothing. State measures are semi-additive: sum across plan or country is fine, but across time you take the period-end value, an average, or a max, and you document which. A daily snapshot makes the sum worse, not better. They are not non-additive: summing across plan at a single date is correct.`,
    },
    {
      kind: 'mcq',
      id: 'modeling.scd2-revenue-by-country',
      domain: 'modeling',
      difficulty: 2,
      title: 'Revenue by country when customers move',
      prompt: `Finance wants Q1 revenue by the country the customer lived in **when they ordered**. Customer 16 moved from DE to GB in May. Today \`dim_customers\` only holds the current country. What do you need?`,
      options: [
        'A type 2 customer history (valid_from, valid_to) and a point-in-time join on ordered_at; or capture country onto the order fact at order time',
        'Keep the type 1 dimension and filter to customers who never moved',
        'Join fct_orders to raw.customers on customer_id to get all historical countries',
        'Rebuild dim_customers as of the end of Q1 every time finance asks',
      ],
      correct: [0],
      explanation: `Historical attribution needs either versioned dimension rows and a join where \`ordered_at\` falls in \`[valid_from, valid_to)\`, or the attribute snapshotted onto the fact when the event happened (often a shipping country on the order). Excluding movers biases the answer. Joining to raw CDC history on id alone fans out to one row per version and double-counts revenue. Rebuilding the dimension as of a date gives one point in time, not the time of each order.`,
    },
    {
      kind: 'mcq',
      id: 'modeling.staging-rules',
      domain: 'modeling',
      difficulty: 1,
      title: 'What belongs in staging?',
      prompt: `Select **all** transformations that belong in \`stg_shop__orders\` under the dbt Labs layering conventions.`,
      options: [
        'Renaming `id` to `order_id` and `status` to `order_status`',
        'Deduplicating re-delivered rows, keeping the latest `_loaded_at`',
        'Joining to `stg_shop__customers` to flag test accounts',
        'Calculating revenue in USD with FX rates',
      ],
      correct: [0, 1],
      explanation: `Staging is one-to-one with the source and does mechanical cleanup: renames, casts, normalisation and removing duplicate deliveries, so every downstream model sees one clean row per order. Joins to other entities (test-account flags) and business calculations (FX conversion) belong in intermediate models or marts, which is exactly where Tidepool does them (\`int_orders__amounts\`, \`fct_orders\`).`,
    },
    {
      kind: 'mcq',
      id: 'modeling.conformed-channel',
      domain: 'modeling',
      difficulty: 2,
      title: 'Three definitions of channel',
      prompt: `Marketing wants cost per acquired customer by channel. Ad spend uses \`paid_social\`/\`paid_search\`, Segment UTMs use \`instagram\`/\`google\`, and customers have a \`signup_source\`. Each team's dashboard shows different channel totals. What is the modelling fix?`,
      options: [
        'Build one conformed channel mapping upstream (e.g. a seed or intermediate model) and use it in spend, sessions and customer acquisition',
        "Let each dashboard keep its own CASE statement, but document the differences",
        'Create a One Big Table joining spend, events and customers on date',
        'Use only signup_source, and drop spend from the analysis',
      ],
      correct: [0],
      explanation: `Drill-across analysis (spend vs acquired customers by channel) only works if both facts share a conformed dimension with one definition. Mapping each source's raw values to a single channel taxonomy once, upstream, fixes all three dashboards. Documented divergent CASE statements guarantee continued disagreement. Joining facts of different grains on date fans out. Dropping spend avoids the question rather than answering it.`,
    },
    {
      kind: 'mcq',
      id: 'modeling.surrogate-key',
      domain: 'modeling',
      difficulty: 2,
      title: 'When to create a surrogate key',
      prompt: `Tidepool acquires a wholesale business whose ERP also numbers customers from 1. You need a combined \`dim_customers\`. What key strategy is most appropriate?`,
      options: [
        'A hashed surrogate key from (source_system, source_customer_id), keeping both natural key columns as attributes',
        'Keep customer_id as the key; collisions are rare',
        'Use row_number() over (order by created_at) as the key',
        'Concatenate first and last name with email as the key',
      ],
      correct: [0],
      explanation: `Ids from two systems collide (both have customer 1), so the key must include the source. Hashing (e.g. \`dbt_utils.generate_surrogate_key\`) is deterministic and stable across rebuilds, and keeping the natural keys lets people trace rows back. Collisions are not rare here; they are guaranteed. A row_number key changes whenever rows are added or reordered, breaking every stored reference. Names and emails change and are not unique.`,
    },
    {
      kind: 'mcq',
      id: 'modeling.obt-tradeoff',
      domain: 'modeling',
      difficulty: 3,
      title: 'Star or One Big Table?',
      prompt: `A product team asks for "one table with everything about orders" so analysts and an LLM agent can query without joins. Select **all** statements that reflect a sound senior position.`,
      options: [
        'Keep fct_orders and the conformed dimensions as the source of truth and publish a wide orders table built from them',
        'The wide table must stay at one grain; adding product-level columns to an order-grain table would fan out order measures',
        'A wide table removes the need for conformed dimensions because all attributes are already on the row',
        'In a columnar warehouse a wide table is always cheaper to maintain than a star, so it should replace the star',
      ],
      correct: [0, 1],
      explanation: `The common, defensible pattern is a governed star underneath with wide tables on top for specific consumers, which also suits LLM agents. Grain discipline still applies: putting line-level product attributes on an order row either fans out or forces arbitrary choices. A wide table copies dimension attributes, so without conformed dimensions underneath each wide table drifts. Columnar storage makes wide tables cheap to scan, not cheap to maintain: any dimension change means rebuilding every wide table that embeds it.`,
    },
    {
      kind: 'mcq',
      id: 'modeling.accumulating-snapshot',
      domain: 'modeling',
      difficulty: 3,
      title: 'Fulfilment durations',
      prompt: `Ops wants median days from placed to shipped and from shipped to completed, by warehouse and week, and to see orders stuck in "shipped" for more than 10 days. Which design fits best?`,
      options: [
        'An accumulating snapshot: one row per order with placed_at, shipped_at, completed_at, returned_at and derived durations, updated as milestones arrive',
        'A periodic snapshot of order status per day',
        'A factless fact of status-change events only',
        'Add a current status column to fct_orders and compute durations in the BI tool',
      ],
      correct: [0],
      explanation: `A process with a fixed set of milestones is the textbook case for an accumulating snapshot: durations become simple column arithmetic and "stuck" orders are rows with shipped_at set and completed_at null. A daily status snapshot can answer it but is far larger and needs window logic for every duration. A status-change event fact is a good source for building the snapshot, but querying it directly makes every duration a pivot. Current status alone loses the milestone timestamps.`,
    },
    {
      kind: 'order',
      id: 'modeling.kimball-steps',
      domain: 'modeling',
      difficulty: 1,
      title: 'Kimball design order',
      prompt: `Put Kimball's dimensional design steps in order.`,
      steps: [
        'Select the business process to model',
        'Declare the grain of the fact table in one sentence',
        'Identify the dimensions that describe each row at that grain',
        'Identify the numeric facts that are true at that grain',
      ],
      explanation: `Grain is declared before dimensions and facts because it decides which dimensions are valid and which measures are true at that level. Choosing columns first is the classic way to end up with a table that mixes grains.`,
    },
    {
      kind: 'order',
      id: 'modeling.layer-flow',
      domain: 'modeling',
      difficulty: 2,
      title: 'From raw to mart',
      prompt: `Order the steps for adding Tidepool's new refunds source to the warehouse, following layered conventions.`,
      steps: [
        'Declare raw.refunds as a source with freshness and describe it',
        'Build stg_shop__refunds: rename, cast, deduplicate; add unique and not_null tests on the key',
        'Build an intermediate model that aggregates refunds to order grain',
        'Join the order-grain refunds into fct_orders as refunded_amount_usd',
        'Document the new column and update the metric definitions that should net out refunds',
      ],
      explanation: `Sources first, then a one-to-one staging model with key tests, then re-grain in intermediate (refunds are one-to-many with orders, so joining them raw into fct_orders would fan out), then the mart, then documentation and downstream metrics. Skipping the intermediate re-grain step is the most common source of double-counted revenue.`,
    },
    {
      kind: 'open',
      id: 'modeling.design-subscriptions',
      domain: 'modeling',
      difficulty: 3,
      title: 'Model subscriptions for MRR',
      prompt: `Tidepool's CFO wants monthly recurring revenue (MRR), new MRR, churned MRR, and active subscriber counts by plan and country, monthly, back to 2025. Using \`stg_shop__subscriptions\` (subscription_id, customer_id, plan, amount_cents, currency, started_at, cancelled_at), describe the models you would build: their grain, key columns, additivity of each measure, and the data issues you would handle.`,
      placeholder: 'Describe the facts and dimensions you would build…',
      minWords: 100,
      rubric: [
        'Proposes a periodic snapshot at one row per subscription per month (or per month-end) built over a date spine',
        'Normalises annual plans to a monthly amount and converts currency to USD with a stated FX rule',
        'Identifies MRR and active counts as semi-additive over time and new/churned MRR as additive movements',
        'Handles data issues: cancelled_at before started_at, open-ended subscriptions, mid-month starts and cancellations',
        'Uses conformed dimensions (customer with country, plan, date) and considers country at the time vs current',
        'Mentions tests or reconciliation (e.g. opening MRR + new - churned = closing MRR)',
      ],
      sampleAnswer: `I would build fct_subscription_months: one row per subscription per month in which it was active at month end, generated by joining subscriptions to a month spine on started_at <= month_end and (cancelled_at is null or cancelled_at > month_end). Columns: subscription_id, customer_id, plan, month, mrr_usd, and flags is_new (first month) and is_churned_next_month. MRR normalises annual plans to amount / 12 and converts to USD at the month-end rate (rule agreed with finance). MRR and active subscriber counts are semi-additive: sum across plan and country, but take the month-end value over time, never sum months. A companion fct_mrr_movements at subscription-month grain holds new, expansion, contraction and churned MRR, which are additive flows. Data issues: two subscriptions have cancelled_at before started_at; I would exclude them in staging with a flag and a warn-level test, and confirm with the source team. Open-ended subscriptions are active to the latest month. Dimensions: dim_customers (conformed, with country; I would ask whether the CFO wants country at the time, which needs SCD2), plan, and dim_dates. I would add a singular test that opening MRR plus new minus churned equals closing MRR for every month.`,
    },
  ],
};
