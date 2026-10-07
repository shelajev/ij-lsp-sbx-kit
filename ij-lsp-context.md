# IntelliJ is agent-callable: run `ij ready 300` immediately

This sandbox exposes JetBrains IntelliJ Java/Kotlin intelligence directly through the headless `ij` command. It has no UI, browser, MCP, VS Code, or editor extension host. Run `ij ready 300` first. Checksummed JetBrains server prefetch begins in the background during sandbox creation; `ij ready` waits for installation, while project import starts only after the workspace is available.

If it returns `setupRequired: license`, stop and ask the user to run `ij accept-license` in an interactive sandbox terminal. Never accept legal terms for the user. The user may instead explicitly opt in during sandbox creation with `--kit-arg acceptLicense=true`. Do not search MCP catalogs, the PATH, running processes, workspace configuration, or `jdtls` for another LSP.

Prefer these semantic queries over text-only guesses:

- `ij symbols <query>` searches workspace symbols.
- `ij outline <file>` lists document symbols.
- `ij definition|type-definition|implementation|references|hover <file>:<line>:<column>` queries a 1-based source position. The separate `<file> <line> <column>` form also works.
- `ij diagnostics <file>` returns current IntelliJ diagnostics.
- `ij code-actions <file>:<line>:<column>` and `ij rename-preview <file>:<line>:<column> <new-name>` return previews only; they never edit files.

Results are compact JSON with workspace-relative files and 1-based positions; use global options `--raw` or `--limit N` when needed. Empty results can mean Maven, Gradle, or Bazel import and indexing are still running, so run `ij ready 300` before concluding that no symbol exists. Agent queries start and talk to JetBrains' `intellij-server` directly over stdio behind a workspace-specific private Unix socket. Only claim IntelliJ-backed results after a successful `ij` response. Continue validating changes with the project's normal build, tests, lint, and formatting.
