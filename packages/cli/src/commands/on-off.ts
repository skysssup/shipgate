import { parseLevel } from '@shipgate/core';
import {
  buildOnConfig,
  readGlobalConfig,
  validateAccount,
  writeGlobalConfig,
  writeRepoConfig,
  removeRepoConfig,
} from '../config.js';
import { createGit, gitRoot, remotePushUrls } from '../git.js';
import { detectPublicRemote } from '../remote-public.js';

function err(msg: string): void {
  process.stderr.write(`shipgate: ${msg}\n`);
}

export interface OnOptions {
  level?: string;
  agent?: boolean;
  publicOk?: boolean;
  account?: string;
  model?: string;
  key?: string;
  cwd?: string;
}

export function runOn(opts: OnOptions = {}): number {
  const cwd = opts.cwd ?? process.cwd();
  const git = createGit(cwd);
  const root = gitRoot(git);
  if (!root) {
    err('not a git repository');
    return 0;
  }

  let level;
  try {
    level = parseLevel(opts.level);
  } catch (e) {
    err((e as Error).message);
    return 1;
  }

  let account: string | undefined;
  try {
    account = validateAccount(opts.account);
  } catch (e) {
    err((e as Error).message);
    return 1;
  }
  if (account) {
    err(
      `note: --account ${account} is recorded for status display only; it does not switch gh credentials`,
    );
  }

  const looksPublic = remotePushUrls(git).some((url) => detectPublicRemote(url));

  if (looksPublic && !opts.publicOk) {
    err(
      'note: remote looks public — pass --public-ok to acknowledge prompts may become public commit subjects',
    );
  }

  if (opts.key) {
    const g = readGlobalConfig();
    g.openRouterApiKey = opts.key;
    writeGlobalConfig(g);
  }

  const cfg = buildOnConfig({
    level,
    agent: opts.agent,
    publicOk: opts.publicOk,
    account,
    model: opts.model,
  });
  if (opts.publicOk) cfg.publicOk = true;

  writeRepoConfig(root, cfg);
  err(
    `enabled (level=${cfg.level}${cfg.agentReview ? ', agent-review' : ''}${cfg.publicOk ? ', public-ok' : ''})`,
  );
  return 0;
}

export function runOff(opts: { cwd?: string } = {}): number {
  const cwd = opts.cwd ?? process.cwd();
  const git = createGit(cwd);
  const root = gitRoot(git);
  if (!root) {
    err('not a git repository');
    return 0;
  }
  removeRepoConfig(root);
  err('disabled');
  return 0;
}
