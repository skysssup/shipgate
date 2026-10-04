import { redactSecretsInText, type ReviewOutcome } from '@shipgate/core';

/**
 * Optional external review through an OpenAI-compatible chat completions endpoint
 * (OpenRouter by default). Enabled with `shipgate on --agent`. Every failure is
 * reported as `unavailable`, which holds the ship (fail closed).
 */

const DEFAULT_REVIEW_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_REVIEW_BASE_URL = 'https://openrouter.ai/api/v1';
export const REVIEW_DIFF_LIMIT = 12_000;
const REVIEW_PROMPT_LIMIT = 2_000;
const REVIEW_TIMEOUT_MS = 15_000;

export interface ReviewRequest {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  changedFiles: string[];
  /** Staged diff. Files listed in `omittedFiles` must already be excluded from it. */
  diff: string;
  /** Paths whose content was withheld, such as flagged .env files. */
  omittedFiles: string[];
  prompt?: string;
  timeoutMs?: number;
}

export interface ReviewResponse {
  outcome: ReviewOutcome;
  detail: string;
}

const SYSTEM_PROMPT =
  'You review a staged Git change before an automated commit and push. The diff has credential-shaped values ' +
  'replaced with [REDACTED]. Reply with JSON only: {"decision":"ship"|"hold","reason":"<one sentence>"}. ' +
  'Hold work in progress, leftover debug output, or half-finished changes. Otherwise ship.';

/** Exactly what is sent to the endpoint, after redaction and truncation. */
export function buildReviewMessages(req: ReviewRequest): Array<{ role: 'system' | 'user'; content: string }> {
  const diff = redactSecretsInText(req.diff);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        changedFiles: req.changedFiles.map(redactSecretsInText),
        omittedFiles: req.omittedFiles,
        prompt: req.prompt ? redactSecretsInText(req.prompt).slice(0, REVIEW_PROMPT_LIMIT) : null,
        diff: diff.slice(0, REVIEW_DIFF_LIMIT),
        diffTruncated: diff.length > REVIEW_DIFF_LIMIT,
      }),
    },
  ];
}

function oneLine(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export async function requestReview(req: ReviewRequest): Promise<ReviewResponse> {
  const unavailable = (detail: string): ReviewResponse => ({ outcome: 'unavailable', detail });
  if (!req.apiKey) return unavailable('no API key (set OPENROUTER_API_KEY or run shipgate on --key)');

  const base = (req.baseUrl || DEFAULT_REVIEW_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = req.timeoutMs ?? REVIEW_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${req.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: req.model || DEFAULT_REVIEW_MODEL, temperature: 0, messages: buildReviewMessages(req) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = (error as Error).name;
    if (name === 'TimeoutError' || name === 'AbortError') return unavailable(`no response within ${timeoutMs / 1000} s`);
    return unavailable(`request failed (${oneLine((error as Error).message, 120)})`);
  }
  if (!res.ok) return unavailable(`HTTP ${res.status} from ${new URL(base).host}`);

  let data: unknown;
  try {
    data = JSON.parse(await res.text());
  } catch {
    return unavailable('the response was not valid JSON');
  }
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return unavailable('the response had no message content');

  const match = content.match(/\{[\s\S]*\}/);
  let reply: { decision?: unknown; reason?: unknown } | null = null;
  try {
    reply = match ? (JSON.parse(match[0]) as { decision?: unknown; reason?: unknown }) : null;
  } catch {
    reply = null;
  }
  if (reply?.decision !== 'ship' && reply?.decision !== 'hold') {
    return unavailable('the reviewer did not answer with {"decision":"ship"|"hold"}');
  }
  const reason = typeof reply.reason === 'string' && reply.reason.trim() ? oneLine(reply.reason) : `reviewer chose ${reply.decision}`;
  return { outcome: reply.decision === 'ship' ? 'approve' : 'hold', detail: reason };
}
