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
  redactSecretsInText,
  isPlaceholderValue,
  isExemptFilename,
  type ScanFile,
} from './secret-scanner.js';

export {
  evaluatePolicy,
  parseLevel,
  assertSafetyLevel,
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

export {
  markBusy,
  clearBusy,
  sweepBusy,
  shouldDeferShip,
  isPidAlive,
  type BusyMarker,
  type BusySnapshot,
} from './busy-registry.js';

export { planRun } from './run-plan.js';

export { DEMO_SCENARIOS, defaultConfig } from './fixtures.js';
