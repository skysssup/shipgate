# Shipgate

Shipgate scans the working tree for common secrets, then can commit and push under an opt-in per-repo policy. Undo rewinds commits that carry the trailer `Shipped-by: shipgate`.

When your agent finishes a turn, Shipgate can stage → scan → commit → push — under a policy you chose.

Preview the policy demo locally with `npm run dev:web`. No hosted demo is currently available.


Blocked or held ships restore your previously staged index instead of wiping it with `git reset`.

## Install

Build from source with Node.js 22.12 or later:

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
| `shipgate ship` | `git add -A` → secret scan → policy → optional LLM review → commit → push (rebase-once on non-FF) |
| `shipgate undo` | Undo last `Shipped-by: shipgate` commit (force-with-lease + mixed reset) |
| `shipgate status` | Level, enabled, hooks, busy count (`--json` available) |
| `shipgate demo` | Print sample policy decisions; `--serve` previews the local web build |
| `shipgate --version` | Version |

### `on` flags

- `--level strict\|balanced\|yolo`
- `--agent` — fail-closed LLM review gate. Sends a pattern-redacted staged diff and prompt context to the configured external model endpoint; redaction is not a guarantee. Requires `OPENROUTER_API_KEY` or `~/.shipgate/config.json`.
- `--public-ok` — acknowledge public remote
- `--account <name>` — record the expected GitHub login for status; does not switch credentials
- `--key <key>` / `--model <id>`

### `ship` flags

- `-m / --message` — explicit subject (skips LLM gate)
- `--prompt` — agent prompt text for subject / review
- `--force-secrets` — override secret blocks (still logged). Can ship real secrets; do not use casually.
- `--public-ok` / `--confirm`

Exit codes stay agent-safe: soft holds/blocks exit `0`. Noise goes to stderr.

## Safety levels

| Level | Secrets | Public remote | Notes |
| --- | --- | --- | --- |
| **strict** | block | block unless `--public-ok` | Requires `.shipgate.json`; human + LLM gates recommended |
| **balanced** | block | warn | Default; good for day-to-day agent work |
| **yolo** | block high-confidence unless `--force-secrets` | warn | Medium findings allowed with warning. `--force-secrets` can still ship secrets — that is the point of the flag. |

Template filenames (`*.example`, `*.sample`, `*.template`, `*.dist`) are exempt from the dotenv filename rule; their contents are still scanned for credentials. Obvious placeholder values are skipped. Pattern scanning can miss secrets and produce false positives.

Public-remote detection uses `gh repo view` when available so private GitHub remotes are not false-positives; without `gh`, `github.com` remotes are treated as public (safe default for `strict`).

Commits always carry the trailer `Shipped-by: shipgate`. `undo` only touches those commits.

## Busy-aware shipping

Concurrent agents register pid markers under the git dir. If another agent is live, `ship` defers (hold) — the last agent to finish ships the staged work. Dead pids are swept automatically.

## Monorepo

```
packages/core   pure policy, scanner, RunPlan (zero runtime deps)
packages/cli    shipgate binary
apps/web        interactive safety-matrix demo (GitHub Pages)
```

```bash
npm test
npm run build
```

## Version

1.0.1

## License

MIT
