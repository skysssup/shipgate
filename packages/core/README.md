# @shipgate/core

The decision code behind the `shipgate` CLI and the Shipgate policy simulator. It has no runtime
dependencies. Everything except the busy-marker functions also runs in browsers
(`@shipgate/core/browser`).

- `planRun(input)` decides whether `shipgate ship` may commit: `ship`, `hold`, `block`, or `noop`,
  with a cause `code`, a one-sentence `summary`, blocking `reasons`, `warnings`,
  `recommendations`, and `gates`, the result of each check in order. It performs no I/O.
- `simulateShip(input, place)` returns what `ship` reports for a decision when every Git step
  succeeds, and `formatShipResult(result)` renders the report the CLI prints.
- `scanSecrets(files)` and `scanTextForSecrets(text, label)` match credential patterns and return
  findings with masked excerpts and line numbers. `redactSecretsInText(text)` replaces the same
  patterns with `[REDACTED]`. `locateSecrets(text)` returns the position of every match, including
  placeholders the scan skips. `SECRET_RULES` describes each rule. Pattern matching misses
  credentials it has no rule for and can flag harmless text.
- `buildCommitMessage` and `hasShipgateTrailer` handle the `Shipped-by: shipgate` trailer.
- `markBusy`, `clearBusy`, `sweepBusy`, and `shouldDeferShip` manage PID-based busy markers in a
  Git directory, for runners that start agents and want `shipgate ship` to wait for them.
- `DEMO_SCENARIOS` and `scenarioInput` are the example situations shared by the simulator, the
  `shipgate demo` command, and the tests. `RULE_SAMPLES` holds one synthetic file per scanner rule.

The package is distributed as a release asset of [Shipgate](https://github.com/skysssup/shipgate)
and is not published to the npm registry.
