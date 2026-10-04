#!/usr/bin/env node
// Package the built workspaces into release/:
//   shipgate-cli-<version>.tgz        CLI with @shipgate/core and the simulator bundled
//   shipgate-core-<version>.tgz       policy, scanner, and fixtures library
//   shipgate-simulator-<version>.tar.gz   static simulator build
//   SHA256SUMS
// Run `npm run build` first.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'release');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const { version } = readJson(join(root, 'package.json'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const required of ['packages/core/dist/index.js', 'packages/cli/dist/bin.js', 'apps/web/dist/index.html']) {
  if (!existsSync(join(root, required))) throw new Error(`${required} is missing; run npm run build first`);
}
for (const pkg of ['packages/core', 'packages/cli', 'apps/web']) {
  const v = readJson(join(root, pkg, 'package.json')).version;
  if (v !== version) throw new Error(`${pkg} is version ${v}, but the root is ${version}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

function pack(dir) {
  const [info] = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', out], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' }));
  return join(out, info.filename);
}

// Stage outside the monorepo so npm does not treat the packages as workspace members.
const work = mkdtempSync(join(tmpdir(), 'shipgate-pack-'));
const coreStage = join(work, 'core-src');
mkdirSync(coreStage);
for (const name of ['dist', 'README.md']) cpSync(join(root, 'packages/core', name), join(coreStage, name), { recursive: true });
cpSync(join(root, 'LICENSE'), join(coreStage, 'LICENSE'));
const { devDependencies: _coreDev, scripts: _coreScripts, ...corePkg } = readJson(join(root, 'packages/core/package.json'));
writeFileSync(join(coreStage, 'package.json'), `${JSON.stringify(corePkg, null, 2)}\n`);
const coreName = `shipgate-core-${version}.tgz`;
renameSync(pack(coreStage), join(out, coreName));

const stage = join(work, 'cli');
mkdirSync(stage);
const cliPkg = readJson(join(root, 'packages/cli/package.json'));
cpSync(join(root, 'packages/cli/dist'), join(stage, 'dist'), { recursive: true });
cpSync(join(root, 'apps/web/dist'), join(stage, 'web'), { recursive: true });
cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
cpSync(join(root, 'README.md'), join(stage, 'README.md'));
const unpacked = join(work, 'core');
mkdirSync(unpacked);
execFileSync('tar', ['-xzf', join(out, coreName), '-C', unpacked]);
mkdirSync(join(stage, 'node_modules', '@shipgate'), { recursive: true });
renameSync(join(unpacked, 'package'), join(stage, 'node_modules', '@shipgate', 'core'));
const { devDependencies: _dev, scripts: _scripts, ...publishable } = cliPkg;
writeFileSync(join(stage, 'package.json'), `${JSON.stringify({ ...publishable, bundleDependencies: ['@shipgate/core'] }, null, 2)}\n`);
const cliTarball = pack(stage);
renameSync(cliTarball, join(out, `shipgate-cli-${version}.tgz`));

const simulator = `shipgate-simulator-${version}.tar.gz`;
execFileSync('tar', ['-czf', join(out, simulator), '-C', join(root, 'apps/web/dist'), '.']);

rmSync(work, { recursive: true, force: true });
const assets = readdirSync(out).sort();
const sums = assets.map((name) => `${createHash('sha256').update(readFileSync(join(out, name))).digest('hex')}  ${name}`);
writeFileSync(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(sums.join('\n'));
