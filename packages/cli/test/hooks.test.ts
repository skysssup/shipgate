import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setupHooks } from '../src/hooks.js';

const dirs: string[] = [];

afterEach(() => {
  delete process.env.SHIPGATE_CLAUDE_SETTINGS;
  delete process.env.SHIPGATE_CURSOR_HOOKS;
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('setupHooks', () => {
  it('writes hooks idempotently without destroying unrelated cursor hooks', () => {
    const home = mkdtempSync(join(tmpdir(), 'shipgate-hooks-'));
    dirs.push(home);
    const claudeSettings = join(home, '.claude', 'settings.json');
    const cursorHooks = join(home, '.cursor', 'hooks.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(
      cursorHooks,
      JSON.stringify({
        version: 1,
        hooks: { stop: [{ command: 'echo keep-me', description: 'other' }] },
      }),
    );
    process.env.SHIPGATE_CLAUDE_SETTINGS = claudeSettings;
    process.env.SHIPGATE_CURSOR_HOOKS = cursorHooks;

    const first = setupHooks();
    expect(['written', 'merged']).toContain(first.cursor);
    const second = setupHooks();
    expect(['merged', 'skipped']).toContain(second.cursor);

    const parsed = JSON.parse(readFileSync(cursorHooks, 'utf8')) as {
      hooks: { stop: unknown[] };
    };
    expect(parsed.hooks.stop.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(parsed.hooks.stop)).toContain('keep-me');
    expect(JSON.stringify(parsed.hooks.stop)).toContain('shipgate');
  });
});

  it('refuses to overwrite unmarked Claude companion script (backs up)', () => {
    const home = mkdtempSync(join(tmpdir(), 'shipgate-hooks-'));
    dirs.push(home);
    const claudeDir = join(home, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const snippet = join(claudeDir, 'shipgate-stop.sh');
    writeFileSync(snippet, '#!/bin/sh\necho custom\n');
    const claudeSettings = join(claudeDir, 'settings.json');
    const cursorHooks = join(home, '.cursor', 'hooks.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    process.env.SHIPGATE_CLAUDE_SETTINGS = claudeSettings;
    process.env.SHIPGATE_CURSOR_HOOKS = cursorHooks;

    const result = setupHooks();
    expect(result.claude).toBe('skipped');
    expect(readFileSync(snippet, 'utf8')).toContain('echo custom');
    expect(readFileSync(snippet + '.bak', 'utf8')).toContain('echo custom');
  });

