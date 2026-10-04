import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIOS } from '@shipgate/core';
import { BIN, cli, repo, SYNTHETIC, tempDir } from './helpers.js';

const pkg = JSON.parse(readFileSync(join(BIN, '..', '..', 'package.json'), 'utf8')) as { version: string };

describe('help, version, and usage errors', () => {
  it('prints help on stdout for --help, -h, help, and no arguments', () => {
    for (const args of [['--help'], ['-h'], ['help'], [], ['ship', '--help']]) {
      const run = cli(tempDir(), args);
      expect(run.status).toBe(0);
      expect(run.stderr).toBe('');
      expect(run.stdout).toContain('Usage: shipgate <command> [options]');
      expect(run.stdout).toContain('ship     Stage ALL changes');
    }
  });

  it('prints the package version', () => {
    for (const flag of ['--version', '-v']) {
      expect(cli(tempDir(), [flag])).toEqual({ status: 0, stdout: `${pkg.version}\n`, stderr: '' });
    }
  });

  it.each([
    [['shp'], "unknown command 'shp'; did you mean 'ship'?"],
    [['on', '--levle', 'strict'], 'unknown option --levle for \'on\'; did you mean --level?'],
    [['on', '--level'], '--level requires a value'],
    [['ship', '--force-secrets=yes'], "--force-secrets expects true or false, not 'yes'"],
    [['demo', '--port', '80'], '--port only applies with --serve'],
    [['demo', '--serve', '--port', 'http'], '--port expects a number from 0 to 65535 (0 picks a free port)'],
  ])('rejects %j with exit 1 and a hint on stderr', (args, message) => {
    const run = cli(tempDir(), args);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe(`shipgate: ${message}\nRun shipgate --help for usage.\n`);
  });

  it('rejects an unknown flag before touching the repository', () => {
    const r = repo();
    r.write('.env', `KEY=${SYNTHETIC.openai}\n`);
    const run = cli(r.dir, ['ship', '--force-secret']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('did you mean --force-secrets?');
    expect(r.git('status', '--porcelain')).toBe('?? .env');
  });
});

describe('ship output streams and exit codes', () => {
  it('exits 0 with a message outside a repository', () => {
    const run = cli(tempDir(), ['ship']);
    expect(run).toEqual({ status: 0, stdout: '', stderr: 'shipgate: NOT A REPOSITORY — Not inside a Git repository.\n' });
  });

  it('writes the human report to stderr and JSON to stdout', () => {
    const r = repo();
    r.write('.env', `KEY=${SYNTHETIC.openai}\n`);
    const run = cli(r.dir, ['ship', '--json']);
    expect(run.status).toBe(0);
    expect(run.stderr.split('\n')[0]).toBe('shipgate: BLOCKED — Credential findings block this run.');
    const result = JSON.parse(run.stdout);
    expect(result).toMatchObject({ outcome: 'blocked', action: 'block', exitCode: 0, committed: false, staging: 'restored' });
    expect(run.stdout + run.stderr).not.toContain(SYNTHETIC.openai);
    expect(run.stderr).not.toMatch(/\u001b\[/);
  });

  it('exits 1 for invalid configuration', () => {
    const r = repo(null);
    r.write('.shipgate.json', '{"level":"loose"}');
    const run = cli(r.dir, ['ship']);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^shipgate: CONFIG ERROR — \.shipgate\.json is invalid: "level" must be/);
  });

  it('commits and prints the commit line', () => {
    const r = repo();
    r.write('a.txt', 'x\n');
    const run = cli(r.dir, ['ship', '-m', 'feat: a']);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/^shipgate: COMMITTED — Committed ([0-9a-f]{7,}) on main\. There is no origin remote, so nothing was pushed\.\n  commit   \1 feat: a\n$/);
  });
});

