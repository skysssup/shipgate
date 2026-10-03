import { scanSecrets, type ScanFile, type SecretFinding } from '@shipgate/core';
import type { GitRunner } from './git.js';

const MAX_BLOB_BYTES = 16 * 1024 * 1024;

/** Read immutable Git blobs from the index rather than mutable working files. */
export function loadStagedFilesForScan(
  git: GitRunner,
  paths: string[],
): { files: ScanFile[]; findings: SecretFinding[] } {
  const entries = new Map<string, { mode: string; oid: string }>();
  for (const entry of git.run(['ls-files', '--stage', '--full-name', '-z', '--', ':/']).split('\0')) {
    if (!entry) continue;
    const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
    if (!match || match[3] !== '0') throw new Error('Cannot scan an unmerged index');
    entries.set(match[4], { mode: match[1], oid: match[2] });
  }
  const deleted = new Set(git.run([
    'diff', '--cached', '--name-only', '--diff-filter=D', '--no-relative', '-z', '--', ':/',
  ]).split('\0').filter(Boolean));
  const files = paths.map((path): ScanFile => {
    const entry = entries.get(path);
    if (!entry) {
      if (deleted.has(path)) return { path, content: '', missing: true };
      throw new Error(`Staged path is missing from the index: ${JSON.stringify(path)}`);
    }
    if (entry.mode === '160000') return { path, content: '', missing: true };
    const size = Number(git.run(['cat-file', '-s', entry.oid]));
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BLOB_BYTES) {
      throw new Error(`Cannot scan ${JSON.stringify(path)}: staged blobs must be at most 16 MiB`);
    }
    return { path, content: git.run(['cat-file', 'blob', entry.oid], { maxBuffer: Math.max(size, 1) }) };
  });
  return { files, findings: scanSecrets(files) };
}
