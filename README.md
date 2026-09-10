# ij-lsp

A headless Docker Sandbox kit that gives coding agents IntelliJ-powered Java
and Kotlin intelligence through one small `ij` command. It supports symbols,
navigation, references, hover, diagnostics, code-action previews, and rename
previews without VS Code, a browser, MCP discovery, or an open port.

The kit uses JetBrains'
[Java and Kotlin by IntelliJ IDEA](https://marketplace.visualstudio.com/items?itemName=JetBrains.intellij-server)
server. This is an independent community project, not an official JetBrains
product.

## Quick start

Allow kits from this GitHub account once:

```bash
sbx settings set kit.allowedSources '["docker.io/","github.com/shelajev/"]'
```

Create a named sandbox for a Java or Kotlin project:

```bash
sbx create --name ij-lsp-codex codex \
  --kit "git+https://github.com/shelajev/ij-lsp-sbx-kit.git" \
  --kit-arg ij-lsp.accept-license=true \
  ~/my-jvm-project
```

Once creation finishes, attach the agent:

```bash
sbx run --name ij-lsp-codex
```

The kit argument is an explicit opt-in to JetBrains' bundled agreement. Omit
it to review and accept the agreement interactively instead.

On first creation, the kit downloads and checksum-verifies the approximately
1 GB platform-specific IntelliJ server. There is no code-server installation,
VS Code extension host, browser process, or editor download. Restarting the
same named sandbox reuses the server and indexes already stored in it.

## First command for the agent

The kit embeds this behavior in Docker Sandbox agent memory, so a capable agent
should start automatically. To make a demo immediate, paste:

```text
Use the installed headless IntelliJ intelligence for this Java/Kotlin project.
Run `ij ready 300` now. Then prefer `ij symbols`, `ij outline`, `ij definition`,
`ij references`, `ij hover`, and `ij diagnostics` over text-only guesses. Do
not look for MCP, jdtls, VS Code, a browser, or another LSP.
```

`ij ready 300` starts IntelliJ only after the repository is present, then waits
for JetBrains' project-import and indexing-ready notification.

## Manual license acceptance

Without `--kit-arg ij-lsp.accept-license=true`, accept interactively:

```bash
sbx exec -it ij-lsp-codex -- ij accept-license
sbx exec ij-lsp-codex -- ij ready 300
```

The agreement is read from the downloaded server bundle. Acceptance is stored
with the EULA hash, timestamp, and acceptance method, and a changed agreement
must be accepted again. Agents are instructed never to accept legal terms for
the user.

## Agent commands

```text
ij ready [seconds]
ij status
ij doctor
ij symbols <query>
ij outline <file>
ij diagnostics <file>
ij definition <file>:<line>:<column>
ij type-definition <file>:<line>:<column>
ij implementation <file>:<line>:<column>
ij references <file>:<line>:<column>
ij hover <file>:<line>:<column>
ij code-actions <file>:<line>:<column>
ij rename-preview <file>:<line>:<column> <new-name>
```

The older separate form, such as `ij definition App.java 20 15`, also works.
Lines and columns are 1-based. `def` and `refs` are short aliases. Code actions
and rename are previews; `ij` never edits files.

Results default to compact JSON with workspace-relative file paths, 1-based
positions, and at most 100 top-level results. Global options are available:

```bash
ij --limit 250 references src/main/java/example/App.java:20:15
ij --raw definition src/main/java/example/App.java:20:15
```

## How it works

Fresh sandboxes query Open VSX for the current platform release and download
its small VSIX. The kit verifies the VSIX checksum, extracts only
`server-bundle.json`, and discards the VSIX. It does not install or run the
extension.

That manifest selects an official JetBrains server archive and SHA-256. The
installer downloads the archive directly from JetBrains, resumes interrupted
downloads, verifies the checksum, and publishes the extracted server
atomically. Concurrent `ij` invocations share an installation lock.

At the first `ij ready` or semantic query, `ij` launches
`intellij-server --stdio`. A local Node bridge translates the documented CLI
operations into Language Server Protocol requests over a user-only,
workspace-specific Unix socket. Each workspace has an isolated IntelliJ system
directory and index. No network service is exposed.

The Markdown note for sandbox agents is `agentInstructions.content` in
`spec.yaml`; Docker writes it into the sandbox's kit memory at creation time.

## Test the published kit

Validate and inspect it:

```bash
sbx kit validate "git+https://github.com/shelajev/ij-lsp-sbx-kit.git"
sbx kit inspect "git+https://github.com/shelajev/ij-lsp-sbx-kit.git"
```

Then exercise a real project:

```bash
sbx create --name ij-lsp-test codex \
  --kit "git+https://github.com/shelajev/ij-lsp-sbx-kit.git" \
  --kit-arg ij-lsp.accept-license=true \
  ~/my-jvm-project

sbx exec ij-lsp-test -- ij ready 300
sbx exec ij-lsp-test -- ij status
sbx exec ij-lsp-test -- ij outline src/main/java/example/App.java
sbx exec ij-lsp-test -- ij diagnostics src/main/java/example/App.java
sbx exec ij-lsp-test -- ij definition src/main/java/example/App.java:20:15
```

Adjust the file and position for your project. A ready status reports
`"state":"ready"`, `"initialized":true`, and `"indexed":true`.

If a project dependency host is blocked, inspect the sandbox policy log:

```bash
sbx policy log ij-lsp-test
```

## Test a local checkout

The fast smoke test uses a fake LSP server:

```bash
./tests/smoke.sh
```

For Docker Sandbox validation and a real-project run:

```bash
sbx kit validate .
sbx kit inspect .
./run.sh ij-lsp-test ~/my-jvm-project
```

Use another agent template with `SBX_AGENT`, for example:

```bash
SBX_AGENT=claude ./run.sh ij-lsp-claude ~/my-jvm-project
```

## Versioning and network access

A fresh sandbox resolves the latest platform-specific JetBrains extension
metadata because preview server builds can expire. That resolved metadata and
server version remain fixed for the lifetime of the named sandbox.

The allowlist covers Open VSX plus JetBrains download, legal, and activation
endpoints. Maven, Gradle, Bazel, or project-specific repositories may require
additional policy entries.

JetBrains currently describes this integration as a trial requiring IntelliJ
IDEA Ultimate afterward. Review its
[licensing and activation documentation](https://www.jetbrains.com/help/intellij-vscode/Register.html)
for current terms.

## License

Apache 2.0. See [LICENSE](LICENSE).
