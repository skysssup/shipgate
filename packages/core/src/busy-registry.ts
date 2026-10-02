import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const MARKER_DIR = 'shipgate-busy';
const MARKER_PREFIX = 'agent-';

export interface BusyMarker {
  pid: number;
  startedAt: number;
  label?: string;
  /** Random nonce so a replacement marker is not mistaken for the swept one. */
  nonce: string;
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

function randomNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** True if a process with the given pid appears alive. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Atomically register the current (or given) pid as a busy agent.
 * Uses O_EXCL create; if a marker already exists for this pid, refreshes it
 * only when the existing marker is dead or owned by this pid.
 */
export function markBusy(
  gitDir: string,
  opts: { pid?: number; label?: string } = {},
): string {
  const pid = opts.pid ?? process.pid;
  const dir = markerDir(gitDir);
  mkdirSync(dir, { recursive: true });
  const path = markerPath(gitDir, pid);
  const marker: BusyMarker = {
    pid,
    startedAt: Date.now(),
    label: opts.label,
    nonce: randomNonce(),
  };
  const payload = JSON.stringify(marker);
  const tmp = `${path}.${marker.nonce}.tmp`;
  writeFileSync(tmp, payload, 'utf8');
  try {
    // Atomic create — fail if a live marker already claims this path.
    const fd = openSync(path, 'wx');
    closeSync(fd);
    renameSync(tmp, path);
  } catch {
    // Path exists: only replace if stale (dead pid) or same live pid refresh.
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    let existing: BusyMarker | null = null;
    try {
      existing = JSON.parse(readFileSync(path, 'utf8')) as BusyMarker;
    } catch {
      existing = null;
    }
    if (existing && isPidAlive(existing.pid) && existing.pid !== pid) {
      throw new Error(
        `busy marker for pid ${existing.pid} already held at ${path}`,
      );
    }
    // Stale or ours — write via temp + rename (does not unlink a replacement
    // that appeared between read and rename if we re-check nonce below).
    const tmp2 = `${path}.${marker.nonce}.tmp`;
    writeFileSync(tmp2, payload, 'utf8');
    // Re-read: if another process replaced the marker with a new nonce+live pid, abort.
    try {
      const again = JSON.parse(readFileSync(path, 'utf8')) as BusyMarker;
      if (
        again &&
        again.nonce &&
        existing &&
        again.nonce !== existing.nonce &&
        isPidAlive(again.pid) &&
        again.pid !== pid
      ) {
        try {
          unlinkSync(tmp2);
        } catch {
          /* ignore */
        }
        throw new Error(`busy marker raced at ${path}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('busy marker')) throw e;
    }
    renameSync(tmp2, path);
  }
  return path;
}

/** Remove the busy marker for a pid (default: current process). */
export function clearBusy(gitDir: string, pid: number = process.pid): void {
  const path = markerPath(gitDir, pid);
  try {
    // Only delete if the file still names this pid (do not clobber a replacement).
    const raw = readFileSync(path, 'utf8');
    const marker = JSON.parse(raw) as BusyMarker;
    if (marker.pid !== pid) return;
    unlinkSync(path);
  } catch {
    // already gone or unreadable
  }
}

/**
 * Sweep dead-pid markers and return live agents.
 * Re-reads each marker immediately before unlink so a replacement nonce is kept.
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
      if (!marker || typeof marker !== 'object' || !Number.isInteger(marker.pid)) {
        throw new Error('Invalid busy marker');
      }
    } catch {
      // A writer may still be filling its newly created marker. Do not erase it.
      const filenamePid = Number(/^agent-(\d+)\.json$/.exec(name)?.[1]);
      if (isPidAlive(filenamePid)) {
        if (opts.includeSelf || filenamePid !== selfPid) {
          live.push({ pid: filenamePid, startedAt: 0, nonce: 'unreadable' });
        }
        continue;
      }
      try {
        unlinkSync(full);
        swept += 1;
      } catch {
        /* ignore */
      }
      continue;
    }

    if (!isPidAlive(marker.pid)) {
      // Re-check on disk before delete — a live replacement must not be removed.
      try {
        const again = JSON.parse(readFileSync(full, 'utf8')) as BusyMarker;
        if (again.nonce && marker.nonce && again.nonce !== marker.nonce) {
          if (isPidAlive(again.pid)) {
            if (!opts.includeSelf && again.pid === selfPid) continue;
            live.push(again);
            continue;
          }
        }
        if (isPidAlive(again.pid)) {
          if (!opts.includeSelf && again.pid === selfPid) continue;
          live.push(again);
          continue;
        }
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
