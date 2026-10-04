import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import {
  buildCommitMessage,
  clearBusy,
  markBusy,
  planRun,
  scanTextForSecrets,
  sweepBusy,
  type RunPlanInput,
  type RunPlanResult,
  type SecretFinding,
  type ShipgateConfig,
} from '@shipgate/core';
import { requestReview, type ReviewRequest, type ReviewResponse } from '../agent-review.js';
import { loadRepoConfig, readGlobalConfig, resolveApiKey } from '../config.js';
import {
  createGit,
  firstLine,
  gitPath,
  hasUpstream,
  operationInProgress,
  remotePushUrls,
  repoInfo,
  stagedPatch,
  type GitRunner,
} from '../git.js';
import { classifyRemote, type RemoteInfo } from '../remote-public.js';
import { detail, findingLine } from '../report.js';
import { headChanges, scanStagedChanges, stagedChanges, type StagedChange } from '../scan-index.js';
import { acquireShipLock } from '../ship-lock.js';

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

const OUTCOMES: Record<ShipOutcome, { action: ShipResult['action']; exitCode: number; headline: string }> = {
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

export interface ShipOptions {
  message?: string;
  prompt?: string;
  forceSecrets?: boolean;
  publicOk?: boolean;
  confirm?: boolean;
  cwd?: string;
  /** Replaceable for tests. */
  git?: GitRunner;
  review?: (request: ReviewRequest) => Promise<ReviewResponse>;
  classifyRemote?: (urls: string[]) => RemoteInfo;
}

/** What happened to the staging area in a run that did not commit. */
export type StagingState = 'untouched' | 'restored' | 'kept-other-change' | 'not-restored';

export interface ShipResult {
  exitCode: number;
  action: 'ship' | 'hold' | 'block' | 'noop';
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
  review?: RunPlanResult['review'];
  next?: string;
}

type Draft = Omit<ShipResult, 'exitCode' | 'action'>;

function draft(outcome: ShipOutcome, summary: string, extra: Partial<Draft> = {}): Draft {
  return {
    outcome,
    summary,
    reasons: [],
    warnings: [],
    recommendations: [],
    notes: [],
    findings: [],
    committed: false,
    pushed: false,
    ...extra,
  };
}

function finish(d: Draft): ShipResult {
  return { exitCode: OUTCOMES[d.outcome].exitCode, action: OUTCOMES[d.outcome].action, ...d };
}

/** Evaluate core policy for the facts known so far. Gates run in the same order as planRun. */
function decide(over: Partial<RunPlanInput>): RunPlanResult {
  return planRun({
    configPresent: true,
    dirtyFiles: ['(pending)'],
    findings: [],
    level: 'balanced',
    flags: {},
    remote: 'none',
    busyAgents: 0,
    review: { enabled: false },
    ...over,
  });
}

function fromPlan(outcome: ShipOutcome, plan: RunPlanResult, extra: Partial<Draft> = {}): Draft {
  return draft(outcome, plan.summary, {
    reasons: plan.reasons,
    warnings: plan.warnings,
    recommendations: plan.recommendations,
    review: plan.review,
    ...extra,
  });
}

interface Transaction {
  indexPath: string;
  originalIndex: Buffer | null;
  stagedIndex?: Buffer | null;
  committed: boolean;
}

function readIndex(path: string): Buffer | null {
  return existsSync(path) ? readFileSync(path) : null;
}

function sameIndex(a: Buffer | null | undefined, b: Buffer | null): boolean {
  return a === null ? b === null : a !== undefined && b !== null && a.equals(b);
}

/**
 * Put back the index bytes from before `git add -A`, which preserves partial staging,
 * intent-to-add entries, and deletions. Skipped when another process changed the index.
 */
function restoreIndex(tx: Transaction): StagingState {
  if (tx.stagedIndex === undefined) return 'untouched';
  const current = readIndex(tx.indexPath);
  if (!sameIndex(tx.stagedIndex, current)) return 'kept-other-change';
  if (sameIndex(tx.originalIndex, current)) return 'untouched';
  const lock = `${tx.indexPath}.lock`;
  let fd: number;
  try {
    fd = openSync(lock, 'wx');
  } catch {
    return 'not-restored';
  }
  try {
    if (tx.originalIndex) writeSync(fd, tx.originalIndex);
    closeSync(fd);
    if (tx.originalIndex) renameSync(lock, tx.indexPath);
    else rmSync(tx.indexPath, { force: true });
    return 'restored';
  } catch {
    return 'not-restored';
  } finally {
    rmSync(lock, { force: true });
  }
}

function changedPaths(changes: StagedChange[]): string[] {
  return changes.map((c) => c.path);
}

function textFindings(opts: ShipOptions): SecretFinding[] {
  return [
    ...(opts.message ? scanTextForSecrets(opts.message, '--message') : []),
    ...(opts.prompt ? scanTextForSecrets(opts.prompt, '--prompt') : []),
  ];
}

type PushResult = { ok: true; rebased: boolean } | { ok: false; rebased: boolean; error: string };

/**
 * Push HEAD to origin/<branch>. When the push is rejected because origin has new
 * commits, fetch, rebase once (never across merge commits), and push again.
 */
function pushBranch(git: GitRunner, branch: string): PushResult {
  const target = `HEAD:refs/heads/${branch}`;
  const pushArgs = hasUpstream(git, branch) ? ['push', 'origin', target] : ['push', '--set-upstream', 'origin', target];
  let pushError: unknown;
  try {
    git.run(pushArgs);
    return { ok: true, rebased: false };
  } catch (error) {
    pushError = error;
  }
  let remoteTip: string;
  try {
    git.run(['fetch', '--quiet', 'origin', `refs/heads/${branch}`]);
    remoteTip = git.run(['rev-parse', 'FETCH_HEAD']);
  } catch {
    return { ok: false, rebased: false, error: firstLine(pushError) };
  }
  if (git.run(['rev-list', '--count', `HEAD..${remoteTip}`]) === '0') {
    return { ok: false, rebased: false, error: firstLine(pushError) };
  }
  if (git.run(['rev-list', '--merges', `${remoteTip}..HEAD`])) {
    return { ok: false, rebased: false, error: `origin/${branch} has new commits and local history contains merges, so Shipgate did not rebase` };
  }
  try {
    git.run(['rebase', '--quiet', remoteTip]);
  } catch (error) {
    git.run(['rebase', '--abort'], { allowFail: true });
    return { ok: false, rebased: false, error: `origin/${branch} has new commits and rebasing onto them failed (${firstLine(error)}); the rebase was aborted` };
  }
  try {
    git.run(pushArgs);
    return { ok: true, rebased: true };
  } catch (error) {
    return { ok: false, rebased: true, error: firstLine(error) };
  }
}

export async function runShip(opts: ShipOptions = {}): Promise<ShipResult> {
  const cwd = opts.cwd ?? process.cwd();
  const git = opts.git ?? createGit(cwd);
  const info = repoInfo(git);
  if (!info) return finish(draft('not-repository', 'Not inside a Git repository.'));

  const cfg = loadRepoConfig(info.root);
  if (cfg.state === 'invalid') {
    return finish(draft('invalid-config', `.shipgate.json is invalid: ${cfg.error}.`, {
      next: `Fix ${cfg.path}, or delete it and run shipgate on.`,
    }));
  }
  if (cfg.state === 'missing' || !cfg.config.enabled) {
    return finish(fromPlan('not-enabled', decide({ configPresent: false }), {
      next: cfg.state === 'ok' ? '.shipgate.json has "enabled": false; run shipgate on to enable it again.' : undefined,
    }));
  }
  const config = cfg.config;

  const lock = acquireShipLock(info.gitDir, 'ship');
  if (!lock.acquired) {
    const owner = lock.owner;
    return finish(draft('locked', 'Another Shipgate operation is running in this worktree.', {
      reasons: [owner
        ? `shipgate ${owner.command} (pid ${owner.pid} on ${owner.hostname || 'unknown host'}, started ${new Date(owner.startedAt).toISOString()}) holds ${lock.path}.`
        : `${lock.path} exists but does not name a running process.`],
      next: owner ? 'Run shipgate ship again after it finishes.' : `If no Shipgate process is running, delete ${lock.path}.`,
    }));
  }

  const tx: Transaction = { indexPath: gitPath(git, cwd, 'index'), originalIndex: null, committed: false };
  let result: Draft | undefined;
  try {
    result = await shipLocked(opts, git, cwd, info, config, tx);
  } finally {
    const staging = tx.committed ? undefined : restoreIndex(tx);
    clearBusy(info.gitDir);
    lock.release();
    if (staging && result) result.staging = staging;
  }
  if (lock.recovered) {
    const r = lock.recovered;
    result.notes.unshift(`Removed a stale lock from shipgate ${r.command} (pid ${r.pid}, started ${new Date(r.startedAt).toISOString()}), which is no longer running.`);
  }
  return finish(result);
}

async function shipLocked(
  opts: ShipOptions,
  git: GitRunner,
  cwd: string,
  info: NonNullable<ReturnType<typeof repoInfo>>,
  config: ShipgateConfig,
  tx: Transaction,
): Promise<Draft> {
  const branch = info.branch;
  const { live } = sweepBusy(info.gitDir);
  if (live.length) {
    return fromPlan('busy', decide({ busyAgents: live.length }), {
      next: 'Run shipgate ship again after the other agent finishes.',
    });
  }
  if (!branch) {
    return draft('unsafe-state', 'HEAD is detached.', {
      reasons: ['Shipgate commits to the current branch and pushes it; HEAD is not on a branch.'],
      next: 'Check out a branch (git switch <branch>) and run shipgate ship again.',
    });
  }
  const operation = operationInProgress(git, cwd);
  if (operation) {
    return draft('unsafe-state', `Git is in the middle of ${operation}.`, {
      reasons: ['Staging everything now could commit conflict markers or half-applied changes.'],
      next: 'Finish or abort that operation, then run shipgate ship again.',
      branch,
    });
  }

  tx.originalIndex = readIndex(tx.indexPath);
  markBusy(info.gitDir, { label: 'ship' });
  let scannedTree: string;
  try {
    git.run(['add', '--all']);
    scannedTree = git.run(['write-tree']);
  } catch (error) {
    tx.stagedIndex = readIndex(tx.indexPath);
    return draft('stage-failed', 'git add --all failed, so nothing was scanned or committed.', { reasons: [firstLine(error)], branch });
  }
  tx.stagedIndex = readIndex(tx.indexPath);

  let changes: StagedChange[];
  let findings: SecretFinding[];
  const notes: string[] = [];
  try {
    changes = stagedChanges(git);
    if (!changes.length) {
      return fromPlan('nothing-to-ship', decide({ dirtyFiles: [] }), { branch });
    }
    const scan = scanStagedChanges(git, changes);
    findings = [...scan.findings, ...textFindings(opts)];
    if (scan.skipped.length) notes.push(`Submodule contents are not scanned: ${scan.skipped.join(', ')}.`);
  } catch (error) {
    return draft('scan-failed', 'Shipgate could not scan the staged changes.', {
      reasons: [firstLine(error)],
      next: 'Fix the cause above, or commit this change yourself.',
      branch,
    });
  }

  const remote = (opts.classifyRemote ?? classifyRemote)(remotePushUrls(git));
  const input: RunPlanInput = {
    configPresent: true,
    dirtyFiles: changedPaths(changes),
    findings,
    level: config.level,
    flags: {
      forceSecrets: opts.forceSecrets,
      publicOk: Boolean(config.publicOk || opts.publicOk),
      confirm: opts.confirm,
      message: opts.message,
    },
    remote: remote.visibility,
    busyAgents: 0,
    review: { enabled: config.agentReview },
  };
  let plan = planRun(input);
  const context = { findings, branch, remote: remote.description, notes };
  if (plan.action === 'block') {
    return fromPlan('blocked', plan, {
      ...context,
      next: plan.code === 'public-destination'
        ? 'Pass --public-ok (or run shipgate on --public-ok) if publishing to this destination is intended.'
        : `Remove the credential${findings.some((f) => f.ruleId === 'dotenv-file') ? ' and keep .env files out of Git (.gitignore)' : ''}, or rerun with --force-secrets if it is a false positive.`,
    });
  }

  if (plan.review === 'pending') {
    let response: ReviewResponse;
    try {
      const global = readGlobalConfig();
      const omittedFiles = findings.filter((f) => f.ruleId === 'dotenv-file').map((f) => f.path);
      response = await (opts.review ?? requestReview)({
        apiKey: resolveApiKey(global),
        model: config.model || global.model,
        baseUrl: global.baseUrl,
        changedFiles: input.dirtyFiles,
        diff: stagedPatch(git, omittedFiles),
        omittedFiles,
        prompt: opts.prompt,
      });
    } catch (error) {
      response = { outcome: 'unavailable', detail: firstLine(error) };
    }
    plan = planRun({ ...input, review: { enabled: true, outcome: response.outcome, detail: response.detail } });
    if (plan.code === 'review-hold') {
      return fromPlan('review-hold', plan, { ...context, next: "Address the reviewer's concern, then run shipgate ship again." });
    }
    if (plan.code === 'review-unavailable') {
      return fromPlan('review-unavailable', plan, {
        ...context,
        next: 'Fix the review setup, pass -m to skip review for this run, or run shipgate on --agent=false.',
      });
    }
    if (!sameIndex(tx.stagedIndex, readIndex(tx.indexPath))) {
      return draft('index-changed', 'The staging area changed while Shipgate waited for review.', {
        ...context,
        reasons: ['Another Git command changed the index, so the reviewed content is not what would be committed.'],
        next: 'Run shipgate ship again.',
      });
    }
  }

  const message = buildCommitMessage({ explicitMessage: opts.message, promptText: opts.prompt, changedFiles: input.dirtyFiles });
  try {
    git.run(['commit', '--quiet', '--file=-'], { input: message.fullMessage });
  } catch (error) {
    const hookOutput = (error instanceof Error ? error.message : String(error)).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
    return fromPlan('commit-failed', plan, {
      ...context,
      summary: 'git commit failed, so nothing was committed or pushed.',
      reasons: hookOutput.length ? hookOutput : ['git commit exited with an error'],
      next: 'Fix what the commit hook or Git reported, then run shipgate ship again.',
    });
  }
  tx.committed = true;
  const sha = git.run(['rev-parse', '--short', 'HEAD']);
  const committedFacts = { ...context, sha, subject: message.subject, committed: true };

  if (git.run(['rev-parse', 'HEAD^{tree}']) !== scannedTree) {
    const committedChanges = headChanges(git);
    const committedFindings = [...scanStagedChanges(git, committedChanges).findings, ...textFindings(opts)];
    const recheck = planRun({
      ...input,
      dirtyFiles: changedPaths(committedChanges),
      findings: committedFindings,
      review: plan.review === 'approved' ? { enabled: true, outcome: 'approve' } : input.review,
    });
    if (recheck.action !== 'ship') {
      return fromPlan('hook-changed', recheck, {
        ...committedFacts,
        findings: committedFindings,
        summary: 'A commit hook changed the files after the scan, and the committed version does not pass the policy.',
        next: 'The commit is local and was not pushed. Run shipgate undo to remove it (your files stay), fix the content, and ship again.',
      });
    }
    notes.push('A commit hook changed the staged files; Shipgate rescanned the commit before pushing.');
  }

  if (remote.visibility === 'none') {
    return fromPlan('committed', plan, {
      ...committedFacts,
      summary: `Committed ${sha} on ${branch}. There is no origin remote, so nothing was pushed.`,
    });
  }
  const pushed = pushBranch(git, branch);
  const finalSha = git.run(['rev-parse', '--short', 'HEAD']);
  if (pushed.rebased) notes.push(`Rebased onto new commits from origin/${branch} before pushing.`);
  if (!pushed.ok) {
    return fromPlan('push-failed', plan, {
      ...committedFacts,
      sha: finalSha,
      summary: `Committed ${finalSha} on ${branch}, but the push to origin failed.`,
      reasons: [pushed.error],
      next: `The commit is in your local ${branch} branch. Fix the problem and run git push origin ${branch}, or run shipgate undo to remove the commit and keep the changes.`,
    });
  }
  return fromPlan('pushed', plan, {
    ...committedFacts,
    sha: finalSha,
    pushed: true,
    summary: `Pushed ${finalSha} to origin/${branch}.`,
  });
}

const STAGING_TEXT: Record<StagingState, string> = {
  untouched: 'Nothing was staged or committed.',
  restored: 'Nothing was committed. The staging area is back to how it was before the run.',
  'kept-other-change': 'Nothing was committed. Another Git command changed the staging area during the run, so Shipgate kept that version.',
  'not-restored': 'Nothing was committed. Shipgate could not restore the staging area (index.lock exists), so all changes are still staged.',
};

/** Human-readable report, written to stderr by the CLI. */
export function formatShipResult(result: ShipResult): string[] {
  const { headline } = OUTCOMES[result.outcome];
  const lines = [`shipgate: ${headline} — ${result.summary}`];
  for (const finding of [...result.findings].sort((a, b) => a.path.localeCompare(b.path))) lines.push(findingLine(finding));
  for (const reason of result.reasons) lines.push(detail('reason', reason));
  for (const warning of result.warnings) lines.push(detail('warning', warning));
  for (const advice of result.recommendations) lines.push(detail('advice', advice));
  for (const note of result.notes) lines.push(detail('note', note));
  if (result.sha) lines.push(detail('commit', `${result.sha} ${result.subject ?? ''}`.trim()));
  if (result.committed && result.remote && result.outcome !== 'committed') lines.push(detail('remote', result.remote));
  if (result.staging && result.outcome !== 'nothing-to-ship' && result.outcome !== 'not-enabled') {
    lines.push(detail('result', STAGING_TEXT[result.staging]));
  }
  if (result.next) lines.push(detail('next', result.next));
  return lines;
}
