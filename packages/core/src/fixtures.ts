import type { DemoScenario, ShipgateConfig } from './types.js';

export function defaultConfig(
  overrides: Partial<ShipgateConfig> = {},
): ShipgateConfig {
  return {
    enabled: true,
    level: 'balanced',
    agentReview: false,
    publicOk: false,
    ...overrides,
  };
}

/** Demo scenarios for the web simulator and CLI `demo` output. */
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'secret-env',
    label: 'Secret in .env',
    description: 'Credential-shaped fixture in .env — blocked unless explicitly overridden.',
    input: {
      dirtyFiles: ['.env'],
      findings: [
        {
          path: '.env',
          ruleId: 'openai-key',
          excerpt: 'sk-live…abcd',
          confidence: 'high',
        },
        {
          path: '.env',
          ruleId: 'dotenv-file',
          excerpt: '.env',
          confidence: 'high',
        },
      ],
      level: 'balanced',
      flags: {},
      isPublicRemote: false,
      busyAgents: 0,
      configPresent: true,
      agentReviewEnabled: false,
    },
  },
  {
    id: 'placeholder-example',
    label: 'Placeholder in .env.example',
    description: 'Template file with your-api-key-here — should ship cleanly.',
    input: {
      dirtyFiles: ['.env.example', 'src/app.ts'],
      findings: [],
      level: 'balanced',
      flags: {},
      isPublicRemote: false,
      busyAgents: 0,
      configPresent: true,
      agentReviewEnabled: false,
    },
  },
  {
    id: 'public-repo',
    label: 'Public remote',
    description: 'Clean diff on a public GitHub remote — strict blocks, balanced warns.',
    input: {
      dirtyFiles: ['README.md'],
      findings: [],
      level: 'strict',
      flags: {},
      isPublicRemote: true,
      busyAgents: 0,
      configPresent: true,
      agentReviewEnabled: false,
    },
  },
  {
    id: 'busy-agent',
    label: 'Busy agent',
    description: 'Another live agent mid-turn — ship deferred (hold).',
    input: {
      dirtyFiles: ['src/feature.ts'],
      findings: [],
      level: 'yolo',
      flags: {},
      isPublicRemote: false,
      busyAgents: 1,
      configPresent: true,
      agentReviewEnabled: false,
    },
  },
  {
    id: 'clean-feature',
    label: 'Clean feature',
    description: 'Ordinary feature diff, private remote — ship.',
    input: {
      dirtyFiles: ['src/feature.ts', 'src/feature.test.ts'],
      findings: [],
      level: 'balanced',
      flags: {},
      isPublicRemote: false,
      busyAgents: 0,
      configPresent: true,
      agentReviewEnabled: false,
    },
  },
];
