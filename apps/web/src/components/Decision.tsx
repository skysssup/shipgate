import type { GateId, GateStatus, PlanAction } from '@shipgate/core/browser';
import {
  ArrowRight,
  ArrowUpRight,
  Ban,
  Check,
  ChevronDown,
  Circle,
  CircleDashed,
  CircleMinus,
  CirclePause,
  Clock,
  Lightbulb,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState, type Ref } from 'react';
import {
  ACTION_LABEL,
  compareLevels,
  reasonTargets,
  suggestions,
  whatHappens,
  type CauseTarget,
  type Evaluation,
  type SimState,
} from '../lib/model';
import { ActionBadge, ActionIcon, Button, cx, InlineCode, Section } from './ui';

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

const CAUSE_LABEL: Record<CauseTarget, string> = {
  'opt-in': 'Show the opt-in setting',
  agents: 'Show the busy agents setting',
  tree: 'Show the working tree setting',
  findings: 'Show the findings',
  origin: 'Show the origin setting',
  reviewer: 'Show the reviewer setting',
};

export function Verdict({
  evaluation,
  onShowCause,
  ref,
}: {
  evaluation: Evaluation;
  onShowCause: (target: CauseTarget) => void;
  ref?: Ref<HTMLElement>;
}) {
  const { result, report } = evaluation;
  const targets = reasonTargets(result);
  return (
    <section className={cx('verdict', `tone-${result.action}`)} aria-labelledby="decision-heading" id="decision" tabIndex={-1} ref={ref}>
      <div className="verdict-band">
        <div className="verdict-top">
          <h2 className="verdict-kicker" id="decision-heading">
            Decision
          </h2>
          <span className="exit-chip" title="Exit status of shipgate ship">
            exit {report.exitCode}
          </span>
        </div>
        <div className="verdict-main">
          <span className="verdict-icon" key={result.action}>
            <ActionIcon action={result.action} size={20} />
          </span>
          <div className="verdict-text">
            <p className="verdict-label">{ACTION_LABEL[result.action]}</p>
            <p className="verdict-summary">{result.summary}</p>
          </div>
        </div>
        <p className="verdict-outcome">{whatHappens(report)}</p>
      </div>

      {(result.reasons.length > 0 || result.warnings.length > 0 || result.recommendations.length > 0 || report.next) && (
        <div className="verdict-body">
          {result.reasons.length > 0 && (
            <div className="notes notes-reason">
              <h3 className="notes-title">Why</h3>
              <ul>
                {result.reasons.map((text, i) => (
                  <li key={text}>
                    <Ban size={14} aria-hidden />
                    <span className="note-text">
                      <InlineCode text={text} />
                      {targets[i] && (
                        <button type="button" className="cause-link" onClick={() => onShowCause(targets[i])}>
                          {CAUSE_LABEL[targets[i]]}
                          <ArrowUpRight size={12} aria-hidden />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="notes notes-warning">
              <h3 className="notes-title">Warnings</h3>
              <ul>
                {result.warnings.map((text) => (
                  <li key={text}>
                    <TriangleAlert size={14} aria-hidden />
                    <span className="note-text">
                      <InlineCode text={text} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.recommendations.length > 0 && (
            <div className="notes notes-advice">
              <h3 className="notes-title">Recommendations</h3>
              <ul>
                {result.recommendations.map((text) => (
                  <li key={text}>
                    <Lightbulb size={14} aria-hidden />
                    <span className="note-text">
                      <InlineCode text={text} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.next && (
            <div className="notes notes-next">
              <h3 className="notes-title">Next step</h3>
              <p className="note-text">{report.next}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function Fixes({ state, action, onApply }: { state: SimState; action: PlanAction; onApply: (next: SimState, message: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const items = suggestions(state);
  const shown = expanded ? items : items.slice(0, 4);
  return (
    <Section
      title={action === 'ship' ? 'What would stop it' : 'Change the outcome'}
      className="fixes"
      meta={items.length ? `${items.length} single ${items.length === 1 ? 'change' : 'changes'}` : undefined}
    >
      {items.length ? (
        <>
          <ul className="fix-list">
            {shown.map((item) => (
              <li key={item.id} className="fix">
                <div className="fix-text">
                  <span className="fix-label">{item.label}</span>
                  <span className="fix-result">
                    <ActionBadge action={item.result.action} />
                    <span className="fix-summary">
                      <InlineCode text={item.result.summary} />
                    </span>
                  </span>
                  {item.caution && (
                    <span className="fix-caution">
                      <TriangleAlert size={12} aria-hidden />
                      {item.caution}
                    </span>
                  )}
                </div>
                <Button size="sm" onClick={() => onApply(item.next, `Applied: ${item.label}.`)} aria-label={`Apply: ${item.label}`}>
                  Apply
                </Button>
              </li>
            ))}
          </ul>
          {items.length > 4 && (
            <button type="button" className="more-btn" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
              <ChevronDown size={14} aria-hidden className={cx('chevron', expanded && 'is-open')} />
              {expanded ? 'Show fewer' : `Show ${items.length - 4} more`}
            </button>
          )}
        </>
      ) : (
        <p className="empty-line">No single change to these inputs changes the decision.</p>
      )}
    </Section>
  );
}

export function Checks({ evaluation, state }: { evaluation: Evaluation; state: SimState }) {
  const { result, report } = evaluation;
  const steps: Array<{ id: GateId | 'commit' | 'push'; status: StepStatus; detail: string }> = result.gates.map((g) => ({
    id: g.gate,
    status: g.status,
    detail: g.detail,
  }));
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
  const passed = steps.filter((s) => s.status === 'pass').length;
  const reached = steps.filter((s) => s.status !== 'not-reached');
  const unreached = steps.filter((s) => s.status === 'not-reached');
  return (
    <Section title="Checks" className="checks" meta={`${passed} of ${result.gates.length} passed`}>
      <ol className="pipeline" aria-label="Checks in the order ship runs them">
        {reached.map((step) => {
          const { label, icon: Icon } = STATUS[step.status];
          return (
            <li key={step.id} className={cx('step', `status-${step.status}`)}>
              <span className="step-icon" aria-hidden>
                <Icon size={12} strokeWidth={2.75} />
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
        {unreached.length > 0 && (
          <li className="step status-not-reached">
            <span className="step-icon" aria-hidden>
              <Circle size={12} strokeWidth={2.75} />
            </span>
            <div className="step-body">
              <div className="step-head">
                <span className="step-title">
                  {unreached.length} {unreached.length === 1 ? 'step' : 'steps'} not reached
                </span>
                <span className="step-status">Not reached</span>
              </div>
              <p className="step-skipped-list">{unreached.map((s) => STEP_TITLE[s.id]).join(' · ')}</p>
            </div>
          </li>
        )}
      </ol>
    </Section>
  );
}

export function Levels({ state, onApply }: { state: SimState; onApply: (next: SimState, message: string) => void }) {
  return (
    <Section title="At each level" className="levels">
      <ul className="level-list">
        {compareLevels(state).map(({ level, result }) => {
          const current = level === state.level;
          return (
            <li key={level} className={cx('level-row', current && 'is-current')}>
              <span className="level-name mono">{level}</span>
              <ActionBadge action={result.action} />
              <span className="level-text">
                <InlineCode text={result.reasons[0] ?? result.warnings[0] ?? result.summary} />
              </span>
              {current ? (
                <span className="level-current">Current</span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => onApply({ ...state, level }, `Switched to ${level}.`)} aria-label={`Use ${level}`}>
                  Use
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
