import { readFileSync } from 'node:fs';

/** Version from this package's package.json (one directory above dist/). */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;
