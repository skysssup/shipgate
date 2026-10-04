import * as Tabs from '@radix-ui/react-tabs';
import type { GateId, GateStatus, PlanAction } from '@shipgate/core/browser';
import {
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  Circle,
  CircleDashed,
  CirclePause,
  CircleMinus,
  Clock,
  Lightbulb,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode, type Ref } from 'react';
import { ACTION_LABEL, cliCommands, compareLevels, suggestions, whatHappens, type Evaluation, type SimState } from '../lib/model';
import { ActionBadge, ActionIcon, Button, CopyButton, cx, InlineCode } from './ui';

type StepStatus = GateStatus | 'run';

const STEP_TITLE: Record<GateId | 'commit' | 'push', string> = {
  'opt-in': 'Opt-in',
  busy: 'Busy agents',
  changes: 'Stage changes',
  credentials: 'Credential scan',
  destination: 'Push destination',
  review: 'External review',
  commit: 'Commit',
  push: 'Push',
};

const STATUS: Record<StepStatus, { label: string; icon: LucideIcon }> = {
  pass: { label: 'Passed', icon: Check },
  warn: { label: 'Warning', icon: TriangleAlert },
  block: { label: 'Blocked', icon: Ban },
  hold: { label: 'Held', icon: CirclePause },
  noop: { label: 'Nothing to do', icon: CircleMinus },
  skip: { label: 'Skipped', icon: CircleDashed },
  pending: { label: 'Runs next', icon: Clock },
  'not-reached': { label: 'Not reached', icon: Circle },
  run: { label: 'Would run', icon: ArrowRight },
};

