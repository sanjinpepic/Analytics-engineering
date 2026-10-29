/**
 * Dev-only content verifier (open /verify.html in `npm run dev`, or run `npm run verify-content`).
 * Executes every reference solution: SQL items must run and return rows, numeric items must
 * return a number, dbt items must fail their checks with the starter files and pass with the solution.
 */
import { bootWarehouse } from './lib/warehouse';
import { query } from './lib/duckdb';
import { applyOverrides, exerciseFiles, gradeDbt, gradeSql } from './lib/grading';
import { ALL_ITEMS } from './content/catalog';
import { THEORY } from './content/theory';
import type { DbtItem } from './content/types';

const out = document.getElementById('out')!;
const lines: string[] = [];
const log = (s: string) => {
  lines.push(s);
  out.textContent = lines.join('\n');
};

async function main() {
  await bootWarehouse();
  const ids = new Set<string>();
  let failures = 0;
  const only = new URLSearchParams(location.search).get('only');
  for (const item of ALL_ITEMS) {
    if (ids.has(item.id)) {
      log(`DUPLICATE ID ${item.id}`);
      failures++;
    }
    ids.add(item.id);
    if (only && !item.id.includes(only)) continue;
    try {
      if (item.kind === 'sql') {
        const g = await gradeSql(item, item.solution);
        const rows = g.expected?.rows.length ?? 0;
        if (!g.correct || rows === 0) throw new Error(`solution grade=${g.correct} rows=${rows} ${g.feedback}`);
        if (item.starter) {
          const s = await gradeSql(item, item.starter).catch(() => null);
          if (s?.correct) throw new Error('starter already passes');
        }
        log(`ok   sql      ${item.id} (${rows} rows)`);
      } else if (item.kind === 'numeric') {
        const r = await query(item.solution);
        const v = Number(r.rows[0]?.[0]);
        if (!Number.isFinite(v)) throw new Error(`answer is not a number: ${r.rows[0]?.[0]}`);
        log(`ok   numeric  ${item.id} = ${v}`);
      } else if (item.kind === 'dbt') {
        const di = item as DbtItem;
        const starter = await gradeDbt(di, exerciseFiles(di), 'ex_verify');
        if (starter.correct) throw new Error('starter files already pass all checks');
        const solved = await gradeDbt(di, applyOverrides(exerciseFiles(di), di.solutionFiles), 'ex_verify');
        if (!solved.correct) {
          const bad = solved.checks?.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail ?? ''}`).join(' | ');
          const errs = solved.run.log.filter((l) => l.tone === 'error').map((l) => l.text).slice(0, 8).join('\n      ');
          throw new Error(`solution fails: ${bad}\n      ${errs}`);
        }
        log(`ok   dbt      ${item.id} (starter ${starter.checks?.filter((c) => c.ok).length}/${starter.checks?.length} → solution all pass)`);
      } else if (item.kind === 'mcq') {
        if (!item.correct.length || item.correct.some((i) => i >= item.options.length)) throw new Error('bad correct index');
      } else if (item.kind === 'order') {
        if (item.steps.length < 3) throw new Error('too few steps');
      }
    } catch (e) {
      failures++;
      log(`FAIL ${item.kind.padEnd(8)} ${item.id}: ${(e as Error).message}`);
    }
  }
  // every runnable lesson snippet must execute
  for (const m of THEORY) {
    for (const sec of m.sections) {
      for (const match of sec.body.matchAll(/```sql run\n([\s\S]*?)```/g)) {
        try {
          const r = await query(match[1]);
          log(`ok   lesson   ${m.id} / ${sec.heading.slice(0, 40)} (${r.rows.length} rows)`);
        } catch (e) {
          failures++;
          log(`FAIL lesson   ${m.id} / ${sec.heading}: ${(e as Error).message.split('\n')[0]}`);
        }
      }
    }
  }
  log(`\n${ALL_ITEMS.length} items checked, ${failures} failure(s).`);
  log(failures ? 'VERIFY: FAILED' : 'VERIFY: PASSED');
}

main().catch((e) => log(`VERIFY: CRASHED ${e?.stack ?? e}`));
