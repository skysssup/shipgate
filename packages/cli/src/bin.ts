#!/usr/bin/env node
import { demoRows, findWebDist, formatDemo, serveSimulator } from './commands/demo.js';
import { runOff, runOn } from './commands/on-off.js';
import { runSetup } from './commands/setup.js';
import { formatShipResult, runShip } from './commands/ship.js';
import { formatStatus, gatherStatus } from './commands/status.js';
import { formatUndoResult, runUndo } from './commands/undo.js';
import { runShipHook, type HookAgent } from './hook-mode.js';
import { flagBool, flagString, parseArgs, UsageError } from './parse-args.js';
import { writeLines } from './report.js';
import { VERSION } from './version.js';

const HELP = `Shipgate ${VERSION}: stage, scan, and commit agent changes, then push them, under a local policy.

Usage: shipgate <command> [options]

Commands:
  on       Enable Shipgate in this repository (writes .shipgate.json)
  off      Disable it here (settings are kept)
  ship     Stage ALL changes, scan them for credentials, apply the policy,
           then commit and push to origin
  undo     Remove the last Shipgate commit locally and from origin;
           its changes stay in the working tree
  status   Show policy, destination, hooks, busy markers, and lock state
  setup    Install Claude Code and Cursor stop hooks that run shipgate ship
  demo     Print example decisions; --serve opens the policy simulator

on options (each flag overrides the saved value; others are kept):
  --level strict|balanced|yolo   Policy level (default balanced)
  --agent[=false]                External review before each commit (sends the
                                 redacted staged diff to the review endpoint)
  --public-ok[=false]            Acknowledge a public push destination
  --model ID                     Review model (default openai/gpt-4o-mini)
  --account LOGIN                Expected GitHub login, shown by status only
  --key KEY                      Store an OpenRouter key in ~/.shipgate/config.json
                                 (prefer the OPENROUTER_API_KEY environment variable)

ship options:
  -m, --message TEXT             Commit message, used as written; skips external review
  --prompt TEXT                  Task description used for the commit subject and review
  --force-secrets                Commit despite credential findings (prints a warning)
  --public-ok                    Acknowledge a public destination for this run
  --confirm                      Record that a human checked the change (strict only
                                 recommends it; there is no prompt)
  --json                         Print the result as JSON on stdout
  --hook claude|cursor           Run as an agent stop hook (used by shipgate setup)

status, undo: --json             Print the result as JSON on stdout
demo: --serve [--port N]         Serve the simulator on 127.0.0.1 (default port 4173; 0 picks one)
      --json                     Print the example decisions as JSON

Exit status: 0 when the command did what it reports, including policy blocks and
holds that need no repair; 1 for errors and for results that need attention (invalid
configuration, failed review, commit, or push). Shipgate never exits 2.
Messages go to stderr; status, demo, --help, --version, and --json write to stdout.
`;

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv);
  switch (command) {
    case 'help':
      process.stdout.write(HELP);
      return 0;
    case 'version':
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case 'setup': {
      const result = runSetup();
      writeLines(process.stderr, result.lines);
      return result.exitCode;
    }
    case 'on': {
      const result = runOn({
        level: flagString(flags, 'level'),
        agent: flagBool(flags, 'agent'),
        publicOk: flagBool(flags, 'public-ok'),
        account: flagString(flags, 'account'),
        model: flagString(flags, 'model'),
        key: flagString(flags, 'key'),
      });
      writeLines(process.stderr, result.lines);
      return result.exitCode;
    }
    case 'off': {
      const result = runOff();
      writeLines(process.stderr, result.lines);
      return result.exitCode;
    }
    case 'ship': {
      const options = {
        message: flagString(flags, 'message'),
        prompt: flagString(flags, 'prompt'),
        forceSecrets: flagBool(flags, 'force-secrets'),
        publicOk: flagBool(flags, 'public-ok'),
        confirm: flagBool(flags, 'confirm'),
      };
      const hook = flagString(flags, 'hook');
      if (hook !== undefined) {
        if (hook !== 'claude' && hook !== 'cursor') throw new UsageError(`--hook expects claude or cursor, not '${hook}'`);
        if (flags.json) throw new UsageError('--hook and --json cannot be combined');
        const run = await runShipHook(hook as HookAgent, options);
        writeLines(process.stderr, run.stderrLines);
        if (run.stdout) process.stdout.write(`${run.stdout}\n`);
        return run.exitCode;
      }
      const result = await runShip(options);
      writeLines(process.stderr, formatShipResult(result));
      if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.exitCode;
    }
    case 'undo': {
      const result = runUndo();
      writeLines(process.stderr, formatUndoResult(result));
      if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.exitCode;
    }
    case 'status': {
      const report = gatherStatus();
      process.stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatStatus(report).join('\n')}\n`);
      return 0;
    }
    case 'demo': {
      if (!flags.serve) {
        if (flags.port !== undefined) throw new UsageError('--port only applies with --serve');
        const rows = demoRows();
        process.stdout.write(flags.json ? `${JSON.stringify(rows, null, 2)}\n` : `${formatDemo(rows).join('\n')}\n`);
        return 0;
      }
      const port = Number(flagString(flags, 'port') ?? '4173');
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError('--port expects a number from 0 to 65535 (0 picks a free port)');
      const dist = findWebDist();
      if (!dist) {
        process.stderr.write('shipgate: the simulator files are missing from this installation (expected a web/ directory next to dist/).\n');
        return 1;
      }
      let server;
      try {
        server = await serveSimulator(dist, port);
      } catch (error) {
        process.stderr.write(`shipgate: could not listen on 127.0.0.1:${port} (${(error as Error).message}); try --port <other>.\n`);
        return 1;
      }
      const address = server.address();
      const actual = address && typeof address === 'object' ? address.port : port;
      process.stdout.write(`Shipgate simulator: http://127.0.0.1:${actual}/ (Ctrl+C to stop)\n`);
      return -1;
    }
    default:
      throw new UsageError(`unknown command '${command}'`);
  }
}

main().then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      process.stderr.write(`shipgate: ${error.message}\nRun shipgate --help for usage.\n`);
    } else {
      process.stderr.write(`shipgate: unexpected error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    }
    process.exitCode = 1;
  },
);
