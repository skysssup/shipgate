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

/** `YYYY-MM-DD HH:MM` in the author's own time zone, from git's ISO 8601 date. */
function shortDate(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match ? `${match[1]} ${match[2]}` : iso;
}

/** The human report for `shipgate history`: one line per commit, newest first. */
export function formatHistory(report: HistoryReport): string[] {
  if (!report.inGitRepo) return ['shipgate: not inside a Git repository'];
  const where = report.branch ? `branch ${report.branch}` : 'detached HEAD';
  if (!report.commits.length) return [`History of ${where}: no commits yet`];
  const lines = [`History of ${where}, newest first${report.originRef ? ` (origin state from ${report.originRef} as of the last fetch or push)` : ' (no remote-tracking ref for origin)'}`];
  const width = Math.max(...report.commits.map((c) => c.shortSha.length));
  for (const c of report.commits) {
    const origin = c.onOrigin === null ? 'no tracking ref' : c.onOrigin ? 'pushed' : 'local only';
    const marks = [c.shipgate ? '[shipgate]' : '', c.merge ? '[merge]' : ''].filter(Boolean).join(' ');
    lines.push(`  ${c.shortSha.padEnd(width)}  ${shortDate(c.date)}  ${origin.padEnd(15)}  ${c.subject}${marks ? ` ${marks}` : ''} (${c.author})`);
  }
  const head = report.commits[0];
  lines.push(report.undoCandidate
    ? `undo: HEAD ${head.shortSha} is a Shipgate commit; shipgate undo would remove it ${head.onOrigin ? 'locally and from origin' : 'from this branch'} and keep its changes in the working tree`
    : 'undo: does not apply (HEAD is not a non-merge Shipgate commit with a parent on a branch)');
  return lines;
}
