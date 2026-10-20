import { hasShipgateTrailer } from '@shipgate/core';
import { createGit, repoInfo, type GitRunner } from '../git.js';

export interface HistoryCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  /** ISO 8601 author date. */
  date: string;
  /** The message carries the `Shipped-by: shipgate` trailer. */
  shipgate: boolean;
  merge: boolean;
  /**
   * Whether origin's copy of the branch (the last fetched remote-tracking ref) contains
   * the commit. Null when the branch has no remote-tracking ref.
   */
  onOrigin: boolean | null;
}

export interface HistoryReport {
  inGitRepo: boolean;
  branch: string | null;
  /** refs/remotes/origin/<branch>, when it exists. */
  originRef: string | null;
  commits: HistoryCommit[];
  /** True when HEAD is a non-merge Shipgate commit with a parent: the case `undo` handles. */
  undoCandidate: boolean;
}

const FIELD = '\x1f';
const RECORD = '\x1e';

/** Recent commits on the current branch, newest first, marking the ones Shipgate made. */
export function shipHistory(opts: { cwd?: string; limit?: number; git?: GitRunner } = {}): HistoryReport {
  const git = opts.git ?? createGit(opts.cwd ?? process.cwd());
  const info = repoInfo(git);
  if (!info) return { inGitRepo: false, branch: null, originRef: null, commits: [], undoCandidate: false };
  const limit = Math.max(1, Math.min(opts.limit ?? 30, 200));
  const report: HistoryReport = { inGitRepo: true, branch: info.branch || null, originRef: null, commits: [], undoCandidate: false };
  if (!info.head) return report;

  const originRef = info.branch ? `refs/remotes/origin/${info.branch}` : '';
  const hasOrigin = Boolean(originRef && git.run(['rev-parse', '--quiet', '--verify', `${originRef}^{commit}`], { allowFail: true }));
  report.originRef = hasOrigin ? originRef : null;
  const local = hasOrigin
    ? new Set(git.run(['rev-list', `--max-count=${limit}`, 'HEAD', `^${originRef}`]).split('\n').filter(Boolean))
    : null;

  const out = git.run(['log', `--max-count=${limit}`, `--format=%H${FIELD}%h${FIELD}%P${FIELD}%an${FIELD}%aI${FIELD}%B${RECORD}`, 'HEAD']);
  for (const record of out.split(RECORD)) {
    const trimmed = record.replace(/^\n/, '');
    if (!trimmed) continue;
    const [sha, shortSha, parents, author, date, body = ''] = trimmed.split(FIELD);
    report.commits.push({
      sha,
      shortSha,
      subject: body.split('\n')[0] ?? '',
      author,
      date,
      shipgate: hasShipgateTrailer(body.trimEnd()),
      merge: parents.trim().split(' ').filter(Boolean).length > 1,
      onOrigin: local ? !local.has(sha) : null,
    });
  }
  const head = report.commits[0];
  const headParents = git.run(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').length - 1;
  report.undoCandidate = Boolean(info.branch && head?.shipgate && !head.merge && headParents === 1);
  return report;
}
