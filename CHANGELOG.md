# Changelog

## 2.0.0 — 2026-10-04

### Fixed

- `ship` no longer runs during a merge, rebase, cherry-pick, revert, or bisect. It used to stage the
  conflicted files and commit the conflict markers.
- `ship` refuses a detached HEAD instead of committing and then rebasing onto `origin/HEAD`.
- When a commit hook changes staged files after the scan, `ship` rescans the commit and keeps it
  local if the new content fails the policy. Previously the unscanned content was pushed.
- A failed push now says the commit was made locally and exits 1. Shipgate only rebases when origin
  has new commits, never across local merge commits, and aborts a conflicting rebase.
- `undo` checks origin before changing anything: it removes a commit origin never had locally,
  refuses when origin has newer commits on top, and rolls back its local reset when origin rejects
  the rewind. Previously a rejected rewind left the branch rewound locally only.
- Unknown options (such as `--levle strict`) and stray arguments are errors instead of being
  ignored. Boolean flags no longer swallow the following word.
- `shipgate on` keeps existing settings; running it without `--level` no longer resets strict to
  balanced. `off` keeps settings too.
- An invalid `.shipgate.json` is reported as invalid, with the offending key, instead of as "not
  enabled". Unknown keys are rejected.
- A held lock is reported (with its owner) instead of exiting silently, and a lock left by a crashed
  process is removed on the next run. Concurrent runs report the lock rather than a busy agent.
- Staged-file scanning reads all blobs through one `git cat-file --batch` process. 2,000 changed
  files took about 80 seconds before and about 1 second now.
- The Cursor hook ran from `~/.cursor`, so it never shipped anything. It now ships the workspace
  roots from the hook input. The Claude Code hook reports results to the user; before, Claude Code
  showed nothing for exit 0.
- `setup` no longer reports success when `~/.claude/settings.json` has an unexpected shape, and no
  longer writes `.bak` copies.
- The scanner masks excerpts consistently, reports line numbers, prints `.env` paths in full, detects
  encrypted, EC, OpenSSH, and PGP private keys and AWS temporary key ids, and skips placeholder
  bodies such as `sk-xxxxxxxx`. Redaction for review reuses the scanning patterns.
- External review handles timeouts, HTTP errors, malformed responses, and unexpected answers as
  "unavailable" with a specific reason, omits flagged `.env` files from the diff it sends, and
  reports when `-m` skipped it.
- `demo --serve` works from an installed package, returns 404 for missing assets, and reports a busy
  port instead of crashing.

### Changed (compatibility)

- Exit status 1 instead of 0 for: a commit that was made but not pushed, detached HEAD or an
  unfinished merge or rebase, `on`/`off` outside a repository, and every `undo` that refused.
- Help, `status`, and `demo` output moved from stderr to stdout. `ship --json` and `undo --json`
  print machine-readable results on stdout.
- `-m` messages are kept as written, including a body; they used to be flattened and cut to 72
  characters.
- `--public-ok` also silences yolo's public-destination warning, as it already did for balanced.
- strict warns when origin is not a GitHub URL, because visibility was not checked.
- Hooks: `shipgate setup` installs `shipgate ship --hook claude|cursor` and upgrades 1.x hooks in
  place.
- `@shipgate/core` API: `RunPlanInput` uses `remote` (`none`, `private`, `public`, `unknown`,
  `other-host`) and `review` instead of `isPublicRemote`, `agentReviewEnabled`, `agentReviewHold`,
  and the unused `humanConfirm*` fields. `RunPlanResult` adds `code`, `summary`, `warnings`,
  `recommendations`, and `review`; `reasons` now lists only what stopped the run; `action` can be
  `noop`. `assertSafetyLevel` and `defaultConfig` were removed; `DemoScenario` now holds files that
  are scanned at run time.
- Node.js 22.12 or later is required by every package (the packages previously claimed Node 18).

### Added

- Policy simulator rewritten around the decision: examples, every input with plain-language labels,
  separate blocking reasons, warnings, and recommendations, what the CLI would do next, the
  matching CLI commands, and a debug view. Keyboard and screen-reader accessible, light and dark
  themes, no external requests.
- Release assets: a CLI tarball that bundles `@shipgate/core` and the simulator, the core library
  tarball, and the static simulator build.
- An example catalog generated from real runs (`examples/README.md`), checked by the tests.

## 1.0.1

Initial public version.
