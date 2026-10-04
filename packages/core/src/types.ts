/** Policy levels, from most to least restrictive. */
export type SafetyLevel = 'strict' | 'balanced' | 'yolo';

export const SAFETY_LEVELS: readonly SafetyLevel[] = ['strict', 'balanced', 'yolo'];

/** Structured result of a credential pattern match. The excerpt is partially masked. */
export interface SecretFinding {
  /** Repository path, or `--message` / `--prompt` for command-line text. */
  path: string;
  ruleId: string;
  excerpt: string;
  confidence: 'high' | 'medium';
  /** 1-based line of the match when the rule matched file content. */
  line?: number;
}

/** Per-repository settings stored in `.shipgate.json` by `shipgate on`. */
export interface ShipgateConfig {
  enabled: boolean;
  level: SafetyLevel;
  agentReview: boolean;
  publicOk: boolean;
  account?: string;
  model?: string;
}

/** Flags for a single `shipgate ship` run. */
export interface ShipFlags {
  forceSecrets?: boolean;
  publicOk?: boolean;
  confirm?: boolean;
  /** Commit message given with `-m`/`--message`. A message skips external review. */
  message?: string;
}

/**
 * What Shipgate knows about the push destination (`origin`).
 * - `none`: no origin remote, so ship commits locally and does not push.
 * - `private` / `public`: GitHub reported the repository's visibility.
 * - `unknown`: a GitHub URL whose visibility could not be checked. Treated as public.
 * - `other-host`: not a GitHub URL. Shipgate does not check its visibility.
 */
export type RemoteVisibility = 'none' | 'private' | 'public' | 'unknown' | 'other-host';

export type ReviewOutcome = 'approve' | 'hold' | 'unavailable';

/** Optional external review configured with `shipgate on --agent`. */
export interface ReviewInput {
  enabled: boolean;
  /** Result of the review once it ran. Omit before the review runs. */
  outcome?: ReviewOutcome;
  /** Reviewer's explanation, or why the review could not run. */
  detail?: string;
}

/** Inputs to the pure `planRun` decision function. */
export interface RunPlanInput {
  /** `.shipgate.json` exists and is enabled. */
  configPresent: boolean;
  /** Paths `ship` would commit. Empty means there is nothing to ship. */
  dirtyFiles: string[];
  findings: SecretFinding[];
  level: SafetyLevel;
  flags: ShipFlags;
  remote: RemoteVisibility;
  /** Other live agents holding busy markers in this worktree. */
  busyAgents: number;
  review: ReviewInput;
}

/** `noop` means there was nothing to do; `hold` means wait or fix something and run again. */
export type PlanAction = 'ship' | 'hold' | 'block' | 'noop';

/** Primary cause of a decision. */
export type DecisionCode =
  | 'not-enabled'
  | 'invalid-level'
  | 'busy'
  | 'nothing-to-ship'
  | 'credentials'
  | 'public-destination'
  | 'review-hold'
  | 'review-unavailable'
  | 'clear';

/** Where external review stands for this decision. */
export type ReviewStatus =
  | 'off'
  | 'skipped'
  | 'not-reached'
  | 'pending'
  | 'approved'
  | 'held'
  | 'unavailable';

/** Result of evaluating whether a ship should proceed. */
export interface RunPlanResult {
  action: PlanAction;
  code: DecisionCode;
  /** One plain-language sentence describing the primary cause. */
  summary: string;
  /** Gates that stopped the run. Empty when the action is `ship`. */
  reasons: string[];
  /** Conditions that do not stop the run but deserve attention. */
  warnings: string[];
  /** Suggestions the policy makes but does not enforce. */
  recommendations: string[];
  review: ReviewStatus;
}
