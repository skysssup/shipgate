import { hasShipgateTrailer } from '@shipgate/core';
import { createGit, firstLine, operationInProgress, remotePushUrls, repoInfo, type GitRunner } from '../git.js';
import { detail } from '../report.js';
import { acquireShipLock } from '../ship-lock.js';

export type UndoOutcome = 'refused' | 'undone-local' | 'undone-remote' | 'partial';

export interface UndoResult {
  exitCode: number;
  undone: boolean;
  outcome: UndoOutcome;
  reason: string;
  sha?: string;
  branch?: string;
  next?: string;
}

function refuse(reason: string, extra: Partial<UndoResult> = {}): UndoResult {
  return { exitCode: 1, undone: false, outcome: 'refused', reason, ...extra };
}

function succeeds(git: GitRunner, args: string[]): boolean {
  try {
    git.run(args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the last Shipgate commit from the current branch and, when origin has it as
 * the branch tip, from origin. The commit's changes stay in the working tree as
 * unstaged edits. Nothing changes unless every precondition holds; if the remote
 * rewind fails after the local reset, the local reset is rolled back.
 */
export function runUndo(opts: { cwd?: string; git?: GitRunner } = {}): UndoResult {
  const cwd = opts.cwd ?? process.cwd();
  const git = opts.git ?? createGit(cwd);
  const info = repoInfo(git);
  if (!info) return refuse('Not inside a Git repository.');

  const lock = acquireShipLock(info.gitDir, 'undo');
  if (!lock.acquired) {
    return refuse(lock.owner
      ? `Another Shipgate operation (shipgate ${lock.owner.command}, pid ${lock.owner.pid}) holds ${lock.path}.`
      : `${lock.path} exists but does not name a running process.`, {
      next: lock.owner ? 'Run shipgate undo again after it finishes.' : `If no Shipgate process is running, delete ${lock.path}.`,
    });
  }
  try {
    return undoLocked(git, cwd, info.branch, info.head);
  } finally {
    lock.release();
  }
}

function undoLocked(git: GitRunner, cwd: string, branch: string, head: string): UndoResult {
  if (!branch) return refuse('HEAD is detached; undo works on the current branch.', { next: 'Check out the branch that has the Shipgate commit.' });
  if (!head) return refuse(`${branch} has no commits yet.`);
  const sha = head.slice(0, 7);
  const subject = git.run(['log', '-1', '--format=%s', head]);
  if (!hasShipgateTrailer(git.run(['log', '-1', '--format=%B', head]))) {
    return refuse(`HEAD (${sha} "${subject}") was not created by shipgate ship.`, { branch, sha });
  }
  const parents = git.run(['rev-list', '--parents', '-n', '1', head]).split(' ').slice(1);
  if (parents.length !== 1) {
    return refuse(parents.length ? `HEAD (${sha}) is a merge commit; undo only removes ordinary commits.` : `HEAD (${sha}) is the first commit, so there is no earlier state to return to.`, { branch, sha });
  }
  const parent = parents[0];
  if (!succeeds(git, ['diff', '--cached', '--quiet'])) {
    return refuse('There are staged changes. Undo would mix them with the commit\'s changes.', {
      branch,
      sha,
      next: 'Commit or unstage them (git restore --staged <path>), then run shipgate undo again.',
    });
  }
  const operation = operationInProgress(git, cwd);
  if (operation) return refuse(`Git is in the middle of ${operation}.`, { branch, sha });

  let rewindRemote = false;
  if (remotePushUrls(git).length) {
    let remoteTip: string;
    try {
      const ref = `refs/heads/${branch}`;
      const line = git.run(['ls-remote', '--heads', 'origin', ref]).split('\n').find((l) => l.endsWith(`\t${ref}`));
      remoteTip = line?.split('\t')[0] ?? '';
    } catch (error) {
      return refuse(`Could not reach origin to check whether ${sha} was pushed (${firstLine(error)}). Nothing changed.`, {
        branch,
        sha,
        next: `Retry when origin is reachable. To undo only locally, run git reset --mixed ${sha}~1 yourself.`,
      });
    }
    if (remoteTip === head) {
      rewindRemote = true;
    } else if (remoteTip) {
      if (!succeeds(git, ['cat-file', '-e', `${remoteTip}^{commit}`])) {
        try {
          git.run(['fetch', '--quiet', 'origin', `refs/heads/${branch}`]);
        } catch (error) {
          return refuse(`Could not fetch origin/${branch} to compare it with ${sha} (${firstLine(error)}). Nothing changed.`, { branch, sha });
        }
      }
      if (succeeds(git, ['merge-base', '--is-ancestor', head, remoteTip])) {
        return refuse(`origin/${branch} already has newer commits on top of ${sha}; removing it would rewrite shared history. Nothing changed.`, {
          branch,
          sha,
          next: `Use git revert ${sha} to undo the change with a new commit.`,
        });
      }
    }
  }

  try {
    git.run(['reset', '--quiet', '--mixed', parent]);
  } catch (error) {
    return refuse(`git reset failed (${firstLine(error)}). Nothing changed.`, { branch, sha });
  }
  if (!rewindRemote) {
    return {
      exitCode: 0,
      undone: true,
      outcome: 'undone-local',
      reason: `Removed ${sha} "${subject}" from ${branch}; origin never had it. Its changes are now unstaged in the working tree.`,
      sha,
      branch,
    };
  }
  try {
    git.run(['push', '--quiet', `--force-with-lease=refs/heads/${branch}:${head}`, 'origin', `${parent}:refs/heads/${branch}`]);
  } catch (error) {
    const pushError = firstLine(error);
    if (git.run(['rev-parse', 'HEAD']) === parent && succeeds(git, ['reset', '--quiet', '--mixed', head])) {
      return refuse(`origin rejected removing ${sha} from ${branch} (${pushError}). The local commit was restored, so nothing changed.`, {
        branch,
        sha,
        next: `If ${branch} is protected or has moved, use git revert ${sha} instead.`,
      });
    }
    return {
      exitCode: 1,
      undone: true,
      outcome: 'partial',
      reason: `Removed ${sha} locally, but origin still has it (${pushError}), and restoring the local commit failed.`,
      sha,
      branch,
      next: `Run git reset --mixed ${head} to restore the commit locally, or retry the push with git push --force-with-lease=refs/heads/${branch}:${head} origin ${parent}:refs/heads/${branch}.`,
    };
  }
  return {
    exitCode: 0,
    undone: true,
    outcome: 'undone-remote',
    reason: `Removed ${sha} "${subject}" from ${branch} and origin/${branch}. Its changes are now unstaged in the working tree.`,
    sha,
    branch,
  };
}

export function formatUndoResult(result: UndoResult): string[] {
  const headline = result.outcome === 'refused' ? 'NOT UNDONE' : result.outcome === 'partial' ? 'PARTLY UNDONE' : 'UNDONE';
  const lines = [`shipgate: ${headline} — ${result.reason}`];
  if (result.next) lines.push(detail('next', result.next));
  return lines;
}
