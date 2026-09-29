import { describe, expect, it } from 'vitest';
import {
  detectPublicRemote,
  parseGithubRemote,
} from '../src/remote-public.js';

describe('parseGithubRemote', () => {
  it('parses ssh and https', () => {
    expect(parseGithubRemote('git@github.com:acme/app.git')).toEqual({
      owner: 'acme',
      repo: 'app',
    });
    expect(
      parseGithubRemote('https://github.com/acme/app.git'),
    ).toEqual({ owner: 'acme', repo: 'app' });
  });

  it('rejects non-github', () => {
    expect(parseGithubRemote('git@gitlab.com:acme/app.git')).toBeNull();
  });
});

describe('detectPublicRemote', () => {
  it('honors override', () => {
    expect(detectPublicRemote('git@github.com:a/b.git', false)).toBe(false);
    expect(detectPublicRemote(null, true)).toBe(true);
  });

  it('treats private via gh callback as not public', () => {
    expect(
      detectPublicRemote('git@github.com:a/b.git', undefined, () => true),
    ).toBe(false);
  });

  it('treats public via gh callback as public', () => {
    expect(
      detectPublicRemote('git@github.com:a/b.git', undefined, () => false),
    ).toBe(true);
  });

  it('assumes public when gh unavailable (safe fallback)', () => {
    expect(
      detectPublicRemote('git@github.com:a/b.git', undefined, () => null),
    ).toBe(true);
  });

  it('does not assume non-github remotes are public', () => {
    expect(
      detectPublicRemote('git@gitlab.com:a/b.git', undefined, () => null),
    ).toBe(false);
  });
});
