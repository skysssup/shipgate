import { describe, expect, it } from 'vitest';
import { evaluatePolicy, parseLevel } from '../src/safety-policy.js';
import type { SecretFinding } from '../src/types.js';

const highSecret: SecretFinding = {
  path: '.env',
  ruleId: 'openai-key',
  excerpt: 'sk-…',
  confidence: 'high',
};

const mediumSecret: SecretFinding = {
  path: 'a.txt',
  ruleId: 'jwt',
  excerpt: 'eyJ…',
  confidence: 'medium',
};

describe('parseLevel', () => {
  it('parses known levels', () => {
    expect(parseLevel('strict')).toBe('strict');
    expect(parseLevel('yolo')).toBe('yolo');
  });
  it('defaults empty/undefined to balanced and rejects unknown', () => {
    expect(parseLevel(undefined)).toBe('balanced');
    expect(parseLevel('')).toBe('balanced');
    expect(() => parseLevel('nope')).toThrow(/unknown safety level/);
  });
});

describe('evaluatePolicy strict', () => {
  it('blocks secrets', () => {
    const v = evaluatePolicy({
      level: 'strict',
      findings: [highSecret],
      isPublicRemote: false,
      flags: {},
      configPresent: true,
    });
    expect(v.allow).toBe(false);
    expect(v.blockReasons.some((r) => /secret/i.test(r))).toBe(true);
  });

  it('blocks public remote without publicOk', () => {
    const v = evaluatePolicy({
      level: 'strict',
      findings: [],
      isPublicRemote: true,
      flags: {},
      configPresent: true,
    });
    expect(v.allow).toBe(false);
    expect(v.blockReasons.some((r) => /public/i.test(r))).toBe(true);
  });

  it('requires config file', () => {
    const v = evaluatePolicy({
      level: 'strict',
      findings: [],
      isPublicRemote: false,
      flags: {},
      configPresent: false,
    });
    expect(v.allow).toBe(false);
  });

  it('recommends human and LLM gates', () => {
    const v = evaluatePolicy({
      level: 'strict',
      findings: [],
      isPublicRemote: false,
      flags: { publicOk: true },
      configPresent: true,
    });
    expect(v.recommendHumanGate).toBe(true);
    expect(v.recommendLlmGate).toBe(true);
  });

  it('allows clean private with config', () => {
    const v = evaluatePolicy({
      level: 'strict',
      findings: [],
      isPublicRemote: false,
      flags: {},
      configPresent: true,
    });
    expect(v.allow).toBe(true);
  });
});

describe('evaluatePolicy balanced', () => {
  it('blocks secrets', () => {
    const v = evaluatePolicy({
      level: 'balanced',
      findings: [mediumSecret],
      isPublicRemote: false,
      flags: {},
      configPresent: true,
    });
    expect(v.allow).toBe(false);
  });

  it('warns public but allows', () => {
    const v = evaluatePolicy({
      level: 'balanced',
      findings: [],
      isPublicRemote: true,
      flags: {},
      configPresent: true,
    });
    expect(v.allow).toBe(true);
    expect(v.warnReasons.some((r) => /public/i.test(r))).toBe(true);
  });

  it('recommends LLM gate', () => {
    const v = evaluatePolicy({
      level: 'balanced',
      findings: [],
      isPublicRemote: false,
      flags: {},
      configPresent: true,
    });
    expect(v.recommendLlmGate).toBe(true);
  });
});

describe('evaluatePolicy yolo', () => {
  it('blocks high-confidence secrets without force', () => {
    const v = evaluatePolicy({
      level: 'yolo',
      findings: [highSecret],
      isPublicRemote: false,
      flags: {},
      configPresent: true,
    });
    expect(v.allow).toBe(false);
  });

  it('allows high secrets with --force-secrets', () => {
    const v = evaluatePolicy({
      level: 'yolo',
      findings: [highSecret],
      isPublicRemote: false,
      flags: { forceSecrets: true },
      configPresent: true,
    });
    expect(v.allow).toBe(true);
  });

  it('allows medium secrets with warning', () => {
    const v = evaluatePolicy({
      level: 'yolo',
      findings: [mediumSecret],
      isPublicRemote: false,
      flags: {},
      configPresent: true,
    });
    expect(v.allow).toBe(true);
    expect(v.warnReasons.length).toBeGreaterThan(0);
  });
});
