import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildReviewMessages, REVIEW_DIFF_LIMIT, requestReview, type ReviewRequest } from '../src/agent-review.js';
import { SYNTHETIC } from './helpers.js';

interface Received {
  path: string;
  authorization: string | undefined;
  body: { model: string; temperature: number; messages: Array<{ role: string; content: string }> };
}

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

/** Local stand-in for an OpenAI-compatible endpoint. */
async function endpoint(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ baseUrl: string; received: Received[] }> {
  const received: Received[] = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({ path: req.url ?? '', authorization: req.headers.authorization, body: JSON.parse(raw || '{}') });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return { baseUrl: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`, received };
}

const reply = (content: unknown) => (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content } }] }));
};

function request(baseUrl: string, over: Partial<ReviewRequest> = {}): ReviewRequest {
  return { apiKey: 'test-key', baseUrl, changedFiles: ['src/a.ts'], diff: '+const a = 1;\n', omittedFiles: [], ...over };
}

describe('requestReview against a local endpoint', () => {
  it('maps ship to approve and hold to hold, with the reviewer reason', async () => {
    const { baseUrl, received } = await endpoint(reply('Sure. {"decision":"ship","reason":"Small, finished change."}'));
    expect(await requestReview(request(baseUrl))).toEqual({ outcome: 'approve', detail: 'Small, finished change.' });
    expect(received[0]).toMatchObject({ path: '/v1/chat/completions', authorization: 'Bearer test-key' });
    expect(received[0].body).toMatchObject({ model: 'openai/gpt-4o-mini', temperature: 0 });
    server!.close();

    const hold = await endpoint(reply('{"decision":"hold","reason":"console.log left in\\nsrc/a.ts"}'));
    expect(await requestReview(request(hold.baseUrl, { model: 'acme/reviewer' }))).toEqual({ outcome: 'hold', detail: 'console.log left in src/a.ts' });
    expect(hold.received[0].body.model).toBe('acme/reviewer');
  });

  it('bounds long reasons and fills in a missing one', async () => {
    const { baseUrl } = await endpoint(reply(JSON.stringify({ decision: 'hold', reason: 'x'.repeat(1000) })));
    const result = await requestReview(request(baseUrl));
    expect(result.detail).toHaveLength(300);
    server!.close();
    const bare = await endpoint(reply('{"decision":"ship"}'));
    expect(await requestReview(request(bare.baseUrl))).toEqual({ outcome: 'approve', detail: 'reviewer chose ship' });
  });

  it.each([
    ['no API key', null, { apiKey: undefined }, /no API key/],
    ['HTTP 500', (_req: IncomingMessage, res: ServerResponse) => res.writeHead(500).end('boom'), {}, /HTTP 500 from 127\.0\.0\.1/],
    ['malformed JSON', (_req: IncomingMessage, res: ServerResponse) => res.writeHead(200).end('{not json'), {}, /not valid JSON/],
    ['no choices', (_req: IncomingMessage, res: ServerResponse) => res.writeHead(200).end('{"error":"x"}'), {}, /no message content/],
    ['non-string content', reply({ decision: 'ship' }), {}, /no message content/],
    ['prose without JSON', reply('Looks good to me!'), {}, /did not answer/],
    ['unexpected decision', reply('{"decision":"approve"}'), {}, /did not answer/],
    ['broken JSON in content', reply('{"decision": ship}'), {}, /did not answer/],
  ])('fails closed on %s', async (_name, handler, over, detail) => {
    const baseUrl = handler ? (await endpoint(handler)).baseUrl : 'http://127.0.0.1:9';
    const result = await requestReview(request(baseUrl, over));
    expect(result.outcome).toBe('unavailable');
    expect(result.detail).toMatch(detail);
  });

  it('fails closed on a timeout and on a refused connection', async () => {
    const { baseUrl } = await endpoint(() => undefined);
    expect(await requestReview(request(baseUrl, { timeoutMs: 200 }))).toEqual({ outcome: 'unavailable', detail: 'no response within 0.2 s' });
    server!.close();
    server = undefined;
    const refused = await requestReview(request('http://127.0.0.1:9'));
    expect(refused.outcome).toBe('unavailable');
    expect(refused.detail).toMatch(/^request failed/);
  });
});

describe('what review sends', () => {
  it('redacts every outbound text field before truncating the payload', async () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nsecretmaterial\n-----END PRIVATE KEY-----';
    const { baseUrl, received } = await endpoint(reply('{"decision":"hold","reason":"x"}'));
    await requestReview(request(baseUrl, {
      changedFiles: [`dir/${SYNTHETIC.github}.txt`],
      prompt: `${SYNTHETIC.jwt} ${pem}`,
      diff: `${'x'.repeat(REVIEW_DIFF_LIMIT - 10)}${pem}`,
    }));
    const sent = JSON.stringify(received[0].body);
    for (const value of [SYNTHETIC.github, SYNTHETIC.jwt, 'secretmaterial', 'BEGIN PRIVATE KEY']) expect(sent).not.toContain(value);
  });

  it('sends exactly the documented fields', () => {
    const [system, user] = buildReviewMessages({
      changedFiles: ['.env', 'src/a.ts'],
      omittedFiles: ['.env'],
      diff: 'x'.repeat(REVIEW_DIFF_LIMIT + 5),
      prompt: 'Add a helper',
    });
    expect(system.role).toBe('system');
    const payload = JSON.parse(user.content);
    expect(Object.keys(payload)).toEqual(['changedFiles', 'omittedFiles', 'prompt', 'diff', 'diffTruncated']);
    expect(payload).toMatchObject({ changedFiles: ['.env', 'src/a.ts'], omittedFiles: ['.env'], prompt: 'Add a helper', diffTruncated: true });
    expect(payload.diff).toHaveLength(REVIEW_DIFF_LIMIT);
  });
});
