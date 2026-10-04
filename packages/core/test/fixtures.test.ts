import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIOS, findScenario, scenarioInput } from '../src/fixtures.js';
import { planRun } from '../src/run-plan.js';
import type { SafetyLevel } from '../src/types.js';

/** Outcomes each example promises in the README, the simulator, and `shipgate demo`. */
const EXPECTED: Record<string, { action: string; code: string; findings: string[] }> = {
  'clean-change': { action: 'ship', code: 'clear', findings: [] },
  'credential-in-env': { action: 'block', code: 'credentials', findings: ['openai-key', 'dotenv-file'] },
  'placeholder-template': { action: 'ship', code: 'clear', findings: [] },
  'medium-jwt': { action: 'block', code: 'credentials', findings: ['jwt'] },
  'public-repo': { action: 'block', code: 'public-destination', findings: [] },
  'busy-agent': { action: 'hold', code: 'busy', findings: [] },
  'not-enabled': { action: 'block', code: 'not-enabled', findings: [] },
  'review-hold': { action: 'hold', code: 'review-hold', findings: [] },
};

describe('demo scenarios', () => {
  it('have unique ids, and every id has an expectation', () => {
    const ids = DEMO_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(DEMO_SCENARIOS.map((s) => [s.id, s] as const))('%s produces its documented outcome', (id, scenario) => {
    const input = scenarioInput(scenario);
    expect(input.findings.map((f) => f.ruleId)).toEqual(EXPECTED[id].findings);
    expect(planRun(input)).toMatchObject({ action: EXPECTED[id].action, code: EXPECTED[id].code });
    expect(scenario.title.length).toBeGreaterThan(5);
    expect(scenario.summary.endsWith('.')).toBe(true);
  });

  it('shows the medium finding changing outcome by level', () => {
    const outcome = (level: SafetyLevel) => planRun({ ...scenarioInput(findScenario('medium-jwt')!), level });
    expect(outcome('strict').action).toBe('block');
    expect(outcome('balanced').action).toBe('block');
    expect(outcome('yolo')).toMatchObject({ action: 'ship', warnings: ['1 medium-confidence credential finding allowed by yolo.'] });
  });

  it('ships the public example once the destination is acknowledged, without changing the fact', () => {
    const input = scenarioInput(findScenario('public-repo')!);
    const acknowledged = planRun({ ...input, flags: { publicOk: true } });
    expect(acknowledged.action).toBe('ship');
    expect(input.remote).toBe('public');
  });

  it('returns fresh inputs so callers cannot mutate the shared fixtures', () => {
    const scenario = findScenario('clean-change')!;
    const input = scenarioInput(scenario);
    input.flags.forceSecrets = true;
    input.review.enabled = true;
    expect(scenario.facts.flags).toEqual({});
    expect(scenario.facts.review).toEqual({ enabled: false });
  });

  it('keeps fixture credentials synthetic', () => {
    const contents = DEMO_SCENARIOS.flatMap((s) => s.files.map((f) => f.content)).join('\n');
    expect(contents).toMatch(/shipgateDemo/);
    expect(Buffer.from('eyJzdWIiOiJzaGlwZ2F0ZS1kZW1vIn0', 'base64').toString()).toBe('{"sub":"shipgate-demo"}');
  });
});
