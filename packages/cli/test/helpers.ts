import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import type { ShipgateConfig } from '@shipgate/core';
import { writeRepoConfig } from '../src/config.js';

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A new directory removed after the test. Resolved through symlinks (macOS /var). */
export function tempDir(prefix = 'shipgate-test-'): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/** Run git in a directory and return trimmed stdout. Throws on failure. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

export function write(root: string, path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

export interface Repo {
  dir: string;
  git: (...args: string[]) => string;
  write: (path: string, content: string | Buffer) => void;
  read: (path: string) => string;
  head: () => string;
  index: () => Buffer;
  indexPath: string;
}

/**
 * A disposable repository with one commit and Shipgate enabled. `.shipgate.json` is
 * excluded locally so it never appears in the changes under test.
 */
export function repo(config: Partial<ShipgateConfig> | null = {}): Repo {
  const dir = tempDir('shipgate-repo-');
  git(dir, 'init', '--quiet', '-b', 'main');
  git(dir, 'config', 'user.name', 'Shipgate Test');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.shipgate.json\n');
  if (config) writeRepoConfig(dir, { enabled: true, level: 'balanced', agentReview: false, publicOk: false, ...config });
  write(dir, 'README.md', 'base\n');
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '--quiet', '-m', 'initial');
  return handle(dir);
}

export function handle(dir: string): Repo {
  const indexPath = resolve(dir, git(dir, 'rev-parse', '--git-path', 'index'));
  return {
    dir,
    git: (...args) => git(dir, ...args),
    write: (path, content) => write(dir, path, content),
    read: (path) => read(dir, path),
    head: () => git(dir, 'rev-parse', 'HEAD'),
    index: () => readFileSync(indexPath),
    indexPath,
  };
}

/** Add a bare repository as origin and push main to it. Returns the bare repo path. */
export function addOrigin(r: Repo): string {
  const bare = tempDir('shipgate-origin-');
  git(bare, 'init', '--quiet', '--bare', '-b', 'main');
  r.git('remote', 'add', 'origin', bare);
  r.git('push', '--quiet', '--set-upstream', 'origin', 'main');
  return bare;
}

/** Commit to origin from a second clone, as another contributor would. */
export function pushFromOtherClone(bare: string, path: string, content: string, branch = 'main'): string {
  const clone = tempDir('shipgate-other-');
  git(clone, 'clone', '--quiet', '--branch', branch, bare, '.');
  git(clone, 'config', 'user.name', 'Other');
  git(clone, 'config', 'user.email', 'other@example.invalid');
  write(clone, path, content);
  git(clone, 'add', path);
  git(clone, 'commit', '--quiet', '-m', `other: ${path}`);
  git(clone, 'push', '--quiet', 'origin', branch);
  return git(clone, 'rev-parse', 'HEAD');
}

export function remoteHead(bare: string, branch = 'main'): string {
  return git(bare, 'rev-parse', `refs/heads/${branch}`);
}

/** Synthetic credential-shaped values assembled at runtime. */
export const SYNTHETIC = {
  openai: ['sk', 'proj', 'shipgateTest0123456789abcdefXYZ'].join('-'),
  github: ['ghp', 'shipgateTest0123456789abcdefghijABCDEF'].join('_'),
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzaGlwZ2F0ZS10ZXN0In0', 'c2hpcGdhdGVUZXN0U2lnbmF0dXJl'].join('.'),
};

const here = dirname(fileURLToPath(import.meta.url));
export const BIN = resolve(here, '../dist/bin.js');

export interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run the built CLI in a child process. Requires `npm run build` first. */
export function cli(cwd: string, args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv } = {}): CliRun {
  if (!existsSync(BIN)) throw new Error(`${BIN} is missing; run npm run build first`);
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    input: opts.input ?? '',
    env: { ...process.env, ...opts.env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
