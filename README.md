# Shipgate

Safe auto-ship for coding agents: opt-in per repo, secret scan (OpenAI, Anthropic, GitHub, Slack, Stripe, Google API, npm, AWS, JWT, PEM, `.env`)ning, safety levels, undo, busy-aware shipping.

When your agent finishes a turn, Shipgate can stage → scan → commit → push — under a policy you chose.

**Live demo:** https://skysssup.github.io/shipgate/

## Install

```bash
npm install -g @shipgate/cli
# or from source
git clone https://github.com/skysssup/shipgate && cd shipgate && npm install && npm run build && npm link -w @shipgate/cli
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
| `shipgate demo` | Print demo URL; `--serve` previews the local web build |
| `shipgate --version` | Version |

### `on` flags

- `--level strict\|balanced\|yolo`
- `--agent` — LLM review gate (OpenRouter / OpenAI-compatible; `OPENROUTER_API_KEY` or `~/.shipgate/config.json`)
- `--public-ok` — acknowledge public remote
- `--account <name>` — pin gh account
- `--key <key>` / `--model <id>`

### `ship` flags

- `-m / --message` — explicit subject (skips LLM gate)
- `--prompt` — agent prompt text for subject / review
- `--force-secrets` — override secret blocks (still logged)
- `--public-ok` / `--confirm`

Exit codes stay agent-safe: soft holds/blocks exit `0`. Noise goes to stderr.

## Safety levels

| Level | Secrets | Public remote | Notes |
| --- | --- | --- | --- |
| **strict** | block | block unless `--public-ok` | Requires `.shipgate.json`; human + LLM gates recommended |
| **balanced** | block | warn | Default; good for day-to-day agent work |
| **yolo** | block high-confidence unless `--force-secrets` | warn | Medium findings allowed with warning |

Template files (`*.example`, `*.sample`, `*.template`, `*.dist`) and obvious placeholders (`your-*-here`, `EXAMPLE`, `xxxx`) are exempt.

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
