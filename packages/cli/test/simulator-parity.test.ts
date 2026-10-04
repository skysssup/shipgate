import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIOS, describeRemote, formatShipResult, markBusy, scenarioInput, simulateShip } from '@shipgate/core';
import { runShip } from '../src/commands/ship.js';
import { addOrigin, repo } from './helpers.js';

/**
 * The simulator's terminal preview comes from simulateShip. Each example is rebuilt
 * as a real repository and shipped with the CLI, and the two reports must match.
 */
describe('simulator terminal preview matches the CLI', () => {
  it.each(DEMO_SCENARIOS.map((s) => [s.id, s] as const))('%s', async (_id, scenario) => {
    const { facts } = scenario;
    const r = repo(facts.configPresent ? { level: facts.level, agentReview: facts.review.enabled } : null);
    if (facts.remote !== 'none') addOrigin(r);
    for (const file of scenario.files) r.write(file.path, file.content);
    const agents = Array.from({ length: facts.busyAgents }, () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' }));
    try {
      for (const agent of agents) markBusy(join(r.dir, '.git'), { pid: agent.pid!, label: 'agent' });
      const result = await runShip({
        cwd: r.dir,
        ...facts.flags,
        classifyRemote: () => ({ visibility: facts.remote, description: describeRemote(facts.remote, 'github.com/acme/app') }),
        review: async () => ({ outcome: facts.review.outcome ?? 'approve', detail: facts.review.detail }),
      });
      const simulated = simulateShip(scenarioInput(scenario), { branch: 'main', remoteName: 'github.com/acme/app', sha: result.sha ?? '' });
      expect(formatShipResult(result)).toEqual(formatShipResult(simulated));
      expect(result).toMatchObject({ outcome: simulated.outcome, action: simulated.action, exitCode: simulated.exitCode });
    } finally {
      for (const agent of agents) agent.kill();
    }
  });
});
