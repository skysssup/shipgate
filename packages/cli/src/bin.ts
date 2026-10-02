#!/usr/bin/env node
import { runDemo } from './commands/demo.js';
import { runOff, runOn } from './commands/on-off.js';
import { runSetup } from './commands/setup.js';
import { runShip } from './commands/ship.js';
import { gatherStatus, printStatus } from './commands/status.js';
import { runUndo } from './commands/undo.js';
import { flagBool, flagString, parseArgs } from './parse-args.js';
import { VERSION } from './version.js';

const HELP = `shipgate — safe auto-ship for coding agents

Usage:
  shipgate setup              Wire Claude/Cursor stop hooks (idempotent)
  shipgate on [options]       Enable in this repo
  shipgate off                Disable in this repo
  shipgate ship [options]     Stage → scan → commit → push
  shipgate undo               Undo last shipgate commit (local + remote)
  shipgate status [--json]    Show level, hooks, busy
  shipgate demo [--serve]     Print demo URL / serve local web build
  shipgate --version          Print version

on options:
  --level strict|balanced|yolo
  --agent          Enable LLM review gate
  --public-ok      Acknowledge public remote
  --account NAME   Record expected gh login (status only; does not switch credentials)
  --key KEY        Store OpenRouter key in ~/.shipgate/config.json
  --model ID       Model for agent review

ship options:
  -m, --message MSG
  --prompt TEXT
  --force-secrets
  --public-ok
  --confirm
`;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const { command, flags } = parsed;

  if (command === '--version' || flagBool(flags, 'version')) {
    process.stdout.write(VERSION + '\n');
    process.exit(0);
  }

  if (command === 'help' || flagBool(flags, 'help')) {
    process.stderr.write(HELP);
    process.exit(0);
  }

  let code = 0;

  switch (command) {
    case 'setup':
      code = runSetup();
      break;
    case 'on':
      code = runOn({
        level: flagString(flags, 'level'),
        agent: flagBool(flags, 'agent'),
        publicOk: flagBool(flags, 'public-ok'),
        account: flagString(flags, 'account'),
        model: flagString(flags, 'model'),
        key: flagString(flags, 'key'),
      });
      break;
    case 'off':
      code = runOff();
      break;
    case 'ship': {
      const result = await runShip({
        message: flagString(flags, 'message') || flagString(flags, 'm'),
        prompt: flagString(flags, 'prompt'),
        forceSecrets: flagBool(flags, 'force-secrets'),
        publicOk: flagBool(flags, 'public-ok'),
        confirm: flagBool(flags, 'confirm'),
      });
      code = result.exitCode;
      break;
    }
    case 'undo': {
      const result = runUndo();
      code = result.exitCode;
      break;
    }
    case 'status': {
      const report = gatherStatus();
      printStatus(report, flagBool(flags, 'json'));
      code = 0;
      break;
    }
    case 'demo':
      code = runDemo({
        serve: flagBool(flags, 'serve'),
        port: flagString(flags, 'port')
          ? Number(flagString(flags, 'port'))
          : undefined,
      });
      break;
    default:
      process.stderr.write(`shipgate: unknown command '${command}'\n`);
      process.stderr.write(HELP);
      code = 1;
  }

  // demo --serve keeps process alive
  if (command === 'demo' && flagBool(flags, 'serve')) return;
  process.exit(code);
}

main().catch((e) => {
  process.stderr.write(`shipgate: fatal ${e}\n`);
  process.exit(1);
});
