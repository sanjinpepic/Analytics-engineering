import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import { useMemo, useRef } from 'react';

export const aeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.standard(t.name)], color: 'var(--syn-func)' },
  { tag: [t.typeName, t.className], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--syn-keyword)' },
  { tag: t.atom, color: 'var(--syn-type)' },
]);

const jinjaDecorator = new MatchDecorator({
  regexp: /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g,
  decoration: () => Decoration.mark({ class: 'cm-jinja' }),
});
const jinjaPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = jinjaDecorator.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = jinjaDecorator.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--code-bg)', color: 'var(--ink)' },
  '.cm-content': { caretColor: 'var(--primary)', padding: '10px 0' },
  '.cm-cursor': { borderLeftColor: 'var(--primary)', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--ink-3)', border: 'none', paddingLeft: '4px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--primary) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-2)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-jinja': { color: 'var(--syn-jinja)', fontWeight: '600' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--line-strong)', color: 'var(--ink)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--primary)', color: 'var(--primary-ink)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--primary) 18%, transparent)', outline: 'none' },
  '.cm-placeholder': { color: 'var(--ink-3)' },
});

export interface SqlEditorProps {
  value: string;
  onChange?: (v: string) => void;
  onRun?: (selectionOrAll: string) => void;
  language?: 'sql' | 'yaml';
  minHeight?: string;
  maxHeight?: string;
  readOnly?: boolean;
  placeholder?: string;
  schema?: Record<string, string[]>;
  ariaLabel?: string;
}

export function SqlEditor({ value, onChange, onRun, language = 'sql', minHeight = '160px', maxHeight, readOnly, placeholder, schema, ariaLabel }: SqlEditorProps) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const extensions = useMemo(() => {
    const lang = language === 'yaml' ? yaml() : sql({ dialect: PostgreSQL, schema, upperCaseKeywords: false });
    return [
      lang,
      syntaxHighlighting(aeHighlight),
      theme,
      jinjaPlugin,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? (language === 'yaml' ? 'YAML editor' : 'SQL editor') }),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: (view) => {
              const sel = view.state.selection.main;
              const text = sel.empty ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to);
              runRef.current?.(text);
              return true;
            },
          },
        ]),
      ),
    ];
  }, [language, schema, ariaLabel]);

  return (
    <CodeMirror
      ref={ref}
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="none"
      readOnly={readOnly}
      editable={!readOnly}
      placeholder={placeholder}
      minHeight={minHeight}
      maxHeight={maxHeight}
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly, autocompletion: !readOnly, searchKeymap: true }}
    />
  );
}
