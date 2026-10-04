import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { CopyButton } from '../components/ui';

function Command({ lines }: { lines: string[] }) {
  return (
    <div className="command">
      <pre className="code-block">
        <code>
          {lines.map((line) => (
            <span key={line} className="command-line">
              <span className="t-prompt" aria-hidden>
                ${' '}
              </span>
              {line}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
      <CopyButton text={lines.join('\n')} label="Copy commands" />
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="start-step">
      <span className="start-step-n" aria-hidden>
        {n}
      </span>
      <div className="start-step-body">
        <h2 className="section-title">{title}</h2>
        {children}
      </div>
    </li>
  );
}

const REPO = 'https://github.com/skysssup/shipgate';

export function StartView({ version }: { version: string }) {
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Get started</p>
        <h1 className="page-title" tabIndex={-1} id="page-title">
          Use Shipgate in a repository
        </h1>
        <p className="lead">
          The CLI does for real what this simulator only describes: it stages, scans, commits, and pushes. It needs Node.js 22.12 or
          later and Git, and runs on Linux, macOS, and Windows.
        </p>
      </header>

      <ol className="start-steps">
        <Step n={1} title="Install the CLI">
          <p>
            Shipgate is not on the npm registry. Install the CLI tarball from the GitHub release; it includes the policy library and
            this simulator.
          </p>
          <Command lines={[`npm install --global ${REPO}/releases/download/v${version}/shipgate-cli-${version}.tgz`, 'shipgate --version']} />
        </Step>
        <Step n={2} title="Opt in a repository">
          <p>
            <code>shipgate on</code> writes <code>.shipgate.json</code> with the <code>balanced</code> level. Pass{' '}
            <code>--level strict</code> or <code>--level yolo</code> to choose another, and <code>--agent</code> for external review.
          </p>
          <Command lines={['cd your-repo', 'shipgate on']} />
        </Step>
        <Step n={3} title="Ship a change">
          <p>Stages everything, scans it, applies the policy, then commits and pushes. The report goes to stderr.</p>
          <Command lines={['shipgate ship -m "Add greet helper"']} />
        </Step>
        <Step n={4} title="Run it after every agent turn">
          <p>
            Installs stop hooks for Claude Code and Cursor. They act only in repositories that opted in and print nothing elsewhere.
          </p>
          <Command lines={['shipgate setup']} />
        </Step>
        <Step n={5} title="Check and take back">
          <p>
            <code>status</code> shows the policy, destination, hooks, and lock. <code>undo</code> removes the last Shipgate commit and
            keeps its changes in the working tree.
          </p>
          <Command lines={['shipgate status', 'shipgate undo']} />
        </Step>
        <Step n={6} title="Open this simulator offline">
          <p>Serves the bundled simulator on 127.0.0.1.</p>
          <Command lines={['shipgate demo --serve']} />
        </Step>
      </ol>

      <section className="page-section" aria-labelledby="exit-heading">
        <h2 className="section-title" id="exit-heading">
          Exit status of <code>ship</code>
        </h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Exit</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  <code>0</code>
                </th>
                <td>
                  Shipped, committed without an origin, nothing to ship, not enabled, blocked by policy, or held because another agent
                  is busy, another Shipgate operation is running, or the reviewer asked to hold.
                </td>
              </tr>
              <tr>
                <th scope="row">
                  <code>1</code>
                </th>
                <td>
                  Invalid <code>.shipgate.json</code>, detached HEAD, a merge or rebase in progress, staging or scanning failures, review
                  unavailable, commit failures, and a commit that was made but not pushed.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="section-note">
          Exit 0 is not proof of a push. With <code>--json</code>, check <code>pushed</code>.
        </p>
      </section>

      <section className="page-section" aria-labelledby="links-heading">
        <h2 className="section-title" id="links-heading">
          Documentation
        </h2>
        <ul className="link-list">
          {[
            [`${REPO}#readme`, 'README', 'Everything ship does, configuration, undo, and hooks'],
            [`${REPO}/blob/main/examples/README.md`, 'Example catalog', 'Real CLI runs in disposable repositories'],
            [`${REPO}/releases`, 'Releases', 'CLI, core library, and simulator downloads with checksums'],
          ].map(([href, label, text]) => (
            <li key={href}>
              <a href={href} target="_blank" rel="noreferrer" className="doc-link">
                <span className="doc-link-label">
                  {label}
                  <ArrowUpRight size={14} aria-hidden />
                </span>
                <span className="doc-link-text">{text}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
