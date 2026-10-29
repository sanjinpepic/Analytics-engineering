import { useMemo } from 'react';
import type { NodeResult, ParsedProject } from '../../lib/dbt/types';

const NODE_W = 196;
const NODE_H = 30;
const COL_GAP = 64;
const ROW_GAP = 10;

const LAYER_COLOR: Record<string, string> = {
  source: 'var(--d-governance)',
  staging: 'var(--d-modeling)',
  intermediate: 'var(--d-semantic)',
  marts: 'var(--d-dbt)',
  other: 'var(--d-workflow)',
};

/** DAG drawn left-to-right by depth: sources → staging → intermediate → marts. */
export function Lineage({ project, results, selected, onOpen }: { project: ParsedProject; results?: NodeResult[]; selected?: string; onOpen?: (path: string) => void }) {
  const layout = useMemo(() => {
    const depth = new Map<string, number>();
    const usedSources = new Set<string>();
    for (const m of project.models.values()) for (const [s, t] of m.sources) usedSources.add(`${s}.${t}`);
    const d = (name: string, seen = new Set<string>()): number => {
      if (depth.has(name)) return depth.get(name)!;
      if (seen.has(name)) return 1;
      seen.add(name);
      const m = project.models.get(name)!;
      const parents = m.refs.filter((r) => project.models.has(r)).map((r) => d(r, seen));
      const v = 1 + Math.max(0, ...parents);
      depth.set(name, v);
      return v;
    };
    for (const n of project.models.keys()) d(n);
    const nodes: { id: string; label: string; col: number; kind: string; path?: string }[] = [];
    for (const s of usedSources) nodes.push({ id: `source:${s}`, label: s, col: 0, kind: 'source' });
    for (const m of project.models.values()) nodes.push({ id: m.name, label: m.name, col: depth.get(m.name)!, kind: m.layer, path: m.path });
    const cols = new Map<number, typeof nodes>();
    for (const n of nodes) {
      if (!cols.has(n.col)) cols.set(n.col, []);
      cols.get(n.col)!.push(n);
    }
    const pos = new Map<string, { x: number; y: number }>();
    let maxRows = 0;
    for (const [c, list] of cols) {
      list.sort((a, b) => a.label.localeCompare(b.label));
      maxRows = Math.max(maxRows, list.length);
      list.forEach((n, i) => pos.set(n.id, { x: c * (NODE_W + COL_GAP), y: i * (NODE_H + ROW_GAP) }));
    }
    const edges: { from: string; to: string }[] = [];
    for (const m of project.models.values()) {
      for (const r of m.refs) if (project.models.has(r)) edges.push({ from: r, to: m.name });
      for (const [s, t] of m.sources) edges.push({ from: `source:${s}.${t}`, to: m.name });
    }
    const width = (Math.max(...cols.keys()) + 1) * (NODE_W + COL_GAP) - COL_GAP;
    const height = maxRows * (NODE_H + ROW_GAP) - ROW_GAP;
    return { nodes, pos, edges, width, height };
  }, [project]);

  const status = new Map((results ?? []).filter((r) => r.kind === 'model').map((r) => [r.name, r.status]));
  const testStatus = new Map<string, string>();
  for (const r of results ?? []) {
    if (r.kind !== 'test' && r.kind !== 'unit_test') continue;
    for (const m of project.models.keys()) {
      if (r.name.includes(m) && (r.status === 'fail' || r.status === 'error')) testStatus.set(m, 'fail');
      else if (r.name.includes(m) && r.status === 'warn' && !testStatus.has(m)) testStatus.set(m, 'warn');
    }
  }

  const pad = 12;
  return (
    <div className="overflow-auto bg-surface p-3">
      <svg width={layout.width + pad * 2} height={layout.height + pad * 2} role="img" aria-label="Model lineage graph">
        <g transform={`translate(${pad},${pad})`}>
          {layout.edges.map((e, i) => {
            const a = layout.pos.get(e.from);
            const b = layout.pos.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            const hot = selected && (e.from === selected || e.to === selected);
            return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={hot ? 'var(--primary)' : 'var(--line-strong)'} strokeWidth={hot ? 1.75 : 1} />;
          })}
          {layout.nodes.map((n) => {
            const p = layout.pos.get(n.id)!;
            const st = status.get(n.id);
            const ts = testStatus.get(n.id);
            const ring = st === 'error' || ts === 'fail' ? 'var(--bad)' : st === 'skipped' ? 'var(--warn)' : ts === 'warn' ? 'var(--warn)' : st === 'success' ? 'var(--ok)' : 'var(--line-strong)';
            const isSel = selected === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className={n.path ? 'cursor-pointer' : undefined}
                onClick={() => n.path && onOpen?.(n.path)}
                onKeyDown={(e) => {
                  if (n.path && (e.key === 'Enter' || e.key === ' ')) onOpen?.(n.path);
                }}
                tabIndex={n.path ? 0 : -1}
                role={n.path ? 'button' : undefined}
                aria-label={n.path ? `Open ${n.label}` : n.label}
              >
                <rect width={NODE_W} height={NODE_H} rx={3} fill={isSel ? 'var(--primary-soft)' : 'var(--surface-2)'} stroke={ring} strokeWidth={st || ts ? 1.5 : 1} />
                <rect x={8} y={NODE_H / 2 - 5} width={10} height={10} fill={LAYER_COLOR[n.kind] ?? LAYER_COLOR.other} />
                <text x={26} y={NODE_H / 2 + 4} fontSize={11.5} fontFamily="var(--font-mono)" fill="var(--ink)">
                  {n.label.length > 25 ? `${n.label.slice(0, 24)}…` : n.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-ink-3">
        {(['source', 'staging', 'intermediate', 'marts'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5" style={{ background: LAYER_COLOR[k] }} />
            {k}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 border-[1.5px] border-ok" /> built
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 border-[1.5px] border-bad" /> failed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 border-[1.5px] border-warn" /> skipped / warn
        </span>
      </div>
    </div>
  );
}
