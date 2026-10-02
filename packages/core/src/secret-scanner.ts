import type { SecretFinding } from './types.js';

export interface ScanFile {
  path: string;
  content: string;
  /** True when the path is absent on disk (e.g. staged deletion). */
  missing?: boolean;
}

interface Rule {
  id: string;
  confidence: 'high' | 'medium';
  test: (content: string, path: string, file: ScanFile) => string | null;
}

const TEMPLATE_SUFFIX = /\.(example|sample|template|dist)$/i;

/**
 * Narrow placeholder exemptions — known fixture shapes only.
 * Avoid broad /EXAMPLE/i or /x{4,}/ which suppress real token-shaped matches.
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
  /^AKIAIOSFODNN7EXAMPLE$/i, // AWS docs fixture only
];

/** True when a candidate secret value looks like an intentional placeholder. */
export function isPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}

/** Template / sample filenames are never treated as secret carriers. */
export function isExemptFilename(path: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? path;
  return TEMPLATE_SUFFIX.test(base);
}

const ENV_FILENAME = /(^|[/\\])\.env(\.|$)/i;

function redact(s: string, max = 24): string {
  if (s.length <= max) return s.slice(0, 4) + '…';
  return s.slice(0, 8) + '…' + s.slice(-4);
}

function firstMatch(
  content: string,
  re: RegExp,
  filter?: (m: string, groups: string[]) => boolean,
): string | null {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const global = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = global.exec(content)) !== null) {
    const hit = m[0];
    const groups = m.slice(1);
    const valueForPlaceholder = groups.find(Boolean) ?? hit;
    if (isPlaceholderValue(valueForPlaceholder) || isPlaceholderValue(hit)) {
      continue;
    }
    if (filter && !filter(hit, groups)) continue;
    return hit;
  }
  return null;
}

const RULES: Rule[] = [
  {
    id: 'aws-access-key',
    confidence: 'high',
    test: (c) =>
      firstMatch(c, /\bAKIA[0-9A-Z]{16}\b/, (v) => !/EXAMPLE/i.test(v)),
  },
  {
    id: 'aws-secret-key',
    confidence: 'medium',
    test: (c) =>
      firstMatch(
        c,
        /(?:aws_secret_access_key|aws_secret)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/i,
      ),
  },
  {
    id: 'openai-key',
    confidence: 'high',
    test: (c) => firstMatch(c, /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b/),
  },
  {
    id: 'anthropic-key',
    confidence: 'high',
    test: (c) => firstMatch(c, /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/),
  },
  {
    id: 'github-token',
    confidence: 'high',
    test: (c) =>
      firstMatch(
        c,
        /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
      ),
  },
  {
    id: 'slack-token',
    confidence: 'high',
    test: (c) => firstMatch(c, /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/),
  },
  {
    id: 'private-key-pem',
    confidence: 'high',
    test: (c) => {
      if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(c)) {
        if (/YOUR|EXAMPLE|PLACEHOLDER/i.test(c) && c.length < 200) return null;
        return '-----BEGIN PRIVATE KEY-----';
      }
      return null;
    },
  },
  {
    id: 'stripe-key',
    confidence: 'high',
    test: (c) => firstMatch(c, /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/),
  },
  {
    id: 'google-api-key',
    confidence: 'medium',
    test: (c) => firstMatch(c, /\bAIza[0-9A-Za-z\-_]{35}\b/),
  },
  {
    id: 'npm-token',
    confidence: 'high',
    test: (c) => firstMatch(c, /\bnpm_[A-Za-z0-9]{36,}\b/),
  },
  {
    id: 'jwt',
    confidence: 'medium',
    test: (c) =>
      firstMatch(
        c,
        /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
      ),
  },
  {
    id: 'dotenv-file',
    confidence: 'high',
    test: (_c, path, file) => {
      if (file.missing) return null; // deletion-only — allow credential cleanup
      if (isExemptFilename(path)) return null;
      if (ENV_FILENAME.test(path)) return path;
      return null;
    },
  },
];

/**
 * Scan file contents for high/medium confidence secrets.
 * Template filenames are fully exempt. Placeholder-looking values are skipped.
 */
export function scanSecrets(files: ScanFile[]): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const file of files) {
    if (isExemptFilename(file.path)) continue;

    for (const rule of RULES) {
      const hit = rule.test(file.content, file.path, file);
      if (!hit) continue;
      findings.push({
        path: file.path,
        ruleId: rule.id,
        excerpt: redact(hit),
        confidence: rule.confidence,
      });
    }
  }

  return findings;
}

/** Scan free-form text (e.g. a commit message or prompt) without a path context. */
export function scanTextForSecrets(text: string): SecretFinding[] {
  return scanSecrets([{ path: '<text>', content: text }]).filter(
    (f) => f.ruleId !== 'dotenv-file',
  );
}

/** Redact known secret shapes from a diff before external review. */
export function redactSecretsInText(text: string): string {
  let out = text;
  const patterns: RegExp[] = [
    /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b/g,
    /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/g,
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    /\bnpm_[A-Za-z0-9]{36,}\b/g,
    /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  ];
  for (const re of patterns) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}
