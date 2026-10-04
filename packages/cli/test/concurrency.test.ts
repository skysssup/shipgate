import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIN, cli, repo, tempDir } from './helpers.js';

function runAsync(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const done = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  return { child, done };
}

describe('concurrent and interrupted runs', () => {
  it('lets exactly one of two simultaneous ships commit', async () => {
    const r = repo();
    for (let i = 0; i < 200; i += 1) r.write(`src/file${i}.ts`, `export const v${i} = ${i};\n`);
    const before = Number(r.git('rev-list', '--count', 'HEAD'));
    const [a, b] = await Promise.all([
      runAsync(r.dir, ['ship', '--json', '-m', 'first']).done,
      runAsync(r.dir, ['ship', '--json', '-m', 'second']).done,
    ]);
    const outcomes = [JSON.parse(a.stdout).outcome, JSON.parse(b.stdout).outcome].sort();
    expect(outcomes.filter((o) => o === 'committed')).toHaveLength(1);
    expect(['locked', 'nothing-to-ship']).toContain(outcomes.find((o) => o !== 'committed'));
    expect(Number(r.git('rev-list', '--count', 'HEAD'))).toBe(before + 1);
    expect(r.git('status', '--porcelain')).toBe('');
    expect(existsSync(join(r.dir, '.git', 'shipgate-ship.lock'))).toBe(false);
  });

  it('recovers after a ship process is killed while waiting for review', async () => {
    let request!: () => void;
    const requested = new Promise<void>((resolve) => (request = resolve));
    const server = createServer(() => request());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const home = tempDir('shipgate-home-');
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, 'config.json'), JSON.stringify({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
      const env = { SHIPGATE_HOME: home, OPENROUTER_API_KEY: 'synthetic-test-key' };
      const r = repo({ agentReview: true });
      r.write('feature.txt', 'work in progress\n');
      const head = r.head();

      const { child, done } = runAsync(r.dir, ['ship'], env);
      await requested;
      expect(existsSync(join(r.dir, '.git', 'shipgate-ship.lock'))).toBe(true);
      child.kill('SIGKILL');
      await done;

      expect(r.head()).toBe(head);
      expect(r.read('feature.txt')).toBe('work in progress\n');
      expect(r.git('diff', '--cached', '--name-only')).toBe('feature.txt');
      expect(existsSync(join(r.dir, '.git', 'shipgate-ship.lock'))).toBe(true);
      expect(JSON.parse(cli(r.dir, ['status', '--json'], { env }).stdout).lock.state).toBe('stale');

      expect(cli(r.dir, ['on', '--agent=false'], { env }).status).toBe(0);
      const rerun = cli(r.dir, ['ship', '-m', 'after interruption'], { env });
      expect(rerun.status).toBe(0);
      expect(rerun.stderr).toMatch(/note     Removed a stale lock from shipgate ship \(pid \d+/);
      expect(r.git('log', '-1', '--format=%s')).toBe('after interruption');
      expect(existsSync(join(r.dir, '.git', 'shipgate-ship.lock'))).toBe(false);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
