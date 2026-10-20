import { describe, expect, it, vi } from 'vitest';
import { clean, ConsoleError, createClient, errorMessage, readSession, type PreviewResult, type StatusReport } from '../src/console/api';
import {
  changeLabel,
  destinationLabel,
  destinationTone,
  draftFromStatus,
  keptValues,
  lockSummary,
  onCommand,
  policySummary,
  relativeTime,
  runCommand,
  sameDraft,
  settingsProblems,
  settingsRequest,
  shellQuote,
  shipReadiness,
} from '../src/console/model';

function status(patch: Partial<StatusReport> = {}): StatusReport {
  return {
    version: '2.2.0',
    inGitRepo: true,
    root: '/work/app',
    branch: 'main',
    config: { state: 'ok', path: '/work/app/.shipgate.json' },
    enabled: true,
    level: 'balanced',
    account: null,
    agentReview: false,
    publicOk: false,
    model: null,
    destination: { visibility: 'private', description: 'github.com/acme/app (private)' },
    hooks: { claude: false, cursor: false, paths: { claude: '/h/.claude/settings.json', cursor: '/h/.cursor/hooks.json' } },
    busyCount: 0,
    lock: { state: 'free', path: '/work/app/.git/shipgate-ship.lock' },
    ...patch,
  };
}

function preview(patch: Partial<PreviewResult> = {}): PreviewResult {
  return {
    state: 'ready',
    summary: 'The balanced policy allows this run.',
    plan: { action: 'ship', code: 'clear', summary: 'The balanced policy allows this run.', reasons: [], warnings: [], recommendations: [], review: 'off', gates: [] },
    branch: 'main',
    remote: 'github.com/acme/app (private)',
    changes: [{ path: 'a.txt', status: 'A' }],
    findings: [],
    problems: [],
    notes: [],
    lines: [],
    ...patch,
  };
}

