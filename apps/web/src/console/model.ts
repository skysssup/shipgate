import type { PlanAction, SafetyLevel } from '@shipgate/core/browser';
import type { PreviewResult, RunOptions, SettingsInput, StatusReport } from './api';

/** Quote a value for a POSIX shell when it needs it. */
export function shellQuote(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `"${text.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** The CLI command that matches a ship or preview run from the console. */
export function runCommand(command: 'ship' | 'preview', options: RunOptions): string {
  const parts = [`shipgate ${command}`];
  if (options.message?.trim()) parts.push(`-m ${shellQuote(options.message)}`);
  if (options.prompt?.trim()) parts.push(`--prompt ${shellQuote(options.prompt)}`);
  if (options.forceSecrets) parts.push('--force-secrets');
  if (options.publicOk) parts.push('--public-ok');
  if (options.confirm) parts.push('--confirm');
  return parts.join(' ');
}

export interface SettingsDraft {
  level: SafetyLevel;
  agentReview: boolean;
  publicOk: boolean;
  model: string;
  account: string;
}

export function draftFromStatus(status: StatusReport | null): SettingsDraft {
  return {
    level: status?.level ?? 'balanced',
    agentReview: status?.agentReview ?? false,
    publicOk: status?.publicOk ?? false,
    model: status?.model ?? '',
    account: status?.account ?? '',
  };
}

const ACCOUNT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Field errors the server would report, checked before sending. */
export function settingsProblems(draft: SettingsDraft): Partial<Record<keyof SettingsDraft, string>> {
  const problems: Partial<Record<keyof SettingsDraft, string>> = {};
  if (draft.account.trim() && !ACCOUNT_RE.test(draft.account.trim())) {
    problems.account = 'A GitHub login: letters, digits, and single hyphens, up to 39 characters.';
  }
  if (draft.model && !draft.model.trim()) problems.model = 'Enter a model id or leave the field empty.';
  return problems;
}

/** The request body for POST /api/on: every setting, so the file matches the form. */
export function settingsRequest(draft: SettingsDraft): SettingsInput {
  return {
    level: draft.level,
    agentReview: draft.agentReview,
    publicOk: draft.publicOk,
    ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
    ...(draft.account.trim() ? { account: draft.account.trim() } : {}),
  };
}

/** `shipgate on` with the flags that change the saved settings. */
export function onCommand(draft: SettingsDraft, saved: SettingsDraft | null): string {
  const parts = ['shipgate on'];
  if (!saved || draft.level !== saved.level) parts.push(`--level ${draft.level}`);
  if (!saved ? draft.agentReview : draft.agentReview !== saved.agentReview) parts.push(draft.agentReview ? '--agent' : '--agent=false');
  if (!saved ? draft.publicOk : draft.publicOk !== saved.publicOk) parts.push(draft.publicOk ? '--public-ok' : '--public-ok=false');
  if (draft.model.trim() && draft.model.trim() !== saved?.model) parts.push(`--model ${shellQuote(draft.model.trim())}`);
  if (draft.account.trim() && draft.account.trim() !== saved?.account) parts.push(`--account ${shellQuote(draft.account.trim())}`);
  return parts.join(' ');
}

export function sameDraft(a: SettingsDraft, b: SettingsDraft): boolean {
  return a.level === b.level && a.agentReview === b.agentReview && a.publicOk === b.publicOk && a.model.trim() === b.model.trim() && a.account.trim() === b.account.trim();
}

/** Settings that the form can clear but `shipgate on` keeps (it only replaces values it is given). */
export function keptValues(draft: SettingsDraft, saved: SettingsDraft | null): string[] {
  if (!saved) return [];
  const kept: string[] = [];
  if (saved.model && !draft.model.trim()) kept.push('model');
  if (saved.account && !draft.account.trim()) kept.push('account');
  return kept;
}

const CHANGE_LABEL: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', T: 'Type changed' };

export function changeLabel(status: string): string {
  return CHANGE_LABEL[status] ?? status;
}

/** "3 minutes ago" style text, with the absolute date as the fallback for old commits. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return 'just now';
  const units: Array<[number, string]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
  ];
  if (seconds < 7 * 86400) {
    for (let i = units.length - 1; i >= 0; i -= 1) {
      const [size, name] = units[i];
      if (seconds >= size) {
        const n = Math.round(seconds / size);
        return `${n} ${name}${n === 1 ? '' : 's'} ago`;
      }
    }
  }
  return new Date(then).toISOString().slice(0, 10);
}

export type Tone = PlanAction;

/** Tone and one-line summary for the policy card. */
export function policySummary(status: StatusReport): { tone: Tone; label: string; detail: string } {
  if (status.config.state === 'invalid') return { tone: 'block', label: 'Invalid', detail: status.config.error ?? '.shipgate.json is invalid.' };
  if (status.config.state !== 'ok') return { tone: 'noop', label: 'Not enabled', detail: 'No .shipgate.json yet. Enable Shipgate below to opt in.' };
  if (!status.enabled) return { tone: 'noop', label: 'Disabled', detail: '.shipgate.json has "enabled": false. Settings are kept.' };
  return {
    tone: 'ship',
    label: status.level ?? 'balanced',
    detail: `External review ${status.agentReview ? 'on' : 'off'} · public destinations ${status.publicOk ? 'acknowledged' : 'not acknowledged'}`,
  };
}

export function destinationTone(status: StatusReport): Tone {
  const visibility = status.destination?.visibility ?? 'none';
  if (visibility === 'private') return 'ship';
  if (visibility === 'public' || visibility === 'unknown') return status.publicOk ? 'noop' : 'hold';
  return 'noop';
}

export function lockSummary(status: StatusReport): { tone: Tone; text: string } {
  const lock = status.lock;
  const busy = status.busyCount ? `${status.busyCount} busy agent marker${status.busyCount === 1 ? '' : 's'}` : 'No busy agents';
  if (!lock || lock.state === 'free') return { tone: status.busyCount ? 'hold' : 'ship', text: `${busy} · lock free` };
  if (lock.state === 'stale') return { tone: 'hold', text: `${busy} · stale lock from pid ${lock.pid ?? '?'} (the next ship or undo removes it)` };
  return { tone: 'hold', text: `${busy} · lock held by shipgate ${lock.command ?? '?'} (pid ${lock.pid ?? '?'})` };
}

/** Whether the console offers the Ship button for this preview, and why not. */
export function shipReadiness(preview: PreviewResult | null): { allowed: boolean; reason: string } {
  if (!preview) return { allowed: false, reason: 'Waiting for the preview.' };
  if (preview.state === 'not-enabled') return { allowed: false, reason: 'Enable Shipgate in Settings first.' };
  if (preview.state !== 'ready') return { allowed: false, reason: preview.summary };
  if (!preview.changes.length) return { allowed: false, reason: 'There are no changes to ship.' };
  const action = preview.plan?.action;
  if (action !== 'ship') return { allowed: false, reason: `The policy would ${action === 'hold' ? 'hold' : 'block'} this run: ${preview.plan?.summary ?? ''}`.trim() };
  return { allowed: true, reason: preview.plan?.review === 'pending' ? 'The policy allows this run; external review decides before the commit.' : 'The policy allows this run.' };
}

const VISIBILITY_LABEL: Record<string, string> = {
  none: 'No origin',
  private: 'Private',
  public: 'Public',
  unknown: 'Visibility unknown',
  'other-host': 'Not GitHub',
};

export function destinationLabel(status: StatusReport): string {
  return VISIBILITY_LABEL[status.destination?.visibility ?? 'none'] ?? 'Unknown';
}

export interface Change {
  path: string;
  status: string;
}

/** How many changed paths the list renders before "Show more". */
export const CHANGE_PAGE = 100;
/** Search and status filters appear once the list is longer than this. */
export const CHANGE_FILTER_MIN = 10;

const STATUS_ORDER = ['A', 'M', 'D', 'T'];

/** Statuses present in the change list, in a stable order, with how many paths have each. */
export function changeCounts(changes: readonly Change[]): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const { status } of changes) counts.set(status, (counts.get(status) ?? 0) + 1);
  const rank = (s: string) => (STATUS_ORDER.includes(s) ? STATUS_ORDER.indexOf(s) : STATUS_ORDER.length);
  return [...counts].map(([status, count]) => ({ status, count })).sort((a, b) => rank(a.status) - rank(b.status) || a.status.localeCompare(b.status));
}

/**
 * Changes whose path contains every whitespace-separated term of `query` (case-insensitive),
 * limited to one status unless `status` is 'all'.
 */
export function filterChanges<T extends Change>(changes: readonly T[], query: string, status: string = 'all'): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return changes.filter((c) => (status === 'all' || c.status === status) && terms.every((t) => c.path.toLowerCase().includes(t)));
}

/** Directory (with its trailing slash) and file name, so the list can de-emphasize the directory. */
export function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/', path.length - 2);
  return slash < 0 ? { dir: '', name: path } : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}
