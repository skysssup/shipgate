import { describe, expect, it } from 'vitest';
import { classifyRemote, parseGithubRemote, redactUrl } from '../src/remote-public.js';

describe('parseGithubRemote', () => {
  it.each([
    'git@github.com:acme/app.git',
    'https://github.com/acme/app.git',
    'https://token@github.com/acme/app',
    'ssh://git@github.com/acme/app.git',
    'ssh://git@ssh.github.com:443/acme/app.git',
    'git://github.com/acme/app.git',
  ])('recognizes %s', (url) => {
    expect(parseGithubRemote(url)).toEqual({ owner: 'acme', repo: 'app' });
  });

  it.each(['git@gitlab.com:acme/app.git', 'ssh://git@github.com.example.org/acme/app.git', '/srv/git/app.git', 'https://github.com/acme'])(
    'does not treat %s as GitHub',
    (url) => expect(parseGithubRemote(url)).toBeNull(),
  );
});

describe('classifyRemote', () => {
  const lookup = (answers: Record<string, boolean | null>) => (ref: { owner: string; repo: string }) => answers[`${ref.owner}/${ref.repo}`] ?? null;

  it('reports no origin', () => {
    expect(classifyRemote([], () => true)).toEqual({ visibility: 'none', description: 'no origin remote (commits stay local)' });
  });

  it('uses gh visibility and treats an unanswered lookup as unknown', () => {
    expect(classifyRemote(['git@github.com:acme/private.git'], lookup({ 'acme/private': true })).visibility).toBe('private');
    expect(classifyRemote(['git@github.com:acme/public.git'], lookup({ 'acme/public': false }))).toEqual({
      visibility: 'public',
      description: 'github.com/acme/public (public)',
    });
    expect(classifyRemote(['git@github.com:acme/x.git'], lookup({}))).toEqual({
      visibility: 'unknown',
      description: 'github.com/acme/x (visibility unknown; treated as public)',
    });
  });

  it('labels other hosts without calling gh and hides URL credentials', () => {
    let calls = 0;
    const result = classifyRemote(['https://user:secret@gitlab.example.com/acme/app.git'], () => {
      calls += 1;
      return true;
    });
    expect(calls).toBe(0);
    expect(result).toEqual({ visibility: 'other-host', description: 'https://gitlab.example.com/acme/app.git (not GitHub; visibility not checked)' });
  });

  it('lets the most public push URL decide', () => {
    const answers = lookup({ 'acme/private': true, 'acme/public': false });
    expect(classifyRemote(['/srv/mirror.git', 'git@github.com:acme/private.git'], answers).visibility).toBe('other-host');
    expect(classifyRemote(['git@github.com:acme/private.git', 'https://github.com/acme/public.git'], answers).visibility).toBe('public');
    expect(classifyRemote(['git@github.com:acme/private.git', 'git@github.com:acme/unknown.git'], answers).visibility).toBe('unknown');
  });

  it('redacts userinfo only', () => {
    expect(redactUrl('https://x-access-token:abc@github.com/a/b.git')).toBe('https://github.com/a/b.git');
    expect(redactUrl('git@gitlab.com:a/b.git')).toBe('git@gitlab.com:a/b.git');
  });
});
