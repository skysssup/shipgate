import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
      // fuzzy prefixes
      for (const [k, v] of Object.entries(responses)) {
        if (key.startsWith(k)) return v;
      }
      if (args[0] === 'add' || args[0] === 'commit' || args[0] === 'push' || args[0] === 'reset') {
        return '';
      }
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
      'diff --cached --name-only': 'hello.ts',
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
      'diff --cached --name-only': '.env',
      'remote get-url origin': '',
    });
    const result = await runShip({ cwd: root, git, isPublic: false });
    expect(result.action).toBe('block');
    expect(result.exitCode).toBe(0);
  });

  it('agent review fail-open ships', async () => {
    const root = tmpRepo();
    writeRepoConfig(root, {
      enabled: true,
      level: 'balanced',
      agentReview: true,
      publicOk: true,
    });
    writeFileSync(join(root, 'a.ts'), 'export {};\n');
    const git = mockGit([], {
      'rev-parse --show-toplevel': root,
      'rev-parse --git-dir': join(root, '.git'),
      'status --porcelain': ' M a.ts',
      'diff --cached --name-only': 'a.ts',
      'remote get-url origin': '',
      'rev-parse --abbrev-ref HEAD': 'main',
      'rev-parse --short HEAD': 'deadbee',
    });
    const review = vi.fn(async () => ({
      decision: 'ship' as const,
      reason: 'no API key — fail-open',
      failOpen: true,
    }));
    const result = await runShip({
      cwd: root,
      git,
      review,
      isPublic: false,
    });
    expect(result.action).toBe('ship');
    expect(review).toHaveBeenCalled();
  });
});
