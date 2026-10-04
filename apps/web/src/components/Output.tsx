import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cliCommands, type Evaluation, type SimState } from '../lib/model';
import { CopyButton, cx, Section } from './ui';

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

/** The report `shipgate ship` prints for these inputs, from the CLI's own formatter. */
export function Output({ evaluation, state }: { evaluation: Evaluation; state: SimState }) {
  const { ship } = cliCommands(state);
  const { output, report } = evaluation;
  const transcript = [`$ ${ship}`, ...output, '$ echo $?', String(report.exitCode)].join('\n');
  return (
    <Section
      title="CLI output"
      className="output"
      meta="From the CLI's own formatter"
      actions={<CopyButton text={transcript} label="Copy output" />}
    >
      <pre className={cx('terminal', `tone-${report.action}`)} tabIndex={0} aria-label="Simulated output of shipgate ship">
        <code>
          <span className="t-line t-command">
            <span className="t-prompt">$ </span>
            {ship}
          </span>
          {output.map(outputLine)}
          <span className="t-line t-command">
            <span className="t-prompt">$ </span>echo $?
          </span>
          <span className="t-line t-exit">{report.exitCode}</span>
        </code>
      </pre>
      <div className="output-foot">
        <p>
          The commit id and repository are placeholders. A decision to ship is not a successful push: the push can still fail.
        </p>
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
    </Section>
  );
}
