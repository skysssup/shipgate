import { describe, expect, it } from 'vitest';
import { formatHistory, shipHistory } from '../src/commands/history.js';
import { runShip } from '../src/commands/ship.js';
import { addOrigin, cli, git, repo, tempDir } from './helpers.js';

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

describe('shipgate history', () => {
  it('lists commits newest first with Shipgate, origin, and undo state', async () => {
    const r = repo();
    addOrigin(r);
    r.write('a.txt', 'a\n');
    expect((await runShip({ cwd: r.dir, message: 'Add a' })).outcome).toBe('pushed');
    const run = cli(r.dir, ['history']);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines[0]).toBe('History of branch main, newest first (origin state from refs/remotes/origin/main as of the last fetch or push)');
    expect(lines[1]).toMatch(/^ {2}[0-9a-f]{7,} {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2} {2}pushed {11}Add a \[shipgate\] \(Shipgate Test\)$/);
    expect(lines[2]).toMatch(/pushed {11}initial \(Shipgate Test\)$/);
    expect(lines[3]).toMatch(/^undo: HEAD [0-9a-f]+ is a Shipgate commit; shipgate undo would remove it locally and from origin/);
    expect(lines).toHaveLength(4);
  });

  it('prints the same report as JSON and honours --limit', () => {
    const r = repo();
    for (let i = 0; i < 4; i += 1) r.git('commit', '--quiet', '--allow-empty', '-m', `c${i}`);
    const run = cli(r.dir, ['history', '--json', '--limit', '2']);
    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout);
    expect(report).toEqual(shipHistory({ cwd: r.dir, limit: 2 }));
    expect(report.commits.map((c: { subject: string }) => c.subject)).toEqual(['c3', 'c2']);
    expect(report).toMatchObject({ inGitRepo: true, branch: 'main', originRef: null, undoCandidate: false });
    expect(cli(r.dir, ['history', '--limit=1']).stdout).toContain('no tracking ref');
  });

  it('rejects a bad --limit and handles empty and non-repositories', () => {
    const r = repo();
    for (const bad of ['0', '201', '-1', 'x', '2.5']) {
      const run = cli(r.dir, ['history', `--limit=${bad}`]);
      expect(run.status, bad).toBe(1);
      expect(run.stderr).toContain('--limit expects a number from 1 to 200');
      expect(run.stdout).toBe('');
    }
    expect(cli(r.dir, ['history', '--all']).stderr).toContain("unknown option --all for 'history'");

    const empty = tempDir();
    git(empty, 'init', '--quiet', '-b', 'main');
    expect(cli(empty, ['history'])).toMatchObject({ status: 0, stdout: 'History of branch main: no commits yet\n' });
    const outside = cli(tempDir(), ['history', '--json']);
    expect(outside.status).toBe(0);
    expect(JSON.parse(outside.stdout)).toEqual({ inGitRepo: false, branch: null, originRef: null, commits: [], undoCandidate: false });
    expect(cli(tempDir(), ['history']).stdout).toBe('shipgate: not inside a Git repository\n');
  });

  it('formats merges, detached HEAD, and local-only commits', () => {
    const lines = formatHistory({
      inGitRepo: true,
      branch: null,
      originRef: 'refs/remotes/origin/main',
      undoCandidate: false,
      commits: [
        { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'Merge x', author: 'A', date: '2026-10-21T19:29:05+05:30', shipgate: false, merge: true, onOrigin: false },
      ],
    });
    expect(lines).toEqual([
      'History of detached HEAD, newest first (origin state from refs/remotes/origin/main as of the last fetch or push)',
      '  aaaaaaa  2026-10-21 19:29  local only       Merge x [merge] (A)',
      'undo: does not apply (HEAD is not a non-merge Shipgate commit with a parent on a branch)',
    ]);
  });
});
