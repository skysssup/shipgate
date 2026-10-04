import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, linkSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { isPidAlive } from '@shipgate/core';

const LOCK_FILENAME = 'shipgate-ship.lock';

export interface LockOwner {
  pid: number;
  hostname: string;
  startedAt: number;
  command: string;
  nonce: string;
}

export type LockState =
  | { state: 'free'; path: string }
  | { state: 'held'; path: string; owner: LockOwner | null }
  | { state: 'stale'; path: string; owner: LockOwner };

export type LockAttempt =
  | { acquired: true; release: () => void; recovered: LockOwner | null }
  | { acquired: false; path: string; owner: LockOwner | null };

function readOwner(path: string): LockOwner | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockOwner>;
    if (!Number.isInteger(raw.pid)) return null;
    return {
      pid: raw.pid as number,
      hostname: typeof raw.hostname === 'string' ? raw.hostname : hostname(),
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0,
      command: typeof raw.command === 'string' ? raw.command : 'ship',
      nonce: typeof raw.nonce === 'string' ? raw.nonce : `legacy-${raw.pid}-${raw.startedAt}`,
    };
  } catch {
    return null;
  }
}

/**
 * A lock is stale only when it names a process on this host that no longer runs.
 * Locks from other hosts or with unreadable contents are treated as held. Locks
 * written by Shipgate 1.x have no hostname and are assumed to be local.
 */
export function inspectShipLock(gitDir: string): LockState {
  const path = join(gitDir, LOCK_FILENAME);
  if (!existsSync(path)) return { state: 'free', path };
  const owner = readOwner(path);
  if (owner && owner.hostname === hostname() && !isPidAlive(owner.pid)) return { state: 'stale', path, owner };
  return { state: 'held', path, owner };
}

/** Move a stale lock aside, then delete it only if it is still the lock we inspected. */
function removeStale(path: string, owner: LockOwner): boolean {
  const aside = `${path}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    renameSync(path, aside);
  } catch {
    return false;
  }
  if (readOwner(aside)?.nonce === owner.nonce) {
    rmSync(aside, { force: true });
    return true;
  }
  try {
    linkSync(aside, path);
  } catch {
    // Another process already holds a new lock; the moved file is not ours to keep.
  }
  rmSync(aside, { force: true });
  return false;
}

/** Serialize ship and undo in one worktree, including the wait for external review. */
export function acquireShipLock(gitDir: string, command: 'ship' | 'undo'): LockAttempt {
  const path = join(gitDir, LOCK_FILENAME);
  const owner: LockOwner = {
    pid: process.pid,
    hostname: hostname(),
    startedAt: Date.now(),
    command,
    nonce: randomBytes(8).toString('hex'),
  };
  let recovered: LockOwner | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd: number;
    try {
      fd = openSync(path, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = inspectShipLock(gitDir);
      if (current.state === 'stale' && attempt === 0 && removeStale(path, current.owner)) {
        recovered = current.owner;
        continue;
      }
      return { acquired: false, path, owner: current.state === 'free' ? null : current.owner };
    }
    try {
      writeSync(fd, `${JSON.stringify(owner)}\n`);
    } catch (error) {
      closeSync(fd);
      rmSync(path, { force: true });
      throw error;
    }
    closeSync(fd);
    return {
      acquired: true,
      recovered,
      release: () => {
        if (readOwner(path)?.nonce === owner.nonce) rmSync(path, { force: true });
      },
    };
  }
  return { acquired: false, path, owner: null };
}
