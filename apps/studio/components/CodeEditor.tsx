'use client';
/**
 * Code editor for the Programmer workspace: CodeMirror 6 with syntax highlighting, autocomplete,
 * linting, search, bracket matching, folding and the usual keyboard shortcuts.
 */
import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { xml, type ElementSpec } from '@codemirror/lang-xml';
import { json } from '@codemirror/lang-json';

export interface LintMessage {
  line: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

const theme = EditorView.theme({
  '&': {
    fontSize: '13px',
    border: '1px solid var(--q-border)',
    borderRadius: '10px',
    background: 'var(--q-surface)',
    color: 'var(--q-text)',
  },
  '.cm-scroller': { fontFamily: 'var(--mono)', minHeight: '420px', maxHeight: '70vh' },
  '.cm-gutters': { background: 'var(--q-surface-2)', color: 'var(--q-text-muted)', borderRight: '1px solid var(--q-border)' },
  '.cm-activeLine': { background: 'color-mix(in srgb, var(--q-accent-text) 7%, transparent)' },
  '.cm-activeLineGutter': { background: 'color-mix(in srgb, var(--q-accent-text) 12%, transparent)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--q-accent-text)' },
  '&.cm-focused .cm-selectionBackground, ::selection': { background: 'color-mix(in srgb, var(--q-accent-text) 28%, transparent)' },
  '.cm-tooltip': { background: 'var(--q-surface)', border: '1px solid var(--q-border)', color: 'var(--q-text)' },
});

export function CodeEditor({
  value,
  onChange,
  language,
  elements,
  lint,
  readOnly,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  language: 'xml' | 'json';
  /** XML: element and attribute names offered by autocomplete. */
  elements?: ElementSpec[];
  /** Problems to show in the gutter and under the text, by line. */
  lint?: (text: string) => LintMessage[];
  readOnly?: boolean;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lintRef = useRef(lint);
  lintRef.current = lint;
  const ro = useRef(new Compartment());

  useEffect(() => {
    const extensions: Extension[] = [
      basicSetup,
      keymap.of([indentWithTab]),
      theme,
      language === 'xml' ? xml({ elements }) : json(),
      lintGutter(),
      linter(
        (v): Diagnostic[] => {
          const f = lintRef.current;
          if (!f) return [];
          const doc = v.state.doc;
          return f(doc.toString()).map((m) => {
            const line = doc.line(Math.min(Math.max(1, m.line), doc.lines));
            return { from: line.from, to: line.to, severity: m.severity, message: m.message };
          });
        },
        { delay: 400 },
      ),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString());
      }),
      EditorView.contentAttributes.of({ 'aria-label': label }),
      ro.current.of(EditorState.readOnly.of(!!readOnly)),
    ];
    view.current = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current! });
    return () => view.current?.destroy();
    // The editor is created once per language; value and readOnly changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(!!readOnly)) });
  }, [readOnly]);

  return <div ref={host} className="code-editor" data-testid="code-editor" />;
}
