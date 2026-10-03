# Shipgate

Shipgate is an opt-in Git CLI that stages changes, scans staged changes across the repository for credential patterns, applies a local policy, and can commit and push. It is a pattern scanner, not a guarantee that a commit is safe to publish, and it does not test code correctness.

## Install

Build from source with Node.js 22.12 or later. The CLI is not currently published on npm:

```bash
git clone https://github.com/skysssup/shipgate
cd shipgate
npm ci
npm run build
npm link -w @shipgate/cli
```

## Quick usage

```bash
cd your-repo
shipgate on --level balanced
shipgate status
shipgate ship -m "Describe the change"
```

`ship` stages **all changes in the repository**, including previously unstaged and untracked files. Use it only when those changes belong in the same commit. Run `shipgate setup` separately if you want Claude Code / Cursor stop hooks to call `shipgate ship` after a turn.

## Commands

| Command | What it does |
| --- | --- |
| `shipgate setup` | Merge stop-hook snippets for Claude Code / Cursor without clobbering unrelated hooks |
| `shipgate on` | Enable in this repo (`.shipgate.json`) |
| `shipgate off` | Disable |
| `shipgate ship` | `git add -A` → staged-blob scan → policy → optional LLM review → commit → push; one fetch/rebase retry after a failed push |
| `shipgate undo` | Rewind HEAD if it carries `Shipped-by: shipgate`, preserving working files |
| `shipgate status` | Policy, configured account, hooks, busy count (`--json` available) |
| `shipgate demo` | Print sample policy decisions; `--serve` previews the local web build |
| `shipgate --version` | Version |

### `on` flags

- `--level strict\|balanced\|yolo` — balanced is the default.
- `--agent` — enable external LLM review; an unavailable review holds shipping. Requires `OPENROUTER_API_KEY` or a key in `~/.shipgate/config.json`.
- `--public-ok` — acknowledge public remote
- `--account <name>` — record the expected GitHub login for status; does not switch credentials
- `--model <id>` — model for external review. Prefer `OPENROUTER_API_KEY` over `--key <key>` so the key does not enter shell history; `--key` stores it in `~/.shipgate/config.json`.

### `ship` flags

- `-m <subject>` / `--message <subject>` — explicit subject; skips the LLM gate, not credential scanning.
- `--prompt <text>` — prompt context for the subject and external review. It may become a public commit subject.
- `--force-secrets` — override secret blocks at any level, with a warning on stderr. This can publish real credentials.
- `--public-ok` — acknowledge public GitHub push destinations for this run.
- `--confirm` — acknowledge strict policy's recommendation; it is not an interactive approval prompt.

Policy holds/blocks exit `0` for stop-hook compatibility; operational errors can exit `1`. Messages go to stderr. Do not interpret exit `0` alone as proof that a commit was pushed.

## Safety levels

| Level | Secrets | Public remote | Notes |
| --- | --- | --- | --- |
| **strict** | block high and medium findings | block unless `--public-ok` | Confirmation and LLM review are recommendations, not automatically enabled gates |
| **balanced** | block high and medium findings | warn | Default |
| **yolo** | block high findings | warn | Medium findings are allowed with a warning |

Every level requires repository opt-in. `--force-secrets` overrides the credential blocks above; it does not acknowledge a public destination. Warnings and override reasons are printed on successful ships as well as blocked runs.

Template filenames (`*.example`, `*.sample`, `*.template`, `*.dist`) are exempt from the dotenv filename rule; their contents are still scanned for credentials. Obvious placeholder values are skipped.

The public-remote policy checks all effective push URLs of `origin`, not its fetch URL. It recognizes GitHub HTTPS, SCP-style SSH, explicit SSH URLs, and SSH over port 443. It uses `gh repo view` when available; if GitHub visibility cannot be determined, it assumes public. Other hosts are not classified.

Invalid policy levels and incorrectly typed configuration are rejected. Boolean flags accept `true`/`false` or `1`/`0`; options such as `--level` require a value.

## Behavior notes

If shipping stops before committing, it restores the previous index, including partial staging, without replacing working-tree files. If another Git operation changed the index, Shipgate retains that index instead. Successful commits carry `Shipped-by: shipgate`.

Ship and undo share an exclusive lock in the current worktree's Git directory. Other Git programs do not honor that lock. An index change detected during external review holds shipping rather than committing different contents.

The core library exposes PID-based busy markers for runners that register active agents. A live marker for another agent defers shipping; dead-PID markers are swept. Installed stop hooks run only at turn end and do not track an agent throughout its work. A crashed ship process can leave `shipgate-ship.lock` in the worktree's Git directory. Remove that lock only after confirming its recorded process has stopped.

Undo refuses staged edits and a HEAD without the Shipgate trailer. It resets locally while preserving working files, then attempts a remote rewind with an exact force-with-lease. If the remote step fails, the local undo remains in place and the error is reported. A repository without `origin` commits and undoes locally.

## Limitations

- Credential scanning covers staged changed blobs, not unchanged files or earlier commits. Gitlinks are commit references, so submodule contents are not scanned. Staged blobs over 16 MiB hold shipping with an error rather than being skipped.
- Patterns can miss credentials or produce false positives. Git hooks and concurrent tools can also change the index after scanning. Avoid concurrent staging or committing.
- External review sends a pattern-redacted staged diff and prompt context to the configured model endpoint. Redaction is not a confidentiality guarantee; enable `--agent` only if that disclosure is acceptable.
- The public-destination check is specific to recognized GitHub URLs, not a general remote-visibility safeguard. `--account` is status information only and does not select or verify credentials.

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
