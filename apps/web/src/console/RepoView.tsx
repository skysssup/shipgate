import { SAFETY_LEVELS, type PlanAction, type SafetyLevel } from '@shipgate/core/browser';
import {
  ChevronDown,
  CircleAlert,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  Lock,
  RefreshCw,
  Rocket,
  Settings2,
  ShieldCheck,
  Undo2,
  Webhook,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { STATUS, STEP_TITLE } from '../components/Decision';
import { outputLine } from '../components/Output';
import { ActionBadge, Button, CopyButton, cx, FlagToken, InlineCode, Section, TokenChoice } from '../components/ui';
import { createClient, type ConsoleSession, type HistoryReport, type PreviewResult, type RunOptions, type StatusReport } from './api';
import { ConfirmDialog } from './ConfirmDialog';
import {
  changeLabel,
  destinationLabel,
  destinationTone,
  draftFromStatus,
  keptValues,
  lockSummary,
  onCommand,
  policySummary,
  relativeTime,
  runCommand,
  sameDraft,
  settingsProblems,
  settingsRequest,
  shipReadiness,
  type SettingsDraft,
  type Tone,
} from './model';
import { useConsole, type ActionResult, type Loadable } from './useConsole';

const LEVEL_HINT: Record<SafetyLevel, string> = {
  strict: 'Blocks every finding and unacknowledged public destinations; recommends review.',
  balanced: 'Blocks every credential finding; warns about public destinations.',
  yolo: 'Blocks high-confidence findings only; allows medium ones with a warning.',
};

function Skeleton({ lines = 3, label }: { lines?: number; label: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton-line" style={{ width: `${90 - i * 18}%` }} aria-hidden />
      ))}
    </div>
  );
}

function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert tone-block" role="alert">
      <CircleAlert size={16} aria-hidden className="alert-icon" />
      <p className="alert-text">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Loading, error, and data states for one panel. Stale data stays visible under an error. */
function Loaded<T>({ state, label, retry, children }: { state: Loadable<T>; label: string; retry: () => void; children: (data: T) => ReactNode }) {
  if (state.data === null) {
    if (state.error) return <ErrorNote message={state.error} onRetry={retry} />;
    return <Skeleton label={`Loading ${label}`} />;
  }
  return (
    <>
      {state.error && <ErrorNote message={`Could not refresh ${label}: ${state.error}`} onRetry={retry} />}
      {children(state.data)}
    </>
  );
}

function Card({ title, icon, tone, value, children, action }: { title: string; icon: ReactNode; tone?: Tone; value: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <li className={cx('card', tone && `tone-${tone}`)}>
      <div className="card-head">
        <span className="card-icon" aria-hidden>
          {icon}
        </span>
        <h3 className="card-title">{title}</h3>
      </div>
      <p className="card-value">{value}</p>
      {children && <div className="card-detail">{children}</div>}
      {action && <div className="card-action">{action}</div>}
    </li>
  );
}

function StatusCards({ status, onSetup, busy }: { status: StatusReport; onSetup: () => void; busy: boolean }) {
  const policy = policySummary(status);
  const lock = lockSummary(status);
  const hooksInstalled = status.hooks.claude && status.hooks.cursor;
  return (
    <ul className="cards" aria-label="Repository status">
      <Card title="Branch" icon={<GitBranch size={15} />} value={status.branch ?? 'Detached HEAD'} tone={status.branch ? undefined : 'hold'}>
        <span className="mono break">{status.root}</span>
      </Card>
      <Card title="Policy" icon={<ShieldCheck size={15} />} tone={policy.tone} value={<span className="card-strong">{policy.label}</span>}>
        {policy.detail}
        {status.account && <span className="card-sub">Account {status.account} (display only)</span>}
      </Card>
      <Card title="Destination" icon={<Rocket size={15} />} tone={destinationTone(status)} value={destinationLabel(status)}>
        {status.destination?.description}
      </Card>
      <Card title="Activity" icon={<Lock size={15} />} tone={lock.tone} value={lock.tone === 'ship' ? 'Idle' : 'Attention'}>
        {lock.text}
      </Card>
      <Card
        title="Agent hooks"
        icon={<Webhook size={15} />}
        tone={hooksInstalled ? 'ship' : 'noop'}
        value={hooksInstalled ? 'Installed' : status.hooks.claude || status.hooks.cursor ? 'Partly installed' : 'Not installed'}
        action={
          !hooksInstalled && (
            <Button size="sm" onClick={onSetup} disabled={busy}>
              Install hooks…
            </Button>
          )
        }
      >
        Claude Code {status.hooks.claude ? 'installed' : 'not installed'} · Cursor {status.hooks.cursor ? 'installed' : 'not installed'}
      </Card>
    </ul>
  );
}

