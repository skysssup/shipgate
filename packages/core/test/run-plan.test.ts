import { describe, expect, it } from 'vitest';
import { planRun } from '../src/run-plan.js';
import type { RemoteVisibility, RunPlanInput, SafetyLevel, SecretFinding, ShipFlags } from '../src/types.js';

const high: SecretFinding = { path: '.env', ruleId: 'openai-key', excerpt: 'sk-proj-…CDEF', confidence: 'high', line: 1 };
const medium: SecretFinding = { path: 'fixture.json', ruleId: 'jwt', excerpt: 'eyJhbGci…dXJl', confidence: 'medium', line: 2 };
const findingSets = { none: [], medium: [medium], high: [high], both: [high, medium] } satisfies Record<string, SecretFinding[]>;

function input(over: Partial<RunPlanInput> = {}): RunPlanInput {
  return {
    configPresent: true,
    dirtyFiles: ['src/a.ts'],
    findings: [],
    level: 'balanced',
    flags: {},
    remote: 'private',
    busyAgents: 0,
    review: { enabled: false },
    ...over,
  };
}

type Expectation = {
  action: 'ship' | 'hold' | 'block' | 'noop';
  code: string;
  /** Each pattern must match one reason; the count must match exactly. */
  reasons?: RegExp[];
  warnings?: RegExp[];
  recommendations?: RegExp[];
  review?: string;
};

/**
 * Expected behavior, written independently of the implementation's control flow.
 * Each row is one situation a user can reach from the CLI or the simulator.
 */
const MATRIX: Array<[string, Partial<RunPlanInput>, Expectation]> = [
  ['clean private change ships', {}, { action: 'ship', code: 'clear', reasons: [], warnings: [], recommendations: [] }],
  ['clean tree is a no-op', { dirtyFiles: [] }, { action: 'noop', code: 'nothing-to-ship', reasons: [] }],
  ['disabled repository blocks first', { configPresent: false, dirtyFiles: [], busyAgents: 3, findings: [high] }, { action: 'block', code: 'not-enabled', reasons: [/shipgate on/] }],
  ['busy agent holds before scanning results matter', { busyAgents: 1, findings: [high] }, { action: 'hold', code: 'busy', reasons: [/1 other agent holds a busy marker/] }],
  ['busy agents counted', { busyAgents: 2 }, { action: 'hold', code: 'busy', reasons: [/2 other agents hold/] }],
  ['busy wins over a clean tree', { busyAgents: 1, dirtyFiles: [] }, { action: 'hold', code: 'busy' }],

  ['strict blocks medium', { level: 'strict', findings: [medium] }, { action: 'block', code: 'credentials', reasons: [/1 medium-confidence credential finding: strict blocks every finding/] }],
  ['strict blocks high', { level: 'strict', findings: [high] }, { action: 'block', code: 'credentials', reasons: [/1 high-confidence/] }],
  ['balanced blocks medium', { findings: [medium] }, { action: 'block', code: 'credentials', reasons: [/balanced blocks every finding/] }],
  ['balanced blocks high and medium together', { findings: [high, medium] }, { action: 'block', code: 'credentials', reasons: [/2 credential findings \(1 high, 1 medium confidence\)/] }],
  ['yolo allows medium with a warning', { level: 'yolo', findings: [medium] }, { action: 'ship', code: 'clear', warnings: [/1 medium-confidence credential finding allowed by yolo/] }],
  ['yolo blocks high', { level: 'yolo', findings: [high, medium] }, { action: 'block', code: 'credentials', reasons: [/1 high-confidence credential finding: yolo blocks high-confidence findings/], warnings: [/medium-confidence .* allowed by yolo/] }],
  ['--force-secrets ships with a warning', { findings: [high], flags: { forceSecrets: true } }, { action: 'ship', code: 'clear', warnings: [/overridden with --force-secrets/] }],
  ['yolo --force-secrets reports override and medium allowance', { level: 'yolo', findings: [high, medium], flags: { forceSecrets: true } }, { action: 'ship', code: 'clear', warnings: [/1 high-confidence .* overridden/, /medium-confidence .* allowed by yolo/] }],

  ['strict blocks public destination', { level: 'strict', remote: 'public' }, { action: 'block', code: 'public-destination', reasons: [/public GitHub repository; strict requires --public-ok/] }],
  ['strict blocks unknown visibility as public', { level: 'strict', remote: 'unknown' }, { action: 'block', code: 'public-destination', reasons: [/could not be checked, so it is treated as public/] }],
  ['strict ships public with --public-ok', { level: 'strict', remote: 'public', flags: { publicOk: true, confirm: true } }, { action: 'ship', code: 'clear', warnings: [], recommendations: [/external review/] }],
  ['strict warns that other hosts are not checked', { level: 'strict', remote: 'other-host', flags: { confirm: true } }, { action: 'ship', code: 'clear', warnings: [/not a GitHub URL/] }],
  ['balanced warns on public destination', { remote: 'public' }, { action: 'ship', code: 'clear', warnings: [/public GitHub repository; pass --public-ok/] }],
  ['balanced warns on unknown visibility', { remote: 'unknown' }, { action: 'ship', code: 'clear', warnings: [/treated as public/] }],
  ['acknowledged public destination does not warn', { remote: 'public', flags: { publicOk: true } }, { action: 'ship', code: 'clear', warnings: [] }],
  ['yolo warns on public destination', { level: 'yolo', remote: 'public' }, { action: 'ship', code: 'clear', warnings: [/pass --public-ok/] }],
  ['balanced does not mention other hosts', { remote: 'other-host' }, { action: 'ship', code: 'clear', warnings: [] }],
  ['no remote ships without destination warnings', { level: 'strict', remote: 'none', flags: { confirm: true } }, { action: 'ship', code: 'clear', warnings: [] }],
  ['credentials outrank the destination on strict', { level: 'strict', remote: 'public', findings: [high] }, { action: 'block', code: 'credentials', reasons: [/strict blocks every finding/, /strict requires --public-ok/] }],
  ['--force-secrets does not acknowledge a public destination', { level: 'strict', remote: 'public', findings: [high], flags: { forceSecrets: true } }, { action: 'block', code: 'public-destination', reasons: [/requires --public-ok/], warnings: [/overridden with --force-secrets/] }],
  ['--public-ok does not override credentials', { level: 'strict', remote: 'public', findings: [high], flags: { publicOk: true } }, { action: 'block', code: 'credentials', reasons: [/strict blocks every finding/] }],

  ['strict recommends confirmation and review without enforcing them', { level: 'strict' }, { action: 'ship', code: 'clear', recommendations: [/--confirm records it \(not enforced\)/, /external review .* \(not enforced\)/] }],
  ['--confirm only removes the recommendation', { level: 'strict', flags: { confirm: true }, review: { enabled: true, outcome: 'approve' } }, { action: 'ship', code: 'clear', recommendations: [], review: 'approved' }],
  ['balanced makes no recommendations', { flags: { confirm: false } }, { action: 'ship', code: 'clear', recommendations: [] }],

  ['review pending before it runs', { review: { enabled: true } }, { action: 'ship', code: 'clear', review: 'pending' }],
  ['review approval ships', { review: { enabled: true, outcome: 'approve' } }, { action: 'ship', code: 'clear', review: 'approved' }],
  ['review hold holds with the reviewer reason', { review: { enabled: true, outcome: 'hold', detail: 'debug logging left in' } }, { action: 'hold', code: 'review-hold', reasons: [/Reviewer: debug logging left in/], review: 'held' }],
  ['unavailable review holds (fail closed)', { review: { enabled: true, outcome: 'unavailable', detail: 'no API key' } }, { action: 'hold', code: 'review-unavailable', reasons: [/no API key/], review: 'unavailable' }],
  ['-m skips review even when it would hold', { flags: { message: 'feat: x' }, review: { enabled: true, outcome: 'hold' } }, { action: 'ship', code: 'clear', warnings: [/skipped because the commit message was given/], review: 'skipped' }],
  ['blocked run never reaches review', { findings: [high], review: { enabled: true, outcome: 'approve' } }, { action: 'block', code: 'credentials', review: 'not-reached' }],
  ['review outcome ignored when review is off', { review: { enabled: false, outcome: 'hold' } }, { action: 'ship', code: 'clear', review: 'off' }],
  ['public warning kept when review holds', { remote: 'public', review: { enabled: true, outcome: 'hold' } }, { action: 'hold', code: 'review-hold', warnings: [/pass --public-ok/] }],
];

