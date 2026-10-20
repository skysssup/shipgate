import { describe, expect, it } from 'vitest';
import { shipHistory } from '../src/commands/history.js';
import { runShip } from '../src/commands/ship.js';
import { addOrigin, git, repo, tempDir } from './helpers.js';

describe('history', () => {
  it('marks Shipgate commits and whether origin has them', async () => {
    const r = repo();
    addOrigin(r);
    r.write('a.txt', 'a\n');
    expect((await runShip({ cwd: r.dir, message: 'Add a' })).outcome).toBe('pushed');
    r.write('b.txt', 'b\n');
    r.git('add', 'b.txt');
    r.git('commit', '--quiet', '-m', 'Manual b');

    const report = shipHistory({ cwd: r.dir });
    expect(report).toMatchObject({ inGitRepo: true, branch: 'main', originRef: 'refs/remotes/origin/main', undoCandidate: false });
    expect(report.commits.map((c) => [c.subject, c.shipgate, c.onOrigin])).toEqual([
      ['Manual b', false, false],
      ['Add a', true, true],
      ['initial', false, true],
    ]);
    expect(report.commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.commits[0].shortSha.length).toBeLessThan(40);
    expect(Number.isNaN(Date.parse(report.commits[0].date))).toBe(false);
  });

  it('offers undo only when HEAD is a Shipgate commit with a parent', async () => {
    const r = repo();
    expect(shipHistory({ cwd: r.dir }).undoCandidate).toBe(false);
    r.write('a.txt', 'a\n');
    await runShip({ cwd: r.dir, message: 'Add a' });
    const report = shipHistory({ cwd: r.dir });
    expect(report.undoCandidate).toBe(true);
    expect(report.originRef).toBeNull();
    expect(report.commits[0].onOrigin).toBeNull();
  });

  it('limits the number of commits and handles empty and non-repositories', () => {
    const r = repo();
    for (let i = 0; i < 5; i += 1) r.git('commit', '--quiet', '--allow-empty', '-m', `c${i}`);
    expect(shipHistory({ cwd: r.dir, limit: 3 }).commits.map((c) => c.subject)).toEqual(['c4', 'c3', 'c2']);

    const empty = tempDir();
    git(empty, 'init', '--quiet', '-b', 'main');
    expect(shipHistory({ cwd: empty })).toMatchObject({ inGitRepo: true, commits: [], undoCandidate: false });
    expect(shipHistory({ cwd: tempDir() }).inGitRepo).toBe(false);
  });
});
