import { scanSecrets, type ScanFile } from './secret-scanner.js';
import type { RemoteVisibility, ReviewInput, RunPlanInput, SafetyLevel, ShipFlags } from './types.js';

/** Facts a scenario fixes besides its staged files. */
export interface ScenarioFacts {
  configPresent: boolean;
  level: SafetyLevel;
  flags: ShipFlags;
  remote: RemoteVisibility;
  busyAgents: number;
  review: ReviewInput;
}

/** Example situation shared by the web simulator, `shipgate demo`, and tests. */
export interface DemoScenario {
  id: string;
  title: string;
  summary: string;
  /** Staged files with synthetic contents. Findings come from scanning them. */
  files: ScanFile[];
  facts: ScenarioFacts;
}

// Credential-shaped values are assembled at runtime so the repository holds no
// literal token shapes. They are synthetic and decode to "shipgate demo" text.
const SYNTHETIC_OPENAI_KEY = ['sk', 'proj', 'shipgateDemo0123456789abcdefABCDEF'].join('-');
const SYNTHETIC_JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzaGlwZ2F0ZS1kZW1vIn0', 'c2hpcGdhdGVEZW1vU2lnbmF0dXJl'].join('.');
const PLACEHOLDER_STRIPE_KEY = ['sk', 'test', 'x'.repeat(24)].join('_');

const baseFacts: ScenarioFacts = {
  configPresent: true,
  level: 'balanced',
  flags: {},
  remote: 'private',
  busyAgents: 0,
  review: { enabled: false },
};

const featureFiles: ScanFile[] = [
  { path: 'src/greeting.ts', content: 'export const greet = (name: string) => `Hello, ${name}`;\n' },
  {
    path: 'src/greeting.test.ts',
    content: "import { greet } from './greeting';\n\ntest('greets', () => expect(greet('Ada')).toBe('Hello, Ada'));\n",
  },
];

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'clean-change',
    title: 'Ordinary change',
    summary: 'A code change and its test, pushed to a private GitHub repository.',
    files: featureFiles,
    facts: baseFacts,
  },
  {
    id: 'credential-in-env',
    title: 'API key in a .env file',
    summary: 'A new .env file holds an API key.',
    files: [{ path: '.env', content: `OPENAI_API_KEY=${SYNTHETIC_OPENAI_KEY}\nDEBUG=true\n` }],
    facts: baseFacts,
  },
  {
    id: 'placeholder-template',
    title: 'Placeholders in .env.example',
    summary: '.env.example documents settings with placeholder values.',
    files: [
      {
        path: '.env.example',
        content: `OPENAI_API_KEY=your-api-key-here\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nSTRIPE_SECRET_KEY=${PLACEHOLDER_STRIPE_KEY}\n`,
      },
      { path: 'src/config.ts', content: 'export const apiKey = process.env.OPENAI_API_KEY;\n' },
    ],
    facts: baseFacts,
  },
  {
    id: 'medium-jwt',
    title: 'Sample JWT in a test fixture',
    summary: 'A test fixture contains a JWT, a medium-confidence pattern.',
    files: [{ path: 'test/fixtures/session.json', content: `{\n  "token": "${SYNTHETIC_JWT}"\n}\n` }],
    facts: baseFacts,
  },
  {
    id: 'public-repo',
    title: 'Public destination on strict',
    summary: 'A docs change to a public GitHub repository under strict.',
    files: [{ path: 'docs/usage.md', content: '# Usage\n\nRun `npm start`.\n' }],
    facts: { ...baseFacts, level: 'strict', remote: 'public' },
  },
  {
    id: 'busy-agent',
    title: 'Another agent is mid-turn',
    summary: 'Another agent registered a busy marker and is still working.',
    files: featureFiles,
    facts: { ...baseFacts, busyAgents: 1 },
  },
  {
    id: 'not-enabled',
    title: 'Repository not opted in',
    summary: 'The repository has changes but no enabled .shipgate.json.',
    files: featureFiles,
    facts: { ...baseFacts, configPresent: false },
  },
  {
    id: 'review-hold',
    title: 'External review holds the change',
    summary: 'External review is on and asks to hold a debug change.',
    files: [{ path: 'src/api.ts', content: 'export function handle(body: unknown) {\n  console.log("DEBUG body", body);\n}\n' }],
    facts: {
      ...baseFacts,
      review: { enabled: true, outcome: 'hold', detail: 'src/api.ts still logs request bodies for debugging.' },
    },
  },
];

export function findScenario(id: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((s) => s.id === id);
}

/** Build the planRun input for a scenario by scanning its files with the real scanner. */
export function scenarioInput(scenario: DemoScenario): RunPlanInput {
  return {
    ...scenario.facts,
    flags: { ...scenario.facts.flags },
    review: { ...scenario.facts.review },
    dirtyFiles: scenario.files.map((f) => f.path),
    findings: scanSecrets(scenario.files),
  };
}
