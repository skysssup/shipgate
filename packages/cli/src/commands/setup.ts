import { setupHooks } from '../hooks.js';

export function runSetup(): number {
  const result = setupHooks();
  for (const n of result.notes) {
    process.stderr.write(`shipgate: ${n}\n`);
  }
  process.stderr.write(
    `shipgate: setup done (claude=${result.claude}, cursor=${result.cursor})\n`,
  );
  process.stderr.write(
    'shipgate: hooks are idempotent — re-run setup anytime; unrelated hooks are preserved\n',
  );
  return 0;
}
