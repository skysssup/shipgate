import { setupHooks } from '../hooks.js';
import { detail } from '../report.js';
import type { CommandResult } from './on-off.js';

export function runSetup(): CommandResult {
  const result = setupHooks();
  const failed = result.claude === 'skipped' || result.claude === 'unwritable' || result.cursor === 'skipped' || result.cursor === 'unwritable';
  return {
    exitCode: failed ? 1 : 0,
    lines: [
      `shipgate: ${failed ? 'hook setup incomplete' : 'hooks ready'} (Claude Code: ${result.claude}, Cursor: ${result.cursor})`,
      ...result.notes.map((note) => detail('note', note)),
      detail('scope', 'The hooks run after every agent turn in every repository, but act only where shipgate on was run.'),
    ],
  };
}
