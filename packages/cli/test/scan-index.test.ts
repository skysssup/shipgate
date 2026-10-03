import { describe, expect, it } from 'vitest';
import type { GitRunner } from '../src/git.js';
import { loadStagedFilesForScan } from '../src/scan-index.js';

describe('staged path validation', () => {
  it('rejects paths missing from the index unless Git identifies a deletion', () => {
    const git: GitRunner = { run: () => '' };
    expect(() => loadStagedFilesForScan(git, ['missing.txt'])).toThrow(/missing from the index/);
  });

  it('allows a staged dotenv deletion without scanning its old content', () => {
    const git: GitRunner = { run(args) {
      if (args.includes('--diff-filter=D')) return '.env\0';
      return '';
    } };
    expect(loadStagedFilesForScan(git, ['.env'])).toEqual({
      files: [{ path: '.env', content: '', missing: true }],
      findings: [],
    });
  });
});
