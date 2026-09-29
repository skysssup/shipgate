/**
 * Optional LLM review gate via OpenRouter (or OpenAI-compatible baseUrl).
 * Fail-open: missing key / timeout / bad reply → ship.
 */

export interface ReviewInput {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  diffSummary: string;
  promptText?: string;
  commitSubjects?: string[];
}

export interface ReviewResult {
  decision: 'ship' | 'hold';
  reason: string;
  failOpen: boolean;
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const TIMEOUT_MS = 15_000;

export async function agentReview(input: ReviewInput): Promise<ReviewResult> {
  if (!input.apiKey) {
    return {
      decision: 'ship',
      reason: 'no API key — fail-open',
      failOpen: true,
    };
  }

  const base = (input.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const model = input.model || DEFAULT_MODEL;
  const body = {
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You review agent coding turns before git push. Reply JSON only: {"decision":"ship"|"hold","reason":"..."}. Hold WIP, debug prints, half-done features. Ship otherwise.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          prompt: input.promptText?.slice(0, 2000) ?? null,
          recentSubjects: input.commitSubjects?.slice(0, 5) ?? [],
          diffSummary: input.diffSummary.slice(0, 8000),
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
        decision: 'ship',
        reason: `review HTTP ${res.status} — fail-open`,
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
        decision: 'ship',
        reason: 'unparseable review — fail-open',
        failOpen: true,
      };
    }
    return { ...parsed, failOpen: false };
  } catch (err) {
    return {
      decision: 'ship',
      reason: `review error: ${(err as Error).message} — fail-open`,
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
