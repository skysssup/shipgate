# A one-minute Shipgate demonstration

Build the current source, then run `npm run dev:web`. The simulator works locally and does not change Git.

1. Choose **Password in a database URL**. Its synthetic PostgreSQL URL produces a high-confidence `connection-password` finding and a Block decision, even though the file is a template.
2. Inspect the redacted finding and the decision explanation. Compare it with **Placeholders in .env.example**: exact placeholders can pass; template filenames do not exempt their contents.
3. Show the level comparison. The browser calls the same planner as the CLI; it supplies synthetic facts rather than operating on a visitor's repository.
4. Explain the real CLI's boundary: it scans staged blobs, preserves the index on a blocked transaction, keeps a local commit when a push fails, and uses an explicit remote lease for undo.

For a terminal demonstration, `node packages/cli/dist/bin.js demo --json` prints the same fixtures and decisions. Demonstrate real `ship` and `undo` operations only in a disposable repository created for the talk.

The evidence is the shared planner, staged-index and transaction tests in temporary repositories, browser parity tests, and an installed-package smoke test. A clear scan is not proof that no secret exists, and an allowed Git operation is not proof that a code change is correct.
