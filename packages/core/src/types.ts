/** Safety levels controlling how aggressive Shipgate is about shipping. */
export type SafetyLevel = 'strict' | 'balanced' | 'yolo';

/** Structured secret finding from SecretScanner. */
export interface SecretFinding {
  path: string;
  ruleId: string;
  excerpt: string;
  confidence: 'high' | 'medium';
}

/** Per-repo Shipgate configuration written by `shipgate on`. */
export interface ShipgateConfig {
  enabled: boolean;
  level: SafetyLevel;
  agentReview: boolean;
  publicOk: boolean;
  account?: string;
  model?: string;
}

/** Flags that alter a single ship attempt. */
export interface ShipFlags {
  forceSecrets?: boolean;
  publicOk?: boolean;
  message?: string;
  confirm?: boolean;
  humanConfirm?: boolean;
}

/** Inputs to the pure RunPlan decision function. */
export interface RunPlanInput {
  dirtyFiles: string[];
  findings: SecretFinding[];
  level: SafetyLevel;
  flags: ShipFlags;
  isPublicRemote: boolean;
  busyAgents: number;
  configPresent: boolean;
  agentReviewEnabled: boolean;
  agentReviewHold?: boolean;
  humanConfirmRequired?: boolean;
  humanConfirmed?: boolean;
}

export type PlanAction = 'ship' | 'hold' | 'block';

/** Result of evaluating whether a ship should proceed. */
export interface RunPlanResult {
  action: PlanAction;
  reasons: string[];
}

/** Demo scenario for the web simulator / fixtures. */
export interface DemoScenario {
  id: string;
  label: string;
  description: string;
  input: RunPlanInput;
}
