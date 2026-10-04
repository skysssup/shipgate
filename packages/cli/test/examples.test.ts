import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkExpectations, EXAMPLES, README_PATH, renderExamples, runExample } from '../../../examples/examples.mjs';

type Shown = Array<{ command: string; output: string; exitCode: number }>;

describe.skipIf(process.platform === 'win32')('documented examples', () => {
  const results: Record<string, Shown> = {};

  it.each(EXAMPLES.map((e: { id: string; title: string }) => [e.title, e] as const))('%s', (_title, example) => {
    results[example.id] = runExample(example);
    checkExpectations(example, results[example.id]);
  });

  it('examples/README.md matches a fresh run', () => {
    expect(Object.keys(results)).toHaveLength(EXAMPLES.length);
    expect(readFileSync(README_PATH, 'utf8')).toBe(renderExamples(results));
  });

  it('every console block in the main README comes from the example catalog', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
    const catalog = readFileSync(README_PATH, 'utf8');
    const blocks = [...readme.matchAll(/```console\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(catalog).toContain(block);
  });
});
