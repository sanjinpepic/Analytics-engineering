/**
 * Spaced repetition (Leitner boxes). Misses come back tomorrow; every correct review moves an
 * item up a box and stretches the gap: 1 → 3 → 7 → 16 → 35 → 90 days.
 * Keys are practice item ids, or `tpl:<template>` for generated drills (reviewed with a new seed).
 */
export const BOX_DAYS = [0, 1, 3, 7, 16, 35, 90] as const;
export const MAX_BOX = 6;
const DAY = 86_400_000;
/** A correct answer this soon after a miss is a retry, not recall: the item stays in box 1. */
const RETRY_WINDOW = 12 * 3_600_000;

export interface SrsEntry {
  box: number;
  due: number;
  last: number;
  lastOk: boolean;
  reviews: number;
}

export function schedule(prev: SrsEntry | undefined, ok: boolean, now = Date.now()): SrsEntry {
  const reviews = (prev?.reviews ?? 0) + 1;
  if (!ok) return { box: 1, due: now + BOX_DAYS[1] * DAY, last: now, lastOk: false, reviews };
  let box: number;
  if (!prev) box = 3; // right first time: check it again in a week
  else if (!prev.lastOk && now - prev.last < RETRY_WINDOW) box = 1;
  else box = Math.min(MAX_BOX, prev.box + 1);
  return { box, due: now + BOX_DAYS[box] * DAY, last: now, lastOk: true, reviews };
}

export function srsKey(itemId: string, template: string | null): string {
  return template ? `tpl:${template}` : itemId;
}

export function isDue(e: SrsEntry, now = Date.now()) {
  return e.due <= now;
}

export function dueLabel(due: number, now = Date.now()): string {
  const d = Math.round((due - now) / DAY);
  if (due <= now) return 'due now';
  if (d <= 0) return 'later today';
  if (d === 1) return 'tomorrow';
  return `in ${d} days`;
}
