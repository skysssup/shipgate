import * as Popover from '@radix-ui/react-popover';
import { SAFETY_LEVELS, type RemoteVisibility, type SafetyLevel } from '@shipgate/core/browser';
import {
  Bot,
  CircleHelp,
  FileCheck2,
  FileDiff,
  Globe,
  Lock,
  Server,
  ShieldCheck,
  ShieldOff,
  Unplug,
  Users,
} from 'lucide-react';
import { useId } from 'react';
import { cliCommands, MAX_BUSY_AGENTS, type CauseTarget, type ReviewChoice, type SimState } from '../lib/model';
import type { SimAction } from '../lib/state';
import { CopyButton, cx, FactSelect, FlagToken, InlineCode, Section, TokenChoice, type Choice } from './ui';

export const LEVEL_TEXT: Record<SafetyLevel, string> = {
  strict: 'Blocks every credential finding, and a public or unverified GitHub destination until you pass `--public-ok`. Recommends `--confirm` and external review without enforcing them.',
  balanced: 'Blocks every credential finding and warns about a public or unverified GitHub destination. The default for `shipgate on`.',
  yolo: 'Blocks high-confidence findings only. Allows medium-confidence findings and public destinations with a warning.',
};

const FLAGS = {
  agent: 'External review: a model reviews the redacted staged diff before each commit. A review that cannot run holds the ship.',
  message: 'Use your own commit message. Also skips external review for this run.',
  force: 'Ship despite credential findings, with a warning. Meant for false positives.',
  publicOk: 'Acknowledge a public destination. It does not make the repository private.',
  confirm: 'Record that a person checked the change. Removes strict’s recommendation; never enforced.',
};

const REMOTES: Array<Choice<RemoteVisibility>> = [
  { value: 'private', label: 'Private GitHub', hint: 'github.com, private repository', icon: Lock },
  { value: 'public', label: 'Public GitHub', hint: 'github.com, public repository', icon: Globe },
  { value: 'unknown', label: 'GitHub, unknown', hint: 'gh is missing or signed out; treated as public', icon: CircleHelp },
  { value: 'other-host', label: 'Other Git host', hint: 'Visibility is not checked', icon: Server },
  { value: 'none', label: 'No origin', hint: 'No origin remote, so commits stay local', icon: Unplug },
];

const REVIEWS: Array<Choice<Exclude<ReviewChoice, 'off'>>> = [
  { value: 'approve', label: 'Approves', icon: Bot },
  { value: 'hold', label: 'Asks to hold', icon: Bot },
  { value: 'unavailable', label: 'Cannot run', hint: 'Missing key, timeout, or an unclear answer', icon: Bot },
];

const FACTS = {
  optIn: 'Whether shipgate on wrote an enabled .shipgate.json. Without one, ship stages nothing and exits 0.',
  origin: 'Where ship pushes. For github.com, Shipgate asks the GitHub CLI whether the repository is private.',
  agents: 'Busy markers that runners write while another agent works. ship holds while one names a live process.',
  tree: 'Whether the repository has changes. ship stages everything with git add --all.',
  reviewer: 'What the external reviewer answers for this change.',
};

