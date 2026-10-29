import { ChevronRight, Table2, Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listRelations, type RelationInfo } from '../lib/duckdb';
import { cx } from './ui';

/** Collapsible catalogue of relations by schema, with column types and comments. */
export function SchemaPanel({ schemas, highlight = [], refreshKey, onInsert }: { schemas: string[]; highlight?: string[]; refreshKey?: unknown; onInsert?: (text: string) => void }) {
  const [rels, setRels] = useState<RelationInfo[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(highlight.map((h) => [h, true])));
  const [filter, setFilter] = useState('');
  const schemaKey = schemas.join(',');

  useEffect(() => {
    let live = true;
    listRelations(schemaKey.split(',')).then((r) => live && setRels(r));
    return () => {
      live = false;
    };
  }, [schemaKey, refreshKey]);

  if (!rels) return <div className="skeleton h-40 w-full" />;
  const shown = rels.filter((r) => !filter || `${r.schema}.${r.name}`.includes(filter.toLowerCase()) || r.columns.some((c) => c.name.includes(filter.toLowerCase())));
  const bySchema = schemas.map((s) => ({ s, rels: shown.filter((r) => r.schema === s) })).filter((g) => g.rels.length);

  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]">
      <label className="sr-only" htmlFor="schema-filter">
        Filter tables and columns
      </label>
      <input
        id="schema-filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter tables or columns"
        className="mb-2 h-8 w-full rounded-[3px] border border-line bg-surface px-2 text-[13px] text-ink placeholder:text-ink-3"
      />
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {bySchema.length === 0 && <p className="px-1 py-2 text-ink-3">No tables match “{filter}”.</p>}
        {bySchema.map(({ s, rels }) => (
          <div key={s} className="mb-3">
            <div className="px-1 pb-1 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{s}</div>
            <ul>
              {rels.map((r) => {
                const key = `${r.schema}.${r.name}`;
                const isOpen = open[key] ?? false;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
                      className={cx('flex w-full items-center gap-1.5 rounded-[3px] px-1 py-1 text-left hover:bg-surface-3', highlight.includes(key) && 'font-semibold text-ink')}
                      title={r.comment ?? undefined}
                    >
                      <ChevronRight size={13} className={cx('shrink-0 text-ink-3 transition-transform duration-150', isOpen && 'rotate-90')} aria-hidden />
                      {r.kind === 'view' ? <Eye size={13} className="shrink-0 text-ink-3" aria-label="view" /> : <Table2 size={13} className="shrink-0 text-ink-3" aria-label="table" />}
                      <span className="truncate font-mono text-[12.5px] text-ink">{r.name}</span>
                    </button>
                    {isOpen && (
                      <div className="mb-1 ml-5 border-l border-line pl-2">
                        {r.comment && <p className="py-1 text-[12px] leading-snug text-ink-3">{r.comment}</p>}
                        <ul>
                          {r.columns.map((c) => (
                            <li key={c.name} className="flex items-baseline justify-between gap-2 py-[1px]">
                              <button
                                type="button"
                                className="truncate text-left font-mono text-[12px] text-ink-2 hover:text-primary"
                                title={c.comment ?? `Insert ${c.name}`}
                                onClick={() => onInsert?.(c.name)}
                              >
                                {c.name}
                              </button>
                              <span className="shrink-0 font-mono text-[11px] text-ink-3">{c.type.toLowerCase()}</span>
                            </li>
                          ))}
                        </ul>
                        {onInsert && (
                          <button type="button" onClick={() => onInsert(key)} className="mt-0.5 text-[12px] text-primary hover:underline">
                            Insert {key}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
