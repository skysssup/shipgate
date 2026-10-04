import type { SecretFinding } from './types.js';

export interface ScanFile {
  path: string;
  content: string;
  /** True for a staged deletion: the path is checked by filename rules only. */
  missing?: boolean;
}

/** A scanner rule as documented in the README. */
export interface SecretRule {
  id: string;
  confidence: SecretFinding['confidence'];
  /** What the rule matches. Code is wrapped in backticks. */
  matches: string;
}

interface PatternRule extends SecretRule {
  pattern: RegExp;
  /** Capture group holding the credential when the match also includes a key name. */
  valueGroup?: number;
  /** Fixed leading part of the value. The remainder is checked for placeholder text. */
  prefix?: RegExp;
}

/**
 * Narrow placeholder exemptions. Broad patterns such as /EXAMPLE/i would hide real
 * token-shaped values, so each entry describes a complete placeholder value.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^your-[\w-]*-?here$/i,
  /^changeme$/i,
  /^placeholder([-_][\w]+)?$/i,
  /^insert[_-]?key$/i,
  /^todo[_-]?key$/i,
  /^<\w[\w-]*>$/,
  /^\$\{[\w.]+\}$/,
  /^xxx+$/i,
  /^AKIAIOSFODNN7EXAMPLE$/i,
];

const PEM_HEADER = /-----BEGIN (?:[A-Z0-9]+ ){0,3}PRIVATE KEY(?: BLOCK)?-----/g;
const PEM_BLOCK =
  /-----BEGIN (?:[A-Z0-9]+ ){0,3}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ ){0,3}PRIVATE KEY(?: BLOCK)?-----|$)/g;
const TEMPLATE_SUFFIX = /\.(example|sample|template|dist)$/i;
const ENV_FILENAME = /(^|[/\\])\.env(\.|$)/i;

const PATTERN_RULES: PatternRule[] = [
  {
    id: 'aws-access-key',
    confidence: 'high',
    matches: 'AWS access key ids (`AKIA…`, `ASIA…`)',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    prefix: /^(?:AKIA|ASIA)/,
  },
  {
    id: 'aws-secret-key',
    confidence: 'medium',
    matches: '40-character values assigned to `aws_secret_access_key`',
    pattern: /(?:aws_secret_access_key|aws_secret)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    valueGroup: 1,
  },
  {
    id: 'openai-key',
    confidence: 'high',
    matches: '`sk-…` keys, including `sk-proj-`',
    pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b/g,
    prefix: /^sk-(?:proj-|svcacct-|admin-)?/,
  },
  {
    id: 'anthropic-key',
    confidence: 'high',
    matches: '`sk-ant-…` keys',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    prefix: /^sk-ant-(?:[a-z]+\d+-)?/,
  },
  {
    id: 'github-token',
    confidence: 'high',
    matches: '`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` tokens and `github_pat_` tokens',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    prefix: /^(?:gh[pousr]_|github_pat_)/,
  },
  {
    id: 'slack-token',
    confidence: 'high',
    matches: '`xoxb-`, `xoxa-`, `xoxp-`, `xoxr-`, `xoxs-` tokens',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    prefix: /^xox[baprs]-/,
  },
  {
    id: 'private-key-pem',
    confidence: 'high',
    matches: 'PEM and PGP private key blocks (RSA, EC, DSA, OpenSSH, encrypted)',
    pattern: PEM_HEADER,
  },
  {
    id: 'stripe-key',
    confidence: 'high',
    matches: '`sk_live_`, `sk_test_`, `rk_live_`, `rk_test_` keys (publishable `pk_` keys are allowed)',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    prefix: /^(?:sk|rk)_(?:live|test)_/,
  },
  {
    id: 'google-api-key',
    confidence: 'medium',
    matches: '`AIza…` keys',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    prefix: /^AIza/,
  },
  {
    id: 'npm-token',
    confidence: 'high',
    matches: '`npm_…` tokens',
    pattern: /\bnpm_[A-Za-z0-9]{36,}\b/g,
    prefix: /^npm_/,
  },
  {
    id: 'jwt',
    confidence: 'medium',
    matches: 'three base64url segments starting with `eyJ`',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    prefix: /^eyJ/,
  },
];

/** Every rule in scan order, ending with the dotenv filename rule. */
export const SECRET_RULES: readonly SecretRule[] = [
  ...PATTERN_RULES.map(({ id, confidence, matches }) => ({ id, confidence, matches })),
  {
    id: 'dotenv-file',
    confidence: 'high',
    matches: 'files named `.env` or `.env.*`, except templates ending in `.example`, `.sample`, `.template`, or `.dist`',
  },
];

/** Rule identifiers in scan order, including the dotenv filename rule. */
export const SECRET_RULE_IDS: readonly string[] = SECRET_RULES.map((r) => r.id);

