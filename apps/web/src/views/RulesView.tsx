import { evaluatePolicy, SAFETY_LEVELS, SECRET_RULES, type RemoteVisibility, type SafetyLevel, type SecretFinding } from '@shipgate/core/browser';
import { FlaskConical } from 'lucide-react';
import { Button, cx, InlineCode } from '../components/ui';
import { PLACEHOLDER_EXAMPLES } from '../lib/model';

type Cell = { text: string; tone: 'block' | 'hold' | 'ship' | 'noop' };

function credentialCell(level: SafetyLevel, confidence: SecretFinding['confidence']): Cell {
  const finding: SecretFinding = { path: 'f', ruleId: 'rule', excerpt: '', confidence };
  const [gate] = evaluatePolicy({ level, findings: [finding], remote: 'none', flags: {}, reviewEnabled: false }).gates;
  return gate.status === 'block' ? { text: 'Blocks', tone: 'block' } : { text: 'Allows, with a warning', tone: 'hold' };
}

function destinationCell(level: SafetyLevel, remote: RemoteVisibility): Cell {
  const [, gate] = evaluatePolicy({ level, findings: [], remote, flags: {}, reviewEnabled: false }).gates;
  if (gate.status === 'block') return { text: 'Blocks until --public-ok', tone: 'block' };
  if (gate.status === 'warn') return { text: remote === 'other-host' ? 'Warns that it was not checked' : 'Warns until --public-ok', tone: 'hold' };
  return { text: 'No message', tone: 'noop' };
}

function recommendationCell(level: SafetyLevel): Cell {
  const { recommendations } = evaluatePolicy({ level, findings: [], remote: 'private', flags: {}, reviewEnabled: false });
  return recommendations.length ? { text: '--confirm and external review (not enforced)', tone: 'noop' } : { text: 'None', tone: 'noop' };
}

const POLICY_ROWS: Array<{ label: string; cell: (level: SafetyLevel) => Cell }> = [
  { label: 'High-confidence finding', cell: (level) => credentialCell(level, 'high') },
  { label: 'Medium-confidence finding', cell: (level) => credentialCell(level, 'medium') },
  { label: 'Public GitHub destination', cell: (level) => destinationCell(level, 'public') },
  { label: 'GitHub destination with unknown visibility', cell: (level) => destinationCell(level, 'unknown') },
  { label: 'Destination on another host', cell: (level) => destinationCell(level, 'other-host') },
  { label: 'Recommendations', cell: recommendationCell },
];

function CellText({ cell }: { cell: Cell }) {
  return <span className={cx('cell-tag', `tone-${cell.tone}`)}>{cell.text}</span>;
}

export function RulesView({ onTry }: { onTry: (ruleId: string) => void }) {
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Reference</p>
        <h1 className="page-title" tabIndex={-1} id="page-title">
          Credential rules and policy
        </h1>
        <p className="lead">
          <code>shipgate ship</code> scans every staged file with these patterns, then applies the repository&apos;s policy level.
          Confidence describes the pattern, not whether a credential is live: Shipgate never contacts the issuing service.
        </p>
      </header>

      <section className="page-section" aria-labelledby="rules-heading">
        <h2 className="section-title" id="rules-heading">
          Scanner rules
        </h2>
        <div className="table-wrap">
          <table className="table rules-table">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Confidence</th>
                <th scope="col">Matches</th>
                <th scope="col">
                  <span className="sr-only">Try it</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {SECRET_RULES.map((rule) => (
                <tr key={rule.id}>
                  <th scope="row">
                    <code className="rule-id">{rule.id}</code>
                  </th>
                  <td>
                    <span className="rule-cell">
                      <span className={cx('dot', `dot-${rule.confidence}`)} aria-hidden />
                      {rule.confidence}
                    </span>
                  </td>
                  <td className="rule-matches">
                    <InlineCode text={rule.matches} />
                  </td>
                  <td className="rule-try">
                    <Button size="sm" onClick={() => onTry(rule.id)} aria-label={`Try ${rule.id} in the simulator`}>
                      <FlaskConical size={13} aria-hidden />
                      Try
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="section-note">
          Each rule reports its first match per file, with the line number and a masked excerpt. <strong>Try</strong> adds a file with a
          synthetic value to the simulator.
        </p>
      </section>

      <section className="page-section" aria-labelledby="levels-heading">
        <h2 className="section-title" id="levels-heading">
          What each level does
        </h2>
        <div className="table-wrap">
          <table className="table policy-table">
            <thead>
              <tr>
                <th scope="col">Situation</th>
                {SAFETY_LEVELS.map((level) => (
                  <th scope="col" key={level}>
                    <code>{level}</code>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {POLICY_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {SAFETY_LEVELS.map((level) => (
                    <td key={level}>
                      <CellText cell={row.cell(level)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="plain-list">
          <li>
            Every level requires opt-in (<code>shipgate on</code>) and waits while another agent is marked busy.
          </li>
          <li>
            <code>--force-secrets</code> overrides credential blocks at every level, with a warning. It does not acknowledge a public
            destination.
          </li>
          <li>
            <code>--public-ok</code> acknowledges a public destination. It does not override credential findings.
          </li>
        </ul>
      </section>

      <section className="page-section" aria-labelledby="placeholders-heading">
        <h2 className="section-title" id="placeholders-heading">
          Skipped placeholders
        </h2>
        <p>Values that are plainly placeholders are not findings, including after a known prefix such as <code>sk-</code>:</p>
        <ul className="token-list">
          {PLACEHOLDER_EXAMPLES.map((value) => (
            <li key={value}>
              <code>{value}</code>
            </li>
          ))}
        </ul>
        <p className="section-note">
          Template files ending in <code>.example</code>, <code>.sample</code>, <code>.template</code>, or <code>.dist</code> are
          scanned like any other file; only the <code>dotenv-file</code> rule skips them. A deleted <code>.env</code> file is not a
          finding.
        </p>
      </section>
    </div>
  );
}
