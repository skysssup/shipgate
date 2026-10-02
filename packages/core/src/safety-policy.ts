import type { SafetyLevel, SecretFinding, ShipFlags } from './types.js';

export interface PolicyContext {
  level: SafetyLevel;
  findings: SecretFinding[];
  isPublicRemote: boolean;
  flags: ShipFlags;
  configPresent: boolean;
}

export interface PolicyVerdict {
  allow: boolean;
  blockReasons: string[];
  warnReasons: string[];
  recommendHumanGate: boolean;
  recommendLlmGate: boolean;
}

/**
 * Evaluate safety policy for a ship attempt.
 * Pure function — no I/O.
 */
export function evaluatePolicy(ctx: PolicyContext): PolicyVerdict {
  const blockReasons: string[] = [];
  const warnReasons: string[] = [];
  let recommendHumanGate = false;
  let recommendLlmGate = false;

  const high = ctx.findings.filter((f) => f.confidence === 'high');
  const medium = ctx.findings.filter((f) => f.confidence === 'medium');
  const forceSecrets = Boolean(ctx.flags.forceSecrets);
  const publicOk = Boolean(ctx.flags.publicOk);

  if (ctx.level !== 'strict' && ctx.level !== 'balanced' && ctx.level !== 'yolo') {
    return {
      allow: false,
      blockReasons: [`unknown safety level: ${JSON.stringify(ctx.level)}`],
      warnReasons: [],
      recommendHumanGate: false,
      recommendLlmGate: false,
    };
  }

  switch (ctx.level) {
    case 'strict': {
      if (!ctx.configPresent) {
        blockReasons.push('strict: missing or invalid .shipgate.json policy file');
      }
      if (high.length || medium.length) {
        if (!forceSecrets) {
          blockReasons.push(
            `strict: ${high.length + medium.length} secret finding(s) blocked`,
          );
        } else {
          warnReasons.push('strict: secrets overridden with --force-secrets');
        }
      }
      if (ctx.isPublicRemote && !publicOk) {
        blockReasons.push(
          'strict: public remote requires --public-ok (or on --public-ok)',
        );
      }
      recommendHumanGate = true;
      recommendLlmGate = true;
      break;
    }
    case 'balanced': {
      if (high.length || medium.length) {
        if (!forceSecrets) {
          blockReasons.push(
            `balanced: ${high.length + medium.length} secret finding(s) blocked`,
          );
        } else {
          warnReasons.push('balanced: secrets overridden with --force-secrets');
        }
      }
      if (ctx.isPublicRemote && !publicOk) {
        warnReasons.push(
          'balanced: public remote — confirm with --public-ok to silence',
        );
      }
      recommendLlmGate = true;
      break;
    }
    case 'yolo': {
      if (high.length && !forceSecrets) {
        blockReasons.push(
          `yolo: ${high.length} high-confidence secret(s) blocked (use --force-secrets)`,
        );
      } else if (high.length && forceSecrets) {
        warnReasons.push('yolo: high-confidence secrets overridden');
      }
      if (medium.length) {
        warnReasons.push(
          `yolo: ${medium.length} medium-confidence finding(s) allowed`,
        );
      }
      if (ctx.isPublicRemote) {
        warnReasons.push('yolo: shipping to public remote');
      }
      break;
    }
  }

  return {
    allow: blockReasons.length === 0,
    blockReasons,
    warnReasons,
    recommendHumanGate,
    recommendLlmGate,
  };
}

export const DEFAULT_LEVEL: SafetyLevel = 'balanced';

export function parseLevel(raw: string | undefined): SafetyLevel {
  if (raw === undefined || raw === '') return DEFAULT_LEVEL;
  if (raw === 'strict' || raw === 'balanced' || raw === 'yolo') return raw;
  throw new Error(`unknown safety level: ${JSON.stringify(raw)}`);
}

/** Runtime guard for untyped callers — rejects unknown level strings. */
export function assertSafetyLevel(raw: unknown): SafetyLevel {
  if (raw === 'strict' || raw === 'balanced' || raw === 'yolo') return raw;
  throw new Error(`unknown safety level: ${JSON.stringify(raw)}`);
}
