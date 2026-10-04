import { sweepBusy, type RemoteVisibility } from '@shipgate/core';
import { loadRepoConfig } from '../config.js';
import { createGit, remotePushUrls, repoInfo } from '../git.js';
import { hookStatus, type HookStatus } from '../hooks.js';
import { classifyRemote, type RemoteInfo } from '../remote-public.js';
import { detail } from '../report.js';
import { inspectShipLock } from '../ship-lock.js';
import { VERSION } from '../version.js';

export interface StatusReport {
  version: string;
  inGitRepo: boolean;
  root: string | null;
  branch: string | null;
  config: { state: 'missing' | 'invalid' | 'ok' | 'not-applicable'; path: string | null; error?: string };
  enabled: boolean;
  level: string | null;
  account: string | null;
  agentReview: boolean;
  publicOk: boolean;
  model: string | null;
  destination: { visibility: RemoteVisibility; description: string } | null;
  hooks: HookStatus;
  busyCount: number;
  lock: { state: 'free' | 'held' | 'stale'; path: string; pid?: number; command?: string; startedAt?: string } | null;
}

export function gatherStatus(cwd: string = process.cwd(), classify: (urls: string[]) => RemoteInfo = classifyRemote): StatusReport {
  const git = createGit(cwd);
  const info = repoInfo(git);
  const report: StatusReport = {
    version: VERSION,
    inGitRepo: Boolean(info),
    root: info?.root ?? null,
    branch: info ? info.branch || null : null,
    config: { state: 'not-applicable', path: null },
    enabled: false,
    level: null,
    account: null,
    agentReview: false,
    publicOk: false,
    model: null,
    destination: null,
    hooks: hookStatus(),
    busyCount: 0,
    lock: null,
  };
  if (!info) return report;

  const cfg = loadRepoConfig(info.root);
  report.config = { state: cfg.state, path: cfg.path, ...(cfg.state === 'invalid' ? { error: cfg.error } : {}) };
  if (cfg.state === 'ok') {
    report.enabled = cfg.config.enabled;
    report.level = cfg.config.level;
    report.account = cfg.config.account ?? null;
    report.agentReview = cfg.config.agentReview;
    report.publicOk = cfg.config.publicOk;
    report.model = cfg.config.model ?? null;
  }
  const remote = classify(remotePushUrls(git));
  report.destination = { visibility: remote.visibility, description: remote.description };
  report.busyCount = sweepBusy(info.gitDir, { includeSelf: true }).live.length;
  const lock = inspectShipLock(info.gitDir);
  report.lock = lock.state === 'free'
    ? { state: 'free', path: lock.path }
    : {
        state: lock.state,
        path: lock.path,
        ...(lock.owner ? { pid: lock.owner.pid, command: lock.owner.command, startedAt: new Date(lock.owner.startedAt).toISOString() } : {}),
      };
  return report;
}

export function formatStatus(report: StatusReport): string[] {
  const lines = [`shipgate ${report.version}`];
  if (!report.inGitRepo) {
    lines.push(detail('repo', 'not inside a Git repository'));
  } else {
    lines.push(detail('repo', `${report.root} (${report.branch ? `branch ${report.branch}` : 'detached HEAD'})`));
    const cfg = report.config;
    lines.push(detail('config', cfg.state === 'ok'
      ? `${report.enabled ? 'enabled' : 'disabled ("enabled": false)'} · ${report.level} · external review ${report.agentReview ? 'on' : 'off'} · public destinations ${report.publicOk ? 'acknowledged' : 'not acknowledged'}`
      : cfg.state === 'invalid'
        ? `INVALID: ${cfg.error} (${cfg.path})`
        : 'not enabled (no .shipgate.json; run shipgate on)'));
    if (report.account) lines.push(detail('account', `${report.account} (display only)`));
    if (report.destination) lines.push(detail('remote', report.destination.description));
    lines.push(detail('busy', `${report.busyCount} agent marker(s)`));
    const lock = report.lock;
    if (lock) {
      lines.push(detail('lock', lock.state === 'free'
        ? 'free'
        : `${lock.state === 'stale' ? 'stale (process gone; the next ship or undo removes it)' : 'held'} by ${lock.command ?? 'unknown'} pid ${lock.pid ?? '?'} since ${lock.startedAt ?? '?'} (${lock.path})`));
    }
  }
  lines.push(detail('hooks', `Claude Code ${report.hooks.claude ? 'installed' : 'not installed'} · Cursor ${report.hooks.cursor ? 'installed' : 'not installed'}`));
  return lines;
}
