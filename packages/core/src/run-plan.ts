import { evaluatePolicy, isSafetyLevel } from './safety-policy.js';
import type { RunPlanInput, RunPlanResult } from './types.js';

/**
 * Decide whether `shipgate ship` may commit and push. Pure: the CLI and the web
 * simulator call it with the same inputs. Gates apply in the order the CLI checks
 * them: opt-in, level, busy agents, changes, credential and destination policy,
 * then external review.
 */
export function planRun(input: RunPlanInput): RunPlanResult {
  const reviewEnabled = Boolean(input.review?.enabled);
  const stopped = (
    action: RunPlanResult['action'],
    code: RunPlanResult['code'],
    summary: string,
    reasons: string[],
  ): RunPlanResult => ({
    action,
    code,
    summary,
    reasons,
    warnings: [],
    recommendations: [],
    review: reviewEnabled ? 'not-reached' : 'off',
  });

  if (!input.configPresent) {
    return stopped('block', 'not-enabled', 'Shipgate is not enabled in this repository.', [
      'There is no enabled .shipgate.json; run `shipgate on` to opt in.',
    ]);
  }
  if (!isSafetyLevel(input.level)) {
    return stopped('block', 'invalid-level', 'The policy level is not valid.', [
      `Unknown policy level ${JSON.stringify(input.level)}; use strict, balanced, or yolo.`,
    ]);
  }
  if (input.busyAgents > 0) {
    const agents = input.busyAgents === 1 ? '1 other agent holds' : `${input.busyAgents} other agents hold`;
    return stopped('hold', 'busy', 'Another agent is still working here, so Shipgate waits.', [
      `${agents} a busy marker in this worktree.`,
    ]);
  }
  if (!input.dirtyFiles.length) {
    return stopped('noop', 'nothing-to-ship', 'There are no changes to commit.', []);
  }

  const verdict = evaluatePolicy({
    level: input.level,
    findings: input.findings,
    remote: input.remote,
    flags: input.flags,
    reviewEnabled,
  });
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
    };
  }

  const warnings = [...verdict.warnings];
  let review: RunPlanResult['review'] = 'off';
  if (reviewEnabled) {
    if (input.flags.message?.trim()) {
      review = 'skipped';
      warnings.push('External review was skipped because the commit message was given with -m/--message.');
    } else if (input.review.outcome === 'hold') {
      return {
        action: 'hold',
        code: 'review-hold',
        summary: 'External review asked to hold this change.',
        reasons: [`Reviewer: ${input.review.detail?.trim() || 'no reason given'}`],
        warnings,
        recommendations: [],
        review: 'held',
      };
    } else if (input.review.outcome === 'unavailable') {
      return {
        action: 'hold',
        code: 'review-unavailable',
        summary: 'External review could not run, and Shipgate does not ship without it.',
        reasons: [`Review unavailable: ${input.review.detail?.trim() || 'unknown error'}`],
        warnings,
        recommendations: [],
        review: 'unavailable',
      };
    } else {
      review = input.review.outcome === 'approve' ? 'approved' : 'pending';
    }
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
  };
}
