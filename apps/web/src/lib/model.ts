import {
  DEMO_SCENARIOS,
  SAFETY_LEVELS,
  evaluatePolicy,
  formatShipResult,
  locateSecrets,
  planRun,
  scanSecrets,
  scanTextForSecrets,
  simulateShip,
  type DemoScenario,
  type RemoteVisibility,
  type RunPlanInput,
  type RunPlanResult,
  type SafetyLevel,
  type SecretFinding,
  type ShipResult,
} from '@shipgate/core/browser';

export type ReviewChoice = 'off' | 'approve' | 'hold' | 'unavailable';

export interface SimFile {
  path: string;
  content: string;
}

/** Every input the simulator exposes. Choosing an example replaces all of them. */
export interface SimState {
  scenarioId: string;
  level: SafetyLevel;
  configPresent: boolean;
  hasChanges: boolean;
  busyAgents: number;
  remote: RemoteVisibility;
  forceSecrets: boolean;
  publicOk: boolean;
  confirm: boolean;
  messageOn: boolean;
  message: string;
  review: ReviewChoice;
  /** The reviewer's reason (hold) or the error (unavailable). */
  reviewDetail: string;
  files: SimFile[];
  activePath: string | null;
}

export const DEFAULT_SCENARIO_ID = 'clean-change';
export const DEFAULT_MESSAGE = 'Describe the change';
export const MAX_BUSY_AGENTS = 3;

