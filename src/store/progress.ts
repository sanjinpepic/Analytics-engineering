import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { ProjectFiles } from '../lib/dbt/types';
import { REFERENCE_JOB_AD } from '../content/jobAd';
import { templateOf } from '../content/drills';
import { schedule, srsKey, type SrsEntry } from '../lib/srs';

export type AttemptStatus = 'correct' | 'partial' | 'incorrect' | 'submitted';

export interface Attempt {
  status: AttemptStatus;
  score: number;
  attempts: number;
  at: number;
  /** Learner's last answer (option indexes, SQL text, order, number, free text). */
  answer?: unknown;
  hintsUsed?: number;
  revealed?: boolean;
}

export interface ExamAnswer {
  itemId: string;
  answer: unknown;
  score: number;
  status: AttemptStatus;
  confidence: number | null;
  seconds: number;
  feedback?: string;
  flagged?: boolean;
}

export interface ExamSession {
  id: string;
  variant: 'full';
  startedAt: number;
  finishedAt?: number;
  candidate: { name: string; background: string; yearsExperience: string; jobAd: string; goals: string };
  answers: Record<string, ExamAnswer>;
  /** dbt item files edited during the exam */
  files: Record<string, ProjectFiles>;
  timeLimitMin: number;
}

export interface DrillStat {
  attempts: number;
  solved: number;
  streak: number;
  last: number;
}

/** Generated drills are endless; keep only the most recent ones in `progress`. */
const MAX_GENERATED_IN_PROGRESS = 150;

interface State {
  progress: Record<string, Attempt>;
  drillStats: Record<string, DrillStat>;
  srs: Record<string, SrsEntry>;
  modulesRead: Record<string, number>;
  itemFiles: Record<string, ProjectFiles>;
  workspaceFiles: ProjectFiles | null;
  gymDraft: string;
  exam: ExamSession | null;
  examHistory: ExamSession[];
  profile: { name: string; background: string; yearsExperience: string; goals: string; jobAd: string };
  theme: 'system' | 'light' | 'dark';

  record: (itemId: string, a: Omit<Attempt, 'attempts' | 'at'> & { attempts?: number }) => void;
  markRead: (moduleId: string) => void;
  setItemFiles: (itemId: string, files: ProjectFiles | null) => void;
  setWorkspaceFiles: (files: ProjectFiles | null) => void;
  setGymDraft: (sql: string) => void;
  setProfile: (p: Partial<State['profile']>) => void;
  setTheme: (t: State['theme']) => void;
  startExam: (s: ExamSession) => void;
  answerExam: (a: ExamAnswer) => void;
  setExamFiles: (itemId: string, files: ProjectFiles) => void;
  finishExam: () => void;
  abandonExam: () => void;
  resetProgress: () => void;
}

/** localStorage can throw (private mode, blocked storage); fall back to memory. */
const memory = new Map<string, string>();
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      memory.set(k, v);
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      memory.delete(k);
    }
  },
};

export const useProgress = create<State>()(
  persist(
    (set) => ({
      progress: {},
      drillStats: {},
      srs: {},
      modulesRead: {},
      itemFiles: {},
      workspaceFiles: null,
      gymDraft: '',
      exam: null,
      examHistory: [],
      profile: { name: '', background: '', yearsExperience: '', goals: '', jobAd: REFERENCE_JOB_AD },
      theme: 'system',

      record: (itemId, a) =>
        set((s) => {
          const prev = s.progress[itemId];
          // never downgrade a solved item when re-attempting
          const keepBest = prev && prev.score > a.score && prev.status === 'correct';
          let progress: Record<string, Attempt> = {
            ...s.progress,
            [itemId]: {
              ...(keepBest ? prev : a),
              answer: a.answer,
              attempts: (prev?.attempts ?? 0) + (a.attempts ?? 1),
              at: Date.now(),
              hintsUsed: Math.max(prev?.hintsUsed ?? 0, a.hintsUsed ?? 0),
              revealed: prev?.revealed || a.revealed,
            },
          };
          let drillStats = s.drillStats;
          const tpl = templateOf(itemId);
          if (tpl) {
            const st = s.drillStats[tpl] ?? { attempts: 0, solved: 0, streak: 0, last: 0 };
            const graded = a.attempts !== 0;
            const firstSolve = a.status === 'correct' && prev?.status !== 'correct' && !prev?.revealed && !a.revealed;
            const missed = a.revealed || (graded && a.status !== 'correct');
            drillStats = {
              ...s.drillStats,
              [tpl]: {
                attempts: st.attempts + (graded ? 1 : 0),
                solved: st.solved + (firstSolve ? 1 : 0),
                streak: firstSolve ? st.streak + 1 : missed ? 0 : st.streak,
                last: Date.now(),
              },
            };
            const gen = Object.entries(progress).filter(([k]) => k.startsWith('gen.'));
            if (gen.length > MAX_GENERATED_IN_PROGRESS) {
              gen.sort((x, y) => x[1].at - y[1].at);
              progress = { ...progress };
              for (const [k] of gen.slice(0, gen.length - MAX_GENERATED_IN_PROGRESS)) delete progress[k];
            }
          }
          // spaced repetition: written answers are graded by Claude, not scheduled
          let srs = s.srs;
          const graded = a.attempts !== 0 || a.revealed;
          if (a.status !== 'submitted' && graded) {
            const key = srsKey(itemId, tpl);
            const ok = a.status === 'correct' && !a.revealed;
            srs = { ...s.srs, [key]: schedule(s.srs[key], ok) };
          }
          return { progress, drillStats, srs };
        }),
      markRead: (id) => set((s) => ({ modulesRead: { ...s.modulesRead, [id]: Date.now() } })),
      setItemFiles: (id, files) =>
        set((s) => {
          const next = { ...s.itemFiles };
          if (files) next[id] = files;
          else delete next[id];
          return { itemFiles: next };
        }),
      setWorkspaceFiles: (files) => set({ workspaceFiles: files }),
      setGymDraft: (sql) => set({ gymDraft: sql }),
      setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
      setTheme: (t) => set({ theme: t }),
      startExam: (exam) => set({ exam }),
      answerExam: (a) => set((s) => (s.exam ? { exam: { ...s.exam, answers: { ...s.exam.answers, [a.itemId]: a } } } : {})),
      setExamFiles: (id, files) => set((s) => (s.exam ? { exam: { ...s.exam, files: { ...s.exam.files, [id]: files } } } : {})),
      finishExam: () =>
        set((s) => {
          if (!s.exam) return {};
          const done = { ...s.exam, finishedAt: Date.now() };
          return { exam: null, examHistory: [done, ...s.examHistory].slice(0, 10) };
        }),
      abandonExam: () => set({ exam: null }),
      resetProgress: () => set({ progress: {}, drillStats: {}, srs: {}, modulesRead: {}, itemFiles: {}, workspaceFiles: null, gymDraft: '' }),
    }),
    {
      name: 'ae-licence-v1',
      storage: createJSONStorage(() => safeStorage),
      version: 1,
    },
  ),
);
