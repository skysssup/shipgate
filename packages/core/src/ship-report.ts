import { buildCommitMessage } from './commit-subject.js';
import { planRun } from './run-plan.js';
import type { PlanAction, RemoteVisibility, ReviewStatus, RunPlanInput, RunPlanResult, SecretFinding } from './types.js';

/** Every way `shipgate ship` can end. */
export type ShipOutcome =
  | 'not-repository'
  | 'not-enabled'
  | 'invalid-config'
  | 'locked'
  | 'busy'
  | 'unsafe-state'
  | 'nothing-to-ship'
  | 'stage-failed'
  | 'scan-failed'
  | 'blocked'
  | 'review-hold'
  | 'review-unavailable'
  | 'index-changed'
  | 'commit-failed'
  | 'hook-changed'
  | 'push-failed'
  | 'committed'
  | 'pushed';

/** The action, exit code, and headline `shipgate ship` reports for each outcome. */
export const SHIP_OUTCOMES: Record<ShipOutcome, { action: PlanAction; exitCode: 0 | 1; headline: string }> = {
  'not-repository': { action: 'noop', exitCode: 0, headline: 'NOT A REPOSITORY' },
  'not-enabled': { action: 'block', exitCode: 0, headline: 'NOT ENABLED' },
  'invalid-config': { action: 'block', exitCode: 1, headline: 'CONFIG ERROR' },
  locked: { action: 'hold', exitCode: 0, headline: 'HELD' },
  busy: { action: 'hold', exitCode: 0, headline: 'HELD' },
  'unsafe-state': { action: 'hold', exitCode: 1, headline: 'HELD' },
  'nothing-to-ship': { action: 'noop', exitCode: 0, headline: 'NOTHING TO SHIP' },
  'stage-failed': { action: 'hold', exitCode: 1, headline: 'FAILED' },
  'scan-failed': { action: 'hold', exitCode: 1, headline: 'HELD' },
  blocked: { action: 'block', exitCode: 0, headline: 'BLOCKED' },
  'review-hold': { action: 'hold', exitCode: 0, headline: 'HELD' },
  'review-unavailable': { action: 'hold', exitCode: 1, headline: 'HELD' },
  'index-changed': { action: 'hold', exitCode: 1, headline: 'HELD' },
  'commit-failed': { action: 'hold', exitCode: 1, headline: 'COMMIT FAILED' },
  'hook-changed': { action: 'block', exitCode: 1, headline: 'COMMITTED, NOT PUSHED' },
  'push-failed': { action: 'ship', exitCode: 1, headline: 'COMMITTED, NOT PUSHED' },
  committed: { action: 'ship', exitCode: 0, headline: 'COMMITTED' },
  pushed: { action: 'ship', exitCode: 0, headline: 'SHIPPED' },
};

/** What happened to the staging area in a run that did not commit. */
export type StagingState = 'untouched' | 'restored' | 'kept-other-change' | 'not-restored';

/** What `shipgate ship` reports; `--json` prints this object. */
export interface ShipResult {
  exitCode: number;
  action: PlanAction;
  outcome: ShipOutcome;
  summary: string;
  reasons: string[];
  warnings: string[];
  recommendations: string[];
  notes: string[];
  findings: SecretFinding[];
  committed: boolean;
  pushed: boolean;
  staging?: StagingState;
  sha?: string;
  branch?: string;
  subject?: string;
  remote?: string;
  review?: ReviewStatus;
  next?: string;
}

const STAGING_TEXT: Record<StagingState, string> = {
  untouched: 'Nothing was staged or committed.',
  restored: 'Nothing was committed. The staging area is back to how it was before the run.',
  'kept-other-change': 'Nothing was committed. Another Git command changed the staging area during the run, so Shipgate kept that version.',
  'not-restored': 'Nothing was committed. Shipgate could not restore the staging area (index.lock exists), so all changes are still staged.',
};

/** Indented, labeled detail line used by every command's human output. */
export function detailLine(label: string, text: string): string {
  return `  ${label.padEnd(9)}${text}`;
}

export function findingLine(finding: SecretFinding): string {
  const where = finding.line ? `${finding.path}:${finding.line}` : finding.path;
  const excerpt = finding.ruleId === 'dotenv-file' ? '' : `  ${finding.excerpt}`;
  return detailLine('finding', `${where}  ${finding.ruleId} (${finding.confidence})${excerpt}`);
}

