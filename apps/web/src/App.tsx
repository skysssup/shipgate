import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  DEMO_SCENARIOS,
  planRun,
  SAFETY_LEVELS,
  type DemoScenario,
  type RemoteVisibility,
  type RunPlanInput,
  type RunPlanResult,
  type SafetyLevel,
} from '@shipgate/core/browser';
import pkg from '../package.json';
import {
  cliCommands,
  consequence,
  DEFAULT_SCENARIO_ID,
  scenarioById,
  stateFromScenario,
  toRunPlanInput,
  VERDICT,
  type ReviewChoice,
  type SimState,
} from './model';

const REPO_URL = 'https://github.com/skysssup/shipgate';
const RELEASE_TARBALL = `${REPO_URL}/releases/download/v${pkg.version}/shipgate-cli-${pkg.version}.tgz`;

const LEVELS: Record<SafetyLevel, { title: string; text: string }> = {
  strict: { title: 'strict', text: 'Blocks any finding, and public or unverified GitHub destinations until acknowledged.' },
  balanced: { title: 'balanced (default)', text: 'Blocks any finding. Warns about public destinations.' },
  yolo: { title: 'yolo', text: 'Blocks high-confidence findings. Warns about medium ones and public destinations.' },
};

const DESTINATIONS: Array<{ value: RemoteVisibility; label: string }> = [
  { value: 'private', label: 'Private GitHub repository' },
  { value: 'public', label: 'Public GitHub repository' },
  { value: 'unknown', label: 'GitHub repository, visibility unknown (treated as public)' },
  { value: 'other-host', label: 'Another host (visibility not checked)' },
  { value: 'none', label: 'No origin remote (commit stays local)' },
];

const REVIEWS: Array<{ value: ReviewChoice; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'approve', label: 'On, and the reviewer approves' },
  { value: 'hold', label: 'On, and the reviewer asks to hold' },
  { value: 'unavailable', label: 'On, but unavailable (no key, timeout, or error)' },
];

const FLAGS: Array<{ key: 'forceSecrets' | 'publicOk' | 'confirm' | 'explicitMessage'; label: string; flag: string; help: string }> = [
  { key: 'forceSecrets', label: 'Override findings', flag: '--force-secrets', help: 'Commit despite credential findings, with a warning.' },
  { key: 'publicOk', label: 'Accept a public destination', flag: '--public-ok', help: 'An acknowledgement; the destination stays public.' },
  { key: 'confirm', label: 'Record a human check', flag: '--confirm', help: 'Recommended by strict; never prompted or required.' },
  { key: 'explicitMessage', label: 'Give a commit message', flag: '-m', help: 'Used as written. Skips external review.' },
];

function sameState(a: SimState, b: SimState): boolean {
  return (Object.keys(a) as Array<keyof SimState>).every((key) => a[key] === b[key]);
}

