import { DbtWorkspace } from '../components/dbt/DbtWorkspace';
import { Page } from '../components/Shell';
import { NeedsWarehouse } from '../components/Warehouse';
import { Kbd, PageHeader } from '../components/ui';
import { TIDEPOOL_PROJECT } from '../lib/dbt/tidepoolProject';
import { useProgress } from '../store/progress';

export function WorkspacePage() {
  const files = useProgress((s) => s.workspaceFiles) ?? TIDEPOOL_PROJECT;
  const setFiles = useProgress((s) => s.setWorkspaceFiles);
  return (
    <Page wide>
      <PageHeader
        title="dbt workspace"
        lead={
          <>
            Your branch of the Tidepool project. Models build into the <code className="font-mono text-[0.9em]">dev</code> schema and unbuilt refs defer to <code className="font-mono text-[0.9em]">prod</code>. Try <code className="font-mono text-[0.9em]">dbt build -s stg_shop__orders+</code>,{' '}
            <code className="font-mono text-[0.9em]">dbt build -s state:modified+</code> after an edit, or <code className="font-mono text-[0.9em]">dbt source freshness</code>. <Kbd>Ctrl ↵</Kbd> previews the open model.
          </>
        }
      />
      <div className="mt-6">
        <NeedsWarehouse label="the dbt project">
          <DbtWorkspace
            files={files}
            onChange={setFiles}
            targetSchema="dev"
            baseline={TIDEPOOL_PROJECT}
            initialFile="models/marts/fct_orders.sql"
            defaultCommand="dbt build -s state:modified+"
            onReset={() => {
              if (confirm('Reset every file to main? Your edits in the workspace will be lost.')) setFiles(null);
            }}
            height="calc(100dvh - 230px)"
            showSync
          />
        </NeedsWarehouse>
      </div>
      <p className="mt-3 text-[12.5px] text-ink-3">
        This is dbt-lite: a teaching engine that renders Jinja (ref, source, config, var, is_incremental, this, macros), materialises views, tables and incremental models, runs generic, singular and unit tests, enforces contracts, and supports selectors. It is not dbt itself; flags beyond -s, --exclude, --full-refresh and --defer aren’t supported.
      </p>
    </Page>
  );
}
