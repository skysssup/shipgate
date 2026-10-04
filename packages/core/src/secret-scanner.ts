import type { SecretFinding } from './types.js';

export interface ScanFile {
  path: string;
  content: string;
  /** True for a staged deletion: the path is checked by filename rules only. */
  missing?: boolean;
}

interface PatternRule {
  id: string;
  confidence: SecretFinding['confidence'];
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
  { id: 'aws-access-key', confidence: 'high', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, prefix: /^(?:AKIA|ASIA)/ },
  {
    id: 'aws-secret-key',
    confidence: 'medium',
    pattern: /(?:aws_secret_access_key|aws_secret)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    valueGroup: 1,
  },
  { id: 'openai-key', confidence: 'high', pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b/g, prefix: /^sk-(?:proj-|svcacct-|admin-)?/ },
  { id: 'anthropic-key', confidence: 'high', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, prefix: /^sk-ant-(?:[a-z]+\d+-)?/ },
  {
    id: 'github-token',
    confidence: 'high',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    prefix: /^(?:gh[pousr]_|github_pat_)/,
  },
  { id: 'slack-token', confidence: 'high', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, prefix: /^xox[baprs]-/ },
  { id: 'private-key-pem', confidence: 'high', pattern: PEM_HEADER },
  { id: 'stripe-key', confidence: 'high', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, prefix: /^(?:sk|rk)_(?:live|test)_/ },
  { id: 'google-api-key', confidence: 'medium', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, prefix: /^AIza/ },
  { id: 'npm-token', confidence: 'high', pattern: /\bnpm_[A-Za-z0-9]{36,}\b/g, prefix: /^npm_/ },
  { id: 'jwt', confidence: 'medium', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, prefix: /^eyJ/ },
];

/** Rule identifiers in scan order, including the dotenv filename rule. */
export const SECRET_RULE_IDS: readonly string[] = [...PATTERN_RULES.map((r) => r.id), 'dotenv-file'];

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
  const value = rule.valueGroup ? match[rule.valueGroup] ?? match[0] : match[0];
  const body = rule.prefix ? value.replace(rule.prefix, '') : value;
  return isPlaceholderValue(value) || isPlaceholderValue(body);
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = content.indexOf('\n'); i !== -1 && i < index; i = content.indexOf('\n', i + 1)) line += 1;
  return line;
}

function scanContent(path: string, content: string, findings: SecretFinding[]): void {
  for (const rule of PATTERN_RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
      if (isPlaceholderMatch(rule, match, content)) continue;
      const value = rule.valueGroup ? match[rule.valueGroup] ?? match[0] : match[0];
      findings.push({
        path,
        ruleId: rule.id,
        excerpt: rule.id === 'private-key-pem' ? match[0] : mask(value),
        confidence: rule.confidence,
        line: lineOf(content, match.index),
      });
      break;
    }
  }
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
