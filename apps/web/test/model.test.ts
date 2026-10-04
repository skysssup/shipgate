import { describe, expect, it } from 'vitest';
import {
  DEMO_SCENARIOS,
  formatShipResult,
  isPlaceholderValue,
  planRun,
  RULE_SAMPLES,
  SAFETY_LEVELS,
  scenarioInput,
  simulateShip,
} from '@shipgate/core/browser';
import {
  causes,
  cliCommands,
  compareLevels,
  DEFAULT_SCENARIO_ID,
  evaluate,
  findingEffect,
  isModified,
  pathProblem,
  placeFor,
  PLACEHOLDER_EXAMPLES,
  reasonTargets,
  skippedPlaceholders,
  stateFromScenario,
  suggestions,
  toRunPlanInput,
  whatHappens,
  type SimState,
} from '../src/lib/model';

const token = ['ghp', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('_');

describe('simulator inputs', () => {
  it.each(DEMO_SCENARIOS.map((s) => [s.id, s] as const))('reproduce the shared fixture for %s', (id, scenario) => {
    const expected = scenarioInput(scenario);
    const built = toRunPlanInput(stateFromScenario(id));
    expect(built.findings).toEqual(expected.findings);
    expect(built.dirtyFiles).toEqual(expected.dirtyFiles);
    expect(planRun(built)).toEqual(planRun(expected));
  });

  it.each(DEMO_SCENARIOS.map((s) => [s.id, s] as const))('show the CLI report for %s', (id, scenario) => {
    const { output, report } = evaluate(stateFromScenario(id));
    const expected = simulateShip(scenarioInput(scenario), placeFor(scenario.facts.remote));
    expect(output).toEqual(formatShipResult(expected));
    expect(report.exitCode).toBe(expected.exitCode);
  });

  it('scans edited file contents with the real scanner', () => {
    const state = stateFromScenario('clean-change');
    const edited: SimState = { ...state, files: [{ path: 'src/a.ts', content: `const t = "${token}";\n` }] };
    const { result, input } = evaluate(edited);
    expect(input.findings).toEqual([expect.objectContaining({ path: 'src/a.ts', ruleId: 'github-token', line: 1 })]);
    expect(result).toMatchObject({ action: 'block', code: 'credentials' });
  });

  it('applies filename rules to renamed files', () => {
    const state = stateFromScenario('clean-change');
    const renamed = { ...state, files: [{ path: '.env.production', content: 'PORT=1\n' }] };
    expect(evaluate(renamed).input.findings.map((f) => f.ruleId)).toEqual(['dotenv-file']);
    expect(evaluate({ ...renamed, files: [{ path: '.env.example', content: 'PORT=1\n' }] }).result.action).toBe('ship');
  });

  it('scans the -m message like the CLI and skips review with it', () => {
    const state = stateFromScenario('review-hold');
    const clean = evaluate({ ...state, messageOn: true, message: 'Remove debug log' });
    expect(clean.result).toMatchObject({ action: 'ship', review: 'skipped' });
    expect(clean.report.subject).toBe('Remove debug log');
    const leaked = evaluate({ ...state, messageOn: true, message: `deploy with ${token}` });
    expect(leaked.input.findings).toEqual([expect.objectContaining({ path: '--message', ruleId: 'github-token' })]);
    expect(leaked.result.action).toBe('block');
  });

  it('leaves files out when the working tree is clean', () => {
    const { input, result } = evaluate({ ...stateFromScenario('credential-in-env'), hasChanges: false });
    expect(input.dirtyFiles).toEqual([]);
    expect(input.findings).toEqual([]);
    expect(result.code).toBe('nothing-to-ship');
  });

  it('starts from an example that ships, with no hidden overrides', () => {
    const state = stateFromScenario(DEFAULT_SCENARIO_ID);
    expect(state).toMatchObject({ forceSecrets: false, publicOk: false, confirm: false, messageOn: false, review: 'off' });
    expect(evaluate(state).result.action).toBe('ship');
    expect(isModified(state)).toBe(false);
    expect(isModified({ ...state, activePath: state.files[1].path })).toBe(false);
    expect(isModified({ ...state, level: 'yolo' })).toBe(true);
  });

  it('never describes a push as certain', () => {
    const pushing = evaluate(stateFromScenario('clean-change')).report;
    expect(whatHappens(pushing)).toMatch(/If the push fails, the commit stays local and ship exits 1/);
    const local = evaluate({ ...stateFromScenario('clean-change'), remote: 'none' }).report;
    expect(whatHappens(local)).toMatch(/nothing is pushed/);
  });
});

describe('what would change the decision', () => {
  it.each(DEMO_SCENARIOS.map((s) => s.id))('every suggestion for %s is checked with planRun', (id) => {
    const state = stateFromScenario(id);
    const current = planRun(toRunPlanInput(state)).action;
    const items = suggestions(state);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.result).toEqual(planRun(toRunPlanInput(item.next)));
      expect(item.result.action).not.toBe(current);
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('lists ways to ship first when the run is stopped', () => {
    const items = suggestions(stateFromScenario('credential-in-env'));
    expect(items[0].result.action).toBe('ship');
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining(['force', 'drop:.env', 'busy']));
    expect(items.find((i) => i.id === 'force')?.caution).toMatch(/false positives/);
    expect(items.some((i) => i.id === 'level:yolo')).toBe(false);
  });

  it('includes the level that allows a medium finding', () => {
    const items = suggestions(stateFromScenario('medium-jwt'));
    expect(items.find((i) => i.id === 'level:yolo')?.result.action).toBe('ship');
  });

  it('opts in a repository that is not enabled', () => {
    const [first] = suggestions(stateFromScenario('not-enabled'));
    expect(first).toMatchObject({ id: 'enable', result: { action: 'ship' } });
  });
});

describe('inputs behind the decision', () => {
  const result = (id: string, patch: Partial<SimState> = {}) => evaluate({ ...stateFromScenario(id), ...patch }).result;

  it.each<[string, string, Partial<SimState>, ReturnType<typeof causes>, string[]]>([
    ['credentials', 'credential-in-env', {}, { findings: 'stop' }, ['findings']],
    ['public destination', 'public-repo', {}, { origin: 'stop' }, ['origin']],
    ['credentials and destination', 'credential-in-env', { level: 'strict', remote: 'public' }, { findings: 'stop', origin: 'stop' }, ['findings', 'origin']],
    ['busy agents', 'busy-agent', {}, { agents: 'stop' }, ['agents']],
    ['opt-in', 'not-enabled', {}, { 'opt-in': 'stop' }, ['opt-in']],
    ['clean tree', 'clean-change', { hasChanges: false }, { tree: 'stop' }, []],
    ['review hold', 'review-hold', {}, { reviewer: 'stop' }, ['reviewer']],
    ['yolo warning', 'medium-jwt', { level: 'yolo' }, { findings: 'warn' }, []],
    ['public warning', 'clean-change', { remote: 'public' }, { origin: 'warn' }, []],
    ['skipped review', 'review-hold', { messageOn: true }, { reviewer: 'warn' }, []],
    ['nothing to point at', 'clean-change', {}, {}, []],
  ])('%s', (_name, id, patch, expectedCauses, targets) => {
    expect(causes(result(id, patch))).toEqual(expectedCauses);
    expect(reasonTargets(result(id, patch))).toEqual(targets);
  });

  it('pairs every reason with an input', () => {
    for (const scenario of DEMO_SCENARIOS) {
      const r = evaluate(stateFromScenario(scenario.id)).result;
      expect(reasonTargets(r)).toHaveLength(r.reasons.length);
    }
  });
});

describe('level comparison and finding effects', () => {
  it('runs planRun once per level', () => {
    const state = stateFromScenario('medium-jwt');
    expect(compareLevels(state).map((c) => [c.level, c.result.action])).toEqual([
      ['strict', 'block'],
      ['balanced', 'block'],
      ['yolo', 'ship'],
    ]);
    for (const { level, result } of compareLevels(state)) expect(result).toEqual(planRun(toRunPlanInput({ ...state, level })));
    expect(compareLevels(state).map((c) => c.level)).toEqual([...SAFETY_LEVELS]);
  });

  it('labels what each finding does under the current level and flags', () => {
    const state = stateFromScenario('medium-jwt');
    const [finding] = evaluate(state).input.findings;
    expect(findingEffect(state, finding)).toBe('blocks');
    expect(findingEffect({ ...state, level: 'yolo' }, finding)).toBe('allowed');
    expect(findingEffect({ ...state, forceSecrets: true }, finding)).toBe('overridden');
    const high = { ...finding, confidence: 'high' as const };
    expect(findingEffect({ ...state, level: 'yolo' }, high)).toBe('blocks');
  });

  it('lists placeholders the scanner skipped, with their lines', () => {
    const skipped = skippedPlaceholders(stateFromScenario('placeholder-template').files);
    expect(skipped.map((s) => [s.ruleId, s.line, s.value])).toEqual([
      ['aws-access-key', 2, 'AKIAIOSFODNN7EXAMPLE'],
      ['stripe-key', 3, ['sk', 'test', 'x'.repeat(24)].join('_')],
    ]);
  });

  it('documents placeholder values the scanner really skips', () => {
    for (const value of PLACEHOLDER_EXAMPLES) expect(isPlaceholderValue(value), value).toBe(true);
  });

  it('has a sample file for every rule that the simulator flags', () => {
    for (const [ruleId, file] of Object.entries(RULE_SAMPLES)) {
      const state = { ...stateFromScenario('clean-change'), files: [file] };
      expect(evaluate(state).input.findings.map((f) => f.ruleId)).toEqual([ruleId]);
    }
  });
});

describe('commands and paths', () => {
  it('turns the settings into CLI commands, quoting the message for a shell', () => {
    const state: SimState = {
      ...stateFromScenario('public-repo'),
      publicOk: true,
      confirm: true,
      review: 'approve',
      messageOn: true,
      message: 'Fix "quotes" and $HOME',
    };
    expect(cliCommands(state)).toEqual({
      setup: 'shipgate on --level strict --agent',
      ship: 'shipgate ship -m "Fix \\"quotes\\" and \\$HOME" --public-ok --confirm',
    });
    expect(cliCommands(stateFromScenario('not-enabled'))).toEqual({ ship: 'shipgate ship' });
  });

  it.each([
    ['src/a.ts', undefined],
    ['', 'Enter a file path.'],
    [' a.ts', 'Remove spaces at the start or end.'],
    ['/etc/passwd', 'Use a path relative to the repository root.'],
    ['C:/x', 'Use a path relative to the repository root.'],
    ['a/../b', 'Use a plain relative path without empty, . or .. parts.'],
    ['a//b', 'Use a plain relative path without empty, . or .. parts.'],
    ['dir/', 'Use a plain relative path without empty, . or .. parts.'],
    ['taken.txt', 'Another file already has this path.'],
  ])('path %j', (path, problem) => {
    expect(pathProblem(path, ['taken.txt'])).toBe(problem);
  });
});