function Checks({ preview }: { preview: PreviewResult }) {
  const gates = preview.plan?.gates ?? [];
  const reached = gates.filter((g) => g.status !== 'not-reached');
  const unreached = gates.filter((g) => g.status === 'not-reached');
  return (
    <ol className="pipeline" aria-label="Checks in the order ship runs them">
      {reached.map((gate) => {
        const { label, icon: Icon } = STATUS[gate.status];
        return (
          <li key={gate.gate} className={cx('step', `status-${gate.status}`)}>
            <span className="step-icon" aria-hidden>
              <Icon size={11} strokeWidth={2.5} />
            </span>
            <div className="step-body">
              <div className="step-head">
                <span className="step-title">{STEP_TITLE[gate.gate]}</span>
                <span className="step-status">{label}</span>
              </div>
              <p className="step-detail">
                <InlineCode text={gate.detail} />
              </p>
            </div>
          </li>
        );
      })}
      {unreached.length > 0 && (
        <li className="step status-not-reached">
          <span className="step-icon" aria-hidden />
          <div className="step-body">
            <div className="step-head">
              <span className="step-title">
                {unreached.length} {unreached.length === 1 ? 'step' : 'steps'} not reached
              </span>
            </div>
            <p className="step-skipped-list">{unreached.map((g) => STEP_TITLE[g.gate]).join(' · ')}</p>
          </div>
        </li>
      )}
    </ol>
  );
}

function RunOptionsForm({ options, onChange }: { options: RunOptions; onChange: (next: RunOptions) => void }) {
  const messageId = useId();
  const promptId = useId();
  return (
    <div className="run-options">
      <div className="field">
        <label className="field-label" htmlFor={messageId}>
          Commit message <span className="muted">(-m, optional)</span>
        </label>
        <input
          id={messageId}
          className="input"
          value={options.message ?? ''}
          placeholder="Made from the changed files"
          maxLength={2000}
          onChange={(event) => onChange({ ...options, message: event.target.value })}
        />
        <p className="field-hint">Used as written. A message skips external review for this run.</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={promptId}>
          Task description <span className="muted">(--prompt, optional)</span>
        </label>
        <input
          id={promptId}
          className="input"
          value={options.prompt ?? ''}
          placeholder="What the change is for"
          maxLength={2000}
          onChange={(event) => onChange({ ...options, prompt: event.target.value })}
        />
        <p className="field-hint">Scanned for credentials, used for the subject when there is no message, and sent to the reviewer.</p>
      </div>
      <div className="flag-row" role="group" aria-label="Run flags">
        <FlagToken
          flag="--force-secrets"
          pressed={Boolean(options.forceSecrets)}
          onChange={(forceSecrets) => onChange({ ...options, forceSecrets })}
          description="Commit despite credential findings. Use only for values you know are not real credentials."
        />
        <FlagToken
          flag="--public-ok"
          pressed={Boolean(options.publicOk)}
          onChange={(publicOk) => onChange({ ...options, publicOk })}
          description="Acknowledge a public destination for this run."
        />
        <FlagToken
          flag="--confirm"
          pressed={Boolean(options.confirm)}
          onChange={(confirm) => onChange({ ...options, confirm })}
          description="Record that a person checked the change. Removes strict's recommendation."
        />
      </div>
    </div>
  );
}

