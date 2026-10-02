import { hasShipgateTrailer } from '@shipgate/core';
import {
  createGit,
  currentBranch,
  gitRoot,
  hasOrigin,
  headMessage,
  headSha,
  parentExists,
} from '../git.js';

export interface UndoResult {
  exitCode: number;
  undone: boolean;
  reason: string;
}

function err(msg: string): void {
  process.stderr.write(`shipgate: ${msg}\n`);
}

export function runUndo(opts: { cwd?: string } = {}): UndoResult {
  const cwd = opts.cwd ?? process.cwd();
  const git = createGit(cwd);
  const root = gitRoot(git);
  if (!root) {
    err('not a git repository');
    return { exitCode: 0, undone: false, reason: 'not a git repository' };
  }

  const msg = headMessage(git);
  if (!hasShipgateTrailer(msg)) {
    err('HEAD is not a shipgate commit — refuse');
    return {
      exitCode: 0,
      undone: false,
      reason: 'HEAD is not a shipgate commit',
    };
  }

  if (!parentExists(git)) {
    err('refuse: shipgate commit is the only commit (no parent to reset to)');
    return {
      exitCode: 0,
      undone: false,
      reason: 'no parent commit',
    };
  }

  const sha = headSha(git);
  const branch = currentBranch(git);
  const remote = hasOrigin(git);

  // Local reset FIRST so a failed remote step cannot leave remote rewound
  // while local still points at the shipgate commit.
  try {
    git.run(['reset', '--mixed', 'HEAD~1']);
  } catch (e) {
    err(`local reset failed: ${(e as Error).message}`);
    return { exitCode: 1, undone: false, reason: 'local reset failed' };
  }

  if (remote) {
    try {
      git.run(['push', `--force-with-lease=refs/heads/${branch}:${sha}`, 'origin', `HEAD:refs/heads/${branch}`]);
    } catch (e) {
      err(
        `remote force-with-lease failed after local undo (push manually): ${(e as Error).message}`,
      );
      return {
        exitCode: 1,
        undone: true,
        reason: 'local undid; remote force-with-lease failed',
      };
    }
  }

  const where = remote ? '' : ' (local only — no origin)';
  err(`undid ${sha.slice(0, 7)} — changes left in working tree${where}`);
  return { exitCode: 0, undone: true, reason: `undid ${sha.slice(0, 7)}` };
}
