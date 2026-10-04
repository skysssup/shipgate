import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatShipResult, runShip } from '../src/commands/ship.js';
import { runUndo } from '../src/commands/undo.js';
import { addOrigin, git, pushFromOtherClone, remoteHead, repo, tempDir, type Repo } from './helpers.js';

function rejectAllPushes(bare: string, message: string): void {
  const hook = join(bare, 'hooks', 'pre-receive');
  writeFileSync(hook, `#!/bin/sh\necho "${message}" >&2\nexit 1\n`);
  chmodSync(hook, 0o755);
}

function rejectForcePushes(bare: string): void {
  git(bare, 'config', 'receive.denyNonFastForwards', 'true');
}

function workingFiles(r: Repo, paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((p) => [p, r.read(p)]));
}

describe('push and retry', () => {
  it('pushes the commit and sets an upstream for a new branch', async () => {
    const r = repo();
    const bare = addOrigin(r);
    r.git('checkout', '--quiet', '-b', 'feature');
    r.write('a.txt', 'feature work\n');
    const result = await runShip({ cwd: r.dir, message: 'feat: a' });
    expect(result).toMatchObject({ outcome: 'pushed', action: 'ship', exitCode: 0, committed: true, pushed: true, branch: 'feature' });
    expect(remoteHead(bare, 'feature')).toBe(r.head());
    expect(r.git('config', 'branch.feature.remote')).toBe('origin');
    expect(formatShipResult(result)[0]).toBe(`shipgate: SHIPPED — Pushed ${result.sha} to origin/feature.`);
  });

  it('does not change an existing upstream setting', async () => {
    const r = repo();
    addOrigin(r);
    r.git('checkout', '--quiet', '-b', 'topic', '--track', 'origin/main');
    r.write('a.txt', 'x\n');
    expect((await runShip({ cwd: r.dir, message: 'x' })).outcome).toBe('pushed');
    expect(r.git('config', 'branch.topic.merge')).toBe('refs/heads/main');
  });

  it('rebases once onto new remote commits and pushes both', async () => {
    const r = repo();
    const bare = addOrigin(r);
    const other = pushFromOtherClone(bare, 'other.txt', 'from someone else\n');
    r.write('mine.txt', 'mine\n');
    const result = await runShip({ cwd: r.dir, message: 'feat: mine' });
    expect(result.outcome).toBe('pushed');
    expect(result.notes).toContain('Rebased onto new commits from origin/main before pushing.');
    expect(remoteHead(bare)).toBe(r.head());
    expect(r.git('rev-parse', 'HEAD~1')).toBe(other);
    expect(r.read('other.txt')).toBe('from someone else\n');
  });

  it('keeps the local commit when the rebase conflicts, and aborts the rebase', async () => {
    const r = repo();
    const bare = addOrigin(r);
    const other = pushFromOtherClone(bare, 'README.md', 'their version\n');
    r.write('README.md', 'my version\n');
    const result = await runShip({ cwd: r.dir, message: 'mine' });
    expect(result).toMatchObject({ outcome: 'push-failed', action: 'ship', exitCode: 1, committed: true, pushed: false });
    expect(result.reasons[0]).toMatch(/rebasing onto them failed .* the rebase was aborted/);
    expect(r.git('log', '-1', '--format=%s')).toBe('mine');
    expect(r.read('README.md')).toBe('my version\n');
    expect(r.git('status', '--porcelain')).toBe('');
    expect(existsSync(join(r.dir, '.git', 'rebase-merge'))).toBe(false);
    expect(remoteHead(bare)).toBe(other);
    const output = formatShipResult(result).join('\n');
    expect(output).toContain('COMMITTED, NOT PUSHED');
    expect(output).toContain('git push origin main');
  });

  it('reports a rejected push without rebasing when origin has nothing new', async () => {
    const r = repo();
    const bare = addOrigin(r);
    const before = remoteHead(bare);
    rejectAllPushes(bare, 'protected branch: pushes need review');
    r.write('a.txt', 'x\n');
    const result = await runShip({ cwd: r.dir, message: 'x' });
    expect(result).toMatchObject({ outcome: 'push-failed', exitCode: 1, committed: true });
    expect(result.reasons[0]).toMatch(/protected branch: pushes need review|pre-receive hook declined/);
    expect(result.notes).toEqual([]);
    expect(remoteHead(bare)).toBe(before);
    expect(r.git('log', '-1', '--format=%s')).toBe('x');
  });

  it('keeps the commit when origin is unreachable', async () => {
    const r = repo();
    r.git('remote', 'add', 'origin', join(tempDir(), 'missing.git'));
    r.write('a.txt', 'x\n');
    const result = await runShip({ cwd: r.dir, message: 'offline' });
    expect(result).toMatchObject({ outcome: 'push-failed', exitCode: 1, committed: true, pushed: false });
    expect(result.summary).toMatch(/^Committed [0-9a-f]+ on main, but the push to origin failed\.$/);
    expect(r.git('log', '-1', '--format=%s')).toBe('offline');
  });

  it('does not rebase local merge commits', async () => {
    const r = repo();
    const bare = addOrigin(r);
    r.git('checkout', '--quiet', '-b', 'side');
    r.write('side.txt', 'side\n');
    r.git('add', 'side.txt');
    r.git('commit', '--quiet', '-m', 'side');
    r.git('checkout', '--quiet', 'main');
    r.git('merge', '--quiet', '--no-ff', '-m', 'merge side', 'side');
    pushFromOtherClone(bare, 'other.txt', 'other\n');
    r.write('mine.txt', 'mine\n');
    const result = await runShip({ cwd: r.dir, message: 'mine' });
    expect(result.outcome).toBe('push-failed');
    expect(result.reasons[0]).toMatch(/contains merges, so Shipgate did not rebase/);
    expect(r.git('rev-list', '--merges', '--count', 'HEAD')).toBe('1');
  });

  it('commits locally when there is no origin', async () => {
    const r = repo();
    r.write('a.txt', 'x\n');
    const result = await runShip({ cwd: r.dir, message: 'local' });
    expect(result).toMatchObject({ outcome: 'committed', exitCode: 0, pushed: false, remote: 'no origin remote (commits stay local)' });
    expect(result.summary).toBe(`Committed ${result.sha} on main. There is no origin remote, so nothing was pushed.`);
  });
});

