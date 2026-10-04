import { evaluatePolicy, isSafetyLevel } from './safety-policy.js';
import type { GateId, GateResult, RunPlanInput, RunPlanResult } from './types.js';

/** The checks planRun applies, in order. */
export const GATE_ORDER: readonly GateId[] = ['opt-in', 'busy', 'changes', 'credentials', 'destination', 'review'];

function completeGates(gates: GateResult[]): GateResult[] {
  return GATE_ORDER.map((gate) => gates.find((g) => g.gate === gate)
    ?? { gate, status: 'not-reached', detail: 'Not reached: an earlier check stopped the run.' });
}

/**
 * Decide whether `shipgate ship` may commit and push. Pure: the CLI and the web
 * simulator call it with the same inputs. Gates apply in the order the CLI checks
 * them: opt-in, level, busy agents, changes, credential and destination policy,
 * then external review.
 */
export function planRun(input: RunPlanInput): RunPlanResult {
  const reviewEnabled = Boolean(input.review?.enabled);
  const gates: GateResult[] = [];
  const stopped = (
    action: RunPlanResult['action'],
    code: RunPlanResult['code'],
    summary: string,
    reasons: string[],
    gate: GateResult,
  ): RunPlanResult => ({
    action,
    code,
    summary,
    reasons,
    warnings: [],
    recommendations: [],
    review: reviewEnabled ? 'not-reached' : 'off',
    gates: completeGates([...gates, gate]),
  });

  if (!input.configPresent) {
    return stopped('block', 'not-enabled', 'Shipgate is not enabled in this repository.', [
      'There is no enabled .shipgate.json; run `shipgate on` to opt in.',
    ], { gate: 'opt-in', status: 'block', detail: 'There is no enabled .shipgate.json.' });
  }
  if (!isSafetyLevel(input.level)) {
    const reason = `Unknown policy level ${JSON.stringify(input.level)}; use strict, balanced, or yolo.`;
    return stopped('block', 'invalid-level', 'The policy level is not valid.', [reason], {
      gate: 'opt-in',
      status: 'block',
      detail: reason,
    });
  }
  gates.push({ gate: 'opt-in', status: 'pass', detail: `.shipgate.json enables Shipgate at the ${input.level} level.` });

  if (input.busyAgents > 0) {
    const agents = input.busyAgents === 1 ? '1 other agent holds' : `${input.busyAgents} other agents hold`;
    const reason = `${agents} a busy marker in this worktree.`;
    return stopped('hold', 'busy', 'Another agent is still working here, so Shipgate waits.', [reason], {
      gate: 'busy',
      status: 'hold',
      detail: reason,
    });
  }
  gates.push({ gate: 'busy', status: 'pass', detail: 'No other agent is marked busy.' });

  if (!input.dirtyFiles.length) {
    return stopped('noop', 'nothing-to-ship', 'There are no changes to commit.', [], {
      gate: 'changes',
      status: 'noop',
      detail: 'There are no changes to commit.',
    });
  }
  const count = input.dirtyFiles.length;
  gates.push({ gate: 'changes', status: 'pass', detail: `${count} changed ${count === 1 ? 'file' : 'files'} to stage.` });

  const verdict = evaluatePolicy({
    level: input.level,
    findings: input.findings,
    remote: input.remote,
    flags: input.flags,
    reviewEnabled,
  });
  gates.push(...verdict.gates);
  if (!verdict.allow) {
    const destination = verdict.code === 'public-destination';
    return {
      action: 'block',
      code: destination ? 'public-destination' : 'credentials',
      summary: destination
        ? 'Strict policy blocks a public destination until you acknowledge it.'
        : 'Credential findings block this run.',
      reasons: verdict.blockReasons,
      warnings: verdict.warnings,
      recommendations: [],
      review: reviewEnabled ? 'not-reached' : 'off',
      gates: completeGates(gates),
    };
  }

  const warnings = [...verdict.warnings];
  let review: RunPlanResult['review'] = 'off';
  if (reviewEnabled) {
    if (input.flags.message?.trim()) {
      review = 'skipped';
      warnings.push('External review was skipped because the commit message was given with -m/--message.');
      gates.push({ gate: 'review', status: 'warn', detail: 'Skipped because the commit message was given with -m/--message.' });
    } else if (input.review.outcome === 'hold') {
      const reason = `Reviewer: ${input.review.detail?.trim() || 'no reason given'}`;
      return {
        action: 'hold',
        code: 'review-hold',
        summary: 'External review asked to hold this change.',
        reasons: [reason],
        warnings,
        recommendations: [],
        review: 'held',
        gates: completeGates([...gates, { gate: 'review', status: 'hold', detail: reason }]),
      };
    } else if (input.review.outcome === 'unavailable') {
      const reason = `Review unavailable: ${input.review.detail?.trim() || 'unknown error'}`;
      return {
        action: 'hold',
        code: 'review-unavailable',
        summary: 'External review could not run, and Shipgate does not ship without it.',
        reasons: [reason],
        warnings,
        recommendations: [],
        review: 'unavailable',
        gates: completeGates([...gates, { gate: 'review', status: 'hold', detail: reason }]),
      };
    } else if (input.review.outcome === 'approve') {
      review = 'approved';
      gates.push({ gate: 'review', status: 'pass', detail: 'The reviewer approved the change.' });
    } else {
      review = 'pending';
      gates.push({ gate: 'review', status: 'pending', detail: 'The configured reviewer runs before the commit.' });
    }
  } else {
    gates.push({ gate: 'review', status: 'skip', detail: 'External review is off.' });
  }

  const summary = review === 'pending'
    ? `The ${input.level} policy allows this run; external review decides before the commit.`
    : `The ${input.level} policy allows this run${warnings.length ? ' with warnings' : ''}.`;
  return {
    action: 'ship',
    code: 'clear',
    summary,
    reasons: [],
    warnings,
    recommendations: verdict.recommendations,
    review,
    gates,
  };
}
