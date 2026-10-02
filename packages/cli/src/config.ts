import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_LEVEL,
  parseLevel,
  type SafetyLevel,
  type ShipgateConfig,
} from '@shipgate/core';

export const CONFIG_FILENAME = '.shipgate.json';

const GH_ACCOUNT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function configPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_FILENAME);
}

export function readRepoConfig(repoRoot: string): ShipgateConfig | null {
  const path = configPath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ShipgateConfig>;
    let level: SafetyLevel = DEFAULT_LEVEL;
    try {
      level = parseLevel(raw.level as string | undefined);
    } catch {
      level = DEFAULT_LEVEL;
    }
    return {
      enabled: raw.enabled !== false,
      level,
      agentReview: Boolean(raw.agentReview),
      publicOk: Boolean(raw.publicOk),
      account: raw.account,
      model: raw.model,
    };
  } catch {
    return null;
  }
}

export function writeRepoConfig(repoRoot: string, cfg: ShipgateConfig): void {
  writeFileSync(configPath(repoRoot), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

export function removeRepoConfig(repoRoot: string): void {
  const path = configPath(repoRoot);
  if (existsSync(path)) {
    writeFileSync(
      path,
      JSON.stringify({ enabled: false, level: DEFAULT_LEVEL }, null, 2) + '\n',
    );
  }
}

export interface GlobalConfig {
  openRouterApiKey?: string;
  model?: string;
  baseUrl?: string;
}

export function shipgateHome(): string {
  return process.env.SHIPGATE_HOME || join(homedir(), '.shipgate');
}

export function readGlobalConfig(): GlobalConfig {
  const path = join(shipgateHome(), 'config.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GlobalConfig;
  } catch {
    return {};
  }
}

/** Tighten modes on existing home/config before writing secrets. */
function hardenShipgateHome(home: string, configPathFull: string): void {
  try {
    mkdirSync(home, { recursive: true, mode: 0o700 });
  } catch {
    /* ignore */
  }
  try {
    chmodSync(home, 0o700);
  } catch {
    /* ignore */
  }
  if (existsSync(configPathFull)) {
    try {
      chmodSync(configPathFull, 0o600);
    } catch {
      /* ignore */
    }
  }
}

export function writeGlobalConfig(cfg: GlobalConfig): void {
  const home = shipgateHome();
  const path = join(home, 'config.json');
  hardenShipgateHome(home, path);
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

export function resolveApiKey(global: GlobalConfig): string | undefined {
  return process.env.OPENROUTER_API_KEY || global.openRouterApiKey;
}

/** Validate optional --account (display/pin only; does not switch gh credentials). */
export function validateAccount(account: string | undefined): string | undefined {
  if (account === undefined || account === '') return undefined;
  if (!GH_ACCOUNT_RE.test(account)) {
    throw new Error(
      `invalid --account ${JSON.stringify(account)} (expected GitHub login)`,
    );
  }
  return account;
}

export function buildOnConfig(opts: {
  level?: string;
  agent?: boolean;
  publicOk?: boolean;
  account?: string;
  model?: string;
}): ShipgateConfig {
  return {
    enabled: true,
    level: opts.level ? parseLevel(opts.level) : DEFAULT_LEVEL,
    agentReview: Boolean(opts.agent),
    publicOk: Boolean(opts.publicOk),
    account: opts.account,
    model: opts.model,
  };
}
