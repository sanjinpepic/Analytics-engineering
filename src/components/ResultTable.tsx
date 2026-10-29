import type { QueryResult } from '../lib/duckdb';
import { cx } from './ui';

export function ResultTable({ result, maxRows = 200, compact, caption }: { result: QueryResult; maxRows?: number; compact?: boolean; caption?: string }) {
  const rows = result.rows.slice(0, maxRows);
  const numeric = result.types.map((t) => /Int|Float|Decimal|Double/i.test(t));
  return (
    <div className="overflow-auto border border-line bg-surface" style={{ maxHeight: compact ? 260 : 420 }}>
      <table className="w-full border-collapse font-mono text-[12.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr>
            <th className="w-10 border-b border-line px-2 py-1.5 text-right font-normal text-ink-3" scope="col">
              #
            </th>
            {result.columns.map((c, i) => (
              <th key={i} scope="col" className={cx('border-b border-line px-3 py-1.5 font-semibold whitespace-nowrap text-ink', numeric[i] ? 'text-right' : 'text-left')}>
                {c}
                <span className="ml-1.5 font-normal text-ink-3">{shortType(result.types[i])}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="even:bg-surface-2/60 hover:bg-primary-soft/50">
              <td className="border-b border-line/60 px-2 py-1 text-right text-ink-3">{ri + 1}</td>
              {r.map((v, ci) => (
                <td key={ci} className={cx('border-b border-line/60 px-3 py-1 whitespace-nowrap', numeric[ci] ? 'text-right' : 'text-left', v === null ? 'text-ink-3 italic' : 'text-ink')}>
                  {v === null ? 'null' : typeof v === 'number' ? formatNum(v) : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length === 0 && <p className="px-3 py-3 text-sm text-ink-3">The query ran and returned no rows.</p>}
    </div>
  );
}

export function ResultMeta({ result }: { result: QueryResult }) {
  return (
    <span className="text-[12.5px] text-ink-3 tnum">
      {result.rows.length.toLocaleString()} row{result.rows.length === 1 ? '' : 's'} · {result.columns.length} col · {result.elapsedMs < 1 ? '<1' : Math.round(result.elapsedMs)} ms
      {result.rows.length > 200 && ' · showing first 200'}
    </span>
  );
}

function shortType(t: string): string {
  if (/Int/i.test(t)) return 'int';
  if (/Float|Double/i.test(t)) return 'num';
  if (/Decimal/i.test(t)) return 'dec';
  if (/Utf8|String/i.test(t)) return 'str';
  if (/Bool/i.test(t)) return 'bool';
  if (/Timestamp/i.test(t)) return 'ts';
  if (/Date/i.test(t)) return 'date';
  return t.toLowerCase().slice(0, 6);
}

function formatNum(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 10000) / 10000);
}