function reply(status: number, body: unknown): Response {
  return new Response(body === undefined ? 'not json' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('console session', () => {
  it('reads the token and repository name the server embeds', () => {
    const meta = { getAttribute: (name: string) => ({ content: ' tok ', 'data-repo': 'app' })[name] ?? null };
    expect(readSession({ querySelector: () => meta } as unknown as Document)).toEqual({ token: 'tok', repoName: 'app' });
    expect(readSession({ querySelector: () => null } as unknown as Document)).toBeNull();
    const empty = { getAttribute: () => '' };
    expect(readSession({ querySelector: () => empty } as unknown as Document)).toBeNull();
  });
});

describe('console client', () => {
  it('sends the token, JSON bodies, and relative paths', async () => {
    const fetch = vi.fn(async () => reply(200, { exitCode: 0, lines: [] }));
    const client = createClient({ token: 'abc', repoName: 'app' }, fetch);
    await client.ship({ message: 'Add a', forceSecrets: false, prompt: '  ', confirm: true });
    expect(fetch).toHaveBeenCalledWith('api/ship', expect.objectContaining({
      method: 'POST',
      headers: { 'X-Shipgate-Token': 'abc', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Add a', confirm: true }),
    }));
    await client.status();
    expect(fetch).toHaveBeenLastCalledWith('api/status', expect.objectContaining({ method: 'GET', headers: { 'X-Shipgate-Token': 'abc' }, body: undefined }));
    await client.history(5);
    expect(fetch).toHaveBeenLastCalledWith('api/history?limit=5', expect.anything());
    for (const call of [client.undo, client.off, client.setup]) await call();
    expect(fetch.mock.calls.map((c) => (c as unknown as [string])[0]).slice(-3)).toEqual(['api/undo', 'api/off', 'api/setup']);
  });

  it('turns failures into messages people can act on', async () => {
    const failing = (response: Response | Error) => createClient({ token: 't', repoName: '' }, async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    await expect(failing(new TypeError('Failed to fetch')).status()).rejects.toMatchObject({ status: null, message: expect.stringContaining('not answering') });
    await expect(failing(reply(401, { error: 'x' })).status()).rejects.toMatchObject({ status: 401, message: expect.stringContaining('Reload the page') });
    await expect(failing(reply(400, { error: '"level" must be a string.' })).on({})).rejects.toMatchObject({ message: '"level" must be a string.' });
    await expect(failing(reply(500, undefined)).status()).rejects.toMatchObject({ message: 'The console server answered with HTTP 500.' });
    await expect(failing(reply(200, undefined)).status()).rejects.toBeInstanceOf(ConsoleError);
    expect(errorMessage(403)).toContain('127.0.0.1');
  });

  it('drops empty text and false flags', () => {
    expect(clean({ message: '', prompt: 'x', forceSecrets: false, publicOk: true, confirm: undefined })).toEqual({ prompt: 'x', publicOk: true });
  });
});

describe('console commands', () => {
  it('quotes values like the simulator does', () => {
    expect(shellQuote('simple-text')).toBe('simple-text');
    expect(shellQuote('Add "x" for $HOME')).toBe('"Add \\"x\\" for \\$HOME"');
  });

  it('shows the CLI command for a run', () => {
    expect(runCommand('preview', {})).toBe('shipgate preview');
    expect(runCommand('ship', { message: 'Add greet', prompt: 'make it nice', forceSecrets: true, publicOk: true, confirm: true })).toBe(
      'shipgate ship -m "Add greet" --prompt "make it nice" --force-secrets --public-ok --confirm',
    );
    expect(runCommand('ship', { message: '   ' })).toBe('shipgate ship');
  });

  it('shows shipgate on with only the flags that change the saved settings', () => {
    const saved = draftFromStatus(status());
    expect(onCommand(saved, null)).toBe('shipgate on --level balanced');
    expect(onCommand(saved, saved)).toBe('shipgate on');
    expect(onCommand({ ...saved, level: 'strict', agentReview: true, model: 'x/y' }, saved)).toBe('shipgate on --level strict --agent --model x/y');
    const reviewing = { ...saved, agentReview: true, publicOk: true };
    expect(onCommand({ ...reviewing, agentReview: false, publicOk: false }, reviewing)).toBe('shipgate on --agent=false --public-ok=false');
  });
});

describe('settings form', () => {
  it('starts from the saved settings or the defaults', () => {
    expect(draftFromStatus(null)).toEqual({ level: 'balanced', agentReview: false, publicOk: false, model: '', account: '' });
    expect(draftFromStatus(status({ level: 'strict', account: 'octocat', model: 'm' }))).toMatchObject({ level: 'strict', account: 'octocat', model: 'm' });
  });

  it('validates the account like the CLI', () => {
    const base = draftFromStatus(status());
    expect(settingsProblems({ ...base, account: 'octo-cat' })).toEqual({});
    expect(settingsProblems({ ...base, account: '-bad' }).account).toBeDefined();
    expect(settingsProblems({ ...base, account: 'a'.repeat(40) }).account).toBeDefined();
    expect(settingsProblems({ ...base, model: '   ' }).model).toBeDefined();
  });

  it('sends every setting and trims text', () => {
    expect(settingsRequest({ level: 'yolo', agentReview: true, publicOk: false, model: ' m ', account: '' })).toEqual({ level: 'yolo', agentReview: true, publicOk: false, model: 'm' });
  });

  it('compares drafts and says which cleared values shipgate on keeps', () => {
    const saved = { level: 'balanced' as const, agentReview: false, publicOk: false, model: 'm', account: 'octocat' };
    expect(sameDraft(saved, { ...saved, model: ' m ' })).toBe(true);
    expect(sameDraft(saved, { ...saved, level: 'strict' })).toBe(false);
    expect(keptValues({ ...saved, model: '', account: '' }, saved)).toEqual(['model', 'account']);
    expect(keptValues(saved, null)).toEqual([]);
  });
});

describe('status cards', () => {
  it('summarises the policy for each configuration state', () => {
    expect(policySummary(status())).toMatchObject({ tone: 'ship', label: 'balanced' });
    expect(policySummary(status({ enabled: false }))).toMatchObject({ tone: 'noop', label: 'Disabled' });
    expect(policySummary(status({ config: { state: 'missing', path: null } }))).toMatchObject({ label: 'Not enabled' });
    expect(policySummary(status({ config: { state: 'invalid', path: 'p', error: 'bad level' } }))).toMatchObject({ tone: 'block', detail: 'bad level' });
  });

  it('names and colours the destination', () => {
    expect([destinationLabel(status()), destinationTone(status())]).toEqual(['Private', 'ship']);
    const pub = status({ destination: { visibility: 'public', description: 'x' } });
    expect([destinationLabel(pub), destinationTone(pub)]).toEqual(['Public', 'hold']);
    expect(destinationTone({ ...pub, publicOk: true })).toBe('noop');
    expect(destinationLabel(status({ destination: null }))).toBe('No origin');
    expect(destinationLabel(status({ destination: { visibility: 'other-host', description: 'x' } }))).toBe('Not GitHub');
  });

  it('describes busy markers and the lock', () => {
    expect(lockSummary(status())).toEqual({ tone: 'ship', text: 'No busy agents · lock free' });
    expect(lockSummary(status({ busyCount: 2 })).text).toBe('2 busy agent markers · lock free');
    expect(lockSummary(status({ lock: { state: 'held', path: 'p', pid: 7, command: 'ship' } })).text).toContain('held by shipgate ship (pid 7)');
    expect(lockSummary(status({ lock: { state: 'stale', path: 'p', pid: 9 } })).text).toContain('stale lock from pid 9');
  });
});

describe('ship button', () => {
  it('is offered only when the preview says ship', () => {
    expect(shipReadiness(null).allowed).toBe(false);
    expect(shipReadiness(preview())).toEqual({ allowed: true, reason: 'The policy allows this run.' });
    expect(shipReadiness(preview({ plan: { ...preview().plan!, review: 'pending' } })).reason).toContain('external review decides');
    expect(shipReadiness(preview({ changes: [] }))).toEqual({ allowed: false, reason: 'There are no changes to ship.' });
    expect(shipReadiness(preview({ state: 'not-enabled' })).reason).toBe('Enable Shipgate in Settings first.');
    expect(shipReadiness(preview({ state: 'unsafe-state', summary: 'ship would stop before staging: HEAD is detached.' })).reason).toContain('HEAD is detached');
    const blocked = shipReadiness(preview({ plan: { ...preview().plan!, action: 'block', summary: 'Credential findings block this run.' } }));
    expect(blocked).toEqual({ allowed: false, reason: 'The policy would block this run: Credential findings block this run.' });
  });
});

describe('formatting', () => {
  it('labels git change letters', () => {
    expect(['A', 'M', 'D', 'T', 'X'].map(changeLabel)).toEqual(['Added', 'Modified', 'Deleted', 'Type changed', 'X']);
  });

  it('shows recent times relatively and old ones as dates', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(relativeTime('2026-10-20T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-10-20T11:59:00Z', now)).toBe('1 minute ago');
    expect(relativeTime('2026-10-20T09:00:00Z', now)).toBe('3 hours ago');
    expect(relativeTime('2026-10-18T12:00:00Z', now)).toBe('2 days ago');
    expect(relativeTime('2026-09-01T12:00:00Z', now)).toBe('2026-09-01');
    expect(relativeTime('not a date', now)).toBe('not a date');
  });
});
