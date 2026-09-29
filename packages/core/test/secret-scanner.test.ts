import { describe, expect, it } from 'vitest';
import {
  isExemptFilename,
  isPlaceholderValue,
  scanSecrets,
  scanTextForSecrets,
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
  it('detects EXAMPLE and xxxx', () => {
    expect(isPlaceholderValue('AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(isPlaceholderValue('xxxxxxxxxxxxxxxxxxxx')).toBe(true);
  });
  it('detects placeholder / changeme / angle brackets', () => {
    expect(isPlaceholderValue('placeholder-token')).toBe(true);
    expect(isPlaceholderValue('changeme')).toBe(true);
    expect(isPlaceholderValue('<YOUR_KEY>')).toBe(true);
  });
  it('rejects real-looking keys', () => {
    expect(isPlaceholderValue('sk-proj-abcdefghijklmnopqrstuvwxyz1234')).toBe(
      false,
    );
  });
});

describe('scanSecrets', () => {
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

  it('fully exempts .env.example including contents', () => {
    const f = scanSecrets([
      {
        path: '.env.example',
        content: 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz',
      },
    ]);
    expect(f).toHaveLength(0);
  });

  it('skips your-key-here placeholders in non-template files', () => {
    const f = scanSecrets([
      { path: 'readme.md', content: 'Set KEY=your-api-key-here' },
    ]);
    expect(f).toHaveLength(0);
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