function PreviewBody({ preview }: { preview: PreviewResult }) {
  const action: PlanAction = preview.plan?.action ?? 'hold';
  return (
    <div className="preview">
      <div className={cx('preview-verdict', `tone-${preview.state === 'ready' ? action : preview.state === 'not-enabled' ? 'block' : 'hold'}`)}>
        <ActionBadge action={preview.state === 'ready' ? action : preview.state === 'not-enabled' ? 'block' : 'hold'} />
        <p className="preview-summary">{preview.summary}</p>
      </div>
      {preview.problems.length > 0 && (
        <ul className="repo-notes">
          {preview.problems.map((p) => (
            <li key={p} className="is-reason">
              <span className="note-text">{p}</span>
            </li>
          ))}
        </ul>
      )}
      {(preview.plan?.reasons.length || preview.plan?.warnings.length || preview.plan?.recommendations.length || preview.next) && (
        <ul className="repo-notes">
          {preview.plan?.reasons.map((r) => (
            <li key={r} className="is-reason">
              <span className="note-text">
                <InlineCode text={r} />
              </span>
            </li>
          ))}
          {preview.plan?.warnings.map((w) => (
            <li key={w} className="is-warning">
              <span className="note-text">
                <InlineCode text={w} />
              </span>
            </li>
          ))}
          {preview.plan?.recommendations.map((a) => (
            <li key={a} className="is-advice">
              <span className="note-text">{a}</span>
            </li>
          ))}
          {preview.next && (
            <li className="is-next">
              <span className="note-text">
                <strong>Next:</strong> <InlineCode text={preview.next} />
              </span>
            </li>
          )}
        </ul>
      )}

      <div className="preview-grid">
        <section aria-labelledby="changes-heading" className="subsection">
          <h3 className="subsection-title" id="changes-heading">
            <FileDiff size={14} aria-hidden /> Changes <span className="count">{preview.changes.length}</span>
          </h3>
          {preview.changes.length ? (
            <ul className="change-list">
              {preview.changes.map((change) => (
                <li key={change.path} className="change">
                  <span className={cx('change-status', `change-${change.status}`)} title={changeLabel(change.status)}>
                    <span aria-hidden>{change.status}</span>
                    <span className="sr-only">{changeLabel(change.status)}</span>
                  </span>
                  <span className="mono break">{change.path}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-line">No changes. The working tree matches HEAD.</p>
          )}
          {preview.subject && preview.plan?.action === 'ship' && (
            <p className="preview-subject">
              Commit subject: <code>{preview.subject}</code>
            </p>
          )}
        </section>
        <section aria-labelledby="findings-heading" className="subsection">
          <h3 className="subsection-title" id="findings-heading">
            <CircleAlert size={14} aria-hidden /> Findings <span className="count">{preview.findings.length}</span>
          </h3>
          {preview.findings.length ? (
            <ul className="findings">
              {preview.findings.map((f) => (
                <li key={`${f.path}:${f.ruleId}:${f.line ?? 0}`} className="finding">
                  <span className={cx('dot', `dot-${f.confidence}`)} aria-hidden />
                  <div className="finding-main">
                    <span className="finding-rule">
                      {f.ruleId} <span className="muted">({f.confidence})</span>
                    </span>
                    <span className="finding-where mono">
                      {f.path}
                      {f.line ? `:${f.line}` : ''}
                    </span>
                    {f.ruleId !== 'dotenv-file' && <code className="excerpt">{f.excerpt}</code>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-line">No credential patterns in the changes{preview.changes.length ? '' : ' (nothing to scan)'}.</p>
          )}
        </section>
      </div>

      {preview.plan && (
        <details className="disclosure" open={preview.plan.action !== 'ship'}>
          <summary>
            <ChevronDown size={14} aria-hidden className="chevron" />
            Every check
          </summary>
          <Checks preview={preview} />
        </details>
      )}
      {preview.notes.map((n) => (
        <p key={n} className="section-note">
          {n}
        </p>
      ))}
    </div>
  );
}

function Terminal({ result }: { result: ActionResult }) {
  return (
    <pre className={cx('terminal', result.ok ? 'tone-ship' : 'tone-hold')} tabIndex={0} aria-label={`Output of ${result.title}`}>
      <code>
        <span className="t-line t-command">
          <span className="t-prompt">$ </span>
          {result.title}
        </span>
        {result.lines.map(outputLine)}
        {result.exitCode !== null && (
          <>
            <span className="t-line t-command">
              <span className="t-prompt">$ </span>echo $?
            </span>
            <span className="t-line t-exit">{result.exitCode}</span>
          </>
        )}
      </code>
    </pre>
  );
}

function ResultPanel({ result, onDismiss }: { result: ActionResult; onDismiss: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [result.id]);
  return (
    <section ref={ref} tabIndex={-1} className={cx('result', result.ok ? 'tone-ship' : 'tone-hold')} aria-labelledby="result-heading">
      <header className="result-head">
        <h2 className="section-title" id="result-heading">
          {result.ok ? 'Done' : 'Needs attention'}: <span className="mono">{result.title}</span>
        </h2>
        <div className="section-actions">
          {result.lines.length > 0 && <CopyButton text={result.lines.join('\n')} label="Copy output" />}
          <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss result">
            <X size={14} aria-hidden />
          </button>
        </div>
      </header>
      <p className="result-summary">{result.summary}</p>
      {result.lines.length > 0 && <Terminal result={result} />}
    </section>
  );
}

function SettingsForm({ status, busy, onSave, onDisable }: { status: StatusReport; busy: boolean; onSave: (draft: SettingsDraft) => void; onDisable: () => void }) {
  const configured = status.config.state === 'ok';
  const saved = useMemo(() => (configured ? draftFromStatus(status) : null), [configured, status]);
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromStatus(status));
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setDraft(draftFromStatus(status));
    // Reset the form only when the saved settings change, not on every status refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  const problems = settingsProblems(draft);
  const invalid = Object.keys(problems).length > 0;
  const unchanged = saved !== null && status.enabled && sameDraft(draft, saved);
  const kept = keptValues(draft, saved);
  const levelHint = useId();
  const modelId = useId();
  const accountId = useId();
  const reviewId = useId();
  const publicId = useId();
  const set = (patch: Partial<SettingsDraft>) => setDraft((d) => ({ ...d, ...patch }));

  if (status.config.state === 'invalid') {
    return (
      <div className="alert tone-block" role="alert">
        <CircleAlert size={16} aria-hidden className="alert-icon" />
        <p className="alert-text">
          <code>{status.config.path}</code> is invalid: {status.config.error}. Fix or delete the file, then refresh. The console does not overwrite a
          file it cannot read.
        </p>
      </div>
    );
  }

  return (
    <form
      className="settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) onSave(draft);
      }}
    >
      <fieldset className="field">
        <legend className="field-label">Policy level</legend>
        <TokenChoice
          label="Policy level"
          value={draft.level}
          options={SAFETY_LEVELS.map((level) => ({ value: level, label: level }))}
          onChange={(level) => set({ level })}
          describedBy={levelHint}
        />
        <p className="field-hint" id={levelHint}>
          {LEVEL_HINT[draft.level]}
        </p>
      </fieldset>
      <div className="check-field">
        <input id={reviewId} type="checkbox" className="checkbox" checked={draft.agentReview} onChange={(e) => set({ agentReview: e.target.checked })} />
        <label htmlFor={reviewId}>
          <span className="check-label">External review</span>
          <span className="field-hint">Sends file paths, the redacted staged diff, and the task description to the review endpoint before each commit.</span>
        </label>
      </div>
      <div className="check-field">
        <input id={publicId} type="checkbox" className="checkbox" checked={draft.publicOk} onChange={(e) => set({ publicOk: e.target.checked })} />
        <label htmlFor={publicId}>
          <span className="check-label">Acknowledge public destinations</span>
          <span className="field-hint">Stops strict from blocking and balanced from warning when origin is public or unverified.</span>
        </label>
      </div>
      <div className="field-row">
        <div className="field">
          <label className="field-label" htmlFor={modelId}>
            Review model <span className="muted">(optional)</span>
          </label>
          <input
            id={modelId}
            className="input mono"
            value={draft.model}
            placeholder="openai/gpt-4o-mini"
            aria-invalid={Boolean(problems.model)}
            onChange={(e) => set({ model: e.target.value })}
          />
          {problems.model && <p className="field-error">{problems.model}</p>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor={accountId}>
            GitHub account <span className="muted">(optional, display only)</span>
          </label>
          <input
            id={accountId}
            className="input mono"
            value={draft.account}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(problems.account)}
            aria-describedby={problems.account ? `${accountId}-error` : undefined}
            onChange={(e) => set({ account: e.target.value })}
          />
          {problems.account && (
            <p className="field-error" id={`${accountId}-error`}>
              {problems.account}
            </p>
          )}
        </div>
      </div>
      <p className="field-hint">
        The review API key is never handled here: set <code>OPENROUTER_API_KEY</code> or run <code>shipgate on --key</code> in a terminal.
      </p>
      {kept.length > 0 && (
        <p className="field-hint">
          <code>shipgate on</code> keeps values it is not given, so clearing the {kept.join(' and ')} field leaves the saved value. Edit{' '}
          <code>.shipgate.json</code> to remove it.
        </p>
      )}
      <div className="command">
        <pre className="code-block">
          <code>
            <span className="t-prompt" aria-hidden>
              ${' '}
            </span>
            {onCommand(draft, saved)}
          </code>
        </pre>
        <CopyButton text={onCommand(draft, saved)} label="Copy command" />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || invalid || unchanged}>
          {!configured ? 'Enable Shipgate' : !status.enabled ? 'Enable with these settings' : 'Save settings'}
        </button>
        {configured && status.enabled && (
          <Button onClick={onDisable} disabled={busy}>
            Disable…
          </Button>
        )}
        {unchanged && <span className="muted form-note">No unsaved changes.</span>}
      </div>
    </form>
  );
}

function HistoryTable({ history, onUndo, busy }: { history: HistoryReport; onUndo: () => void; busy: boolean }) {
  const now = Date.now();
  if (!history.commits.length) {
    return (
      <div className="empty">
        <GitCommitHorizontal size={20} aria-hidden />
        <p>No commits on this branch yet.</p>
      </div>
    );
  }
  const head = history.commits[0];
  return (
    <>
      {history.undoCandidate && (
        <div className="undo-row">
          <p>
            HEAD <code>{head.shortSha}</code> is a Shipgate commit. Undo removes it {head.onOrigin ? 'locally and from origin' : 'from this branch'} and keeps its changes in the
            working tree.
          </p>
          <Button onClick={onUndo} disabled={busy}>
            <Undo2 size={14} aria-hidden />
            Undo last ship…
          </Button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table history-table">
          <caption className="sr-only">Recent commits on {history.branch ?? 'HEAD'}, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Commit</th>
              <th scope="col">Subject</th>
              <th scope="col">When</th>
              <th scope="col">Origin</th>
            </tr>
          </thead>
          <tbody>
            {history.commits.map((c) => (
              <tr key={c.sha}>
                <th scope="row">
                  <code title={c.sha}>{c.shortSha}</code>
                </th>
                <td>
                  <span className="history-subject">
                    {c.subject}
                    {c.shipgate && <span className="badge tone-ship">Shipgate</span>}
                    {c.merge && <span className="badge tone-noop">Merge</span>}
                  </span>
                  <span className="muted history-author">{c.author}</span>
                </td>
                <td>
                  <time dateTime={c.date} title={new Date(c.date).toLocaleString()}>
                    {relativeTime(c.date, now)}
                  </time>
                </td>
                <td>{c.onOrigin === null ? <span className="muted">no tracking ref</span> : c.onOrigin ? 'pushed' : <strong>local only</strong>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history.originRef && <p className="section-note">Pushed state comes from {history.originRef} as of the last fetch or push.</p>}
    </>
  );
}

type Pending = null | 'ship' | 'undo' | 'disable' | 'setup';

export function RepoView({ session }: { session: ConsoleSession }) {
  const client = useMemo(() => createClient(session), [session]);
  const [options, setOptions] = useState<RunOptions>({});
  const c = useConsole(client, options);
  const [pending, setPending] = useState<Pending>(null);
  const [announcement, setAnnouncement] = useState('');

  // Re-run the preview shortly after the run options change.
  const first = useRef(true);
  const { loadPreview } = c;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => void loadPreview(), 350);
    return () => window.clearTimeout(timer);
  }, [options, loadPreview]);

  useEffect(() => {
    if (c.result) setAnnouncement(`${c.result.title}: ${c.result.summary}`);
  }, [c.result]);

  const preview = c.preview.data;
  const readiness = shipReadiness(preview);
  const status = c.status.data;
  const loading = c.status.loading || c.history.loading || c.preview.loading;
  const shipCommandText = runCommand('ship', options);

  const confirm = () => {
    const what = pending;
    setPending(null);
    if (what === 'ship') void c.run('ship', shipCommandText, () => client.ship(options), (r) => Boolean(r.committed));
    if (what === 'undo') void c.run('undo', 'shipgate undo', () => client.undo(), (r) => Boolean(r.undone));
    if (what === 'disable') void c.run('disable', 'shipgate off', () => client.off());
    if (what === 'setup') void c.run('setup', 'shipgate setup', () => client.setup());
  };

  return (
    <div className="page repo-page" aria-busy={loading}>
      <header className="page-head repo-head">
        <div>
          <p className="eyebrow">Repository console</p>
          <h1 className="page-title" tabIndex={-1} id="page-title">
            {session.repoName || status?.root?.split(/[\\/]/).pop() || 'Repository'}
          </h1>
          <p className="lead">Status, a preview of what ship would decide, settings, and history for this repository. Every action runs the same code as the CLI command shown next to it.</p>
        </div>
        <div className="repo-head-actions">
          <Button onClick={() => void c.refresh()} disabled={loading || c.busy !== null} aria-describedby="refreshed-at">
            <RefreshCw size={14} aria-hidden className={cx(loading && 'spin')} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <span className="muted refreshed" id="refreshed-at">
            {c.refreshedAt ? `Updated ${new Date(c.refreshedAt).toLocaleTimeString()}` : 'Loading…'}
          </span>
        </div>
      </header>

      {c.result && <ResultPanel result={c.result} onDismiss={c.dismissResult} />}

      <Section title="Status" className="page-section">
        <Loaded state={c.status} label="status" retry={() => void c.refresh()}>
          {(s) => <StatusCards status={s} busy={c.busy !== null} onSetup={() => setPending('setup')} />}
        </Loaded>
      </Section>

      <Section
        title="Preview and ship"
        className="page-section"
        meta={<span className="mono">{runCommand('preview', options)}</span>}
      >
        <div className="ship-layout">
          <div className="ship-options">
            <RunOptionsForm options={options} onChange={setOptions} />
            <div className="ship-action">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!readiness.allowed || c.busy !== null || c.preview.loading}
                aria-describedby="ship-reason"
                onClick={() => setPending('ship')}
              >
                <Rocket size={14} aria-hidden />
                {c.busy === 'ship' ? 'Shipping…' : 'Ship…'}
              </button>
              <p className="field-hint" id="ship-reason">
                {readiness.reason}
              </p>
            </div>
          </div>
          <div className="ship-preview" aria-live="off">
            <Loaded state={c.preview} label="the preview" retry={() => void c.loadPreview()}>
              {(p) => <PreviewBody preview={p} />}
            </Loaded>
          </div>
        </div>
      </Section>

      <Section title="Settings" className="page-section" meta={<span className="mono">.shipgate.json</span>}>
        <Loaded state={c.status} label="settings" retry={() => void c.refresh()}>
          {(s) => (
            <SettingsForm
              status={s}
              busy={c.busy !== null}
              onSave={(draft) => void c.run('save', onCommand(draft, s.config.state === 'ok' ? draftFromStatus(s) : null), () => client.on(settingsRequest(draft)))}
              onDisable={() => setPending('disable')}
            />
          )}
        </Loaded>
      </Section>

      <Section title="History" className="page-section" meta={c.history.data?.branch ? `Recent commits on ${c.history.data.branch}` : undefined}>
        <Loaded state={c.history} label="history" retry={() => void c.refresh()}>
          {(h) => <HistoryTable history={h} busy={c.busy !== null} onUndo={() => setPending('undo')} />}
        </Loaded>
      </Section>

      <ConfirmDialog
        open={pending === 'ship'}
        title="Ship these changes?"
        confirmLabel="Ship"
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      >
        <p>
          Stages every change in the repository ({preview?.changes.length ?? 0} {preview?.changes.length === 1 ? 'path' : 'paths'}), scans them again, commits
          {preview?.subject ? (
            <>
              {' '}
              “<strong>{preview.subject}</strong>”
            </>
          ) : null}
          , and pushes to {preview?.remote ?? 'origin'}.
        </p>
        <pre className="code-block">
          <code>$ {shipCommandText}</code>
        </pre>
      </ConfirmDialog>
      <ConfirmDialog open={pending === 'undo'} title="Undo the last ship?" confirmLabel="Undo" danger onConfirm={confirm} onCancel={() => setPending(null)}>
        <p>
          Removes <code>{c.history.data?.commits[0]?.shortSha}</code> “{c.history.data?.commits[0]?.subject}” from the branch
          {c.history.data?.commits[0]?.onOrigin ? ' and rewinds origin with a lease pinned to that commit' : ''}. Its changes stay in the working tree as unstaged edits.
        </p>
      </ConfirmDialog>
      <ConfirmDialog open={pending === 'disable'} title="Disable Shipgate here?" confirmLabel="Disable" danger onConfirm={confirm} onCancel={() => setPending(null)}>
        <p>
          Sets <code>"enabled": false</code> in <code>.shipgate.json</code>. ship and the agent hooks do nothing in this repository until you enable it again; other settings
          are kept.
        </p>
      </ConfirmDialog>
      <ConfirmDialog open={pending === 'setup'} title="Install agent hooks?" confirmLabel="Install hooks" onConfirm={confirm} onCancel={() => setPending(null)}>
        <p>
          Adds stop hooks to <code>{status?.hooks.paths.claude}</code> and <code>{status?.hooks.paths.cursor}</code>. They run <code>shipgate ship</code> after every Claude Code
          and Cursor turn, in every repository, but act only where Shipgate is enabled. Unrelated hooks are left alone.
        </p>
      </ConfirmDialog>

      <div className="sr-only console-announcer" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <p className="section-note repo-foot">
        <Settings2 size={13} aria-hidden /> Served by <code>shipgate ui</code> on 127.0.0.1 for this repository only.
      </p>
    </div>
  );
}

export function DisconnectedView() {
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Repository console</p>
        <h1 className="page-title" tabIndex={-1} id="page-title">
          Manage a repository from the browser
        </h1>
        <p className="lead">
          This copy of the page is the policy simulator, which never touches a repository. The repository console needs the local server that{' '}
          <code>shipgate ui</code> starts inside a repository.
        </p>
      </header>
      <div className="empty connect-empty">
        <GitBranch size={22} aria-hidden />
        <p>Start the console in the repository you want to manage, then open the address it prints.</p>
        <div className="command">
          <pre className="code-block">
            <code>
              <span className="t-prompt" aria-hidden>
                ${' '}
              </span>
              cd your-repo{'\n'}
              <span className="t-prompt" aria-hidden>
                ${' '}
              </span>
              shipgate ui
            </code>
          </pre>
          <CopyButton text={'cd your-repo\nshipgate ui'} label="Copy commands" />
        </div>
      </div>
      <section className="page-section" aria-labelledby="console-features">
        <h2 className="section-title" id="console-features">
          What the console does
        </h2>
        <ul className="plain-list">
          <li>Shows status: policy, destination and its visibility, busy agents, the lock, and the agent hooks.</li>
          <li>Previews what ship would decide for the current changes, with every finding and check, without staging anything.</li>
          <li>Ships with the same flags as the CLI, after you confirm, and shows the CLI&apos;s report.</li>
          <li>Edits the policy level, external review, and public-destination acknowledgement; enables and disables Shipgate.</li>
          <li>Lists recent commits, marks the ones Shipgate made and whether origin has them, and undoes the last ship.</li>
        </ul>
      </section>
    </div>
  );
}
