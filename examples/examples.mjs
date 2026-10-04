// Example catalog: each example is a shell script run against the built CLI in a new
// directory. `node examples/examples.mjs --write` regenerates examples/README.md from
// real runs; `--check` fails when the README no longer matches. The CLI test suite
// imports runExample() and asserts each example's expected outcome.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(root, 'packages', 'cli', 'dist', 'bin.js');
export const README_PATH = join(root, 'examples', 'README.md');

/** Setup shared by most examples: a repository with a local bare remote and Shipgate on. */
const PRELUDE = `git init --quiet --bare ../origin.git
git init --quiet --initial-branch=main
git remote add origin ../origin.git
git commit --quiet --allow-empty -m "Initial commit"
git push --quiet --set-upstream origin main
echo .shipgate.json >> .git/info/exclude
shipgate on`;

/**
 * Lines starting with "$ " are shown with their output; other lines are setup and run
 * silently. `expect` lists the exit status and a pattern for each shown command.
 */
export const EXAMPLES = [
  {
    id: 'ordinary-change',
    title: 'An ordinary change is committed and pushed',
    facts: ['Policy: balanced (the default).', 'One new source file without credentials.', 'origin accepts pushes.'],
    script: `printf 'export const greet = (name) => "Hello, " + name;\\n' > greet.js
$ shipgate ship -m "Add greet helper"
$ git log --oneline -1 origin/main`,
    expect: [[0, /^shipgate: SHIPPED — Pushed <sha> to origin\/main\.$/m], [0, /<sha> Add greet helper/]],
    next: 'Nothing. The commit is on origin/main and carries a `Shipped-by: shipgate` trailer, so `shipgate undo` can remove it.',
  },
  {
    id: 'credential-blocked',
    title: 'A credential in a .env file blocks the run',
    facts: ['Policy: balanced.', 'A new `.env` file holds a synthetic OpenAI-style key.'],
    script: `key="sk-proj-$(printf 'demo%.0s' 1 2 3 4 5 6)"
echo "OPENAI_API_KEY=$key" > .env
$ shipgate ship
$ git status --short`,
    expect: [[0, /^shipgate: BLOCKED — Credential findings block this run\.$/m], [0, /^\?\? \.env$/m]],
    next: 'Remove the key and keep `.env` out of Git (add it to `.gitignore`). Use `--force-secrets` only for a value you know is not a real credential.',
  },
  {
    id: 'placeholder-template',
    title: 'Placeholder values in a template are accepted',
    facts: ['Policy: balanced.', '`.env.example` documents settings with placeholder values.', 'Template contents are scanned; the template filename itself is not a finding.'],
    script: `printf 'OPENAI_API_KEY=your-api-key-here\\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\\n' > .env.example
$ shipgate ship -m "Document required settings"`,
    expect: [[0, /^shipgate: SHIPPED — Pushed <sha> to origin\/main\.$/m]],
    next: 'Nothing. A real key in the same file would still be a finding.',
  },
  {
    id: 'medium-finding-by-level',
    title: 'A medium-confidence finding: blocked by balanced, allowed by yolo',
    facts: ['A test fixture contains a JWT, which is a medium-confidence pattern.', 'The first run uses balanced; the second uses yolo.'],
    script: `jwt_header=eyJhbGciOiJIUzI1NiJ9
mkdir -p test/fixtures
echo "{\\"token\\": \\"$jwt_header.eyJzdWIiOiJkZW1vLXVzZXIifQ.ZGVtby1zaWduYXR1cmU\\"}" > test/fixtures/session.json
$ shipgate ship -m "Add session fixture"
shipgate on --level yolo
$ shipgate ship -m "Add session fixture"`,
    expect: [
      [0, /^shipgate: BLOCKED — Credential findings block this run\.$/m],
      [0, /^shipgate: SHIPPED — Pushed <sha> to origin\/main\.\n.*warning  1 medium-confidence credential finding allowed by yolo\./ms],
    ],
    next: 'Keep balanced or strict for repositories with real secrets. Under yolo, read the warning: the token was published.',
  },
  {
    id: 'public-destination',
    title: 'strict blocks a public GitHub destination until acknowledged',
    facts: [
      'Policy: strict.',
      'origin is a github.com URL. This output was generated without GitHub CLI credentials, so the visibility check could not run and the repository is treated as public. With `gh` signed in, Shipgate reports "public GitHub repository" instead; both block.',
    ],
    script: `git remote set-url origin https://github.com/octocat/Hello-World.git
shipgate on --level strict
echo "notes" > NOTES.md
$ shipgate ship -m "Add notes"`,
    expect: [[0, /^shipgate: BLOCKED — Strict policy blocks a public destination until you acknowledge it\.$/m]],
    next: 'If publishing there is intended, run `shipgate ship --public-ok -m "Add notes"` (or `shipgate on --public-ok` to remember it). The flag records your acknowledgement; it does not change the destination.',
  },
  {
    id: 'busy-agent',
    title: 'Work is deferred while another agent is busy',
    facts: [
      'A second agent process registered a busy marker in this worktree, the way `markBusy()` from `@shipgate/core` does.',
      'The first run holds; after that process exits, its marker is stale and the next run ships.',
    ],
    script: `sleep 300 & agent=$!
mkdir -p "$(git rev-parse --absolute-git-dir)/shipgate-busy"
printf '{"pid":%s,"startedAt":0,"label":"second agent","nonce":"example"}\\n' "$agent" > "$(git rev-parse --absolute-git-dir)/shipgate-busy/agent-$agent.json"
echo "change" > feature.txt
$ shipgate ship -m "Add feature"
kill "$agent"; wait "$agent" 2>/dev/null || true
$ shipgate ship -m "Add feature"`,
    expect: [
      [0, /^shipgate: HELD — Another agent is still working here, so Shipgate waits\.$/m],
      [0, /^shipgate: SHIPPED — Pushed <sha> to origin\/main\.$/m],
    ],
    next: 'Nothing. Stop hooks run at the end of each turn, so the held change ships on a later turn.',
  },
  {
    id: 'not-enabled',
    title: 'A repository without .shipgate.json is left alone',
    facts: ['No `shipgate on` in this repository.'],
    prelude: false,
    script: `git init --quiet --initial-branch=main
git commit --quiet --allow-empty -m "Initial commit"
echo "change" > notes.txt
$ shipgate ship
$ git status --short`,
    expect: [[0, /^shipgate: NOT ENABLED — Shipgate is not enabled in this repository\.$/m], [0, /^\?\? notes\.txt$/m]],
    next: 'Run `shipgate on` to opt in. Installed hooks run in every repository but act only where Shipgate is enabled.',
  },
  {
    id: 'review-hold',
    title: 'External review holds a change',
    facts: [
      'External review is on (`shipgate on --agent`).',
      'A local stand-in for the review endpoint answers "hold", so the example needs no API account. `SHIPGATE_HOME` points Shipgate at a scratch settings directory.',
    ],
    script: `node -e "require('http').createServer((q, s) => s.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: 'hold', reason: 'api.js logs request bodies' }) } }] }))).listen(47321)" & reviewer=$!
sleep 1
mkdir -p "$SHIPGATE_HOME" && echo '{"baseUrl": "http://127.0.0.1:47321"}' > "$SHIPGATE_HOME/config.json"
shipgate on --agent
echo 'export const handle = (request) => console.log("DEBUG", request.body);' > api.js
$ OPENROUTER_API_KEY=example shipgate ship --prompt "Log request bodies"
kill "$reviewer"`,
    expect: [[0, /^shipgate: HELD — External review asked to hold this change\.\n.*reason   Reviewer: api\.js logs request bodies/ms]],
    next: 'Fix what the reviewer raised and run `shipgate ship` again. Review sends file paths, the redacted staged diff, and the `--prompt` text to the endpoint; see the README before enabling it.',
  },
  {
    id: 'push-failed',
    title: 'A failed push keeps the local commit',
    facts: ['origin rejects every push (a server-side hook stands in for branch protection).'],
    script: `printf '#!/bin/sh\\necho "pushes to main are disabled" >&2\\nexit 1\\n' > ../origin.git/hooks/pre-receive
chmod +x ../origin.git/hooks/pre-receive
echo "change" > feature.txt
$ shipgate ship -m "Add feature"
$ git log --oneline -1
rm ../origin.git/hooks/pre-receive
$ git push --quiet origin main && git log --oneline -1 origin/main`,
    expect: [
      [1, /^shipgate: COMMITTED, NOT PUSHED — Committed <sha> on main, but the push to origin failed\.$/m],
      [0, /^<sha> Add feature$/m],
      [0, /^<sha> Add feature$/m],
    ],
    next: 'Fix the cause and push with `git push`, or run `shipgate undo` to remove the commit while keeping its changes in the working tree. Exit status 1 tells scripts and hooks that the push did not happen.',
  },
];

