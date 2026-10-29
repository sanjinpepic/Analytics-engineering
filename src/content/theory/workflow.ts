import type { TheoryModule } from '../types';

export const workflowModule: TheoryModule = {
  id: 'workflow',
  domain: 'workflow',
  title: 'Git, CI/CD and conventions',
  summary:
    'How analytics code moves from a branch to production safely: branching, reviews, environments, Slim CI on GitHub Actions, linting, deployment patterns, infrastructure-as-code and the team guidelines that hold it together.',
  minutes: 23,
  sections: [
    {
      heading: 'Branching for analytics: keep it trunk-based',
      body: `**Trunk-based development:** \`main\` is always deployable; work happens on short-lived feature branches (hours to a few days) merged by pull request. **Gitflow:** long-lived \`develop\` and \`release\` branches with scheduled merges into \`main\`.

For dbt projects, trunk-based almost always wins:

- dbt changes are small and frequent; a release train adds waiting without adding safety.
- Long-lived branches drift from production data and from each other, and merge conflicts in YAML are miserable.
- Safety comes from **CI against real data and tests**, not from a staging branch someone forgot to merge.

Practical rules that work:

- Branch names that say what and why: \`feat/fct-subscriptions-mrr\`, \`fix/orders-fx-weekend\`.
- Small PRs: one model or one concern. A 40-file PR gets rubber-stamped.
- Squash-merge so \`main\` reads as one commit per change, with the PR link.
- Protect \`main\`: required CI checks, at least one approval, no direct pushes.

**Code owners.** A \`CODEOWNERS\` file maps folders to teams, so a change under \`models/marts/finance/\` automatically requests review from finance analytics. It is the lightest way to make domain teams co-owners of their logic without giving them a separate repo.

**Commit messages** should explain *why*, because the diff already shows what: "Exclude test accounts from LTV (agreed with finance, see #231)" is useful two years later; "fix model" is not.

The interview answer to "how would you set up branching?" is: trunk-based, protected main, PRs with required Slim CI, and a reason why gitflow is overhead for analytics (unless the org has a hard release cadence, for example a regulated monthly sign-off).`,
    },
    {
      heading: 'PR hygiene and what a good AE review looks for',
      body: `A good PR description answers: **what changed, why, how it was validated, what it affects downstream**. Include row counts or a before/after comparison for anything touching a metric.

A strong analytics code review is not a SQL style check (the linter does that). It asks:

| Area | Questions |
|---|---|
| **Grain** | Is the grain stated in the model description? Is there a uniqueness test on the primary key? |
| **Joins** | Can any join fan out? Is a left join silently dropping or duplicating rows? Are join keys the same type and casing? |
| **Logic** | Are edge cases handled: test accounts, cancellations, refunds, nulls, timezones, currency? |
| **Tests** | Primary key \`unique\` + \`not_null\`, relationships for foreign keys, accepted values, a unit test for tricky logic? |
| **Naming & layering** | \`stg_\` / \`int_\` / \`fct_\` / \`dim_\` used correctly? Marts not reading raw sources directly? |
| **Performance** | Materialisation sensible? Incremental filter correct and prunable? No \`select *\` from wide tables downstream? |
| **Docs & contracts** | Descriptions for the model and new columns? Breaking change to a contracted or public model? |
| **Downstream impact** | Which exposures, dashboards or reverse-ETL syncs change? Have owners been told? |

Comment style matters. Separate blocking issues from nits ("nit:", "question:", "blocking:"). Suggest the fix, not just the problem. Approve with comments when only nits remain.

**Validate with a data diff, not just a green build.** A model can compile, pass every test and still change numbers. Before asking for review, compare your CI or dev build with production on the same inputs:

\`\`\`sql
-- Row-level comparison of the PR build against prod (any engine with EXCEPT)
select 'only_in_prod' as side, count(*) as row_count from (
  select order_id, order_status, amount_usd from analytics.fct_orders
  except distinct
  select order_id, order_status, amount_usd from dbt_ci_pr_412.fct_orders
)
union all
select 'only_in_pr', count(*) from (
  select order_id, order_status, amount_usd from dbt_ci_pr_412.fct_orders
  except distinct
  select order_id, order_status, amount_usd from analytics.fct_orders
);
\`\`\`

The audit_helper package wraps this pattern in macros (comparing whole relations, or column by column), and commercial data-diff tools post the result straight onto the PR. Paste the summary into the description: "1,204 rows changed, all in \`amount_usd\` for EUR orders on weekends, as expected from the FX fix." That one sentence saves the reviewer twenty minutes and is the strongest evidence you can give.

In practice, the most valuable review comment you can leave is a *data* question: "this changes completed orders in May by 3%, is that expected?" Reviewers who only read SQL miss the bugs that matter.`,
    },
    {
      heading: 'Environments and targets',
      body: `dbt separates *code* from *where it runs* using **targets** in \`profiles.yml\` and schema naming.

| Environment | Who / what | Where it builds | Data |
|---|---|---|---|
| **dev** | Each developer | Personal schema, e.g. \`dbt_akhan\` | Prod sources, often limited by a dev filter |
| **CI** | Pull request runs | Ephemeral schema per PR, e.g. \`dbt_ci_pr_412\` | Prod sources; unchanged parents deferred to prod |
| **staging / pre-prod** (optional) | Release checks, UAT | \`analytics_staging\` | Prod-like |
| **prod** | Scheduled jobs only | \`analytics\` / \`prod\` | Production |

Patterns worth knowing:

- **Limit dev data:** \`{% if target.name == 'dev' %} where ordered_at >= dateadd('day', -30, current_date) {% endif %}\` keeps dev builds fast and cheap.
- **\`generate_schema_name\`** controls whether custom schemas get the developer prefix. Most teams prefix in dev/CI and use clean names in prod.
- **Credentials per environment:** prod runs as a service account with write access only to prod schemas; developers cannot write to prod.
- **Clean up:** drop CI schemas after merge or let them expire (BigQuery default table expiration on the CI dataset works well).

\`\`\`yaml
# profiles.yml (BigQuery)
tidepool:
  target: dev
  outputs:
    dev:
      type: bigquery
      method: oauth
      project: tidepool-analytics
      dataset: "dbt_{{ env_var('USER') }}"
      threads: 8
    ci:
      type: bigquery
      method: oauth
      project: tidepool-analytics
      dataset: "{{ env_var('CI_SCHEMA') }}"
      threads: 16
\`\`\``,
    },
    {
      heading: 'Slim CI with state and defer',
      body: `Building the whole project on every PR is slow and expensive. **Slim CI** builds only what changed and its downstream, and reads everything else from production:

\`\`\`bash
dbt build --select state:modified+ --defer --state prod-artifacts/ --target ci
\`\`\`

- \`--state prod-artifacts/\` points to the \`manifest.json\` from the latest production run.
- \`state:modified\` selects models whose SQL, config or relevant YAML differ from that manifest; the \`+\` adds everything downstream.
- \`--defer\` makes \`ref()\` to an *unselected* model resolve to the production relation instead of a CI one that does not exist.

Result: a PR that changes \`stg_shop__orders\` builds that model, \`fct_orders\`, \`dim_customers\` and their tests in the CI schema, reading unchanged upstream models from prod.

Gotchas:

- You must publish prod artifacts somewhere CI can fetch them (object storage bucket, dbt platform, or a GitHub Actions artifact from the deploy job).
- Changes to macros or vars can modify many models; that is correct, not a bug.
- \`state:modified+\` on an incremental model builds it from scratch in the empty CI schema, which can be large; use a limited CI data window (a \`target.name == 'ci'\` filter) or \`--empty\` for schema-only checks on heavy models.
- After a flaky failure, \`dbt retry\` re-runs only the nodes that errored or were skipped, instead of the whole selection.`,
    },
    {
      heading: 'CI on GitHub Actions: lint, build, test',
      body: `A minimal but real workflow: lint SQL, then Slim CI against a per-PR schema, authenticating to GCP with workload identity federation (no long-lived keys in the repo).

\`\`\`yaml
# .github/workflows/dbt-ci.yml
name: dbt CI
on:
  pull_request:
    paths: ['models/**', 'macros/**', 'tests/**', 'seeds/**', 'dbt_project.yml', 'packages.yml']

permissions:
  contents: read
  id-token: write   # needed for workload identity federation

jobs:
  dbt-ci:
    runs-on: ubuntu-latest
    env:
      CI_SCHEMA: dbt_ci_pr_\${{ github.event.pull_request.number }}
      DBT_PROFILES_DIR: ./ci
    steps:
      - uses: actions/checkout@v4

      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: \${{ secrets.GCP_WIF_PROVIDER }}
          service_account: \${{ secrets.GCP_DBT_CI_SA }}

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install
        run: pip install -r requirements.txt   # pinned dbt-bigquery, sqlfluff, sqlfluff-templater-dbt

      - name: dbt deps
        run: dbt deps

      - name: Lint
        run: sqlfluff lint models --format github-annotation-native

      - name: Fetch production manifest
        run: gcloud storage cp gs://tidepool-dbt-artifacts/prod/manifest.json prod-artifacts/manifest.json

      - name: Slim CI build
        run: dbt build --select state:modified+ --defer --state prod-artifacts --target ci
\`\`\`

Extensions teams add over time: a step that comments row-count diffs on the PR, a dbt-project-evaluator run, a job on merge to \`main\` that deploys and uploads the new manifest, and a scheduled job that drops stale CI schemas. Pin package versions in \`requirements.txt\` and \`packages.yml\`; an unpinned dbt minor upgrade breaking CI on a Friday is a rite of passage you can skip.`,
    },
    {
      heading: 'Linting, project evaluation and pre-commit',
      body: `**SQLFluff** is the standard SQL linter and formatter. With the dbt templater it understands Jinja and \`ref()\`. Configure it once in \`.sqlfluff\` and stop arguing about commas in review.

\`\`\`
# .sqlfluff
[sqlfluff]
dialect = bigquery
templater = dbt
max_line_length = 100

[sqlfluff:rules:capitalisation.keywords]
capitalisation_policy = lower

[sqlfluff:rules:aliasing.table]
aliasing = explicit
\`\`\`

**dbt-project-evaluator** is a dbt package that checks your *project structure* against best practices: models without primary key tests, undocumented models, marts depending directly on sources, hard-coded references instead of \`ref()\`, naming convention breaches, and fan-out in the DAG. Run it in CI and decide which checks are errors and which are warnings; add documented exceptions rather than ignoring the whole package.

**pre-commit** runs checks on the developer's machine before a commit: SQLFluff fix/lint on changed files, YAML validation, trailing whitespace, and dbt-specific hooks (the dbt-checkpoint project offers hooks such as "model has a description" or "model has tests"). Pre-commit gives fast feedback; CI is the enforcement point because people can skip local hooks.

\`\`\`yaml
# .pre-commit-config.yaml (illustrative; pin rev to a release tag you have checked)
repos:
  - repo: https://github.com/sqlfluff/sqlfluff
    rev: <pinned-tag>
    hooks:
      - id: sqlfluff-lint
        additional_dependencies: ['dbt-bigquery', 'sqlfluff-templater-dbt']
\`\`\``,
    },
    {
      heading: 'Deployment, blue/green and write-audit-publish',
      body: `**Plain deploy:** merge to \`main\` triggers a deploy job (or the next scheduled run picks up the new code). Fine for most changes; the risk is that a model builds successfully, its tests fail, and consumers see bad data in between.

**Write-audit-publish (WAP):** write new data somewhere consumers cannot see, audit it with tests, then publish atomically.

- In dbt, \`dbt build\` already gives you a weak form (tests run straight after each model, dependents skip on failure), but the failing model itself is already replaced.
- **Blue/green:** build the whole project into a parallel schema or database (\`analytics_green\`), run all tests, then swap. On Snowflake, \`alter database analytics swap with analytics_green\` is atomic. On BigQuery, consumers can read through views that you repoint after the audit.
- Iceberg-based stacks can implement WAP with table branches.

Choose based on blast radius. A finance mart feeding the board pack deserves WAP; a staging model of page views does not.

**Release practices that matter more than the mechanism:**

- Communicate breaking changes before merge (owners of exposures, BI developers).
- Use **model versions** and deprecation dates for public models rather than changing them in place.
- Keep a rollback path: revert the PR and re-run, or swap back.
- Write a short changelog entry for metric-affecting changes.

**Secrets:** never commit credentials or \`profiles.yml\` with passwords. Use the CI system's secret store, OIDC / workload identity federation for cloud access, \`env_var()\` in dbt, and a secret manager (GCP Secret Manager, AWS Secrets Manager) for anything long-lived. Rotate keys when people leave.`,
    },
    {
      heading: 'Infrastructure-as-code basics for AEs',
      body: `At a company running Terraform, warehouses, datasets, service accounts, roles and grants live in code too. You are unlikely to own the Terraform repo, but you will open PRs against it: "create a dataset for the new marketing marts", "grant the Looker service account read on \`analytics\`".

\`\`\`
# terraform/analytics.tf (GCP)
resource "google_service_account" "dbt_prod" {
  account_id   = "dbt-prod"
  display_name = "dbt production runner"
}

resource "google_bigquery_dataset" "dbt_ci" {
  dataset_id                  = "dbt_ci"
  location                    = "EU"
  default_table_expiration_ms = 259200000 # 3 days: CI tables clean themselves up
  labels = { team = "analytics", env = "ci" }
}

resource "google_bigquery_dataset_iam_member" "dbt_prod_writes_analytics" {
  dataset_id = "analytics"
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:\${google_service_account.dbt_prod.email}"
}
\`\`\`

What to know:

- **plan / apply:** \`terraform plan\` shows the diff; reviewers read the plan, not just the code. \`apply\` usually runs from CI after merge.
- **State** records what Terraform manages. Clicking changes in the console creates drift that the next apply may revert.
- **Least privilege by default:** grant roles to groups and service accounts, not individuals; separate read and write roles; dev users read prod but cannot write it.
- Snowflake has a Terraform provider for warehouses, roles, users and grants; the same principles apply (warehouse size and auto-suspend are code-reviewed settings, which is how cost guardrails become policy).`,
    },
    {
      heading: 'Writing analytics engineering guidelines',
      body: `The ad asks you to "develop guidelines for analytics development, data modeling and structure conventions". A good guideline is short, opinionated, enforced by tooling where possible, and has a reason next to every rule.

**What to standardise:**

| Topic | Example rule |
|---|---|
| **Naming** | \`stg_<source>__<entity>\`, \`int_<entity>__<verb>\`, \`fct_<process>\`, \`dim_<entity>\`; booleans \`is_\` / \`has_\`; timestamps \`_at\`, dates \`_date\`; money with unit (\`_usd\`, \`_cents\`) |
| **Folder structure** | \`models/staging/<source>/\`, \`models/intermediate/<domain>/\`, \`models/marts/<domain>/\`; one YAML file per folder |
| **SQL style** | Lowercase keywords, CTEs not subqueries, import CTEs at the top, one final \`select\`, explicit column lists after staging, trailing commas (enforced by SQLFluff) |
| **Layer rules** | Only staging reads \`source()\`; staging is 1:1 with source tables, renames and casts only; marts never join to raw |
| **Test minimums** | Every model: primary key \`unique\` + \`not_null\`; every foreign key: \`relationships\`; enums: \`accepted_values\`; every source: freshness |
| **Docs** | Every mart and every column in a mart described; grain stated in the model description |
| **Materialisation defaults** | Staging views, marts tables, incremental only with a documented reason and lookback |
| **PR template** | What/why, how validated, downstream impact, screenshots or diffs, checklist |

\`\`\`
# .github/pull_request_template.md (excerpt)
## What and why
## How I validated it (row counts, before/after, queries)
## Downstream impact (exposures, dashboards, syncs)
- [ ] Grain stated and PK tested
- [ ] New columns documented
- [ ] No breaking change to public/contracted models (or version bumped)
\`\`\`

In practice: write the first version in a day, enforce the mechanical parts (SQLFluff, dbt-project-evaluator, CI description checks), and treat the rest as a living document reviewed quarterly. Rules that nobody enforces become fiction.`,
    },
  ],
  keyTerms: [
    { term: 'Trunk-based development', definition: 'Short-lived branches merged frequently into an always-deployable main branch.' },
    { term: 'Target', definition: 'A named connection profile in dbt (dev, ci, prod) that determines where models are built.' },
    { term: 'Slim CI', definition: 'Building only modified models and their dependents in CI, deferring unchanged parents to production.' },
    { term: 'state:modified', definition: 'dbt selector comparing the current project against a previous manifest to find changed nodes.' },
    { term: '--defer', definition: 'Resolves ref() to unselected models from the state manifest (production) instead of the current target.' },
    { term: 'manifest.json', definition: 'dbt artifact describing every node, its config and dependencies; the input to state comparison.' },
    { term: 'SQLFluff', definition: 'SQL linter and formatter with a dbt templater; enforces style automatically.' },
    { term: 'dbt-project-evaluator', definition: 'dbt package that flags structural issues such as missing PK tests, undocumented models and direct source dependencies in marts.' },
    { term: 'pre-commit', definition: 'Framework running checks on changed files before each local commit.' },
    { term: 'Write-audit-publish', definition: 'Write data to a hidden location, run tests on it, then publish atomically only if they pass.' },
    { term: 'Blue/green deployment', definition: 'Building a full parallel environment and swapping it with production after validation.' },
    { term: 'Workload identity federation', definition: 'Letting CI authenticate to a cloud with short-lived tokens instead of stored long-lived keys.' },
    { term: 'Terraform plan', definition: 'A preview of infrastructure changes reviewed before apply.' },
  ],
  landscape: `*Snapshot as of mid-2026.*

- **Faster dbt tooling changed CI expectations.** dbt Labs announced the Rust-based **dbt Fusion** engine (beta) in May 2025 after acquiring SDF Labs. Fusion parses and compiles much faster and understands SQL itself, enabling editor feedback and column-aware checks before anything hits the warehouse, and state-aware orchestration that skips unchanged models.
- **SQLMesh pushed virtual environments.** SQLMesh's plan/apply workflow and virtual data environments (promoting by pointer swaps rather than rebuilding) popularised cheap, safe deploys. Fivetran acquired Tobiko Data, SQLMesh's maker, in 2025, and Fivetran and dbt Labs announced a merger in October 2025, so both tools now sit under related ownership.
- **Keyless CI became the norm.** OIDC / workload identity federation from GitHub Actions to GCP and AWS displaced stored service-account keys in well-run teams.
- **AI-assisted development.** Coding assistants and agents now write a large share of first-draft models, tests and docs. That raises the importance of linting, project evaluation and review checklists, because volume of change went up while reviewer attention did not.
- **Platform-style analytics.** More companies run analytics infrastructure through Terraform and the same CI patterns as software teams, and expect AEs to read a plan and a GitHub Actions workflow.`,
  practice: [
    {
      kind: 'mcq',
      id: 'workflow.defer-purpose',
      domain: 'workflow',
      difficulty: 2,
      title: 'What does --defer do?',
      prompt: `Your CI job runs \`dbt build --select state:modified+ --state prod-artifacts --target ci\` and fails with "relation dbt_ci_pr_57.stg_shop__customers does not exist" when only \`fct_orders\` changed. What is missing?`,
      options: [
        '`--full-refresh`, because CI schemas start empty',
        '`--defer`, so refs to unselected models resolve to their production relations',
        '`--select +state:modified+`, to build all upstream models too',
        'A `dbt seed` step before the build',
      ],
      correct: [1],
      explanation: `Without \`--defer\`, \`ref('stg_shop__customers')\` compiles to the CI schema, where it was never built. Deferral points it at production using the state manifest. Building all upstream models works but defeats the point of Slim CI. Full refresh and seeds do not address the missing parent.`,
    },
    {
      kind: 'mcq',
      id: 'workflow.trunk-vs-gitflow',
      domain: 'workflow',
      difficulty: 1,
      title: 'Branching for a dbt team',
      prompt: 'A five-person analytics team is choosing a branching model for its dbt project. What is the best default?',
      options: [
        'Gitflow with develop and release branches, merged to main monthly',
        'Trunk-based: short-lived feature branches, PRs with required CI, protected main',
        'Everyone commits directly to main to move fast',
        'One long-lived branch per developer, merged quarterly',
      ],
      correct: [1],
      explanation: `Trunk-based keeps branches close to production and makes CI the safety net. Gitflow adds release overhead without adding data validation. Direct commits skip review and CI. Long-lived per-person branches drift and conflict.`,
    },
    {
      kind: 'mcq',
      id: 'workflow.review-priorities',
      domain: 'workflow',
      difficulty: 2,
      title: 'Reviewing a new mart',
      prompt: `A PR adds \`fct_subscription_revenue\` joining subscriptions to payments to customers. Which review comments are the highest value? Select all that apply.`,
      options: [
        '"What is the grain? I don\'t see a uniqueness test on the primary key."',
        '"Payments can have several rows per order (failed attempts, refunds). Can this join fan out?"',
        '"Please use trailing commas" (SQLFluff is already enforced in CI)',
        '"Are test accounts excluded, and is annual revenue normalised to monthly?"',
      ],
      correct: [0, 1, 3],
      explanation: `Grain, fan-out and business logic are where real bugs hide and what a linter cannot catch. Style comments already enforced by tooling are noise; if style is not enforced, the fix is a lint rule, not a review comment.`,
    },
    {
      kind: 'mcq',
      id: 'workflow.secrets-in-ci',
      domain: 'workflow',
      difficulty: 1,
      title: 'Credentials for CI',
      prompt: 'How should a GitHub Actions dbt CI job authenticate to BigQuery?',
      options: [
        'Commit `profiles.yml` with a service account key, since the repo is private',
        'Use workload identity federation (OIDC) with a CI-only service account that can write only to CI datasets',
        'Use the lead AE\'s personal credentials stored as a secret',
        'Use the production service account so CI matches prod exactly',
      ],
      correct: [1],
      explanation: `Short-lived OIDC tokens and a least-privilege CI identity limit damage if anything leaks. Private repos still leak (forks, laptops, logs). Personal credentials break when people leave and blur audit trails. The prod account in CI means a PR can overwrite production.`,
    },
    {
      kind: 'mcq',
      id: 'workflow.wap-when',
      domain: 'workflow',
      difficulty: 3,
      title: 'When to pay for write-audit-publish',
      prompt: `Finance's board-pack mart was once rebuilt with a broken FX join; tests failed, but the CFO had already exported the numbers in the 20 minutes before anyone noticed. \`dbt build\` was in use. What change best prevents a repeat?`,
      options: [
        'Run tests before models instead of after',
        'Write-audit-publish for the finance marts: build and test in a hidden schema, then swap or repoint consumers only when tests pass',
        'Add more tests to the finance mart',
        'Switch the finance mart to a view so it is always current',
      ],
      correct: [1],
      explanation: `\`dbt build\` skips downstream nodes on failure, but the failing model itself has already been replaced, so consumers can read bad data. WAP keeps the old version live until the audit passes. Tests cannot run on data that has not been built; more tests help detection, not exposure; a view would expose broken logic immediately.`,
    },
    {
      kind: 'mcq',
      id: 'workflow.lint-where',
      domain: 'workflow',
      difficulty: 1,
      title: 'pre-commit vs CI',
      prompt: 'The team uses SQLFluff in pre-commit hooks. Why should it also run in CI?',
      options: [
        'CI linting is faster than local linting',
        'Local hooks can be skipped or not installed, so CI is the only enforcement point',
        'SQLFluff only works with the dbt templater in CI',
        'pre-commit cannot lint SQL',
      ],
      correct: [1],
      explanation: `Pre-commit is for fast feedback; anyone can bypass it with \`--no-verify\` or never install it. A required CI check guarantees the rule. Speed and templater support are not the reason.`,
    },
    {
      kind: 'mcq',
      id: 'workflow.terraform-drift',
      domain: 'workflow',
      difficulty: 2,
      title: 'The grant disappeared',
      prompt: `An AE granted the Looker service account read access to a new BigQuery dataset in the console to unblock a launch. Two days later the access vanished. Datasets and IAM are managed by Terraform. What happened and what should the AE have done?`,
      options: [
        'BigQuery expires console grants after 48 hours; re-grant weekly',
        'The next terraform apply removed the unmanaged change (drift). Open a PR to the Terraform repo adding the grant, and agree a fast path for urgent changes',
        'Looker revoked its own permissions; reconnect the integration',
        'The dataset was recreated by dbt, which drops IAM; switch to views',
      ],
      correct: [1],
      explanation: `Terraform reconciles to what is in code, so manual changes to resources it manages are reverted on apply. Changes belong in a PR, with the platform team's process for urgent requests. Console grants do not expire on their own, and dbt does not manage dataset IAM.`,
    },
    {
      kind: 'mcq',
      id: 'workflow.guideline-enforcement',
      domain: 'workflow',
      difficulty: 3,
      title: 'Guidelines that stick',
      prompt: `You wrote Tidepool's AE style guide three months ago. Audit shows half the new models lack PK tests and several marts read sources directly. What is the most effective response?`,
      options: [
        'Re-send the guide to the team and ask people to read it again',
        'Encode the mechanical rules in CI (dbt-project-evaluator checks for PK tests and source dependencies, description checks), add them to the PR template checklist, and fix existing violations with documented exceptions',
        'Make every PR need two senior approvals',
        'Drop the rules that are not being followed',
      ],
      correct: [1],
      explanation: `Rules that are checkable should be checked automatically; the checklist covers judgement calls. Re-sending a document changes nothing. More approvals slow everyone without targeting the gap. Dropping important rules because they are not enforced gets the causality backwards.`,
    },
    {
      kind: 'order',
      id: 'workflow.change-lifecycle',
      domain: 'workflow',
      difficulty: 1,
      title: 'From branch to production',
      prompt: 'Order the lifecycle of a dbt change.',
      steps: [
        'Create a short-lived feature branch from main',
        'Build and validate the change in your dev schema',
        'Open a PR with what/why, validation and downstream impact',
        'CI lints and runs Slim CI against a per-PR schema',
        'Reviewer approves and the PR is squash-merged to main',
        'Deploy job runs in prod and publishes the new manifest',
      ],
      explanation: `Dev validation precedes the PR, CI gates the review, and the production deploy publishes the manifest that the next Slim CI run compares against.`,
    },
    {
      kind: 'open',
      id: 'workflow.ci-design',
      domain: 'workflow',
      difficulty: 2,
      title: 'Design CI for a new team',
      prompt: `Tidepool's dbt project currently has no CI; people run \`dbt run\` from laptops against prod. You have GitHub, GitHub Actions and BigQuery. Describe the CI/CD setup you would introduce in the first month, in order of priority, and why.`,
      rubric: [
        'Removes developer write access to prod and introduces dev schemas plus a prod service account / scheduled deploy',
        'Introduces PR-based workflow with protected main and required checks',
        'Slim CI with state:modified+, --defer and prod manifest published by the deploy job, in a per-PR schema that is cleaned up',
        'Linting (SQLFluff) and structural checks (dbt-project-evaluator / description checks), possibly pre-commit for fast feedback',
        'Secrets handled via OIDC/workload identity and least-privilege service accounts',
        'Sequencing and pragmatism: what first, what later, and why',
      ],
      sampleAnswer: `Week 1: stop laptop runs against prod. Create per-developer dev datasets, a dbt-prod service account that is the only identity writing to analytics, and a scheduled production job (GitHub Actions or the orchestrator) that runs dbt build on main and uploads manifest.json to a bucket. Protect main: PRs only, one approval. Week 2: Slim CI on pull requests. A workflow authenticates with workload identity federation as a CI service account that can write only to the dbt_ci dataset (3-day table expiry), downloads the prod manifest and runs dbt build --select state:modified+ --defer --state prod-artifacts into dbt_ci_pr_<number>. Make it a required check. Week 3: SQLFluff in CI with an agreed config, plus pre-commit for those who want local feedback. Week 4: dbt-project-evaluator in warn mode, then error for PK tests and descriptions on marts, and a PR template. Order matters because protecting prod removes the biggest risk; style can wait.`,
      minWords: 80,
      placeholder: 'Week 1... Week 2...',
    },
  ],
};
