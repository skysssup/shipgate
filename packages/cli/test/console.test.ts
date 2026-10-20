import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serveConsole, type ConsoleServer } from '../src/commands/console.js';
import { writeGlobalConfig } from '../src/config.js';
import { addOrigin, cli, remoteHead, repo, SYNTHETIC, tempDir, write } from './helpers.js';

const servers: ConsoleServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((done) => s.server.close(done));
});

const privateRemote = (urls: string[]) => (urls.length
  ? { visibility: 'private' as const, description: 'github.com/acme/app (private)' }
  : { visibility: 'none' as const, description: 'no origin remote (commits stay local)' });

function webDist(): string {
  const dir = tempDir('shipgate-web-');
  write(dir, 'index.html', '<!doctype html><html><head><title>t</title></head><body></body></html>');
  write(dir, 'assets/app.js', 'console.log(1)');
  return dir;
}

async function start(cwd: string): Promise<ConsoleServer> {
  const s = await serveConsole({ cwd, dist: webDist(), port: 0, token: 'test-token', classifyRemote: privateRemote });
  servers.push(s);
  return s;
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: () => any;
}

/** Raw HTTP so the test controls the Host header. */
function send(s: ConsoleServer, method: string, path: string, opts: { body?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: s.port, method, path, headers: opts.headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

const auth = { 'X-Shipgate-Token': 'test-token' };
const api = (s: ConsoleServer, method: string, path: string, body?: unknown) =>
  send(s, method, path, {
    headers: { ...auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('repository console server', () => {
  it('embeds the session token in the page and serves assets', async () => {
    const s = await start(repo().dir);
    const page = await send(s, 'GET', '/');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<meta name="shipgate-console" content="test-token"');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect((await send(s, 'GET', '/repo')).text).toContain('shipgate-console');
    expect((await send(s, 'GET', '/assets/app.js')).text).toBe('console.log(1)');
    expect((await send(s, 'GET', '/missing.js')).status).toBe(404);
    const traversal = await send(s, 'GET', '/%2e%2e/%2e%2e/etc/passwd');
    expect(traversal.text).not.toMatch(/root:/);
    expect((await send(s, 'GET', '/..%2f..%2fetc%2fpasswd')).text).not.toMatch(/root:/);
    expect(s.url).toBe(`http://127.0.0.1:${s.port}/#/repo`);
  });

  it('refuses other Host headers, missing tokens, and non-JSON writes', async () => {
    const s = await start(repo().dir);
    expect((await send(s, 'GET', '/', { headers: { Host: 'evil.example' } })).status).toBe(403);
    expect((await send(s, 'GET', '/api/status', { headers: { ...auth, Host: `evil.example:${s.port}` } })).status).toBe(403);
    expect((await send(s, 'GET', '/', { headers: { Host: `localhost:${s.port}` } })).status).toBe(200);
    expect((await send(s, 'GET', '/api/status')).status).toBe(401);
    expect((await send(s, 'GET', '/api/status', { headers: { 'X-Shipgate-Token': 'wrong-token' } })).status).toBe(401);
    const form = await send(s, 'POST', '/api/on', { headers: { ...auth, 'Content-Type': 'text/plain' }, body: '{"level":"yolo"}' });
    expect(form.status).toBe(415);
    expect((await send(s, 'POST', '/api/on', { headers: { ...auth, 'Content-Type': 'application/json' }, body: '{oops' })).status).toBe(400);
    expect((await send(s, 'POST', '/api/on', { headers: { ...auth, 'Content-Type': 'application/json' }, body: 'x'.repeat(70 * 1024) })).status).toBe(413);
    expect((await api(s, 'POST', '/api/preview', { forceSecrets: 'yes' })).status).toBe(400);
    expect((await api(s, 'GET', '/api/ship')).status).toBe(405);
    expect((await api(s, 'GET', '/api/nope')).status).toBe(404);
    expect((await send(s, 'POST', '/', { headers: auth })).status).toBe(405);
  });

  it('refuses to store an API key from the browser', async () => {
    const r = repo(null);
    const s = await start(r.dir);
    const reply = await api(s, 'POST', '/api/on', { key: 'sk-test' });
    expect(reply.status).toBe(400);
    expect(reply.json().error).toContain('does not store API keys');
  });

  it('runs status, settings, preview, ship, history, and undo against the repository', async () => {
    const r = repo(null);
    const bare = addOrigin(r);
    const s = await start(join(r.dir));

    expect((await api(s, 'GET', '/api/session')).json()).toMatchObject({ version: expect.any(String), name: expect.any(String) });
    expect((await api(s, 'GET', '/api/status')).json()).toMatchObject({ enabled: false, config: { state: 'missing' }, destination: { visibility: 'private' } });

    const on = (await api(s, 'POST', '/api/on', { level: 'strict', agentReview: false, publicOk: true, account: 'octocat' })).json();
    expect(on.exitCode).toBe(0);
    expect(on.lines[0]).toContain('enabled .shipgate.json');
    expect((await api(s, 'GET', '/api/status')).json()).toMatchObject({ enabled: true, level: 'strict', publicOk: true, account: 'octocat' });
    expect((await api(s, 'POST', '/api/on', { account: 'not a login!' })).json()).toMatchObject({ exitCode: 1 });

    r.write('.env', `KEY=${SYNTHETIC.openai}\n`);
    const blocked = (await api(s, 'POST', '/api/preview', {})).json();
    expect(blocked).toMatchObject({ state: 'ready', plan: { action: 'block' } });
    expect(blocked.lines[0]).toContain('ship would BLOCK');
    const shipBlocked = (await api(s, 'POST', '/api/ship', { message: 'try' })).json();
    expect(shipBlocked).toMatchObject({ outcome: 'blocked', committed: false });

    r.git('rm', '--quiet', '--cached', '--ignore-unmatch', '.env');
    write(r.dir, '.git/info/exclude', '.env\n.shipgate.json\n');
    r.write('feature.txt', 'feature\n');
    const shipped = (await api(s, 'POST', '/api/ship', { message: 'Add feature', confirm: true })).json();
    expect(shipped).toMatchObject({ outcome: 'pushed', pushed: true, exitCode: 0 });
    expect(shipped.lines[0]).toMatch(/^shipgate: SHIPPED/);
    expect(remoteHead(bare)).toBe(r.head());

    const history = (await api(s, 'GET', '/api/history?limit=5')).json();
    expect(history).toMatchObject({ undoCandidate: true, branch: 'main' });
    expect(history.commits[0]).toMatchObject({ subject: 'Add feature', shipgate: true, onOrigin: true });

    const undone = (await api(s, 'POST', '/api/undo', {})).json();
    expect(undone).toMatchObject({ undone: true, outcome: 'undone-remote' });
    expect(r.read('feature.txt')).toBe('feature\n');
    expect((await api(s, 'GET', '/api/history')).json().undoCandidate).toBe(false);

    const off = (await api(s, 'POST', '/api/off', {})).json();
    expect(off.exitCode).toBe(0);
    expect((await api(s, 'GET', '/api/status')).json().enabled).toBe(false);
  });

  it('installs hooks into the sandboxed agent settings', async () => {
    const s = await start(repo().dir);
    const setup = (await api(s, 'POST', '/api/setup', {})).json();
    expect(setup.exitCode).toBe(0);
    expect((await api(s, 'GET', '/api/status')).json().hooks).toMatchObject({ claude: true, cursor: true });
  });

  it('runs commands one at a time', async () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    const s = await start(r.dir);
    const results = await Promise.all([api(s, 'POST', '/api/ship', { message: 'one' }), api(s, 'POST', '/api/ship', { message: 'two' })]);
    const outcomes = results.map((x) => x.json().outcome).sort();
    expect(outcomes).toEqual(['committed', 'nothing-to-ship']);
  });

  it('queues other commands behind a ship that is waiting for external review', async () => {
    let release: (() => void) | undefined;
    let reviewing!: () => void;
    const reviewStarted = new Promise<void>((done) => (reviewing = done));
    const reviewer: Server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        reviewing();
        release = () => {
          release = undefined;
          res.writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ choices: [{ message: { content: '{"decision":"ship","reason":"ok"}' } }] }));
        };
      });
    });
    await new Promise<void>((done) => reviewer.listen(0, '127.0.0.1', done));
    try {
      writeGlobalConfig({ openRouterApiKey: 'test-review-key', baseUrl: `http://127.0.0.1:${(reviewer.address() as AddressInfo).port}/v1` });
      const r = repo({ agentReview: true, publicOk: true });
      r.write('a.txt', 'a\n');
      const s = await start(r.dir);
      const order: string[] = [];
      const ship = api(s, 'POST', '/api/ship', { prompt: 'add a', confirm: true }).then((x) => { order.push('ship'); return x.json(); });
      await reviewStarted;
      const off = api(s, 'POST', '/api/off', {}).then((x) => { order.push('off'); return x.json(); });
      await new Promise((done) => setTimeout(done, 200));
      expect(order).toEqual([]);
      release!();
      const [shipped, disabled] = await Promise.all([ship, off]);
      expect(order).toEqual(['ship', 'off']);
      expect(shipped.review).toBe('approved');
      expect(disabled.exitCode).toBe(0);
    } finally {
      release?.();
      writeGlobalConfig({});
      await new Promise((done) => reviewer.close(done));
    }
  });

  it('starts from the CLI only inside a repository and validates --port', () => {
    const outside = cli(tempDir(), ['ui', '--port', '0']);
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain('not inside a Git repository');
    expect(cli(repo().dir, ['ui', '--port', 'abc']).status).toBe(1);
    expect(cli(repo().dir, ['ui', '--port', '70000']).stderr).toContain('--port expects a number');
  });
});
