import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MARKER_BEGIN = '# >>> shipgate >>>';
const MARKER_END = '# <<< shipgate <<<';
const SNIPPET_NAME = 'shipgate-stop.sh';
const CLAUDE_HOOK_COMMAND = 'shipgate ship --hook claude';
export const CURSOR_HOOK_COMMAND = 'shipgate ship --hook cursor';

const CLAUDE_SNIPPET = `${MARKER_BEGIN}
# Claude Code Stop hook managed by \`shipgate setup\`. Runs after each turn.
# Shipgate acts only in repositories enabled with \`shipgate on\`.
if command -v shipgate >/dev/null 2>&1; then
  exec ${CLAUDE_HOOK_COMMAND}
fi
printf '%s\\n' '{"systemMessage":"Shipgate Stop hook: shipgate is not on PATH, so nothing was shipped."}'
${MARKER_END}
`;

export type HookSetupOutcome = 'written' | 'merged' | 'updated' | 'unchanged' | 'skipped' | 'unwritable';

export interface HookSetupResult {
  claude: HookSetupOutcome;
  cursor: HookSetupOutcome;
  notes: string[];
}

function claudeSettingsPath(): string {
  return process.env.SHIPGATE_CLAUDE_SETTINGS || join(homedir(), '.claude', 'settings.json');
}

export function claudeSnippetPath(): string {
  return join(dirname(claudeSettingsPath()), SNIPPET_NAME);
}

function cursorHooksPath(): string {
  return process.env.SHIPGATE_CURSOR_HOOKS || join(homedir(), '.cursor', 'hooks.json');
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Parse a JSON settings file. Returns an error string for unreadable or malformed files. */
function readJsonObject(path: string): { value: JsonObject; existed: boolean } | { error: string } {
  if (!existsSync(path)) return { value: {}, existed: false };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { error: `${path} could not be read (${(error as Error).message})` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: `${path} is not valid JSON (${(error as Error).message})` };
  }
  return isObject(parsed) ? { value: parsed, existed: true } : { error: `${path} does not contain a JSON object` };
}

/** Return the event array inside `hooks`, creating containers only when they are absent. */
function hookArray(settings: JsonObject, event: string, path: string): unknown[] | string {
  if (settings.hooks === undefined) settings.hooks = {};
  if (!isObject(settings.hooks)) return `${path}: "hooks" is not an object`;
  const hooks = settings.hooks;
  if (hooks[event] === undefined) hooks[event] = [];
  if (!Array.isArray(hooks[event])) return `${path}: "hooks.${event}" is not an array`;
  return hooks[event] as unknown[];
}

function replaceMarkedBlock(source: string): string {
  const start = source.indexOf(MARKER_BEGIN);
  const end = source.indexOf(MARKER_END);
  return source.slice(0, start) + CLAUDE_SNIPPET + source.slice(end + MARKER_END.length).replace(/^\n/, '');
}

