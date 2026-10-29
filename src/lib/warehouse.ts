/** Boots the warehouse: raw layer + the reference project built into `prod`. */
import { initRawLayer } from './duckdb';
import { runDbt } from './dbt/runner';
import { TIDEPOOL_PROJECT } from './dbt/tidepoolProject';

let ready: Promise<void> | null = null;

export function bootWarehouse(onProgress?: (msg: string) => void): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    await initRawLayer(onProgress);
    onProgress?.('Building prod (dbt build on main)…');
    const res = await runDbt(TIDEPOOL_PROJECT, { command: 'run', targetSchema: 'prod' });
    if (!res.ok) {
      const err = res.log.filter((l) => l.tone === 'error').map((l) => l.text).join('\n');
      throw new Error(`Building the reference project failed:\n${err}`);
    }
    onProgress?.('Ready');
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