describe('planRun expected-behavior matrix', () => {
  it.each(MATRIX)('%s', (_name, over, expected) => {
    const result = planRun(input(over));
    expect(result.action).toBe(expected.action);
    expect(result.code).toBe(expected.code);
    expect(result.summary.length).toBeGreaterThan(10);
    for (const [key, patterns] of [
      ['reasons', expected.reasons],
      ['warnings', expected.warnings],
      ['recommendations', expected.recommendations],
    ] as const) {
      if (!patterns) continue;
      expect(result[key], key).toHaveLength(patterns.length);
      for (const pattern of patterns) expect(result[key].some((text) => pattern.test(text)), `${key} ${pattern}`).toBe(true);
    }
    if (expected.review) expect(result.review).toBe(expected.review);
    if (result.action === 'ship') expect(result.reasons).toEqual([]);
  });

  it('rejects an unknown level from untyped callers', () => {
    const result = planRun(input({ level: 'loose' as SafetyLevel }));
    expect(result).toMatchObject({ action: 'block', code: 'invalid-level' });
    expect(result.reasons[0]).toMatch(/"loose"/);
  });
});

describe('policy invariants across every combination', () => {
  const levels: SafetyLevel[] = ['strict', 'balanced', 'yolo'];
  const remotes: RemoteVisibility[] = ['none', 'private', 'public', 'unknown', 'other-host'];
  const flagSets: ShipFlags[] = [{}, { forceSecrets: true }, { publicOk: true }, { confirm: true }, { forceSecrets: true, publicOk: true, confirm: true }];
  const cases = levels.flatMap((level) =>
    remotes.flatMap((remote) =>
      Object.entries(findingSets).flatMap(([findingSet, findings]) => flagSets.map((flags) => ({ level, remote, findingSet, findings, flags }))),
    ),
  );

  it.each(cases)('$level / $remote / $findingSet / $flags', ({ level, remote, findings, flags }) => {
    const base = input({ level, remote, findings, flags });
    const result = planRun(base);
    const blocksCredentials = !flags.forceSecrets && (level === 'yolo' ? findings.some((f) => f.confidence === 'high') : findings.length > 0);
    const blocksDestination = level === 'strict' && !flags.publicOk && (remote === 'public' || remote === 'unknown');
    expect(result.action).toBe(blocksCredentials || blocksDestination ? 'block' : 'ship');
    if (blocksCredentials) expect(result.code).toBe('credentials');
    else if (blocksDestination) expect(result.code).toBe('public-destination');
    expect(base.remote).toBe(remote);
    expect(result.recommendations.length > 0).toBe(level === 'strict' && result.action === 'ship');
    if (flags.forceSecrets && findings.length) expect(result.warnings.join(' ')).toMatch(/--force-secrets|allowed by yolo/);

    expect(planRun({ ...base, busyAgents: 1 }).code).toBe('busy');
    expect(planRun({ ...base, configPresent: false }).code).toBe('not-enabled');
  });
});
