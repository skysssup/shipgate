import { describe, expect, it } from 'vitest';
import { planRun, type RunPlanInput } from '@shipgate/core';

describe('public remote fact vs acknowledgement', () => {
  it('keeps isPublicRemote true even when publicOk is set', () => {
    const input: RunPlanInput = {
      dirtyFiles: ['a.ts'],
      findings: [],
      level: 'balanced',
      flags: { publicOk: true },
      isPublicRemote: true,
      busyAgents: 0,
      configPresent: true,
      agentReviewEnabled: false,
    };
    const result = planRun(input);
    expect(result.action).toBe('ship');
    // Acknowledgement silences the public warning path in balanced (warn only).
    // Fact remains true in the input — simulator must not flip it to false.
    expect(input.isPublicRemote).toBe(true);
  });

  it('balanced without publicOk still ships but warns conceptually via policy', () => {
    const input: RunPlanInput = {
      dirtyFiles: ['a.ts'],
      findings: [],
      level: 'strict',
      flags: { publicOk: false },
      isPublicRemote: true,
      busyAgents: 0,
      configPresent: true,
      agentReviewEnabled: false,
    };
    const result = planRun(input);
    expect(result.action).toBe('block');
  });
});
