import { ArrowLeft, ArrowRight, Clock, Flag, GraduationCap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { DOMAIN_BY_ID, DOMAINS } from '../content/domains';
import { EXAM, EXAM_TIME_LIMIT_MIN } from '../content/exam';
import { ItemView } from '../components/items/ItemView';
import { Pictogram } from '../components/Pictogram';
import { Page } from '../components/Shell';
import { Button, ButtonLink, PageHeader, cx } from '../components/ui';
import { isAutoGraded } from '../lib/scoring';
import { useProgress, type ExamAnswer } from '../store/progress';

export function ExamIntro() {
  const profile = useProgress((s) => s.profile);
  const setProfile = useProgress((s) => s.setProfile);
  const live = useProgress((s) => s.exam);
  const startExam = useProgress((s) => s.startExam);
  const navigate = useNavigate();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of EXAM) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, []);

  const start = () => {
    startExam({
      id: `exam-${Date.now()}`,
      variant: 'full',
      startedAt: Date.now(),
      candidate: { name: profile.name, background: profile.background, yearsExperience: profile.yearsExperience, jobAd: profile.jobAd, goals: profile.goals },
      answers: {},
      files: {},
      timeLimitMin: EXAM_TIME_LIMIT_MIN,
    });
    navigate('/exam/run');
  };

  const field = 'w-full rounded-[3px] border border-line-strong bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-ink-3';
  return (
    <Page>
      <PageHeader
        title="The licence exam"
        lead={`${EXAM.length} unseen tasks across the ten disciplines, in workday order. About ${EXAM_TIME_LIMIT_MIN} minutes. No feedback until you finish, like a real test. Then you export a report and Claude grades your written answers, reviews your SQL and dbt work, sets your level against the job ad, and writes you a focus plan.`}
      />
      {live && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 bg-warn-soft px-4 py-3">
          <p className="text-[14px] text-ink">
            You have an exam in progress ({Object.keys(live.answers).length}/{EXAM.length} answered).
          </p>
          <ButtonLink to="/exam/run" variant="primary">
            Resume exam
          </ButtonLink>
        </div>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="about-you">
          <h2 id="about-you" className="text-[17px] font-[680] text-ink">
            About you
          </h2>
          <p className="mt-1 text-[13.5px] text-ink-2">Included in the report so Claude can calibrate. Everything stays in this browser until you copy or download the report yourself.</p>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-1">
              <span className="text-[13px] font-medium text-ink">Name (optional)</span>
              <input className={field} value={profile.name} onChange={(e) => setProfile({ name: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-[13px] font-medium text-ink">Background</span>
              <textarea
                className={field}
                rows={3}
                value={profile.background}
                onChange={(e) => setProfile({ background: e.target.value })}
                placeholder="e.g. 3 years as a data/product analyst using dbt, SQL and Excel; last 2 years in product and commercial strategy"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[13px] font-medium text-ink">Years of hands-on SQL/dbt work</span>
                <input className={field} value={profile.yearsExperience} onChange={(e) => setProfile({ yearsExperience: e.target.value })} placeholder="e.g. 3" />
              </label>
              <label className="grid gap-1">
                <span className="text-[13px] font-medium text-ink">Goal</span>
                <input className={field} value={profile.goals} onChange={(e) => setProfile({ goals: e.target.value })} placeholder="e.g. land a mid/senior AE role in 3 months" />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-[13px] font-medium text-ink">Target job ad</span>
              <span className="text-[12.5px] text-ink-3">Pre-filled with the ad you shared. Paste another one to be assessed against it instead.</span>
              <textarea className={cx(field, 'font-mono text-[12.5px]')} rows={10} value={profile.jobAd} onChange={(e) => setProfile({ jobAd: e.target.value })} />
            </label>
          </div>
        </section>

        <aside className="self-start border border-line bg-surface" aria-labelledby="rules">
          <h2 id="rules" className="border-b border-line px-5 py-3 text-[17px] font-[680] text-ink">
            How it works
          </h2>
          <ul className="space-y-2.5 px-5 py-4 text-[13.5px] leading-relaxed text-ink-2">
            <li>
              <strong className="text-ink">{counts.mcq ?? 0} multiple choice, {(counts.sql ?? 0) + (counts.numeric ?? 0)} SQL, {counts.dbt ?? 0} dbt, {counts.order ?? 0} ordering, {counts.open ?? 0} written.</strong> SQL and dbt run for real; you can execute as often as you like before saving.
            </li>
            <li>Rate your confidence on each task. Claude uses it to spot misconceptions (confident and wrong) as well as gaps.</li>
            <li>The timer is a guide; overtime is reported, not punished.</li>
            <li>Your progress saves automatically. You can close the tab and resume.</li>
            <li>No hints, no solutions. Practise first in the workday, theory and SQL gym.</li>
          </ul>
          <div className="border-t border-line px-5 py-4">
            {live ? (
              <ButtonLink to="/exam/run" variant="primary" className="w-full">
                Resume exam
              </ButtonLink>
            ) : (
              <Button variant="primary" className="w-full" onClick={start}>
                <GraduationCap size={15} aria-hidden /> Start the exam
              </Button>
            )}
          </div>
        </aside>
      </div>
    </Page>
  );
}

function fmt(sec: number) {
  const s = Math.abs(Math.round(sec));
  return `${sec < 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ExamRun() {
  const exam = useProgress((s) => s.exam);
  const answerExam = useProgress((s) => s.answerExam);
  const setExamFiles = useProgress((s) => s.setExamFiles);
  const finishExam = useProgress((s) => s.finishExam);
  const navigate = useNavigate();
  const [idx, setIdx] = useState(() => {
    if (!exam) return 0;
    const first = EXAM.findIndex((i) => !exam.answers[i.id]);
    return first < 0 ? 0 : first;
  });
  const [now, setNow] = useState(Date.now());
  const [confirming, setConfirming] = useState(false);
  const enteredAt = useRef(Date.now());
  const pendingConfidence = useRef<Record<string, number | null>>({});
  const finished = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    enteredAt.current = Date.now();
    window.scrollTo({ top: 0 });
  }, [idx]);

  if (!exam) return finished.current ? null : <Navigate to="/exam" replace />;
  const item = EXAM[idx];
  const ans = exam.answers[item.id];
  const remaining = exam.timeLimitMin * 60 - (now - exam.startedAt) / 1000;
  const confidence = ans?.confidence ?? pendingConfidence.current[item.id] ?? null;

  const save = (patch: Partial<ExamAnswer>) => {
    const spent = (Date.now() - enteredAt.current) / 1000;
    enteredAt.current = Date.now();
    const prev = exam.answers[item.id];
    answerExam({
      itemId: item.id,
      answer: prev?.answer,
      score: prev?.score ?? 0,
      status: prev?.status ?? 'incorrect',
      confidence,
      seconds: (prev?.seconds ?? 0) + spent,
      flagged: prev?.flagged,
      ...patch,
    });
  };

  const setConfidence = (c: number) => {
    pendingConfidence.current[item.id] = c;
    if (ans) answerExam({ ...ans, confidence: c });
    else setNow(Date.now());
  };

  const go = (n: number) => setIdx(Math.max(0, Math.min(EXAM.length - 1, n)));
  const answered = EXAM.filter((i) => exam.answers[i.id]?.answer !== undefined).length;

  return (
    <div>
      {/* exam bar */}
      <div className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-[2px] max-lg:top-14">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-8">
          <span className="text-[14px] font-[680] text-ink">Licence exam</span>
          <span className={cx('inline-flex items-center gap-1.5 text-[14px] font-semibold tnum', remaining < 0 ? 'text-bad' : remaining < 600 ? 'text-warn' : 'text-ink-2')} aria-live="off">
            <Clock size={14} aria-hidden /> {remaining >= 0 ? `${fmt(remaining)} left` : `${fmt(remaining)} over`}
          </span>
          <span className="text-[13px] text-ink-3 tnum">
            {answered}/{EXAM.length} answered
          </span>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setConfirming(true)}>
            Finish exam
          </Button>
        </div>
        {/* section bar: the programme strip, as exam sections */}
        <ol className="mx-auto flex max-w-[1500px] gap-[3px] px-4 pb-2.5 sm:px-8" aria-label="Exam sections">
          {DOMAINS.map((d) => {
            const its = EXAM.map((it, i) => ({ it, i })).filter(({ it }) => it.domain === d.id);
            if (!its.length) return null;
            return (
              <li key={d.id} className="min-w-0 flex-1" title={d.name}>
                <span className="block h-1.5" style={{ background: d.color }} aria-hidden />
                <span className="mt-1 flex gap-[3px]">
                  {its.map(({ it, i }) => {
                    const a = exam.answers[it.id];
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => go(i)}
                        aria-label={`Task ${i + 1}: ${it.title}${a ? ', answered' : ''}${a?.flagged ? ', flagged' : ''}`}
                        aria-current={i === idx ? 'step' : undefined}
                        className={cx(
                          'relative h-5 min-w-0 flex-1 text-[10px] font-semibold tnum',
                          a?.answer !== undefined ? 'bg-[var(--ink-2)] text-[var(--surface)]' : 'bg-surface-3 text-ink-3',
                          i === idx && 'ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--surface)]',
                        )}
                      >
                        {i + 1}
                        {a?.flagged && <span className="absolute top-0 right-0 size-1.5 bg-[var(--warn)]" />}
                      </button>
                    );
                  })}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <Page wide>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <span className="inline-flex size-5 items-center justify-center" style={{ background: DOMAIN_BY_ID[item.domain].color, color: DOMAIN_BY_ID[item.domain].onColor }} aria-hidden>
              <Pictogram domain={item.domain} size={12} />
            </span>
            Section: {DOMAIN_BY_ID[item.domain].name} · task {idx + 1} of {EXAM.length}
          </p>
          <Button size="sm" variant={ans?.flagged ? 'secondary' : 'ghost'} onClick={() => save({ flagged: !ans?.flagged, answer: ans?.answer })}>
            <Flag size={13} aria-hidden /> {ans?.flagged ? 'Flagged for review' : 'Flag for review'}
          </Button>
        </div>

        <ItemView
          key={item.id}
          item={item}
          mode="exam"
          index={idx + 1}
          exam={{
            answer: ans?.answer,
            files: exam.files[item.id],
            onFiles: (f) => setExamFiles(item.id, f),
            onAnswer: ({ answer, grade }) =>
              save({
                answer,
                score: isAutoGraded(item) ? grade.score : 0,
                status: item.kind === 'open' ? 'submitted' : grade.correct ? 'correct' : grade.score > 0 ? 'partial' : 'incorrect',
                feedback: grade.feedback + (grade.checks ? ` [${grade.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}: ${c.label}`).join('; ')}]` : ''),
              }),
          }}
        />

        <fieldset className="mt-4 flex flex-wrap items-center gap-3 border border-line bg-surface px-5 py-3">
          <legend className="sr-only">Confidence</legend>
          <span className="text-[13.5px] font-medium text-ink">How sure are you?</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Confidence from 1 (guessing) to 5 (certain)">
            {[1, 2, 3, 4, 5].map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={confidence === c}
                onClick={() => setConfidence(c)}
                className={cx('h-8 w-9 border text-[13px] font-semibold tnum', confidence === c ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2')}
              >
                {c}
              </button>
            ))}
          </div>
          <span className="text-[12.5px] text-ink-3">1 = guessing · 5 = certain</span>
        </fieldset>

        <nav aria-label="Task navigation" className="mt-6 flex justify-between gap-3">
          <Button onClick={() => go(idx - 1)} disabled={idx === 0}>
            <ArrowLeft size={14} aria-hidden /> Previous
          </Button>
          {idx < EXAM.length - 1 ? (
            <Button variant="primary" onClick={() => go(idx + 1)}>
              Next task <ArrowRight size={14} aria-hidden />
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setConfirming(true)}>
              Finish exam
            </Button>
          )}
        </nav>
      </Page>

      {confirming && (
        <dialog
          open
          aria-labelledby="finish-title"
          className="fixed inset-0 z-50 m-auto w-[min(92vw,460px)] border border-line-strong bg-surface p-0 text-ink shadow-[0_18px_50px_-12px_rgba(0,0,0,0.35)]"
          onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}
        >
          <div className="px-6 pt-5 pb-4">
            <h2 id="finish-title" className="text-[18px] font-[680]">
              Finish the exam?
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
              {answered < EXAM.length ? `${EXAM.length - answered} task${EXAM.length - answered === 1 ? ' is' : 's are'} unanswered and will score zero.` : 'Every task has an answer.'}{' '}
              {EXAM.filter((i) => exam.answers[i.id]?.flagged).length > 0 && `${EXAM.filter((i) => exam.answers[i.id]?.flagged).length} flagged for review. `}
              You can’t change answers afterwards.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-6 py-3">
            <Button autoFocus onClick={() => setConfirming(false)}>
              Keep going
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                finished.current = true;
                finishExam();
                navigate('/exam/result', { replace: true });
              }}
            >
              Finish and see results
            </Button>
          </div>
        </dialog>
      )}
      {confirming && <div className="fixed inset-0 z-40 bg-black/40" aria-hidden onClick={() => setConfirming(false)} />}
    </div>
  );
}
