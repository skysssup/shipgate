import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MARKER_BEGIN = '# >>> shipgate >>>';
const MARKER_END = '# <<< shipgate <<<';

const CLAUDE_SNIPPET = `${MARKER_BEGIN}
# Shipgate Stop hook — runs after each Claude Code turn
# Idempotent block managed by \`shipgate setup\`
if command -v shipgate >/dev/null 2>&1; then
  shipgate ship >/dev/null
fi
${MARKER_END}
`;

const CURSOR_HOOK_JSON = {
  version: 1,
  hooks: {
    stop: [
      {
        command: 'shipgate ship',
        description: 'Shipgate: stage → scan → commit → push',
      },
    ],
  },
};

export interface HookSetupResult {
  claude: 'written' | 'merged' | 'skipped' | 'unwritable';
  cursor: 'written' | 'merged' | 'skipped' | 'unwritable';
  paths: { claude?: string; cursor?: string };
  notes: string[];
}

function claudeSettingsPath(): string {
  return (
    process.env.SHIPGATE_CLAUDE_SETTINGS ||
    join(homedir(), '.claude', 'settings.json')
  );
}

function cursorHooksPath(): string {
  return (
    process.env.SHIPGATE_CURSOR_HOOKS ||
    join(homedir(), '.cursor', 'hooks.json')
  );
}

/** Idempotent Claude stop-hook install via a companion shell snippet file. */
function setupClaude(notes: string[]): HookSetupResult['claude'] {
  const settingsPath = claudeSettingsPath();
  const snippetPath = join(dirname(settingsPath), 'shipgate-stop.sh');
  try {
    mkdirSync(dirname(snippetPath), { recursive: true });
    if (existsSync(snippetPath)) {
      const existing = readFileSync(snippetPath, 'utf8');
      if (existing.includes(MARKER_BEGIN) && existing.includes(MARKER_END)) {
        // Refresh body between markers only
        const next = replaceMarkedBlock(existing, CLAUDE_SNIPPET);
        writeFileSync(snippetPath, next, 'utf8');
        notes.push(`Claude hook snippet refreshed: ${snippetPath}`);
        ensureClaudeSettingsRef(settingsPath, snippetPath, notes);
        return 'merged';
      }
      // Unmarked companion file — refuse to overwrite; keep a backup note.
      const bak = snippetPath + '.bak';
      writeFileSync(bak, existing, 'utf8');
      notes.push(
        `Claude hook conflict: ${snippetPath} exists without shipgate markers — left untouched, backup at ${bak}`,
      );
      return 'skipped';
    }
    writeFileSync(snippetPath, CLAUDE_SNIPPET, 'utf8');
    notes.push(`Claude hook snippet written: ${snippetPath}`);
    ensureClaudeSettingsRef(settingsPath, snippetPath, notes);
    return 'written';
  } catch (err) {
    notes.push(`Claude hooks unwritable: ${(err as Error).message}`);
    return 'unwritable';
  }
}

function ensureClaudeSettingsRef(
  settingsPath: string,
  snippetPath: string,
  notes: string[],
): void {
  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        notes.push(
          `Claude settings.json present but invalid JSON — left untouched; source ${snippetPath} from your Stop hook manually`,
        );
        return;
      }
    }
    const hooks = (settings.hooks as Record<string, unknown>) || {};
    const stop = Array.isArray(hooks.Stop) ? [...hooks.Stop] : [];
    const entry = {
      hooks: [{ type: 'command', command: `bash "${snippetPath}"` }],
    };
    const already = stop.some(
      (s) => JSON.stringify(s).includes('shipgate-stop.sh'),
    );
    if (!already) {
      stop.push(entry);
      hooks.Stop = stop;
      settings.hooks = hooks;
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      notes.push(`Claude settings updated: ${settingsPath}`);
    } else {
      notes.push(`Claude settings already reference shipgate: ${settingsPath}`);
    }
  } catch (err) {
    notes.push(`Could not update Claude settings: ${(err as Error).message}`);
  }
}

function setupCursor(notes: string[]): HookSetupResult['cursor'] {
  const path = cursorHooksPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      let existing: Record<string, unknown>;
      try {
        existing = JSON.parse(readFileSync(path, 'utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        notes.push(
          `Cursor hooks.json invalid JSON — left untouched at ${path}`,
        );
        return 'skipped';
      }
      const hooks = (existing.hooks as Record<string, unknown>) || {};
      const stop = Array.isArray(hooks.stop) ? [...(hooks.stop as unknown[])] : [];
      const already = stop.some(
        (s) =>
          typeof s === 'object' &&
          s !== null &&
          JSON.stringify(s).includes('shipgate'),
      );
      if (!already) {
        stop.push(...CURSOR_HOOK_JSON.hooks.stop);
        hooks.stop = stop;
        existing.hooks = hooks;
        if (!existing.version) existing.version = 1;
        writeFileSync(path, JSON.stringify(existing, null, 2) + '\n', 'utf8');
        notes.push(`Cursor hooks merged: ${path}`);
        return 'merged';
      }
      notes.push(`Cursor hooks already include shipgate: ${path}`);
      return 'skipped';
    }
    writeFileSync(path, JSON.stringify(CURSOR_HOOK_JSON, null, 2) + '\n', 'utf8');
    notes.push(`Cursor hooks written: ${path}`);
    return 'written';
  } catch (err) {
    notes.push(`Cursor hooks unwritable: ${(err as Error).message}`);
    return 'unwritable';
  }
}

function replaceMarkedBlock(source: string, block: string): string {
  const start = source.indexOf(MARKER_BEGIN);
  const end = source.indexOf(MARKER_END);
  if (start === -1 || end === -1 || end < start) return block;
  return (
    source.slice(0, start) +
    block.trimEnd() +
    '\n' +
    source.slice(end + MARKER_END.length).replace(/^\n/, '')
  );
}

/** Install / merge agent hook snippets without destroying unrelated hooks. */
export function setupHooks(): HookSetupResult {
  const notes: string[] = [];
  const claude = setupClaude(notes);
  const cursor = setupCursor(notes);
  return {
    claude,
    cursor,
    paths: {
      claude: join(dirname(claudeSettingsPath()), 'shipgate-stop.sh'),
      cursor: cursorHooksPath(),
    },
    notes,
  };
}

export function hookStatus(): {
  claude: boolean;
  cursor: boolean;
  paths: { claude: string; cursor: string };
} {
  const claudePath = join(dirname(claudeSettingsPath()), 'shipgate-stop.sh');
  const cursorPath = cursorHooksPath();
  return {
    claude: existsSync(claudePath),
    cursor:
      existsSync(cursorPath) &&
      readFileSync(cursorPath, 'utf8').includes('shipgate'),
    paths: { claude: claudePath, cursor: cursorPath },
  };
}
