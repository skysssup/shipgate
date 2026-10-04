export { detailLine as detail, findingLine } from '@shipgate/core';

export function writeLines(stream: NodeJS.WritableStream, lines: string[]): void {
  if (lines.length) stream.write(`${lines.join('\n')}\n`);
}