describe('undo', () => {
  async function shipped(r: Repo, content = 'shipped change\n'): Promise<string> {
    r.write('feature.txt', content);
    const result = await runShip({ cwd: r.dir, message: 'feat: shipped' });
    expect(['pushed', 'committed']).toContain(result.outcome);
    return r.head();
  }

  it('removes a pushed Shipgate commit locally and from origin, keeping the files', async () => {
    const r = repo();
    const bare = addOrigin(r);
    const parent = r.head();
    const sha = await shipped(r);
    const result = runUndo({ cwd: r.dir });
    expect(result).toMatchObject({ exitCode: 0, undone: true, outcome: 'undone-remote', sha: sha.slice(0, 7) });
    expect(r.head()).toBe(parent);
    expect(remoteHead(bare)).toBe(parent);
    expect(r.read('feature.txt')).toBe('shipped change\n');
    expect(r.git('status', '--porcelain')).toBe('?? feature.txt');
  });

  it('undoes locally in a repository without origin', async () => {
    const r = repo();
    const parent = r.head();
    await shipped(r);
    expect(runUndo({ cwd: r.dir })).toMatchObject({ exitCode: 0, outcome: 'undone-local' });
    expect(r.head()).toBe(parent);
  });

  it('undoes only locally when the push had failed', async () => {
    const r = repo();
    const bare = addOrigin(r);
    const parent = r.head();
    rejectAllPushes(bare, 'no');
    r.write('feature.txt', 'x\n');
    expect((await runShip({ cwd: r.dir, message: 'x' })).outcome).toBe('push-failed');
    const result = runUndo({ cwd: r.dir });
    expect(result).toMatchObject({ exitCode: 0, outcome: 'undone-local' });
    expect(result.reason).toMatch(/origin never had it/);
    expect(r.head()).toBe(parent);
    expect(remoteHead(bare)).toBe(parent);
  });

  it('refuses when origin has newer commits on top, changing nothing', async () => {
    const r = repo();
    const bare = addOrigin(r);
    const sha = await shipped(r);
    const newer = pushFromOtherClone(bare, 'other.txt', 'newer\n');
    const result = runUndo({ cwd: r.dir });
    expect(result).toMatchObject({ exitCode: 1, undone: false, outcome: 'refused' });
    expect(result.reason).toMatch(/already has newer commits/);
    expect(result.next).toBe(`Use git revert ${sha.slice(0, 7)} to undo the change with a new commit.`);
    expect(r.head()).toBe(sha);
    expect(remoteHead(bare)).toBe(newer);
    expect(r.git('status', '--porcelain')).toBe('');
  });

  it('restores the local commit when origin rejects the rewind', async () => {
    const r = repo();
    const bare = addOrigin(r);
    const sha = await shipped(r);
    rejectForcePushes(bare);
    const result = runUndo({ cwd: r.dir });
    expect(result).toMatchObject({ exitCode: 1, undone: false, outcome: 'refused' });
    expect(result.reason).toMatch(/origin rejected removing .* The local commit was restored, so nothing changed\./);
    expect(r.head()).toBe(sha);
    expect(remoteHead(bare)).toBe(sha);
    expect(r.git('status', '--porcelain')).toBe('');
    expect(r.read('feature.txt')).toBe('shipped change\n');
  });

  it('refuses when origin cannot be reached', async () => {
    const r = repo();
    const sha = await shipped(r);
    r.git('remote', 'add', 'origin', join(tempDir(), 'missing.git'));
    const result = runUndo({ cwd: r.dir });
    expect(result).toMatchObject({ exitCode: 1, outcome: 'refused' });
    expect(result.reason).toMatch(/Could not reach origin .* Nothing changed\./);
    expect(r.head()).toBe(sha);
  });

  it.each([
    ['a commit without the trailer', (r: Repo) => {
      r.write('x.txt', 'x\n');
      r.git('add', 'x.txt');
      r.git('commit', '--quiet', '-m', 'manual commit');
    }, /was not created by shipgate ship/],
    ['staged edits', async (r: Repo) => {
      await shipped(r);
      r.write('README.md', 'staged\n');
      r.git('add', 'README.md');
    }, /There are staged changes/],
    ['a detached HEAD', async (r: Repo) => {
      await shipped(r);
      r.git('checkout', '--quiet', '--detach');
    }, /HEAD is detached/],
    ['a merge commit with the trailer', (r: Repo) => {
      r.git('checkout', '--quiet', '-b', 'side');
      r.git('commit', '--quiet', '--allow-empty', '-m', 'side');
      r.git('checkout', '--quiet', 'main');
      r.git('merge', '--quiet', '--no-ff', '-m', 'merge\n\nShipped-by: shipgate', 'side');
    }, /is a merge commit/],
  ])('refuses %s without changing anything', async (_name, arrange, reason) => {
    const r = repo();
    await arrange(r);
    const before = { head: r.head(), index: r.index(), status: r.git('status', '--porcelain') };
    const result = runUndo({ cwd: r.dir });
    expect(result).toMatchObject({ exitCode: 1, undone: false, outcome: 'refused' });
    expect(result.reason).toMatch(reason);
    expect({ head: r.head(), index: r.index(), status: r.git('status', '--porcelain') }).toEqual(before);
  });

  it('refuses the first commit of a repository', async () => {
    const dir = tempDir();
    git(dir, 'init', '--quiet', '-b', 'main');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'config', 'user.email', 't@example.invalid');
    writeFileSync(join(dir, '.shipgate.json'), '{}\n');
    expect((await runShip({ cwd: dir, message: 'root' })).outcome).toBe('committed');
    const result = runUndo({ cwd: dir });
    expect(result.reason).toMatch(/is the first commit/);
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
  });
});
