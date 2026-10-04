import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
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

/** Serve the simulator on 127.0.0.1. Resolves once listening; rejects if the port is unavailable. */
export function serveSimulator(dist: string, port: number): Promise<Server> {
  const root = normalize(dist.endsWith(sep) ? dist : dist + sep);
  const server = createServer((req, res) => {
    let path = '/';
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    const file = normalize(join(root, path === '/' ? 'index.html' : `.${path}`));
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const target = existsSync(file) && statSync(file).isFile() ? file : extname(file) ? null : join(root, 'index.html');
    if (!target) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(target));
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise(server));
  });
}
