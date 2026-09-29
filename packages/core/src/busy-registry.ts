import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MARKER_DIR = 'shipgate-busy';
const MARKER_PREFIX = 'agent-';

export interface BusyMarker {
  pid: number;
  startedAt: number;
  label?: string;
}

export interface BusySnapshot {
  live: BusyMarker[];
  swept: number;
}

function markerDir(gitDir: string): string {
  return join(gitDir, MARKER_DIR);
}

function markerPath(gitDir: string, pid: number): string {
  return join(markerDir(gitDir), `${MARKER_PREFIX}${pid}.json`);
}

/** True if a process with the given pid appears alive. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Register the current (or given) pid as a busy agent under the git dir.
 * Returns the marker path written.
 */
export function markBusy(
  gitDir: string,
  opts: { pid?: number; label?: string } = {},
): string {
  const pid = opts.pid ?? process.pid;
  const dir = markerDir(gitDir);
  mkdirSync(dir, { recursive: true });
  const marker: BusyMarker = {
    pid,
    startedAt: Date.now(),
    label: opts.label,
  };
  const path = markerPath(gitDir, pid);
  writeFileSync(path, JSON.stringify(marker), 'utf8');
  return path;
}

/** Remove the busy marker for a pid (default: current process). */
export function clearBusy(gitDir: string, pid: number = process.pid): void {
  const path = markerPath(gitDir, pid);
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

/**
 * Sweep dead-pid markers and return live agents.
 * Does not count the caller's own pid unless `includeSelf` is true.
 */
export function sweepBusy(
  gitDir: string,
  opts: { includeSelf?: boolean; selfPid?: number } = {},
): BusySnapshot {
  const dir = markerDir(gitDir);
  const selfPid = opts.selfPid ?? process.pid;
  const live: BusyMarker[] = [];
  let swept = 0;

  if (!existsSync(dir)) {
    return { live, swept };
  }

  for (const name of readdirSync(dir)) {
    if (!name.startsWith(MARKER_PREFIX) || !name.endsWith('.json')) continue;
    const full = join(dir, name);
    let marker: BusyMarker | null = null;
    try {
      marker = JSON.parse(readFileSync(full, 'utf8')) as BusyMarker;
    } catch {
      try {
        unlinkSync(full);
        swept += 1;
      } catch {
        /* ignore */
      }
      continue;
    }

    if (!isPidAlive(marker.pid)) {
      try {
        unlinkSync(full);
        swept += 1;
      } catch {
        /* ignore */
      }
      continue;
    }

    if (!opts.includeSelf && marker.pid === selfPid) continue;
    live.push(marker);
  }

  return { live, swept };
}

/** True if another live agent holds a busy marker (caller should defer ship). */
export function shouldDeferShip(
  gitDir: string,
  selfPid: number = process.pid,
): boolean {
  const { live } = sweepBusy(gitDir, { includeSelf: false, selfPid });
  return live.length > 0;
}
