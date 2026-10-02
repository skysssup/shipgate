import { afterEach, expect, it, vi } from 'vitest';
import { agentReview } from '../src/agent-review.js';

afterEach(() => vi.unstubAllGlobals());
it('redacts every outbound text field before truncating the payload', async () => {
  const token = 'sk-abcdefghijklmnopqrstuvwxyz123456789';
  const jwt = 'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop';
  const pem = '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----';
  let payload = '';
  vi.stubGlobal('fetch', vi.fn(async (_url, request) => {
    payload = request.body;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"decision":"hold","reason":42}' } }] }) };
  }));
  const result = await agentReview({ apiKey: 'synthetic-test-key', diffSummary: token, promptText: jwt + pem, commitSubjects: [token], redactedDiff: 'x'.repeat(11990) + pem });
  expect(payload).not.toContain(token);
  expect(payload).not.toContain(jwt);
  expect(payload).not.toContain('BEGIN PRIVATE KEY');
  expect(result.reason).toBe('hold');
});
