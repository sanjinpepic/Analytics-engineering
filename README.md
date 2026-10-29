# AE Licence

A practice ground and licence exam for **analytics engineering**, built for someone returning to the field after a few years away. It covers the skills a modern analytics engineer job ad asks for, and every SQL and dbt task runs for real in your browser.

**Open it:** https://sanjinpepic.github.io/Analytics-engineering/ (once Pages is switched on, see [Deploy](#deploy-github-pages))

## What's inside

| | |
|---|---|
| **Today** | One simulated workday at *Tidepool Coffee Co.* (a synthetic DTC coffee brand), 08:30–17:30: a failing overnight build, a vague stakeholder request, source profiling, modelling, tests and contracts, an incremental model that drops late data, a PR review, defining a metric, docs and the Slack reply. Ten events, one per discipline, about 40 tasks. |
| **Theory** | Ten modules: SQL, dimensional modelling, dbt and SQLMesh, testing and data contracts, metrics/semantic layer and BI, warehouses (Snowflake, BigQuery, Redshift, Databricks) with performance and cost, ELT and orchestration (Airflow, Dagster, Prefect), Git/CI/CD and conventions, docs/lineage/governance, and business translation. Each module has a "landscape, mid-2026" note and 10–14 practice questions. |
| **SQL gym** | 19 graded drills, from monthly AOV to sessionisation, gaps-and-islands, SCD2, ASOF joins, cohort retention, MRR and CAC. |
| **Drills** | Endless generated SQL practice: 16 skills (top-N, share of total, running totals, moving averages with a date spine, growth, top-N per group, anti-joins, dedupe, repeat windows, funnels, sessionisation, pivots, MRR…). Each new question changes the parameters and is graded against a reference query. Weakest skills come up first. |
| **Review** | Spaced repetition (Leitner boxes). Missed items return tomorrow; each correct review stretches the gap to 3, 7, 16, 35 and 90 days. Drill skills come back as new questions. The rail shows how many are due. |
| **dbt workspace** | A real project in a browser editor. `dbt build / run / test / compile / source freshness`, selectors (`+model+`, `state:modified+`, `path:`, `tag:`), a dev schema with defer to prod, Jinja macros, incremental models, generic, singular and unit tests, model contracts, and a lineage graph. |
| **Licence exam** | 30 unseen tasks, about 75 minutes, no hints. Multiple choice, SQL, dbt fixes, ordering and written answers, each with a confidence rating. |
| **Report** | Exports a Markdown/JSON report for Claude: every answer, your SQL and dbt files, rubrics, the target job ad and grading instructions. Claude grades the written answers, sets your level (L1 Learner permit → L5 Instructor), assesses fit against the job ad and writes a 4-week plan. |

All data is generated deterministically, so everyone gets the same warehouse and grading is reproducible. Progress is saved in your browser's local storage. Nothing is sent anywhere unless you copy or download a report.

## How it works

- **SQL engine:** [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview), with schemas `raw` (sources), `prod` (the reference dbt project, built at start-up), `dev` (your workspace) and per-exercise schemas.
- **dbt-lite:** a small teaching engine in `src/lib/dbt/` that renders Jinja with nunjucks (Jinja-compatible syntax), resolves `ref`/`source`, materialises views, tables and incremental models, and runs tests the way `dbt build` does. It is not dbt, and the UI says so.
- **Grading:** SQL answers are compared with a reference result set (order-insensitive unless the task needs an ORDER BY). dbt tasks run checks such as "tests pass", "model equals the reference", "contract enforced" and "an incremental run after late data equals a full refresh".

## Run it locally

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # static site in dist/
npm run verify-content # with the dev server running: executes every reference solution
```

## Deploy (GitHub Pages)

The built site is committed in `docs/`, so Pages can serve it with no build step:

1. In the repository, open **Settings → Pages**. Under **Build and deployment** pick **Source: Deploy from a branch**, then **Branch: `main`**, folder **`/docs`**, and save.
2. After a minute or two the site is live at https://sanjinpepic.github.io/Analytics-engineering/.

After changing the app, run `npm run build:docs` and commit `docs/`.

Alternative: set **Source: GitHub Actions** and run the **Deploy to GitHub Pages** workflow (`.github/workflows/deploy.yml`) manually. It builds `dist/` in CI, so `docs/` isn't needed.

## Project layout

```
src/
  content/        workday, theory modules, SQL gym, exam, job ad, disciplines
  lib/            DuckDB wrapper, data generator, grading, scoring, report builder
  lib/dbt/        dbt-lite: parser (Jinja), runner (materialisations, tests, selectors), reference project
  components/     shell, programme strip, editors, item renderers, dbt workspace, lineage
  pages/          Today, workday events, theory, gym, workspace, exam, results, report
.claude/skills/   impeccable design skill (Apache-2.0, by Paul Bakaus)
PRODUCT.md        product context; DESIGN.md design system
```

The design follows Olle Hjortzberg's poster for the 1912 Stockholm Olympics: poster orange, cream Jugendstil lettering, flag colours for the ten disciplines, and the poster's ticked frame.
