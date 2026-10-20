import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCommitMessage,
  detailLine,
  findingLine,
  nextStep,
  planRun,
  scanTextForSecrets,
  sweepBusy,
  type RunPlanInput,
  type RunPlanResult,
  type SecretFinding,
} from '@shipgate/core';
import { loadRepoConfig } from '../config.js';
import { createGit, firstLine, gitPath, operationInProgress, remotePushUrls, repoInfo, type GitRunner } from '../git.js';
import { classifyRemote, type RemoteInfo } from '../remote-public.js';
import { scanStagedChanges, stagedChanges } from '../scan-index.js';
import { inspectShipLock } from '../ship-lock.js';

export interface PreviewOptions {
  message?: string;
  prompt?: string;
  forceSecrets?: boolean;
  publicOk?: boolean;
  confirm?: boolean;
  cwd?: string;
  classifyRemote?: (urls: string[]) => RemoteInfo;
}

/**
 * - `ready`: the policy decision below is what `ship` would apply now.
 * - `not-repository`, `invalid-config`: there is nothing to decide.
 * - `not-enabled`: the decision is the opt-in block `ship` would report.
 * - `unsafe-state`: `ship` would stop before staging (detached HEAD, merge in progress, lock held).
 * - `scan-failed`: the changes could not be read or scanned.
 */
export type PreviewState = 'ready' | 'not-repository' | 'invalid-config' | 'not-enabled' | 'unsafe-state' | 'scan-failed';

export interface PreviewChange {
  path: string;
  /** A (added), M (modified), D (deleted), or T (type change), as `git diff --raw` reports it. */
  status: string;
}

export interface PreviewResult {
  state: PreviewState;
  /** One sentence for the headline. */
  summary: string;
  /** Present unless state is not-repository, invalid-config, or scan-failed. */
  plan?: RunPlanResult;
  branch: string | null;
  remote: string | null;
  changes: PreviewChange[];
  findings: SecretFinding[];
  /** Commit subject ship would use when it commits. */
  subject?: string;
  /** Why ship would stop before the policy runs (unsafe-state, scan-failed, invalid-config). */
  problems: string[];
  notes: string[];
  next?: string;
}

function textFindings(opts: PreviewOptions): SecretFinding[] {
  return [
    ...(opts.message ? scanTextForSecrets(opts.message, '--message') : []),
    ...(opts.prompt ? scanTextForSecrets(opts.prompt, '--prompt') : []),
  ];
}

/**
 * What `shipgate ship` would decide right now, without staging, committing, or pushing.
 * Changes are staged into a scratch copy of the index (GIT_INDEX_FILE), so the real
 * index, partial staging included, is never touched. The blobs that `git add` writes to
 * the object database are the same ones ship would write and are garbage-collected by Git.
 * External review is not called; with review on, the decision says the review is pending.
 */
