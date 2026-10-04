import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIOS, planRun, scenarioInput } from '@shipgate/core/browser';
import { cliCommands, consequence, DEFAULT_SCENARIO_ID, stateFromScenario, toRunPlanInput, type SimState } from '../src/model';

describe('simulator input construction', () => {
  it.each(DEMO_SCENARIOS.map((s) => s.id))('reproduces the shared fixture input for %s', (id) => {
    const scenario = DEMO_SCENARIOS.find((s) => s.id === id)!;
    const expected = scenarioInput(scenario);
    const built = toRunPlanInput(stateFromScenario(id));
    expect(planRun(built)).toEqual(planRun(expected));
    expect(built.findings).toEqual(expected.findings);
    expect(built.remote).toBe(expected.remote);
  });

  it('keeps the destination fact when the public destination is acknowledged', () => {
    const state: SimState = { ...stateFromScenario('public-repo'), publicOk: true };
    const input = toRunPlanInput(state);
    expect(input.remote).toBe('public');
    expect(input.flags.publicOk).toBe(true);
    expect(planRun(input).action).toBe('ship');
    expect(planRun({ ...input, flags: { ...input.flags, publicOk: false } }).action).toBe('block');
  });

  it('clears staged files and findings when the repository has no changes', () => {
    const input = toRunPlanInput({ ...stateFromScenario('credential-in-env'), hasChanges: false });
    expect(input.dirtyFiles).toEqual([]);
    expect(input.findings).toEqual([]);
    expect(planRun(input).code).toBe('nothing-to-ship');
  });

  it('passes an explicit message so review is skipped, as in the CLI', () => {
    const state: SimState = { ...stateFromScenario('review-hold'), explicitMessage: true };
    const result = planRun(toRunPlanInput(state));
    expect(result).toMatchObject({ action: 'ship', review: 'skipped' });
  });

  it('starts from an example that ships, with no hidden overrides', () => {
    const state = stateFromScenario(DEFAULT_SCENARIO_ID);
    expect(state).toMatchObject({ forceSecrets: false, publicOk: false, confirm: false, explicitMessage: false, review: 'off' });
    expect(planRun(toRunPlanInput(state)).action).toBe('ship');
  });
});

describe('consequences and commands', () => {
  it('never claims a push succeeded and explains local-only commits', () => {
    const pushing = toRunPlanInput(stateFromScenario('clean-change'));
    const steps = consequence(planRun(pushing), pushing).steps.join(' ');
    expect(steps).toMatch(/If the push still fails, keep the commit in the local branch and exit with status 1/);
    const local = { ...pushing, remote: 'none' as const };
    expect(consequence(planRun(local), local).steps).toContain('Keep the commit local: there is no origin remote.');
  });

  it('gives exit status 1 only for failures that need attention', () => {
    const unavailable = toRunPlanInput({ ...stateFromScenario('clean-change'), review: 'unavailable' });
    expect(consequence(planRun(unavailable), unavailable).exitStatus).toBe(1);
    const blocked = toRunPlanInput(stateFromScenario('credential-in-env'));
    expect(consequence(planRun(blocked), blocked)).toMatchObject({ exitStatus: 0, next: expect.stringContaining('--force-secrets') });
  });

  it('turns the selected settings into CLI commands', () => {
    const state: SimState = { ...stateFromScenario('public-repo'), publicOk: true, confirm: true, review: 'approve', explicitMessage: true };
    expect(cliCommands(state)).toEqual(['shipgate on --level strict --agent', 'shipgate ship -m "Describe the change" --public-ok --confirm']);
  });
});
