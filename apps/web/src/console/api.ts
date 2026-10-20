import type { PlanAction, RemoteVisibility, RunPlanResult, SafetyLevel, SecretFinding } from '@shipgate/core/browser';

/**
 * Client for the repository console API that `shipgate ui` serves. The server embeds a
 * per-session token in the page as <meta name="shipgate-console">; without it (the static
 * simulator build, or `shipgate demo --serve`) there is no console to talk to.
 */

export interface ConsoleSession {
  token: string;
  repoName: string;
}

export function readSession(doc: Pick<Document, 'querySelector'> = document): ConsoleSession | null {
  const meta = doc.querySelector('meta[name="shipgate-console"]');
  const token = meta?.getAttribute('content')?.trim();
  if (!token) return null;
  return { token, repoName: meta?.getAttribute('data-repo') ?? '' };
}

export interface StatusReport {
  version: string;
  inGitRepo: boolean;
  root: string | null;
  branch: string | null;
  config: { state: 'missing' | 'invalid' | 'ok' | 'not-applicable'; path: string | null; error?: string };
  enabled: boolean;
  level: SafetyLevel | null;
  account: string | null;
  agentReview: boolean;
  publicOk: boolean;
  model: string | null;
  destination: { visibility: RemoteVisibility; description: string } | null;
  hooks: { claude: boolean; cursor: boolean; paths: { claude: string; cursor: string } };
  busyCount: number;
  lock: { state: 'free' | 'held' | 'stale'; path: string; pid?: number; command?: string; startedAt?: string } | null;
}

export interface HistoryCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  shipgate: boolean;
  merge: boolean;
  onOrigin: boolean | null;
}

export interface HistoryReport {
  inGitRepo: boolean;
  branch: string | null;
  originRef: string | null;
  commits: HistoryCommit[];
  undoCandidate: boolean;
}

export type PreviewState = 'ready' | 'not-repository' | 'invalid-config' | 'not-enabled' | 'unsafe-state' | 'scan-failed';

export interface PreviewResult {
  state: PreviewState;
  summary: string;
  plan?: RunPlanResult;
  branch: string | null;
  remote: string | null;
  changes: Array<{ path: string; status: string }>;
  findings: SecretFinding[];
  subject?: string;
  problems: string[];
  notes: string[];
  next?: string;
  lines: string[];
}

export interface RunOptions {
  message?: string;
  prompt?: string;
  forceSecrets?: boolean;
  publicOk?: boolean;
  confirm?: boolean;
}

export interface SettingsInput {
  level?: SafetyLevel;
  agentReview?: boolean;
  publicOk?: boolean;
  model?: string;
  account?: string;
}

export interface CommandResult {
  exitCode: number;
  lines: string[];
}

export interface ShipRunResult extends CommandResult {
  outcome: string;
  action: PlanAction;
  summary: string;
  committed: boolean;
  pushed: boolean;
  sha?: string;
}

export interface UndoRunResult extends CommandResult {
  undone: boolean;
  outcome: 'refused' | 'undone-local' | 'undone-remote' | 'partial';
  reason: string;
}

/** A failed API call, with a message meant for people. */
export class ConsoleError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ConsoleError';
  }
}

/** Plain-language message for a failed request. `status` is null for network failures. */
export function errorMessage(status: number | null, serverMessage?: string): string {
  if (status === null) return 'The console server is not answering. Is shipgate ui still running? Start it again and reload this page.';
  if (status === 401) return 'This page’s session ended (shipgate ui was restarted). Reload the page.';
  if (status === 403) return 'The console only answers on 127.0.0.1 or localhost. Open the address that shipgate ui printed.';
  return serverMessage || `The console server answered with HTTP ${status}.`;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ConsoleClient {
  status(): Promise<StatusReport>;
  history(limit?: number): Promise<HistoryReport>;
  preview(options: RunOptions): Promise<PreviewResult>;
  ship(options: RunOptions): Promise<ShipRunResult>;
  undo(): Promise<UndoRunResult>;
  on(settings: SettingsInput): Promise<CommandResult>;
  off(): Promise<CommandResult>;
  setup(): Promise<CommandResult>;
}

export function createClient(session: ConsoleSession, fetchImpl: Fetch = (input, init) => fetch(input, init)): ConsoleClient {
  const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(path, {
        method,
        headers: {
          'X-Shipgate-Token': session.token,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new ConsoleError(errorMessage(null), null);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    if (!response.ok) {
      const serverMessage = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : undefined;
      throw new ConsoleError(errorMessage(response.status, serverMessage), response.status);
    }
    if (data === undefined) throw new ConsoleError('The console server sent a response that is not JSON.', response.status);
    return data as T;
  };
  // Relative paths, so the console also works behind a path prefix.
  return {
    status: () => call('GET', 'api/status'),
    history: (limit = 30) => call('GET', `api/history?limit=${limit}`),
    preview: (options) => call('POST', 'api/preview', clean(options)),
    ship: (options) => call('POST', 'api/ship', clean(options)),
    undo: () => call('POST', 'api/undo'),
    on: (settings) => call('POST', 'api/on', settings),
    off: () => call('POST', 'api/off'),
    setup: () => call('POST', 'api/setup'),
  };
}

/** Drop empty text and false flags, so the request matches what the CLI flags would say. */
export function clean(options: RunOptions): RunOptions {
  const out: RunOptions = {};
  if (options.message?.trim()) out.message = options.message;
  if (options.prompt?.trim()) out.prompt = options.prompt;
  if (options.forceSecrets) out.forceSecrets = true;
  if (options.publicOk) out.publicOk = true;
  if (options.confirm) out.confirm = true;
  return out;
}
