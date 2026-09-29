/** Browser-safe exports (no node:fs / node:path). */
export type {
  SafetyLevel,
  SecretFinding,
  ShipgateConfig,
  ShipFlags,
  RunPlanInput,
  RunPlanResult,
  PlanAction,
  DemoScenario,
} from './types.js';

export {
  scanSecrets,
  scanTextForSecrets,
  isPlaceholderValue,
  isExemptFilename,
  type ScanFile,
} from './secret-scanner.js';

export {
  evaluatePolicy,
  parseLevel,
  DEFAULT_LEVEL,
  type PolicyContext,
  type PolicyVerdict,
} from './safety-policy.js';

export {
  buildCommitMessage,
  hasShipgateTrailer,
  SHIPPED_BY_TRAILER,
  type SubjectInput,
} from './commit-subject.js';

export { planRun } from './run-plan.js';

export { DEMO_SCENARIOS, defaultConfig } from './fixtures.js';
