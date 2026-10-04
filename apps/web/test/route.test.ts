import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIOS } from '@shipgate/core/browser';
import { stateFromScenario, type SimState } from '../src/lib/model';
import { hasUnsharedEdits, parseHash, stateFromQuery, stateQuery, viewHref } from '../src/lib/route';
import { simReducer } from '../src/lib/state';

describe('hash routes', () => {
  it.each([
    ['', 'simulator', ''],
    ['#/', 'simulator', ''],
    ['#/?example=medium-jwt&level=yolo', 'simulator', 'example=medium-jwt&level=yolo'],
    ['#/rules', 'rules', ''],
    ['#/start', 'start', ''],
    ['#/unknown?x=1', 'simulator', 'x=1'],
  ])('%j', (hash, view, query) => {
    const route = parseHash(hash);
    expect(route.view).toBe(view);
    expect(route.params.toString()).toBe(query);
  });

  it('builds links', () => {
    expect(viewHref('rules')).toBe('#/rules');
    expect(viewHref('simulator', 'example=x')).toBe('#/?example=x');
  });
});

describe('share links', () => {
  it('store only what differs from the example', () => {
    expect(stateQuery(stateFromScenario('clean-change'))).toBe('example=clean-change');
    const changed: SimState = { ...stateFromScenario('clean-change'), level: 'yolo', remote: 'public', forceSecrets: true, busyAgents: 2 };
    expect(stateQuery(changed)).toBe('example=clean-change&level=yolo&busy=2&origin=public&force=1');
  });

  it.each(DEMO_SCENARIOS.map((s) => s.id))('round-trip every setting for %s', (id) => {
    const base = stateFromScenario(id);
    const variants: Array<Partial<SimState>> = [
      {},
      { level: 'strict', configPresent: !base.configPresent, hasChanges: false },
      { busyAgents: 3, remote: 'other-host', forceSecrets: true, publicOk: true, confirm: true, messageOn: true },
      { remote: 'none', review: 'unavailable' },
      { review: 'approve', level: 'yolo' },
    ];
    for (const patch of variants) {
      const state = simReducer(base, { type: 'set', patch });
      const fixed = patch.review ? simReducer(state, { type: 'review', choice: patch.review }) : state;
      const restored = stateFromQuery(new URLSearchParams(stateQuery(fixed)));
      expect(restored).toEqual(fixed);
    }
  });

  it('ignore unknown examples and invalid values', () => {
    expect(stateFromQuery(new URLSearchParams('example=nope'))).toBeUndefined();
    expect(stateFromQuery(new URLSearchParams(''))).toBeUndefined();
    const state = stateFromQuery(new URLSearchParams('example=clean-change&level=loose&busy=99&origin=mars&review=maybe&force=yes'));
    expect(state).toEqual(stateFromScenario('clean-change'));
  });

  it('report edits that a link would not carry', () => {
    const base = stateFromScenario('clean-change');
    expect(hasUnsharedEdits(base)).toBe(false);
    expect(hasUnsharedEdits({ ...base, level: 'strict', review: 'hold', reviewDetail: stateFromScenario('clean-change').reviewDetail })).toBe(true);
    expect(hasUnsharedEdits(simReducer(base, { type: 'review', choice: 'hold' }))).toBe(false);
    expect(hasUnsharedEdits(simReducer(base, { type: 'file-edit', path: 'src/greeting.ts', content: 'x' }))).toBe(true);
    expect(hasUnsharedEdits({ ...base, messageOn: true, message: 'custom' })).toBe(true);
    expect(hasUnsharedEdits({ ...base, messageOn: true })).toBe(false);
  });
});

describe('state changes', () => {
  const base = stateFromScenario('clean-change');

  it('adds files, replacing one with the same path, and selects the last one', () => {
    const next = simReducer({ ...base, hasChanges: false }, { type: 'file-add', files: [{ path: 'src/greeting.ts', content: 'new' }, { path: 'b.txt', content: '' }] });
    expect(next.files.map((f) => f.path)).toEqual(['src/greeting.test.ts', 'src/greeting.ts', 'b.txt']);
    expect(next.files[1].content).toBe('new');
    expect(next).toMatchObject({ activePath: 'b.txt', hasChanges: true });
  });

  it('selects a neighbour when the active file is removed', () => {
    const removed = simReducer(base, { type: 'file-remove', path: 'src/greeting.ts' });
    expect(removed.files.map((f) => f.path)).toEqual(['src/greeting.test.ts']);
    expect(removed.activePath).toBe('src/greeting.test.ts');
    expect(simReducer(removed, { type: 'file-remove', path: 'src/greeting.test.ts' }).activePath).toBeNull();
  });

  it('keeps the selection on a renamed file', () => {
    const renamed = simReducer(base, { type: 'file-rename', path: 'src/greeting.ts', to: '.env' });
    expect(renamed.files[0].path).toBe('.env');
    expect(renamed.activePath).toBe('.env');
  });

  it('resets the reviewer text when the review choice changes', () => {
    const held = simReducer(stateFromScenario('review-hold'), { type: 'set', patch: { reviewDetail: 'edited' } });
    expect(simReducer(held, { type: 'review', choice: 'unavailable' }).reviewDetail).toMatch(/no API key/);
    expect(simReducer(held, { type: 'review', choice: 'hold' }).reviewDetail).toBe('src/api.ts still logs request bodies for debugging.');
  });
});