/** Throws unless each shown command produced the expected exit status and output. */
export function checkExpectations(example, shown) {
  if (shown.length !== example.expect.length) throw new Error(`example ${example.id} showed ${shown.length} commands, expected ${example.expect.length}`);
  example.expect.forEach(([exitCode, pattern], i) => {
    if (shown[i].exitCode !== exitCode || !pattern.test(shown[i].output)) {
      throw new Error(`example ${example.id}, "${shown[i].command}": expected exit ${exitCode} and ${pattern}, got exit ${shown[i].exitCode}:\n${shown[i].output}`);
    }
  });
}

/** Run one example in a new directory. Returns each shown command with its normalized output. */
export function runExample(example) {
  const work = realpathSync.native(mkdtempSync(join(tmpdir(), 'shipgate-example-')));
  try {
    const dir = join(work, 'demo');
    const bin = join(work, 'bin');
    mkdirSync(dir);
    mkdirSync(bin);
    writeFileSync(join(bin, 'shipgate'), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`);
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "gh: not authenticated (example environment)" >&2\nexit 4\n');
    chmodSync(join(bin, 'shipgate'), 0o755);
    chmodSync(join(bin, 'gh'), 0o755);
    const gitconfig = join(work, 'gitconfig');
    writeFileSync(gitconfig, '[user]\n\tname = Example\n\temail = example@example.invalid\n[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n');
    const lines = [...(example.prelude === false ? [] : PRELUDE.split('\n')), ...example.script.split('\n')];
    const script = ['set -u', ...lines.map((line, i) => line.startsWith('$ ')
      ? `printf '\\n@@shown %s\\n' ${i}; { ${line.slice(2)}; } 2>&1; printf '\\n@@exit %s\\n' $?`
      : `{ ${line}; } >/dev/null 2>&1 || { echo "setup failed: line ${i}: ${line.replace(/[`$"\\]/g, '')}" >&2; exit 99; }`)].join('\n');
    const result = spawnSync('bash', ['-c', script], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GIT_CONFIG_GLOBAL: gitconfig,
        GIT_CONFIG_NOSYSTEM: '1',
        SHIPGATE_HOME: join(work, 'shipgate-home'),
        SHIPGATE_CLAUDE_SETTINGS: join(work, 'claude', 'settings.json'),
        SHIPGATE_CURSOR_HOOKS: join(work, 'cursor', 'hooks.json'),
        OPENROUTER_API_KEY: '',
      },
      timeout: 60_000,
    });
    if (result.status !== 0) throw new Error(`example ${example.id} failed: ${result.stderr}${result.stdout}`);
    const shas = new Set(execFileSync('git', ['-C', dir, 'rev-list', '--all'], { encoding: 'utf8' }).split('\n').filter(Boolean));
    const normalize = (text) => text
      .replace(/\b[0-9a-f]{7,40}\b/g, (sha) => ([...shas].some((full) => full.startsWith(sha)) ? '<sha>' : sha))
      .split(work).join('/tmp/example')
      .trim();
    const shown = [];
    for (const block of result.stdout.split('\n@@shown ').slice(1)) {
      const index = Number(block.slice(0, block.indexOf('\n')));
      const body = block.slice(block.indexOf('\n') + 1);
      const exit = /\n@@exit (\d+)\n?$/.exec(body);
      shown.push({ command: lines[index].slice(2), output: normalize(body.slice(0, exit.index)), exitCode: Number(exit[1]) });
    }
    return shown;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Markdown for examples/README.md from the results of runExample() for every example. */
