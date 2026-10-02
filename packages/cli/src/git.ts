import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';

export interface GitRunner {
  run(args: string[], opts?: { allowFail?: boolean }): string;
}

export function createGit(cwd: string = process.cwd()): GitRunner {
  return {
    run(args, opts = {}) {
      const execOpts: ExecFileSyncOptions = {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      };
      try {
        return String(execFileSync('git', args, execOpts)).trimEnd();
      } catch (err) {
        if (opts.allowFail) {
          const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
          return String(e.stdout ?? '').trimEnd();
        }
        throw err;
      }
    },
  };
}

export function gitRoot(git: GitRunner): string | null {
  try {
    return git.run(['rev-parse', '--show-toplevel']);
  } catch {
    return null;
  }
}

export function gitDir(git: GitRunner): string | null {
  try {
    return git.run(['rev-parse', '--git-dir']);
  } catch {
    return null;
  }
}

/** Parse a git status --porcelain path field (handles renames + quotes). */
export function parsePorcelainPath(pathField: string): string {
  let p = pathField.trim();
  if (p.includes(' -> ')) {
    p = p.slice(p.lastIndexOf(' -> ') + 4).trim();
  }
  if (p.startsWith('"') && p.endsWith('"')) {
    p = p.slice(1, -1).replace(/\\([\\"ntr])/g, (_, ch: string) => {
      if (ch === 'n') return '\n';
      if (ch === 't') return '\t';
      if (ch === 'r') return '\r';
      return ch;
    });
  }
  return p;
}

export function dirtyFiles(git: GitRunner): string[] {
  const out = git.run(['status', '--porcelain'], { allowFail: true });
  if (!out.trim()) return [];
  return out
    .split('\n')
    .map((line) => parsePorcelainPath(line.slice(3)))
    .filter(Boolean);
}

export function stagedDiffNames(git: GitRunner): string[] {
  const out = git.run(['diff', '--cached', '--name-only', '-z'], { allowFail: true });
  if (!out.trim()) return [];
  return out.split('\0').filter(Boolean);
}

export function remoteUrl(git: GitRunner): string | null {
  try {
    return git.run(['remote', 'get-url', 'origin']);
  } catch {
    return null;
  }
}

export function hasOrigin(git: GitRunner): boolean {
  return Boolean(remoteUrl(git));
}

export function currentBranch(git: GitRunner): string {
  return git.run(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }) || 'HEAD';
}

export function headMessage(git: GitRunner): string {
  return git.run(['log', '-1', '--format=%B'], { allowFail: true });
}

export function headSha(git: GitRunner): string {
  return git.run(['rev-parse', 'HEAD'], { allowFail: true });
}

export function parentExists(git: GitRunner): boolean {
  try {
    git.run(['rev-parse', '--verify', 'HEAD~1']);
    return true;
  } catch {
    return false;
  }
}

/** Staged unified diff for optional external review (may be empty). */
export function stagedPatch(git: GitRunner): string {
  return git.run(['diff', '--cached', '--no-color'], { allowFail: true });
}
