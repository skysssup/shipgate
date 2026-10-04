import { scanSecrets, type ScanFile, type SecretFinding } from '@shipgate/core';
import type { GitRunner } from './git.js';

const MAX_BLOB_BYTES = 16 * 1024 * 1024;

export interface StagedChange {
  path: string;
  /** Git status letter: A, M, D, T (type change). */
  status: string;
  /** Mode of the staged entry; 160000 is a submodule commit. */
  mode: string;
  /** Object id of the staged blob. */
  oid: string;
}

/** Changes between HEAD (or the empty tree) and the index, for the whole repository. */
export function stagedChanges(git: GitRunner): StagedChange[] {
  return parseRawDiff(git.run(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '--no-relative', '-z', '--', ':/']));
}

/** Changes introduced by HEAD relative to its parent, or to the empty tree for a root commit. */
export function headChanges(git: GitRunner): StagedChange[] {
  return parseRawDiff(git.run(['diff-tree', '-r', '--root', '--raw', '--no-abbrev', '--no-renames', '--no-commit-id', '-z', 'HEAD']));
}

function parseRawDiff(out: string): StagedChange[] {
  const parts = out.split('\0');
  const changes: StagedChange[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = /^:\d+ (\d+) [0-9a-f]+ ([0-9a-f]+) ([A-Z])/.exec(parts[i]);
    if (!meta) throw new Error(`unexpected git diff output: ${JSON.stringify(parts[i])}`);
    if (meta[3] === 'U') throw new Error('the index has unmerged entries');
    changes.push({ path: parts[i + 1], mode: meta[1], oid: meta[2], status: meta[3] });
  }
  return changes;
}

/**
 * Read staged blobs from the object database (not the working tree) and scan them.
 * Deleted paths are checked by filename rules only; submodule commits are not scanned.
 */
export function scanStagedChanges(
  git: GitRunner,
  changes: StagedChange[],
): { findings: SecretFinding[]; skipped: string[] } {
  const files: ScanFile[] = [];
  const skipped: string[] = [];
  const blobs: StagedChange[] = [];
  for (const change of changes) {
    if (change.status === 'D') files.push({ path: change.path, content: '', missing: true });
    else if (change.mode === '160000') skipped.push(change.path);
    else blobs.push(change);
  }
  if (blobs.length) {
    const input = blobs.map((b) => b.oid).join('\n') + '\n';
    const sizes = git.run(['cat-file', '--batch-check'], { input }).split('\n');
    blobs.forEach((blob, i) => {
      const size = Number(sizes[i]?.split(' ')[2]);
      if (!Number.isSafeInteger(size)) throw new Error(`could not read the staged blob for ${JSON.stringify(blob.path)}`);
      if (size > MAX_BLOB_BYTES) {
        throw new Error(`${JSON.stringify(blob.path)} is ${(size / 1024 / 1024).toFixed(1)} MiB; Shipgate scans staged files up to 16 MiB`);
      }
    });
    const raw = git.run(['cat-file', '--batch'], { input, encoding: 'latin1', keepTrailing: true });
    let offset = 0;
    for (const blob of blobs) {
      const headerEnd = raw.indexOf('\n', offset);
      const size = Number(raw.slice(offset, headerEnd).split(' ')[2]);
      const start = headerEnd + 1;
      const content = Buffer.from(raw.slice(start, start + size), 'latin1').toString('utf8');
      files.push({ path: blob.path, content });
      offset = start + size + 1;
    }
  }
  return { findings: scanSecrets(files), skipped };
}