export function scenarioById(id: string): DemoScenario {
  const scenario = DEMO_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown example ${JSON.stringify(id)}`);
  return scenario;
}

/** The reviewer text the simulator starts with for a review choice. */
export function defaultReviewDetail(choice: ReviewChoice, scenarioId: string): string {
  if (choice === 'hold') return scenarioById(scenarioId).facts.review.detail ?? 'The change looks unfinished.';
  if (choice === 'unavailable') return 'no API key (set OPENROUTER_API_KEY or run shipgate on --key)';
  return '';
}

export function stateFromScenario(id: string): SimState {
  const { facts, files } = scenarioById(id);
  const review: ReviewChoice = facts.review.enabled ? facts.review.outcome ?? 'approve' : 'off';
  return {
    scenarioId: id,
    level: facts.level,
    configPresent: facts.configPresent,
    hasChanges: files.length > 0,
    busyAgents: facts.busyAgents,
    remote: facts.remote,
    forceSecrets: Boolean(facts.flags.forceSecrets),
    publicOk: Boolean(facts.flags.publicOk),
    confirm: Boolean(facts.flags.confirm),
    messageOn: facts.flags.message !== undefined,
    message: facts.flags.message ?? DEFAULT_MESSAGE,
    review,
    reviewDetail: facts.review.detail ?? defaultReviewDetail(review, id),
    files: files.map((f) => ({ path: f.path, content: f.content })),
    activePath: files[0]?.path ?? null,
  };
}

/** True when the inputs differ from the example they started from. */
export function isModified(state: SimState): boolean {
  const { activePath: _a, ...current } = state;
  const { activePath: _b, ...original } = stateFromScenario(state.scenarioId);
  return JSON.stringify(current) !== JSON.stringify(original);
}

/**
 * Build the planRun input. Findings come from the real scanner run on the files in
 * the editor, plus the -m message, which the CLI scans as well.
 */
export function toRunPlanInput(state: SimState): RunPlanInput {
  const files = state.hasChanges ? state.files : [];
  const message = state.messageOn ? state.message : undefined;
  return {
    configPresent: state.configPresent,
    dirtyFiles: files.map((f) => f.path),
    findings: [...scanSecrets(files), ...(message ? scanTextForSecrets(message, '--message') : [])],
    level: state.level,
    flags: {
      forceSecrets: state.forceSecrets,
      publicOk: state.publicOk,
      confirm: state.confirm,
      message,
    },
    remote: state.remote,
    busyAgents: state.busyAgents,
    review: state.review === 'off' ? { enabled: false } : { enabled: true, outcome: state.review, detail: state.reviewDetail },
  };
}

/** Placeholder repository details for the terminal preview. */
export function placeFor(remote: RemoteVisibility) {
  return {
    branch: 'main',
    remoteName: remote === 'other-host' ? 'https://git.example.com/acme/app.git' : 'github.com/acme/app',
    sha: '4f2c9e1',
  };
}

export interface Evaluation {
  input: RunPlanInput;
  result: RunPlanResult;
  report: ShipResult;
  /** Lines `shipgate ship` prints to stderr. */
  output: string[];
}

export function evaluate(state: SimState): Evaluation {
  const input = toRunPlanInput(state);
  const report = simulateShip(input, placeFor(state.remote));
  return { input, result: planRun(input), report, output: formatShipResult(report) };
}

/** One sentence on what the run would leave behind, phrased for a simulation. */
export function whatHappens(report: ShipResult): string {
  switch (report.outcome) {
    case 'pushed':
      return `Commits on ${report.branch} and pushes to origin. If the push fails, the commit stays local and ship exits 1.`;
    case 'committed':
      return `Commits on ${report.branch}. There is no origin remote, so nothing is pushed.`;
    case 'not-enabled':
      return 'Stages nothing and exits. Shipgate does nothing in repositories that did not opt in.';
    case 'busy':
      return 'Stages nothing and exits. A later run ships once the other agent finishes.';
    case 'nothing-to-ship':
      return 'Finds nothing to commit and exits.';
    default:
      return 'Commits nothing. The staging area is put back the way it was; files are never modified.';
  }
}

export const ACTION_LABEL: Record<RunPlanResult['action'], string> = {
  ship: 'Ship',
  hold: 'Hold',
  block: 'Block',
  noop: 'No change',
};

/** What a credential finding does under the current level and flags. */
export type FindingEffect = 'blocks' | 'overridden' | 'allowed';

export function findingEffect(state: SimState, finding: SecretFinding): FindingEffect {
  const [credentials] = evaluatePolicy({ level: state.level, findings: [finding], remote: 'none', flags: {}, reviewEnabled: false }).gates;
  if (credentials.status !== 'block') return 'allowed';
  return state.forceSecrets ? 'overridden' : 'blocks';
}

export interface Suggestion {
  id: string;
  label: string;
  /** Shown when the change is risky or rarely right. */
  caution?: string;
  next: SimState;
  result: RunPlanResult;
}

const REMOTE_CHANGE: Record<RemoteVisibility, string> = {
  private: 'Push to a private GitHub repository',
  public: 'Push to a public GitHub repository',
  unknown: 'GitHub visibility cannot be checked',
  'other-host': 'Push to a host other than GitHub',
  none: 'Remove the origin remote',
};

const REVIEW_CHANGE: Record<ReviewChoice, string> = {
  off: 'Turn external review off',
  approve: 'The reviewer approves',
  hold: 'The reviewer asks to hold',
  unavailable: 'Review cannot run',
};

/**
 * Single changes to the inputs that change the decision, each checked with planRun.
 * Changes that lead to shipping come first when the current run does not ship.
 */
export function suggestions(state: SimState): Suggestion[] {
  const current = planRun(toRunPlanInput(state)).action;
  const candidates: Array<Omit<Suggestion, 'result'>> = [];
  const add = (id: string, label: string, patch: Partial<SimState>, caution?: string) =>
    candidates.push({ id, label, caution, next: { ...state, ...patch } });

  if (!state.configPresent) add('enable', 'Opt in with shipgate on', { configPresent: true });
  if (state.busyAgents > 0) add('idle', 'Wait until no other agent is busy', { busyAgents: 0 });
  if (!state.hasChanges) add('changes', 'Make a change to commit', { hasChanges: true });
  if (state.hasChanges) {
    const flagged = new Set(scanSecrets(state.files).map((f) => f.path));
    for (const file of state.files.filter((f) => flagged.has(f.path))) {
      add(`drop:${file.path}`, `Leave ${file.path} out of the change`, {
        files: state.files.filter((f) => f !== file),
        activePath: state.activePath === file.path ? state.files.find((f) => f !== file)?.path ?? null : state.activePath,
      });
    }
  }
  if (state.messageOn && scanTextForSecrets(state.message).length) add('message-clean', 'Remove the credential from the -m message', { message: DEFAULT_MESSAGE });
  add('force', state.forceSecrets ? 'Drop --force-secrets' : 'Pass --force-secrets', { forceSecrets: !state.forceSecrets },
    state.forceSecrets ? undefined : 'Only for false positives');
  add('public-ok', state.publicOk ? 'Drop --public-ok' : 'Pass --public-ok', { publicOk: !state.publicOk });
  add('message', state.messageOn ? 'Drop -m' : 'Pass -m, which skips external review', { messageOn: !state.messageOn });
  for (const level of SAFETY_LEVELS) if (level !== state.level) add(`level:${level}`, `Use the ${level} level`, { level });
  for (const remote of Object.keys(REMOTE_CHANGE) as RemoteVisibility[]) {
    if (remote !== state.remote) add(`remote:${remote}`, REMOTE_CHANGE[remote], { remote });
  }
  for (const review of Object.keys(REVIEW_CHANGE) as ReviewChoice[]) {
    if (review !== state.review) add(`review:${review}`, REVIEW_CHANGE[review], { review, reviewDetail: defaultReviewDetail(review, state.scenarioId) });
  }
  if (state.busyAgents === 0) add('busy', 'Another agent starts working', { busyAgents: 1 });
  if (state.configPresent) add('disable', 'Turn Shipgate off with shipgate off', { configPresent: false });

  const changed = candidates
    .map((c) => ({ ...c, result: planRun(toRunPlanInput(c.next)) }))
    .filter((c) => c.result.action !== current);
  const ships = (s: Suggestion) => (s.result.action === 'ship' ? 0 : 1);
  return current === 'ship' ? changed : [...changed].sort((a, b) => ships(a) - ships(b));
}

/** The decision for these inputs at every level. */
export function compareLevels(state: SimState): Array<{ level: SafetyLevel; result: RunPlanResult }> {
  return SAFETY_LEVELS.map((level) => ({ level, result: planRun(toRunPlanInput({ ...state, level })) }));
}

function shellQuote(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `"${text.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** CLI commands that reproduce the level and flags in a real repository. */
export function cliCommands(state: SimState): { setup?: string; ship: string } {
  const ship = ['shipgate ship'];
  if (state.messageOn) ship.push(`-m ${shellQuote(state.message)}`);
  if (state.forceSecrets) ship.push('--force-secrets');
  if (state.publicOk) ship.push('--public-ok');
  if (state.confirm) ship.push('--confirm');
  if (!state.configPresent) return { ship: ship.join(' ') };
  return {
    setup: ['shipgate on', `--level ${state.level}`, ...(state.review === 'off' ? [] : ['--agent'])].join(' '),
    ship: ship.join(' '),
  };
}

/** Values the scanner skips as placeholders, as documented in the README. */
export const PLACEHOLDER_EXAMPLES = ['your-api-key-here', 'changeme', '<YOUR_KEY>', '${API_KEY}', 'xxxxxxxx', 'AKIAIOSFODNN7EXAMPLE'];

export interface SkippedValue {
  path: string;
  line: number;
  ruleId: string;
  value: string;
}

/** Credential-shaped values the scanner skips because they are plainly placeholders. */
export function skippedPlaceholders(files: SimFile[]): SkippedValue[] {
  return files.flatMap((file) =>
    locateSecrets(file.content)
      .filter((m) => m.placeholder)
      .map((m) => ({
        path: file.path,
        line: file.content.slice(0, m.from).split('\n').length,
        ruleId: m.ruleId,
        value: file.content.slice(m.from, m.to).split('\n')[0],
      })),
  );
}

/** Why a file path cannot be used, or undefined when it can. */
export function pathProblem(path: string, others: string[]): string | undefined {
  const trimmed = path.trim();
  if (!trimmed) return 'Enter a file path.';
  if (trimmed !== path) return 'Remove spaces at the start or end.';
  if (/^[/\\]|^[A-Za-z]:/.test(path)) return 'Use a path relative to the repository root.';
  if (path.split(/[/\\]/).some((part) => part === '..' || part === '.' || part === '')) return 'Use a plain relative path without empty, . or .. parts.';
  if (others.includes(path)) return 'Another file already has this path.';
  return undefined;
}
