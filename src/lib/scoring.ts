import { DOMAINS } from '../content/domains';
import type { DomainId, Item } from '../content/types';
import type { Attempt, ExamSession } from '../store/progress';

export interface Level {
  code: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  plate: string;
  role: string;
  description: string;
}

export const LEVELS: Level[] = [
  { code: 'L1', plate: 'Learner permit', role: 'Re-learning the foundations', description: 'Core SQL and dbt concepts are not yet reliable. Rebuild the foundations before applying.' },
  { code: 'L2', plate: 'Provisional', role: 'Junior analytics engineer', description: 'Solid on fundamentals and guided tasks; needs support on design decisions, performance and governance.' },
  { code: 'L3', plate: 'Full licence', role: 'Analytics engineer (mid-level)', description: 'Delivers tested, modular models end to end and handles stakeholders independently.' },
  { code: 'L4', plate: 'Advanced', role: 'Senior analytics engineer', description: 'Makes sound trade-offs on modelling, cost and quality; reviews others and sets conventions.' },
  { code: 'L5', plate: 'Instructor', role: 'Staff / lead analytics engineer', description: 'Designs the platform-level standards (contracts, semantic layer, governance) others work within.' },
];

export function isAutoGraded(item: Item): boolean {
  return item.kind !== 'open';
}

export interface DomainScore {
  domain: DomainId;
  earned: number;
  possible: number;
  pct: number | null;
  answered: number;
  total: number;
}

/** Practice mastery: weighted by difficulty, unattempted items count as 0. */
export function practiceMastery(items: Item[], progress: Record<string, Attempt>): DomainScore[] {
  return DOMAINS.map((d) => {
    const own = items.filter((i) => i.domain === d.id && isAutoGraded(i));
    let earned = 0;
    let possible = 0;
    let answered = 0;
    for (const i of own) {
      possible += i.difficulty;
      const a = progress[i.id];
      if (a) {
        answered++;
        earned += i.difficulty * (a.revealed && a.status !== 'correct' ? 0 : a.score);
      }
    }
    return { domain: d.id, earned, possible, pct: possible ? earned / possible : null, answered, total: own.length };
  });
}

export interface ExamResult {
  overall: number;
  byDomain: DomainScore[];
  hardPct: number | null;
  level: Level;
  levelReason: string;
  answered: number;
  autoTotal: number;
  openPending: number;
  minutes: number;
  calibration: { confidentWrong: number; unsureRight: number; avgConfCorrect: number | null; avgConfWrong: number | null };
}

export function scoreExam(exam: ExamSession, items: Item[]): ExamResult {
  const auto = items.filter(isAutoGraded);
  const byDomain = DOMAINS.map((d) => {
    const own = auto.filter((i) => i.domain === d.id);
    let earned = 0;
    let possible = 0;
    let answered = 0;
    for (const i of own) {
      possible += i.difficulty;
      const a = exam.answers[i.id];
      if (a) {
        answered++;
        earned += i.difficulty * a.score;
      }
    }
    return { domain: d.id, earned, possible, pct: possible ? earned / possible : null, answered, total: own.length };
  });
  const earned = byDomain.reduce((s, d) => s + d.earned, 0);
  const possible = byDomain.reduce((s, d) => s + d.possible, 0);
  const overall = possible ? earned / possible : 0;

  const hard = auto.filter((i) => i.difficulty === 3);
  const hardPossible = hard.length;
  const hardEarned = hard.reduce((s, i) => s + (exam.answers[i.id]?.score ?? 0), 0);
  const hardPct = hardPossible ? hardEarned / hardPossible : null;

  let idx = overall >= 0.9 ? 4 : overall >= 0.75 ? 3 : overall >= 0.6 ? 2 : overall >= 0.4 ? 1 : 0;
  let levelReason = `Auto-graded score ${Math.round(overall * 100)}%.`;
  if (idx === 4 && (hardPct ?? 0) < 0.75) {
    idx = 3;
    levelReason += ' Capped at L4: Instructor needs ≥75% on senior-difficulty tasks.';
  }
  if (idx === 3 && (hardPct ?? 0) < 0.5) {
    idx = 2;
    levelReason += ' Capped at L3: Advanced needs ≥50% on senior-difficulty tasks.';
  }

  const confs = Object.values(exam.answers).filter((a) => a.confidence !== null && a.status !== 'submitted');
  const correct = confs.filter((a) => a.status === 'correct');
  const wrong = confs.filter((a) => a.status === 'incorrect' || a.status === 'partial');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  const end = exam.finishedAt ?? Date.now();
  return {
    overall,
    byDomain,
    hardPct,
    level: LEVELS[idx],
    levelReason,
    answered: auto.filter((i) => exam.answers[i.id]).length,
    autoTotal: auto.length,
    openPending: items.filter((i) => !isAutoGraded(i)).length,
    minutes: Math.round((end - exam.startedAt) / 60000),
    calibration: {
      confidentWrong: wrong.filter((a) => (a.confidence ?? 0) >= 4).length,
      unsureRight: correct.filter((a) => (a.confidence ?? 5) <= 2).length,
      avgConfCorrect: avg(correct.map((a) => a.confidence!)),
      avgConfWrong: avg(wrong.map((a) => a.confidence!)),
    },
  };
}

/** Level estimate from practice mastery (for the home screen before an exam is taken). */
export function practiceLevel(scores: DomainScore[]): { level: Level; pct: number } {
  const earned = scores.reduce((s, d) => s + d.earned, 0);
  const possible = scores.reduce((s, d) => s + d.possible, 0);
  const pct = possible ? earned / possible : 0;
  const idx = pct >= 0.9 ? 4 : pct >= 0.75 ? 3 : pct >= 0.6 ? 2 : pct >= 0.4 ? 1 : 0;
  return { level: LEVELS[idx], pct };
}
