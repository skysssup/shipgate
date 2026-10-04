import type { SecretFinding } from '@shipgate/core';

/** Indented, labeled detail line used by every command's human output. */
export function detail(label: string, text: string): string {
  return `  ${label.padEnd(9)}${text}`;
}

export function findingLine(finding: SecretFinding): string {
  const where = finding.line ? `${finding.path}:${finding.line}` : finding.path;
  const excerpt = finding.ruleId === 'dotenv-file' ? '' : `  ${finding.excerpt}`;
  return detail('finding', `${where}  ${finding.ruleId} (${finding.confidence})${excerpt}`);
}

export function writeLines(stream: NodeJS.WritableStream, lines: string[]): void {
  if (lines.length) stream.write(`${lines.join('\n')}\n`);
}
