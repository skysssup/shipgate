import { DEMO_SCENARIOS, SAFETY_LEVELS, type RemoteVisibility, type SafetyLevel } from '@shipgate/core/browser';
import { MAX_BUSY_AGENTS, defaultReviewDetail, stateFromScenario, type ReviewChoice, type SimState } from './model';

export type View = 'simulator' | 'rules' | 'start';

const VIEW_PATHS: Record<View, string> = { simulator: '/', rules: '/rules', start: '/start' };
const REMOTES: RemoteVisibility[] = ['private', 'public', 'unknown', 'other-host', 'none'];
const REVIEWS: ReviewChoice[] = ['off', 'approve', 'hold', 'unavailable'];

export function parseHash(hash: string): { view: View; params: URLSearchParams } {
  const raw = hash.replace(/^#/, '');
  const split = raw.indexOf('?');
  const path = split === -1 ? raw : raw.slice(0, split);
  const view = (Object.keys(VIEW_PATHS) as View[]).find((v) => VIEW_PATHS[v] === path) ?? 'simulator';
  return { view, params: new URLSearchParams(split === -1 ? '' : raw.slice(split + 1)) };
}

export function viewHref(view: View, query = ''): string {
  return `#${VIEW_PATHS[view]}${query ? `?${query}` : ''}`;
}

/**
 * Settings that differ from the example, as a query string. File contents, the -m
 * text, and the reviewer text stay out of links.
 */
export function stateQuery(state: SimState): string {
  const base = stateFromScenario(state.scenarioId);
  const params = new URLSearchParams({ example: state.scenarioId });
  const flag = (key: string, value: boolean, original: boolean) => value !== original && params.set(key, value ? '1' : '0');
  if (state.level !== base.level) params.set('level', state.level);
  flag('enabled', state.configPresent, base.configPresent);
  flag('changes', state.hasChanges, base.hasChanges);
  if (state.busyAgents !== base.busyAgents) params.set('busy', String(state.busyAgents));
  if (state.remote !== base.remote) params.set('origin', state.remote);
  flag('force', state.forceSecrets, base.forceSecrets);
  flag('public-ok', state.publicOk, base.publicOk);
  flag('confirm', state.confirm, base.confirm);
  flag('m', state.messageOn, base.messageOn);
  if (state.review !== base.review) params.set('review', state.review);
  return params.toString();
}

/** The state a link describes, or undefined when it names no known example. */
export function stateFromQuery(params: URLSearchParams): SimState | undefined {
  const id = params.get('example');
  if (!id || !DEMO_SCENARIOS.some((s) => s.id === id)) return undefined;
  const state = stateFromScenario(id);
  const bool = (key: string, fallback: boolean) => (params.get(key) === '1' ? true : params.get(key) === '0' ? false : fallback);
  const level = params.get('level');
  if (level && (SAFETY_LEVELS as readonly string[]).includes(level)) state.level = level as SafetyLevel;
  state.configPresent = bool('enabled', state.configPresent);
  state.hasChanges = bool('changes', state.hasChanges);
  const busy = Number(params.get('busy'));
  if (params.has('busy') && Number.isInteger(busy) && busy >= 0 && busy <= MAX_BUSY_AGENTS) state.busyAgents = busy;
  const origin = params.get('origin') as RemoteVisibility | null;
  if (origin && REMOTES.includes(origin)) state.remote = origin;
  state.forceSecrets = bool('force', state.forceSecrets);
  state.publicOk = bool('public-ok', state.publicOk);
  state.confirm = bool('confirm', state.confirm);
  state.messageOn = bool('m', state.messageOn);
  const review = params.get('review') as ReviewChoice | null;
  if (review && REVIEWS.includes(review) && review !== state.review) {
    state.review = review;
    state.reviewDetail = defaultReviewDetail(review, id);
  }
  return state;
}

/** True when a link to this state would leave out edited text. */
export function hasUnsharedEdits(state: SimState): boolean {
  const base = stateFromScenario(state.scenarioId);
  return JSON.stringify(state.files) !== JSON.stringify(base.files)
    || (state.messageOn && state.message !== base.message)
    || (state.review === base.review && state.reviewDetail !== base.reviewDetail)
    || (state.review !== base.review && state.reviewDetail !== defaultReviewDetail(state.review, state.scenarioId));
}
