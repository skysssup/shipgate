import { describe, expect, it } from 'vitest';
import { planRun } from '../src/run-plan.js';
import { DEMO_SCENARIOS } from '../src/fixtures.js';
import type { RunPlanInput, SecretFinding } from '../src/types.js';

const secret: SecretFinding = {
  path: '.env',
  ruleId: 'openai-key',
  excerpt: 'sk-…',
  confidence: 'high',
};

function base(over: Partial<RunPlanInput> = {}): RunPlanInput {
  return {
    dirtyFiles: ['a.ts'],
    findings: [],
    level: 'balanced',
    flags: {},
    isPublicRemote: false,
    busyAgents: 0,
    configPresent: true,
    agentReviewEnabled: false,
    ...over,
  };
}

describe('planRun matrix', () => {
  it('holds on clean tree', () => {
    const r = planRun(base({ dirtyFiles: [] }));
    expect(r.action).toBe('hold');
  });

  it('blocks when not enabled', () => {
    const r = planRun(base({ configPresent: false }));
    expect(r.action).toBe('block');
  });

  it('holds when busy agents present', () => {
    const r = planRun(base({ busyAgents: 2 }));
    expect(r.action).toBe('hold');
    expect(r.reasons[0]).toMatch(/busy/i);
  });

  it('blocks secrets on balanced', () => {
    const r = planRun(base({ findings: [secret] }));
    expect(r.action).toBe('block');
  });

  it('ships clean feature', () => {
    const r = planRun(base());
    expect(r.action).toBe('ship');
  });

  it('blocks public on strict without publicOk', () => {
    const r = planRun(
      base({ level: 'strict', isPublicRemote: true, flags: {} }),
    );
    expect(r.action).toBe('block');
  });

  it('ships public on strict with publicOk', () => {
    const r = planRun(
      base({
        level: 'strict',
        isPublicRemote: true,
        flags: { publicOk: true, confirm: true },
      }),
    );
    expect(r.action).toBe('ship');
  });

  it('holds on agent review hold', () => {
    const r = planRun(
      base({ agentReviewEnabled: true, agentReviewHold: true }),
    );
    expect(r.action).toBe('hold');
  });

  it('holds awaiting human confirm when required', () => {
    const r = planRun(
      base({ humanConfirmRequired: true, humanConfirmed: false }),
    );
    expect(r.action).toBe('hold');
  });

  it('yolo still blocks high secrets', () => {
    const r = planRun(base({ level: 'yolo', findings: [secret] }));
    expect(r.action).toBe('block');
  });

  it('yolo ships high secrets with force-secrets', () => {
    const r = planRun(
      base({
        level: 'yolo',
        findings: [secret],
        flags: { forceSecrets: true },
      }),
    );
    expect(r.action).toBe('ship');
  });
});

describe('DEMO_SCENARIOS fixtures', () => {
  it('covers expected demo ids', () => {
    const ids = DEMO_SCENARIOS.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'secret-env',
        'placeholder-example',
        'public-repo',
        'busy-agent',
        'clean-feature',
      ]),
    );
  });

  it('secret-env blocks', () => {
    const s = DEMO_SCENARIOS.find((x) => x.id === 'secret-env')!;
    expect(planRun(s.input).action).toBe('block');
  });

  it('placeholder-example ships', () => {
    const s = DEMO_SCENARIOS.find((x) => x.id === 'placeholder-example')!;
    expect(planRun(s.input).action).toBe('ship');
  });

  it('busy-agent holds', () => {
    const s = DEMO_SCENARIOS.find((x) => x.id === 'busy-agent')!;
    expect(planRun(s.input).action).toBe('hold');
  });

  it('clean-feature ships', () => {
    const s = DEMO_SCENARIOS.find((x) => x.id === 'clean-feature')!;
    expect(planRun(s.input).action).toBe('ship');
  });
});
