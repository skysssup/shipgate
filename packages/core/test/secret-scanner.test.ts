import { describe, expect, it } from 'vitest';
import {
  isExemptFilename,
  isPlaceholderValue,
  scanSecrets,
  scanTextForSecrets,
  redactSecretsInText,
  SECRET_RULE_IDS,
} from '../src/secret-scanner.js';

describe('isExemptFilename', () => {
  it('exempts .env.example', () => {
    expect(isExemptFilename('.env.example')).toBe(true);
  });
  it('exempts *.sample *.template *.dist', () => {
    expect(isExemptFilename('config.sample')).toBe(true);
    expect(isExemptFilename('app.template')).toBe(true);
    expect(isExemptFilename('nginx.conf.dist')).toBe(true);
  });
  it('does not exempt plain .env', () => {
    expect(isExemptFilename('.env')).toBe(false);
    expect(isExemptFilename('.env.local')).toBe(false);
  });
});

describe('isPlaceholderValue', () => {
  it('detects your-*-here', () => {
    expect(isPlaceholderValue('your-api-key-here')).toBe(true);
  });
  it('detects AWS docs fixture and xxx+', () => {
    expect(isPlaceholderValue('AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(isPlaceholderValue('xxxxxxxx')).toBe(true);
  });
  it('detects placeholder / changeme / angle brackets', () => {
    expect(isPlaceholderValue('placeholder-token')).toBe(true);
    expect(isPlaceholderValue('changeme')).toBe(true);
    expect(isPlaceholderValue('<YOUR_KEY>')).toBe(true);
  });
  it('does not treat EXAMPLE substring inside unrelated tokens as placeholder', () => {
    expect(isPlaceholderValue('sk-proj-abcdefghijklmnopqrstuvwxyzEXAMPLE')).toBe(false);
  });
  it('rejects real-looking keys', () => {
    expect(isPlaceholderValue('sk-proj-abcdefghijklmnopqrstuvwxyz1234')).toBe(
      false,
    );
  });
});

describe('scanSecrets', () => {
  it('does not exempt arbitrary AWS-shaped keys containing EXAMPLE', () => {
    const result = scanSecrets([{ path: 'config', content: 'AKIAABEXAMPLEDEF1234' }]);
    expect(result.some((finding) => finding.ruleId === 'aws-access-key')).toBe(true);
  });
  it('detects OpenAI keys', () => {
    const f = scanSecrets([
      { path: 'cfg.ts', content: 'const k = "sk-abcdefghijklmnopqrstuvwxyz";' },
    ]);
    expect(f.some((x) => x.ruleId === 'openai-key')).toBe(true);
  });

  it('detects Anthropic keys', () => {
    const f = scanSecrets([
      {
        path: 'a.ts',
        content: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      },
    ]);
    expect(f.some((x) => x.ruleId === 'anthropic-key')).toBe(true);
  });

  it('detects GitHub tokens', () => {
    const f = scanSecrets([
      {
        path: 't.txt',
        content: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab',
      },
    ]);
    expect(f.some((x) => x.ruleId === 'github-token')).toBe(true);
  });

  it('detects Slack tokens', () => {
    const f = scanSecrets([
      { path: 's.txt', content: 'xoxb-1234567890-abcdefghij' },
    ]);
    expect(f.some((x) => x.ruleId === 'slack-token')).toBe(true);
  });

  it('detects AWS access keys (not EXAMPLE)', () => {
    const f = scanSecrets([
      { path: 'aws.txt', content: 'AKIAIOSFODNN7ABCDEFG' },
    ]);
    expect(f.some((x) => x.ruleId === 'aws-access-key')).toBe(true);
  });

  it('skips AWS EXAMPLE keys via placeholder', () => {
    const f = scanSecrets([
      { path: 'aws.txt', content: 'AKIAIOSFODNN7EXAMPLE' },
    ]);
    expect(f.filter((x) => x.ruleId === 'aws-access-key')).toHaveLength(0);
  });

  it('detects private key PEM', () => {
    const f = scanSecrets([
      {
        path: 'id_rsa',
        content:
          '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn...\n-----END RSA PRIVATE KEY-----',
      },
    ]);
    expect(f.some((x) => x.ruleId === 'private-key-pem')).toBe(true);
  });

  it('detects Stripe live keys', () => {
    // Construct at runtime so the repo never stores a scanner-shaped literal.
    const fake = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz12'].join('_');
    const f = scanSecrets([{ path: 'pay.ts', content: `key=${fake}` }]);
    expect(f.some((x) => x.ruleId === 'stripe-key')).toBe(true);
  });

  it.each(['live', 'test'])('allows Stripe publishable keys in %s mode', (mode) => {
    const key = ['pk', mode, 'a'.repeat(24)].join('_');
    expect(scanSecrets([{ path: 'frontend.ts', content: key }])).toEqual([]);
    expect(redactSecretsInText(key)).toBe(key);
  });

  it.each(['sk', 'rk'])('detects and redacts Stripe %s keys in both modes', (prefix) => {
    for (const mode of ['live', 'test']) {
      const key = [prefix, mode, 'a'.repeat(24)].join('_');
      expect(scanSecrets([{ path: 'server.ts', content: key }])).toEqual([
        expect.objectContaining({ ruleId: 'stripe-key', confidence: 'high' }),
      ]);
      expect(redactSecretsInText(key)).toBe('[REDACTED]');
    }
  });

  it('detects Google API keys', () => {
    const f = scanSecrets([
      { path: 'g.ts', content: ['AIza', 'SyA1234567890ABCDEFGHIJKLMNOPQRSTUV'].join('') },
    ]);
    expect(f.some((x) => x.ruleId === 'google-api-key')).toBe(true);
  });

  it('detects npm tokens', () => {
    const f = scanSecrets([
      {
        path: '.npmrc',
        content: '//registry.npmjs.org/:_authToken=' + ['npm', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_'),
      },
    ]);
    expect(f.some((x) => x.ruleId === 'npm-token')).toBe(true);
  });

  it('detects JWT-ish tokens', () => {
    const f = scanSecrets([
      {
        path: 'tok.txt',
        content:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNqtZjMbzincpXQAHnAiDzI',
      },
    ]);
    expect(f.some((x) => x.ruleId === 'jwt')).toBe(true);
  });

  it('flags .env filenames', () => {
    const f = scanSecrets([{ path: '.env', content: 'FOO=bar' }]);
    expect(f.some((x) => x.ruleId === 'dotenv-file')).toBe(true);
  });

  it('scans credentials in .env.example without flagging the filename', () => {
    const f = scanSecrets([
      {
        path: '.env.example',
        content: 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz',
      },
    ]);
    expect(f.some((x) => x.ruleId === 'openai-key')).toBe(true);
    expect(f.some((x) => x.ruleId === 'dotenv-file')).toBe(false);
  });

  it('skips your-key-here placeholders in non-template files', () => {
    const f = scanSecrets([
      { path: 'readme.md', content: 'Set KEY=your-api-key-here' },
    ]);
    expect(f).toHaveLength(0);
  });


  it('detects sk-proj OpenAI keys', () => {
    const f = scanSecrets([
      {
        path: 'k.ts',
        content: 'KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890AB',
      },
    ]);
    expect(f.some((x) => x.ruleId === 'openai-key')).toBe(true);
  });

  it('detects github_pat fine-grained tokens', () => {
    const f = scanSecrets([
      {
        path: 't.txt',
        content:
          'github_pat_11AAAAAAA0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV',
      },
    ]);
    expect(f.some((x) => x.ruleId === 'github-token')).toBe(true);
  });

  it('does not classify anthropic keys as openai', () => {
    const f = scanSecrets([
      {
        path: 'a.ts',
        content: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
      },
    ]);
    expect(f.some((x) => x.ruleId === 'anthropic-key')).toBe(true);
    expect(f.some((x) => x.ruleId === 'openai-key')).toBe(false);
  });

  it('returns structured path + ruleId', () => {
    const f = scanSecrets([
      { path: 'src/keys.ts', content: 'sk-abcdefghijklmnopqrstuvwxyz' },
    ]);
    expect(f[0].path).toBe('src/keys.ts');
    expect(f[0].ruleId).toBeTruthy();
    expect(f[0].excerpt).toBeTruthy();
    expect(['high', 'medium']).toContain(f[0].confidence);
  });
});

describe('scanTextForSecrets', () => {
  it('finds secrets in prompt text', () => {
    const f = scanTextForSecrets('paste ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab');
    expect(f.length).toBeGreaterThan(0);
  });

  it('ignores clean prompts', () => {
    expect(scanTextForSecrets('add a login button')).toHaveLength(0);
  });
});

/** One synthetic positive sample per rule, assembled at runtime. */
const SAMPLES: Record<string, { content: string; value: string }> = {
  'aws-access-key': { content: `id=${['AKIA', 'Z7Q4MNB2XK9PL3RT'].join('')}`, value: ['AKIA', 'Z7Q4MNB2XK9PL3RT'].join('') },
  'aws-secret-key': {
    content: `aws_secret_access_key = ${['wJalrXUtnFEMI', 'K7MDENGbPxRfiCYzEXAMPLEKEY12'].join('/')}`,
    value: ['wJalrXUtnFEMI', 'K7MDENGbPxRfiCYzEXAMPLEKEY12'].join('/'),
  },
  'openai-key': { content: `key: ${['sk', 'proj', 'Q9w8E7r6T5y4U3i2O1p0AsDfGhJkL'].join('-')}`, value: ['sk', 'proj', 'Q9w8E7r6T5y4U3i2O1p0AsDfGhJkL'].join('-') },
  'anthropic-key': { content: ['sk', 'ant', 'api03', 'Zx9Cv8Bn7Mm6Lk5Jh4Gf3Dd2'].join('-'), value: ['sk', 'ant', 'api03', 'Zx9Cv8Bn7Mm6Lk5Jh4Gf3Dd2'].join('-') },
  'github-token': { content: `token=${['ghp', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('_')}`, value: ['ghp', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('_') },
  'slack-token': { content: ['xoxb', '2048', 'q9w8e7r6t5'].join('-'), value: ['xoxb', '2048', 'q9w8e7r6t5'].join('-') },
  'private-key-pem': {
    content: `-----BEGIN OPENSSH PRIVATE KEY-----\n${'b3BlbnNzaC1rZXktdjEAAAAA'.repeat(8)}\n-----END OPENSSH PRIVATE KEY-----\n`,
    value: 'b3BlbnNzaC1rZXktdjEAAAAA',
  },
  'stripe-key': { content: ['rk', 'live', 'Q1w2E3r4T5y6U7i8O9p0'].join('_'), value: ['rk', 'live', 'Q1w2E3r4T5y6U7i8O9p0'].join('_') },
  'google-api-key': { content: ['AIza', 'Sy9Q8w7E6r5T4y3U2i1O0pAsDfGhJkLzXcV'].join(''), value: ['AIza', 'Sy9Q8w7E6r5T4y3U2i1O0pAsDfGhJkLzXcV'].join('') },
  'npm-token': { content: `//registry.npmjs.org/:_authToken=${['npm', 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8'].join('_')}`, value: ['npm', 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8'].join('_') },
  jwt: {
    content: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzaGlwZ2F0ZS10ZXN0In0', 'c2hpcGdhdGVUZXN0U2lnbmF0dXJl'].join('.'),
    value: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzaGlwZ2F0ZS10ZXN0In0', 'c2hpcGdhdGVUZXN0U2lnbmF0dXJl'].join('.'),
  },
};

describe('rule coverage, excerpts, and redaction parity', () => {
  it('has a positive sample for every content rule', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(SECRET_RULE_IDS.filter((id) => id !== 'dotenv-file').sort());
  });

  it.each(Object.entries(SAMPLES))('%s is found, partially masked, and redacted', (ruleId, sample) => {
    const findings = scanSecrets([{ path: 'sample.txt', content: `first line\n${sample.content}\n` }]);
    const finding = findings.find((f) => f.ruleId === ruleId);
    expect(finding).toMatchObject({ path: 'sample.txt', line: 2 });
    expect(finding!.excerpt).not.toContain(sample.value);
    const redacted = redactSecretsInText(sample.content);
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain(sample.value);
  });

  it('reports the 1-based line of the first match per rule and file', () => {
    const key = SAMPLES['github-token'].value;
    const findings = scanSecrets([{ path: 'a.txt', content: `one\ntwo\nx=${key}\ny=${key}\n` }]);
    expect(findings).toEqual([{ path: 'a.txt', ruleId: 'github-token', excerpt: 'ghp_a1B2…q7R8', confidence: 'high', line: 3 }]);
  });

  it('shows the private key header rather than key material', () => {
    const [finding] = scanSecrets([{ path: 'id', content: SAMPLES['private-key-pem'].content }]);
    expect(finding.excerpt).toBe('-----BEGIN OPENSSH PRIVATE KEY-----');
  });
});

describe('placeholders and legitimate content', () => {
  it.each([
    ['x-run after a known prefix', ['sk', 'x'.repeat(30)].join('-')],
    ['your-…-here after a known prefix', ['sk', 'proj', 'your-api-key-here'].join('-')],
    ['upper-case X run in an AWS key id', ['AKIA', 'X'.repeat(16)].join('')],
    ['x-run GitHub token', ['ghp', 'x'.repeat(36)].join('_')],
    ['short placeholder private key block', '-----BEGIN PRIVATE KEY-----\nYOUR KEY HERE\n-----END PRIVATE KEY-----'],
    ['AWS documentation key id', 'AKIAIOSFODNN7EXAMPLE'],
    ['environment variable reference', 'aws_secret_access_key=${AWS_SECRET_ACCESS_KEY}'],
  ])('skips %s', (_name, content) => {
    expect(scanSecrets([{ path: 'config.txt', content }])).toEqual([]);
  });

  it('still reports real-looking values that merely contain placeholder words', () => {
    const key = ['sk', 'proj', 'Q9w8E7r6T5y4U3i2O1p0EXAMPLE'].join('-');
    expect(scanSecrets([{ path: 'a.ts', content: key }]).map((f) => f.ruleId)).toEqual(['openai-key']);
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${'MIIEowIBAAKCAQEA'.repeat(20)}EXAMPLE\n-----END RSA PRIVATE KEY-----`;
    expect(scanSecrets([{ path: 'id_rsa', content: pem }]).map((f) => f.ruleId)).toEqual(['private-key-pem']);
  });

  it.each([
    'const risk = "risk-assessment-for-the-quarter";',
    'Stripe publishable keys look like pk_live_ and are public.',
    'see https://example.com/eyJ for details',
    'AKIA is the prefix of AWS access key ids',
    'ENCRYPTION_KEY_LENGTH=32',
  ])('does not flag ordinary text: %s', (content) => {
    expect(scanSecrets([{ path: 'notes.md', content }])).toEqual([]);
  });

  it('detects encrypted and PGP private key blocks', () => {
    for (const header of ['-----BEGIN ENCRYPTED PRIVATE KEY-----', '-----BEGIN PGP PRIVATE KEY BLOCK-----', '-----BEGIN EC PRIVATE KEY-----']) {
      const content = `${header}\n${'MIIBpTBfBgkqhkiG9w0BBQ0wUjAx'.repeat(10)}\n`;
      expect(scanSecrets([{ path: 'k', content }])[0]).toMatchObject({ ruleId: 'private-key-pem', excerpt: header });
    }
  });

  it('finds credentials inside binary-looking content', () => {
    const content = `\u0000\u0001PK\u0003${SAMPLES['github-token'].value}\u0000`;
    expect(scanSecrets([{ path: 'blob.bin', content }]).map((f) => f.ruleId)).toEqual(['github-token']);
  });
});

describe('dotenv filename rule', () => {
  it.each([
    ['.env', true],
    ['.env.local', true],
    ['config/.env.production', true],
    ['config\\.env', true],
    ['.env.example', false],
    ['deploy/.env.sample', false],
    ['.envrc', false],
    ['app.env', false],
  ])('%s flagged=%s', (path, flagged) => {
    const findings = scanSecrets([{ path, content: 'SETTING=value\n' }]);
    expect(findings.some((f) => f.ruleId === 'dotenv-file')).toBe(flagged);
    if (flagged) expect(findings[0]).toEqual({ path, ruleId: 'dotenv-file', excerpt: path, confidence: 'high' });
  });

  it('allows a staged deletion of a .env file', () => {
    expect(scanSecrets([{ path: '.env', content: '', missing: true }])).toEqual([]);
  });
});

describe('scanTextForSecrets labels', () => {
  it('labels findings with the source of the text and ignores filename rules', () => {
    const findings = scanTextForSecrets(`deploy with ${SAMPLES['npm-token'].value}`, '--message');
    expect(findings).toEqual([expect.objectContaining({ path: '--message', ruleId: 'npm-token', line: 1 })]);
    expect(scanTextForSecrets('.env', '--prompt')).toEqual([]);
  });
});
