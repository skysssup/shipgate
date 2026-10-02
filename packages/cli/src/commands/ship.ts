import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertSafetyLevel,
  buildCommitMessage,
  clearBusy,
  markBusy,
  planRun,
  scanTextForSecrets,
  shouldDeferShip,
  sweepBusy,
  type SafetyLevel,
} from '@shipgate/core';
import { agentReview } from '../agent-review.js';
import {
  readGlobalConfig,
  readRepoConfig,
  resolveApiKey,
} from '../config.js';
import {
  createGit,
  currentBranch,
  dirtyFiles,
  gitDir,
  gitRoot,
  hasOrigin,
  remoteUrl,
  stagedDiffNames,
  stagedPatch,
} from '../git.js';
import { detectPublicRemote } from '../remote-public.js';
import { loadFilesForScan } from '../scan-workdir.js';

export interface ShipOptions {
  message?: string;
  prompt?: string;
  forceSecrets?: boolean;
  publicOk?: boolean;
  confirm?: boolean;
  cwd?: string;
  git?: ReturnType<typeof createGit>;
  review?: typeof agentReview;
  isPublic?: boolean;
}

export interface ShipResult {
  exitCode: number;
  action: 'ship' | 'hold' | 'block' | 'noop';
  reasons: string[];
  sha?: string;
}

function err(msg: string): void {
  process.stderr.write(`shipgate: ${msg}\n`);
}

