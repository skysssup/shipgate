# @shipgate/core

The decision code behind the `shipgate` CLI and the Shipgate policy simulator. It has no runtime
dependencies. Everything except the busy-marker functions also runs in browsers
(`@shipgate/core/browser`).

- `planRun(input)` decides whether `shipgate ship` may commit: `ship`, `hold`, `block`, or `noop`,
  with a cause `code`, a one-sentence `summary`, blocking `reasons`, `warnings`, and
  `recommendations`. It performs no I/O.
- `scanSecrets(files)` and `scanTextForSecrets(text, label)` match credential patterns and return
  findings with masked excerpts and line numbers. `redactSecretsInText(text)` replaces the same
  patterns with `[REDACTED]`. Pattern matching misses credentials it has no rule for and can flag
  harmless text.
- `buildCommitMessage` and `hasShipgateTrailer` handle the `Shipped-by: shipgate` trailer.
- `markBusy`, `clearBusy`, `sweepBusy`, and `shouldDeferShip` manage PID-based busy markers in a
  Git directory, for runners that start agents and want `shipgate ship` to wait for them.
- `DEMO_SCENARIOS` and `scenarioInput` are the example situations shared by the simulator, the
  `shipgate demo` command, and the tests.

The package is distributed as a release asset of [Shipgate](https://github.com/skysssup/shipgate)
and is not published to the npm registry.
