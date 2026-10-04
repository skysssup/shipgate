type FlagKind = 'boolean' | 'string';

interface CommandSpec {
  flags: Record<string, FlagKind>;
  /** Single-letter aliases, e.g. { m: 'message' }. */
  short?: Record<string, string>;
}

const COMMANDS: Record<string, CommandSpec> = {
  setup: { flags: {} },
  on: { flags: { level: 'string', agent: 'boolean', 'public-ok': 'boolean', account: 'string', model: 'string', key: 'string' } },
  off: { flags: {} },
  ship: {
    flags: { message: 'string', prompt: 'string', 'force-secrets': 'boolean', 'public-ok': 'boolean', confirm: 'boolean', json: 'boolean', hook: 'string' },
    short: { m: 'message' },
  },
  undo: { flags: { json: 'boolean' } },
  status: { flags: { json: 'boolean' } },
  demo: { flags: { serve: 'boolean', port: 'string', json: 'boolean' } },
  help: { flags: {} },
};

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

const BOOLEAN_VALUES: Record<string, boolean> = { true: true, false: false, '1': true, '0': false };

function closest(input: string, options: string[]): string | undefined {
  const distance = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[b.length];
  };
  return options.map((o) => ({ o, d: distance(input, o) })).filter((x) => x.d <= 2).sort((a, b) => a.d - b.d)[0]?.o;
}

/**
 * Parse `shipgate <command> [flags]`. The command comes first. Flags that take a value
 * consume the next argument even when it starts with "-". Boolean flags accept
 * `--flag`, `--flag=true|false|1|0`, or `--flag true|false|1|0`. `--help`/`-h` and
 * `--version`/`-v` work anywhere. Unknown commands, flags, and extra arguments are errors.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  let command: string | undefined;
  let spec: CommandSpec | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { command: 'help', flags: {} };
    if (arg === '--version' || arg === '-v') return { command: 'version', flags: {} };
    if (!command) {
      if (arg.startsWith('-')) throw new UsageError(`expected a command before ${arg} (see shipgate --help)`);
      if (!COMMANDS[arg]) {
        const suggestion = closest(arg, Object.keys(COMMANDS));
        throw new UsageError(`unknown command '${arg}'${suggestion ? `; did you mean '${suggestion}'?` : ''}`);
      }
      command = arg;
      spec = COMMANDS[arg];
      continue;
    }

    let name: string;
    let inline: string | undefined;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      inline = eq === -1 ? undefined : arg.slice(eq + 1);
    } else if (/^-[A-Za-z]$/.test(arg)) {
      const long = spec!.short?.[arg.slice(1)];
      if (!long) throw new UsageError(`unknown option ${arg} for '${command}'`);
      name = long;
    } else {
      throw new UsageError(`unexpected argument '${arg}' for '${command}'`);
    }

    const kind = spec!.flags[name];
    if (!kind) {
      const suggestion = closest(name, Object.keys(spec!.flags));
      const valid = Object.keys(spec!.flags).length ? '' : ` ('${command}' takes no options)`;
      throw new UsageError(`unknown option --${name} for '${command}'${suggestion ? `; did you mean --${suggestion}?` : valid}`);
    }
    if (kind === 'boolean') {
      if (inline !== undefined) {
        if (!(inline in BOOLEAN_VALUES)) throw new UsageError(`--${name} expects true or false, not '${inline}'`);
        flags[name] = BOOLEAN_VALUES[inline];
      } else if (args[i + 1] !== undefined && args[i + 1] in BOOLEAN_VALUES) {
        flags[name] = BOOLEAN_VALUES[args[i + 1]];
        i += 1;
      } else {
        flags[name] = true;
      }
    } else {
      const value = inline ?? args[i + 1];
      if (value === undefined || value === '') throw new UsageError(`--${name} requires a value`);
      if (inline === undefined) i += 1;
      flags[name] = value;
    }
  }
  return { command: command ?? 'help', flags };
}

export function flagString(flags: ParsedArgs['flags'], name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

/** Undefined when the flag was not given, so callers can tell "false" from "absent". */
export function flagBool(flags: ParsedArgs['flags'], name: string): boolean | undefined {
  const value = flags[name];
  return typeof value === 'boolean' ? value : undefined;
}