/** True when a candidate value looks like an intentional placeholder. */
export function isPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}

/** Template filenames are exempt from the dotenv filename rule; their contents are still scanned. */
export function isExemptFilename(path: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? path;
  return TEMPLATE_SUFFIX.test(base);
}

/** Show enough of a value to locate it without printing most of it. */
function mask(value: string): string {
  if (value.length <= 12) return `${value.slice(0, 2)}…`;
  const lead = Math.min(8, Math.floor(value.length / 4));
  return value.length >= 24 ? `${value.slice(0, lead)}…${value.slice(-4)}` : `${value.slice(0, lead)}…`;
}

function isPlaceholderMatch(rule: PatternRule, match: RegExpExecArray, content: string): boolean {
  if (rule.id === 'private-key-pem') {
    const block = content.slice(match.index, match.index + 200);
    const end = block.indexOf('-----END');
    const body = end === -1 ? block : block.slice(0, end);
    return end !== -1 && /YOUR|EXAMPLE|PLACEHOLDER|REDACTED/i.test(body);
  }
  const value = matchedValue(rule, match);
  const body = rule.prefix ? value.replace(rule.prefix, '') : value;
  return isPlaceholderValue(value) || isPlaceholderValue(body);
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = content.indexOf('\n'); i !== -1 && i < index; i = content.indexOf('\n', i + 1)) line += 1;
  return line;
}

function* ruleMatches(rule: PatternRule, content: string): Generator<RegExpExecArray> {
  const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
  for (let match = pattern.exec(content); match; match = pattern.exec(content)) yield match;
}

function matchedValue(rule: PatternRule, match: RegExpExecArray): string {
  return rule.valueGroup ? match[rule.valueGroup] ?? match[0] : match[0];
}

function scanContent(path: string, content: string, findings: SecretFinding[]): void {
  for (const rule of PATTERN_RULES) {
    for (const match of ruleMatches(rule, content)) {
      if (isPlaceholderMatch(rule, match, content)) continue;
      findings.push({
        path,
        ruleId: rule.id,
        excerpt: rule.id === 'private-key-pem' ? match[0] : mask(matchedValue(rule, match)),
        confidence: rule.confidence,
        line: lineOf(content, match.index),
      });
      break;
    }
  }
}

/** A credential-shaped value in a text, including values the scanner skips as placeholders. */
export interface SecretMatch {
  ruleId: string;
  confidence: SecretFinding['confidence'];
  /** Offsets of the value, or of the whole private key block, in the text. */
  from: number;
  to: number;
  placeholder: boolean;
}

/**
 * Every credential-shaped value in a text, in rule order. scanSecrets reports the
 * first match of each rule that is not a placeholder.
 */
export function locateSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const rule of PATTERN_RULES) {
    for (const match of ruleMatches(rule, content)) {
      const value = matchedValue(rule, match);
      let from = match.index + (rule.valueGroup ? match[0].indexOf(value) : 0);
      let to = from + value.length;
      if (rule.id === 'private-key-pem') {
        const block = new RegExp(PEM_BLOCK.source, 'y');
        block.lastIndex = match.index;
        from = match.index;
        to = from + (block.exec(content)?.[0].length ?? match[0].length);
      }
      matches.push({ ruleId: rule.id, confidence: rule.confidence, from, to, placeholder: isPlaceholderMatch(rule, match, content) });
    }
  }
  return matches;
}

/**
 * Scan file contents for credential-shaped values. Reports the first match of each
 * rule per file. Placeholder-looking values are skipped; template files are scanned.
 */
export function scanSecrets(files: ScanFile[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const file of files) {
    if (!file.missing) scanContent(file.path, file.content, findings);
    if (!file.missing && !isExemptFilename(file.path) && ENV_FILENAME.test(file.path)) {
      findings.push({ path: file.path, ruleId: 'dotenv-file', excerpt: file.path, confidence: 'high' });
    }
  }
  return findings;
}

/** Scan command-line text such as a commit message or prompt. */
export function scanTextForSecrets(text: string, label = '<text>'): SecretFinding[] {
  const findings: SecretFinding[] = [];
  scanContent(label, text, findings);
  return findings;
}

/** Replace every credential-shaped value, including placeholders, with [REDACTED]. */
export function redactSecretsInText(text: string): string {
  let out = text.replace(new RegExp(PEM_BLOCK.source, PEM_BLOCK.flags), '[REDACTED]');
  for (const rule of PATTERN_RULES) {
    if (rule.id === 'private-key-pem') continue;
    out = out.replace(new RegExp(rule.pattern.source, rule.pattern.flags), (match: string, ...groups: unknown[]) => {
      const value = rule.valueGroup ? groups[rule.valueGroup - 1] : undefined;
      return typeof value === 'string' ? match.replace(value, '[REDACTED]') : '[REDACTED]';
    });
  }
  return out;
}
