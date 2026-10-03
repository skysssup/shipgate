import { scanSecrets, type ScanFile, type SecretFinding } from '@shipgate/core';
import type { GitRunner } from './git.js';

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
  const files = paths.map((path): ScanFile => {
    const entry = entries.get(path);
    // Gitlinks contain only a commit reference; deleted paths have no staged blob.
    if (!entry || entry.mode === '160000') return { path, content: '', missing: true };
    return { path, content: git.run(['cat-file', 'blob', entry.oid]) };
  });
  return { files, findings: scanSecrets(files) };
}
