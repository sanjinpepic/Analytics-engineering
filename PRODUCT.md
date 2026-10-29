# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: React + Vite + TypeScript single-page app, deployed to GitHub Pages via GitHub Actions (user confirmed the Pages link). Chosen because it is fully static (no backend to run), React matches the target employer's frontend stack, and DuckDB-WASM lets real SQL run in the browser.

## Users

One primary user: a former data/product analyst who worked with dbt, SQL and Excel alongside data engineers and platform teams, then spent ~2 years in product and commercial strategy. They are returning to analytics engineering and preparing for roles like the reference job ad below. They use the tool in focused sessions — sometimes to learn, sometimes to drill, sometimes to sit a full exam — on a laptop.

Secondary reader: Claude, which receives the exported exam report and grades open answers, calibrates the level and writes a focus plan.

## Product Purpose

A "driving school + licence test" for analytics engineering:

- **Learn** the current foundation (theory modules), framed by the real workday of an analytics engineer.
- **Practise** with real execution: SQL against a seeded warehouse and a mini dbt project (refs, sources, Jinja, macros, tests, incremental models, lineage) running entirely in the browser.
- **Examine** themself in a ~75-minute, ~30-task licence exam calibrated to a target job ad, then export a structured report to Claude for grading, levelling and a focus plan.

Success: the user can honestly answer "what level am I at, against this job, and what should I work on next?" — and close those gaps.

## Positioning

Not a quiz app: every SQL and dbt task executes for real against the same fictional company's warehouse (Tidepool Coffee Co.), and the whole practice track follows one simulated workday (incident triage → stakeholder intake → modelling → testing → performance → shipping → metrics → docs). The exam report is written to be graded by Claude, including open-ended answers a machine checker cannot grade.

## Operating Context

Reference target role (LinkedIn ad supplied by the user; the user can paste other ads into the exam):

- Expertise with SQL, dbt, SQLMesh or similar (modelling, testing, macros, docs)
- Data warehousing concepts, cloud warehouses (Snowflake, BigQuery, Redshift, Databricks), BI tools (Looker, Tableau, Power BI, Hex, Metabase)
- Dimensional modelling, data contracts, metrics/semantic layers
- Modern ELT and orchestration (Airflow, Dagster, Prefect)
- Business acumen: translating domain logic into scalable data structures
- Responsibilities: modular/tested/version-controlled models; codifying domain logic into reusable models & metrics; documenting metrics and data contracts; query performance and warehouse cost; docs, lineage and governance automation; analytics development guidelines and conventions
- Employer stack: React, Go, Rust, Cloudflare, GCP, AWS, many LLM providers, GitHub Actions, Grafana, OTEL, Terraform

## Capabilities and Constraints

- Fully client-side; progress is stored in the browser (localStorage). No accounts, no server.
- SQL engine: DuckDB-WASM. The dataset is generated deterministically (same seed for every learner) so grading is reproducible.
- Mini dbt: Jinja via a Jinja-compatible engine; `ref`, `source`, `config`, `var`, `is_incremental`, `this`, macros, generic and singular tests, unit tests, selectors, a dev/prod split with defer. It is a teaching sandbox, not real dbt; anything not supported is explicit.
- Exam: ~75 minutes, ~30 tasks (confirmed). Auto-graded parts score locally; open answers are graded by Claude from the exported report.
- Landscape facts are a snapshot as of mid-2026 and must be labelled as such.

## Evidence on Hand

- The company, people and data are synthetic (Tidepool Coffee Co.) and are labelled as such.
- No testimonials, users or pass statistics exist; none may be invented.

## Product Principles

1. Real execution over recall: wherever a skill can be performed, the user performs it.
2. One continuous workday, not a pile of topics: every exercise sits somewhere in an AE's day.
3. Honest measurement: scoring is transparent and the level is provisional until Claude reviews the open answers.
4. Job-relevant: skill areas map one-to-one to what the target job ad asks for.
5. Low friction: open a link and start; no setup, no account.

## Accessibility & Inclusion

Keyboard operable throughout (including Ctrl/Cmd+Enter to run code), WCAG 2.1 AA contrast, reduced-motion respected.
