/**
 * Optional external model gate via OpenRouter (or OpenAI-compatible baseUrl).
 *
 * When agent review is enabled, this is fail-closed: missing key / HTTP error /
 * unparseable output holds the ship. A redacted staged diff is sent (not merely
 * filenames). Sending data off-machine is an explicit disclosure — enable only
 * with consent via `shipgate on --agent`.
 */

import { redactSecretsInText } from '@shipgate/core';

export interface ReviewInput {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Filename list (always included for context). */
  diffSummary: string;
  /** Staged unified diff; secrets are redacted before send. */
  redactedDiff?: string;
  promptText?: string;
  commitSubjects?: string[];
  /** When true (default for enabled agent review), missing key / errors hold. */
  requireKey?: boolean;
}

export interface ReviewResult {
  decision: 'ship' | 'hold';
  reason: string;
  /** Historical name: true means the gate could not run (treated as hold when requireKey). */
  failOpen: boolean;
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const TIMEOUT_MS = 15_000;

export async function agentReview(input: ReviewInput): Promise<ReviewResult> {
  const failClosed = input.requireKey !== false;

  if (!input.apiKey) {
    return {
      decision: 'hold',
      reason: 'no API key — agent review fail-closed',
      failOpen: true,
    };
  }

  const base = (input.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const model = input.model || DEFAULT_MODEL;
  const diff = redactSecretsInText(
    (input.redactedDiff || input.diffSummary || '').slice(0, 12000),
  );
  const body = {
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You review agent coding turns before git push. You receive a redacted staged diff. Reply JSON only: {"decision":"ship"|"hold","reason":"..."}. Hold WIP, debug prints, half-done features. Ship otherwise.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          disclosure:
            'This payload is sent to an external model endpoint. Secrets are pattern-redacted but redaction is not guaranteed.',
          prompt: input.promptText?.slice(0, 2000) ?? null,
          recentSubjects: input.commitSubjects?.slice(0, 5) ?? [],
          changedFiles: input.diffSummary.slice(0, 2000),
          redactedDiff: diff,
        }),
      },
    ],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        decision: 'hold',
        reason: `review HTTP ${res.status} — fail-closed`,
        failOpen: true,
      };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    const parsed = parseDecision(text);
    if (!parsed) {
      return {
        decision: 'hold',
        reason: 'unparseable review — fail-closed',
        failOpen: true,
      };
    }
    return { ...parsed, failOpen: false };
  } catch (err) {
    return {
      decision: failClosed ? 'hold' : 'ship',
      reason: `review error: ${(err as Error).message} — fail-closed`,
      failOpen: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseDecision(
  text: string,
): { decision: 'ship' | 'hold'; reason: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { decision?: string; reason?: string };
    if (obj.decision === 'ship' || obj.decision === 'hold') {
      return { decision: obj.decision, reason: obj.reason || obj.decision };
    }
  } catch {
    return null;
  }
  return null;
}
