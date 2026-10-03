# Shipgate

Shipgate is an opt-in Git CLI for a developer or coding agent's end-of-turn workflow. It stages changes, scans the staged blobs for common credential patterns, applies a local policy, and can commit and push. It does not test whether the code is correct.

`ship` stages **all changes in the repository**, including previously unstaged and untracked files. It scans the whole index even when invoked from a subdirectory. Use it only when those changes belong in the same commit.

Blocked or held operations restore the previous index, including partial staging, without replacing working-tree files. Successful commits carry `Shipped-by: shipgate`; `undo` only rewinds commits with that trailer.

## Install

Build from source with Node.js 22.12 or later. The CLI is not currently published on npm:

```bash
git clone https://github.com/skysssup/shipgate
cd shipgate
npm ci
npm run build
npm link -w @shipgate/cli
```

```bash
shipgate setup          # wire Claude / Cursor stop hooks (idempotent)
cd your-repo
shipgate on             # opt-in (default level: balanced)
```

## Commands

| Command | What it does |
| --- | --- |
| `shipgate setup` | Merge stop-hook snippets for Claude Code / Cursor without clobbering unrelated hooks |
| `shipgate on` | Enable in this repo (`.shipgate.json`) |
| `shipgate off` | Disable |
| `shipgate ship` | `git add -A` → staged-blob scan → policy → optional LLM review → commit → push; one fetch/rebase retry after a failed push |
| `shipgate undo` | Undo last `Shipped-by: shipgate` commit (force-with-lease + mixed reset) |
| `shipgate status` | Level, enabled, hooks, busy count (`--json` available) |
| `shipgate demo` | Print sample policy decisions; `--serve` previews the local web build |
| `shipgate --version` | Version |

### `on` flags

- `--level strict\|balanced\|yolo`
- `--agent` — fail-closed LLM review gate. Sends a pattern-redacted staged diff and prompt context to the configured external model endpoint; redaction is not a guarantee. Requires `OPENROUTER_API_KEY` or `~/.shipgate/config.json`.
- `--public-ok` — acknowledge public remote
- `--account <name>` — record the expected GitHub login for status; does not switch credentials
- `--model <id>` — model for external review. Prefer `OPENROUTER_API_KEY` over `--key <key>` so the key does not enter shell history; `--key` stores it in `~/.shipgate/config.json`.

### `ship` flags

- `-m / --message` — explicit subject (skips LLM gate)
- `--prompt` — agent prompt text for subject / review
- `--force-secrets` — override secret blocks (still logged). Can ship real secrets; do not use casually.
- `--public-ok` / `--confirm`

Policy holds/blocks exit `0` for stop-hook compatibility; operational errors can exit `1`. Messages go to stderr. Do not interpret exit `0` alone as proof that a commit was pushed.

## Safety levels

| Level | Secrets | Public remote | Notes |
| --- | --- | --- | --- |
| **strict** | block | block unless `--public-ok` | Requires `.shipgate.json`; confirmation and LLM review are recommendations, not automatically enabled gates |
| **balanced** | block | warn | Default; good for day-to-day agent work |
| **yolo** | block high-confidence unless `--force-secrets` | warn | Medium findings allowed with warning. `--force-secrets` can still ship secrets — that is the point of the flag. |

Template filenames (`*.example`, `*.sample`, `*.template`, `*.dist`) are exempt from the dotenv filename rule; their contents are still scanned for credentials. Obvious placeholder values are skipped. Pattern scanning can miss secrets and produce false positives.

Public-remote detection recognizes GitHub HTTPS, SCP-style SSH, explicit SSH URLs, and SSH over port 443. It uses `gh repo view` when available; if GitHub visibility cannot be determined, it assumes public. Other hosts are not classified, so this is not a general remote-visibility safeguard.

Invalid policy levels and incorrectly typed configuration are rejected. Boolean CLI flags accept `true`/`false` or `1`/`0`; options such as `--level` require a value. `--confirm` acknowledges the strict policy's recommendation; it is not an interactive approval prompt.

## Coordination and limits

Ship and undo share an exclusive lock in the current worktree's Git directory. Other Git programs do not honor that lock: avoid concurrent staging/committing. If an index change is detected during external review, Shipgate retains it and holds rather than overwriting it.

The core library exposes PID-based busy markers for runners that register active agents. Installed stop hooks run only at turn end; they do **not** automatically track an agent throughout its work. Dead-PID markers are swept, but a crashed ship process can leave `shipgate-ship.lock`. Remove that lock only after confirming its recorded process has stopped.

Undo refuses staged edits, resets locally while preserving working files, then attempts a remote rewind with an exact force-with-lease. If the remote step fails, the local undo remains in place and the error is reported. A repository without `origin` commits and undoes locally.

Credential scanning and external-review redaction are pattern-based. They can miss secrets, and Git hooks or concurrent tools can change the index. Neither feature is a guarantee that a commit is safe to publish.

## Monorepo

```
packages/core   pure policy, scanner, RunPlan (zero runtime deps)
packages/cli    shipgate binary
apps/web        policy simulator; does not access Git
```

```bash
npm test
npm run build
```

The tests include real temporary Git repositories, partial staging, nested invocation, and linked worktrees. Preview the simulator with `npm run dev:web`; there is no hosted demo.

MIT — see [LICENSE](LICENSE).