function HelpPopover() {
  const rows: Array<[string, string]> = [
    ['--level', 'How strict the policy is. strict, balanced (default), or yolo.'],
    ['--agent', FLAGS.agent],
    ['-m', FLAGS.message],
    ['--force-secrets', FLAGS.force],
    ['--public-ok', FLAGS.publicOk],
    ['--confirm', FLAGS.confirm],
  ];
  return (
    <Popover.Root>
      <Popover.Trigger className="icon-btn" aria-label="What the flags and facts mean">
        <CircleHelp size={15} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover help-popover" align="end" sideOffset={6} collisionPadding={12}>
          <h2 className="popover-title">Flags</h2>
          <dl className="help-list">
            {rows.map(([term, text]) => (
              <div key={term}>
                <dt>
                  <code>{term}</code>
                </dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <h2 className="popover-title">Repository facts</h2>
          <dl className="help-list">
            {[
              ['Shipgate', FACTS.optIn],
              ['origin', FACTS.origin],
              ['Other agents', FACTS.agents],
              ['Working tree', FACTS.tree],
              ['Reviewer', `${FACTS.reviewer} Shown when --agent is on.`],
            ].map(([term, text]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <Popover.Arrow className="popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function RunSetup({
  state,
  dispatch,
  cause,
}: {
  state: SimState;
  dispatch: (action: SimAction) => void;
  cause: Partial<Record<CauseTarget, 'stop' | 'warn'>>;
}) {
  const set = (patch: Partial<SimState>) => dispatch({ type: 'set', patch });
  const commands = cliCommands(state);
  const levelHint = useId();
  const messageId = useId();
  const reviewId = useId();
  const reviewOn = state.review !== 'off';

  return (
    <Section
      title="Run setup"
      className="run-setup"
      meta="Toggle flags to change the run"
      actions={
        <>
          <HelpPopover />
          <CopyButton text={[commands.setup, commands.ship].filter(Boolean).join('\n')} label="Copy commands" />
        </>
      }
    >
      <div className="cmd-block">
        <div className={cx('cmd-line', !state.configPresent && 'is-off')}>
          <span className="cmd-prompt" aria-hidden>
            $
          </span>
          <span className="cmd-name">shipgate on</span>
          <span className="cmd-flag" aria-hidden>
            --level
          </span>
          <TokenChoice
            label="Policy level (--level)"
            value={state.level}
            describedBy={levelHint}
            onChange={(level) => set({ level })}
            options={SAFETY_LEVELS.map((level) => ({ value: level, label: level }))}
          />
          <FlagToken
            flag="--agent"
            pressed={reviewOn}
            description={FLAGS.agent}
            onChange={(on) => dispatch({ type: 'review', choice: on ? 'approve' : 'off' })}
          />
          {!state.configPresent && <span className="cmd-note">not run here</span>}
        </div>
        <div className="cmd-line">
          <span className="cmd-prompt" aria-hidden>
            $
          </span>
          <span className="cmd-name">shipgate ship</span>
          <FlagToken flag="-m" pressed={state.messageOn} description={FLAGS.message} onChange={(messageOn) => set({ messageOn })} />
          {state.messageOn && (
            <span className="cmd-string">
              <label className="sr-only" htmlFor={messageId}>
                Commit message
              </label>
              <span aria-hidden>&quot;</span>
              <input
                id={messageId}
                className="cmd-input"
                value={state.message}
                style={{ width: `calc(${Math.min(48, Math.max(4, state.message.length))}ch + 0.35rem)` }}
                spellCheck={false}
                onChange={(event) => set({ message: event.target.value })}
              />
              <span aria-hidden>&quot;</span>
            </span>
          )}
          <FlagToken
            flag="--force-secrets"
            pressed={state.forceSecrets}
            description={FLAGS.force}
            cause={state.forceSecrets && cause.findings === 'warn' ? 'warn' : undefined}
            onChange={(forceSecrets) => set({ forceSecrets })}
          />
          <FlagToken flag="--public-ok" pressed={state.publicOk} description={FLAGS.publicOk} onChange={(publicOk) => set({ publicOk })} />
          <FlagToken flag="--confirm" pressed={state.confirm} description={FLAGS.confirm} onChange={(confirm) => set({ confirm })} />
        </div>
      </div>

      <p className="level-caption" id={levelHint}>
        <span className="level-tag">{state.level}</span>
        <span>
          <InlineCode text={LEVEL_TEXT[state.level]} />
        </span>
      </p>

      <div className="facts" role="group" aria-label="Repository facts">
        <FactSelect
          id="fact-opt-in"
          label="Shipgate"
          value={state.configPresent ? 'on' : 'off'}
          description={FACTS.optIn}
          cause={cause['opt-in']}
          onChange={(value) => set({ configPresent: value === 'on' })}
          options={[
            { value: 'on', label: 'Enabled', icon: ShieldCheck },
            { value: 'off', label: 'Not enabled', icon: ShieldOff },
          ]}
        />
        <FactSelect id="fact-origin" label="origin" value={state.remote} description={FACTS.origin} cause={cause.origin} onChange={(remote) => set({ remote })} options={REMOTES} />
        <FactSelect
          id="fact-agents"
          label="Other agents"
          value={String(state.busyAgents)}
          description={FACTS.agents}
          cause={cause.agents}
          onChange={(value) => set({ busyAgents: Number(value) })}
          options={Array.from({ length: MAX_BUSY_AGENTS + 1 }, (_, n) => ({ value: String(n), label: n === 0 ? 'None busy' : `${n} busy`, icon: Users }))}
        />
        <FactSelect
          id="fact-tree"
          label="Working tree"
          value={state.hasChanges ? 'changes' : 'clean'}
          description={FACTS.tree}
          cause={cause.tree}
          onChange={(value) => set({ hasChanges: value === 'changes' })}
          options={[
            { value: 'changes', label: 'Has changes', icon: FileDiff },
            { value: 'clean', label: 'Clean', icon: FileCheck2 },
          ]}
        />
        {reviewOn && (
          <FactSelect
            id="fact-reviewer"
            label="Reviewer"
            value={state.review as Exclude<ReviewChoice, 'off'>}
            description={FACTS.reviewer}
            cause={cause.reviewer}
            onChange={(choice) => dispatch({ type: 'review', choice })}
            options={REVIEWS}
          />
        )}
      </div>

      {reviewOn && (state.review === 'hold' || state.review === 'unavailable' || state.messageOn) && (
        <div className="fact-extra">
          {(state.review === 'hold' || state.review === 'unavailable') && (
            <div className="inline-field">
              <label htmlFor={reviewId}>{state.review === 'hold' ? 'Reviewer’s reason' : 'Error'}</label>
              <input id={reviewId} className="input" value={state.reviewDetail} onChange={(event) => set({ reviewDetail: event.target.value })} />
            </div>
          )}
          {state.messageOn && (
            <p className="fact-note">
              <code>-m</code> is on, so this run skips external review.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
