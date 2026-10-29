import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { python } from '@codemirror/lang-python';
import { Check, Copy, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProgress } from '../store/progress';

const highlighter = tagHighlighter([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], class: 'syn-k' },
  { tag: [t.string, t.special(t.string)], class: 'syn-s' },
  { tag: [t.number, t.bool, t.null], class: 'syn-n' },
  { tag: [t.comment, t.lineComment, t.blockComment], class: 'syn-c' },
  { tag: [t.function(t.variableName), t.standard(t.name)], class: 'syn-f' },
  { tag: [t.typeName, t.className, t.atom], class: 'syn-t' },
  { tag: [t.propertyName, t.definition(t.propertyName)], class: 'syn-p' },
]);

const parsers = {
  sql: sql({ dialect: PostgreSQL }).language.parser,
  yaml: yaml().language.parser,
  python: python().language.parser,
};

function langOf(info: string): keyof typeof parsers | null {
  const l = info.split(/\s+/)[0]?.toLowerCase();
  if (l === 'sql' || l === 'jinja' || l === 'sqlmesh') return 'sql';
  if (l === 'yaml' || l === 'yml') return 'yaml';
  if (l === 'python' || l === 'py') return 'python';
  return null;
}

function Highlighted({ code, lang }: { code: string; lang: keyof typeof parsers | null }) {
  const nodes = useMemo(() => {
    if (!lang) return [code];
    const out: React.ReactNode[] = [];
    let k = 0;
    const tree = parsers[lang].parse(code);
    highlightCode(
      code,
      tree,
      highlighter,
      (text, classes) => {
        // highlight Jinja tags on top of the SQL tokens
        if (lang === 'sql' && /\{\{|\{%|\}\}|%\}/.test(text)) out.push(<span key={k++} className="syn-j">{text}</span>);
        else out.push(classes ? <span key={k++} className={classes}>{text}</span> : text);
      },
      () => out.push('\n'),
    );
    return out;
  }, [code, lang]);
  return <>{nodes}</>;
}

export function CodeBlock({ code, info = '' }: { code: string; info?: string }) {
  const runnable = /\brun\b/.test(info) && langOf(info) === 'sql';
  const lang = langOf(info);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const setGymDraft = useProgress((s) => s.setGymDraft);
  const label = info.split(/\s+/)[0] || 'text';
  return (
    <div className="group relative my-4 border border-line bg-code">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-[11px] tracking-wide text-ink-3 uppercase">{label}</span>
        <div className="flex items-center gap-1">
          {runnable && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-[12px] font-medium text-primary hover:bg-primary-soft"
              onClick={() => {
                setGymDraft(code.trim());
                navigate('/gym/playground');
              }}
            >
              <Play size={12} aria-hidden /> Run in SQL gym
            </button>
          )}
          <button
            type="button"
            aria-label="Copy code"
            className="inline-flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-[12px] text-ink-3 hover:bg-surface-3 hover:text-ink"
            onClick={() => {
              navigator.clipboard?.writeText(code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              });
            }}
          >
            {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-[1.6] text-ink">
        <code>
          <Highlighted code={code.replace(/\n$/, '')} lang={lang} />
        </code>
      </pre>
    </div>
  );
}
