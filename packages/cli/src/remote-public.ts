import { execFileSync } from 'node:child_process';

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/** Parse owner/repo from a github.com remote URL. */
export function parseGithubRemote(url: string): GithubRepoRef | null {
  const normalized = url.replace(/^git@(github\.com|ssh\.github\.com):/i, 'ssh://git@$1/');
  try {
    const parsed = new URL(normalized.includes('://') ? normalized : `https://${normalized}`);
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)) return null;
    if (!['github.com', 'www.github.com', 'ssh.github.com'].includes(parsed.hostname.toLowerCase())) return null;
    const path = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    return path ? { owner: path[1], repo: path[2] } : null;
  } catch {
    return null;
  }
}

/**
 * Detect whether a remote is public.
 * - Non-GitHub: false (unknown ≠ public)
 * - GitHub + `gh` available: use `gh repo view --json isPrivate`
 * - GitHub without `gh`: assume public (safe for strict)
 */
export function detectPublicRemote(
  url: string | null,
  override?: boolean,
  ghView: (owner: string, repo: string) => boolean | null = ghIsPrivate,
): boolean {
  if (typeof override === 'boolean') return override;
  if (!url) return false;
  const ref = parseGithubRemote(url);
  if (!ref) return false;
  const privateFlag = ghView(ref.owner, ref.repo);
  if (privateFlag === true) return false;
  if (privateFlag === false) return true;
  return true;
}

function ghIsPrivate(owner: string, repo: string): boolean | null {
  try {
    const out = execFileSync(
      'gh',
      ['repo', 'view', `${owner}/${repo}`, '--json', 'isPrivate', '-q', '.isPrivate'],
      {
        encoding: 'utf8',
        timeout: 8_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
    if (out === 'true') return true;
    if (out === 'false') return false;
    return null;
  } catch {
    return null;
  }
}