export function runPreview(opts: PreviewOptions = {}): PreviewResult {
  const cwd = opts.cwd ?? process.cwd();
  const git = createGit(cwd);
  const info = repoInfo(git);
  const base: PreviewResult = { state: 'ready', summary: '', branch: null, remote: null, changes: [], findings: [], problems: [], notes: [] };
  if (!info) return { ...base, state: 'not-repository', summary: 'Not inside a Git repository.' };
  base.branch = info.branch || null;

  const cfg = loadRepoConfig(info.root);
  if (cfg.state === 'invalid') {
    return {
      ...base,
      state: 'invalid-config',
      summary: `.shipgate.json is invalid: ${cfg.error}.`,
      problems: [cfg.error],
      next: `Fix ${cfg.path}, or delete it and run shipgate on.`,
    };
  }
  const remote = (opts.classifyRemote ?? classifyRemote)(remotePushUrls(git));
  base.remote = remote.description;
  const enabled = cfg.state === 'ok' && cfg.config.enabled;
  const level = cfg.state === 'ok' ? cfg.config.level : 'balanced';

  const problems: string[] = [];
  const lock = inspectShipLock(info.gitDir);
  if (lock.state === 'held') problems.push(`Another Shipgate operation (shipgate ${lock.owner?.command ?? 'unknown'}, pid ${lock.owner?.pid ?? '?'}) holds the lock.`);
  if (!info.branch) problems.push('HEAD is detached; ship commits to the current branch.');
  const operation = operationInProgress(git, cwd);
  if (operation) problems.push(`Git is in the middle of ${operation}.`);

  let changes: PreviewChange[] = [];
  let findings: SecretFinding[] = [];
  const notes: string[] = [];
  try {
    const scan = scanWorkingChanges(git, cwd);
    changes = scan.changes;
    findings = [...scan.findings, ...textFindings(opts)];
    if (scan.skipped.length) notes.push(`Submodule contents are not scanned: ${scan.skipped.join(', ')}.`);
  } catch (error) {
    return {
      ...base,
      state: 'scan-failed',
      summary: 'Shipgate could not read or scan the changes.',
      problems: [...problems, firstLine(error)],
      next: 'Fix the cause above, or commit this change yourself.',
    };
  }

  const input: RunPlanInput = {
    configPresent: enabled,
    dirtyFiles: changes.map((c) => c.path),
    findings,
    level,
    flags: {
      forceSecrets: opts.forceSecrets,
      publicOk: Boolean((cfg.state === 'ok' && cfg.config.publicOk) || opts.publicOk),
      confirm: opts.confirm,
      message: opts.message,
    },
    remote: remote.visibility,
    busyAgents: sweepBusy(info.gitDir, { includeSelf: true }).live.length,
    review: { enabled: cfg.state === 'ok' && cfg.config.agentReview },
  };
  const plan = planRun(input);
  const subject = changes.length
    ? buildCommitMessage({ explicitMessage: opts.message, promptText: opts.prompt, changedFiles: input.dirtyFiles }).subject
    : undefined;
  const result: PreviewResult = { ...base, plan, changes, findings, subject, notes, summary: plan.summary, next: nextStep(plan, findings) };
  if (!enabled) {
    result.state = 'not-enabled';
    result.next = cfg.state === 'ok' ? '.shipgate.json has "enabled": false; run shipgate on to enable it again.' : 'Run shipgate on to opt in this repository.';
  } else if (problems.length) {
    result.state = 'unsafe-state';
    result.problems = problems;
    result.summary = `ship would stop before staging: ${problems[0]}`;
    result.next = 'Resolve the problem above; the decision below applies once it is fixed.';
  }
  return result;
}

/** Stage every change into a scratch index and scan it, as ship does after `git add --all`. */
function scanWorkingChanges(git: GitRunner, cwd: string) {
  const scratch = mkdtempSync(join(tmpdir(), 'shipgate-preview-'));
  try {
    const index = join(scratch, 'index');
    const real = gitPath(git, cwd, 'index');
    if (existsSync(real)) copyFileSync(real, index);
    const env = { GIT_INDEX_FILE: index };
    const scoped: GitRunner = { run: (args, o = {}) => git.run(args, { ...o, env: { ...env, ...o.env } }) };
    scoped.run(['add', '--all', '--', ':/']);
    const changes = stagedChanges(scoped);
    const scan = scanStagedChanges(scoped, changes);
    return { changes: changes.map(({ path, status }) => ({ path, status })), findings: scan.findings, skipped: scan.skipped };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const STATE_HEADLINE: Record<PreviewState, string> = {
  ready: 'PREVIEW',
  'not-repository': 'NOT A REPOSITORY',
  'invalid-config': 'CONFIG ERROR',
  'not-enabled': 'NOT ENABLED',
  'unsafe-state': 'HELD',
  'scan-failed': 'HELD',
};

/** Human-readable preview, written to stderr by the CLI. */
export function formatPreview(result: PreviewResult): string[] {
  const action = result.plan ? ` (ship would ${result.plan.action.toUpperCase()})` : '';
  const lines = [`shipgate: ${STATE_HEADLINE[result.state]}${result.state === 'ready' ? action : ''} — ${result.summary}`];
  if (result.state !== 'ready' && result.plan && result.state !== 'not-enabled') lines.push(detailLine('decision', `${result.plan.action}: ${result.plan.summary}`));
  for (const change of result.changes) lines.push(detailLine('change', `${change.status} ${change.path}`));
  for (const finding of [...result.findings].sort((a, b) => a.path.localeCompare(b.path))) lines.push(findingLine(finding));
  for (const problem of result.problems) lines.push(detailLine('problem', problem));
  for (const reason of result.plan?.reasons ?? []) lines.push(detailLine('reason', reason));
  for (const warning of result.plan?.warnings ?? []) lines.push(detailLine('warning', warning));
  for (const advice of result.plan?.recommendations ?? []) lines.push(detailLine('advice', advice));
  for (const note of result.notes) lines.push(detailLine('note', note));
  if (result.subject && result.plan?.action === 'ship') lines.push(detailLine('subject', result.subject));
  if (result.remote) lines.push(detailLine('remote', result.remote));
  if (result.next) lines.push(detailLine('next', result.next));
  lines.push(detailLine('result', 'Preview only: nothing was staged, committed, or pushed.'));
  return lines;
}
