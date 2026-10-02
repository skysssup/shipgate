import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShip } from '../src/commands/ship.js';
import { writeRepoConfig } from '../src/config.js';
import { createGit } from '../src/git.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('staged index preservation', () => {
  it.each(['secret', 'review', 'commit'] as const)('restores partial staging on %s block/hold', async (reason) => {
    const dir = mkdtempSync(join(tmpdir(), 'shipgate-index-'));
    dirs.push(dir);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    writeRepoConfig(dir, { enabled: true, level: 'balanced', agentReview: reason === 'review', publicOk: true });
    writeFileSync(join(dir, 'partial.txt'), 'base\n');
    writeFileSync(join(dir, 'deleted.txt'), 'base\n');
    git('add', '-A');
    git('commit', '-m', 'initial test state');
    writeFileSync(join(dir, 'partial.txt'), 'staged\n');
    git('add', 'partial.txt');
    writeFileSync(join(dir, 'partial.txt'), 'unstaged\n');
    git('rm', 'deleted.txt');
    writeFileSync(join(dir, 'new.txt'), 'untracked\n');
    if (reason === 'secret') writeFileSync(join(dir, '.env'), 'PRIVATE_VALUE=test\n');
    const before = readFileSync(join(dir, '.git', 'index'));
    const head = git('rev-parse', 'HEAD');
    const runner = createGit(dir);
    const injectedGit = { run(args: string[], opts?: { allowFail?: boolean }) {
      if (reason === 'commit' && args[0] === 'commit') throw new Error('simulated hook failure');
      return runner.run(args, opts);
    } };
    const result = await runShip({ cwd: dir, git: injectedGit, isPublic: false, review: async () => ({ decision: 'hold', reason: 'needs review', failOpen: false }) });
    expect(['block', 'hold']).toContain(result.action);
    expect(readFileSync(join(dir, '.git', 'index')).equals(before)).toBe(true);
    expect(git('show', ':partial.txt')).toBe('staged\n');
    expect(readFileSync(join(dir, 'partial.txt'), 'utf8')).toBe('unstaged\n');
    expect(git('rev-parse', 'HEAD')).toBe(head);
  });
});
