import { SAFETY_LEVELS, type RemoteVisibility, type SafetyLevel, type SecretFinding, type ShipFlags } from './types.js';

export interface PolicyContext {
  level: SafetyLevel;
  findings: SecretFinding[];
  remote: RemoteVisibility;
  flags: ShipFlags;
  reviewEnabled: boolean;
}

export interface PolicyVerdict {
  allow: boolean;
  /** Primary cause when `allow` is false. Credentials take precedence over the destination. */
  code: 'credentials' | 'public-destination' | 'clear';
  blockReasons: string[];
  warnings: string[];
  recommendations: string[];
}

export const DEFAULT_LEVEL: SafetyLevel = 'balanced';

export function isSafetyLevel(value: unknown): value is SafetyLevel {
  return typeof value === 'string' && (SAFETY_LEVELS as readonly string[]).includes(value);
}

/** Parse a level from user input. Missing or empty input selects the default level. */
export function parseLevel(raw: string | undefined): SafetyLevel {
  if (raw === undefined || raw === '') return DEFAULT_LEVEL;
  if (isSafetyLevel(raw)) return raw;
  throw new Error(`unknown policy level ${JSON.stringify(raw)} (expected strict, balanced, or yolo)`);
}

export function describeFindings(findings: SecretFinding[]): string {
  const high = findings.filter((f) => f.confidence === 'high').length;
  const medium = findings.length - high;
  const noun = findings.length === 1 ? 'credential finding' : 'credential findings';
  if (!high || !medium) {
    return `${findings.length} ${high ? 'high' : 'medium'}-confidence ${noun}`;
  }
  return `${findings.length} ${noun} (${high} high, ${medium} medium confidence)`;
}

/** Evaluate the credential and destination rules for one level. Pure function. */
export function evaluatePolicy(ctx: PolicyContext): PolicyVerdict {
  if (!isSafetyLevel(ctx.level)) {
    throw new Error(`unknown policy level ${JSON.stringify(ctx.level)}`);
  }
  const blockReasons: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  let code: PolicyVerdict['code'] = 'clear';

  const high = ctx.findings.filter((f) => f.confidence === 'high');
  const medium = ctx.findings.filter((f) => f.confidence === 'medium');
  const blocked = ctx.level === 'yolo' ? high : ctx.findings;
  if (blocked.length) {
    const scope = ctx.level === 'yolo' ? 'yolo blocks high-confidence findings' : `${ctx.level} blocks every finding`;
    if (ctx.flags.forceSecrets) {
      warnings.push(`${describeFindings(blocked)} overridden with --force-secrets.`);
    } else {
      blockReasons.push(`${describeFindings(blocked)}: ${scope}.`);
      code = 'credentials';
    }
  }
  if (ctx.level === 'yolo' && medium.length) {
    warnings.push(`${describeFindings(medium)} allowed by yolo.`);
  }

  const publicLike = ctx.remote === 'public' || ctx.remote === 'unknown';
  if (publicLike && !ctx.flags.publicOk) {
    const fact = ctx.remote === 'public'
      ? 'origin is a public GitHub repository'
      : 'origin is on GitHub but its visibility could not be checked, so it is treated as public';
    if (ctx.level === 'strict') {
      blockReasons.push(`${fact}; strict requires --public-ok (or publicOk in .shipgate.json).`);
      if (code === 'clear') code = 'public-destination';
    } else {
      warnings.push(`${fact}; pass --public-ok to acknowledge.`);
    }
  }
  if (ctx.level === 'strict' && ctx.remote === 'other-host') {
    warnings.push('origin is not a GitHub URL, so Shipgate could not check whether it is public.');
  }

  if (ctx.level === 'strict') {
    if (!ctx.flags.confirm) {
      recommendations.push('strict recommends a human check before shipping; --confirm records it (not enforced).');
    }
    if (!ctx.reviewEnabled) {
      recommendations.push('strict recommends external review (shipgate on --agent); it is off (not enforced).');
    }
  }

  return { allow: blockReasons.length === 0, code, blockReasons, warnings, recommendations };
}
