export interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--version' || a === '-v') {
      flags.version = true;
      continue;
    }
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
          flags[body] = next;
          i += 1;
        } else {
          flags[body] = true;
        }
      }
      continue;
    }
    if (a.startsWith('-') && a.length === 2) {
      const key = a.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positionals.push(a);
  }

  const command =
    flags.version ? '--version' : positionals[0] || (flags.help ? 'help' : 'help');

  return {
    command,
    flags,
    positionals: positionals.slice(command === positionals[0] ? 1 : 0),
  };
}

export function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new Error(`--${name} requires a value`);
  return v;
}

export function flagBool(flags: Record<string, string | boolean>, name: string): boolean {
  const value = flags[name];
  if (value === undefined || value === false || value === 'false' || value === '0') return false;
  if (value === true || value === 'true' || value === '1') return true;
  throw new Error(`--${name} expects true or false`);
}