export function App() {
  const [state, setState] = useState<SimState>(() => stateFromScenario(DEFAULT_SCENARIO_ID));
  const input = useMemo(() => toRunPlanInput(state), [state]);
  const result = useMemo(() => planRun(input), [input]);
  const scenario = scenarioById(state.scenarioId);
  const baseline = stateFromScenario(state.scenarioId);
  const modified = !sameState(state, baseline);
  const update = <K extends keyof SimState>(key: K, value: SimState[K]) => setState((s) => ({ ...s, [key]: value }));

  return (
    <>
      <a className="skip-link" href="#simulator">Skip to the simulator</a>
      <header className="masthead">
        <p className="brand">
          Shipgate <span className="version">v{pkg.version}</span>
        </p>
        <nav aria-label="Project">
          <a href={REPO_URL}>Source</a>
          <a href={`${REPO_URL}#readme`}>Documentation</a>
          <a href={`${REPO_URL}/releases`}>Releases</a>
        </nav>
      </header>

      <main>
        <section className="intro" aria-labelledby="intro-title">
          <h1 id="intro-title">
            What would <code>shipgate ship</code> do here, and why?
          </h1>
          <p className="lede">
            Shipgate is a command-line tool for coding agents. At the end of a turn it stages every change in the
            repository, scans the staged files for credential patterns, applies your policy, then commits and pushes.
          </p>
          <p className="notice">
            <strong>This page is a simulator.</strong> It runs Shipgate&apos;s decision code in your browser on sample
            inputs. It does not read your files or touch any repository, and it never commits or pushes.
          </p>
        </section>

        <section id="simulator" className="simulator" aria-labelledby="examples-title" tabIndex={-1}>
          <fieldset className="examples">
            <legend id="examples-title">Pick an example</legend>
            <p className="hint">Choosing an example resets every input below to that example&apos;s values.</p>
            <div className="example-grid">
              {DEMO_SCENARIOS.map((s) => (
                <label key={s.id} className="choice example">
                  <input
                    type="radio"
                    name="example"
                    value={s.id}
                    checked={state.scenarioId === s.id}
                    onChange={() => setState(stateFromScenario(s.id))}
                  />
                  <span className="choice-body">
                    <span className="choice-title">{s.title}</span>
                    <span className="choice-text">{s.summary}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="workbench">
            <Decision result={result} state={state} input={input} scenario={scenario} />
            <div className="inputs">
              <div className="inputs-head">
                <h2 id="inputs-title">Change the inputs</h2>
                <button type="button" onClick={() => modified && setState(baseline)} aria-disabled={!modified}>
                  Reset to example
                </button>
              </div>
              <p className="hint">
                {modified ? `Changed from “${scenario.title}”. Reset restores its values.` : `Showing “${scenario.title}” as defined.`}
              </p>
              <p className="hint compact-decision">
                Decision now: <strong className={`tone-${result.action}`}>{VERDICT[result.action].label}</strong>{' '}
                <a href="#decision-title">Read the explanation</a>
              </p>

              <fieldset>
                <legend>Policy level</legend>
                <div className="level-grid">
                  {SAFETY_LEVELS.map((level) => (
                    <label key={level} className="choice level">
                      <input type="radio" name="level" value={level} checked={state.level === level} onChange={() => update('level', level)} />
                      <span className="choice-body">
                        <span className="choice-title mono">{LEVELS[level].title}</span>
                        <span className="choice-text">{LEVELS[level].text}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend>Repository facts</legend>
                <div className="option-grid">
                  <Check
                    checked={state.configPresent}
                    onChange={(v) => update('configPresent', v)}
                    label="Shipgate is enabled"
                    tech=".shipgate.json"
                    help="Without it, ship does nothing."
                  />
                  <Check
                    checked={state.hasChanges}
                    onChange={(v) => update('hasChanges', v)}
                    label="There are changes"
                    tech="git add --all"
                    help="Ship commits every change, tracked or not."
                  />
                  <Select
                    label="Other agents marked busy"
                    value={String(state.busyAgents)}
                    options={[['0', 'None'], ['1', '1 agent'], ['2', '2 agents']]}
                    onChange={(v) => update('busyAgents', Number(v))}
                  />
                  <Select
                    label="Push destination (origin)"
                    value={state.remote}
                    options={DESTINATIONS.map((d) => [d.value, d.label])}
                    onChange={(v) => update('remote', v as RemoteVisibility)}
                  />
                </div>
              </fieldset>

              <fieldset>
                <legend>Flags for this run</legend>
                <div className="option-grid">
                  {FLAGS.map((f) => (
                    <Check key={f.key} checked={state[f.key]} onChange={(v) => update(f.key, v)} label={f.label} tech={f.flag} help={f.help} />
                  ))}
                </div>
              </fieldset>

              <Select
                label="External review (shipgate on --agent)"
                value={state.review}
                options={REVIEWS.map((r) => [r.value, r.label])}
                onChange={(v) => update('review', v as ReviewChoice)}
              />
            </div>

          </div>
        </section>

        <section className="try" aria-labelledby="try-title">
          <h2 id="try-title">Run it in a repository</h2>
          <p>
            Shipgate needs Node.js 22.12 or later and Git. It is not published to the npm registry; install the release
            tarball:
          </p>
          <pre className="code" tabIndex={0}>
            <code>{`npm install --global ${RELEASE_TARBALL}
cd your-repo
shipgate on --level balanced
shipgate ship -m "Describe the change"`}</code>
          </pre>
          <p>
            <code>shipgate demo --serve</code> opens this simulator locally. The{' '}
            <a href={`${REPO_URL}#readme`}>README</a> covers hooks, undo, review, and limitations.
          </p>
        </section>
      </main>

      <footer className="footer">
        <span>Shipgate {pkg.version} · MIT license</span>
        <span>Pattern scanning can miss credentials and flag harmless text. It does not test whether code works.</span>
      </footer>
    </>
  );
}

function Check(props: { checked: boolean; onChange: (value: boolean) => void; label: string; tech: string; help: string }) {
  const helpId = useId();
  return (
    <label className="option">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} aria-describedby={helpId} />
      <span>
        {props.label} <span className="mono tech">{props.tech}</span>
        <span id={helpId} className="option-help">{props.help}</span>
      </span>
    </label>
  );
}

function Select(props: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="select-row">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="decision-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Decision(props: { result: RunPlanResult; state: SimState; input: RunPlanInput; scenario: DemoScenario }) {
  const { result, state, input, scenario } = props;
  const verdict = VERDICT[result.action];
  const outcome = consequence(result, input);
  const files = input.dirtyFiles;
  return (
    <section className="decision" aria-labelledby="decision-title">
      <h2 id="decision-title">Decision</h2>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {`Decision: ${verdict.label}. ${result.summary}`}
      </p>
      <div className={`verdict tone-${result.action}`}>
        <span className="verdict-label">{verdict.label}</span>
        <span className="verdict-meaning">{verdict.meaning}</span>
        <span className="verdict-level">
          Policy: <span className="mono">{state.level}</span>
        </span>
      </div>
      <p className="summary">{result.summary}</p>
      <p className="muted scenario-line">
        Example: {scenario.title}. {scenario.summary}
      </p>

      <Section title={result.action === 'ship' ? 'Blocking reasons' : 'Why'}>
        {result.reasons.length ? (
          <ul>{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        ) : (
          <p className="muted">{result.action === 'ship' ? 'None. No gate stops this run.' : 'Nothing needs to change.'}</p>
        )}
      </Section>

      {result.warnings.length > 0 && (
        <Section title="Warnings (shown even when shipping)">
          <ul className="warnings">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Section>
      )}

      {result.recommendations.length > 0 && (
        <Section title="Recommendations (not enforced)">
          <ul>{result.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
        </Section>
      )}

      <Section title="What the CLI would do">
        <ol>{outcome.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="muted">
          Exit status {outcome.exitStatus}.
          {result.action === 'ship' && ' A decision to ship does not mean the push will succeed.'}
        </p>
        {outcome.next && (
          <p>
            <strong>Next:</strong> {outcome.next}
          </p>
        )}
      </Section>

      <Section title={`Staged files in this example (${files.length})`}>
        {files.length ? (
          <ul className="files">
            {files.map((path) => {
              const findings = input.findings.filter((f) => f.path === path);
              return (
                <li key={path}>
                  <span className="mono path">{path}</span>
                  {findings.length ? (
                    findings.map((f) => (
                      <span key={f.ruleId} className={`finding finding-${f.confidence}`}>
                        {f.ruleId} · {f.confidence}
                        {f.line ? ` · line ${f.line}` : ''}
                        {f.ruleId !== 'dotenv-file' && <span className="mono"> {f.excerpt}</span>}
                      </span>
                    ))
                  ) : (
                    <span className="muted"> no findings</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">None. The working tree is clean in this scenario.</p>
        )}
      </Section>

      <Section title="Try the same settings">
        <pre className="code" tabIndex={0}>
          <code>{cliCommands(state).join('\n')}</code>
        </pre>
      </Section>

      <details>
        <summary>Debug: raw decision input and output (JSON)</summary>
        <pre className="code" tabIndex={0}>
          <code>{JSON.stringify({ input, result }, null, 2)}</code>
        </pre>
      </details>
    </section>
  );
}
