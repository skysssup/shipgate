import { describe, expect, it } from 'vitest';
import { locateSecrets, redactSecretsInText, scanSecrets } from '../src/secret-scanner.js';

describe('connection URL credentials', () => {
  it.each(['postgres', 'postgresql', 'mysql', 'mongodb', 'mongodb+srv', 'redis', 'rediss', 'amqp', 'amqps', 'mssql'])('blocks a password in a %s connection URL', (scheme) => {
    const content = `DATABASE_URL="${scheme}://alice:synth%40password@localhost:5432/db"`;
    const found = scanSecrets([{ path: '.env.example', content }]);
    expect(found).toMatchObject([{ ruleId: 'connection-password', confidence: 'high', line: 1 }]);
    expect(found[0]!.excerpt).not.toContain('password');
    expect(redactSecretsInText(content)).toBe(`DATABASE_URL="${scheme}://alice:[REDACTED]@localhost:5432/db"`);
    const located = locateSecrets(content).find((m) => m.ruleId === 'connection-password')!;
    expect(content.slice(located.from, located.to)).toBe('synth%40password');
  });
  it('redacts the password when it is identical to the scheme and username', () => {
    const content = 'postgres://postgres:postgres@localhost/db';
    expect(redactSecretsInText(content)).toBe('postgres://postgres:[REDACTED]@localhost/db');
    const [match] = locateSecrets(content);
    expect(match!.from).toBe(content.lastIndexOf('postgres'));
  });
  it('permits password-free URLs and exact encoded placeholders', () => {
    for (const content of ['redis://localhost:6379', 'postgres://alice@localhost/db', 'postgres://alice:changeme@localhost/db', 'postgres://alice:%24%7BPASSWORD%7D@localhost/db']) {
      expect(scanSecrets([{ path: 'config.ts', content }])).toEqual([]);
    }
  });
  it('does not exempt a real password containing placeholder text', () => {
    expect(scanSecrets([{ path: 'config.ts', content: 'redis://:changeme-real-value@localhost' }])).toHaveLength(1);
  });
});
