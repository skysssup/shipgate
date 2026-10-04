import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface GitOptions {
  /** Return stdout (possibly empty) instead of throwing when git exits non-zero. */
  allowFail?: boolean;
  input?: string;
  /** `latin1` keeps every byte as one character, for binary-safe parsing. */
  encoding?: 'utf8' | 'latin1';
  /** Keep trailing whitespace, for outputs parsed by byte count. */
  keepTrailing?: boolean;
}

export interface GitRunner {
  run(args: string[], opts?: GitOptions): string;
}

/** A failed git command. The message is git's own error output. */
class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly status: number | null,
    readonly stderr: string,
  ) {
    super(stderr.trim() || `git ${args[0]} exited with status ${status}`);
    this.name = 'GitError';
  }
}

export function createGit(cwd: string = process.cwd()): GitRunner {
  return {
    run(args, opts = {}) {
      try {
        const out = execFileSync('git', args, {
          cwd,
          encoding: opts.encoding ?? 'utf8',
          input: opts.input,
          stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
          maxBuffer: 1024 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        return opts.keepTrailing ? out : out.trimEnd();
      } catch (err) {
        const e = err as { status?: number | null; stdout?: string; stderr?: string; code?: string; message: string };
        if (opts.allowFail && e.code !== 'ENOENT') return String(e.stdout ?? '').trimEnd();
        if (e.code === 'ENOENT') throw new Error('git was not found on PATH');
        throw new GitError(args, e.status ?? null, String(e.stderr ?? e.message));
      }
    },
  };
}

/** First line of an error, for one-line summaries. */
export function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n').map((line) => line.replace(/^(fatal|error): /, '').trim()).find(Boolean) ?? 'unknown error';
}

export interface RepoInfo {
  root: string;
  gitDir: string;
  /** Short branch name, or '' when HEAD is detached. */
  branch: string;
  /** HEAD commit, or '' on an unborn branch. */
  head: string;
}

/** Null when cwd is not inside a Git work tree. */
export function repoInfo(git: GitRunner): RepoInfo | null {
  let root: string;
  try {
    root = git.run(['rev-parse', '--show-toplevel']);
  } catch {
    return null;
  }
  if (!root) return null;
  return {
    root,
    gitDir: git.run(['rev-parse', '--absolute-git-dir']),
    branch: git.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }),
    head: git.run(['rev-parse', '--quiet', '--verify', 'HEAD^{commit}'], { allowFail: true }),
  };
}

export function gitPath(git: GitRunner, cwd: string, name: string): string {
  return resolve(cwd, git.run(['rev-parse', '--git-path', name]));
}

const IN_PROGRESS: Array<[string, string]> = [
  ['MERGE_HEAD', 'a merge'],
  ['CHERRY_PICK_HEAD', 'a cherry-pick'],
  ['REVERT_HEAD', 'a revert'],
  ['rebase-merge', 'a rebase'],
  ['rebase-apply', 'a rebase or git am'],
  ['BISECT_LOG', 'a bisect'],
];

/** Describes an unfinished merge, rebase, or similar operation, if any. */
export function operationInProgress(git: GitRunner, cwd: string): string | null {
  for (const [name, label] of IN_PROGRESS) {
    if (existsSync(gitPath(git, cwd, name))) return label;
  }
  return git.run(['ls-files', '--unmerged', '-z']) ? 'unresolved merge conflicts' : null;
}

export function remotePushUrls(git: GitRunner): string[] {
  if (!git.run(['remote'], { allowFail: true }).split('\n').includes('origin')) return [];
  return git.run(['remote', 'get-url', '--push', '--all', 'origin']).split('\n').filter(Boolean);
}

export function hasUpstream(git: GitRunner, branch: string): boolean {
  return Boolean(git.run(['config', '--get', `branch.${branch}.remote`], { allowFail: true }));
}

/** Staged diff for external review, excluding the given paths. */
export function stagedPatch(git: GitRunner, exclude: string[]): string {
  const pathspecs = [':/', ...exclude.map((path) => `:(top,exclude,literal)${path}`)];
  return git.run(['diff', '--cached', '--no-color', '--no-ext-diff', '--no-relative', '--', ...pathspecs]);
}