function setupClaude(notes: string[]): HookSetupOutcome {
  const settingsPath = claudeSettingsPath();
  const snippetPath = claudeSnippetPath();
  try {
    const settings = readJsonObject(settingsPath);
    if ('error' in settings) {
      notes.push(`Claude Code: left unchanged because ${settings.error}. Fix the file and run shipgate setup again.`);
      return 'skipped';
    }
    const stop = hookArray(settings.value, 'Stop', settingsPath);
    if (typeof stop === 'string') {
      notes.push(`Claude Code: left unchanged because ${stop}.`);
      return 'skipped';
    }
    let snippetChanged = false;
    if (existsSync(snippetPath)) {
      const existing = readFileSync(snippetPath, 'utf8');
      const start = existing.indexOf(MARKER_BEGIN);
      const end = existing.indexOf(MARKER_END);
      if (start === -1 || end < start) {
        notes.push(`Claude Code: ${snippetPath} exists without Shipgate markers; left it unchanged. Rename it and run shipgate setup again.`);
        return 'skipped';
      }
      const next = replaceMarkedBlock(existing);
      if (next !== existing) {
        writeFileSync(snippetPath, next, 'utf8');
        snippetChanged = true;
      }
    } else {
      mkdirSync(dirname(snippetPath), { recursive: true });
      writeFileSync(snippetPath, CLAUDE_SNIPPET, 'utf8');
      snippetChanged = true;
    }

    const referenced = stop.some((group) => JSON.stringify(group).includes(SNIPPET_NAME));
    if (referenced) {
      notes.push(`Claude Code: ${snippetChanged ? 'refreshed' : 'already up to date'} (${snippetPath}).`);
      return snippetChanged ? 'updated' : 'unchanged';
    }
    stop.push({ hooks: [{ type: 'command', command: `bash "${snippetPath.replace(/\\/g, '/')}"` }] });
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings.value, null, 2)}\n`, 'utf8');
    notes.push(`Claude Code: added a Stop hook to ${settingsPath}.`);
    return settings.existed ? 'merged' : 'written';
  } catch (error) {
    notes.push(`Claude Code: could not write hook files (${(error as Error).message}).`);
    return 'unwritable';
  }
}

function isShipgateCommand(entry: unknown): entry is JsonObject & { command: string } {
  return isObject(entry) && typeof entry.command === 'string' && /^\s*shipgate\s+ship\b/.test(entry.command);
}

function setupCursor(notes: string[]): HookSetupOutcome {
  const path = cursorHooksPath();
  try {
    const file = readJsonObject(path);
    if ('error' in file) {
      notes.push(`Cursor: left unchanged because ${file.error}. Fix the file and run shipgate setup again.`);
      return 'skipped';
    }
    if (file.value.version === undefined) file.value.version = 1;
    const stop = hookArray(file.value, 'stop', path);
    if (typeof stop === 'string') {
      notes.push(`Cursor: left unchanged because ${stop}.`);
      return 'skipped';
    }
    const ours = stop.filter(isShipgateCommand);
    if (ours.some((entry) => entry.command.trim() === CURSOR_HOOK_COMMAND)) {
      notes.push(`Cursor: already up to date (${path}).`);
      return 'unchanged';
    }
    if (ours.length) {
      for (const entry of ours) {
        entry.command = CURSOR_HOOK_COMMAND;
        if (typeof entry.description === 'string' && entry.description.startsWith('Shipgate:')) delete entry.description;
      }
    } else {
      stop.push({ command: CURSOR_HOOK_COMMAND });
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(file.value, null, 2)}\n`, 'utf8');
    notes.push(ours.length ? `Cursor: updated the Shipgate stop hook in ${path}.` : `Cursor: added a stop hook to ${path}.`);
    return ours.length ? 'updated' : file.existed ? 'merged' : 'written';
  } catch (error) {
    notes.push(`Cursor: could not write ${path} (${(error as Error).message}).`);
    return 'unwritable';
  }
}

/** Install or refresh the agent stop hooks without removing unrelated hooks. */
export function setupHooks(): HookSetupResult {
  const notes: string[] = [];
  const claude = setupClaude(notes);
  const cursor = setupCursor(notes);
  return { claude, cursor, notes };
}

export interface HookStatus {
  claude: boolean;
  cursor: boolean;
  paths: { claude: string; cursor: string };
}

/** Installed means the agent configuration references Shipgate and the referenced script exists. */
export function hookStatus(): HookStatus {
  const settings = readJsonObject(claudeSettingsPath());
  const snippet = claudeSnippetPath();
  const claudeStop = 'error' in settings ? null : (settings.value.hooks as JsonObject | undefined)?.Stop;
  const claude = Array.isArray(claudeStop)
    && claudeStop.some((group) => JSON.stringify(group).includes(SNIPPET_NAME))
    && existsSync(snippet)
    && readFileSync(snippet, 'utf8').includes(MARKER_BEGIN);
  const cursorFile = readJsonObject(cursorHooksPath());
  const cursorStop = 'error' in cursorFile ? null : (cursorFile.value.hooks as JsonObject | undefined)?.stop;
  const cursor = Array.isArray(cursorStop) && cursorStop.some(isShipgateCommand);
  return { claude, cursor, paths: { claude: claudeSettingsPath(), cursor: cursorHooksPath() } };
}
