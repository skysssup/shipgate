import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_SCENARIOS, planRun, scenarioInput, type RunPlanResult } from '@shipgate/core';
import { VERSION } from '../version.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** The simulator ships inside the CLI package (`web/`); a source checkout uses apps/web/dist. */
export function findWebDist(): string | null {
  const here = fileURLToPath(new URL('.', import.meta.url));
  for (const candidate of [resolve(here, '../../web'), resolve(here, '../../../../apps/web/dist')]) {
    if (existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

export interface DemoRow {
  id: string;
  title: string;
  summary: string;
  result: RunPlanResult;
}

export function demoRows(): DemoRow[] {
  return DEMO_SCENARIOS.map((s) => ({ id: s.id, title: s.title, summary: s.summary, result: planRun(scenarioInput(s)) }));
}

export function formatDemo(rows: DemoRow[]): string[] {
  const width = Math.max(...rows.map((r) => r.id.length));
  return [
    `Shipgate ${VERSION} examples. Decisions come from the same policy code as shipgate ship;`,
    'the inputs are built-in samples, and no repository is read or changed.',
    '',
    ...rows.map((r) => `  ${r.id.padEnd(width)}  ${r.result.action.toUpperCase().padEnd(5)}  ${r.result.summary}`),
    '',
    'Explore and change the inputs in the simulator: shipgate demo --serve',
  ];
}

/** Send a file from the web build, or index.html for paths without an extension. */
export function sendStatic(
  root: string,
  pathname: string,
  res: ServerResponse,
  transformIndex?: (html: string) => string,
  headers: Record<string, string> = {},
): void {
  const base = normalize(root.endsWith(sep) ? root : root + sep);
  const file = normalize(join(base, pathname === '/' ? 'index.html' : `.${pathname}`));
  if (!file.startsWith(base)) {
    res.writeHead(403, headers).end('forbidden');
    return;
  }
  const target = existsSync(file) && statSync(file).isFile() ? file : extname(file) ? null : join(base, 'index.html');
  if (!target) {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  const type = MIME[extname(target)] ?? 'application/octet-stream';
  if (transformIndex && target === join(base, 'index.html')) {
    res.writeHead(200, { ...headers, 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(transformIndex(readFileSync(target, 'utf8')));
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(readFileSync(target));
}

/** Decoded URL path, or null when the request target is malformed. */
export function requestPath(req: IncomingMessage): string | null {
  try {
    return decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    return null;
  }
}

/** Serve the simulator on 127.0.0.1. Resolves once listening; rejects if the port is unavailable. */
export function serveSimulator(dist: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const path = requestPath(req);
    if (path === null) {
      res.writeHead(400).end('bad request');
      return;
    }
    sendStatic(dist, path, res);
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise(server));
  });
}
