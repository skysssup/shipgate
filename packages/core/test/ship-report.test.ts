import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIOS, findScenario, scenarioInput } from '../src/fixtures.js';
import { describeRemote, formatShipResult, simulateShip, type ShipResult } from '../src/ship-report.js';
import type { RunPlanInput, SafetyLevel } from '../src/types.js';

const place = { branch: 'main', remoteName: 'github.com/acme/app', sha: '1a2b3c4' };
const scenario = (id: string) => scenarioInput(findScenario(id)!);
const report = (input: RunPlanInput) => formatShipResult(simulateShip(input, place));

describe('simulateShip', () => {
  const expected: Record<string, string[]> = {
    'clean-change': [
      'shipgate: SHIPPED — Pushed 1a2b3c4 to origin/main.',
      '  commit   1a2b3c4 update greeting.test.ts, greeting.ts',
      '  remote   github.com/acme/app (private)',
    ],
    'credential-in-env': [
      'shipgate: BLOCKED — Credential findings block this run.',
      '  finding  .env:1  openai-key (high)  sk-proj-…CDEF',
      '  finding  .env  dotenv-file (high)',
      '  reason   2 high-confidence credential findings: balanced blocks every finding.',
      '  result   Nothing was committed. The staging area is back to how it was before the run.',
      '  next     Remove the credential and keep .env files out of Git (.gitignore), or rerun with --force-secrets if it is a false positive.',
    ],
    'placeholder-template': [
      'shipgate: SHIPPED — Pushed 1a2b3c4 to origin/main.',
      '  commit   1a2b3c4 update .env.example, config.ts',
      '  remote   github.com/acme/app (private)',
    ],
    'medium-jwt': [
      'shipgate: BLOCKED — Credential findings block this run.',
      '  finding  test/fixtures/session.json:2  jwt (medium)  eyJhbGci…dXJl',
      '  reason   1 medium-confidence credential finding: balanced blocks every finding.',
      '  result   Nothing was committed. The staging area is back to how it was before the run.',
      '  next     Remove the credential, or rerun with --force-secrets if it is a false positive.',
    ],
    'public-repo': [
      'shipgate: BLOCKED — Strict policy blocks a public destination until you acknowledge it.',
      '  reason   origin is a public GitHub repository; strict requires --public-ok (or publicOk in .shipgate.json).',
      '  result   Nothing was committed. The staging area is back to how it was before the run.',
      '  next     Pass --public-ok (or run shipgate on --public-ok) if publishing to this destination is intended.',
    ],
    'busy-agent': [
      'shipgate: HELD — Another agent is still working here, so Shipgate waits.',
      '  reason   1 other agent holds a busy marker in this worktree.',
      '  result   Nothing was staged or committed.',
      '  next     Run shipgate ship again after the other agent finishes.',
    ],
    'not-enabled': [
      'shipgate: NOT ENABLED — Shipgate is not enabled in this repository.',
      '  reason   There is no enabled .shipgate.json; run `shipgate on` to opt in.',
    ],
    'review-hold': [
      'shipgate: HELD — External review asked to hold this change.',
      '  reason   Reviewer: src/api.ts still logs request bodies for debugging.',
      '  result   Nothing was committed. The staging area is back to how it was before the run.',
      "  next     Address the reviewer's concern, then run shipgate ship again.",
    ],
  };

  it('covers every demo scenario', () => {
    expect(Object.keys(expected).sort()).toEqual(DEMO_SCENARIOS.map((s) => s.id).sort());
  });

  it.each(Object.entries(expected))('%s prints what the CLI prints', (id, lines) => {
    expect(report(scenario(id))).toEqual(lines);
  });

  it('exits 0 for every decision a scenario can reach', () => {
    for (const s of DEMO_SCENARIOS) expect(simulateShip(scenarioInput(s), place).exitCode).toBe(0);
    expect(simulateShip({ ...scenario('review-hold'), review: { enabled: true, outcome: 'unavailable', detail: 'no API key' } }, place))
      .toMatchObject({ outcome: 'review-unavailable', exitCode: 1, action: 'hold' });
  });

  it('commits without pushing when there is no origin', () => {
    const result = simulateShip({ ...scenario('clean-change'), remote: 'none' }, place);
    expect(result).toMatchObject({ outcome: 'committed', committed: true, pushed: false });
    expect(formatShipResult(result)).toEqual([
      'shipgate: COMMITTED — Committed 1a2b3c4 on main. There is no origin remote, so nothing was pushed.',
      '  commit   1a2b3c4 update greeting.test.ts, greeting.ts',
    ]);
  });

  it('uses -m as the subject, skips review, and lists warnings and advice', () => {
    const input: RunPlanInput = {
      ...scenario('medium-jwt'),
      level: 'strict',
      remote: 'public',
      flags: { forceSecrets: true, publicOk: true, message: 'Add session fixture' },
      review: { enabled: true, outcome: 'hold', detail: 'unused' },
    };
    expect(report(input)).toEqual([
      'shipgate: SHIPPED — Pushed 1a2b3c4 to origin/main.',
      '  finding  test/fixtures/session.json:2  jwt (medium)  eyJhbGci…dXJl',
      '  warning  1 medium-confidence credential finding overridden with --force-secrets.',
      '  warning  External review was skipped because the commit message was given with -m/--message.',
      '  advice   strict recommends a human check before shipping; --confirm records it (not enforced).',
      '  commit   1a2b3c4 Add session fixture',
      '  remote   github.com/acme/app (public)',
    ]);
  });

  it('reports a clean tree without a staging line', () => {
    expect(report({ ...scenario('clean-change'), dirtyFiles: [], findings: [] })).toEqual([
      'shipgate: NOTHING TO SHIP — There are no changes to commit.',
    ]);
  });

  it('refuses inputs the CLI would resolve with a live reviewer or reject as config errors', () => {
    expect(() => simulateShip({ ...scenario('clean-change'), review: { enabled: true } }, place)).toThrow(/review outcome/);
    expect(() => simulateShip({ ...scenario('clean-change'), level: 'loose' as SafetyLevel }, place)).toThrow(/"loose"/);
  });
});