describe('on and off', () => {
  it('enables with defaults, keeps settings on re-run, and reports what it wrote', () => {
    const r = repo(null);
    const first = cli(r.dir, ['on', '--level', 'strict', '--agent', '--model', 'acme/reviewer']);
    expect(first.status).toBe(0);
    expect(first.stderr).toMatch(/^shipgate: enabled \.shipgate\.json in \S/);
    expect(first.stderr).toContain('External review sends file paths, the redacted staged diff, and --prompt text');
    const again = cli(join(r.dir), ['on', '--public-ok']);
    expect(again.stderr).toContain('shipgate: updated .shipgate.json');
    expect(JSON.parse(r.read('.shipgate.json'))).toEqual({ enabled: true, level: 'strict', agentReview: true, publicOk: true, model: 'acme/reviewer' });
    cli(r.dir, ['on', '--agent=false']);
    expect(JSON.parse(r.read('.shipgate.json'))).toMatchObject({ level: 'strict', agentReview: false });
  });

  it('notes when .shipgate.json would be committed', () => {
    const r = repo(null);
    r.write('.git/info/exclude', '');
    expect(cli(r.dir, ['on']).stderr).toContain('.shipgate.json is not ignored, so the next ship commits it.');
  });

  it('disables while keeping settings, and refuses to overwrite an invalid file', () => {
    const r = repo({ level: 'yolo' });
    const off = cli(r.dir, ['off']);
    expect(off.status).toBe(0);
    expect(JSON.parse(r.read('.shipgate.json'))).toMatchObject({ enabled: false, level: 'yolo' });
    expect(JSON.parse(r.read('.shipgate.json')).enabled).toBe(false);
    cli(r.dir, ['on']);
    expect(JSON.parse(r.read('.shipgate.json'))).toMatchObject({ enabled: true, level: 'yolo' });

    r.write('.shipgate.json', '{"levle":"strict"}');
    for (const command of ['on', 'off']) {
      const run = cli(r.dir, [command]);
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/is invalid \(unknown setting "levle"\)/);
    }
    expect(r.read('.shipgate.json')).toBe('{"levle":"strict"}');
  });

  it('fails outside a repository and rejects an invalid level or account', () => {
    expect(cli(tempDir(), ['on']).status).toBe(1);
    const r = repo(null);
    expect(cli(r.dir, ['on', '--level', 'max']).stderr).toMatch(/unknown policy level "max"/);
    expect(cli(r.dir, ['on', '--account', 'not valid']).stderr).toMatch(/invalid --account/);
  });

  it('stores --key with owner-only permissions', () => {
    const r = repo(null);
    const home = tempDir();
    const run = cli(r.dir, ['on', '--agent', '--key', 'synthetic-key'], { env: { SHIPGATE_HOME: home } });
    expect(run.status).toBe(0);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({ openRouterApiKey: 'synthetic-key' });
    if (process.platform !== 'win32') expect(statSync(join(home, 'config.json')).mode & 0o777).toBe(0o600);
  });
});

describe('undo through the CLI', () => {
  it('reports a refusal on stderr with exit 1 and JSON on request', () => {
    const r = repo();
    const run = cli(r.dir, ['undo', '--json']);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^shipgate: NOT UNDONE — HEAD \([0-9a-f]{7} "initial"\) was not created by shipgate ship\./);
    expect(JSON.parse(run.stdout)).toMatchObject({ undone: false, outcome: 'refused', exitCode: 1 });
  });
});

describe('demo', () => {
  it('lists every example with its decision on stdout', () => {
    const run = cli(tempDir(), ['demo']);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    for (const scenario of DEMO_SCENARIOS) expect(run.stdout).toMatch(new RegExp(`\\n  ${scenario.id} +(SHIP|HOLD|BLOCK|NOOP) `));
    expect(run.stdout).toMatch(/credential-in-env +BLOCK  Credential findings block this run\./);
    const json = JSON.parse(cli(tempDir(), ['demo', '--json']).stdout);
    expect(json.map((row: { id: string }) => row.id)).toEqual(DEMO_SCENARIOS.map((s) => s.id));
  });

  it('serves the simulator and reports a port that is in use', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as { port: number }).port;
    const busy = cli(tempDir(), ['demo', '--serve', '--port', String(port)]);
    blocker.close();
    expect(busy.status).toBe(1);
    expect(busy.stderr).toMatch(/could not listen on 127\.0\.0\.1:\d+ .*try --port/);

    const child = spawn(process.execPath, [BIN, 'demo', '--serve', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        child.stdout.on('data', (chunk: Buffer) => {
          const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(chunk.toString());
          if (match) resolve(match[0]);
        });
        child.on('exit', (code) => reject(new Error(`demo exited with ${code}`)));
      });
      const page = await fetch(url);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('<div id="root">');
      const asset = /(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/.exec(html)?.[1];
      expect(asset).toBeTruthy();
      const js = await fetch(new URL(asset!, url));
      expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      const css = await (await fetch(new URL(/href="\.?\/?(assets\/[^"]+\.css)"/.exec(html)![1], url))).text();
      const font = /url\(\.?\/?([^)]+\.woff2)\)/.exec(css)?.[1];
      expect(font).toBeTruthy();
      expect((await fetch(new URL(`assets/${font!.replace(/^assets\//, '')}`, url))).headers.get('content-type')).toBe('font/woff2');
      expect((await fetch(new URL('assets/missing.js', url))).status).toBe(404);
      expect((await fetch(new URL('/%2e%2e/package.json', url))).status).not.toBe(200);
    } finally {
      child.kill();
    }
  });
});
