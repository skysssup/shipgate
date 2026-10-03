import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeRepoConfig } from '../src/config.js';
import { gatherStatus, printStatus } from '../src/commands/status.js';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe('configured account status', () => {
  it.each(['skysssup', undefined])('shows account %s in JSON and human output', (account) => {
    const root = mkdtempSync(join(tmpdir(), 'shipgate-status-'));
    dirs.push(root);
    execFileSync('git', ['init', '-b', 'main'], { cwd: root });
    vi.stubEnv('SHIPGATE_CLAUDE_SETTINGS', join(root, 'claude', 'settings.json'));
    vi.stubEnv('SHIPGATE_CURSOR_HOOKS', join(root, 'cursor', 'hooks.json'));
    writeRepoConfig(root, { enabled: true, level: 'balanced', agentReview: false, publicOk: false, account });
    const report = gatherStatus(root);
    expect(report.account).toBe(account ?? null);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    printStatus(report, true);
    expect(JSON.parse(String(stdout.mock.calls[0][0])).account).toBe(account ?? null);
    printStatus(report, false);
    expect(String(stderr.mock.calls[0][0])).toContain(`account: ${account ?? '—'}`);
  });
});