export async function runShip(opts: ShipOptions = {}): Promise<ShipResult> {
  const cwd = opts.cwd ?? process.cwd();
  const git = opts.git ?? createGit(cwd);
  const root = gitRoot(git);
  if (!root) {
    err('not a git repository');
    return { exitCode: 0, action: 'noop', reasons: ['not a git repository'] };
  }

  const cfg = readRepoConfig(root);
  if (!cfg || !cfg.enabled) {
    err('not enabled here (shipgate on)');
    return {
      exitCode: 0,
      action: 'block',
      reasons: ['shipgate is not enabled in this repo'],
    };
  }

  const gdirRaw = gitDir(git);
  if (!gdirRaw) {
    return { exitCode: 0, action: 'noop', reasons: ['no git dir'] };
  }
  const gdir = resolve(root, gdirRaw);

  // Check other agents BEFORE marking ourselves — avoids mutual-defer deadlock.
  sweepBusy(gdir);
  if (shouldDeferShip(gdir)) {
    const { live } = sweepBusy(gdir);
    err(`busy: ${live.length} agent(s) mid-turn — shipping deferred`);
    return {
      exitCode: 0,
      action: 'hold',
      reasons: [`${live.length} other agent(s) busy`],
    };
  }

  const indexPath = resolve(root, git.run(['rev-parse', '--git-path', 'index']) || resolve(gdir, 'index'));
  const originalIndex = existsSync(indexPath) ? readFileSync(indexPath) : null;
  let committed = false;
  markBusy(gdir, { label: 'ship' });
  try {

    try {
      git.run(['add', '-A']);
    } catch (e) {
      err(`git add failed: ${(e as Error).message}`);

      return { exitCode: 1, action: 'block', reasons: ['git add failed'] };
    }

    const files = dirtyFiles(git);
    const staged = stagedDiffNames(git);
    const targets = staged.length ? staged : files;

    if (!targets.length) {

      err('nothing to ship');
      return {
        exitCode: 0,
        action: 'noop',
        reasons: ['nothing to ship — working tree clean'],
      };
    }

    const { findings: fileFindings } = loadFilesForScan(root, targets);
    const findings = [...fileFindings];
    // Scan explicit commit message and other secret-bearing free-text inputs.
    if (opts.message) {
      for (const f of scanTextForSecrets(opts.message)) {
        findings.push({ ...f, path: '<commit-message>' });
      }
    }
    if (opts.prompt) {
      for (const f of scanTextForSecrets(opts.prompt)) {
        findings.push({ ...f, path: '<prompt>' });
      }
    }

    const url = remoteUrl(git);
    const publicOk = Boolean(cfg.publicOk || opts.publicOk);
    // Public-remote is a fact; acknowledgement is a separate flag (publicOk).
    const isPublic = detectPublicRemote(url, opts.isPublic);

    let level: SafetyLevel;
    try {
      level = assertSafetyLevel(cfg.level);
    } catch (e) {
      err((e as Error).message);

      return {
        exitCode: 1,
        action: 'block',
        reasons: [(e as Error).message],
      };
    }

    const plan = planRun({
      dirtyFiles: targets,
      findings,
      level,
      flags: {
        forceSecrets: opts.forceSecrets,
        publicOk,
        message: opts.message,
        confirm: opts.confirm,
      },
      isPublicRemote: isPublic,
      busyAgents: 0,
      configPresent: true,
      agentReviewEnabled: cfg.agentReview,
    });

    if (plan.action === 'block') {
      for (const r of plan.reasons) err(r);

      return { exitCode: 0, action: 'block', reasons: plan.reasons };
    }

    if (plan.action === 'hold') {
      for (const r of plan.reasons) err(r);

      return { exitCode: 0, action: 'hold', reasons: plan.reasons };
    }

    let reviewHold = false;
    if (cfg.agentReview && !opts.message) {
      const global = readGlobalConfig();
      const reviewFn = opts.review ?? agentReview;
      const patch = stagedPatch(git);
      const result = await reviewFn({
        apiKey: resolveApiKey(global),
        model: cfg.model || global.model,
        baseUrl: global.baseUrl,
        diffSummary: targets.join('\n'),
        redactedDiff: patch,
        promptText: opts.prompt,
        requireKey: true,
      });
      if (result.failOpen) {
        // Fail-closed when agent review is enabled.
        err(`agent review unavailable: ${result.reason}`);

        return {
          exitCode: 1,
          action: 'hold',
          reasons: [`agent review unavailable: ${result.reason}`],
        };
      } else if (result.decision === 'hold') {
        err(`agent review hold: ${result.reason}`);
        reviewHold = true;
      }
    }

    if (reviewHold) {

      return {
        exitCode: 0,
        action: 'hold',
        reasons: ['agent LLM review requested hold'],
      };
    }

    const { fullMessage, subject } = buildCommitMessage({
      explicitMessage: opts.message,
      promptText: opts.prompt,
      changedFiles: targets,
    });

    try {
      git.run(['commit', '-m', fullMessage]);
      committed = true;
    } catch (e) {
      err(`commit failed: ${(e as Error).message}`);

      return { exitCode: 1, action: 'block', reasons: ['commit failed'] };
    }

    const branch = currentBranch(git);
    const pushed = pushWithRebaseOnce(git, branch);
    if (!pushed.ok) {
      err(pushed.message);
      return {
        exitCode: 0,
        action: 'hold',
        reasons: [pushed.message],
      };
    }

    const sha = git.run(['rev-parse', '--short', 'HEAD'], { allowFail: true });
    err(`shipped ${sha} — ${subject}${pushed.localOnly ? ' (local only)' : ''}`);
    return {
      exitCode: 0,
      action: 'ship',
      reasons: [
        pushed.localOnly
          ? `committed ${sha} locally (no origin)`
          : `shipped ${sha}`,
      ],
      sha,
    };
  } finally {
    try {
      if (!committed) {
        // Exact bytes retain partial staging, deletions and intent-to-add entries.
        const lock = `${indexPath}.lock`;
        const fd = openSync(lock, 'wx');
        try {
          try {
            if (originalIndex !== null) writeFileSync(fd, originalIndex);
          } finally {
            closeSync(fd);
          }
          if (originalIndex === null) rmSync(indexPath, { force: true });
          else renameSync(lock, indexPath);
        } finally {
          rmSync(lock, { force: true });
        }
      }
    } finally {
      clearBusy(gdir);
    }
  }
}

function pushWithRebaseOnce(
  git: ReturnType<typeof createGit>,
  branch: string,
): { ok: boolean; message: string; localOnly?: boolean } {
  if (!hasOrigin(git)) {
    return {
      ok: true,
      message: 'committed locally (no origin remote)',
      localOnly: true,
    };
  }
  try {
    git.run(['push', '-u', 'origin', 'HEAD']);
    return { ok: true, message: 'pushed' };
  } catch {
    try {
      git.run(['fetch', 'origin', branch]);
      git.run(['rebase', `origin/${branch}`]);
      git.run(['push', '-u', 'origin', 'HEAD']);
      return { ok: true, message: 'pushed after rebase' };
    } catch (e2) {
      try {
        git.run(['rebase', '--abort'], { allowFail: true });
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        message: `push/rebase failed — commit kept locally: ${(e2 as Error).message}`,
      };
    }
  }
}
