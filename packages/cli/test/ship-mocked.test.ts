import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { runShip } from '../src/commands/ship.js';
import type { GitRunner } from '../src/git.js';
import { writeRepoConfig } from '../src/config.js';

const dirs: string[] = [];

function tmpRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'shipgate-cli-'));
  dirs.push(d);
  mkdirSync(join(d, '.git'), { recursive: true });
  return d;
}

afterEach(() => {
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function mockGit(calls: string[][], responses: Record<string, string>): GitRunner {
  return {
    run(args) {
      calls.push(args);
      const key = args.join(' ');
      if (key in responses) return responses[key];
      const paths = (responses['diff --cached --name-only --no-relative -z -- :/'] || '').split('\0').filter(Boolean);
      if (key === 'ls-files --stage --full-name -z -- :/') {
        return paths.map((path, i) => `100644 a${i.toString(16)} 0\t${path}\0`).join('');
      }
      if (args[0] === 'cat-file') {
        const path = paths[parseInt(args[2].slice(1), 16)];
        const content = readFileSync(join(responses['rev-parse --show-toplevel'], path), 'utf8');
        return args[1] === '-s' ? String(Buffer.byteLength(content)) : content;
      }
      // fuzzy prefixes
      for (const [k, v] of Object.entries(responses)) {
        if (key.startsWith(k)) return v;
      }
      if (
        args[0] === 'add' ||
        args[0] === 'commit' ||
        args[0] === 'push' ||
        args[0] === 'reset' ||
        args[0] === 'read-tree'
      ) {
        return '';
      }
      if (args[0] === 'write-tree') return 'treeoid';
      if (args[0] === 'diff' && args[1] === '--cached') return '';
      return '';
    },
  };
}

describe('runShip with mocked git', () => {
  it('no-ops when not enabled', async () => {
    const root = tmpRepo();
    const calls: string[][] = [];
    const git = mockGit(calls, {
      'rev-parse --show-toplevel': root,
      'rev-parse --git-dir': join(root, '.git'),
    });
    const result = await runShip({ cwd: root, git });
    expect(result.action).toBe('block');
    expect(result.exitCode).toBe(0);
  });

  it('ships clean staged files', async () => {
    const root = tmpRepo();
    writeRepoConfig(root, {
      enabled: true,
      level: 'balanced',
      agentReview: false,
      publicOk: true,
    });
    writeFileSync(join(root, 'hello.ts'), 'export const x = 1;\n');
    const calls: string[][] = [];
    const git = mockGit(calls, {
      'rev-parse --show-toplevel': root,
      'rev-parse --git-dir': join(root, '.git'),
      'status --porcelain': ' M hello.ts',
      'diff --cached --name-only --no-relative -z -- :/': 'hello.ts',
      'remote get-url origin': 'git@github.com:example/private.git',
      'rev-parse --abbrev-ref HEAD': 'main',
      'rev-parse --short HEAD': 'abc1234',
      'rev-parse HEAD': 'abc1234',
    });

    const result = await runShip({
      cwd: root,
      git,
      message: 'feat: hello',
      isPublic: false,
    });
    expect(result.action).toBe('ship');
    expect(result.exitCode).toBe(0);
    expect(calls.some((c) => c[0] === 'add')).toBe(true);
    expect(calls.some((c) => c[0] === 'commit')).toBe(true);
    expect(calls.some((c) => c[0] === 'push')).toBe(true);
  });

  it('blocks secrets and exits 0', async () => {
    const root = tmpRepo();
    writeRepoConfig(root, {
      enabled: true,
      level: 'balanced',
      agentReview: false,
      publicOk: true,
    });
    writeFileSync(
      join(root, '.env'),
      'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\n',
    );
    const calls: string[][] = [];
    const git = mockGit(calls, {
      'rev-parse --show-toplevel': root,
      'rev-parse --git-dir': join(root, '.git'),
      'status --porcelain': '?? .env',
      'diff --cached --name-only --no-relative -z -- :/': '.env',
      'remote get-url origin': '',
    });
    const result = await runShip({ cwd: root, git, isPublic: false });
    expect(result.action).toBe('block');
    expect(result.exitCode).toBe(0);
  });

  it('agent review fail-closed holds when gate unavailable', async () => {
    const root = tmpRepo();
    writeRepoConfig(root, {
      enabled: true,
      level: 'balanced',
      agentReview: true,
      publicOk: true,
    });
    writeFileSync(join(root, 'a.ts'), 'export {};\n');
    const calls: string[][] = [];
    const git = mockGit(calls, {
      'rev-parse --show-toplevel': root,
      'rev-parse --git-dir': join(root, '.git'),
      'status --porcelain': ' M a.ts',
      'diff --cached --name-only --no-relative -z -- :/': 'a.ts',
      'remote get-url origin': '',
      'rev-parse --abbrev-ref HEAD': 'main',
      'rev-parse --short HEAD': 'deadbee',
    });
    const review = vi.fn(async () => ({
      decision: 'hold' as const,
      reason: 'no API key — agent review fail-closed',
      failOpen: true,
    }));
    const result = await runShip({
      cwd: root,
      git,
      review,
      isPublic: false,
    });
    expect(result.action).toBe('hold');
    expect(result.exitCode).toBe(1);
    expect(review).toHaveBeenCalled();
    expect(calls.some((c) => c[0] === 'commit')).toBe(false);
  });

  it('holds when another live agent marker exists (check before mark)', async () => {
    const root = tmpRepo();
    writeRepoConfig(root, {
      enabled: true,
      level: 'yolo',
      agentReview: false,
      publicOk: true,
    });
    writeFileSync(join(root, 'a.ts'), 'export {};\n');
    const { markBusy, clearBusy, isPidAlive } = await import('@shipgate/core');
    const otherPid = process.ppid;
    if (!isPidAlive(otherPid) || otherPid === process.pid) {
      // Environment without a usable other pid — skip assertion soft
      return;
    }
    markBusy(join(root, '.git'), { pid: otherPid, label: 'other' });
    try {
      const git = mockGit([], {
        'rev-parse --show-toplevel': root,
        'rev-parse --git-dir': join(root, '.git'),
        'status --porcelain': ' M a.ts',
        'diff --cached --name-only --no-relative -z -- :/': 'a.ts',
      });
      const result = await runShip({ cwd: root, git, isPublic: false });
      expect(result.action).toBe('hold');
      expect(result.exitCode).toBe(0);
    } finally {
      clearBusy(join(root, '.git'), otherPid);
    }
  });

  it('ships locally when origin is missing', async () => {
    const root = tmpRepo();
    writeRepoConfig(root, {
      enabled: true,
      level: 'balanced',
      agentReview: false,
      publicOk: true,
    });
    writeFileSync(join(root, 'b.ts'), 'export {};\n');
    const calls: string[][] = [];
    const git = mockGit(calls, {
      'rev-parse --show-toplevel': root,
      'rev-parse --git-dir': join(root, '.git'),
      'status --porcelain': ' M b.ts',
      'diff --cached --name-only --no-relative -z -- :/': 'b.ts',
      'rev-parse --abbrev-ref HEAD': 'main',
      'rev-parse --short HEAD': 'loc1234',
    });
    const base = git.run.bind(git);
    git.run = (args, opts) => {
      if (args.join(' ') === 'remote get-url origin') {
        throw new Error('No such remote');
      }
      return base(args, opts);
    };
    const result = await runShip({
      cwd: root,
      git,
      message: 'feat: local',
      isPublic: false,
    });
    expect(result.action).toBe('ship');
    expect(result.reasons.some((r) => /local/i.test(r))).toBe(true);
    expect(calls.some((c) => c[0] === 'push')).toBe(false);
  });

  it('agent review hold unstages', async () => {
    const root = tmpRepo();
    writeRepoConfig(root, {
      enabled: true,
      level: 'balanced',
      agentReview: true,
      publicOk: true,
    });
    writeFileSync(join(root, 'c.ts'), 'export {};\n');
    const calls: string[][] = [];
    const git = mockGit(calls, {
      'rev-parse --show-toplevel': root,
      'rev-parse --git-dir': join(root, '.git'),
      'status --porcelain': ' M c.ts',
      'diff --cached --name-only --no-relative -z -- :/': 'c.ts',
    });
    const base = git.run.bind(git);
    git.run = (args, opts) => {
      if (args.join(' ') === 'remote get-url origin') {
        throw new Error('No such remote');
      }
      return base(args, opts);
    };
    const review = vi.fn(async () => ({
      decision: 'hold' as const,
      reason: 'WIP',
      failOpen: false,
    }));
    const result = await runShip({
      cwd: root,
      git,
      review,
      isPublic: false,
    });
    expect(result.action).toBe('hold');
    expect(calls.some((c) => c[0] === 'commit')).toBe(false);
  });


});
