import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markBusy } from '@shipgate/core';
import type { ReviewRequest } from '../src/agent-review.js';
import { formatShipResult, runShip } from '../src/commands/ship.js';
import { writeRepoConfig } from '../src/config.js';
import { addOrigin, git, remoteHead, repo, SYNTHETIC, tempDir } from './helpers.js';

const isWindows = process.platform === 'win32';

/** Repository facts every failure-path test checks. */
function snapshot(r: ReturnType<typeof repo>) {
  return { head: r.head(), index: r.index(), status: r.git('status', '--porcelain=v1', '-uall') };
}

function hook(r: ReturnType<typeof repo>, name: string, script: string): void {
  const path = join(r.dir, '.git', 'hooks', name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

describe('what ship stages and scans', () => {
  it('commits staged, unstaged, untracked, deleted, and renamed paths together', async () => {
    const r = repo();
    r.write('staged.txt', 'one\n');
    r.write('modified.txt', 'two\n');
    r.write('to-delete.txt', 'three\n');
    r.write('to-rename.txt', 'four\n');
    r.git('add', '.');
    r.git('commit', '--quiet', '-m', 'files');
    r.write('staged.txt', 'staged change\n');
    r.git('add', 'staged.txt');
    r.write('modified.txt', 'unstaged change\n');
    r.git('rm', '--quiet', 'to-delete.txt');
    r.git('mv', 'to-rename.txt', 'renamed.txt');
    r.write('dir with space/new file.txt', 'untracked\n');

    const result = await runShip({ cwd: r.dir, message: 'feat: many kinds of change' });

    expect(result).toMatchObject({ outcome: 'committed', action: 'ship', exitCode: 0, committed: true, pushed: false });
    expect(r.git('show', '--no-renames', '--name-status', '--format=', 'HEAD').split('\n').sort()).toEqual([
      'A\tdir with space/new file.txt',
      'A\trenamed.txt',
      'D\tto-delete.txt',
      'D\tto-rename.txt',
      'M\tmodified.txt',
      'M\tstaged.txt',
    ]);
    expect(r.git('status', '--porcelain')).toBe('');
  });

  it('runs from a nested directory and handles unusual file names', async () => {
    const r = repo();
    const names = ['quote"name.txt', 'tab\tname.txt', 'ünïcödé.txt', '-leading-dash.txt'].filter((n) => !isWindows || !/["\t]/.test(n));
    for (const name of names) r.write(`odd/${name}`, 'content\n');
    r.write('deep/nested/dir/keep.txt', 'x\n');
    const result = await runShip({ cwd: join(r.dir, 'deep', 'nested', 'dir'), message: 'odd names' });
    expect(result.outcome).toBe('committed');
    const committed = r.git('ls-tree', '-r', '--name-only', '-z', 'HEAD').split('\0');
    for (const name of names) expect(committed).toContain(`odd/${name}`);
  });

  it('finds a credential in a file whose name contains a newline', async () => {
    if (isWindows) return;
    const r = repo();
    r.write('line\nbreak.env.txt', `token=${SYNTHETIC.github}\n`);
    const before = snapshot(r);
    const result = await runShip({ cwd: r.dir, message: 'x' });
    expect(result.outcome).toBe('blocked');
    expect(result.findings.map((f) => f.path)).toEqual(['line\nbreak.env.txt']);
    expect(snapshot(r)).toEqual(before);
  });

  it('scans binary files and symlink targets as staged bytes', async () => {
    const r = repo();
    r.write('image.bin', Buffer.concat([Buffer.from([0, 1, 2, 255]), Buffer.from(SYNTHETIC.github), Buffer.from([0])]));
    const binary = await runShip({ cwd: r.dir, message: 'binary' });
    expect(binary.findings).toEqual([expect.objectContaining({ path: 'image.bin', ruleId: 'github-token' })]);

    if (isWindows) return;
    const s = repo();
    symlinkSync(SYNTHETIC.openai, join(s.dir, 'link'));
    const link = await runShip({ cwd: s.dir, message: 'symlink' });
    expect(link.findings).toEqual([expect.objectContaining({ path: 'link', ruleId: 'openai-key' })]);
  });

  it('reports submodule commits as not scanned and still ships them', async () => {
    const sub = repo(null);
    const r = repo();
    r.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', sub.dir, 'vendor/sub');
    const result = await runShip({ cwd: r.dir, message: 'add submodule' });
    expect(result.outcome).toBe('committed');
    expect(result.notes.join(' ')).toMatch(/Submodule contents are not scanned: vendor\/sub/);
  });

  it('commits the working-tree version when an earlier staged version differs', async () => {
    const r = repo();
    r.write('config.ts', `export const key = "${SYNTHETIC.openai}";\n`);
    r.git('add', 'config.ts');
    r.write('config.ts', 'export const key = process.env.KEY;\n');
    const result = await runShip({ cwd: r.dir, message: 'x' });
    expect(result).toMatchObject({ outcome: 'committed', findings: [] });
    expect(r.git('show', 'HEAD:config.ts')).toBe('export const key = process.env.KEY;');
    expect(r.git('log', '--all', '-p', '--format=')).not.toContain('sk-proj-');
  });

  it('refuses to stage during an unresolved merge and leaves every file as it was', async () => {
    const r = repo();
    r.git('checkout', '--quiet', '-b', 'other');
    r.write('README.md', 'theirs\n');
    r.git('commit', '--quiet', '-am', 'theirs');
    r.git('checkout', '--quiet', 'main');
    r.write('README.md', 'ours\n');
    r.git('commit', '--quiet', '-am', 'ours');
    expect(() => r.git('merge', '--quiet', 'other')).toThrow();
    const before = snapshot(r);
    const conflicted = r.read('README.md');

    const result = await runShip({ cwd: r.dir, message: 'should not commit' });

    expect(result).toMatchObject({ outcome: 'unsafe-state', action: 'hold', exitCode: 1, committed: false, staging: 'untouched' });
    expect(result.summary).toBe('Git is in the middle of a merge.');
    expect(snapshot(r)).toEqual(before);
    expect(r.read('README.md')).toBe(conflicted);
  });

  it('refuses a detached HEAD before staging anything', async () => {
    const r = repo();
    r.git('checkout', '--quiet', '--detach');
    r.write('new.txt', 'x\n');
    const before = snapshot(r);
    const result = await runShip({ cwd: r.dir });
    expect(result).toMatchObject({ outcome: 'unsafe-state', exitCode: 1, summary: 'HEAD is detached.' });
    expect(snapshot(r)).toEqual(before);
  });

  it('makes the initial commit on an unborn branch', async () => {
    const dir = tempDir();
    git(dir, 'init', '--quiet', '-b', 'main');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'config', 'user.email', 't@example.invalid');
    writeFileSync(join(dir, '.shipgate.json'), '{"level":"balanced"}\n');
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    const result = await runShip({ cwd: dir, message: 'first' });
    expect(result.outcome).toBe('committed');
    expect(git(dir, 'ls-tree', '--name-only', 'HEAD').split('\n').sort()).toEqual(['.shipgate.json', 'a.txt']);
  });

  it('is a no-op on a clean tree', async () => {
    const r = repo();
    const result = await runShip({ cwd: r.dir });
    expect(result).toMatchObject({ outcome: 'nothing-to-ship', action: 'noop', exitCode: 0, summary: 'There are no changes to commit.' });
  });
});

describe('opt-in and configuration', () => {
  it('does nothing without .shipgate.json', async () => {
    const r = repo(null);
    r.write('a.txt', 'x\n');
    const before = snapshot(r);
    const result = await runShip({ cwd: r.dir });
    expect(result).toMatchObject({ outcome: 'not-enabled', action: 'block', exitCode: 0 });
    expect(snapshot(r)).toEqual(before);
  });

  it('treats "enabled": false as not enabled and says so', async () => {
    const r = repo({ enabled: false });
    r.write('a.txt', 'x\n');
    const result = await runShip({ cwd: r.dir });
    expect(result.outcome).toBe('not-enabled');
    expect(result.next).toMatch(/"enabled": false/);
  });

  it.each([
    ['{not json', /not valid JSON/],
    ['[]', /JSON object/],
    ['{"level":"strcit"}', /"level" must be/],
    ['{"enabled":"yes"}', /"enabled" must be true or false/],
    ['{"levle":"strict"}', /unknown setting "levle"/],
    ['{"account":"not a login!"}', /GitHub login/],
  ])('fails clearly on invalid config %s', async (content, message) => {
    const r = repo(null);
    r.write('.shipgate.json', content);
    r.write('a.txt', 'x\n');
    const before = snapshot(r);
    const result = await runShip({ cwd: r.dir, forceSecrets: true, publicOk: true });
    expect(result).toMatchObject({ outcome: 'invalid-config', exitCode: 1, committed: false });
    expect(result.summary).toMatch(message);
    expect(snapshot(r)).toEqual(before);
  });
});

describe('policy decisions in a real repository', () => {
  it('blocks a .env file, restores partial staging, and never prints the full value', async () => {
    const r = repo();
    r.write('README.md', 'staged\n');
    r.git('add', 'README.md');
    r.write('README.md', 'unstaged\n');
    r.write('.env', `OPENAI_API_KEY=${SYNTHETIC.openai}\n`);
    const before = snapshot(r);

    const result = await runShip({ cwd: r.dir, message: 'add env' });

    expect(result).toMatchObject({ outcome: 'blocked', action: 'block', exitCode: 0, staging: 'restored' });
    expect(result.findings.map((f) => `${f.path}:${f.ruleId}:${f.line ?? '-'}`).sort()).toEqual(['.env:dotenv-file:-', '.env:openai-key:1']);
    expect(snapshot(r)).toEqual(before);
    const output = formatShipResult(result).join('\n');
    expect(output).not.toContain(SYNTHETIC.openai);
    expect(output).toContain('shipgate: BLOCKED — Credential findings block this run.');
    expect(output).toContain('Nothing was committed. The staging area is back to how it was before the run.');
  });

  it('applies the medium-finding difference between balanced and yolo', async () => {
    for (const [level, outcome] of [['balanced', 'blocked'], ['yolo', 'committed']] as const) {
      const r = repo({ level });
      r.write('fixture.json', `{"token":"${SYNTHETIC.jwt}"}\n`);
      const result = await runShip({ cwd: r.dir, message: 'fixture' });
      expect(result.outcome).toBe(outcome);
      if (level === 'yolo') expect(result.warnings).toEqual(['1 medium-confidence credential finding allowed by yolo.']);
    }
  });

  it('commits with --force-secrets and keeps the warning in the result', async () => {
    const r = repo();
    r.write('fixture.txt', SYNTHETIC.github);
    const result = await runShip({ cwd: r.dir, message: 'known fixture', forceSecrets: true });
    expect(result.outcome).toBe('committed');
    expect(result.warnings).toEqual(['1 high-confidence credential finding overridden with --force-secrets.']);
  });

  it('blocks credentials in --message and --prompt, labelled by source', async () => {
    const r = repo();
    r.write('a.txt', 'clean\n');
    const message = await runShip({ cwd: r.dir, message: `deploy with ${SYNTHETIC.github}` });
    expect(message.findings).toEqual([expect.objectContaining({ path: '--message', ruleId: 'github-token' })]);
    const prompt = await runShip({ cwd: r.dir, prompt: `use ${SYNTHETIC.openai}` });
    expect(prompt.findings).toEqual([expect.objectContaining({ path: '--prompt', ruleId: 'openai-key' })]);
    expect(prompt.outcome).toBe('blocked');
  });

  it('keeps an explicit multi-line message and appends the trailer', async () => {
    const r = repo();
    r.write('a.txt', 'x\n');
    await runShip({ cwd: r.dir, message: 'fix: subject line\n\nBody explains why.' });
    expect(r.git('log', '-1', '--format=%B')).toBe('fix: subject line\n\nBody explains why.\n\nShipped-by: shipgate');
  });

  it('builds the subject from the prompt when no message is given', async () => {
    const r = repo();
    r.write('a.txt', 'x\n');
    const result = await runShip({ cwd: r.dir, prompt: 'Add a greeting helper' });
    expect(result.subject).toBe('Add a greeting helper');
    expect(r.git('log', '-1', '--format=%s')).toBe('Add a greeting helper');
  });
});

describe('commit hooks and commit failures', () => {
  it('reports a rejecting pre-commit hook and restores the staging area', async () => {
    if (isWindows) return;
    const r = repo();
    hook(r, 'pre-commit', 'echo "lint failed: missing semicolon" >&2\nexit 1');
    r.write('README.md', 'partially staged\n');
    r.git('add', 'README.md');
    r.write('new.txt', 'untracked\n');
    const before = snapshot(r);

    const result = await runShip({ cwd: r.dir, message: 'x' });

    expect(result).toMatchObject({ outcome: 'commit-failed', exitCode: 1, committed: false, staging: 'restored' });
    expect(result.reasons.join('\n')).toContain('lint failed: missing semicolon');
    expect(snapshot(r)).toEqual(before);
  });

  it('rescans a commit changed by a hook and keeps a blocked result local', async () => {
    if (isWindows) return;
    const r = repo();
    const bare = addOrigin(r);
    hook(r, 'pre-commit', `printf 'TOKEN=%s\\n' '${SYNTHETIC.github}' > injected.txt\ngit add injected.txt`);
    r.write('a.txt', 'change\n');

    const result = await runShip({ cwd: r.dir, message: 'x' });

    expect(result).toMatchObject({ outcome: 'hook-changed', exitCode: 1, committed: true, pushed: false });
    expect(result.findings).toEqual([expect.objectContaining({ path: 'injected.txt', ruleId: 'github-token' })]);
    expect(r.git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['a.txt', 'injected.txt']);
    expect(remoteHead(bare)).toBe(r.git('rev-parse', 'HEAD~1'));
  });

  it('pushes when a hook only reformats files, noting the rescan', async () => {
    if (isWindows) return;
    const r = repo();
    const bare = addOrigin(r);
    hook(r, 'pre-commit', 'printf "formatted\\n" > a.txt\ngit add a.txt');
    r.write('a.txt', 'unformatted   \n');
    const result = await runShip({ cwd: r.dir, message: 'x' });
    expect(result.outcome).toBe('pushed');
    expect(result.notes).toContain('A commit hook changed the staged files; Shipgate rescanned the commit before pushing.');
    expect(remoteHead(bare)).toBe(r.head());
  });
});

describe('external review', () => {
  it('commits after approval and sends a diff without flagged .env contents', async () => {
    const r = repo({ agentReview: true });
    r.write('src/a.ts', 'export const a = 1;\n');
    r.write('.env', `TOKEN=${SYNTHETIC.github}\nDB_PASSWORD=hunter2\n`);
    let request: ReviewRequest | undefined;
    const result = await runShip({
      cwd: r.dir,
      forceSecrets: true,
      review: async (req) => {
        request = req;
        return { outcome: 'approve', detail: 'looks fine' };
      },
    });
    expect(result).toMatchObject({ outcome: 'committed', review: 'approved' });
    expect(request!.omittedFiles).toEqual(['.env']);
    expect(request!.changedFiles.sort()).toEqual(['.env', 'src/a.ts']);
    expect(request!.diff).toContain('+export const a = 1;');
    expect(request!.diff).not.toContain('hunter2');
  });

  it('holds on a reviewer hold with exit 0 and restores staging', async () => {
    const r = repo({ agentReview: true });
    r.write('a.txt', 'debug\n');
    const before = snapshot(r);
    const result = await runShip({ cwd: r.dir, review: async () => ({ outcome: 'hold', detail: 'debug output left in a.txt' }) });
    expect(result).toMatchObject({ outcome: 'review-hold', action: 'hold', exitCode: 0, reasons: ['Reviewer: debug output left in a.txt'] });
    expect(snapshot(r)).toEqual(before);
  });

  it('fails closed when review is unavailable', async () => {
    const r = repo({ agentReview: true });
    r.write('a.txt', 'x\n');
    const result = await runShip({ cwd: r.dir });
    expect(result).toMatchObject({ outcome: 'review-unavailable', exitCode: 1, committed: false });
    expect(result.reasons[0]).toMatch(/no API key/);
  });

  it('skips review for an explicit message and says so', async () => {
    const r = repo({ agentReview: true });
    r.write('a.txt', 'x\n');
    let called = false;
    const result = await runShip({ cwd: r.dir, message: 'chore: x', review: async () => {
      called = true;
      return { outcome: 'hold', detail: 'never' };
    } });
    expect(called).toBe(false);
    expect(result).toMatchObject({ outcome: 'committed', review: 'skipped' });
    expect(result.warnings).toContain('External review was skipped because the commit message was given with -m/--message.');
  });

  it('reports an invalid global config as an unavailable review', async () => {
    const r = repo({ agentReview: true });
    r.write('a.txt', 'x\n');
    const home = process.env.SHIPGATE_HOME!;
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'config.json'), '{"baseUrl": 5}');
    try {
      const result = await runShip({ cwd: r.dir });
      expect(result.outcome).toBe('review-unavailable');
      expect(result.reasons[0]).toMatch(/"baseUrl" must be a non-empty string/);
    } finally {
      rmSync(join(home, 'config.json'), { force: true });
    }
  });
});

describe('busy markers and locks', () => {
  function sleeper(): { pid: number; stop: () => void } {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    return { pid: child.pid!, stop: () => child.kill() };
  }

  it('holds while another live agent is busy and ships after it exits', async () => {
    const r = repo();
    r.write('a.txt', 'x\n');
    const agent = sleeper();
    try {
      markBusy(join(r.dir, '.git'), { pid: agent.pid, label: 'agent' });
      const before = snapshot(r);
      const held = await runShip({ cwd: r.dir, forceSecrets: true, publicOk: true, confirm: true });
      expect(held).toMatchObject({ outcome: 'busy', action: 'hold', exitCode: 0, reasons: ['1 other agent holds a busy marker in this worktree.'] });
      expect(snapshot(r)).toEqual(before);
    } finally {
      agent.stop();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await runShip({ cwd: r.dir, message: 'after' })).outcome).toBe('committed');
  });

  it('holds when a live process owns the lock and leaves the lock in place', async () => {
    const r = repo();
    r.write('a.txt', 'x\n');
    const owner = sleeper();
    const lock = join(r.dir, '.git', 'shipgate-ship.lock');
    writeFileSync(lock, JSON.stringify({ pid: owner.pid, hostname: hostname(), startedAt: Date.now(), command: 'ship', nonce: 'live' }));
    try {
      const result = await runShip({ cwd: r.dir, message: 'x' });
      expect(result).toMatchObject({ outcome: 'locked', action: 'hold', exitCode: 0 });
      expect(result.reasons[0]).toContain(`pid ${owner.pid}`);
      expect(existsSync(lock)).toBe(true);
    } finally {
      owner.stop();
    }
  });

  it('treats a lock from another host as held', async () => {
    const r = repo();
    r.write('a.txt', 'x\n');
    writeFileSync(join(r.dir, '.git', 'shipgate-ship.lock'), JSON.stringify({ pid: 1, hostname: 'build-agent-7', startedAt: 0, command: 'ship', nonce: 'x' }));
    expect((await runShip({ cwd: r.dir, message: 'x' })).outcome).toBe('locked');
  });

  it('removes a stale lock left by a crashed process and ships', async () => {
    const r = repo();
    r.write('a.txt', 'x\n');
    const dead = sleeper();
    dead.stop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    writeFileSync(join(r.dir, '.git', 'shipgate-ship.lock'), JSON.stringify({ pid: dead.pid, startedAt: 1 }));
    const result = await runShip({ cwd: r.dir, message: 'after crash' });
    expect(result.outcome).toBe('committed');
    expect(result.notes[0]).toMatch(new RegExp(`Removed a stale lock from shipgate ship \\(pid ${dead.pid}`));
    expect(existsSync(join(r.dir, '.git', 'shipgate-ship.lock'))).toBe(false);
  });

  it('keeps locks per worktree', async () => {
    const r = repo();
    const linked = tempDir('shipgate-linked-');
    r.git('worktree', 'add', '--quiet', '-b', 'linked', linked);
    const owner = sleeper();
    try {
      writeFileSync(join(r.dir, '.git', 'shipgate-ship.lock'), JSON.stringify({ pid: owner.pid, hostname: hostname(), startedAt: 0, command: 'ship', nonce: 'main' }));
      writeRepoConfig(linked, { enabled: true, level: 'balanced', agentReview: false, publicOk: false });
      writeFileSync(join(linked, 'b.txt'), 'linked change\n');
      const result = await runShip({ cwd: linked, message: 'linked' });
      expect(result.outcome).toBe('committed');
      expect(existsSync(join(r.dir, '.git', 'worktrees'))).toBe(true);
    } finally {
      owner.stop();
    }
  });
});
