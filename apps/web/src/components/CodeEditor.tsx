import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState, StateField, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  type DecorationSet,
} from '@codemirror/view';
import { locateSecrets } from '@shipgate/core/browser';
import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';

export interface CodeEditorHandle {
  revealLine: (line: number) => void;
}

export interface Cursor {
  line: number;
  column: number;
  lines: number;
}

/** Texts longer than this are scanned but not highlighted, to keep typing responsive. */
const HIGHLIGHT_LIMIT = 1_000_000;

function markSecrets(state: EditorState): DecorationSet {
  if (state.doc.length > HIGHLIGHT_LIMIT) return Decoration.none;
  const ranges: Array<Range<Decoration>> = [];
  const flaggedLines = new Set<number>();
  for (const match of locateSecrets(state.doc.toString())) {
    if (match.to <= match.from) continue;
    const kind = match.placeholder ? 'placeholder' : match.confidence;
    const title = match.placeholder ? `${match.ruleId}: placeholder value, not reported` : `${match.ruleId} (${match.confidence} confidence)`;
    ranges.push(Decoration.mark({ class: `cm-secret cm-secret-${kind}`, attributes: { title } }).range(match.from, match.to));
    if (!match.placeholder) flaggedLines.add(state.doc.lineAt(match.from).from);
  }
  for (const from of flaggedLines) ranges.push(Decoration.line({ class: 'cm-secret-line' }).range(from));
  return Decoration.set(ranges, true);
}

const secretHighlights = StateField.define<DecorationSet>({
  create: markSecrets,
  update: (marks, tr) => (tr.docChanged ? markSecrets(tr.state) : marks),
  provide: (field) => EditorView.decorations.from(field),
});

function cursorOf(state: EditorState): Cursor {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1, lines: state.doc.lines };
}

/**
 * Plain-text editor that highlights credential-shaped values with the core scanner.
 * `docKey` identifies the document: changing it starts a fresh editor state.
 */
export function CodeEditor({
  docKey,
  value,
  label,
  onChange,
  onCursor,
  ref,
}: {
  docKey: string;
  value: string;
  label: string;
  onChange: (value: string) => void;
  onCursor?: (cursor: Cursor) => void;
  ref?: Ref<CodeEditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const callbacks = useRef({ onChange, onCursor });
  callbacks.current = { onChange, onCursor };

  const createState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        placeholder('Empty file. Type or paste text to scan it.'),
        EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
        secretHighlights,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) callbacks.current.onCursor?.(cursorOf(update.state));
        }),
      ],
    });

  useLayoutEffect(() => {
    const editor = new EditorView({ parent: host.current!, state: createState(value) });
    view.current = editor;
    callbacks.current.onCursor?.(cursorOf(editor.state));
    return () => editor.destroy();
  }, []);

  const shownKey = useRef(docKey);
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    if (shownKey.current !== docKey) {
      shownKey.current = docKey;
      editor.setState(createState(value));
      callbacks.current.onCursor?.(cursorOf(editor.state));
    } else if (editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [docKey, value]);

  useImperativeHandle(ref, () => ({
    revealLine(lineNumber: number) {
      const editor = view.current;
      if (!editor) return;
      const line = editor.state.doc.line(Math.min(Math.max(1, lineNumber), editor.state.doc.lines));
      editor.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
      editor.focus();
    },
  }), []);

  return <div className="code-editor" ref={host} />;
}
