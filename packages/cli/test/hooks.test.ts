import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeSnippetPath, CURSOR_HOOK_COMMAND, hookStatus, setupHooks } from '../src/hooks.js';
import { BIN, cli, repo, SYNTHETIC, tempDir } from './helpers.js';

const isWindows = process.platform === 'win32';
let home: string;
let claudeSettings: string;
let cursorHooks: string;
const saved = { claude: process.env.SHIPGATE_CLAUDE_SETTINGS, cursor: process.env.SHIPGATE_CURSOR_HOOKS };

beforeEach(() => {
  home = tempDir('shipgate home with spaces ');
  claudeSettings = join(home, '.claude', 'settings.json');
  cursorHooks = join(home, '.cursor', 'hooks.json');
  process.env.SHIPGATE_CLAUDE_SETTINGS = claudeSettings;
  process.env.SHIPGATE_CURSOR_HOOKS = cursorHooks;
});
afterEach(() => {
  process.env.SHIPGATE_CLAUDE_SETTINGS = saved.claude;
  process.env.SHIPGATE_CURSOR_HOOKS = saved.cursor;
});

function json(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

describe('shipgate setup', () => {
  it('installs both hooks into empty homes, including paths with spaces', () => {
    const result = setupHooks();
    expect(result).toMatchObject({ claude: 'written', cursor: 'written' });
    const snippet = claudeSnippetPath();
    expect(json(claudeSettings).hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: `bash "${snippet.replace(/\\/g, '/')}"` }] }]);
    expect(readFileSync(snippet, 'utf8')).toContain('exec shipgate ship --hook claude');
    expect(json(cursorHooks)).toEqual({ version: 1, hooks: { stop: [{ command: CURSOR_HOOK_COMMAND }] } });
    expect(hookStatus()).toMatchObject({ claude: true, cursor: true });
  });

  it('is idempotent and preserves unrelated settings and hooks', () => {
    writeJson(claudeSettings, { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [] }] } });
    writeJson(cursorHooks, { version: 1, hooks: { stop: [{ command: 'echo keep-me' }], afterFileEdit: [{ command: './format.sh' }] } });

    expect(setupHooks()).toMatchObject({ claude: 'merged', cursor: 'merged' });
    const claudeAfterFirst = readFileSync(claudeSettings, 'utf8');
    const cursorAfterFirst = readFileSync(cursorHooks, 'utf8');
    expect(setupHooks()).toMatchObject({ claude: 'unchanged', cursor: 'unchanged' });
    expect(readFileSync(claudeSettings, 'utf8')).toBe(claudeAfterFirst);
    expect(readFileSync(cursorHooks, 'utf8')).toBe(cursorAfterFirst);

    const claude = json(claudeSettings);
    expect(claude.model).toBe('opus');
    expect(claude.hooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [] }]);
    expect(claude.hooks.Stop).toHaveLength(2);
    expect(claude.hooks.Stop[0]).toEqual({ hooks: [{ type: 'command', command: 'say done' }] });
    const cursor = json(cursorHooks);
    expect(cursor.hooks.stop).toEqual([{ command: 'echo keep-me' }, { command: CURSOR_HOOK_COMMAND }]);
    expect(cursor.hooks.afterFileEdit).toEqual([{ command: './format.sh' }]);
  });

  it('upgrades hooks installed by Shipgate 1.x in place', () => {
    const snippet = claudeSnippetPath();
    writeJson(claudeSettings, { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash "${snippet}"` }] }] } });
    writeFileSync(snippet, '#!/bin/sh\n# user line\n# >>> shipgate >>>\nshipgate ship >/dev/null\n# <<< shipgate <<<\n# trailing user line\n');
    writeJson(cursorHooks, { version: 1, hooks: { stop: [{ command: 'shipgate ship', description: 'Shipgate: stage → scan → commit → push' }] } });

    expect(setupHooks()).toMatchObject({ claude: 'updated', cursor: 'updated' });
    const text = readFileSync(snippet, 'utf8');
    expect(text).toContain('# user line');
    expect(text).toContain('# trailing user line');
    expect(text).toContain('exec shipgate ship --hook claude');
    expect(text).not.toContain('shipgate ship >/dev/null');
    expect(json(claudeSettings).hooks.Stop).toHaveLength(1);
    expect(json(cursorHooks).hooks.stop).toEqual([{ command: CURSOR_HOOK_COMMAND }]);
  });

  it.each([
    ['invalid JSON', '{ "hooks": ', /not valid JSON/],
    ['a top-level array', '[]', /does not contain a JSON object/],
    ['hooks as an array', '{"hooks": []}', /"hooks" is not an object/],
    ['Stop as an object', '{"hooks": {"Stop": {}}}', /"hooks.Stop" is not an array/],
  ])('leaves Claude settings with %s untouched and fails', (_name, content, note) => {
    writeJson(claudeSettings, content);
    const result = setupHooks();
    expect(result.claude).toBe('skipped');
    expect(result.notes.join('\n')).toMatch(note);
    expect(readFileSync(claudeSettings, 'utf8')).toBe(content);
    expect(existsSync(claudeSnippetPath())).toBe(false);
    expect(cli(home, ['setup']).status).toBe(1);
  });

  it('leaves a malformed Cursor hooks file untouched', () => {
    writeJson(cursorHooks, '{"version":1,"hooks":{"stop":"shipgate ship"}}');
    const result = setupHooks();
    expect(result.cursor).toBe('skipped');
    expect(readFileSync(cursorHooks, 'utf8')).toBe('{"version":1,"hooks":{"stop":"shipgate ship"}}');
  });

  it('refuses to replace an unrelated script at the snippet path, without leaving backups', () => {
    const snippet = claudeSnippetPath();
    mkdirSync(join(snippet, '..'), { recursive: true });
    writeFileSync(snippet, '#!/bin/sh\necho custom\n');
    const result = setupHooks();
    expect(result.claude).toBe('skipped');
    expect(readFileSync(snippet, 'utf8')).toBe('#!/bin/sh\necho custom\n');
    expect(existsSync(`${snippet}.bak`)).toBe(false);
    expect(hookStatus().claude).toBe(false);
  });
});

describe('ship --hook', () => {
  it('ships the Claude session directory from stdin and reports through systemMessage', () => {
    const r = repo();
    r.write('a.txt', 'agent change\n');
    const run = cli(tempDir(), ['ship', '--hook', 'claude'], { input: JSON.stringify({ hook_event_name: 'Stop', cwd: r.dir }) });
    expect(run.status).toBe(0);
    const message = JSON.parse(run.stdout).systemMessage as string;
    expect(message).toMatch(/^shipgate: COMMITTED — Committed [0-9a-f]+ on main/);
    expect(r.git('log', '-1', '--format=%B')).toContain('Shipped-by: shipgate');
  });

  it('stays silent where Shipgate is not enabled or there is nothing to ship', () => {
    const disabled = repo(null);
    disabled.write('a.txt', 'x\n');
    const clean = repo();
    for (const dir of [disabled.dir, clean.dir, tempDir()]) {
      const run = cli(dir, ['ship', '--hook', 'claude'], { input: JSON.stringify({ cwd: dir }) });
      expect(run).toEqual({ status: 0, stdout: '', stderr: '' });
    }
    expect(disabled.git('status', '--porcelain')).toBe('?? a.txt');
  });

  it('shows a block to the user without blocking the agent', () => {
    const r = repo();
    r.write('.env', `TOKEN=${SYNTHETIC.github}\n`);
    const run = cli(r.dir, ['ship', '--hook', 'claude'], { input: '{}' });
    expect(run.status).toBe(0);
    const message = JSON.parse(run.stdout).systemMessage as string;
    expect(message).toContain('BLOCKED');
    expect(message).not.toContain(SYNTHETIC.github);
  });

  it('ships every Cursor workspace root from its user-hook directory', () => {
    const a = repo();
    const b = repo();
    a.write('a.txt', 'a\n');
    b.write('b.txt', 'b\n');
    const run = cli(join(home), ['ship', '--hook', 'cursor'], { input: JSON.stringify({ hook_event_name: 'stop', workspace_roots: [a.dir, b.dir, a.dir] }) });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('{}');
    expect(run.stderr.match(/COMMITTED/g)).toHaveLength(2);
    expect(a.git('log', '-1', '--format=%s')).toBe('update a.txt');
    expect(b.git('log', '-1', '--format=%s')).toBe('update b.txt');
  });

  it('falls back to CURSOR_PROJECT_DIR when the payload has no roots', () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    const run = cli(home, ['ship', '--hook', 'cursor'], { input: '{}', env: { CURSOR_PROJECT_DIR: r.dir } });
    expect(run.status).toBe(0);
    expect(r.git('status', '--porcelain')).toBe('');
  });

  it('lets the Cursor hook ship when Cursor also runs the Claude hook', () => {
    setupHooks();
    const r = repo();
    r.write('a.txt', 'a\n');
    const run = cli(r.dir, ['ship', '--hook', 'claude'], { input: JSON.stringify({ cwd: r.dir }), env: { CURSOR_VERSION: '2.0.0' } });
    expect(run).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(r.git('status', '--porcelain')).toBe('?? a.txt');
  });

  it('rejects unknown agents and --json in hook mode', () => {
    expect(cli(home, ['ship', '--hook', 'vscode']).stderr).toMatch(/--hook expects claude or cursor/);
    expect(cli(home, ['ship', '--hook', 'claude', '--json']).stderr).toMatch(/cannot be combined/);
  });

  it('runs the installed Claude snippet with bash, with and without shipgate on PATH', () => {
    if (isWindows) return;
    setupHooks();
    const bin = tempDir('shipgate-bin-');
    const shim = join(bin, 'shipgate');
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`);
    chmodSync(shim, 0o755);
    const r = repo();
    r.write('a.txt', 'a\n');
    const run = (path: string) => spawnSync('bash', [claudeSnippetPath()], {
      cwd: r.dir,
      input: JSON.stringify({ cwd: r.dir }),
      encoding: 'utf8',
      env: { ...process.env, PATH: path },
    });
    const missing = run(['/usr/bin', '/bin'].join(delimiter));
    expect(missing.status).toBe(0);
    expect(JSON.parse(missing.stdout).systemMessage).toMatch(/shipgate is not on PATH/);
    const shipped = run([bin, '/usr/bin', '/bin'].join(delimiter));
    expect(shipped.status).toBe(0);
    expect(JSON.parse(shipped.stdout).systemMessage).toMatch(/COMMITTED/);
  });
});
