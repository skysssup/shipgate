import { describe, expect, it } from 'vitest';
import {
  buildCommitMessage,
  hasShipgateTrailer,
  SHIPPED_BY_TRAILER,
} from '../src/commit-subject.js';

describe('buildCommitMessage', () => {
  it('prefers explicit -m', () => {
    const r = buildCommitMessage({
      explicitMessage: 'feat: add login',
      promptText: 'ignore me',
      changedFiles: ['a.ts'],
    });
    expect(r.source).toBe('explicit');
    expect(r.subject).toBe('feat: add login');
    expect(r.fullMessage).toContain(SHIPPED_BY_TRAILER);
  });

  it('uses prompt when no -m', () => {
    const r = buildCommitMessage({
      promptText: 'refactor the auth module please',
      changedFiles: ['auth.ts'],
    });
    expect(r.source).toBe('prompt');
    expect(r.subject).toContain('refactor');
  });

  it('never uses prompt containing secrets', () => {
    const r = buildCommitMessage({
      promptText: 'use ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab',
      changedFiles: ['src/a.ts', 'src/b.ts'],
    });
    expect(r.source).toBe('files');
    expect(r.subject).not.toMatch(/ghp_/);
  });

  it('falls back to file list', () => {
    const r = buildCommitMessage({ changedFiles: ['foo.ts', 'bar.ts'] });
    expect(r.source).toBe('files');
    expect(r.subject).toMatch(/^update /);
  });

  it('flattens to one line ≤72 chars', () => {
    const long = 'word '.repeat(40);
    const r = buildCommitMessage({ explicitMessage: long });
    expect(r.subject.includes('\n')).toBe(false);
    expect(r.subject.length).toBeLessThanOrEqual(72);
  });

  it('always adds Shipped-by trailer', () => {
    const r = buildCommitMessage({ explicitMessage: 'x' });
    expect(hasShipgateTrailer(r.fullMessage)).toBe(true);
  });
});

describe('hasShipgateTrailer', () => {
  it('detects trailer', () => {
    expect(hasShipgateTrailer('msg\n\nShipped-by: shipgate\n')).toBe(true);
  });
  it('rejects other trailers', () => {
    expect(hasShipgateTrailer('msg\n\nSigned-off-by: me\n')).toBe(false);
  });
});
