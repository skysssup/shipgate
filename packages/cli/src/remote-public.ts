import { execFileSync } from 'node:child_process';
import { describeRemote, type RemoteVisibility } from '@shipgate/core';

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/** Parse owner/repo from a github.com HTTPS, SSH, or SCP-style URL. */
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

export interface RemoteInfo {
  visibility: RemoteVisibility;
  /** Human-readable destination, e.g. "github.com/acme/app (public)". */
  description: string;
}

/** Returns true for private, false for public, null when visibility cannot be determined. */
export type GithubVisibilityLookup = (ref: GithubRepoRef) => boolean | null;

const RANK: Record<RemoteVisibility, number> = { none: 0, private: 1, 'other-host': 2, unknown: 3, public: 4 };

/**
 * Classify origin's push URLs. The most public classification wins, so one public
 * push URL makes the destination public.
 */
export function classifyRemote(urls: string[], lookup: GithubVisibilityLookup = ghIsPrivate): RemoteInfo {
  if (!urls.length) return { visibility: 'none', description: describeRemote('none', '') };
  let worst: RemoteInfo | null = null;
  for (const url of urls) {
    const ref = parseGithubRemote(url);
    const isPrivate = ref ? lookup(ref) : undefined;
    const visibility: RemoteVisibility = !ref ? 'other-host' : isPrivate === true ? 'private' : isPrivate === false ? 'public' : 'unknown';
    const info = { visibility, description: describeRemote(visibility, ref ? `github.com/${ref.owner}/${ref.repo}` : redactUrl(url)) };
    if (!worst || RANK[info.visibility] > RANK[worst.visibility]) worst = info;
  }
  return worst!;
}

/** Remove credentials embedded in a URL before printing it. */
export function redactUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, '$1');
}

function ghIsPrivate(ref: GithubRepoRef): boolean | null {
  try {
    const out = execFileSync('gh', ['repo', 'view', `${ref.owner}/${ref.repo}`, '--json', 'isPrivate', '-q', '.isPrivate'], {
      encoding: 'utf8',
      timeout: 8_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return out === 'true' ? true : out === 'false' ? false : null;
  } catch {
    return null;
  }
}
