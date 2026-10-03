import { resolve } from 'node:path';
import { sweepBusy } from '@shipgate/core';
import { readRepoConfig } from '../config.js';
import { createGit, gitDir, gitRoot } from '../git.js';
import { hookStatus } from '../hooks.js';
import { VERSION } from '../version.js';

export interface StatusReport {
  version: string;
  enabled: boolean;
  level: string | null;
  agentReview: boolean;
  publicOk: boolean;
  hooks: { claude: boolean; cursor: boolean; paths: { claude: string; cursor: string } };
  busyCount: number;
  inGitRepo: boolean;
}

export function gatherStatus(cwd: string = process.cwd()): StatusReport {
  const git = createGit(cwd);
  const root = gitRoot(git);
  const hooks = hookStatus();
  const report: StatusReport = {
    version: VERSION,
    enabled: false,
    level: null,
    agentReview: false,
    publicOk: false,
    hooks,
    busyCount: 0,
    inGitRepo: Boolean(root),
  };

  if (!root) return report;

  const cfg = readRepoConfig(root);
  if (cfg) {
    report.enabled = cfg.enabled;
    report.level = cfg.level;
    report.agentReview = cfg.agentReview;
    report.publicOk = cfg.publicOk;
  }

  const gdirRaw = gitDir(git);
  if (gdirRaw) {
    const gdir = resolve(cwd, gdirRaw);
    const { live } = sweepBusy(gdir, { includeSelf: true });
    report.busyCount = live.length;
  }

  return report;
}

export function printStatus(report: StatusReport, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  const lines = [
    `shipgate ${report.version}`,
    `repo: ${report.inGitRepo ? (report.enabled ? 'enabled' : 'disabled') : 'not a git repo'}`,
    `level: ${report.level ?? '—'}`,
    `agent-review: ${report.agentReview ? 'on' : 'off'}`,
    `public-ok: ${report.publicOk ? 'yes' : 'no'}`,
    `hooks: claude=${report.hooks.claude ? 'yes' : 'no'} cursor=${report.hooks.cursor ? 'yes' : 'no'}`,
    `busy: ${report.busyCount} agent(s)`,
  ];
  process.stderr.write(lines.join('\n') + '\n');
}
