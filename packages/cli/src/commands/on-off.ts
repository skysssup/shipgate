import { DEFAULT_LEVEL, parseLevel, type ShipgateConfig } from '@shipgate/core';
import { CONFIG_FILENAME, loadRepoConfig, readGlobalConfig, validateAccount, writeGlobalConfig, writeRepoConfig } from '../config.js';
import { createGit, remotePushUrls, repoInfo, type GitRunner } from '../git.js';
import { classifyRemote, type RemoteInfo } from '../remote-public.js';
import { detail } from '../report.js';

export interface OnOptions {
  level?: string;
  agent?: boolean;
  publicOk?: boolean;
  account?: string;
  model?: string;
  key?: string;
  cwd?: string;
  classifyRemote?: (urls: string[]) => RemoteInfo;
}

export interface CommandResult {
  exitCode: number;
  lines: string[];
}

function isIgnored(git: GitRunner, path: string): boolean {
  try {
    git.run(['check-ignore', '--quiet', '--no-index', path]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enable Shipgate in the current repository. Flags override existing settings;
 * settings without a flag keep their current value (or the default for a new file).
 */
export function runOn(opts: OnOptions = {}): CommandResult {
  const git = createGit(opts.cwd ?? process.cwd());
  const info = repoInfo(git);
  if (!info) return { exitCode: 1, lines: ['shipgate: not inside a Git repository; run shipgate on from the repository you want to enable.'] };

  let level: ShipgateConfig['level'] | undefined;
  let account: string | undefined;
  try {
    level = opts.level === undefined ? undefined : parseLevel(opts.level);
    account = validateAccount(opts.account);
  } catch (error) {
    return { exitCode: 1, lines: [`shipgate: ${(error as Error).message}`] };
  }
  if (opts.model !== undefined && !opts.model.trim()) return { exitCode: 1, lines: ['shipgate: --model needs a model id'] };

  const existing = loadRepoConfig(info.root);
  if (existing.state === 'invalid') {
    return { exitCode: 1, lines: [`shipgate: ${existing.path} is invalid (${existing.error}); fix or delete it, then run shipgate on again.`] };
  }
  const previous = existing.state === 'ok' ? existing.config : undefined;
  const config: ShipgateConfig = {
    enabled: true,
    level: level ?? previous?.level ?? DEFAULT_LEVEL,
    agentReview: opts.agent ?? previous?.agentReview ?? false,
    publicOk: opts.publicOk ?? previous?.publicOk ?? false,
    account: account ?? previous?.account,
    model: opts.model ?? previous?.model,
  };

  const lines: string[] = [];
  if (opts.key) {
    try {
      writeGlobalConfig({ ...readGlobalConfig(), openRouterApiKey: opts.key });
    } catch (error) {
      return { exitCode: 1, lines: [`shipgate: could not store the API key: ${(error as Error).message}`] };
    }
    lines.push(detail('note', 'Stored the API key in ~/.shipgate/config.json. OPENROUTER_API_KEY takes precedence when set.'));
  }
  writeRepoConfig(info.root, config);

  const remote = (opts.classifyRemote ?? classifyRemote)(remotePushUrls(git));
  lines.unshift(
    `shipgate: ${previous ? 'updated' : 'enabled'} ${CONFIG_FILENAME} in ${info.root}`,
    detail('level', config.level),
    detail('review', config.agentReview ? `external review on (model ${config.model ?? 'default'})` : 'external review off'),
    detail('public', config.publicOk ? 'public destinations acknowledged (publicOk)' : 'public destinations not acknowledged'),
    detail('remote', remote.description),
  );
  if (config.account) lines.push(detail('account', `${config.account} (shown by status only; does not switch credentials)`));
  if ((remote.visibility === 'public' || remote.visibility === 'unknown') && !config.publicOk) {
    lines.push(detail('note', config.level === 'strict'
      ? 'strict blocks ships to this destination until you pass --public-ok.'
      : 'ships to this destination print a warning until you pass --public-ok.'));
  }
  if (config.agentReview) {
    lines.push(detail('note', 'External review sends file paths, the redacted staged diff, and --prompt text to the review endpoint.'));
  }
  const rootGit = createGit(info.root);
  if (!isIgnored(rootGit, CONFIG_FILENAME) && !rootGit.run(['ls-files', '--', CONFIG_FILENAME], { allowFail: true })) {
    lines.push(detail('note', `${CONFIG_FILENAME} is not ignored, so the next ship commits it. Add it to .git/info/exclude to keep it local.`));
  }
  return { exitCode: 0, lines };
}

/** Disable Shipgate here. Other settings are kept for the next `shipgate on`. */
export function runOff(opts: { cwd?: string } = {}): CommandResult {
  const git = createGit(opts.cwd ?? process.cwd());
  const info = repoInfo(git);
  if (!info) return { exitCode: 1, lines: ['shipgate: not inside a Git repository.'] };
  const existing = loadRepoConfig(info.root);
  if (existing.state === 'missing') return { exitCode: 0, lines: [`shipgate: not enabled here (no ${CONFIG_FILENAME}); nothing to do.`] };
  if (existing.state === 'invalid') {
    return { exitCode: 1, lines: [`shipgate: ${existing.path} is invalid (${existing.error}); fix or delete it.`] };
  }
  writeRepoConfig(info.root, { ...existing.config, enabled: false });
  return { exitCode: 0, lines: [`shipgate: disabled in ${info.root}; shipgate ship now does nothing here. Settings are kept for shipgate on.`] };
}
