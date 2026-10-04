# Shipgate

Shipgate is a command-line tool for repositories where coding agents make changes. `shipgate ship`
stages every change, scans the staged files for credential patterns, applies a policy you choose
per repository, then commits and pushes. Agent stop hooks can run it after each turn. A browser
simulator shows what the policy would decide for a given situation, and why.

It is for people who let agents such as Claude Code or Cursor work in a repository and want those
changes committed and pushed without publishing an API key, without committing on top of another
agent's half-finished work, and with a way to take the last commit back.

What it does not do:

- It does not test or review whether code works. The optional external review is a model's opinion,
  not a test.
- Scanning is pattern matching on the staged files. It misses credentials it has no rule for (for
  example `password = "hunter2"`) and can flag harmless text. It does not scan earlier commits or
  unchanged files.
- `ship` stages everything in the repository, including untracked files, so it suits repositories
  where all current changes belong in the next commit.

## Install

Requirements: Node.js 22.12 or later and Git. Tested on Linux, macOS, and Windows in CI.

Shipgate is not published to the npm registry. Install the CLI tarball from a
[GitHub release](https://github.com/skysssup/shipgate/releases); it contains the policy library
and the simulator, so it needs no other downloads:

```sh
npm install --global https://github.com/skysssup/shipgate/releases/download/v2.1.0/shipgate-cli-2.1.0.tgz
shipgate --version
```

To build the same tarball from source:

```sh
git clone https://github.com/skysssup/shipgate
cd shipgate
npm ci
npm run build
npm run pack:release          # writes release/shipgate-cli-2.1.0.tgz and friends
npm install --global ./release/shipgate-cli-2.1.0.tgz
```

## Quick start

```sh
cd your-repo
shipgate on                    # opt in; writes .shipgate.json (policy: balanced)
shipgate ship -m "Add greet helper"
shipgate status                # policy, destination, hooks, lock
shipgate undo                  # remove the last Shipgate commit, keep its changes
shipgate setup                 # optional: run ship after each Claude Code or Cursor turn
```

Real output from the [example catalog](examples/README.md):

```console
$ shipgate ship -m "Add greet helper"
shipgate: SHIPPED — Pushed <sha> to origin/main.
  commit   <sha> Add greet helper
  remote   ../origin.git (not GitHub; visibility not checked)
```

```console
$ shipgate ship
shipgate: BLOCKED — Credential findings block this run.
  finding  .env:1  openai-key (high)  sk-proj-…demo
  finding  .env  dotenv-file (high)
  reason   2 high-confidence credential findings: balanced blocks every finding.
  result   Nothing was committed. The staging area is back to how it was before the run.
  next     Remove the credential and keep .env files out of Git (.gitignore), or rerun with --force-secrets if it is a false positive.
```

`.shipgate.json` is an ordinary file in the repository root. If it is not ignored, the next ship
commits it, which shares the policy with everyone who clones the repository. To keep it local, add
it to `.git/info/exclude`. Each linked worktree reads `.shipgate.json` from its own top-level
directory.

## What `ship` does

1. Checks that Shipgate is enabled, the configuration is valid, no other Shipgate operation holds
   the worktree's lock, no other agent is marked busy, HEAD is on a branch, and no merge, rebase,
   cherry-pick, revert, or bisect is in progress. If any check fails, nothing is staged.
2. Runs `git add --all`, so already staged, unstaged, untracked, deleted, and renamed paths are all
   included, from anywhere in the repository.
3. Reads the staged blobs from Git's object database, not the working tree, and scans them. Files
   over 16 MiB stop the run with an error instead of being skipped. Submodule contents are not
   scanned. The `-m` message and `--prompt` text are scanned too.
4. Applies the policy (below). If external review is on, sends the review request.
5. Commits with a `Shipped-by: shipgate` trailer. With `-m`, the message is used as written;
   otherwise the subject comes from `--prompt` (unless it contains a credential) or the changed
   file names.
6. If a commit hook changed the staged files, rescans the commit. If the new content fails the
   policy, the commit stays local and is not pushed.
7. Pushes the branch to `origin` (setting an upstream only if the branch has none). If the push is
   rejected because origin has new commits, fetches, rebases once, and pushes again. It never
   rebases local merge commits; a rebase conflict is aborted. Without an `origin` remote, the
   commit stays local.

When a run stops before committing, Shipgate restores the index bytes it saw before `git add
--all`, so partial staging (`git add -p`), intent-to-add entries, and staged deletions come back
exactly. Working-tree files are never modified. If another Git command changed the index during
the run, Shipgate keeps that newer index instead of overwriting it.

A local commit and a successful push are different outcomes. When the push fails, the commit
stays on your branch, the output says so, and `ship` exits 1:

```console
$ shipgate ship -m "Add feature"
shipgate: COMMITTED, NOT PUSHED — Committed <sha> on main, but the push to origin failed.
  reason   remote: pushes to main are disabled
  commit   <sha> Add feature
  remote   ../origin.git (not GitHub; visibility not checked)
  next     The commit is in your local main branch. Fix the problem and run git push origin main, or run shipgate undo to remove the commit and keep the changes.
# exit status 1
```

## Policy

Every level requires opt-in (`shipgate on`) and waits while another agent is marked busy.

| | strict | balanced (default) | yolo |
| --- | --- | --- | --- |
| High-confidence credential finding | block | block | block |
| Medium-confidence credential finding | block | block | allow, with a warning |
| Public or unverified GitHub destination | block until acknowledged | warn until acknowledged | warn until acknowledged |
| Non-GitHub destination | warn that visibility was not checked | no message | no message |
| Recommendations (never enforced) | `--confirm`; external review | none | none |

- `--force-secrets` overrides credential blocks at every level and prints a warning. It does not
  acknowledge a public destination, wait for busy agents, or enable a disabled repository.
- `--public-ok` (or `"publicOk": true` from `shipgate on --public-ok`) acknowledges a public
  destination. It does not change whether the destination is public and does not override
  credential findings.
- `--confirm` only records that a human checked the change, which removes strict's recommendation.
  Shipgate never prompts.

### Push destinations

Shipgate checks every push URL of `origin`. For github.com URLs (HTTPS, SSH, SCP-style, and SSH
over port 443) it asks the GitHub CLI (`gh repo view`) whether the repository is private. If `gh`
is missing, signed out, offline, or has no access, the visibility is unknown and Shipgate treats
the destination as public. Other hosts are not checked. With several push URLs, the most public
one decides.

### Configuration and precedence

| Setting | Where | Notes |
| --- | --- | --- |
| `level`, `agentReview`, `publicOk`, `account`, `model`, `enabled` | `.shipgate.json`, written by `shipgate on` / `off` | Unknown keys or wrong types make the file invalid: `ship` stops with exit 1 and names the problem |
| Per-run acknowledgements | `ship` flags | Apply to one run only; `--public-ok` or `publicOk` in the file acknowledges |
| Review API key | `OPENROUTER_API_KEY`, then `openRouterApiKey` in `~/.shipgate/config.json` | `shipgate on --key` writes the file with owner-only permissions on Linux and macOS |
| Review model | `model` in `.shipgate.json`, then `~/.shipgate/config.json`, then `openai/gpt-4o-mini` | |
| Review endpoint | `baseUrl` in `~/.shipgate/config.json`, default `https://openrouter.ai/api/v1` | Any OpenAI-compatible chat completions endpoint |
| Settings directory | `SHIPGATE_HOME` (default `~/.shipgate`) | |

`shipgate on` keeps existing settings; each flag you pass replaces one value. Boolean options
accept `--flag`, `--flag=false`, or `--flag false`. `shipgate off` sets `"enabled": false` and keeps
the rest.

## Commands

| Command | What it does |
| --- | --- |
| `shipgate on [--level strict\|balanced\|yolo] [--agent] [--public-ok] [--model ID] [--account LOGIN] [--key KEY]` | Enable Shipgate in this repository. `--account` is shown by `status` only; it does not select credentials. Prefer `OPENROUTER_API_KEY` over `--key`, which ends up in shell history. |
| `shipgate off` | Disable it here; settings are kept. |
| `shipgate ship [-m TEXT] [--prompt TEXT] [--force-secrets] [--public-ok] [--confirm] [--json]` | Stage, scan, decide, commit, and push, as described above. `--hook claude\|cursor` is for the installed agent hooks. |
| `shipgate undo [--json]` | Remove the last Shipgate commit; see [Undo](#undo). |
| `shipgate status [--json]` | Show the configuration (or why it is invalid), destination, busy markers, lock, and hooks. |
| `shipgate setup` | Install the Claude Code and Cursor stop hooks; see [Agent hooks](#agent-hooks). |
| `shipgate demo [--json]` | Print the built-in example decisions. |
| `shipgate demo --serve [--port N]` | Serve the policy simulator on 127.0.0.1 (default port 4173, `0` for any free port). |

Unknown commands, options, and arguments are errors, with a suggestion when one is close.

### Output and exit status

Progress and results go to stderr, so hooks can discard stdout. `status`, `demo`, `--help`,
`--version`, and `--json` output go to stdout. The `--json` result of `ship` has `outcome` (for
example `pushed`, `committed`, `push-failed`, `blocked`), `committed`, `pushed`, `findings`,
`reasons`, `warnings`, and `exitCode`.

For `ship`:

| Exit | When |
| --- | --- |
| 0 | Shipped, committed (no origin), nothing to ship, not enabled, not a Git repository, blocked by policy, or held because another agent is busy, another Shipgate operation is running, or the reviewer asked to hold |
| 1 | Invalid `.shipgate.json`, detached HEAD, a merge or rebase in progress, staging or scanning failures, review unavailable, index changed during review, commit failures (for example a rejecting pre-commit hook), and a commit that was made but not pushed |

Every command exits 1 on usage errors. `on`, `off`, `setup`, and `undo` exit 0 when they did what
they report and 1 otherwise, including an `undo` that refused.

Shipgate never exits 2, because Claude Code treats exit 2 from a Stop hook as "keep working". Do
not read exit 0 as proof of a push: check `pushed` in `--json` output.

## External review

`shipgate on --agent` adds a model review before each commit. Shipgate sends one request to the
chat completions endpoint (OpenRouter unless `baseUrl` says otherwise) with:

- the API key, in the `Authorization` header;
- the model id;
- the changed file paths;
- the staged diff, up to 12,000 characters, without the contents of files flagged as `.env` files;
- the `--prompt` text, up to 2,000 characters.

Credential-shaped values that match Shipgate's rules are replaced with `[REDACTED]` first. Redaction
uses the same patterns as scanning, so anything the scanner would miss is sent as is. Enable review
only if sending your code to that endpoint is acceptable.

The reviewer answers `ship` or `hold`. A missing key, HTTP error, timeout (15 seconds), malformed
response, or any answer other than ship or hold counts as unavailable, and Shipgate holds with exit
1 rather than shipping unreviewed. `-m` skips review for that run and says so in a warning. That is
the escape hatch for a run you have reviewed yourself, and also a way around review, so treat
`-m` in agent instructions accordingly.

## Undo

`shipgate undo` removes the last commit when it carries the `Shipped-by: shipgate` trailer. Its
changes stay in the working tree as unstaged edits. Nothing changes unless every check passes:

- HEAD must be a non-merge Shipgate commit on a branch, with a parent, and there must be no staged
  changes or unfinished Git operation.
- If `origin` has this commit as the branch tip, undo resets locally and then rewinds origin with
  `git push --force-with-lease` pinned to that exact commit. If origin rejects the rewind (branch
  protection, or someone pushed in between), the local reset is rolled back and nothing changes.
- If origin has newer commits on top, undo refuses and suggests `git revert`.
- If origin never had the commit (for example the push failed), only the local branch is reset.
- If origin cannot be reached, undo refuses, because it cannot tell whether the commit was pushed.

## Agent hooks

`shipgate setup` installs stop hooks that run `shipgate ship` after each agent turn. They are
global (every repository you open), but act only in repositories with Shipgate enabled; elsewhere
they print nothing.

- **Claude Code**: adds a Stop hook to `~/.claude/settings.json` that runs
  `~/.claude/shipgate-stop.sh`, which calls `shipgate ship --hook claude`. Shipgate reads the
  session directory from the hook input and reports results to you as a `systemMessage`, without
  making Claude continue. The script needs `bash` (on Windows, Git Bash or WSL).
- **Cursor**: adds `shipgate ship --hook cursor` to `~/.cursor/hooks.json`. Cursor runs user hooks
  from `~/.cursor`, so Shipgate ships each workspace root from the hook input instead of its own
  working directory. Cursor shows hook output and failures in its Hooks output channel.
- Cursor also runs Claude Code hooks by default. When both hooks are installed, the Claude Code hook
  does nothing inside Cursor, so each turn ships once.

Running `setup` again is safe: it adds missing entries, upgrades hooks written by Shipgate 1.x, and
leaves unrelated hooks alone. If a settings file is not valid JSON or has an unexpected shape, setup
changes nothing in it, explains why, and exits 1. To remove the hooks, delete the Shipgate entries
from those two files and delete `~/.claude/shipgate-stop.sh`.

Stop hooks run when a turn ends. They do not know whether another agent is still working; see
[busy markers](#worktrees-locks-and-busy-markers).

## Worktrees, locks, and busy markers

- **Worktrees**: each linked worktree has its own index, HEAD, `.shipgate.json`, lock, and busy
  markers. Locks and markers live in the worktree's Git directory
  (`git rev-parse --absolute-git-dir`).
- **Lock**: `ship` and `undo` hold `shipgate-ship.lock` while they run, including while waiting for
  review. A second run reports "Another Shipgate operation is running" and exits 0. If the process
  that holds the lock has died (same host, PID no longer running), the next run removes the stale
  lock and says so. A lock from a live process, another host, or with unreadable contents is never
  removed automatically; `status` shows its owner. Other Git tools do not honor this lock, so avoid
  running your own `git add` or `git commit` while Shipgate is waiting for review; if you do,
  Shipgate notices the index change and holds instead of committing.
- **Busy markers**: a runner that starts agents can mark one busy with `markBusy()` from
  `@shipgate/core` (released as `shipgate-core-<version>.tgz`). While a marker names a live process,
  `ship` holds and stages nothing. Markers whose process has exited are removed automatically. The
  [example catalog](examples/README.md#work-is-deferred-while-another-agent-is-busy) shows the
  marker format for runners in other languages.
- **Interrupted runs**: if `ship` is killed (for example by a hook timeout) after staging, the index
  stays staged and the lock stays behind until the next run removes it. Files are never lost.

## Credential scanning

| Rule | Confidence | Matches |
| --- | --- | --- |
| `aws-access-key` | high | AWS access key ids (`AKIA…`, `ASIA…`) |
| `aws-secret-key` | medium | 40-character values assigned to `aws_secret_access_key` |
| `openai-key` | high | `sk-…` keys, including `sk-proj-` |
| `anthropic-key` | high | `sk-ant-…` keys |
| `github-token` | high | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` tokens and `github_pat_` tokens |
| `slack-token` | high | `xoxb-`, `xoxa-`, `xoxp-`, `xoxr-`, `xoxs-` tokens |
| `private-key-pem` | high | PEM and PGP private key blocks (RSA, EC, DSA, OpenSSH, encrypted) |
| `stripe-key` | high | `sk_live_`, `sk_test_`, `rk_live_`, `rk_test_` keys (publishable `pk_` keys are allowed) |
| `google-api-key` | medium | `AIza…` keys |
| `npm-token` | high | `npm_…` tokens |
| `jwt` | medium | three base64url segments starting with `eyJ` |
| `dotenv-file` | high | files named `.env` or `.env.*`, except templates ending in `.example`, `.sample`, `.template`, or `.dist` |

Confidence describes the pattern, not whether a credential is live; Shipgate never contacts the
issuing service. Each rule reports its first match per file, with the line number and a masked
excerpt. Template files are scanned like any other file; only the filename rule skips them. Values
that are plainly placeholders are skipped: `your-…-here`, `changeme`, `<YOUR_KEY>`, `${VAR}`, runs of
`x`, and AWS's documented `AKIAIOSFODNN7EXAMPLE`, including after a known prefix such as `sk-`. A
deleted `.env` file is not a finding, so removing one can ship.

## Policy simulator

The simulator runs the CLI's decision code in the browser, on built-in examples or on files you
type, paste, or open. It does not read, stage, commit, or push anything and makes no network
requests; opened files stay in the page.

![The policy simulator blocking a change that adds an API key in a .env file](docs/simulator.png)

- Choose an example, the policy level, the repository facts (opt-in, origin, busy agents, external
  review), and the `ship` flags.
- Edit the staged files. The scanner runs on every change, highlights credential-shaped values,
  and lists what each finding does at the current level, including placeholders it skipped.
- **Checks** shows each check `ship` applies, in order, with its result. **What-if** lists single
  changes that change the decision and applies one with a click. **Levels** compares strict,
  balanced, and yolo. **Terminal** shows the report `shipgate ship` would print, produced by the
  CLI's own formatter, and the commands that reproduce the setup.
- **Share** copies a link that keeps the example and settings, not file contents. The **Rules**
  view lists every scanner rule and what each level does with it.

Open it with `shipgate demo --serve`, or from a source checkout with `npm run dev:web`. Releases
also include the static build (`shipgate-simulator-<version>.tar.gz`), which works from any path on
a static web server. There is no hosted copy.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `NOT ENABLED` | No `.shipgate.json`, or `"enabled": false`. Run `shipgate on` in that worktree. |
| `CONFIG ERROR` | `.shipgate.json` is not valid; the message names the key. Fix it, or delete it and run `shipgate on`. |
| `HELD — Another Shipgate operation is running` | `status` shows the lock owner. Wait for it, or delete the lock if no Shipgate process is running. |
| `HELD — Git is in the middle of a merge` (or rebase) | Finish or abort it; Shipgate will not stage conflict markers. |
| Blocked on a value you know is fake | Rerun with `--force-secrets`; it applies to that run only. |
| Strict blocks a GitHub repository you know is private | `gh` could not confirm the visibility. Run `gh auth status`, or acknowledge with `--public-ok`. |
| `review unavailable: no API key` | Set `OPENROUTER_API_KEY`, or run `shipgate on --agent=false`. |
| Hooks seem to do nothing | Run `shipgate status` in the repository: Shipgate must be enabled there, and both hooks should say `installed`. In Cursor, check the Hooks output channel. |
| `COMMITTED, NOT PUSHED` | The commit is local. Push it yourself after fixing the cause, or `shipgate undo`. |

## Limitations

- Pattern scanning only (see [Credential scanning](#credential-scanning)); no history scan, no
  entropy analysis, no live verification.
- Public-destination checks cover github.com URLs only, and depend on the GitHub CLI.
- `ship` always stages the whole repository. Keep unrelated work out of agent repositories, or
  commit it yourself first.
- Commits that you made yourself before a ship are pushed with it, unscanned.
- Busy markers and locks are PID based and per host; they do not coordinate across machines that
  share a repository directory.
- External review sends redacted code to a third party and is only as good as the model's answer.

## Development

```text
packages/core   policy decisions, scanner, commit messages, busy markers, example scenarios
packages/cli    the shipgate command
apps/web        the policy simulator (React, Vite)
examples        generated example catalog and its runner
scripts         release packaging and install verification
```

```sh
npm ci
npm test                     # builds, then runs core, CLI (real Git repositories), and web tests
npm run test:e2e             # browser tests; run npx playwright install chromium firefox once
npm run examples -- --check  # verify examples/README.md against fresh runs
npm run pack:release && npm run verify:package   # build tarballs, install them offline elsewhere
```

## License

MIT. See [LICENSE](LICENSE).
