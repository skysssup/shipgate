#!/usr/bin/env node
// Install the release tarballs into empty directories outside the repository, offline,
// and exercise them the way a user would. Run after `npm run pack:release`.
//   node scripts/verify-package.mjs [release-dir]
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = resolve(process.argv[2] ?? join(root, 'release'));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cliTarball = join(release, `shipgate-cli-${version}.tgz`);
const coreTarball = join(release, `shipgate-core-${version}.tgz`);
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const work = realpathSync.native(mkdtempSync(join(tmpdir(), 'shipgate-verify-')));
const results = [];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows && cmd.endsWith('.cmd'), ...opts });
}
function check(name, fn) {
  fn();
  results.push(`ok  ${name}`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  // Global install, offline: proves the CLI tarball carries everything it needs.
  const prefix = join(work, 'global');
  run(npm, ['install', '--global', '--prefix', prefix, '--offline', '--no-audit', '--no-fund', cliTarball]);
  const shim = isWindows ? join(prefix, 'shipgate.cmd') : join(prefix, 'bin', 'shipgate');
  const entry = join(prefix, ...(isWindows ? [] : ['lib']), 'node_modules', '@shipgate', 'cli', 'dist', 'bin.js');
  const shipgate = (args, cwd = work, extra = {}) =>
    execFileSync(process.execPath, [entry, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...extra });
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(work, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    SHIPGATE_HOME: join(work, 'home'),
    SHIPGATE_CLAUDE_SETTINGS: join(work, 'claude', 'settings.json'),
    SHIPGATE_CURSOR_HOOKS: join(work, 'cursor', 'hooks.json'),
  };
  writeFileSync(env.GIT_CONFIG_GLOBAL, '[user]\n\tname = Verify\n\temail = verify@example.invalid\n[init]\n\tdefaultBranch = main\n');

  check('the installed shipgate command prints the release version', () => {
    const out = execFileSync(shim, ['--version'], { encoding: 'utf8', shell: isWindows });
    assert(out.trim() === version, `wrong version ${out}`);
  });
  check('shipgate --help prints usage on stdout', () => assert(shipgate(['--help']).includes('Usage: shipgate <command>'), 'no usage'));
  check('shipgate demo prints every example', () => {
    const out = shipgate(['demo']);
    for (const id of ['clean-change', 'credential-in-env', 'review-hold']) assert(out.includes(id), `demo is missing ${id}`);
  });

  check('on, ship, status, and undo work in a fresh repository', () => {
    const repo = join(work, 'repo');
    const origin = join(work, 'origin.git');
    run('git', ['init', '--quiet', '--bare', origin], { env });
    run('git', ['init', '--quiet', repo], { env });
    writeFileSync(join(repo, 'README.md'), 'hello\n');
    run('git', ['add', 'README.md'], { cwd: repo, env });
    run('git', ['commit', '--quiet', '-m', 'initial'], { cwd: repo, env });
    run('git', ['remote', 'add', 'origin', origin], { cwd: repo, env });
    run('git', ['push', '--quiet', '--set-upstream', 'origin', 'main'], { cwd: repo, env });
    shipgate(['on', '--level', 'strict'], repo, { env });
    writeFileSync(join(repo, 'feature.txt'), 'feature\n');
    const result = JSON.parse(shipgate(['ship', '--json', '-m', 'feat: verify package'], repo, { env }));
    assert(result.outcome === 'pushed', `ship outcome ${result.outcome}`);
    assert(run('git', ['rev-parse', 'HEAD'], { cwd: repo, env }).trim() === run('git', ['rev-parse', 'main'], { cwd: origin, env }).trim(), 'push did not reach origin');
    const status = JSON.parse(shipgate(['status', '--json'], repo, { env }));
    assert(status.version === version && status.level === 'strict' && status.lock.state === 'free', 'unexpected status');
    const undo = JSON.parse(shipgate(['undo', '--json'], repo, { env }));
    assert(undo.outcome === 'undone-remote', `undo outcome ${undo.outcome}`);
    writeFileSync(join(repo, '.env'), `TOKEN=${['ghp', 'verifyPackage0123456789abcdefghijklmn'].join('_')}\n`);
    const blocked = JSON.parse(shipgate(['ship', '--json'], repo, { env }));
    assert(blocked.outcome === 'blocked' && blocked.findings.length === 2, 'credential was not blocked');
  });

  check('setup writes hooks to isolated paths', () => {
    shipgate(['setup'], work, { env });
    assert(readFileSync(env.SHIPGATE_CURSOR_HOOKS, 'utf8').includes('shipgate ship --hook cursor'), 'cursor hook missing');
  });

  // Local install of the core library, imported by plain Node.js and type-checked.
  check('@shipgate/core installs and imports with types', () => {
    const consumer = join(work, 'consumer');
    mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), '{ "name": "consumer", "private": true, "type": "module" }\n');
    run(npm, ['install', '--offline', '--no-audit', '--no-fund', coreTarball], { cwd: consumer });
    const out = run('node', ['--input-type=module', '-e', "import { planRun, DEMO_SCENARIOS, scenarioInput } from '@shipgate/core'; console.log(planRun(scenarioInput(DEMO_SCENARIOS[1])).action)"], { cwd: consumer });
    assert(out.trim() === 'block', `unexpected planRun result ${out}`);
    writeFileSync(join(consumer, 'check.mts'), "import { planRun, type RunPlanInput } from '@shipgate/core';\nconst input: RunPlanInput = { configPresent: true, dirtyFiles: ['a'], findings: [], level: 'strict', flags: {}, remote: 'none', busyAgents: 0, review: { enabled: false } };\nconst action: 'ship' | 'hold' | 'block' | 'noop' = planRun(input).action;\nconsole.log(action);\n");
    run('node', [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--skipLibCheck', 'false', 'check.mts'], { cwd: consumer });
  });

  // The bundled simulator is served from the installed package.
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, [entry, 'demo', '--serve', '--port', '0']);
    child.on('error', fail);
    child.stderr.on('data', (d) => fail(new Error(String(d))));
    child.stdout.on('data', async (chunk) => {
      const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(String(chunk))?.[0];
      if (!url) return;
      try {
        const html = await (await fetch(url)).text();
        const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
        assert(asset, 'index.html has no relative script');
        assert((await fetch(new URL(asset, url))).status === 200, 'script did not load');
        results.push('ok  demo --serve serves the bundled simulator and its assets');
        done();
      } catch (error) {
        fail(error);
      } finally {
        child.kill();
      }
    });
  });
  console.log(results.join('\n'));
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
