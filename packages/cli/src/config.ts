import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LEVEL, isSafetyLevel, type ShipgateConfig } from '@shipgate/core';

export const CONFIG_FILENAME = '.shipgate.json';

const GH_ACCOUNT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_KEYS = ['enabled', 'level', 'agentReview', 'publicOk', 'account', 'model'];

export type RepoConfigState =
  | { state: 'missing'; path: string }
  | { state: 'invalid'; path: string; error: string }
  | { state: 'ok'; path: string; config: ShipgateConfig };

function configPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_FILENAME);
}

/** Read `.shipgate.json`, distinguishing a missing file from an invalid one. */
export function loadRepoConfig(repoRoot: string): RepoConfigState {
  const path = configPath(repoRoot);
  if (!existsSync(path)) return { state: 'missing', path };
  const invalid = (error: string): RepoConfigState => ({ state: 'invalid', path, error });
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return invalid(`not valid JSON (${(error as Error).message})`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('must contain a JSON object');
  const obj = raw as Record<string, unknown>;
  const unknown = Object.keys(obj).filter((key) => !REPO_KEYS.includes(key));
  if (unknown.length) return invalid(`unknown setting ${unknown.map((k) => JSON.stringify(k)).join(', ')}`);
  for (const key of ['enabled', 'agentReview', 'publicOk']) {
    if (obj[key] !== undefined && typeof obj[key] !== 'boolean') return invalid(`"${key}" must be true or false`);
  }
  if (obj.level !== undefined && !isSafetyLevel(obj.level)) {
    return invalid(`"level" must be "strict", "balanced", or "yolo" (found ${JSON.stringify(obj.level)})`);
  }
  if (obj.account !== undefined && (typeof obj.account !== 'string' || !GH_ACCOUNT_RE.test(obj.account))) {
    return invalid('"account" must be a GitHub login');
  }
  if (obj.model !== undefined && (typeof obj.model !== 'string' || !obj.model.trim())) {
    return invalid('"model" must be a non-empty string');
  }
  return {
    state: 'ok',
    path,
    config: {
      enabled: obj.enabled !== false,
      level: (obj.level as ShipgateConfig['level'] | undefined) ?? DEFAULT_LEVEL,
      agentReview: obj.agentReview === true,
      publicOk: obj.publicOk === true,
      account: obj.account as string | undefined,
      model: obj.model as string | undefined,
    },
  };
}

export function writeRepoConfig(repoRoot: string, cfg: ShipgateConfig): void {
  const { account, model, ...rest } = cfg;
  const out = { ...rest, ...(account ? { account } : {}), ...(model ? { model } : {}) };
  writeFileSync(configPath(repoRoot), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
}

export function validateAccount(account: string | undefined): string | undefined {
  if (account === undefined || account === '') return undefined;
  if (!GH_ACCOUNT_RE.test(account)) throw new Error(`invalid --account ${JSON.stringify(account)} (expected a GitHub login)`);
  return account;
}

export interface GlobalConfig {
  openRouterApiKey?: string;
  model?: string;
  baseUrl?: string;
}

function shipgateHome(): string {
  return process.env.SHIPGATE_HOME || join(homedir(), '.shipgate');
}

function globalConfigPath(): string {
  return join(shipgateHome(), 'config.json');
}

/** Read `~/.shipgate/config.json`. Throws with the file path when it is invalid. */
export function readGlobalConfig(): GlobalConfig {
  const path = globalConfigPath();
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${(error as Error).message})`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${path} must contain a JSON object`);
  const result: GlobalConfig = {};
  for (const key of ['openRouterApiKey', 'model', 'baseUrl'] as const) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: "${key}" must be a non-empty string`);
    result[key] = value;
  }
  if (result.baseUrl && !/^https?:\/\/[^/]/i.test(result.baseUrl)) {
    throw new Error(`${path}: "baseUrl" must be an http(s) URL`);
  }
  return result;
}

/** Write the global config with owner-only permissions where the platform supports them. */
export function writeGlobalConfig(cfg: GlobalConfig): void {
  const home = shipgateHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = globalConfigPath();
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  for (const [target, mode] of [[home, 0o700], [path, 0o600]] as const) {
    try {
      chmodSync(target, mode);
    } catch {
      // Windows and some file systems ignore POSIX modes.
    }
  }
}

export function resolveApiKey(global: GlobalConfig): string | undefined {
  return process.env.OPENROUTER_API_KEY || global.openRouterApiKey;
}
