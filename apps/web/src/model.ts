import {
  DEMO_SCENARIOS,
  scenarioInput,
  type DemoScenario,
  type RemoteVisibility,
  type RunPlanInput,
  type RunPlanResult,
  type SafetyLevel,
} from '@shipgate/core/browser';

export type ReviewChoice = 'off' | 'approve' | 'hold' | 'unavailable';

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
  explicitMessage: boolean;
  review: ReviewChoice;
}

export const DEFAULT_SCENARIO_ID = 'clean-change';
const SAMPLE_MESSAGE = 'Describe the change';

export function scenarioById(id: string): DemoScenario {
  const scenario = DEMO_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown scenario ${JSON.stringify(id)}`);
  return scenario;
}

export function stateFromScenario(id: string): SimState {
  const { facts, files } = scenarioById(id);
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
    explicitMessage: Boolean(facts.flags.message),
    review: facts.review.enabled ? facts.review.outcome ?? 'approve' : 'off',
  };
}

const REVIEW_DETAIL: Record<Exclude<ReviewChoice, 'off'>, string> = {
  approve: 'The change looks complete.',
  hold: 'The change looks unfinished.',
  unavailable: 'no API key (set OPENROUTER_API_KEY or run shipgate on --key)',
};

/** Build the planRun input. Findings come from the real scanner run on the example's files. */
export function toRunPlanInput(state: SimState): RunPlanInput {
  const scenario = scenarioById(state.scenarioId);
  const scanned = scenarioInput(scenario);
  const reviewDetail = state.review === 'hold' && scenario.facts.review.detail ? scenario.facts.review.detail : undefined;
  return {
    configPresent: state.configPresent,
    dirtyFiles: state.hasChanges ? scanned.dirtyFiles : [],
    findings: state.hasChanges ? scanned.findings : [],
    level: state.level,
    flags: {
      forceSecrets: state.forceSecrets,
      publicOk: state.publicOk,
      confirm: state.confirm,
      message: state.explicitMessage ? SAMPLE_MESSAGE : undefined,
    },
    remote: state.remote,
    busyAgents: state.busyAgents,
    review: state.review === 'off'
      ? { enabled: false }
      : { enabled: true, outcome: state.review, detail: reviewDetail ?? REVIEW_DETAIL[state.review] },
  };
}

export const VERDICT: Record<RunPlanResult['action'], { label: string; meaning: string }> = {
  ship: { label: 'Ship', meaning: 'Policy allows the commit' },
  hold: { label: 'Hold', meaning: 'Waits; nothing is committed' },
  block: { label: 'Block', meaning: 'Stops before committing' },
  noop: { label: 'No change', meaning: 'Nothing to commit' },
};

export interface Consequence {
  /** What the real CLI would do, in order. */
  steps: string[];
  exitStatus: 0 | 1;
  /** What the person should do next, when anything. */
  next?: string;
}

/** Narrate what `shipgate ship` does with a decision. Wording only; the decision comes from planRun. */
export function consequence(result: RunPlanResult, input: RunPlanInput): Consequence {
  const restore = 'Put the staging area back the way it was, leaving your files unchanged.';
  switch (result.code) {
    case 'not-enabled':
      return { steps: ['Exit without staging anything.'], exitStatus: 0, next: 'Run shipgate on in the repository to opt in.' };
    case 'invalid-level':
      return { steps: ['Exit without staging anything.'], exitStatus: 1, next: 'Set level to strict, balanced, or yolo.' };
    case 'busy':
      return {
        steps: ['Exit without staging anything.', 'A later run ships once the other agent clears its busy marker.'],
        exitStatus: 0,
      };
    case 'nothing-to-ship':
      return { steps: ['Stage everything, find no changes, and exit.'], exitStatus: 0 };
    case 'credentials':
      return {
        steps: ['Stage all changes and scan the staged files.', restore, 'Exit without committing or pushing.'],
        exitStatus: 0,
        next: 'Remove the credential (keep .env files out of Git), or rerun with --force-secrets if it is a false positive.',
      };
    case 'public-destination':
      return {
        steps: ['Stage all changes and scan the staged files.', restore, 'Exit without committing or pushing.'],
        exitStatus: 0,
        next: 'Pass --public-ok (or run shipgate on --public-ok) if publishing to this repository is intended.',
      };
    case 'review-hold':
      return {
        steps: ['Send the redacted staged diff to the review endpoint.', restore, 'Exit without committing.'],
        exitStatus: 0,
        next: "Address the reviewer's concern, then run shipgate ship again.",
      };
    case 'review-unavailable':
      return {
        steps: ['Try to reach the review endpoint and fail.', restore, 'Exit without committing (review fails closed).'],
        exitStatus: 1,
        next: 'Fix the API key or endpoint, pass -m to skip review for one run, or turn review off with shipgate on --agent=false.',
      };
    case 'clear': {
      const steps = ['Stage all changes and scan the staged files.'];
      if (result.review === 'approved') steps.push('Send file paths, the redacted staged diff, and --prompt text for review; the reviewer approves.');
      steps.push('Commit with a Shipped-by: shipgate trailer.');
      if (input.remote === 'none') {
        steps.push('Keep the commit local: there is no origin remote.');
      } else {
        steps.push('Push to origin. If origin has new commits, fetch, rebase once, and push again.');
        steps.push('If the push still fails, keep the commit in the local branch and exit with status 1.');
      }
      return { steps, exitStatus: 0 };
    }
  }
}

/** CLI commands that reproduce the selected level and flags in a real repository. */
export function cliCommands(state: SimState): string[] {
  const on = ['shipgate on', `--level ${state.level}`];
  if (state.review !== 'off') on.push('--agent');
  const ship = ['shipgate ship'];
  if (state.explicitMessage) ship.push(`-m "${SAMPLE_MESSAGE}"`);
  if (state.forceSecrets) ship.push('--force-secrets');
  if (state.publicOk) ship.push('--public-ok');
  if (state.confirm) ship.push('--confirm');
  return [on.join(' '), ship.join(' ')];
}
