import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_LEVEL,
  parseLevel,
  type SafetyLevel,
  type ShipgateConfig,
} from '@shipgate/core';

export const CONFIG_FILENAME = '.shipgate.json';

export function configPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_FILENAME);
}

export function readRepoConfig(repoRoot: string): ShipgateConfig | null {
  const path = configPath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ShipgateConfig>;
    return {
      enabled: raw.enabled !== false,
      level: parseLevel(raw.level as string | undefined),
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

export function writeGlobalConfig(cfg: GlobalConfig): void {
  const home = shipgateHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = join(home, 'config.json');
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

export function resolveApiKey(global: GlobalConfig): string | undefined {
  return process.env.OPENROUTER_API_KEY || global.openRouterApiKey;
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
    level: (opts.level as SafetyLevel) || DEFAULT_LEVEL,
    agentReview: Boolean(opts.agent),
    publicOk: Boolean(opts.publicOk),
    account: opts.account,
    model: opts.model,
  };
}
