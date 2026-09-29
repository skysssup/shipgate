import { evaluatePolicy } from './safety-policy.js';
import type { RunPlanInput, RunPlanResult } from './types.js';

/**
 * Pure decision function: given repo status + policy inputs, decide ship/hold/block.
 * Used by the CLI and the web safety-matrix simulator.
 */
export function planRun(input: RunPlanInput): RunPlanResult {
  const reasons: string[] = [];

  if (!input.dirtyFiles.length) {
    return { action: 'hold', reasons: ['nothing to ship — working tree clean'] };
  }

  if (!input.configPresent) {
    return {
      action: 'block',
      reasons: ['shipgate is not enabled in this repo (run shipgate on)'],
    };
  }

  if (input.busyAgents > 0) {
    return {
      action: 'hold',
      reasons: [
        `${input.busyAgents} other agent(s) busy — deferring ship until clear`,
      ],
    };
  }

  const verdict = evaluatePolicy({
    level: input.level,
    findings: input.findings,
    isPublicRemote: input.isPublicRemote,
    flags: input.flags,
    configPresent: input.configPresent,
  });

  reasons.push(...verdict.warnReasons);

  if (!verdict.allow) {
    return {
      action: 'block',
      reasons: [...verdict.blockReasons, ...reasons],
    };
  }

  if (input.humanConfirmRequired && !input.humanConfirmed) {
    return {
      action: 'hold',
      reasons: [...reasons, 'awaiting human confirmation'],
    };
  }

  if (input.agentReviewEnabled && input.agentReviewHold) {
    return {
      action: 'hold',
      reasons: [...reasons, 'agent LLM review requested hold'],
    };
  }

  if (verdict.recommendHumanGate && input.level === 'strict' && !input.flags.confirm) {
    // Strict recommends human gate; without confirm flag we still ship if
    // policy otherwise allows — but surface the recommendation.
    reasons.push('strict recommends human confirm (pass --confirm to acknowledge)');
  }

  reasons.push(`policy ${input.level}: clear to ship`);
  return { action: 'ship', reasons };
}