export function renderExamples(results) {
  const parts = [
    '# Shipgate examples',
    '',
    'Each example is a script run against the built CLI in a new directory. The output below is',
    'generated by `npm run examples -- --write` from real runs; commit ids are replaced with `<sha>`.',
    'The CLI tests run every example and assert the outcomes listed here',
    '(`packages/cli/test/examples.test.ts`), and CI fails if this file no longer matches a fresh run.',
    '',
    'Unless an example says otherwise, it starts in an empty directory with this setup, using a',
    'local bare repository as `origin`:',
    '',
    '```sh',
    'mkdir demo && cd demo',
    PRELUDE,
    '```',
    '',
    'The same situations are available in the policy simulator (`shipgate demo --serve`).',
    '',
  ];
  for (const example of EXAMPLES) {
    const shown = results[example.id];
    parts.push(`## ${example.title}`, '', ...example.facts.map((f) => `- ${f}`), '', '```sh');
    if (example.prelude === false) parts.push('mkdir demo && cd demo');
    parts.push(...example.script.split('\n').map((line) => (line.startsWith('$ ') ? line.slice(2) : line)), '```', '');
    for (const step of shown) {
      parts.push('```console', `$ ${step.command}`, ...(step.output ? [step.output] : []), ...(step.exitCode ? [`# exit status ${step.exitCode}`] : []), '```', '');
    }
    parts.push(`**Next:** ${example.next}`, '');
  }
  return `${parts.join('\n').trimEnd()}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(BIN)) throw new Error('Build the CLI first: npm run build');
  const results = Object.fromEntries(EXAMPLES.map((example) => [example.id, runExample(example)]));
  for (const example of EXAMPLES) checkExpectations(example, results[example.id]);
  const text = renderExamples(results);
  if (process.argv.includes('--write')) {
    writeFileSync(README_PATH, text);
    console.log(`wrote ${README_PATH}`);
  } else if (process.argv.includes('--check')) {
    if (!existsSync(README_PATH) || readFileSync(README_PATH, 'utf8') !== text) {
      console.error('examples/README.md is out of date; run npm run examples -- --write');
      process.exit(1);
    }
    console.log('examples/README.md matches a fresh run');
  } else {
    process.stdout.write(text);
  }
}
