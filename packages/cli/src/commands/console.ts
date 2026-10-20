import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename } from 'node:path';
import { formatShipResult } from '@shipgate/core';
import { createGit, repoInfo } from '../git.js';
import type { RemoteInfo } from '../remote-public.js';
import { VERSION } from '../version.js';
import { requestPath, sendStatic } from './demo.js';
import { shipHistory } from './history.js';
import { runOff, runOn } from './on-off.js';
import { formatPreview, runPreview } from './preview.js';
import { runSetup } from './setup.js';
import { runShip, type ShipOptions } from './ship.js';
import { gatherStatus } from './status.js';
import { formatUndoResult, runUndo } from './undo.js';

/** Header the console page sends with every API request. */
export const TOKEN_HEADER = 'x-shipgate-token';
const MAX_BODY_BYTES = 64 * 1024;

export interface ConsoleOptions {
  /** Directory inside the repository the console works on. */
  cwd: string;
  /** Web build to serve (apps/web/dist or the CLI package's web/ directory). */
  dist: string;
  port: number;
  /** Fixed session token, for tests. A random one is generated otherwise. */
  token?: string;
  /** Replaceable for tests, to avoid asking GitHub about visibility. */
  classifyRemote?: (urls: string[]) => RemoteInfo;
}

export interface ConsoleServer {
  server: Server;
  port: number;
  token: string;
  root: string;
  url: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sameToken(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Send the request body as application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'The request body is larger than 64 KiB.');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'The request body must be a JSON object.');
  return body as Record<string, unknown>;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `"${key}" must be a string.`);
  if (value.length > 8000) throw new HttpError(400, `"${key}" is longer than 8000 characters.`);
  return value;
}

function optionalBool(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new HttpError(400, `"${key}" must be true or false.`);
  return value;
}

function runOptions(body: Record<string, unknown>): Pick<ShipOptions, 'message' | 'prompt' | 'forceSecrets' | 'publicOk' | 'confirm'> {
  return {
    message: optionalString(body, 'message'),
    prompt: optionalString(body, 'prompt'),
    forceSecrets: optionalBool(body, 'forceSecrets'),
    publicOk: optionalBool(body, 'publicOk'),
    confirm: optionalBool(body, 'confirm'),
  };
}

/** Escape text for an HTML attribute value. */
function attr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Serve the repository console: the web app plus a JSON API that runs the same command
 * functions as the CLI (status, preview, on/off, ship, undo, setup) in one repository.
 *
 * Only 127.0.0.1 is bound. Requests must name 127.0.0.1 or localhost in Host (DNS
 * rebinding), API calls must carry the per-session token that is embedded in the page
 * (other origins cannot read it), and writes must be JSON (no simple cross-site form posts).
 * Commands that change the repository run one at a time.
 */
export async function serveConsole(opts: ConsoleOptions): Promise<ConsoleServer> {
  const git = createGit(opts.cwd);
  const info = repoInfo(git);
  if (!info) throw new Error('not inside a Git repository; run shipgate ui from the repository you want to manage.');
  const root = info.root;
  const token = opts.token ?? randomBytes(24).toString('base64url');
  const classify = opts.classifyRemote;
  let port = opts.port;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => T | Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const api = async (req: IncomingMessage, path: string): Promise<[number, unknown]> => {
    const method = req.method ?? 'GET';
    const route = `${method} ${path}`;
    switch (route) {
      case 'GET /api/session':
        return [200, { version: VERSION, root, name: basename(root) }];
      case 'GET /api/status':
        return [200, await serial(() => gatherStatus(root, classify))];
      case 'GET /api/history': {
        const limit = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('limit') ?? 30);
        return [200, await serial(() => shipHistory({ cwd: root, limit: Number.isFinite(limit) ? limit : 30 }))];
      }
      case 'POST /api/preview': {
        const options = runOptions(await readJson(req));
        return [200, await serial(() => {
          const result = runPreview({ ...options, cwd: root, classifyRemote: classify });
          return { ...result, lines: formatPreview(result) };
        })];
      }
      case 'POST /api/on': {
        const body = await readJson(req);
        if ('key' in body) throw new HttpError(400, 'The console does not store API keys; use OPENROUTER_API_KEY or shipgate on --key.');
        const level = optionalString(body, 'level');
        const model = optionalString(body, 'model');
        const account = optionalString(body, 'account');
        const result = await serial(() => runOn({
          cwd: root,
          level,
          agent: optionalBool(body, 'agentReview'),
          publicOk: optionalBool(body, 'publicOk'),
          model,
          account,
          classifyRemote: classify,
        }));
        return [200, result];
      }
      case 'POST /api/off':
        await readJson(req);
        return [200, await serial(() => runOff({ cwd: root }))];
      case 'POST /api/ship': {
        const options = runOptions(await readJson(req));
        const result = await serial(() => runShip({ ...options, cwd: root, classifyRemote: classify }));
        return [200, { ...result, lines: formatShipResult(result) }];
      }
      case 'POST /api/undo': {
        await readJson(req);
        const result = await serial(() => runUndo({ cwd: root }));
        return [200, { ...result, lines: formatUndoResult(result) }];
      }
      case 'POST /api/setup':
        await readJson(req);
        return [200, await serial(() => runSetup())];
      default:
        if (/^\/api\/(session|status|history|preview|on|off|ship|undo|setup)$/.test(path)) throw new HttpError(405, `${method} is not allowed on ${path}.`);
        throw new HttpError(404, `No API endpoint ${path}.`);
    }
  };

  const server = createServer((req, res) => {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('forbidden host');
      return;
    }
    const path = requestPath(req);
    if (path === null) {
      res.writeHead(400, SECURITY_HEADERS).end('bad request');
      return;
    }
    if (path === '/api' || path.startsWith('/api/')) {
      if (!sameToken(req.headers[TOKEN_HEADER], token)) {
        sendJson(res, 401, { error: 'Missing or wrong session token. Reload the page that shipgate ui opened.' });
        return;
      }
      api(req, path).then(
        ([status, body]) => sendJson(res, status, body),
        (error: unknown) => {
          if (error instanceof HttpError) sendJson(res, error.status, { error: error.message });
          else sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        },
      );
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, SECURITY_HEADERS).end('method not allowed');
      return;
    }
    sendStatic(opts.dist, path, res, (html) => html.replace(
      '</head>',
      `    <meta name="shipgate-console" content="${attr(token)}" data-repo="${attr(basename(root))}" />\n  </head>`,
    ), SECURITY_HEADERS);
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  port = address && typeof address === 'object' ? address.port : opts.port;
  return { server, port, token, root, url: `http://127.0.0.1:${port}/#/repo` };
}
