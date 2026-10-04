import { existsSync, readFileSync } from 'node:fs';
import { formatShipResult, runShip, type ShipOptions, type ShipOutcome, type ShipResult } from './commands/ship.js';
import { createGit, repoInfo } from './git.js';
import { hookStatus } from './hooks.js';

export type HookAgent = 'claude' | 'cursor';

/** Outcomes that are normal in repositories without Shipgate, so hooks stay silent. */
const QUIET_OUTCOMES: ShipOutcome[] = ['not-repository', 'not-enabled', 'nothing-to-ship'];

function readHookPayload(): Record<string, unknown> {
  if (process.stdin.isTTY) return {};
  try {
    const text = readFileSync(0, 'utf8').trim();
    const parsed: unknown = text ? JSON.parse(text) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Claude Code runs Stop hooks in the session's directory and sends it as `cwd`.
 * Cursor runs user hooks from ~/.cursor and sends `workspace_roots` (with a leading
 * slash before Windows drive letters) plus CURSOR_PROJECT_DIR.
 */
function hookDirectories(agent: HookAgent, payload: Record<string, unknown>, env: NodeJS.ProcessEnv): string[] {
  if (agent === 'claude') {
    return [typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : env.CLAUDE_PROJECT_DIR || process.cwd()];
  }
  const roots = Array.isArray(payload.workspace_roots)
    ? payload.workspace_roots.filter((root): root is string => typeof root === 'string' && root.length > 0)
    : [];
  const dirs = roots.length ? roots : [env.CURSOR_PROJECT_DIR || env.CLAUDE_PROJECT_DIR || process.cwd()];
  return dirs.map((dir) => (/^\/[A-Za-z]:[\\/]/.test(dir) ? dir.slice(1) : dir));
}

export interface HookRun {
  exitCode: number;
  stdout: string;
  stderrLines: string[];
  results: ShipResult[];
}

/** Run `shipgate ship` for an agent stop hook and format output for that agent. */
export async function runShipHook(agent: HookAgent, options: ShipOptions): Promise<HookRun> {
  const quietStdout = agent === 'claude' ? '' : '{}';
  if (agent === 'claude' && process.env.CURSOR_VERSION && hookStatus().cursor) {
    return { exitCode: 0, stdout: quietStdout, stderrLines: [], results: [] };
  }
  const payload = readHookPayload();
  const results: ShipResult[] = [];
  const seenRoots = new Set<string>();
  for (const dir of hookDirectories(agent, payload, process.env)) {
    if (!existsSync(dir)) continue;
    const root = repoInfo(createGit(dir))?.root;
    if (!root || seenRoots.has(root)) continue;
    seenRoots.add(root);
    results.push(await runShip({ ...options, cwd: dir }));
  }
  const lines = results.filter((r) => !QUIET_OUTCOMES.includes(r.outcome)).flatMap(formatShipResult);
  const exitCode = Math.max(0, ...results.map((r) => r.exitCode));
  const stdout = agent === 'claude' && lines.length ? JSON.stringify({ systemMessage: lines.join('\n') }) : quietStdout;
  return { exitCode, stdout, stderrLines: lines, results };
}
