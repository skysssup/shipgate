import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { RULE_SAMPLES, SECRET_RULES, type SecretFinding } from '@shipgate/core/browser';
import { ChevronRight, FilePlus2, FileText, FolderOpen, KeyRound, LockKeyhole, Plus, Trash2, Upload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { findingEffect, pathProblem, skippedPlaceholders, type FindingEffect, type SimState } from '../lib/model';
import type { SimAction } from '../lib/state';
import { CodeEditor, type CodeEditorHandle, type Cursor } from './CodeEditor';
import { Button, cx, IconButton, Panel } from './ui';

const MAX_FILE_BYTES = 1024 * 1024;

const EFFECT: Record<FindingEffect, { label: string; tone: string; hint: string }> = {
  blocks: { label: 'Blocks', tone: 'block', hint: 'This finding alone stops the run at this level.' },
  allowed: { label: 'Allowed', tone: 'hold', hint: 'yolo allows medium-confidence findings with a warning.' },
  overridden: { label: 'Overridden', tone: 'hold', hint: '--force-secrets lets this finding through with a warning.' },
};

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  const dot = base.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
  for (let n = 2; ; n += 1) if (!taken.includes(`${stem}-${n}${ext}`)) return `${stem}-${n}${ext}`;
}

export function StagedChanges({ state, dispatch, findings }: { state: SimState; dispatch: (action: SimAction) => void; findings: SecretFinding[] }) {
  const editor = useRef<CodeEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tablist = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<Cursor>({ line: 1, column: 1, lines: 1 });
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const pathId = useId();
  const panelId = useId();

  const active = state.files.find((f) => f.path === state.activePath) ?? state.files[0];
  const [invalidPath, setInvalidPath] = useState<{ file: string; text: string } | null>(null);
  const draftPath = invalidPath && invalidPath.file === active?.path ? invalidPath.text : active?.path ?? '';
  const otherPaths = state.files.filter((f) => f !== active).map((f) => f.path);
  const problem = active ? pathProblem(draftPath, otherPaths) : undefined;

  const perFile = new Map<string, SecretFinding[]>();
  for (const finding of findings) perFile.set(finding.path, [...(perFile.get(finding.path) ?? []), finding]);
  const skipped = skippedPlaceholders(state.hasChanges ? state.files : []);
  const fileFindings = findings.filter((f) => f.path !== '--message');

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const added = [];
    const refused = [];
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE_BYTES) refused.push(file.name);
      else added.push({ path: file.name, content: await file.text() });
    }
    dispatch({ type: 'file-add', files: added });
    setNotice(
      [
        added.length ? `Added ${added.map((f) => f.path).join(', ')}. The contents stay in this browser.` : '',
        refused.length ? `Skipped ${refused.join(', ')}: files over 1 MB are not loaded.` : '',
      ].filter(Boolean).join(' '),
    );
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: state.files.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = state.files[(keys[event.key] + state.files.length) % state.files.length];
    dispatch({ type: 'file-select', path: next.path });
    requestAnimationFrame(() => tablist.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus());
  };

  const reveal = (path: string, line?: number) => {
    if (path === '--message') return;
    dispatch({ type: 'file-select', path });
    requestAnimationFrame(() => editor.current?.revealLine(line ?? 1));
  };

  const addMenu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm">
          <Plus size={14} aria-hidden />
          Add file
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={6} collisionPadding={12}>
          <DropdownMenu.Item
            className="menu-item"
            onSelect={() => dispatch({ type: 'file-add', files: [{ path: uniqueName('notes.txt', state.files.map((f) => f.path)), content: '' }] })}
          >
            <FilePlus2 size={14} aria-hidden />
            New empty file
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => fileInput.current?.click()}>
            <FolderOpen size={14} aria-hidden />
            Open from this device…
          </DropdownMenu.Item>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="menu-item">
              <KeyRound size={14} aria-hidden />
              Sample for a rule
              <ChevronRight size={14} className="menu-chevron" aria-hidden />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="menu" sideOffset={4} collisionPadding={12}>
                <DropdownMenu.Label className="menu-label">Synthetic values, not real credentials</DropdownMenu.Label>
                {SECRET_RULES.map((rule) => (
                  <DropdownMenu.Item key={rule.id} className="menu-item mono" onSelect={() => dispatch({ type: 'file-add', files: [{ ...RULE_SAMPLES[rule.id] }] })}>
                    {rule.id}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  return (
    <>
      <Panel
        title="Staged changes"
        icon={<FileText size={16} aria-hidden />}
        className={cx('files-panel', dragging && 'is-dragging', !state.hasChanges && 'is-clean')}
        actions={addMenu}
      >
        <div
          className="files-body"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          {!state.hasChanges && (
            <div className="callout callout-muted" role="note">
              <span>The working tree is clean, so these files are not part of the run.</span>
              <Button size="sm" onClick={() => dispatch({ type: 'set', patch: { hasChanges: true } })}>
                Include them
              </Button>
            </div>
          )}
          {active ? (
            <>
              <div className="file-tabs" role="tablist" aria-label="Files" ref={tablist}>
                {state.files.map((file, index) => {
                  const count = perFile.get(file.path)?.length ?? 0;
                  const selected = file === active;
                  const slash = file.path.lastIndexOf('/');
                  return (
                    <button
                      key={file.path}
                      type="button"
                      role="tab"
                      id={`${panelId}-tab-${index}`}
                      aria-selected={selected}
                      aria-controls={panelId}
                      tabIndex={selected ? 0 : -1}
                      aria-label={count ? `${file.path}, ${count} ${count === 1 ? 'finding' : 'findings'}` : file.path}
                      className="file-tab"
                      onClick={() => dispatch({ type: 'file-select', path: file.path })}
                      onKeyDown={(event) => onTabKey(event, index)}
                    >
                      {slash > 0 && <span className="file-tab-dir">{file.path.slice(0, slash + 1)}</span>}
                      <span className="file-tab-name">{file.path.slice(slash + 1)}</span>
                      {count > 0 && (
                        <span className="file-tab-count" aria-hidden>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div
                className="file-pane"
                role="tabpanel"
                id={panelId}
                aria-labelledby={`${panelId}-tab-${state.files.indexOf(active)}`}
              >
                <div className="file-toolbar">
                  <label className="sr-only" htmlFor={pathId}>
                    Path of the selected file
                  </label>
                  <input
                    id={pathId}
                    className={cx('input', 'mono', 'path-input', problem && 'is-invalid')}
                    value={draftPath}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={Boolean(problem)}
                    aria-describedby={problem ? `${pathId}-error` : `${pathId}-hint`}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (pathProblem(next, otherPaths)) {
                        setInvalidPath({ file: active.path, text: next });
                      } else {
                        setInvalidPath(null);
                        dispatch({ type: 'file-rename', path: active.path, to: next });
                      }
                    }}
                  />
                  <IconButton label={`Remove ${active.path} from the change`} onClick={() => dispatch({ type: 'file-remove', path: active.path })}>
                    <Trash2 size={15} aria-hidden />
                  </IconButton>
                </div>
                {problem ? (
                  <p className="field-error" id={`${pathId}-error`}>
                    {problem}
                  </p>
                ) : (
                  <p className="sr-only" id={`${pathId}-hint`}>
                    Renaming a file changes which filename rules apply, for example .env.
                  </p>
                )}
                <CodeEditor
                  ref={editor}
                  docKey={active.path}
                  value={active.content}
                  label={`Contents of ${active.path}`}
                  onChange={(content) => dispatch({ type: 'file-edit', path: active.path, content })}
                  onCursor={setCursor}
                />
                <div className="status-bar">
                  <span>
                    Ln {cursor.line}, Col {cursor.column}
                  </span>
                  <span>
                    {cursor.lines} {cursor.lines === 1 ? 'line' : 'lines'}
                  </span>
                  <span className="status-local">
                    <LockKeyhole size={12} aria-hidden />
                    Scanned in this browser
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="empty">
              <p>No files in the change.</p>
              <div className="empty-actions">
                <Button size="sm" onClick={() => dispatch({ type: 'file-add', files: [{ path: 'notes.txt', content: '' }] })}>
                  <FilePlus2 size={14} aria-hidden />
                  New file
                </Button>
                <Button size="sm" onClick={() => fileInput.current?.click()}>
                  <Upload size={14} aria-hidden />
                  Open from this device
                </Button>
              </div>
            </div>
          )}
          <p className="files-notice" role="status">
            {notice}
          </p>
          {dragging && (
            <div className="drop-overlay" aria-hidden>
              <Upload size={20} />
              Drop files to add them. They stay in this browser.
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="Scan results"
        icon={<KeyRound size={16} aria-hidden />}
        actions={
          <span className="panel-meta">
            {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
            {skipped.length ? `, ${skipped.length} skipped` : ''}
          </span>
        }
      >
        {findings.length || skipped.length ? (
          <ul className="findings" aria-label="Findings and skipped placeholders">
            {findings.map((finding) => {
              const effect = EFFECT[findingEffect(state, finding)];
              const where = finding.line ? `${finding.path}:${finding.line}` : finding.path;
              return (
                <li key={`${finding.path}:${finding.ruleId}`} className="finding">
                  <span className={cx('dot', `dot-${finding.confidence}`)} aria-hidden />
                  <div className="finding-main">
                    <span className="finding-rule">
                      <span className="mono">{finding.ruleId}</span>
                      <span className="muted">{finding.confidence} confidence</span>
                    </span>
                    <span className="finding-where">
                      {finding.path === '--message' ? (
                        <span className="mono">-m message</span>
                      ) : (
                        <button type="button" className="link-btn mono" onClick={() => reveal(finding.path, finding.line)} aria-label={`Show ${where} in the editor`}>
                          {where}
                        </button>
                      )}
                      {finding.ruleId !== 'dotenv-file' && <span className="mono excerpt">{finding.excerpt}</span>}
                      {finding.ruleId === 'dotenv-file' && <span className="muted">filename rule</span>}
                    </span>
                  </div>
                  <span className={cx('chip', `tone-${effect.tone}`)} title={effect.hint}>
                    {effect.label}
                  </span>
                </li>
              );
            })}
            {skipped.map((value) => (
              <li key={`${value.path}:${value.line}:${value.ruleId}:${value.value}`} className="finding is-skipped">
                <span className="dot dot-skipped" aria-hidden />
                <div className="finding-main">
                  <span className="finding-rule">
                    <span className="mono">{value.ruleId}</span>
                    <span className="muted">placeholder, not reported</span>
                  </span>
                  <span className="finding-where">
                    <button type="button" className="link-btn mono" onClick={() => reveal(value.path, value.line)} aria-label={`Show ${value.path}:${value.line} in the editor`}>
                      {value.path}:{value.line}
                    </button>
                    <span className="mono excerpt">{value.value.length > 32 ? `${value.value.slice(0, 31)}…` : value.value}</span>
                  </span>
                </div>
                <span className="chip tone-noop" title="Plainly a placeholder, so the scanner does not report it.">
                  Skipped
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-line">
            {state.hasChanges && state.files.length ? 'No credential-shaped values in the staged files.' : 'Nothing to scan.'}
          </p>
        )}
        <p className="panel-foot">
          Pattern matching only: a credential without a rule, such as <code>password = &quot;hunter2&quot;</code>, is not found.
          {fileFindings.length > 0 && ' Each rule reports its first match per file.'}
        </p>
      </Panel>
    </>
  );
}
