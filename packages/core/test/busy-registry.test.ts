import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearBusy,
  isPidAlive,
  markBusy,
  shouldDeferShip,
  sweepBusy,
} from '../src/busy-registry.js';

const dirs: string[] = [];

function tmpGitDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'shipgate-busy-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('isPidAlive', () => {
  it('reports current process alive', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });
  it('reports absurd pid dead', () => {
    expect(isPidAlive(999999999)).toBe(false);
  });
});

describe('BusyRegistry', () => {
  it('retains an unreadable live marker and safely sweeps malformed dead markers', () => {
    const gitDir = tmpGitDir();
    const dir = join(gitDir, 'shipgate-busy');
    mkdirSync(dir);
    const livePath = join(dir, `agent-${process.pid}.json`);
    writeFileSync(livePath, 'null');
    writeFileSync(join(dir, 'agent-999999999.json'), 'null');
    const snapshot = sweepBusy(gitDir, { includeSelf: true });
    expect(snapshot.live.some((marker) => marker.pid === process.pid)).toBe(true);
    expect(snapshot.swept).toBe(1);
    expect(existsSync(livePath)).toBe(true);
  });
  it('marks and clears busy', () => {
    const gitDir = tmpGitDir();
    markBusy(gitDir, { pid: process.pid, label: 'test' });
    const snap = sweepBusy(gitDir, { includeSelf: true });
    expect(snap.live.some((m) => m.pid === process.pid)).toBe(true);
    clearBusy(gitDir, process.pid);
    const after = sweepBusy(gitDir, { includeSelf: true });
    expect(after.live).toHaveLength(0);
  });

  it('sweeps dead pid markers', () => {
    const gitDir = tmpGitDir();
    markBusy(gitDir, { pid: 999999999, label: 'ghost' });
    const snap = sweepBusy(gitDir);
    expect(snap.swept).toBeGreaterThanOrEqual(1);
    expect(snap.live).toHaveLength(0);
  });

  it('defers when another live agent exists', () => {
    const gitDir = tmpGitDir();
    // Use current pid as "other" agent, then ask from a fake selfPid
    markBusy(gitDir, { pid: process.pid });
    expect(shouldDeferShip(gitDir, process.pid + 1)).toBe(true);
    clearBusy(gitDir, process.pid);
    expect(shouldDeferShip(gitDir, process.pid + 1)).toBe(false);
  });

  it('does not defer on own marker alone', () => {
    const gitDir = tmpGitDir();
    markBusy(gitDir, { pid: process.pid });
    expect(shouldDeferShip(gitDir, process.pid)).toBe(false);
    clearBusy(gitDir, process.pid);
  });
});
