import { SAFETY_LEVELS, type RemoteVisibility, type SafetyLevel } from '@shipgate/core/browser';
import { GitBranch, SlidersHorizontal, Terminal } from 'lucide-react';
import { useId } from 'react';
import { MAX_BUSY_AGENTS, type ReviewChoice, type SimState } from '../lib/model';
import type { SimAction } from '../lib/state';
import { InfoTip, InlineCode, Panel, Segmented, SelectField, Switch, type Choice } from './ui';

export const LEVEL_TEXT: Record<SafetyLevel, string> = {
  strict: 'Blocks every credential finding, and blocks a public or unverified GitHub destination until you pass `--public-ok`. Recommends `--confirm` and external review without enforcing them.',
  balanced: 'Blocks every credential finding. Warns about a public or unverified GitHub destination. The default for `shipgate on`.',
  yolo: 'Blocks high-confidence findings only. Allows medium-confidence findings and public destinations with warnings.',
};

const REMOTES: Array<Choice<RemoteVisibility>> = [
  { value: 'private', label: 'Private GitHub repository' },
  { value: 'public', label: 'Public GitHub repository' },
  { value: 'unknown', label: 'GitHub, visibility unknown', hint: 'Treated as public' },
  { value: 'other-host', label: 'Another Git host', hint: 'Visibility not checked' },
  { value: 'none', label: 'No origin remote', hint: 'Commits stay local' },
];

const REVIEWS: Array<Choice<ReviewChoice>> = [
  { value: 'off', label: 'Off' },
  { value: 'approve', label: 'On: reviewer approves' },
  { value: 'hold', label: 'On: reviewer asks to hold' },
  { value: 'unavailable', label: 'On: review cannot run', hint: 'Missing key, timeout, or bad answer' },
];

export function LevelPicker({ state, dispatch }: { state: SimState; dispatch: (action: SimAction) => void }) {
  const hintId = useId();
  return (
    <Panel title="Policy level" icon={<SlidersHorizontal size={16} aria-hidden />} className="level-panel">
      <div className="level-body">
        <Segmented
          label="Policy level"
          className="level-segmented"
          describedBy={hintId}
          value={state.level}
          onChange={(level) => dispatch({ type: 'set', patch: { level } })}
          options={SAFETY_LEVELS.map((level) => ({ value: level, label: <span className="mono">{level}</span> }))}
        />
        <p className="level-text" id={hintId}>
          <InlineCode text={LEVEL_TEXT[state.level]} />
        </p>
      </div>
    </Panel>
  );
}

export function Settings({ state, dispatch }: { state: SimState; dispatch: (action: SimAction) => void }) {
  const set = (patch: Partial<SimState>) => dispatch({ type: 'set', patch });
  const messageId = useId();
  const reviewId = useId();
  return (
    <div className="settings-grid">
      <Panel title="Repository" icon={<GitBranch size={16} aria-hidden />} headingLevel={2}>
        <div className="fields">
          <Switch
            label="Shipgate enabled"
            description={<InlineCode text="`.shipgate.json` exists and is enabled." />}
            checked={state.configPresent}
            onChange={(configPresent) => set({ configPresent })}
            info={
              <InfoTip label="About opting in">
                <p>
                  <code>shipgate on</code> writes <code>.shipgate.json</code>. Without it, <code>ship</code> stages nothing and exits 0, so
                  global agent hooks do nothing in repositories that did not opt in.
                </p>
              </InfoTip>
            }
          />
          <Switch
            label="Uncommitted changes"
            description="Off means the working tree is clean."
            checked={state.hasChanges}
            onChange={(hasChanges) => set({ hasChanges })}
          />
          <SelectField
            label="origin"
            value={state.remote}
            options={REMOTES}
            onChange={(remote) => set({ remote })}
            info={
              <InfoTip label="About the push destination">
                <p>
                  For a github.com origin, Shipgate asks the GitHub CLI whether the repository is private. If <code>gh</code> is missing,
                  signed out, or offline, the visibility is unknown and treated as public. Other hosts are not checked.
                </p>
              </InfoTip>
            }
          />
          <div className="field">
            <span className="field-label-line">
              <span className="field-label" aria-hidden>
                Other agents busy
              </span>
              <InfoTip label="About busy markers">
                <p>
                  Runners can mark a worktree busy while an agent works (<code>markBusy</code> in <code>@shipgate/core</code>).{' '}
                  <code>ship</code> holds while a marker names a live process and stages nothing.
                </p>
              </InfoTip>
            </span>
            <Segmented
              label="Other agents busy"
              value={String(state.busyAgents)}
              onChange={(value) => set({ busyAgents: Number(value) })}
              options={Array.from({ length: MAX_BUSY_AGENTS + 1 }, (_, n) => ({ value: String(n), label: n === 0 ? 'None' : String(n) }))}
            />
          </div>

          <SelectField
            label="External review"
            value={state.review}
            options={REVIEWS}
            onChange={(choice) => dispatch({ type: 'review', choice })}
            info={
              <InfoTip label="About external review">
                <p>
                  <code>shipgate on --agent</code> sends file paths and the redacted staged diff to a model before each commit. If the
                  review cannot run, Shipgate holds and exits 1 instead of shipping unreviewed.
                </p>
              </InfoTip>
            }
          />
          {(state.review === 'hold' || state.review === 'unavailable') && (
            <div className="subfield">
              <label className="field-label" htmlFor={reviewId}>
                {state.review === 'hold' ? "Reviewer's reason" : 'Error'}
              </label>
              <input
                id={reviewId}
                className="input"
                value={state.reviewDetail}
                onChange={(event) => set({ reviewDetail: event.target.value })}
              />
            </div>
          )}
          {state.review !== 'off' && state.messageOn && (
            <p className="field-note">
              <code>-m</code> is on, so this run skips review.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Run flags" icon={<Terminal size={16} aria-hidden />}>
        <div className="fields">
          <Switch
            label={<code>--force-secrets</code>}
            description="Ship despite credential findings, with a warning."
            checked={state.forceSecrets}
            onChange={(forceSecrets) => set({ forceSecrets })}
          />
          <Switch
            label={<code>--public-ok</code>}
            description="Acknowledge a public destination. Does not make it private."
            checked={state.publicOk}
            onChange={(publicOk) => set({ publicOk })}
          />
          <Switch
            label={<code>--confirm</code>}
            description="Record that a person checked the change. Never enforced."
            checked={state.confirm}
            onChange={(confirm) => set({ confirm })}
          />
          <Switch
            label={<code>-m</code>}
            description="Use your own commit message. Also skips external review."
            checked={state.messageOn}
            onChange={(messageOn) => set({ messageOn })}
          >
            {state.messageOn && (
              <div className="subfield">
                <label className="field-label" htmlFor={messageId}>
                  Commit message
                </label>
                <input
                  id={messageId}
                  className="input"
                  value={state.message}
                  onChange={(event) => set({ message: event.target.value })}
                  spellCheck={false}
                />
                <span className="field-hint">The CLI scans this text for credentials too.</span>
              </div>
            )}
          </Switch>
        </div>
      </Panel>

    </div>
  );
}
