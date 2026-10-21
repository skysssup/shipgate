import { describe, expect, it } from 'vitest';
import { changeCounts, filterChanges, splitPath } from '../src/console/model';

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
