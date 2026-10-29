/**
 * Exports the workspace as a real dbt project for dbt-duckdb: the learner's model files,
 * the Tidepool raw data as seeds (schemas raw and ingest, so sources resolve unchanged),
 * a local profiles.yml, and packages.yml when dbt_utils is used.
 */
import { strToU8, zipSync } from 'fflate';
import * as yaml from 'js-yaml';
import { generateDataset, toCsv } from './dataset';
import type { ProjectFiles } from './dbt/types';

const DIR = 'tidepool';

const TYPE_MAP: Record<string, string> = { INTEGER: 'integer', VARCHAR: 'varchar', TIMESTAMP: 'timestamp', DATE: 'date', DOUBLE: 'double', BOOLEAN: 'boolean' };

const GENERATE_SCHEMA_NAME = `{#
  Use custom schemas as-is (seeds land in "raw" and "ingest", matching the sources),
  instead of dbt's default "<target_schema>_<custom_schema>".
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
`;

const PROFILES = `# Local DuckDB profile. dbt looks for profiles.yml in the project directory first.
tidepool:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: tidepool.duckdb
      schema: dev
      threads: 4
    prod:
      type: duckdb
      path: tidepool.duckdb
      schema: prod
      threads: 4
`;

const GITIGNORE = `target/
dbt_packages/
logs/
*.duckdb
*.duckdb.wal
.venv/
`;

function readme(usesDbtUtils: boolean): string {
  return `# Tidepool Coffee Co. — dbt project

Exported from AE Licence. Everything here is synthetic. It runs on your laptop with
[dbt-duckdb](https://github.com/duckdb/dbt-duckdb): no warehouse account needed.

## Run it

\`\`\`bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\\Scripts\\activate
pip install "dbt-duckdb>=1.10"
${usesDbtUtils ? 'dbt deps                           # installs dbt_utils\n' : ''}dbt seed                           # loads the raw data into tidepool.duckdb (schemas raw, ingest)
dbt build                          # models + tests into the dev schema
\`\`\`

Then try the same things as in the app:

\`\`\`bash
dbt build -s stg_shop__orders+
dbt source freshness
dbt build --target prod            # build a "prod" schema to defer to
dbt docs generate && dbt docs serve
\`\`\`

Query the result with the DuckDB CLI or Python: \`duckdb tidepool.duckdb "select * from dev.fct_orders limit 10"\`.

## Notes

- \`seeds/raw/*.csv\` is the raw layer (\`raw.customers\`, \`raw.orders\`, …). \`seeds/ingest/events_pending.csv\` holds the late events
  that the app's "EL sync" delivers. To simulate the sync here:
  \`insert into raw.events select * from ingest.events_pending\`, then run your incremental model again.
- \`macros/generate_schema_name.sql\` keeps seed schemas named exactly \`raw\` and \`ingest\` so the sources resolve.
- Freshness is measured against the real clock here, not the app's scenario clock (1 July 2026), so expect stale-source warnings.
- Next steps: put it in Git, add a GitHub Actions workflow running \`dbt build\`, and try the same models on a cloud warehouse.
`;
}

export function buildProjectZip(files: ProjectFiles): Uint8Array {
  const out: Record<string, Uint8Array> = {};
  const add = (path: string, text: string) => {
    out[`${DIR}/${path}`] = strToU8(text);
  };

  const ds = generateDataset();
  const seedsConfig: Record<string, unknown> = { raw: { '+schema': 'raw' }, ingest: { '+schema': 'ingest' } };
  for (const t of ds.tables) {
    const schema = t.schema ?? 'raw';
    add(`seeds/${schema}/${t.name}.csv`, `${toCsv(t)}\n`);
    (seedsConfig[schema] as Record<string, unknown>)[t.name] = {
      '+column_types': Object.fromEntries(t.columns.map((c) => [c.name, TYPE_MAP[c.type] ?? c.type.toLowerCase()])),
    };
  }

  let project: Record<string, unknown> = {};
  try {
    project = (yaml.load(files['dbt_project.yml'] ?? '') as Record<string, unknown>) ?? {};
  } catch {
    project = {};
  }
  const name = String(project.name ?? 'tidepool');
  project = {
    name,
    version: project.version ?? '1.0.0',
    profile: 'tidepool',
    'model-paths': ['models'],
    'seed-paths': ['seeds'],
    'test-paths': ['tests'],
    'macro-paths': ['macros'],
    ...project,
    seeds: { [name]: seedsConfig },
  };
  project.profile = 'tidepool';

  for (const [path, content] of Object.entries(files)) {
    if (path === 'dbt_project.yml') continue;
    add(path, content);
  }
  add('dbt_project.yml', `# Exported from AE Licence\n${yaml.dump(project, { lineWidth: 120 })}`);
  if (!files['macros/generate_schema_name.sql']) add('macros/generate_schema_name.sql', GENERATE_SCHEMA_NAME);
  add('profiles.yml', PROFILES);
  add('.gitignore', GITIGNORE);
  const usesDbtUtils = Object.values(files).some((c) => c.includes('dbt_utils'));
  if (usesDbtUtils) add('packages.yml', 'packages:\n  - package: dbt-labs/dbt_utils\n    version: [">=1.1.0", "<2.0.0"]\n');
  add('README.md', readme(usesDbtUtils));

  return zipSync(out, { level: 6 });
}

export function downloadProjectZip(files: ProjectFiles) {
  const bytes = buildProjectZip(files);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tidepool-dbt-project.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
