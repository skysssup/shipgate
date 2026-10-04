import { describe, expect, it } from 'vitest';
import { describeFindings, evaluatePolicy, isSafetyLevel, parseLevel, type PolicyContext } from '../src/safety-policy.js';
import type { SafetyLevel, SecretFinding } from '../src/types.js';

const highSecret: SecretFinding = { path: '.env', ruleId: 'openai-key', excerpt: 'sk-…', confidence: 'high' };
const mediumSecret: SecretFinding = { path: 'a.txt', ruleId: 'jwt', excerpt: 'eyJ…', confidence: 'medium' };

function policy(over: Partial<PolicyContext>) {
  return evaluatePolicy({ level: 'balanced', findings: [], remote: 'private', flags: {}, reviewEnabled: false, ...over });
}

describe('parseLevel', () => {
  it('parses known levels and defaults missing input to balanced', () => {
    expect(parseLevel('strict')).toBe('strict');
    expect(parseLevel('yolo')).toBe('yolo');
    expect(parseLevel(undefined)).toBe('balanced');
    expect(parseLevel('')).toBe('balanced');
  });

  it('rejects unknown and differently cased levels with the accepted values', () => {
    expect(() => parseLevel('nope')).toThrow(/unknown policy level "nope" \(expected strict, balanced, or yolo\)/);
    expect(() => parseLevel('Strict')).toThrow(/unknown policy level/);
    expect(isSafetyLevel(42)).toBe(false);
  });
});

describe('describeFindings', () => {
  it('counts findings by confidence', () => {
    expect(describeFindings([highSecret])).toBe('1 high-confidence credential finding');
    expect(describeFindings([mediumSecret, mediumSecret])).toBe('2 medium-confidence credential findings');
    expect(describeFindings([highSecret, mediumSecret])).toBe('2 credential findings (1 high, 1 medium confidence)');
  });
});

describe('evaluatePolicy', () => {
  it.each<SafetyLevel>(['strict', 'balanced'])('%s blocks high and medium findings', (level) => {
    for (const finding of [highSecret, mediumSecret]) {
      const verdict = policy({ level, findings: [finding] });
      expect(verdict).toMatchObject({ allow: false, code: 'credentials' });
    }
  });

  it('yolo blocks high findings and allows medium findings with a warning', () => {
    expect(policy({ level: 'yolo', findings: [highSecret] })).toMatchObject({ allow: false, code: 'credentials' });
    const medium = policy({ level: 'yolo', findings: [mediumSecret] });
    expect(medium.allow).toBe(true);
    expect(medium.warnings).toEqual(['1 medium-confidence credential finding allowed by yolo.']);
  });

  it('strict blocks public and unknown destinations unless acknowledged', () => {
    expect(policy({ level: 'strict', remote: 'public' })).toMatchObject({ allow: false, code: 'public-destination' });
    expect(policy({ level: 'strict', remote: 'unknown' })).toMatchObject({ allow: false, code: 'public-destination' });
    expect(policy({ level: 'strict', remote: 'public', flags: { publicOk: true } }).allow).toBe(true);
  });

  it('strict only recommends confirmation and review', () => {
    const verdict = policy({ level: 'strict' });
    expect(verdict.allow).toBe(true);
    expect(verdict.recommendations).toHaveLength(2);
    expect(policy({ level: 'strict', flags: { confirm: true }, reviewEnabled: true }).recommendations).toEqual([]);
    expect(policy({ level: 'balanced' }).recommendations).toEqual([]);
  });

  it('throws for an unknown level instead of allowing', () => {
    expect(() => policy({ level: 'lenient' as SafetyLevel })).toThrow(/unknown policy level/);
  });
});
