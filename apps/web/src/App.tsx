import { useMemo, useState } from 'react';
import {
  DEMO_SCENARIOS,
  planRun,
  type RunPlanInput,
  type SafetyLevel,
} from '@shipgate/core/browser';

const LEVEL_COPY: Record<
  SafetyLevel,
  { title: string; blurb: string }
> = {
  strict: {
    title: 'strict',
    blurb: 'Block secrets + public remotes; require clean policy; gates recommended.',
  },
  balanced: {
    title: 'balanced',
    blurb: 'Block secrets, warn on public remotes, optional LLM review gate.',
  },
  yolo: {
    title: 'yolo',
    blurb: 'Still blocks high-confidence secrets unless --force-secrets.',
  },
};

const COMMANDS = [
  ['setup', 'Install Claude / Cursor stop hooks (idempotent merge).'],
  ['on', 'Opt-in per repo; set --level, --agent, --public-ok.'],
  ['ship', 'add -A → scan → policy → commit → push (rebase-once).'],
  ['undo', 'Rewind last Shipped-by: shipgate commit (force-with-lease).'],
  ['status', 'JSON + human: level, hooks, busy agents.'],
  ['demo', 'Open this simulator or serve the local build.'],
];

export function App() {
  const [level, setLevel] = useState<SafetyLevel>('balanced');
  const [scenarioId, setScenarioId] = useState(DEMO_SCENARIOS[4].id);
  const [forceSecrets, setForceSecrets] = useState(false);
  const [publicOk, setPublicOk] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const scenario = DEMO_SCENARIOS.find((s) => s.id === scenarioId) ?? DEMO_SCENARIOS[0];

  const input: RunPlanInput = useMemo(() => {
    return {
      ...scenario.input,
      level,
      flags: {
        ...scenario.input.flags,
        forceSecrets,
        publicOk: publicOk || Boolean(scenario.input.flags.publicOk),
        confirm,
      },
      // publicOk acknowledges a public remote; it must not rewrite the fact.
      isPublicRemote: scenario.input.isPublicRemote,
    };
  }, [scenario, level, forceSecrets, publicOk, confirm]);

  const result = useMemo(() => planRun(input), [input]);

  return (
    <div className="app">
      <a className="skip-link" href="#simulator">Skip to simulator</a>
      <header className="hero">
        <div>
          <div className="badge">Shipgate 1.0.1 · policy simulator</div>
          <h1>Shipgate policy simulator</h1>
          <p className="lede">Blocked ships keep your previously staged files; they do not wipe the index.</p>
          <p className="lead">
            This page runs planRun in the browser. It does not touch your git repo.
          </p>
        </div>
        <div className="hero-actions">
          <a
            className="btn btn-primary"
            href="https://github.com/skysssup/shipgate"
          >
            GitHub
          </a>
          <a className="btn" href="https://www.npmjs.com/package/@shipgate/cli">
            npm
          </a>
        </div>
      </header>

      <section id="simulator" className="panel" aria-labelledby="matrix-title">
        <h2 id="matrix-title">Safety matrix</h2>
        <div className="grid-2">
          <div>
            <p className="matrix-meta" style={{ marginTop: 0 }}>
              Safety level
            </p>
            <div
              className="levels"
              role="group"
              aria-label="Safety level"
            >
              {(Object.keys(LEVEL_COPY) as SafetyLevel[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  className="level"
                  aria-pressed={level === l}
                  onClick={() => setLevel(l)}
                >
                  <strong>{LEVEL_COPY[l].title}</strong>
                  <span>{LEVEL_COPY[l].blurb}</span>
                </button>
              ))}
            </div>

            <p className="matrix-meta" style={{ marginTop: '1.1rem' }}>
              Inject scenario
            </p>
            <div
              className="scenarios"
              role="group"
              aria-label="Diff scenario"
            >
              {DEMO_SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="scenario"
                  aria-pressed={scenarioId === s.id}
                  onClick={() => setScenarioId(s.id)}
                >
                  <div className="label">{s.label}</div>
                  <div className="desc">{s.description}</div>
                </button>
              ))}
            </div>

            <p className="matrix-meta" style={{ marginTop: '1.1rem' }}>
              Flags
            </p>
            <div className="flags">
              <label className="flag">
                <input
                  type="checkbox"
                  checked={forceSecrets}
                  onChange={(e) => setForceSecrets(e.target.checked)}
                />
                --force-secrets
              </label>
              <label className="flag">
                <input
                  type="checkbox"
                  checked={publicOk}
                  onChange={(e) => setPublicOk(e.target.checked)}
                />
                --public-ok
              </label>
              <label className="flag">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                --confirm
              </label>
            </div>
          </div>

          <div className="result" aria-live="polite">
            <div>
              <p className="matrix-meta" style={{ marginTop: 0 }}>
                RunPlan result
              </p>
              <div className={`action-pill ${result.action}`} role="status">
                action: {result.action.toUpperCase()}
              </div>
            </div>
            <div>
              <p className="matrix-meta">reasons</p>
              <ul className="reasons">
                {result.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="matrix-meta">input snapshot</p>
              <pre
                style={{
                  margin: 0,
                  padding: '0.75rem',
                  background: 'var(--bg)',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  fontFamily: 'var(--mono)',
                  fontSize: '0.75rem',
                  overflow: 'auto',
                  maxHeight: 220,
                }}
              >
                {JSON.stringify(
                  {
                    level: input.level,
                    dirtyFiles: input.dirtyFiles,
                    findings: input.findings.map((f) => f.ruleId),
                    isPublicRemote: input.isPublicRemote,
                    busyAgents: input.busyAgents,
                    flags: input.flags,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="cmd-title">
        <h2 id="cmd-title">Commands</h2>
        <div className="commands">
          {COMMANDS.map(([cmd, desc]) => (
            <div className="cmd" key={cmd}>
              <code>shipgate {cmd}</code>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>MIT · Node ≥ 18 · TypeScript monorepo</span>
        <span>
          Live demo ·{' '}
          <a href="https://skysssup.github.io/shipgate/">
            skysssup.github.io/shipgate
          </a>
        </span>
      </footer>
    </div>
  );
}
