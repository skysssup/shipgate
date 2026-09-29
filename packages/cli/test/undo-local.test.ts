import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { runUndo } from '../src/commands/undo.js';
import { writeRepoConfig } from '../src/config.js';
import { runShip } from '../src/commands/ship.js';
import { createGit } from '../src/git.js';

const dirs: string[] = [];

function realRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'shipgate-undo-'));
  dirs.push(d);
  execFileSync('git', ['init', '-b', 'main'], { cwd: d });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: d });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: d });
  writeFileSync(join(d, 'a.txt'), 'a\n');
  execFileSync('git', ['add', '.'], { cwd: d });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: d });
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

describe('undo without origin', () => {
  it('undoes a local shipgate commit', async () => {
    const root = realRepo();
    writeRepoConfig(root, {
      enabled: true,
      level: 'balanced',
      agentReview: false,
      publicOk: true,
    });
    writeFileSync(join(root, 'feat.ts'), 'export {};\n');
    const ship = await runShip({
      cwd: root,
      message: 'feat: local',
      isPublic: false,
    });
    expect(ship.action).toBe('ship');

    const before = createGit(root).run(['rev-parse', 'HEAD']);
    const undo = runUndo({ cwd: root });
    expect(undo.undone).toBe(true);
    const after = createGit(root).run(['rev-parse', 'HEAD']);
    expect(after).not.toBe(before);
  });

  it('refuses non-shipgate HEAD', () => {
    const root = realRepo();
    const undo = runUndo({ cwd: root });
    expect(undo.undone).toBe(false);
    expect(undo.reason).toMatch(/not a shipgate commit/);
  });
});
