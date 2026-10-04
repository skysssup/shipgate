import { hostname } from 'node:os';
import { join } from 'node:path';
import { realpathSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatStatus, gatherStatus } from '../src/commands/status.js';
import { addOrigin, cli, repo, tempDir } from './helpers.js';

describe('status', () => {
  it.each(['skysssup', undefined])('reports account %s in JSON and human output', (account) => {
    const r = repo({ account, level: 'strict', agentReview: true });
    const report = gatherStatus(r.dir);
    expect(report).toMatchObject({
      inGitRepo: true,
      branch: 'main',
      enabled: true,
      level: 'strict',
      agentReview: true,
      account: account ?? null,
      config: { state: 'ok' },
      destination: { visibility: 'none' },
      busyCount: 0,
      lock: { state: 'free' },
    });
    expect(realpathSync.native(report.root!)).toBe(realpathSync.native(r.dir));
    const text = formatStatus(report).join('\n');
    expect(text).toContain('enabled · strict · external review on');
    if (account) expect(text).toContain(`account  ${account} (display only)`);
    else expect(text).not.toContain('account');
  });

  it('explains invalid configuration instead of showing it as disabled', () => {
    const r = repo(null);
    r.write('.shipgate.json', '{"level":"loose"}');
    const report = gatherStatus(r.dir);
    expect(report.config).toMatchObject({ state: 'invalid', error: expect.stringContaining('"level" must be') });
    expect(formatStatus(report).join('\n')).toMatch(/config   INVALID: "level" must be/);
  });

  it('shows the destination, a stale lock, and the hook state', () => {
    const r = repo();
    addOrigin(r);
    writeFileSync(join(r.dir, '.git', 'shipgate-ship.lock'), JSON.stringify({ pid: 999999999, hostname: hostname(), startedAt: 0, command: 'ship', nonce: 'n' }));
    const report = gatherStatus(r.dir);
    expect(report.destination?.visibility).toBe('other-host');
    expect(report.lock).toMatchObject({ state: 'stale', pid: 999999999 });
    expect(formatStatus(report).join('\n')).toMatch(/lock     stale \(process gone; the next ship or undo removes it\)/);
    expect(report.hooks).toEqual(expect.objectContaining({ claude: false, cursor: false }));
  });

  it('writes human and JSON output to stdout only', () => {
    const r = repo();
    const human = cli(r.dir, ['status']);
    expect(human.status).toBe(0);
    expect(human.stderr).toBe('');
    expect(human.stdout).toMatch(/^shipgate \d+\.\d+\.\d+\n  repo /);
    const json = cli(r.dir, ['status', '--json']);
    expect(json.stderr).toBe('');
    expect(JSON.parse(json.stdout)).toMatchObject({ enabled: true, level: 'balanced', inGitRepo: true });
    const outside = cli(tempDir(), ['status', '--json']);
    expect(JSON.parse(outside.stdout)).toMatchObject({ inGitRepo: false, config: { state: 'not-applicable' } });
  });
});
