import { EXAM } from './exam';
import { EXAM_B } from './examB';
import type { Item } from './types';

export type ExamFormId = 'A' | 'B';

export const EXAM_FORMS: Record<ExamFormId, { id: ExamFormId; name: string; items: Item[] }> = {
  A: { id: 'A', name: 'Form A', items: EXAM },
  B: { id: 'B', name: 'Form B', items: EXAM_B },
};

/** Items of the form a session was taken on (sessions from before forms existed are Form A). */
export function examItems(session: { form?: ExamFormId }): Item[] {
  return EXAM_FORMS[session.form ?? 'A'].items;
}