function Notes({ items, kind }: { items: string[]; kind: 'reason' | 'warning' | 'advice' }) {
  if (!items.length) return null;
  const Icon = kind === 'reason' ? Ban : kind === 'warning' ? TriangleAlert : Lightbulb;
  const title = kind === 'reason' ? 'Why' : kind === 'warning' ? 'Warnings' : 'Recommendations';
  return (
    <div className={cx('notes', `notes-${kind}`)}>
      <h3 className="notes-title">{title}</h3>
      <ul>
        {items.map((text) => (
          <li key={text}>
            <Icon size={14} aria-hidden />
            <span>
              <InlineCode text={text} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Verdict({ evaluation, ref }: { evaluation: Evaluation; ref?: Ref<HTMLElement> }) {
  const { result, report } = evaluation;
  return (
    <section className={cx('verdict', `tone-${result.action}`)} aria-labelledby="decision-heading" id="decision" tabIndex={-1} ref={ref}>
      <div className="verdict-top">
        <h2 className="eyebrow" id="decision-heading">
          Decision
        </h2>
        <span className="exit-chip" title="Exit status of shipgate ship">
          exit {report.exitCode}
        </span>
      </div>
      <div className="verdict-main">
        <span className="verdict-icon">
          <ActionIcon action={result.action} size={22} />
        </span>
        <div className="verdict-text">
          <p className="verdict-label">{ACTION_LABEL[result.action]}</p>
          <p className="verdict-summary">{result.summary}</p>
        </div>
      </div>
      <Notes items={result.reasons} kind="reason" />
      <Notes items={result.warnings} kind="warning" />
      <Notes items={result.recommendations} kind="advice" />
      <dl className="verdict-facts">
        <div>
          <dt>What happens</dt>
          <dd>{whatHappens(report)}</dd>
        </div>
        {report.next && (
          <div>
            <dt>Next step</dt>
            <dd>{report.next}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function Checks({ evaluation, state }: { evaluation: Evaluation; state: SimState }) {
  const { result, report } = evaluation;
  const steps: Array<{ id: GateId | 'commit' | 'push'; status: StepStatus; detail: string }> = result.gates.map((g) => ({ id: g.gate, status: g.status, detail: g.detail }));
  steps.push(
    report.committed
      ? { id: 'commit', status: 'run', detail: `Commits “${report.subject}” with a Shipped-by: shipgate trailer.` }
      : { id: 'commit', status: 'not-reached', detail: 'Not reached: nothing is committed.' },
  );
  steps.push(
    !report.committed
      ? { id: 'push', status: 'not-reached', detail: 'Not reached: nothing is pushed.' }
      : state.remote === 'none'
        ? { id: 'push', status: 'skip', detail: 'No origin remote, so the commit stays local.' }
        : { id: 'push', status: 'run', detail: 'Pushes main to origin. If origin has new commits, Shipgate rebases once and retries.' },
  );
  return (
    <ol className="pipeline" aria-label="Checks in the order ship runs them">
      {steps.map((step) => {
        const { label, icon: Icon } = STATUS[step.status];
        return (
          <li key={step.id} className={cx('step', `status-${step.status}`)}>
            <span className="step-icon" aria-hidden>
              <Icon size={13} strokeWidth={2.5} />
            </span>
            <div className="step-body">
              <div className="step-head">
                <span className="step-title">{STEP_TITLE[step.id]}</span>
                <span className="step-status">{label}</span>
              </div>
              <p className="step-detail">
                <InlineCode text={step.detail} />
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function WhatIf({ state, current, onApply }: { state: SimState; current: PlanAction; onApply: (next: SimState) => void }) {
  const [expanded, setExpanded] = useState(false);
  const items = suggestions(state);
  const shown = expanded ? items : items.slice(0, 6);
  if (!items.length) return <p className="empty-line">No single change to these inputs changes the decision.</p>;
  return (
    <div className="whatif">
      <p className="tab-intro">
        Each line is one change to the inputs that turns <strong>{ACTION_LABEL[current]}</strong> into something else. Apply it to see why.
      </p>
      <ul className="whatif-list">
        {shown.map((item) => (
          <li key={item.id} className="whatif-item">
            <div className="whatif-text">
              <span className="whatif-label">{item.label}</span>
              {item.caution && (
                <span className="whatif-caution">
                  <TriangleAlert size={12} aria-hidden />
                  {item.caution}
                </span>
              )}
              <span className="whatif-result">
                <ActionBadge action={item.result.action} size="sm" />
                <span>
                  <InlineCode text={item.result.summary} />
                </span>
              </span>
            </div>
            <Button size="sm" onClick={() => onApply(item.next)} aria-label={`Apply: ${item.label}`}>
              Apply
            </Button>
          </li>
        ))}
      </ul>
      {items.length > 6 && (
        <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="more-btn">
          <ChevronDown size={14} aria-hidden className={cx('chevron', expanded && 'is-open')} />
          {expanded ? 'Show fewer' : `Show ${items.length - 6} more`}
        </Button>
      )}
    </div>
  );
}

function Levels({ state, onApply }: { state: SimState; onApply: (next: SimState) => void }) {
  return (
    <ul className="levels">
      {compareLevels(state).map(({ level, result }) => {
        const current = level === state.level;
        return (
          <li key={level} className={cx('level-row', current && 'is-current')}>
            <div className="level-row-head">
              <span className="mono level-name">{level}</span>
              {current && <span className="chip tone-accent">Current</span>}
              <ActionBadge action={result.action} size="sm" />
            </div>
            <p className="level-row-text">
              <InlineCode text={result.reasons[0] ?? result.warnings[0] ?? result.summary} />
            </p>
            {!current && (
              <Button size="sm" onClick={() => onApply({ ...state, level })} aria-label={`Use ${level}`}>
                Use {level}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function outputLine(line: string, index: number): ReactNode {
  if (line.startsWith('shipgate:')) {
    const [head, ...rest] = line.split(' — ');
    return (
      <span key={index} className="t-line t-headline">
        <span className="t-head">{head}</span>
        {rest.length > 0 && ` — ${rest.join(' — ')}`}
      </span>
    );
  }
  const label = line.slice(2, 11).trim();
  return (
    <span key={index} className="t-line t-detail">
      {'  '}
      <span className="t-label">{line.slice(2, 11)}</span>
      <span className={`t-${label}`}>{line.slice(11)}</span>
    </span>
  );
}

function TerminalPreview({ evaluation, state }: { evaluation: Evaluation; state: SimState }) {
  const commands = cliCommands(state);
  const { output, report } = evaluation;
  const transcript = [`$ ${commands.ship}`, ...output, '$ echo $?', String(report.exitCode)].join('\n');
  const reproduce = [commands.setup, commands.ship].filter(Boolean).join('\n');
  return (
    <div className="terminal-tab">
      <div className={cx('terminal', `tone-${report.action}`)}>
        <div className="terminal-bar">
          <span className="terminal-title">shipgate ship</span>
          <span className="terminal-meta">stderr · exit {report.exitCode}</span>
          <CopyButton text={transcript} label="Copy output" />
        </div>
        <pre className="terminal-body" tabIndex={0} aria-label="Simulated output of shipgate ship">
          <code>
            <span className="t-line t-command">
              <span className="t-prompt">$ </span>
              {commands.ship}
            </span>
            {output.map(outputLine)}
            <span className="t-line t-command">
              <span className="t-prompt">$ </span>echo $?
            </span>
            <span className="t-line">{report.exitCode}</span>
          </code>
        </pre>
      </div>
      <p className="tab-note">
        This is the CLI&apos;s own report text for these inputs. The commit id and repository name are placeholders, and a real push
        can still fail.
      </p>
      <div className="reproduce">
        <div className="reproduce-head">
          <h3 className="sub-title">Reproduce in a repository</h3>
          <CopyButton text={reproduce} label="Copy commands" />
        </div>
        <pre className="code-block">
          <code>{reproduce}</code>
        </pre>
      </div>
      <details className="disclosure">
        <summary>
          <ChevronDown size={14} aria-hidden className="chevron" />
          planRun input and result (JSON)
        </summary>
        <pre className="code-block json">
          <code>{JSON.stringify({ input: evaluation.input, result: evaluation.result }, null, 2)}</code>
        </pre>
      </details>
    </div>
  );
}

export function DecisionTabs({
  evaluation,
  state,
  onApply,
}: {
  evaluation: Evaluation;
  state: SimState;
  onApply: (next: SimState) => void;
}) {
  return (
    <Tabs.Root className="decision-tabs" defaultValue="checks">
      <Tabs.List className="tabs-list" aria-label="Decision details">
        <Tabs.Trigger className="tab" value="checks">
          Checks
        </Tabs.Trigger>
        <Tabs.Trigger className="tab" value="whatif">
          What-if
        </Tabs.Trigger>
        <Tabs.Trigger className="tab" value="levels">
          Levels
        </Tabs.Trigger>
        <Tabs.Trigger className="tab" value="terminal">
          Terminal
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content className="tab-panel" value="checks">
        <Checks evaluation={evaluation} state={state} />
      </Tabs.Content>
      <Tabs.Content className="tab-panel" value="whatif">
        <WhatIf state={state} current={evaluation.result.action} onApply={onApply} />
      </Tabs.Content>
      <Tabs.Content className="tab-panel" value="levels">
        <Levels state={state} onApply={onApply} />
      </Tabs.Content>
      <Tabs.Content className="tab-panel" value="terminal">
        <TerminalPreview evaluation={evaluation} state={state} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
