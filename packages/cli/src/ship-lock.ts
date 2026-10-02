import { closeSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Serialize ship operations, including asynchronous external review. */
export function acquireShipLock(gitDir: string): (() => void) | null {
  const path = join(gitDir, 'shipgate-ship.lock');
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }) + '\n');
  } catch (error) {
    closeSync(fd);
    unlinkSync(path);
    throw error;
  }
  return () => {
    closeSync(fd);
    unlinkSync(path);
  };
}
