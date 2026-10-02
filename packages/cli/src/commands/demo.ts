import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_SCENARIOS, planRun } from '@shipgate/core';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function webDistCandidates(): string[] {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return [
    join(here, '../../../../apps/web/dist'),
    join(process.cwd(), 'apps/web/dist'),
    join(process.cwd(), 'dist-web'),
  ];
}

export function findWebDist(): string | null {
  for (const c of webDistCandidates()) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  return null;
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function runDemo(opts: { serve?: boolean; port?: number } = {}): number {
  const dist = findWebDist();

  if (!opts.serve) {
    if (dist) {
      process.stderr.write(`shipgate demo (local dist): ${dist}\n`);
      process.stderr.write('shipgate: run `shipgate demo --serve` to preview locally\n');
    } else {
      process.stderr.write(
        'shipgate: local web dist not built — `npm run build -w @shipgate/web`\n',
      );
    }
    for (const s of DEMO_SCENARIOS) {
      const r = planRun(s.input);
      process.stderr.write(`  [${s.id}] ${r.action}: ${r.reasons[0]}\n`);
    }
    return 0;
  }

  if (!dist) {
    process.stderr.write('shipgate: no web dist to serve\n');
    return 0;
  }

  const port = opts.port ?? 4173;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`shipgate: invalid port ${String(opts.port)}\n`);
    return 1;
  }
  const distRoot = normalize(dist.endsWith(sep) ? dist : dist + sep);
  const server = createServer((req, res) => {
    const urlPath = safeDecode((req.url || '/').split('?')[0] || '/');
    let rel = urlPath === '/' ? '/index.html' : urlPath;
    if (rel.startsWith('/shipgate/')) rel = rel.slice('/shipgate'.length);
    const filePath = normalize(join(distRoot, '.' + rel));
    if (!filePath.startsWith(distRoot)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    try {
      const data = readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      });
      res.end(data);
    } catch {
      try {
        const data = readFileSync(join(distRoot, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    }
  });

  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(
      `shipgate: serving ${dist} at http://127.0.0.1:${port}/\n`,
    );
  });
  return 0;
}
