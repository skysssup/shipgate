/** Exports that do not depend on Node.js modules, for the web simulator. */
export type {
  SafetyLevel,
  SecretFinding,
  ShipgateConfig,
  ShipFlags,
  RemoteVisibility,
  ReviewOutcome,
  ReviewInput,
  RunPlanInput,
  RunPlanResult,
  PlanAction,
  DecisionCode,
  ReviewStatus,
  GateId,
  GateStatus,
  GateResult,
} from './types.js';
export { SAFETY_LEVELS } from './types.js';

export {
  scanSecrets,
  scanTextForSecrets,
  redactSecretsInText,
  isPlaceholderValue,
  isExemptFilename,
  SECRET_RULE_IDS,
  SECRET_RULES,
  locateSecrets,
  type ScanFile,
  type SecretRule,
  type SecretMatch,
} from './secret-scanner.js';

export {
  evaluatePolicy,
  parseLevel,
  isSafetyLevel,
  describeFindings,
  DEFAULT_LEVEL,
  type PolicyContext,
  type PolicyVerdict,
} from './safety-policy.js';

export {
  buildCommitMessage,
  hasShipgateTrailer,
  SHIPPED_BY_TRAILER,
  type SubjectInput,
  type MessageSource,
} from './commit-subject.js';

export { planRun, GATE_ORDER } from './run-plan.js';

export {
  SHIP_OUTCOMES,
  formatShipResult,
  detailLine,
  findingLine,
  describeRemote,
  nextStep,
  shippedSummary,
  simulateShip,
  type ShipOutcome,
  type ShipResult,
  type StagingState,
  type ShipPlace,
} from './ship-report.js';

export {
  DEMO_SCENARIOS,
  findScenario,
  scenarioInput,
  RULE_SAMPLES,
  type DemoScenario,
  type ScenarioFacts,
} from './fixtures.js';