/** Human-readable report of a ship run, written to stderr by the CLI. */
export function formatShipResult(result: ShipResult): string[] {
  const { headline } = SHIP_OUTCOMES[result.outcome];
  const lines = [`shipgate: ${headline} — ${result.summary}`];
  for (const finding of [...result.findings].sort((a, b) => a.path.localeCompare(b.path))) lines.push(findingLine(finding));
  for (const reason of result.reasons) lines.push(detailLine('reason', reason));
  for (const warning of result.warnings) lines.push(detailLine('warning', warning));
  for (const advice of result.recommendations) lines.push(detailLine('advice', advice));
  for (const note of result.notes) lines.push(detailLine('note', note));
  if (result.sha) lines.push(detailLine('commit', `${result.sha} ${result.subject ?? ''}`.trim()));
  if (result.committed && result.remote && result.outcome !== 'committed') lines.push(detailLine('remote', result.remote));
  if (result.staging && result.outcome !== 'nothing-to-ship' && result.outcome !== 'not-enabled') {
    lines.push(detailLine('result', STAGING_TEXT[result.staging]));
  }
  if (result.next) lines.push(detailLine('next', result.next));
  return lines;
}

/** How `status` and `ship` describe origin. `name` is github.com/owner/repo or a redacted URL. */
export function describeRemote(visibility: RemoteVisibility, name: string): string {
  switch (visibility) {
    case 'none':
      return 'no origin remote (commits stay local)';
    case 'private':
      return `${name} (private)`;
    case 'public':
      return `${name} (public)`;
    case 'unknown':
      return `${name} (visibility unknown; treated as public)`;
    case 'other-host':
      return `${name} (not GitHub; visibility not checked)`;
  }
}

/** The next step `ship` suggests after a decision that stops the run. */
export function nextStep(plan: RunPlanResult, findings: SecretFinding[]): string | undefined {
  switch (plan.code) {
    case 'busy':
      return 'Run shipgate ship again after the other agent finishes.';
    case 'public-destination':
      return 'Pass --public-ok (or run shipgate on --public-ok) if publishing to this destination is intended.';
    case 'credentials': {
      const dotenv = findings.some((f) => f.ruleId === 'dotenv-file') ? ' and keep .env files out of Git (.gitignore)' : '';
      return `Remove the credential${dotenv}, or rerun with --force-secrets if it is a false positive.`;
    }
    case 'review-hold':
      return "Address the reviewer's concern, then run shipgate ship again.";
    case 'review-unavailable':
      return 'Fix the review setup, pass -m to skip review for this run, or run shipgate on --agent=false.';
    default:
      return undefined;
  }
}

/** Summary of a run that committed; it pushed unless there is no origin remote. */
export function shippedSummary(sha: string, branch: string, pushed: boolean): string {
  return pushed
    ? `Pushed ${sha} to origin/${branch}.`
    : `Committed ${sha} on ${branch}. There is no origin remote, so nothing was pushed.`;
}

/** Repository details `simulateShip` cannot know from the decision inputs. */
export interface ShipPlace {
  branch: string;
  /** github.com/owner/repo, or the URL of a non-GitHub remote. */
  remoteName: string;
  /** Short commit id to print for a commit. */
  sha: string;
}

function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The result `shipgate ship` reports for these inputs when every Git step succeeds
 * and the changes were not staged before the run. The review outcome must be decided
 * (or review off): with review pending, the CLI would ask the reviewer at this point.
 */
export function simulateShip(input: RunPlanInput, place: ShipPlace): ShipResult {
  const plan = planRun(input);
  if (plan.code === 'invalid-level') throw new Error(plan.reasons[0]);
  if (plan.review === 'pending') throw new Error('simulateShip needs a review outcome when review is on.');
  const remote = describeRemote(input.remote, place.remoteName);
  const result = (outcome: ShipOutcome, extra: Partial<ShipResult> = {}): ShipResult => ({
    exitCode: SHIP_OUTCOMES[outcome].exitCode,
    action: SHIP_OUTCOMES[outcome].action,
    outcome,
    summary: plan.summary,
    reasons: plan.reasons,
    warnings: plan.warnings,
    recommendations: plan.recommendations,
    notes: [],
    findings: [],
    committed: false,
    pushed: false,
    review: plan.review,
    ...extra,
  });
  const next = nextStep(plan, input.findings);
  const stopped = { findings: input.findings, branch: place.branch, remote, staging: 'restored' as const, next };
  switch (plan.code) {
    case 'not-enabled':
      return result('not-enabled');
    case 'busy':
      return result('busy', { staging: 'untouched', next });
    case 'nothing-to-ship':
      return result('nothing-to-ship', { branch: place.branch, staging: 'untouched' });
    case 'credentials':
    case 'public-destination':
      return result('blocked', stopped);
    case 'review-hold':
    case 'review-unavailable':
      return result(plan.code, stopped);
  }
  const pushed = input.remote !== 'none';
  const { subject } = buildCommitMessage({
    explicitMessage: input.flags.message,
    changedFiles: [...input.dirtyFiles].sort(byPath),
  });
  return result(pushed ? 'pushed' : 'committed', {
    summary: shippedSummary(place.sha, place.branch, pushed),
    findings: input.findings,
    branch: place.branch,
    remote,
    sha: place.sha,
    subject,
    committed: true,
    pushed,
  });
}
