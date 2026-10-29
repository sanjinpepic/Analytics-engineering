import type { Item } from './types';
import { WORKDAY_ITEMS } from './workday';
import { GYM } from './gym';
import { EXAM } from './exam';
import { EXAM_B } from './examB';
import { THEORY } from './theory';

export const THEORY_ITEMS: Item[] = THEORY.flatMap((m) => m.practice);
/** Everything a learner can practise (the exam pool is kept separate). */
export const PRACTICE_ITEMS: Item[] = [...THEORY_ITEMS, ...WORKDAY_ITEMS, ...GYM];
export const ALL_ITEMS: Item[] = [...PRACTICE_ITEMS, ...EXAM, ...EXAM_B];
export const ITEM_BY_ID: Record<string, Item> = Object.fromEntries(ALL_ITEMS.map((i) => [i.id, i]));