describe('formatShipResult', () => {
  const base: ShipResult = {
    exitCode: 0,
    action: 'block',
    outcome: 'blocked',
    summary: 'Credential findings block this run.',
    reasons: [],
    warnings: [],
    recommendations: [],
    notes: ['Submodule contents are not scanned: vendor/lib.'],
    findings: [
      { path: 'z.ts', ruleId: 'jwt', excerpt: 'eyJ…', confidence: 'medium', line: 3 },
      { path: 'a/.env', ruleId: 'dotenv-file', excerpt: 'a/.env', confidence: 'high' },
    ],
    committed: false,
    pushed: false,
    staging: 'kept-other-change',
  };

  it('sorts findings by path and prints notes and the staging result', () => {
    expect(formatShipResult(base)).toEqual([
      'shipgate: BLOCKED — Credential findings block this run.',
      '  finding  a/.env  dotenv-file (high)',
      '  finding  z.ts:3  jwt (medium)  eyJ…',
      '  note     Submodule contents are not scanned: vendor/lib.',
      '  result   Nothing was committed. Another Git command changed the staging area during the run, so Shipgate kept that version.',
    ]);
  });

  it('prints the destination only after a commit that was meant to be pushed', () => {
    const committed = { ...base, findings: [], notes: [], staging: undefined, committed: true, sha: 'abc1234', subject: 'Fix', remote: 'github.com/acme/app (private)' };
    expect(formatShipResult({ ...committed, outcome: 'push-failed' })).toContain('  remote   github.com/acme/app (private)');
    expect(formatShipResult({ ...committed, outcome: 'committed' }).join('\n')).not.toContain('remote');
  });
});

describe('describeRemote', () => {
  it.each([
    ['none', 'no origin remote (commits stay local)'],
    ['private', 'github.com/acme/app (private)'],
    ['public', 'github.com/acme/app (public)'],
    ['unknown', 'github.com/acme/app (visibility unknown; treated as public)'],
    ['other-host', 'github.com/acme/app (not GitHub; visibility not checked)'],
  ] as const)('%s', (visibility, text) => {
    expect(describeRemote(visibility, 'github.com/acme/app')).toBe(text);
  });
});
