import type { TheoryModule } from '../types';

export const qualityModule: TheoryModule = {
  id: 'quality',
  domain: 'quality',
  title: 'Testing, contracts and data incidents',
  summary:
    'How to test dbt projects at the right layers, enforce schemas with model contracts, agree data contracts with producers, and run a calm incident response when numbers break.',
  minutes: 24,
  sections: [
    {
      heading: 'Data tests: assertions that return failing rows',
      body: `A dbt data test is a query that selects **rows that violate an assertion**. Zero rows means pass. Everything else (severity, thresholds, storing failures) is configuration around that one idea. Understanding it makes every test easy to debug: run the compiled SQL and look at the rows.

The four built-in **generic tests**, declared in YAML against a column (dbt 1.10+ puts the parameters under \`arguments:\`):

\`\`\`yaml
models:
  - name: fct_orders
    columns:
      - name: order_id
        data_tests:
          - unique
          - not_null
      - name: order_status
        data_tests:
          - accepted_values:
              arguments:
                values: [placed, shipped, completed, returned, cancelled]
      - name: customer_id
        data_tests:
          - relationships:
              arguments:
                to: ref('dim_customers')
                field: customer_id
              config:
                severity: warn
\`\`\`

- \`unique\` and \`not_null\` together are the **primary key test**. Every model should have one. If a model has no single-column key, test the combination (\`dbt_utils.unique_combination_of_columns\`) and ask whether you have the grain you think you have.
- \`accepted_values\` catches new enum values (a new order status, a new signup source) before they fall into an "other" bucket or out of a CASE statement.
- \`relationships\` is a referential integrity check. At Tidepool it would fail today: legacy guest-checkout orders have customer ids that do not exist. Here is what that test runs:

\`\`\`sql run
-- what a relationships test compiles to (roughly): child rows with no parent
select o.order_id, o.customer_id
from prod.fct_orders as o
left join prod.dim_customers as c using (customer_id)
where c.customer_id is null
\`\`\`

Deciding what to do with those rows is a business question, not a testing one: keep them with an "unknown customer" member, exclude them with a documented filter, or fix them upstream. The test's job is to make the decision explicit; \`severity: warn\` above records that the team has accepted known orphans while still surfacing new ones.`,
    },
    {
      heading: 'Package tests and singular tests',
      body: `**Package tests** extend the vocabulary. The ones experienced AEs reach for most:

| Test | Package | Typical use |
|---|---|---|
| \`unique_combination_of_columns\` | dbt_utils | compound primary key, e.g. (order_id, product_id) |
| \`expression_is_true\` | dbt_utils | row-level rules, e.g. \`amount_local >= 0\` |
| \`accepted_range\` | dbt_utils | numeric bounds, e.g. quantity between 1 and 50 |
| \`recency\` | dbt_utils | the newest row is not older than N hours (freshness for models) |
| \`mutually_exclusive_ranges\` | dbt_utils | type 2 dimensions: no overlapping validity intervals |
| \`expect_column_values_to_match_regex\` | dbt_expectations | email or id formats |
| \`expect_table_row_count_to_be_between\` | dbt_expectations | coarse volume guardrails |
| \`expect_column_pair_values_A_to_be_greater_than_B\` | dbt_expectations | \`shipped_at >= placed_at\` |

**Singular tests** are SQL files in \`tests/\` that return failing rows. Use them for rules that span tables or need real logic. Tidepool ships one (\`assert_no_negative_order_amounts.sql\`). Another good one would catch subscriptions that end before they start:

\`\`\`sql run
-- tests/assert_subscriptions_end_after_start.sql (written against prod here)
select subscription_id, started_at, cancelled_at
from prod.stg_shop__subscriptions
where cancelled_at < started_at
\`\`\`

Reconciliation tests are the most valuable singular tests in practice: "sum of \`fct_order_items.line_amount_local\` per order equals the order subtotal", "monthly revenue in the mart matches finance's ledger within 0.5%". They catch logic errors that column-level tests never will.

If you find yourself copying a singular test with small changes, turn it into a **custom generic test** (a \`{% test %}\` block in \`macros/\` or \`tests/generic/\`) that takes \`model\` and \`column_name\` arguments.`,
    },
    {
      heading: 'Configuring tests: severity, thresholds, where, store_failures',
      body: `Tests are configured under \`config:\` (per test in YAML, or for whole folders in \`dbt_project.yml\`):

\`\`\`yaml
- name: email
  data_tests:
    - not_null:
        config:
          severity: error
          error_if: ">50"
          warn_if: ">0"
          where: "not is_test_account"
          store_failures: true
\`\`\`

- **\`severity\`**: \`error\` (default) fails the run and, under \`dbt build\`, skips downstream nodes. \`warn\` reports but does not block. Use \`warn_if\` / \`error_if\` thresholds to express "a few is tolerable, many is an incident".
- **\`where\`** limits the test to a subset: exclude test accounts, or only check recent partitions of a huge table (\`where: "order_date >= current_date - 7"\`), which is a large cost saving on big incremental models.
- **\`store_failures: true\`** writes failing rows to a table in an audit schema (\`store_failures_as\` chooses table or view). Turn it on for tests you will investigate often; it turns "the test failed" into "here are the 37 rows".
- \`limit\` caps how many failing rows are returned; \`tags\` lets you run subsets (\`dbt test -s tag:critical\`).

**Severity is a policy decision.** A rule of thumb that works: \`error\` for anything that would make a published number wrong (primary keys, relationships on core joins, accepted values feeding metric filters); \`warn\` for hygiene and known, accepted issues. The anti-pattern is a wall of permanent warnings nobody reads. If a warning has been firing for a month, either fix the data, fix the test, or delete it: **alert fatigue is a data quality problem in its own right.**`,
    },
    {
      heading: 'Unit tests: testing logic, not data',
      body: `Data tests check whatever data happens to be in the warehouse. **Unit tests** (dbt 1.8+) check that your SQL logic produces the right output for fixed, hand-written inputs, so you can test the edge cases your real data may not contain yet. They are defined in YAML:

\`\`\`yaml
unit_tests:
  - name: weekend_order_uses_previous_business_day_rate
    description: A Saturday order converts at Friday's FX rate, not Monday's.
    model: fct_orders
    given:
      - input: ref('int_orders__amounts')
        rows:
          - {order_id: 1, customer_id: 10, ordered_at: '2026-06-06 10:00:00', order_date: '2026-06-06', order_status: completed, currency: EUR, total_cents: 1000}
      - input: ref('stg_finance__fx_rates')
        rows:
          - {rate_date: '2026-06-05', currency: EUR, usd_per_unit: 1.10}
          - {rate_date: '2026-06-08', currency: EUR, usd_per_unit: 1.20}
      - input: ref('stg_shop__customers')
        rows:
          - {customer_id: 10, is_test_account: false}
    expect:
      rows:
        - {order_id: 1, amount_usd: 11.00, is_test_account: false}
\`\`\`

You only list the columns that matter; dbt fills the rest with NULLs. Inputs can also be given as CSV or SQL. Under the hood dbt replaces each \`ref\` with your fixture rows and compares the model's output with \`expect\`.

When to write one:

- **Tricky logic**: ASOF and point-in-time joins, window functions, sessionisation, regex parsing, CASE ladders, timezone conversion.
- **Bug fixes**: reproduce the bug as a unit test first, then fix it. It never comes back.
- **Incremental logic**: dbt lets you override \`is_incremental()\` to test the incremental branch with a fixture for \`this\`.

In practice: unit tests run in development and CI, not in production builds (exclude them, e.g. \`--exclude-resource-type unit_test\`), because their result cannot change with new data. They need the direct parents' columns to exist; \`dbt build --empty\` creates schema-only versions of upstream models cheaply. Do not unit-test every \`select\` that renames columns. Ten well-chosen unit tests on the hard models beat two hundred trivial ones.`,
    },
    {
      heading: 'Source freshness, and what to test where',
      body: `**Source freshness** checks that the EL tool is still delivering. Declare \`loaded_at_field\` (a load timestamp, ideally set by the loader rather than the source application) and thresholds:

\`\`\`yaml
sources:
  - name: shop
    schema: raw
    tables:
      - name: orders
        loaded_at_field: _loaded_at
        freshness:
          warn_after: {count: 24, period: hour}
          error_after: {count: 72, period: hour}
\`\`\`

\`dbt source freshness\` compares \`max(loaded_at_field)\` with the current time. Run it at the start of every production job: a stale source means "everything downstream is green and wrong". It also enables the \`source_status:fresher+\` selector, which builds only models whose sources received new data.

Freshness thresholds should follow the business SLA, not the loader schedule: if finance needs yesterday's orders by 07:00, alert early enough for someone to act before 07:00.

**What to test where** is about catching each problem once, as close to its cause as possible:

| Layer | What to test | Why |
|---|---|---|
| Sources | freshness; primary key uniqueness where the source promises it; accepted values on enums you depend on | detects upstream breakage before you transform it |
| Staging | primary key (unique + not_null) on every model, after dedup; accepted values; basic not_nulls | proves your cleaning worked; every downstream model relies on it |
| Intermediate | the grain after each re-grain (unique on the new key); join completeness | fan-out is born here |
| Marts | primary keys; relationships to dimensions; business rules and reconciliations; contracts on public models | protects what people consume |
| Logic-heavy models | unit tests | proves the logic, independent of today's data |

Guidelines: **a primary key test on every model, without exception** (dbt-project-evaluator can enforce it). Do not repeat \`not_null\` on the same column at every layer when it cannot change between layers. Test assumptions the SQL depends on (if a CASE has no ELSE because "status is always one of five values", that assumption deserves an \`accepted_values\` test).`,
    },
    {
      heading: 'Model contracts and model versions',
      body: `Tests check data after a model is built. A **model contract** checks the **shape** of a model before it is published: column names, data types, and constraints. With \`contract: enforced: true\`, dbt fails the build if the model's SQL does not return exactly the declared columns and types.

\`\`\`yaml
models:
  - name: fct_orders
    config:
      contract:
        enforced: true
    columns:
      - name: order_id
        data_type: integer
        constraints:
          - type: not_null
          - type: primary_key
      - name: order_date
        data_type: date
      - name: amount_usd
        data_type: decimal(18, 2)
      # ... every column must be listed with a data_type
\`\`\`

What a contract buys you: a downstream consumer (a BI tool, a reverse-ETL sync, another team's dbt project) can rely on \`amount_usd\` existing and being a decimal. A refactor that accidentally renames or retypes a column fails in CI instead of breaking a dashboard on Monday.

Important nuance for interviews: **constraint enforcement depends on the platform.** Most cloud warehouses enforce \`not_null\` but treat \`primary_key\`, \`unique\` and \`foreign_key\` as informational metadata (useful for query optimisers and BI tools, but not enforced). Postgres enforces them. So keep your \`unique\` data test even when you declare a primary key constraint.

Contracts belong on **public** models: the marts other teams consume. Putting them on every staging model just adds friction. They pair with dbt's other governance features: \`access\` (private, protected, public) and \`groups\` with owners.

**Model versions** handle breaking changes to a contracted model without breaking consumers on the day you merge:

\`\`\`yaml
models:
  - name: dim_customers
    latest_version: 2
    versions:
      - v: 1
        deprecation_date: 2026-09-30
      - v: 2
        columns:
          - include: all
            exclude: [email]
\`\`\`

Both versions are built (\`dim_customers_v1\`, \`dim_customers_v2\`). Consumers pin with \`ref('dim_customers', v=1)\`, an unpinned \`ref\` resolves to the latest version, and the deprecation date gives everyone a migration window. Version only when the change is breaking for someone (removing or renaming a column, changing grain or meaning); additive changes do not need a new version.`,
    },
    {
      heading: 'Data contracts as an organisational agreement',
      body: `A dbt model contract is a technical mechanism inside your project. A **data contract** in the broader sense is an **agreement between a data producer and its consumers**, usually about data crossing a team boundary: the product engineering team that owns the shop database (producer) and the data team whose models depend on \`orders\` (consumer).

A useful contract covers:

- **Schema**: fields, types, nullability, keys, allowed values.
- **Semantics**: what a row means, what each field means ("\`status = completed\` means delivered and past the return window"), units and currencies, timezone.
- **Service levels**: freshness (data no older than N hours), availability, latency, retention, and how backfills or corrections are announced.
- **Quality rules**: the checks the producer guarantees and how they are verified.
- **Ownership and change management**: who owns it, support channel, how breaking changes are proposed, notice periods, versioning.

The **Open Data Contract Standard (ODCS)**, maintained by the Bitol project under the Linux Foundation, defines a YAML format for exactly this, so contracts can be linted, published in a catalog and checked automatically. Open-source tooling (for example the Data Contract CLI) can validate contract files and test them against real data. A simplified, ODCS-flavoured sketch (field names abbreviated):

\`\`\`yaml
# illustrative only: see the ODCS spec for exact field names
kind: DataContract
id: shop-orders
version: 1.2.0
status: active
owner: team-checkout
schema:
  - name: orders
    properties:
      - {name: id, logicalType: integer, required: true, unique: true}
      - {name: status, logicalType: string, required: true}
      - {name: ordered_at, logicalType: timestamp, description: UTC}
slas:
  - {property: freshness, value: 24, unit: hours}
support:
  - {channel: "#checkout-data", tool: slack}
\`\`\`

In practice, the format is the easy part. What makes contracts work: **enforcement at the producer's side** (a CI check in the application repo that fails when a migration drops a contracted column), a **named owner** on both sides, and a **change process** people actually follow. Start with the two or three sources that cause the most incidents, not with a company-wide programme. In an interview, the strong answer distinguishes the dbt feature (\`contract: enforced\`) from the organisational practice, and explains that the second is mostly about people and process.`,
    },
    {
      heading: 'Observability, anomaly detection and incident triage',
      body: `Tests catch the failures you anticipated. **Data observability** tools watch for the ones you did not: volume drops, freshness delays, schema changes, distribution shifts. Options span dbt-native open source (Elementary, which stores dbt run and test results in your warehouse and adds anomaly tests), dedicated platforms (Monte Carlo, Bigeye, Sifflet, Anomalo, Soda), and observability vendors moving into data (Datadog acquired Metaplane in 2025). Most combine metadata (query logs, dbt artifacts, lineage) with statistical monitors.

**Anomaly detection** at its simplest is a z-score against a trailing window:

\`\`\`sql run
with daily as (
    select order_date, count(*) as orders
    from prod.fct_orders
    group by order_date
)
select
    order_date,
    orders,
    round(avg(orders) over w, 1)                                              as mean_prev_28,
    round((orders - avg(orders) over w) / nullif(stddev_samp(orders) over w, 0), 2) as z_score
from daily
window w as (order by order_date rows between 28 preceding and 1 preceding)
qualify order_date >= date '2026-06-15'
order by order_date desc
limit 10
\`\`\`

Real monitors add seasonality (day-of-week), a date spine so empty days count as zero, and minimum volumes. Expect false positives; tune thresholds or they will be muted.

**Incident triage runbook.** When a stakeholder says "revenue looks wrong" or a test fires:

1. **Detect and acknowledge.** Confirm it is real (rerun, check the compiled test SQL and failing rows). Acknowledge in the agreed channel within minutes, even before you know the cause.
2. **Assess impact via lineage.** Walk downstream from the failing node: which marts, exposures and dashboards consume it? Who uses them and for what decisions today? Walk upstream to find the first node where the data is wrong (source freshness, row counts, the last change merged).
3. **Communicate.** A short status: what is affected, since when, what to avoid using, next update time. Mark affected dashboards if your BI tool supports it. Silence is worse than "we are investigating".
4. **Contain and fix.** Stop the bleeding first (a failing \`error\` test under \`dbt build\` already prevents bad data from propagating; otherwise pause the job or revert the change), then fix the root cause in code or upstream.
5. **Backfill.** Rebuild affected models and periods: \`--full-refresh\`, a microbatch range, or a SQLMesh restatement. Verify with the same checks that caught it.
6. **Post-mortem.** Blameless and short: timeline, root cause, why tests did not catch it earlier, and one or two concrete actions (a new test, a contract with the producer, an alert threshold). Then close the loop with the stakeholders.

Interviewers love this question because it tests judgement, not syntax. The common failure is jumping straight to step 4 and fixing silently while the CFO presents a wrong number.`,
    },
  ],
  keyTerms: [
    { term: 'Data test', definition: 'A query that returns rows violating an assertion; zero rows means the test passes.' },
    { term: 'Generic test', definition: 'A parameterised, reusable test applied in YAML, such as unique, not_null, accepted_values and relationships.' },
    { term: 'Singular test', definition: 'A one-off SQL file in tests/ that returns failing rows, used for cross-table or complex business rules.' },
    { term: 'Unit test', definition: 'A dbt (1.8+) test that runs a model on fixed input rows and compares the output to expected rows, testing logic independently of real data.' },
    { term: 'Severity', definition: 'Whether a failing test errors (blocking downstream nodes under dbt build) or only warns; tunable with warn_if and error_if thresholds.' },
    { term: 'store_failures', definition: 'A test config that saves failing rows to an audit table for investigation.' },
    { term: 'Source freshness', definition: 'A check comparing the latest loaded_at_field value of a source with the current time against warn_after and error_after thresholds.' },
    { term: 'Model contract', definition: 'An enforced declaration of a dbt model\'s columns, data types and constraints; the build fails if the model\'s output does not match.' },
    { term: 'Model version', definition: 'A dbt mechanism for publishing a breaking change to a model alongside the old version, with a deprecation date for consumers to migrate.' },
    { term: 'Data contract', definition: 'An agreement between a data producer and its consumers covering schema, semantics, service levels, quality and change management.' },
    { term: 'ODCS', definition: 'The Open Data Contract Standard from the Bitol project (Linux Foundation): a YAML specification for machine-readable data contracts.' },
    { term: 'Data observability', definition: 'Monitoring data freshness, volume, schema and distributions, usually with metadata and lineage, to detect unanticipated issues.' },
    { term: 'Post-mortem', definition: 'A blameless write-up after an incident covering timeline, root cause, impact and preventive actions.' },
  ],
  landscape: `**Snapshot as of mid-2026.**

- **dbt testing matured.** dbt 1.8 (2024) introduced unit tests and renamed model-level \`tests:\` to \`data_tests:\` to make the distinction explicit. dbt 1.10 moved generic test parameters under an \`arguments:\` key. Expect to see all three styles in real projects and job interviews. The Rust-based **dbt Fusion** engine (beta since May 2025) adds static SQL analysis, so some errors that used to surface as failing runs now surface at compile time.
- **Data contracts moved from blog posts to standards.** The Open Data Contract Standard (ODCS), maintained by the Bitol project under the Linux Foundation, became the main open specification, with tooling to lint and test contracts. The practice is still uneven: many organisations use dbt model contracts internally and are earlier on producer-side agreements.
- **Observability consolidation.** Datadog acquired Metaplane in 2025, a sign that data observability is merging with general software observability (the OpenTelemetry and Grafana world many engineering teams already run). dbt-native open-source options such as Elementary remain popular, and several vendors now offer AI-assisted root-cause analysis on top of lineage.
- **AI raises the stakes.** LLM agents querying the warehouse, often through MCP servers, will confidently use whatever data they find. Tests, contracts, freshness and clear descriptions are what keep those answers trustworthy, which has made quality work more visible to leadership.`,
  practice: [
    {
      kind: 'mcq',
      id: 'quality.primary-key-test',
      domain: 'quality',
      difficulty: 1,
      title: 'The minimum test',
      prompt: `You are adding \`stg_shop__refunds\`. If you could add only one kind of test to it, which gives the most protection to everything downstream?`,
      options: [
        '`unique` and `not_null` on the primary key (refund_id)',
        '`accepted_values` on refund_reason',
        'A `dbt_expectations` row count range',
        'A `not_null` test on every column',
      ],
      correct: [0],
      explanation: `The primary key test guarantees the grain. If refunds are duplicated, every join and sum downstream is wrong, and nothing else will tell you. Accepted values protect one column's categories. A row count range catches only gross volume changes. Blanket not_null tests are noisy (many columns are legitimately nullable) and still say nothing about duplicates.`,
    },
    {
      kind: 'mcq',
      id: 'quality.what-a-test-returns',
      domain: 'quality',
      difficulty: 1,
      title: 'How a dbt test decides',
      prompt: `You write a singular test \`tests/assert_no_negative_order_amounts.sql\`. What must the query return for the test to **pass**?`,
      options: [
        'Zero rows: the query should select the rows that violate the rule',
        'A single row containing `true`',
        'Every row of the model, with a boolean `is_valid` column',
        'A count of valid rows greater than zero',
      ],
      correct: [0],
      explanation: `dbt tests select failing rows; zero rows means pass, and any rows (subject to warn_if/error_if thresholds) mean failure. That is why running the compiled test SQL is the fastest way to debug: the output is the list of bad rows. Returning a boolean or a count of valid rows inverts the convention and would make the test fail on every run.`,
    },
    {
      kind: 'mcq',
      id: 'quality.relationships-orphans',
      domain: 'quality',
      difficulty: 2,
      title: 'Known orphans',
      prompt: `The \`relationships\` test from \`fct_orders.customer_id\` to \`dim_customers\` fails with 6 rows: legacy guest-checkout orders whose customer no longer exists. Finance confirms they are real revenue. What is the best response?`,
      options: [
        'Keep the orders, decide how they appear (e.g. an "unknown customer" member or documented NULL handling), and configure the test so these known rows do not fail it while new orphans still do (e.g. a `where` filter or a warn threshold)',
        'Delete the test; it is clearly wrong',
        'Filter the 6 orders out of fct_orders so the test passes',
        'Change the join in dim_customers to an inner join',
      ],
      correct: [0],
      explanation: `The test did its job: it surfaced a business decision. Keeping real revenue, documenting how it is handled and narrowing the test to catch new orphans keeps the signal. Deleting the test loses detection of future orphans. Filtering real revenue out of a fact to make a test green changes the numbers finance reports. An inner join in the dimension does not affect the fact-to-dimension relationship and would drop customers.`,
    },
    {
      kind: 'mcq',
      id: 'quality.unit-vs-data-test',
      domain: 'quality',
      difficulty: 2,
      title: 'Unit test or data test?',
      prompt: `Select **all** checks that are best written as dbt **unit tests** rather than data tests.`,
      options: [
        'A Saturday EUR order converts at Friday\'s FX rate, not Monday\'s',
        'Two events 31 minutes apart for the same visitor start two sessions; 29 minutes apart stay in one',
        '`order_id` in `fct_orders` is unique',
        'Yesterday\'s orders loaded before 07:00',
      ],
      correct: [0, 1],
      explanation: `Both FX and sessionisation rules are logic with edge cases you can describe with a handful of fixed rows; the real data may not even contain the edge case today. Uniqueness of today's data is a data test: it depends on the data, not only on the logic. Arrival time is a freshness check on the source. A useful heuristic: if the check could start failing tomorrow without anyone changing code, it is a data test.`,
    },
    {
      kind: 'mcq',
      id: 'quality.severity-policy',
      domain: 'quality',
      difficulty: 1,
      title: 'Warn or error?',
      prompt: `Which test should most clearly be \`severity: error\` in a production \`dbt build\`?`,
      options: [
        '`unique` on `fct_orders.order_id`, which feeds the revenue dashboard',
        '`not_null` on `dim_customers.country_code`, where 12 customers are known to lack a country',
        '`accepted_values` on a marketing `utm_source` column that changes weekly',
        'A `dbt_expectations` regex check on email format',
      ],
      correct: [0],
      explanation: `A duplicate order id directly inflates published revenue, so it should block downstream models. Known, accepted gaps (missing countries) are better as warnings or thresholds. A volatile marketing column would produce constant noise as an error. Email format is hygiene and rarely changes a published number.`,
    },
    {
      kind: 'mcq',
      id: 'quality.contract-enforcement',
      domain: 'quality',
      difficulty: 3,
      title: 'What does an enforced contract guarantee?',
      prompt: `\`fct_orders\` has \`contract: enforced: true\` with \`constraints: [{type: primary_key}]\` on \`order_id\`, deployed on Snowflake. A colleague proposes removing the \`unique\` data test because "the contract enforces the primary key now". What do you say?`,
      options: [
        'Keep the test: the contract guarantees column names and types (and not_null), but most cloud warehouses including Snowflake do not enforce primary key uniqueness',
        'Agree: an enforced contract rejects duplicate keys at insert time',
        'Agree, but only if the model is materialised as a table',
        'Remove both the test and the constraint; contracts and tests conflict',
      ],
      correct: [0],
      explanation: `Contracts check the shape of the model's output before building it. Constraint enforcement is platform-dependent: Snowflake and BigQuery enforce NOT NULL, while primary key, unique and foreign key constraints are informational. Duplicates would be inserted silently, so the unique test is still the guard. Materialisation does not change that, and contracts and tests are complementary, not conflicting.`,
    },
    {
      kind: 'mcq',
      id: 'quality.version-or-not',
      domain: 'quality',
      difficulty: 2,
      title: 'Does this change need a model version?',
      prompt: `\`dim_customers\` is a contracted, public model used by marketing's reverse-ETL sync and two other teams. Select **all** changes that justify a new model version.`,
      options: [
        'Removing the `email` column for privacy reasons',
        'Changing the grain from one row per customer to one row per customer per country',
        'Adding a new nullable `preferred_roast` column',
        'Improving the column description of `lifetime_value_usd`',
      ],
      correct: [0, 1],
      explanation: `Removing a column and changing the grain break consumers: their queries fail or silently double-count. A new version with a deprecation date gives them time to migrate. Adding a nullable column is additive and does not break anyone, and a description change is metadata only. Versioning additive changes creates needless maintenance.`,
    },
    {
      kind: 'mcq',
      id: 'quality.freshness-green-but-wrong',
      domain: 'quality',
      difficulty: 2,
      title: 'Green but stale',
      prompt: `The nightly \`dbt build\` passed all tests, but the sales dashboard shows no orders for yesterday. The EL tool's orders sync failed silently two days ago. What would have caught this first?`,
      options: [
        'Source freshness on `shop.orders` with a `loaded_at_field`, run at the start of the job with an error threshold tied to the business SLA',
        'A `not_null` test on `fct_orders.order_date`',
        'A model contract on `fct_orders`',
        'A unit test for `stg_shop__orders`',
      ],
      correct: [0],
      explanation: `Stale inputs produce perfectly valid-looking outputs, so column tests, contracts and unit tests all pass. Only a check comparing the latest load time with the current time (source freshness, or a recency test on the model) detects missing new data. Running it first means the job fails loudly instead of rebuilding marts with stale data.`,
    },
    {
      kind: 'mcq',
      id: 'quality.data-contract-scope',
      domain: 'quality',
      difficulty: 3,
      title: 'Starting a data contract',
      prompt: `The checkout engineering team has broken the \`orders\` source three times this quarter by renaming columns during deploys. Leadership asks you to "introduce data contracts". Which first step is most likely to work?`,
      options: [
        'Agree a contract for the orders data with the checkout team (schema, semantics, freshness, owner, change process) and add a CI check in their repository that flags breaking changes to contracted fields',
        'Turn on `contract: enforced` for every staging model in the dbt project',
        'Write an ODCS YAML file for every source in the warehouse and publish them in a catalog',
        'Ask the EL tool to stop syncing schema changes',
      ],
      correct: [0],
      explanation: `The breakage originates with the producer, so the agreement and the enforcement must reach the producer's workflow: a named owner, a change process and a check that runs before their deploy. Enforcing contracts on your own staging models only makes your build fail faster after the producer has already broken things. Writing contracts for everything at once is a document exercise with no enforcement. Blocking schema sync hides changes instead of managing them.`,
    },
    {
      kind: 'order',
      id: 'quality.incident-runbook',
      domain: 'quality',
      difficulty: 2,
      title: 'Incident runbook',
      prompt: `The CFO messages at 08:30: "Yesterday's revenue is half what Shopify says." Order the response steps.`,
      steps: [
        'Confirm the discrepancy and acknowledge in the agreed channel',
        'Assess impact with lineage: which models, dashboards and decisions are affected, and find the first broken node upstream',
        'Communicate scope, what not to use, and when the next update is',
        'Fix the root cause (or revert) so new runs are correct',
        'Backfill affected models and periods and verify the numbers',
        'Write a blameless post-mortem with preventive actions such as a new test or contract',
      ],
      explanation: `Acknowledge quickly, understand the blast radius before acting, and tell people what to avoid while you work. Fixing before assessing risks fixing the wrong thing; fixing before communicating leaves stakeholders using bad numbers. Backfill is separate from the fix because the fix only makes future runs correct. The post-mortem turns the incident into a test, contract or alert.`,
    },
    {
      kind: 'open',
      id: 'quality.test-strategy',
      domain: 'quality',
      difficulty: 3,
      title: 'Design a test strategy',
      prompt: `Tidepool's project has 14 models and 9 tests. You have two days to improve test coverage without creating alert fatigue. Describe which tests you would add, at which layers, with what severities, and how you would decide what not to test.`,
      placeholder: 'Describe your test strategy and priorities…',
      minWords: 100,
      rubric: [
        'Adds primary key tests to every model first, plus freshness on all sources',
        'Places tests by layer: accepted values and dedup checks in staging, grain checks after re-grain, relationships and reconciliations on marts',
        'Uses unit tests selectively for logic-heavy models (FX ASOF join, customer_order_number, sessionisation)',
        'Sets a severity policy: error for anything that changes published numbers, warn or thresholds for known issues, with an owner for warnings',
        'Avoids redundant tests (same not_null at every layer) and explains how to keep the suite fast (where filters, tags)',
        'Mentions enforcement or measurement, e.g. dbt-project-evaluator in CI or reviewing failures regularly',
      ],
      sampleAnswer: `Day one: a unique and not_null primary key test on every one of the 14 models, plus freshness with loaded_at_field on all sources, with error thresholds set from the business SLA (finance needs orders by 07:00). Those protect grain and timeliness, which cause most incidents. In staging I would add accepted_values on order_status, payment_status, plan and signup_source, because CASE statements and metric filters depend on them. On int_orders__amounts I would assert the grain is still one row per order after the item join. On marts: relationships from fct_orders and fct_order_items to dim_customers and dim_products (warn with a where filter for the known guest-checkout orphans), and a reconciliation singular test that order-item totals match order subtotals. Day two: unit tests on the hard logic only: the weekend FX ASOF join, customer_order_number ordering, and the lifetime value calculation that excludes cancelled orders. Severity policy: error when a failure would change a published number, warn for hygiene, and every warning gets an owner and is reviewed weekly or deleted. I would not repeat not_null on columns that pass through unchanged, would use where filters on large incremental models, and would add dbt-project-evaluator to CI so new models cannot ship without a primary key test.`,
    },
  ],
};
