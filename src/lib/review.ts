import { useMemo } from 'react';
import { PRACTICE_ITEMS } from '../content/catalog';
import { DRILL_BY_ID } from '../content/drills';
import type { Item } from '../content/types';
import { useProgress, type Attempt } from '../store/progress';
import type { SrsEntry } from './srs';

export const PRACTICE_BY_ID: Record<string, Item> = Object.fromEntries(PRACTICE_ITEMS.map((i) => [i.id, i]));
const DAY = 86_400_000;

export interface ReviewEntry {
  key: string;
  entry: SrsEntry;
  /** practice item id, or null for a drill skill */
  itemId: string | null;
  template: string | null;
  title: string;
}

/** Scheduled entries, plus items answered before scheduling existed (missed → due now, solved → a week after). */
export function reviewEntries(progress: Record<string, Attempt>, srs: Record<string, SrsEntry>): ReviewEntry[] {
  const out: ReviewEntry[] = [];
  const seen = new Set<string>();
  for (const [key, entry] of Object.entries(srs)) {
    seen.add(key);
    if (key.startsWith('tpl:')) {
      const t = DRILL_BY_ID[key.slice(4)];
      if (t) out.push({ key, entry, itemId: null, template: t.id, title: `Drill: ${t.skill}` });
    } else if (PRACTICE_BY_ID[key]) out.push({ key, entry, itemId: key, template: null, title: PRACTICE_BY_ID[key].title });
  }
  for (const [id, a] of Object.entries(progress)) {
    if (seen.has(id) || !PRACTICE_BY_ID[id] || PRACTICE_BY_ID[id].kind === 'open') continue;
    const ok = a.status === 'correct' && !a.revealed;
    out.push({ key: id, itemId: id, template: null, title: PRACTICE_BY_ID[id].title, entry: { box: ok ? 3 : 1, due: ok ? a.at + 7 * DAY : a.at, last: a.at, lastOk: ok, reviews: 0 } });
  }
  return out.sort((x, y) => x.entry.due - y.entry.due);
}

export function useDueCount(): number {
  const progress = useProgress((s) => s.progress);
  const srs = useProgress((s) => s.srs);
  return useMemo(() => {
    const now = Date.now();
    return reviewEntries(progress, srs).filter((e) => e.entry.due <= now).length;
  }, [progress, srs]);
}

