import type { TheoryModule } from '../types';

export const governanceModule: TheoryModule = {
  id: 'governance',
  domain: 'governance',
  title: 'Docs, lineage and governance',
  summary:
    'How to make data findable, trustworthy and safe: documentation that stays current, lineage, catalogs, ownership and access, PII controls, pipeline observability, and getting metadata ready for LLM agents.',
  minutes: 24,
  sections: [
    {
      heading: 'Governance is a product, not a policy document',
      body: `"Governance" sounds like committees. For an AE it means four very practical questions about every important model:

1. **Can people find it and understand it?** (docs, catalog, naming)
2. **Can they trust it?** (tests, contracts, ownership, freshness, lineage)
3. **Can only the right people see it?** (RBAC, PII masking, row-level security)
4. **Can we change it safely?** (access levels, versions, lineage-based impact analysis)

The job ad's phrase is "**automate** and maintain data documentation, lineage, and governance standards". The key word is automate. Governance that depends on someone remembering to update a wiki fails within a quarter. Governance encoded in YAML, enforced in CI and surfaced in the tools people already use survives.

A pragmatic maturity path:

| Stage | What exists | Next step |
|---|---|---|
| **Ad hoc** | Some descriptions, tribal knowledge, everyone is admin | Owners for top marts; separate prod and dev permissions |
| **Defined** | Naming conventions, PK tests, descriptions on marts, PII identified | CI checks that enforce the conventions; masking policies |
| **Enforced** | Contracts on public models, access levels, grants in code, catalog fed from dbt | Column-level lineage for impact analysis; freshness SLAs per exposure |
| **Measured** | Coverage, freshness and incident metrics on a dashboard, reviewed regularly | Tie standards to consumer outcomes (fewer stakeholder-found incidents) |

Interviewers often ask "how would you improve governance here?". A good answer names the current stage, the one or two highest-risk gaps, and how you would automate the fix, rather than listing every tool in the category.

In practice, start with the models that matter most (the ones behind exec dashboards, finance and reverse-ETL syncs) and make them exemplary, rather than trying to document all 400 models at once.`,
    },
    {
      heading: 'Documentation in dbt',
      body: `dbt docs live next to the code in YAML, so they are reviewed in the same PR as the logic they describe.

\`\`\`yaml
# models/marts/core/_core__models.yml
models:
  - name: dim_customers
    description: '{{ doc("dim_customers") }}'
    columns:
      - name: customer_id
        description: Primary key. One row per customer.
        data_tests: [unique, not_null]
      - name: is_test_account
        description: True for internal and QA accounts (tidepool.example emails). Exclude from all business metrics.
      - name: lifetime_value_usd
        description: Sum of completed, non-test order amounts in USD, net of refunds. Excludes subscriptions.
\`\`\`

\`\`\`jinja
{% docs dim_customers %}
One row per customer who has ever signed up, including those who never ordered.

**Grain:** customer_id. **Source of truth for:** customer counts, first/last order dates, LTV.
Test accounts are flagged, not removed: filter on \`is_test_account = false\`.
{% enddocs %}
\`\`\`

- **Doc blocks** (\`{% docs %}\` in \`.md\` files) hold longer descriptions and can be reused, e.g. one definition of \`customer_id\` referenced from every model.
- **\`persist_docs\`** writes descriptions into the warehouse as table and column comments, so analysts in the BI tool or SQL editor see them without opening dbt docs:

\`\`\`yaml
# dbt_project.yml
models:
  tidepool:
    marts:
      +persist_docs:
        relation: true
        columns: true
\`\`\`

**What a good description contains:** grain, what is included and excluded, units and currency, timezone, known caveats ("last 3 days provisional"), and the owner. "The customer's email" adds nothing; "Lowercased email; PII, masked for non-privileged roles" does.

The warehouse already knows column names and types. Your descriptions should add the business meaning it cannot infer.`,
    },
    {
      heading: 'Lineage and catalogs',
      body: `**Model-level lineage** (which model depends on which) comes free from \`ref()\` and \`source()\`. **Column-level lineage** traces a single column, e.g. \`fct_orders.amount_usd\` back through \`int_orders__fx_converted\` to \`raw.orders.discount_cents\` and \`raw.fx_rates.usd_per_unit\`. It requires parsing the SQL, which tools such as the dbt platform's catalog/explorer, SQLMesh, DataHub and several commercial catalogs do.

Lineage answers the questions you get asked every week:

- **Impact analysis:** "If I rename \`signup_source\`, what breaks?" (models, dashboards, syncs downstream).
- **Root cause:** "Why is this dashboard number wrong?" (walk upstream to the source that changed).
- **Compliance:** "Where does customer email flow?" (every model and tool holding PII).

**Catalogs** collect metadata from the warehouse, dbt, BI and orchestration into one searchable place:

| Catalog | Type | Notes |
|---|---|---|
| **Unity Catalog** | Databricks-native, open-sourced in 2024 | Governance for tables, files, ML models; grants, lineage, tags |
| **Snowflake Horizon** | Snowflake-native | Classification, tags, masking and row access policies, lineage, access history |
| **Google Dataplex** | GCP-native | Catalog, data profiling and quality for BigQuery and GCS |
| **DataHub** | Open source | Broad connectors, column lineage, ownership and glossary |
| **OpenMetadata** | Open source | Catalog, lineage, quality tests, collaboration features |
| **Atlan** | Commercial | "Active metadata": pushes context into Slack, BI tools and workflows |

In practice: a catalog is only as good as the metadata fed into it. The dbt project (descriptions, owners, tags, exposures) is usually the richest source, so investing in dbt YAML pays off in whichever catalog the company buys.`,
    },
    {
      heading: 'Ownership, groups, access, contracts and versions',
      body: `dbt has governance features that turn conventions into enforced rules.

\`\`\`yaml
# models/_groups.yml
groups:
  - name: growth
    owner:
      name: Growth Analytics
      email: growth-analytics@tidepool.example

# models/marts/growth/_growth__models.yml
models:
  - name: fct_orders
    config:
      group: growth
      access: public
      contract:
        enforced: true
    latest_version: 2
    versions:
      - v: 2
      - v: 1
        deprecation_date: 2026-12-31
  - name: int_orders__fx_converted
    config:
      group: growth
      access: private
\`\`\`

| Access | Who can \`ref()\` it |
|---|---|
| **private** | Only models in the same group |
| **protected** (default) | Any model in the same project |
| **public** | Any model, including other projects in a dbt Mesh setup |

- **Groups and owners** give every model an accountable team. Alerts and questions route to them.
- **Contracts** (\`contract: {enforced: true}\`) make dbt check column names and types at build time, so a public model's shape cannot change by accident. See the quality module for testing details; here the point is that a contract is a *promise to consumers*.
- **Versions** let you ship a breaking change as \`fct_orders_v2\` while \`v1\` keeps working until its deprecation date. Consumers migrate on their schedule; you see who still refs \`v1\`.

**dbt Mesh / multi-project:** large organisations split one monolithic project into several (e.g. \`core_platform\`, \`growth\`, \`finance\`). A downstream project declares the upstream in \`dependencies.yml\` and refs its **public** models with a two-argument ref:

\`\`\`sql
select * from {{ ref('core_platform', 'dim_customers') }}
\`\`\`

Interview pitfall: splitting into many projects before you have clear ownership boundaries. Mesh is an organisational tool; if one team owns everything, groups and access inside one project are enough.`,
    },
    {
      heading: 'PII: classify, tag, mask, restrict, erase',
      body: `Tidepool holds names, emails and behavioural events, so it has to handle personal data deliberately.

**1. Classify.** Decide what counts as PII and how sensitive it is (e.g. public / internal / confidential / restricted). Warehouses can auto-suggest classifications (Snowflake Horizon, Google's data profiling), but a human signs off.

**2. Tag in dbt** so the classification travels with the code and can drive policies:

\`\`\`yaml
columns:
  - name: email
    description: Lowercased customer email. PII.
    meta: { pii: true, classification: confidential }   # newer dbt versions nest meta/tags under config
    tags: ['pii']
\`\`\`

**3. Mask** in the warehouse, not in the BI tool, so every access path is covered:

\`\`\`sql
-- Snowflake: dynamic masking policy applied to a column
create masking policy pii_email_mask as (val string) returns string ->
  case when is_role_in_session('PII_READER') then val
       else regexp_replace(val, '^[^@]+', '***') end;

alter table analytics.dim_customers modify column email set masking policy pii_email_mask;

-- BigQuery: row-level security
create row access policy gb_only on analytics.dim_customers
  grant to ('group:uk-ops@tidepool.example')
  filter using (country_code = 'GB');
\`\`\`

BigQuery's column-level equivalent is **policy tags** with data masking rules. A dbt post-hook or a small macro can apply policies to every column tagged \`pii\`, which is the "automate" part.

What a masked view looks like (try it):

\`\`\`sql run
select
  customer_id,
  regexp_replace(email, '^[^@]+', '***') as email_masked,
  md5(lower(email)) as email_hash,
  country_code
from prod.dim_customers
limit 10;
\`\`\`

A hash is **pseudonymisation**, not anonymisation: it still identifies a person if you can hash a known email and compare. Treat hashed identifiers as personal data.

**4. Row-level security** restricts *which rows* a role sees (country teams, franchisees).

**5. Right to erasure (GDPR).** Deleting a customer from the source is not enough. Think about: snapshots (SCD history keeps old rows), incremental models (never revisit old rows), backups and time travel, raw tables, reverse-ETL destinations, and exports. Common patterns: keep PII in as few models as possible (ideally one customer dimension), reference customers by surrogate key elsewhere, and run a scheduled erasure job driven by a deletion-requests table that also purges snapshots.`,
    },
    {
      heading: 'RBAC and least privilege',
      body: `**Role-based access control:** permissions are granted to roles, roles to groups or service accounts, never directly to individuals.

A sensible layout:

| Role | Can | Used by |
|---|---|---|
| \`loader\` | Write \`raw\` | EL tools |
| \`transformer\` | Read \`raw\`, write \`staging\`/\`analytics\` | dbt prod service account |
| \`ci_transformer\` | Read prod, write CI schemas only | GitHub Actions |
| \`developer\` | Read prod, write own dev schema | AEs |
| \`reporter\` | Read \`analytics\` marts only | BI tools |
| \`pii_reader\` | Unmasked PII columns | A handful of named, approved roles |

Principles: **least privilege** (BI tools do not need raw), **separate read and write**, **separate humans and machines**, **review grants in code** (Terraform or a dbt \`grants\` config), and **audit** with access history views. **Access requests in practice.** Make the right path easy: a documented way to request a role (a Terraform PR or a ticket template naming the dataset, purpose and duration), a named approver per domain, and time-limited grants for sensitive data. If getting access takes two weeks, people share credentials or export CSVs, which is worse than any permission you were withholding. Review grants quarterly and remove people who changed teams.

Analysts querying raw because "the mart is missing a column" is a governance smell and a modelling backlog item, not a permission to grant.

\`\`\`yaml
# dbt grants config: applied after each build, versioned with the model
models:
  tidepool:
    marts:
      +grants:
        select: ['reporter']
\`\`\``,
    },
    {
      heading: 'Automating documentation and governance checks',
      body: `Documentation rots unless the pipeline refuses to accept undocumented work.

- **codegen** (dbt package) generates YAML skeletons: \`generate_source\` for a new source and \`generate_model_yaml\` for a model's columns. You fill in meaning rather than typing column names.
- **CI checks:** fail the PR if a new or modified mart, or any of its columns, has no description; if a public model has no contract or owner; if a model lacks a primary key test. dbt-project-evaluator covers several of these out of the box, and simple scripts over \`manifest.json\` cover the rest.
- **Coverage reporting:** track documented-column percentage per layer over time. Marts at near-full coverage, staging lighter.
- **LLM-drafted descriptions:** useful for first drafts, but a human who knows the business must review them; a confident wrong description is worse than none.

The warehouse can tell you what exists, which is the denominator for coverage:

\`\`\`sql run
select table_name, count(*) as column_count
from information_schema.columns
where table_schema = 'prod'
group by table_name
order by column_count desc;
\`\`\``,
    },
    {
      heading: 'Observability: OTEL, Grafana and freshness',
      body: `Tests tell you data is wrong; **observability** tells you the pipeline is unhealthy before anyone looks: runs getting slower, freshness slipping, row counts dropping.

At an engineering-heavy employer the platform likely already uses **OpenTelemetry (OTEL)**, the vendor-neutral standard for traces, metrics and logs, with **Grafana** for dashboards and alerts. Plug the data pipeline into the same system rather than building a separate one:

\`\`\`python
# After each dbt run: emit one metric point per node from run_results.json
# (assumes an OTEL MeterProvider with an OTLP exporter is configured)
import json
from opentelemetry import metrics

meter = metrics.get_meter("tidepool.dbt")
duration = meter.create_histogram("dbt.node.duration", unit="s")

results = json.load(open("target/run_results.json"))["results"]
for r in results:
    duration.record(r["execution_time"], {"node": r["unique_id"], "status": r["status"]})
\`\`\`

Useful Grafana panels: run duration per model over time, test failures by severity, **freshness lag** per source and mart (now minus max loaded timestamp), rows processed per incremental run, and warehouse cost per day by query tag. Alert on freshness against the SLA, not just on job failure: a job can "succeed" on stale data.

\`\`\`sql run
select 'raw.orders' as source, max(_loaded_at) as last_loaded_at from raw.orders
union all
select 'raw.customers', max(_loaded_at) from raw.customers
union all
select 'raw.events', max(_loaded_at) from raw.events;
\`\`\`

Dedicated data-observability tools (Elementary for dbt, Monte Carlo, Metaplane and others) add anomaly detection on volumes and distributions. They complement, not replace, explicit tests.`,
    },
    {
      heading: 'AI-readiness: metadata as grounding for LLM agents',
      body: `Companies now point LLM agents at their data: "how many subscribers churned last month?". Whether the answer is right depends almost entirely on governance work.

**What makes data AI-ready:**

- A **semantic layer** (dbt Semantic Layer / MetricFlow, LookML, Cube) with governed metric definitions, so the agent queries \`churned_subscribers\` instead of inventing SQL over raw tables.
- **Descriptions** that state grain, exclusions and units. To an LLM, "status: order status" is useless; "completed = delivered and not returned; exclude test accounts" is grounding.
- **Clear access levels and contracts**, so agents use public, stable models only.
- **MCP servers** (Model Context Protocol) that expose metadata, lineage and metric queries to agents through a standard interface. dbt, several catalogs and warehouses offer them; the server's permissions decide what the agent can see.

**Risks to raise, and mitigations:**

| Risk | Mitigation |
|---|---|
| **Hallucinated metrics:** the agent writes plausible SQL that double-counts or includes test accounts | Route metric questions through the semantic layer; show the query and definition with the answer |
| **PII leaking to LLM providers** | Masking policies applied to the agent's role; allow-list models; provider terms on retention and training; prefer aggregates |
| **Over-broad permissions** | Agent uses the asking user's permissions or a narrow role, never an admin service account |
| **Prompt injection via metadata** | Treat descriptions and data values as untrusted input; review who can edit metadata |
| **Stale or ungoverned answers** | Surface freshness and owner with every answer |

**First steps that pay off quickly:** pick the ten questions leadership asks most, make sure each maps to a defined metric with a clear description, mark the models an agent may use (public, contracted, documented), and test the agent against known answers before launch, keeping that question set as a regression suite. When the agent is wrong, the fix is usually a missing definition or an ambiguous column name, not a better prompt.

In practice, "make our data AI-ready" is the same backlog as "make our data trustworthy for humans": definitions, docs, tests, ownership, access. It just has a new deadline.`,
    },
  ],
  keyTerms: [
    { term: 'Doc block', definition: 'A reusable Markdown description defined with {% docs %} and referenced via doc() in YAML.' },
    { term: 'persist_docs', definition: 'dbt config that writes model and column descriptions into the warehouse as comments.' },
    { term: 'Column-level lineage', definition: 'Tracing how each column is derived from upstream columns, used for impact analysis and PII tracking.' },
    { term: 'Data catalog', definition: 'A searchable inventory of datasets with descriptions, owners, lineage, tags and usage.' },
    { term: 'Group (dbt)', definition: 'A named set of models with an owner; private models can only be referenced within their group.' },
    { term: 'Model access', definition: 'private, protected or public: controls which models and projects may ref() a model.' },
    { term: 'dbt Mesh', definition: 'Splitting dbt into multiple projects that reference each other’s public models via cross-project ref.' },
    { term: 'Masking policy', definition: 'A warehouse rule that returns redacted values for a column unless the querying role is authorised.' },
    { term: 'Row-level security', definition: 'A policy that filters which rows a role can see in a table.' },
    { term: 'Pseudonymisation', definition: 'Replacing identifiers with tokens or hashes; data remains personal data if re-identification is possible.' },
    { term: 'Least privilege', definition: 'Granting each role only the permissions it needs, separating read/write and humans/machines.' },
    { term: 'OpenTelemetry', definition: 'Vendor-neutral standard and SDKs for emitting traces, metrics and logs to any backend.' },
    { term: 'MCP server', definition: 'A Model Context Protocol service exposing tools and context (metadata, metrics, queries) to LLM agents.' },
  ],
  landscape: `*Snapshot as of mid-2026.*

- **Open catalogs.** Databricks open-sourced Unity Catalog in 2024, and Snowflake originated Apache Polaris as an open Iceberg catalog. As Apache Iceberg became the de-facto open table format, the catalog increasingly became where access policies and lineage live, below any single engine.
- **Warehouse-native governance matured.** Snowflake Horizon, Unity Catalog and Google's Dataplex bundled classification, tagging, policies and lineage, reducing the need for a separate tool for the basics while standalone catalogs (DataHub, OpenMetadata, Atlan) competed on cross-tool coverage.
- **Semantic interoperability.** Snowflake launched the Open Semantic Interchange (OSI) initiative in 2025 with industry partners to standardise how metric and semantic definitions are shared across tools.
- **MCP everywhere.** Model Context Protocol servers became a common way to expose catalogs, dbt metadata and semantic layers to LLM agents, making documentation quality a direct input to AI answer quality.
- **Observability consolidation.** Datadog acquired Metaplane in 2025, pulling data observability towards general-purpose engineering observability stacks.
- **dbt tooling.** dbt Labs announced the Rust-based dbt Fusion engine (beta) in May 2025 after acquiring SDF Labs, bringing faster parsing and built-in SQL comprehension that improves column-level lineage. Fivetran and dbt Labs announced a merger in October 2025.`,
  practice: [
    {
      kind: 'mcq',
      id: 'governance.persist-docs',
      domain: 'governance',
      difficulty: 1,
      title: 'Descriptions in the BI tool',
      prompt: 'Analysts using the warehouse SQL editor and BI tool never see your dbt descriptions. What is the simplest fix?',
      options: [
        'Copy descriptions into a wiki page',
        'Enable `persist_docs` for relations and columns so descriptions become warehouse comments',
        'Rename columns to be longer and self-explanatory',
        'Ask analysts to open dbt docs every time',
      ],
      correct: [1],
      explanation: `\`persist_docs\` writes descriptions to the warehouse, where most SQL editors, BI tools and catalogs pick them up automatically. A wiki goes stale, long names do not carry caveats, and expecting people to switch tools does not work.`,
    },
    {
      kind: 'mcq',
      id: 'governance.access-levels',
      domain: 'governance',
      difficulty: 2,
      title: 'Which access level?',
      prompt: `\`int_orders__fx_converted\` is an implementation detail of the growth team's marts. Another team's model in the same project started ref-ing it, and now growth cannot refactor it without breaking them. What should growth set?`,
      options: [
        '`access: public` with a contract',
        '`access: private` with `group: growth`, so only models in the growth group can ref it',
        '`access: protected`, the default',
        'Materialise it as ephemeral so it cannot be referenced',
      ],
      correct: [1],
      explanation: `Private restricts refs to the owning group, which is exactly the boundary needed. Public is the opposite. Protected (the default) is what allowed the problem. Ephemeral changes materialisation, not who can reference it, and makes debugging harder.`,
    },
    {
      kind: 'mcq',
      id: 'governance.breaking-change-versions',
      domain: 'governance',
      difficulty: 2,
      title: 'Renaming a column in a public model',
      prompt: 'You need to rename `amount_usd` to `net_revenue_usd` in a public, contracted `fct_orders` used by three other projects and a reverse-ETL sync. What is the best approach?',
      options: [
        'Rename it and post in Slack after deploying',
        'Create a new model version (v2) with the new column, keep v1 with a deprecation date, and notify owners found through lineage',
        'Disable the contract temporarily so the rename deploys',
        'Add the new column and silently drop the old one next month',
      ],
      correct: [1],
      explanation: `Versions plus a deprecation date give consumers a migration window, and lineage tells you exactly whom to tell. Renaming in place or disabling the contract breaks consumers; dropping silently is the same break, delayed.`,
    },
    {
      kind: 'mcq',
      id: 'governance.hash-is-pii',
      domain: 'governance',
      difficulty: 2,
      title: 'Is a hashed email anonymous?',
      prompt: 'Marketing wants `md5(lower(email))` shared with an ad partner, arguing that hashed emails are anonymous and outside GDPR. What is the accurate position?',
      options: [
        'Correct: hashing is irreversible, so the data is anonymous',
        'Hashing is pseudonymisation: anyone holding the email can hash and match it, so it is still personal data and needs a lawful basis and agreements',
        'Hashing is fine only if you use SHA-256 instead of MD5',
        'It is anonymous as long as no names are included',
      ],
      correct: [1],
      explanation: `Matching hashed emails is exactly how ad platforms re-identify people, so the hash identifies individuals. Stronger hash functions do not change that. Removing names does not either. This is a legal/privacy decision to escalate, not one an AE makes alone.`,
    },
    {
      kind: 'mcq',
      id: 'governance.mask-where',
      domain: 'governance',
      difficulty: 1,
      title: 'Where to mask PII',
      prompt: 'Why apply masking policies in the warehouse rather than hiding PII columns in the BI tool?',
      options: [
        'Warehouse masking is cheaper to compute',
        'Every access path (BI, SQL editors, notebooks, reverse ETL, LLM agents) goes through the warehouse, so one policy covers them all',
        'BI tools cannot hide columns',
        'Masking in the warehouse removes the data from backups',
      ],
      correct: [1],
      explanation: `Controls in one BI tool leave every other path open. Warehouse policies apply per role regardless of client. Cost is not the reason, BI tools can hide columns (but that is not security), and masking does not touch stored data or backups.`,
    },
    {
      kind: 'mcq',
      id: 'governance.erasure-gaps',
      domain: 'governance',
      difficulty: 3,
      title: 'Erasure request',
      prompt: `A customer's erasure request was processed: their row was deleted from the shop database and log-based CDC propagated a soft delete, which \`stg_shop__customers\` filters out. Where might their personal data still exist? Select all that apply.`,
      options: [
        'A dbt snapshot of customers that keeps historical versions',
        'An incremental model that copied email into event-level rows and never revisits old rows',
        'The CRM, via the reverse-ETL sync of dim_customers',
        'The `prod.dim_customers` table after its next full rebuild',
      ],
      correct: [0, 1, 2],
      explanation: `Snapshots keep history by design, incrementals do not reprocess old rows, and reverse ETL copied the data to another system that needs its own deletion. A full rebuild of dim_customers from the filtered staging model drops the row. Keeping PII in one dimension and joining by key elsewhere shrinks this list.`,
    },
    {
      kind: 'mcq',
      id: 'governance.freshness-alerting',
      domain: 'governance',
      difficulty: 1,
      title: 'Green job, stale data',
      prompt: 'The nightly dbt job has succeeded every day this week, yet the sales dashboard shows no orders since Tuesday. Which observability signal would have caught this?',
      options: [
        'Job success/failure alerts',
        'Freshness lag per source and mart (now minus latest loaded timestamp) alerted against the SLA',
        'Query cost per day',
        'Number of models in the project',
      ],
      correct: [1],
      explanation: `The EL sync stopped, so dbt rebuilt the same data successfully. Only a freshness check sees that. Job status was green, cost may even drop, and model count is irrelevant.`,
    },
    {
      kind: 'mcq',
      id: 'governance.llm-agent-risks',
      domain: 'governance',
      difficulty: 3,
      title: 'Letting an agent answer metric questions',
      prompt: `Leadership wants an LLM agent in Slack answering questions like "what was MRR last month?" via an MCP server connected to the warehouse. Which safeguards are most important? Select all that apply.`,
      options: [
        'Route metric questions through governed semantic-layer definitions and show the definition with the answer',
        'Run the agent with the asking user\'s permissions or a narrow role with PII masked, not an admin account',
        'Expose only documented, public, contracted models to the agent',
        'Give the agent access to raw tables so it can answer anything',
      ],
      correct: [0, 1, 2],
      explanation: `Governed metrics prevent plausible-but-wrong SQL (test accounts, annual plans not normalised). Scoped permissions prevent PII exposure and leaks to the LLM provider. Curated models give the agent grounding with clear grain. Raw access maximises hallucination and leakage risk.`,
    },
    {
      kind: 'order',
      id: 'governance.pii-rollout',
      domain: 'governance',
      difficulty: 2,
      title: 'Roll out PII controls',
      prompt: 'Order the steps for introducing PII controls to an existing warehouse.',
      steps: [
        'Inventory and classify columns that hold personal data (with privacy/legal sign-off)',
        'Tag those columns in dbt YAML so classification lives with the code',
        'Create masking and row access policies and an approved PII reader role',
        'Apply policies automatically to tagged columns (macro or post-hook) and test with different roles',
        'Add a CI check that new columns matching PII patterns must carry a classification tag',
      ],
      explanation: `You cannot protect what you have not found; tags make classification durable; policies need roles to exist; automation keeps it applied as models change; CI stops new PII slipping in untagged.`,
    },
    {
      kind: 'open',
      id: 'governance.docs-automation-plan',
      domain: 'governance',
      difficulty: 2,
      title: 'Fix documentation that rots',
      prompt: `Tidepool's dbt project has 180 models; 20% of mart columns have descriptions, nobody knows who owns half the marts, and analysts keep asking which revenue column to use. Describe how you would raise and keep documentation and ownership standards, and how you would make it automatic.`,
      rubric: [
        'Prioritises by importance (exposures, exec/finance marts, public models) rather than documenting everything at once',
        'Defines what a good description includes (grain, inclusions/exclusions, units, currency, timezone, caveats)',
        'Introduces groups/owners and access levels, possibly contracts on key public models',
        'Automates: codegen skeletons, CI checks for descriptions/owners/PK tests, dbt-project-evaluator, coverage tracking',
        'Surfaces docs where people work (persist_docs to warehouse, catalog, BI) and uses doc blocks for shared definitions',
        'Addresses the "which revenue column" problem with a single defined metric or clearly named columns',
      ],
      sampleAnswer: `Start with what people use: the marts behind exposures and the exec and finance dashboards, about 20 models. For each, agree an owner group in dbt (groups + owner email) and write descriptions that state grain, what is included and excluded, currency and timezone, and caveats. Shared concepts like customer_id and net revenue go in doc blocks so they are defined once. The revenue confusion gets a decision: one net_revenue_usd column with a clear definition, gross amounts renamed explicitly, and the metric defined in the semantic layer. Then make it stick: codegen generates YAML skeletons for new models, CI fails when a new or changed mart or column lacks a description or a model lacks an owner or PK test, and dbt-project-evaluator runs in warn mode for the rest. persist_docs pushes descriptions into BigQuery so the BI tool and SQL editor show them. Track mart column coverage weekly in a dashboard and review gaps in the team retro.`,
      minWords: 80,
      placeholder: 'Prioritise..., define..., automate...',
    },
  ],
};
