import { Check, Clipboard, Download, FileJson, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DOMAIN_BY_ID, DOMAINS } from '../content/domains';
import { EXAM } from '../content/exam';
import { PRACTICE_ITEMS } from '../content/catalog';
import { Pictogram } from '../components/Pictogram';
import { Page } from '../components/Shell';
import { Button, ButtonLink, Meter, PageHeader } from '../components/ui';
import { CodeBlock } from '../components/CodeBlock';
import { buildExamReport, buildPracticeReport } from '../lib/report';
import { LEVELS } from '../lib/scoring';
import { useProgress, type ExamSession } from '../store/progress';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CopyButton({ text, label = 'Copy report for Claude', primary }: { text: string; label?: string; primary?: boolean }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      onClick={() =>
        navigator.clipboard
          ?.writeText(text)
          .then(() => setState('ok'))
          .catch(() => setState('fail'))
          .finally(() => setTimeout(() => setState('idle'), 2200))
      }
    >
      {state === 'ok' ? <Check size={14} aria-hidden /> : <Clipboard size={14} aria-hidden />}
      {state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy failed: use Download' : label}
    </Button>
  );
}

function ExamReportView({ exam }: { exam: ExamSession }) {
  const progress = useProgress((s) => s.progress);
  const { markdown, json, result } = useMemo(() => buildExamReport({ exam, items: EXAM, practice: { items: PRACTICE_ITEMS, progress } }), [exam, progress]);
  const levelIdx = LEVELS.findIndex((l) => l.code === result.level.code);
  const stamp = new Date(exam.finishedAt ?? exam.startedAt).toISOString().slice(0, 10);
  return (
    <>
      <section className="mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]" aria-label="Result">
        <div className="ticked-frame self-start">
          <div className="bg-[var(--poster)] px-6 py-6 text-center text-[var(--poster-ink)]">
            <p className="font-display text-[18px] uppercase">Provisional licence</p>
            <p className="font-display mt-2 text-[76px] leading-none">{result.level.code}</p>
            <p className="font-display mt-2 text-[26px] leading-tight uppercase">{result.level.plate}</p>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-[15px] font-[650] text-ink">{result.level.role}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{result.level.description}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
              <div>
                <dt className="text-[11.5px] text-ink-3">Auto score</dt>
                <dd className="text-[20px] font-[700] text-ink tnum">{Math.round(result.overall * 100)}%</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-ink-3">Senior tasks</dt>
                <dd className="text-[20px] font-[700] text-ink tnum">{result.hardPct === null ? '—' : `${Math.round(result.hardPct * 100)}%`}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-ink-3">Minutes</dt>
                <dd className="text-[20px] font-[700] text-ink tnum">{result.minutes}</dd>
              </div>
            </dl>
            <ol className="mt-3 flex gap-1" aria-label="Level ladder">
              {LEVELS.map((l, i) => (
                <li key={l.code} className={`flex-1 py-1 text-center text-[11px] font-bold ${i === levelIdx ? 'bg-[var(--ink)] text-[var(--surface)]' : i < levelIdx ? 'bg-surface-3 text-ink-2' : 'border border-line text-ink-3'}`}>
                  {l.code}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[12px] leading-snug text-ink-3">{result.levelReason} Claude finalises it after grading your {result.openPending} written answers.</p>
          </div>
        </div>

        <div className="min-w-0">
          <h2 className="text-[17px] font-[680] text-ink">Results by discipline</h2>
          <table className="mt-2 w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b-2 border-line-strong text-left text-[12px] text-ink-3">
                <th className="py-1.5 font-medium">Discipline</th>
                <th className="w-[40%] py-1.5 font-medium">Exam (auto-graded)</th>
                <th className="w-14 py-1.5 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {DOMAINS.map((d) => {
                const r = result.byDomain.find((x) => x.domain === d.id)!;
                return (
                  <tr key={d.id} className="border-b border-line">
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="inline-flex size-6 shrink-0 items-center justify-center" style={{ background: d.color, color: d.onColor }} aria-hidden>
                          <Pictogram domain={d.id} size={14} />
                        </span>
                        <span className="text-ink">{d.name}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3">{r.pct === null ? <span className="text-[12.5px] text-ink-3">Written answers only, graded by Claude</span> : <Meter value={r.pct} color={d.color} label={`${d.name} score`} />}</td>
                    <td className="py-2 text-right font-semibold text-ink tnum">{r.pct === null ? '—' : `${Math.round(r.pct * 100)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            <strong className="text-ink">Calibration:</strong> you were confident (4–5) and wrong on {result.calibration.confidentWrong} task{result.calibration.confidentWrong === 1 ? '' : 's'}, and unsure (1–2) but right on {result.calibration.unsureRight}.
            {result.calibration.confidentWrong > 1 && ' Confident misses usually point at a misconception worth unlearning, not just a gap.'}
          </p>
        </div>
      </section>

      <section className="mt-10 border border-line bg-surface" aria-labelledby="send">
        <div className="border-b border-line px-5 py-4">
          <h2 id="send" className="text-[19px] font-[680] text-ink">
            Send it to Claude
          </h2>
          <p className="mt-1 max-w-[75ch] text-[14px] leading-relaxed text-ink-2">
            The report has every task, your answers, SQL and dbt files, confidence ratings, rubrics for the written answers, the target job ad, and instructions. Paste it into a conversation with Claude, or attach the .md file. You get graded written answers, a calibrated level, a job-fit assessment, and a 4-week focus plan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <CopyButton text={markdown} primary />
          <Button onClick={() => download(`ae-licence-exam-${stamp}.md`, markdown, 'text/markdown')}>
            <Download size={14} aria-hidden /> Download .md
          </Button>
          <Button onClick={() => download(`ae-licence-exam-${stamp}.json`, JSON.stringify(json, null, 2), 'application/json')}>
            <FileJson size={14} aria-hidden /> Download .json
          </Button>
        </div>
        <details className="border-t border-line px-5 py-3">
          <summary className="cursor-pointer text-[13.5px] font-medium text-ink-2">Preview the report ({Math.round(markdown.length / 1000)}k characters)</summary>
          <div className="mt-3 max-h-[520px] overflow-auto">
            <CodeBlock code={markdown} info="markdown" />
          </div>
        </details>
      </section>

      <section className="mt-8" aria-labelledby="review">
        <h2 id="review" className="text-[17px] font-[680] text-ink">
          Task review
        </h2>
        <ol className="mt-2 divide-y divide-line border-y border-line">
          {EXAM.map((item, i) => {
            const a = exam.answers[item.id];
            const tone = !a ? 'text-ink-3' : item.kind === 'open' ? 'text-primary' : a.status === 'correct' ? 'text-ok' : a.status === 'partial' ? 'text-warn' : 'text-bad';
            const label = !a ? 'Skipped' : item.kind === 'open' ? 'For Claude' : a.status === 'correct' ? 'Correct' : a.status === 'partial' ? `Partial ${Math.round(a.score * 100)}%` : 'Incorrect';
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <span className="w-6 text-right text-[13px] text-ink-3 tnum">{i + 1}</span>
                <span className="inline-flex size-5 items-center justify-center" style={{ background: DOMAIN_BY_ID[item.domain].color, color: DOMAIN_BY_ID[item.domain].onColor }} aria-hidden>
                  <Pictogram domain={item.domain} size={12} />
                </span>
                <span className="min-w-0 flex-1 text-[14px] text-ink">{item.title}</span>
                {a?.confidence && <span className="text-[12px] text-ink-3 tnum">confidence {a.confidence}/5</span>}
                <span className={`w-24 text-right text-[13px] font-semibold ${tone}`}>{label}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-[13px] text-ink-2">
          Explanations for the exam tasks are in the report. Practise the weak disciplines in <Link to="/theory">Theory</Link>, the <Link to="/gym">SQL gym</Link> and the <Link to="/">workday</Link>.
        </p>
      </section>
    </>
  );
}

export function ExamResultPage() {
  const history = useProgress((s) => s.examHistory);
  const exam = history[0];
  return (
    <Page wide>
      <PageHeader title="Exam results" lead={exam ? `Finished ${new Date(exam.finishedAt ?? exam.startedAt).toLocaleString()}.` : undefined} actions={<ButtonLink to="/exam">Retake later</ButtonLink>} />
      {exam ? <ExamReportView exam={exam} /> : <p className="mt-6 text-ink-2">No finished exam yet. <Link to="/exam">Sit the licence exam</Link>.</p>}
    </Page>
  );
}

export function ReportPage() {
  const history = useProgress((s) => s.examHistory);
  const progress = useProgress((s) => s.progress);
  const profile = useProgress((s) => s.profile);
  const reset = useProgress((s) => s.resetProgress);
  const [pick, setPick] = useState(0);
  const practice = useMemo(() => buildPracticeReport(PRACTICE_ITEMS, progress, profile), [progress, profile]);
  const exam = history[pick];
  return (
    <Page wide>
      <PageHeader title="Report" lead="Everything you send to Claude. Nothing leaves this browser unless you copy or download it." />
      <section className="mt-6" aria-labelledby="exam-reports">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="exam-reports" className="text-[17px] font-[680] text-ink">
            Exam reports
          </h2>
          {history.length > 1 && (
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Attempt
              <select value={pick} onChange={(e) => setPick(Number(e.target.value))} className="h-8 rounded-[3px] border border-line-strong bg-surface px-2 text-[13px] text-ink">
                {history.map((h, i) => (
                  <option key={h.id} value={i}>
                    {new Date(h.finishedAt ?? h.startedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {exam ? (
          <ExamReportView exam={exam} />
        ) : (
          <div className="mt-3 border border-line bg-surface p-5">
            <p className="text-[14px] text-ink-2">You haven’t finished an exam yet. The exam report is the one to send for a level assessment.</p>
            <ButtonLink to="/exam" variant="primary" className="mt-3">
              Go to the licence exam
            </ButtonLink>
          </div>
        )}
      </section>

      <section className="mt-12 border border-line bg-surface" aria-labelledby="practice-report">
        <div className="border-b border-line px-5 py-4">
          <h2 id="practice-report" className="text-[17px] font-[680] text-ink">
            Practice report
          </h2>
          <p className="mt-1 max-w-[75ch] text-[14px] text-ink-2">A lighter report of your practice so far ({Object.keys(progress).length} items tried), including written answers for Claude to grade. Useful between exams.</p>
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <CopyButton text={practice} label="Copy practice report" />
          <Button onClick={() => download('ae-licence-practice.md', practice, 'text/markdown')}>
            <Download size={14} aria-hidden /> Download .md
          </Button>
        </div>
      </section>

      <section className="mt-12 border-t border-line pt-5" aria-labelledby="data">
        <h2 id="data" className="text-[15px] font-[650] text-ink">
          Your data
        </h2>
        <p className="mt-1 text-[13.5px] text-ink-2">Progress lives in this browser’s storage. Clearing it resets practice progress and workspace files; exam history is kept.</p>
        <Button
          variant="danger"
          className="mt-3"
          onClick={() => {
            if (confirm('Reset all practice progress and workspace files? Exam history is kept. This cannot be undone.')) reset();
          }}
        >
          <RotateCcw size={14} aria-hidden /> Reset practice progress
        </Button>
      </section>
    </Page>
  );
}
