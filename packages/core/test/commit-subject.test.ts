import { describe, expect, it } from 'vitest';
import { buildCommitMessage, hasShipgateTrailer, SHIPPED_BY_TRAILER } from '../src/commit-subject.js';

const syntheticGithubToken = ['ghp', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab'].join('_');

describe('buildCommitMessage', () => {
  it('prefers an explicit message over the prompt and files', () => {
    const r = buildCommitMessage({ explicitMessage: 'feat: add login', promptText: 'ignore me', changedFiles: ['a.ts'] });
    expect(r).toEqual({ subject: 'feat: add login', fullMessage: `feat: add login\n\n${SHIPPED_BY_TRAILER}\n`, source: 'explicit' });
  });

  it('keeps an explicit subject and body as written', () => {
    const long = 'fix: '.concat('x'.repeat(90));
    const r = buildCommitMessage({ explicitMessage: `${long}\r\n\r\nBody line one.  \nBody line two.\n` });
    expect(r.subject).toBe(long);
    expect(r.fullMessage).toBe(`${long}\n\nBody line one.\nBody line two.\n\n${SHIPPED_BY_TRAILER}\n`);
  });

  it('appends the trailer to an existing trailer block and never duplicates it', () => {
    expect(buildCommitMessage({ explicitMessage: 'fix: x\n\nSigned-off-by: Ada <ada@example.invalid>' }).fullMessage)
      .toBe(`fix: x\n\nSigned-off-by: Ada <ada@example.invalid>\n${SHIPPED_BY_TRAILER}\n`);
    expect(buildCommitMessage({ explicitMessage: `fix: x\n\n${SHIPPED_BY_TRAILER}` }).fullMessage)
      .toBe(`fix: x\n\n${SHIPPED_BY_TRAILER}\n`);
  });

  it('uses a one-line prompt subject of at most 72 characters', () => {
    const r = buildCommitMessage({ promptText: `refactor the auth module\n${'please '.repeat(20)}`, changedFiles: ['auth.ts'] });
    expect(r.source).toBe('prompt');
    expect(r.subject).toMatch(/^refactor the auth module please/);
    expect(r.subject).not.toContain('\n');
    expect(r.subject.length).toBeLessThanOrEqual(72);
    expect(r.subject.endsWith('…')).toBe(true);
  });

  it('never uses a prompt containing a credential-shaped value', () => {
    const r = buildCommitMessage({ promptText: `use ${syntheticGithubToken}`, changedFiles: ['src/a.ts', 'src/b.ts'] });
    expect(r.source).toBe('files');
    expect(r.subject).toBe('update a.ts, b.ts');
    expect(r.fullMessage).not.toContain('ghp_');
  });

  it('summarizes long file lists and falls back without files', () => {
    const files = Array.from({ length: 7 }, (_, i) => `src/file${i}.ts`);
    expect(buildCommitMessage({ changedFiles: files }).subject).toBe('update file0.ts, file1.ts, file2.ts, file3.ts, file4.ts (+2)');
    expect(buildCommitMessage({})).toMatchObject({ subject: 'shipgate: auto ship', source: 'fallback' });
    expect(buildCommitMessage({ promptText: syntheticGithubToken })).toMatchObject({ source: 'fallback' });
  });
});

describe('hasShipgateTrailer', () => {
  it('detects the trailer on its own line only', () => {
    expect(hasShipgateTrailer('msg\n\nShipped-by: shipgate\n')).toBe(true);
    expect(hasShipgateTrailer('msg\n\nSigned-off-by: me\n')).toBe(false);
    expect(hasShipgateTrailer('mention Shipped-by: shipgate inline')).toBe(false);
  });
});
