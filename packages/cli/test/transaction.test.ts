import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runShip } from '../src/commands/ship.js';
import { runUndo } from '../src/commands/undo.js';
import { createGit } from '../src/git.js';
import { loadRepoConfig, writeRepoConfig } from '../src/config.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function repository(agentReview = false) {
  const dir = mkdtempSync(join(tmpdir(), 'shipgate-transaction-'));
  dirs.push(dir);
  const git = createGit(dir);
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  git.run(['config', 'user.name', 'Test']);
  git.run(['config', 'user.email', 'test@example.invalid']);
  writeRepoConfig(dir, { enabled: true, level: 'balanced', agentReview, publicOk: true });
  writeFileSync(join(dir, 'file.txt'), 'initial\n');
  git.run(['add', '-A']);
  git.run(['commit', '-m', 'initial']);
  return { dir, git };
}
function pendingReview() {
  let resume!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { resume = resolve; });
  return { ready, resume: () => resume(), review: async () => {
    entered(); await wait;
    return { outcome: 'hold' as const, detail: 'test hold' };
  } };
}

describe('ship transactions', () => {
  it.each([true, false])('scans staged blobs when the working file changes after add (secret staged=%s)', async (secretStaged) => {
    const { dir, git } = repository();
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456789';
    writeFileSync(join(dir, 'secrét file.txt'), secretStaged ? secret : 'clean');
    const wrapped = { run(args: string[], options?: { allowFail?: boolean }) {
      const result = git.run(args, options);
      if (args[0] === 'add') writeFileSync(join(dir, 'secrét file.txt'), secretStaged ? 'clean' : secret);
      return result;
    } };
    const head = git.run(['rev-parse', 'HEAD']);
    const result = await runShip({ cwd: dir, git: wrapped, message: 'test' });
    expect(result.action).toBe(secretStaged ? 'block' : 'ship');
    if (secretStaged) expect(git.run(['rev-parse', 'HEAD'])).toBe(head);
    else expect(git.run(['show', 'HEAD:secrét file.txt'])).toBe('clean');
  });

  it('holds overlapping ship and undo operations while review awaits', async () => {
    const { dir } = repository(true);
    writeFileSync(join(dir, 'file.txt'), 'changed');
    const pending = pendingReview();
    const first = runShip({ cwd: dir, review: pending.review });
    await pending.ready;
    try {
      expect((await runShip({ cwd: dir, message: 'competing' })).action).toBe('hold');
      expect(runUndo({ cwd: dir }).reason).toMatch(/lock/);
    } finally { pending.resume(); }
    expect((await first).action).toBe('hold');
    expect(existsSync(join(dir, '.git', 'shipgate-ship.lock'))).toBe(false);
  });

  it('keeps an index changed by another Git operation during review', async () => {
    const { dir, git } = repository(true);
    writeFileSync(join(dir, 'file.txt'), 'changed');
    const pending = pendingReview();
    const first = runShip({ cwd: dir, review: pending.review });
    await pending.ready;
    writeFileSync(join(dir, 'other.txt'), 'manual staged content');
    git.run(['add', 'other.txt']);
    const index = readFileSync(join(dir, '.git', 'index'));
    pending.resume();
    await first;
    expect(readFileSync(join(dir, '.git', 'index')).equals(index)).toBe(true);
    expect(git.run(['show', ':other.txt'])).toBe('manual staged content');
  });

  it('refuses undo with staged edits instead of erasing partial staging', () => {
    const { dir, git } = repository();
    git.run(['commit', '--allow-empty', '-m', 'shipped\n\nShipped-by: shipgate']);
    writeFileSync(join(dir, 'file.txt'), 'staged');
    git.run(['add', 'file.txt']);
    writeFileSync(join(dir, 'file.txt'), 'unstaged');
    const head = git.run(['rev-parse', 'HEAD']);
    const result = runUndo({ cwd: dir });
    expect(result.undone).toBe(false);
    expect(git.run(['rev-parse', 'HEAD'])).toBe(head);
    expect(git.run(['show', ':file.txt'])).toBe('staged');
  });

  it.each([false, true])('scans the whole repository from a nested directory (linked worktree=%s)', async (linked) => {
    const { dir, git } = repository();
    let root = dir;
    if (linked) {
      root = mkdtempSync(join(tmpdir(), 'shipgate-linked-'));
      dirs.push(root);
      git.run(['worktree', 'add', '-b', 'linked', root]);
    }
    const rootGit = createGit(root);
    const cwd = join(root, 'packages', 'cli');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(root, 'file.txt'), 'staged');
    rootGit.run(['add', 'file.txt']);
    writeFileSync(join(root, 'file.txt'), 'unstaged');
    writeFileSync(join(root, '.env'), 'SETTING=fixture');
    writeFileSync(join(cwd, 'clean.txt'), 'nested change');
    const indexPath = resolve(root, rootGit.run(['rev-parse', '--git-path', 'index']));
    const index = readFileSync(indexPath);
    const head = rootGit.run(['rev-parse', 'HEAD']);

    const result = await runShip({ cwd });

    expect(result.action).toBe('block');
    expect(result.reasons.join(' ')).toMatch(/credential finding/);
    expect(rootGit.run(['rev-parse', 'HEAD'])).toBe(head);
    expect(readFileSync(indexPath).equals(index)).toBe(true);
    expect(rootGit.run(['show', ':file.txt'])).toBe('staged');
    expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('unstaged');
  });

  it.each([false, true])('restores partial staging after nested review holds (linked worktree=%s)', async (linked) => {
    const { dir, git } = repository(true);
    let root = dir;
    if (linked) {
      root = mkdtempSync(join(tmpdir(), 'shipgate-linked-review-'));
      dirs.push(root);
      git.run(['worktree', 'add', '-b', 'linked-review', root]);
    }
    const rootGit = createGit(root);
    const cwd = join(root, 'packages', 'cli');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(root, 'file.txt'), 'staged');
    rootGit.run(['add', 'file.txt']);
    writeFileSync(join(root, 'file.txt'), 'unstaged');
    writeFileSync(join(cwd, 'clean.txt'), 'nested change');
    const indexPath = resolve(root, rootGit.run(['rev-parse', '--git-path', 'index']));
    const index = readFileSync(indexPath);
    const head = rootGit.run(['rev-parse', 'HEAD']);

    const result = await runShip({
      cwd,
      review: async () => ({ outcome: 'hold', detail: 'needs review' }),
    });

    expect(result.action).toBe('hold');
    expect(rootGit.run(['rev-parse', 'HEAD'])).toBe(head);
    expect(readFileSync(indexPath).equals(index)).toBe(true);
    expect(rootGit.run(['show', ':file.txt'])).toBe('staged');
    expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('unstaged');
  });

  it.each([
    { linked: false, nestedSecret: false },
    { linked: false, nestedSecret: true },
    { linked: true, nestedSecret: false },
    { linked: true, nestedSecret: true },
  ])('scans relative diffs across the repository (%j)', async ({ linked, nestedSecret }) => {
    const { dir, git } = repository();
    git.run(['config', 'diff.relative', 'true']);
    let root = dir;
    if (linked) {
      root = mkdtempSync(join(tmpdir(), 'shipgate-relative-'));
      dirs.push(root);
      git.run(['worktree', 'add', '-b', 'relative', root]);
    }
    const rootGit = createGit(root);
    const cwd = join(root, 'src');
    mkdirSync(cwd);
    writeFileSync(join(root, 'file.txt'), 'root change');
    writeFileSync(join(cwd, 'clean.txt'), 'nested change');
    writeFileSync(join(nestedSecret ? cwd : root, 'credential.txt'), ['sk', 'a'.repeat(30)].join('-'));
    const indexPath = resolve(root, rootGit.run(['rev-parse', '--git-path', 'index']));
    const index = readFileSync(indexPath);
    const head = rootGit.run(['rev-parse', 'HEAD']);

    const result = await runShip({ cwd, message: 'test' });

    expect(result.action).toBe('block');
    expect(result.reasons.join(' ')).toMatch(/credential finding/);
    expect(rootGit.run(['rev-parse', 'HEAD'])).toBe(head);
    expect(readFileSync(indexPath).equals(index)).toBe(true);
  });

  it('reviews changes outside the current directory when diff.relative is enabled', async () => {
    const { dir, git } = repository(true);
    git.run(['config', 'diff.relative', 'true']);
    const cwd = join(dir, 'src');
    mkdirSync(cwd);
    writeFileSync(join(dir, 'file.txt'), 'root change');
    writeFileSync(join(cwd, 'nested.txt'), 'nested change');
    let patch = '';
    const result = await runShip({ cwd, review: async (input) => {
      patch = input.diff;
      return { outcome: 'hold', detail: 'test hold' };
    } });
    expect(result.action).toBe('hold');
    expect(patch).toContain('+root change');
    expect(patch).toContain('+nested change');
  });

  it.each([false, true])('scans all of a blob larger than 1 MiB (secret=%s)', async (secret) => {
    const { dir, git } = repository();
    const content = 'a'.repeat(2 * 1024 * 1024) + (secret ? '\n' + ['sk', 'b'.repeat(30)].join('-') : '');
    writeFileSync(join(dir, 'large.txt'), content);
    const head = git.run(['rev-parse', 'HEAD']);
    const result = await runShip({ cwd: dir, message: 'large file' });
    expect(result.action).toBe(secret ? 'block' : 'ship');
    if (secret) expect(git.run(['rev-parse', 'HEAD'])).toBe(head);
    else expect(git.run(['cat-file', '-s', 'HEAD:large.txt'])).toBe(String(Buffer.byteLength(content)));
  });

  it('holds without changing the index when a staged blob exceeds 16 MiB', async () => {
    const { dir, git } = repository();
    writeFileSync(join(dir, 'large.txt'), Buffer.alloc(16 * 1024 * 1024 + 1, 'a'));
    const head = git.run(['rev-parse', 'HEAD']);
    const index = readFileSync(join(dir, '.git', 'index'));
    const result = await runShip({ cwd: dir, message: 'large file' });
    expect(result.action).toBe('hold');
    expect(result.exitCode).toBe(1);
    expect(result.reasons.join(' ')).toMatch(/up to 16 MiB/);
    expect(git.run(['rev-parse', 'HEAD'])).toBe(head);
    expect(readFileSync(join(dir, '.git', 'index')).equals(index)).toBe(true);
    expect(existsSync(join(dir, '.git', 'shipgate-ship.lock'))).toBe(false);
  });
});

describe('policy validation', () => {
  it.each([null, [], { level: 'strcit' }, { enabled: 'false' }, { agentReview: 'false' }, { publicOk: 'false' }])('rejects invalid policy %j', (value) => {
    const { dir } = repository();
    writeFileSync(join(dir, '.shipgate.json'), JSON.stringify(value));
    expect(loadRepoConfig(dir).state).toBe('invalid');
  });
});
