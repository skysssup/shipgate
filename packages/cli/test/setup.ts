import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate every test worker from the developer's Git config, Shipgate home, agent
// settings, and review key, so tests behave the same on any machine.
const sandbox = mkdtempSync(join(tmpdir(), 'shipgate-test-env-'));
const gitconfig = join(sandbox, 'gitconfig');
writeFileSync(gitconfig, '[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n');
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.SHIPGATE_HOME = join(sandbox, 'shipgate-home');
process.env.SHIPGATE_CLAUDE_SETTINGS = join(sandbox, 'claude', 'settings.json');
process.env.SHIPGATE_CURSOR_HOOKS = join(sandbox, 'cursor', 'hooks.json');
delete process.env.OPENROUTER_API_KEY;
delete process.env.CURSOR_VERSION;
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.CURSOR_PROJECT_DIR;
