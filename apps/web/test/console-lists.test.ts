import { describe, expect, it } from 'vitest';
import { changeCounts, filterChanges, filterCommits, nextHistoryLimit, PREVIEW_TYPING_DELAY, previewDelay, splitPath } from '../src/console/model';

const changes = [
  { path: 'src/app.ts', status: 'M' },
  { path: 'src/new/Widget.tsx', status: 'A' },
  { path: 'docs/old.md', status: 'D' },
  { path: 'README.md', status: 'M' },
  { path: 'bin/run', status: 'T' },
  { path: 'weird', status: 'X' },
];

describe('changeCounts', () => {
  it('counts each status in A, M, D, T order, then others', () => {
    expect(changeCounts(changes)).toEqual([
      { status: 'A', count: 1 },
      { status: 'M', count: 2 },
      { status: 'D', count: 1 },
      { status: 'T', count: 1 },
      { status: 'X', count: 1 },
    ]);
  });
  it('is empty for no changes', () => {
    expect(changeCounts([])).toEqual([]);
  });
});

describe('filterChanges', () => {
  it('returns everything for an empty query and all statuses', () => {
    expect(filterChanges(changes, '   ')).toEqual(changes);
  });
  it('matches path substrings case-insensitively', () => {
    expect(filterChanges(changes, 'WIDGET').map((c) => c.path)).toEqual(['src/new/Widget.tsx']);
  });
  it('requires every term', () => {
    expect(filterChanges(changes, 'src  ts').map((c) => c.path)).toEqual(['src/app.ts', 'src/new/Widget.tsx']);
    expect(filterChanges(changes, 'src md')).toEqual([]);
  });
  it('limits to one status', () => {
    expect(filterChanges(changes, '', 'M').map((c) => c.path)).toEqual(['src/app.ts', 'README.md']);
    expect(filterChanges(changes, 'src', 'M').map((c) => c.path)).toEqual(['src/app.ts']);
  });
  it('does not modify its input', () => {
    const copy = [...changes];
    filterChanges(changes, 'src', 'A');
    expect(changes).toEqual(copy);
  });
});

describe('splitPath', () => {
  it('splits the directory from the file name', () => {
    expect(splitPath('src/new/Widget.tsx')).toEqual({ dir: 'src/new/', name: 'Widget.tsx' });
  });
  it('has no directory for a top-level file', () => {
    expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' });
  });
  it('keeps a trailing slash with the name (a submodule or directory entry)', () => {
    expect(splitPath('vendor/lib/')).toEqual({ dir: 'vendor/', name: 'lib/' });
    expect(splitPath('lib/')).toEqual({ dir: '', name: 'lib/' });
  });
});

describe('nextHistoryLimit', () => {
  it('asks for one more page while every requested commit came back', () => {
    expect(nextHistoryLimit(30, 30)).toBe(60);
    expect(nextHistoryLimit(180, 180)).toBe(200);
  });
  it('stops at the end of the branch', () => {
    expect(nextHistoryLimit(30, 12)).toBeNull();
    expect(nextHistoryLimit(60, 41)).toBeNull();
  });
  it('stops at the server cap', () => {
    expect(nextHistoryLimit(200, 200)).toBeNull();
  });
});

describe('filterCommits', () => {
  const commits = [
    { sha: 'abc1234ffff', subject: 'Add greet helper', author: 'Ada Lovelace' },
    { sha: 'def5678eeee', subject: 'Fix typo in README', author: 'Grace Hopper' },
    { sha: '0123abcdddd', subject: 'Merge branch main', author: 'Ada Lovelace' },
  ];
  it('returns a copy of everything for an empty query', () => {
    const all = filterCommits(commits, ' ');
    expect(all).toEqual(commits);
    expect(all).not.toBe(commits);
  });
  it('matches subject and author case-insensitively', () => {
    expect(filterCommits(commits, 'readme').map((c) => c.sha)).toEqual(['def5678eeee']);
    expect(filterCommits(commits, 'ada').map((c) => c.sha)).toEqual(['abc1234ffff', '0123abcdddd']);
  });
  it('matches a SHA by prefix only', () => {
    expect(filterCommits(commits, 'ABC1').map((c) => c.sha)).toEqual(['abc1234ffff']);
    expect(filterCommits(commits, '5678')).toEqual([]);
  });
  it('needs at least 4 characters to match a SHA', () => {
    expect(filterCommits(commits, 'abc')).toEqual([]);
    expect(filterCommits(commits, 'abc1').map((c) => c.sha)).toEqual(['abc1234ffff']);
  });
  it('requires every term', () => {
    expect(filterCommits(commits, 'ada merge').map((c) => c.sha)).toEqual(['0123abcdddd']);
  });
});

describe('previewDelay', () => {
  it('waits for a pause after typing a message or task description', () => {
    expect(previewDelay({}, { message: 'F' })).toBe(PREVIEW_TYPING_DELAY);
    expect(previewDelay({ message: 'Fix' }, { message: 'Fi' })).toBe(PREVIEW_TYPING_DELAY);
    expect(previewDelay({ prompt: 'a' }, { prompt: 'ab', confirm: true })).toBe(PREVIEW_TYPING_DELAY);
  });
  it('runs a flag change at once', () => {
    expect(previewDelay({ message: 'Fix' }, { message: 'Fix', forceSecrets: true })).toBe(0);
    expect(previewDelay({ publicOk: true }, {})).toBe(0);
  });
  it('treats a missing field like an empty one', () => {
    expect(previewDelay({ message: '' }, { confirm: true })).toBe(0);
  });
});
