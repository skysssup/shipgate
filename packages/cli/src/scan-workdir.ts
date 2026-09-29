import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanSecrets, type ScanFile, type SecretFinding } from '@shipgate/core';

/** Build ScanFile list from paths relative to repo root (best-effort read). */
export function loadFilesForScan(
  repoRoot: string,
  paths: string[],
): { files: ScanFile[]; findings: SecretFinding[] } {
  const files: ScanFile[] = [];
  for (const rel of paths) {
    const full = join(repoRoot, rel);
    let content = '';
    try {
      content = readFileSync(full, 'utf8');
    } catch {
      // binary / missing — still scan by path for dotenv rule
      content = '';
    }
    files.push({ path: rel, content });
  }
  return { files, findings: scanSecrets(files) };
}
