import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markBusy } from '@shipgate/core';
import { formatPreview, runPreview } from '../src/commands/preview.js';
import { runShip } from '../src/commands/ship.js';
import { addOrigin, cli, repo, SYNTHETIC, tempDir } from './helpers.js';

const privateRemote = () => ({ visibility: 'private' as const, description: 'github.com/acme/app (private)' });
const publicRemote = () => ({ visibility: 'public' as const, description: 'github.com/acme/app (public)' });

/** Everything about the repository that a preview must leave alone. */
function snapshot(r: ReturnType<typeof repo>) {
  return { head: r.head(), index: r.index(), status: r.git('status', '--porcelain=v1', '-uall') };
}

describe('preview', () => {
  it('scans staged, unstaged, and untracked changes without touching the index', () => {
    const r = repo();
    r.write('staged.txt', 'staged\n');
    r.git('add', 'staged.txt');
    r.write('README.md', 'changed, not staged\n');
    r.write('.env', `OPENAI_API_KEY=${SYNTHETIC.openai}\n`);
    const before = snapshot(r);

    const result = runPreview({ cwd: r.dir });

    expect(snapshot(r)).toEqual(before);
    expect(result.state).toBe('ready');
    expect(result.plan).toMatchObject({ action: 'block', code: 'credentials' });
    expect(result.changes).toEqual([
      { path: '.env', status: 'A' },
      { path: 'README.md', status: 'M' },
      { path: 'staged.txt', status: 'A' },
    ]);
    expect(result.findings.map((f) => `${f.path}:${f.ruleId}`).sort()).toEqual(['.env:dotenv-file', '.env:openai-key']);
    expect(result.next).toContain('--force-secrets');
  });

  it('keeps partial staging exactly as it was', () => {
    const r = repo();
    r.write('README.md', 'one\ntwo\n');
    r.git('add', 'README.md');
    r.write('README.md', 'one\ntwo\nthree\n');
    const before = r.git('diff', '--cached');
    runPreview({ cwd: r.dir });
    expect(r.git('diff', '--cached')).toBe(before);
  });

  it('agrees with what ship then does', async () => {
    const r = repo();
    addOrigin(r);
    r.write('src/greet.ts', 'export const greet = () => "hi";\n');
    const preview = runPreview({ cwd: r.dir, message: 'Add greet', classifyRemote: privateRemote });
    expect(preview.plan).toMatchObject({ action: 'ship', code: 'clear' });
    expect(preview.subject).toBe('Add greet');
    const shipped = await runShip({ cwd: r.dir, message: 'Add greet', classifyRemote: privateRemote });
    expect(shipped.outcome).toBe('pushed');
    expect(runPreview({ cwd: r.dir }).plan).toMatchObject({ action: 'noop', code: 'nothing-to-ship' });
  });

  it('applies run flags and the configured level', () => {
    const strict = repo({ level: 'strict' });
    strict.write('a.txt', 'a\n');
    expect(runPreview({ cwd: strict.dir, classifyRemote: publicRemote }).plan?.code).toBe('public-destination');
    expect(runPreview({ cwd: strict.dir, classifyRemote: publicRemote, publicOk: true }).plan?.action).toBe('ship');

    const balanced = repo();
    balanced.write('fixture.txt', `token: ${SYNTHETIC.jwt}\n`);
    expect(runPreview({ cwd: balanced.dir }).plan?.action).toBe('block');
    expect(runPreview({ cwd: balanced.dir, forceSecrets: true }).plan?.action).toBe('ship');
  });

  it('scans the -m and --prompt text', () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    const result = runPreview({ cwd: r.dir, prompt: `use ${SYNTHETIC.github}` });
    expect(result.findings).toEqual([expect.objectContaining({ path: '--prompt', ruleId: 'github-token' })]);
    expect(result.plan?.action).toBe('block');
  });

  it('reports opt-in, invalid configuration, busy agents, and unsafe states', () => {
    const off = repo(null);
    off.write('a.txt', 'a\n');
    expect(runPreview({ cwd: off.dir })).toMatchObject({ state: 'not-enabled', plan: { code: 'not-enabled' } });

    const invalid = repo(null);
    invalid.write('.shipgate.json', '{"level":"loose"}');
    expect(runPreview({ cwd: invalid.dir })).toMatchObject({ state: 'invalid-config', problems: [expect.stringContaining('"level"')] });

    const busy = repo();
    busy.write('a.txt', 'a\n');
    markBusy(join(busy.dir, '.git'), { label: 'agent' });
    expect(runPreview({ cwd: busy.dir }).plan).toMatchObject({ action: 'hold', code: 'busy' });

    const detached = repo();
    detached.git('checkout', '--quiet', '--detach');
    detached.write('a.txt', 'a\n');
    const result = runPreview({ cwd: detached.dir });
    expect(result.state).toBe('unsafe-state');
    expect(result.problems[0]).toContain('HEAD is detached');

    expect(runPreview({ cwd: tempDir() }).state).toBe('not-repository');
  });

  it('formats a report that says nothing was changed', () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    const lines = formatPreview(runPreview({ cwd: r.dir, message: 'Add a' }));
    expect(lines[0]).toBe('shipgate: PREVIEW (ship would SHIP) — The balanced policy allows this run.');
    expect(lines).toContain('  change   A a.txt');
    expect(lines).toContain('  subject  Add a');
    expect(lines.at(-1)).toBe('  result   Preview only: nothing was staged, committed, or pushed.');
  });

  it('runs from the CLI with --json and the ship flags', () => {
    const r = repo();
    r.write('.env', `KEY=${SYNTHETIC.openai}\n`);
    const before = snapshot(r);
    const run = cli(r.dir, ['preview', '--json', '--force-secrets', '-m', 'Add env']);
    expect(run.status).toBe(0);
    expect(snapshot(r)).toEqual(before);
    const json = JSON.parse(run.stdout);
    expect(json).toMatchObject({ state: 'ready', plan: { action: 'ship' }, subject: 'Add env' });
    expect(run.stderr).toContain('Preview only');

    const invalid = repo(null);
    invalid.write('.shipgate.json', '[]');
    expect(cli(invalid.dir, ['preview']).status).toBe(1);
    expect(cli(r.dir, ['preview', '--hook', 'claude']).status).toBe(1);
  });
});
