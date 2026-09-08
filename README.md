# ij-lsp

A Docker Sandbox mixin that opens the sandbox workspace in
[code-server](https://github.com/coder/code-server) with JetBrains'
[Java and Kotlin by IntelliJ IDEA](https://marketplace.visualstudio.com/items?itemName=JetBrains.intellij-server)
extension preinstalled. It adds IntelliJ-powered completion, navigation, code
analysis, refactoring, and formatting for Maven, Gradle, and Bazel projects
alongside any sandbox agent.

The agent gets the `ij` command for precise IntelliJ-backed symbol, definition,
reference, hover, diagnostics, code-action, and rename-preview queries. The user
gets the same intelligence in the browser editor. You do not need to operate the
underlying Language Server Protocol.

## Quick start

Allow kits from this GitHub account once:

```console
sbx settings set kit.allowedSources '["docker.io/","github.com/shelajev/"]'
```

Run the kit with any built-in agent, for example Codex:

```console
sbx run codex \
  --kit "git+https://github.com/shelajev/ij-lsp-sbx-kit.git" \
  ~/my-project
```

For a named sandbox you can reattach to:

```console
sbx create --name ij-lsp-current codex \
  --kit "git+https://github.com/shelajev/ij-lsp-sbx-kit.git" \
  ~/my-project

sbx run --name ij-lsp-current
```

Find the ephemeral host port after the sandbox starts:

```console
sbx ports <sandbox-name>
```

Open `http://localhost:<host-port>/`. On first launch, JetBrains asks you to
select a region and review and accept its license. Open a Maven, Gradle, or
Bazel project; import and indexing begin automatically.

If the page does not load, inspect the service log:

```console
sbx exec <sandbox-name> -- cat /tmp/ij-lsp-code-server.log
```

## Demo fast path

For a new sandbox, tell the agent:

```text
Use the installed IntelliJ tools for this Java/Kotlin task. Run `ij status`
first, then use `ij symbols`, `ij definition`, `ij references`, `ij hover`, and
`ij diagnostics` whenever they are relevant. Do not search for MCP, jdtls, or
another LSP. If the bridge is not ready, ask me to open code-server once.
Summarize the IntelliJ results and continue the task.
```

For a sandbox created with an older kit revision, use the longer prompt in the
[existing-sandbox instructions](#existing-sandbox-prompt) below.

## Test the kit

### From GitHub

Validate and inspect the remote kit before running it:

```console
sbx kit validate "git+https://github.com/shelajev/ij-lsp-sbx-kit.git"
sbx kit inspect "git+https://github.com/shelajev/ij-lsp-sbx-kit.git"
```

Create a sandbox against a Java or Kotlin workspace:

```console
sbx create --name ij-lsp-test codex \
  --kit "git+https://github.com/shelajev/ij-lsp-sbx-kit.git" \
  ~/my-jvm-project
```

Confirm the agent bridge, extension, and web service inside it:

```console
sbx exec ij-lsp-test -- ij status
sbx exec ij-lsp-test -- code-server --list-extensions --show-versions
sbx exec ij-lsp-test -- curl -fsSI http://127.0.0.1:8080/
sbx ports ij-lsp-test
```

The extension list should contain `jetbrains.intellij-server@<version>` and
`shelajev.intellij-agent-bridge@0.1.0`. Open the host port labeled
`intellij-code-server`, complete JetBrains' first-run license flow, then open a
Java or Kotlin source file. Opening code-server also starts its workspace
extension host and the local agent bridge. After project import and indexing,
test an agent query against a real source position:

```console
sbx exec ij-lsp-test -- ij outline src/main/java/example/App.java
sbx exec ij-lsp-test -- ij diagnostics src/main/java/example/App.java
sbx exec ij-lsp-test -- ij definition src/main/java/example/App.java 20 15
```

All lines and columns are 1-based. Queries return structured JSON and never
modify files. `ij code-actions` and `ij rename-preview` expose proposed edits
for the agent to review and apply through its normal file-editing workflow.

If setup or indexing cannot reach a host, inspect the sandbox policy log:

```console
sbx policy log ij-lsp-test
```

Remove the test sandbox when finished:

```console
sbx rm ij-lsp-test
```

### From a local clone

```console
git clone https://github.com/shelajev/ij-lsp-sbx-kit.git
cd ij-lsp-sbx-kit
sbx kit validate .
sbx kit inspect .
./run.sh ij-lsp-test ~/my-jvm-project
```

Set `SBX_AGENT` to use a different base agent:

```console
SBX_AGENT=claude ./run.sh ij-lsp-claude ~/my-jvm-project
```

### Existing-sandbox prompt

Kit files and agent memory are applied when a sandbox is created. An older
sandbox can continue using the browser editor, but it does not contain the new
agent bridge. Create a new named sandbox to get `ij`, without deleting the old
one:

```console
sbx create --name ij-lsp-agent codex \
  --kit "git+https://github.com/shelajev/ij-lsp-sbx-kit.git" \
  ~/my-jvm-project
```

## Versioning

The kit pins code-server 4.135.0 and verifies the downloaded archive for both
`linux/amd64` and `linux/arm64`.

The IntelliJ extension intentionally defaults to `latest`. JetBrains preview
builds have time-limited evaluation periods, so pinning an old default would
eventually produce a non-working kit. Open VSX resolves the latest compatible
Linux build for the sandbox architecture.

## Configuration and state

The kit writes a small code-server settings file only when none exists. It
turns off VS Code telemetry, JetBrains diagnostic data sharing, and IntelliJ
LSP protocol tracing. It does not select your legal region or accept terms for
you.

code-server and the IntelliJ extension keep their state beneath
`~/.local/share/code-server/`. If the base sandbox persists the agent home,
extension state, indexes, and completed onboarding survive restarts.

JetBrains currently offers a trial and requires an IntelliJ IDEA Ultimate
license afterward. See its
[licensing and activation documentation](https://www.jetbrains.com/help/intellij-vscode/Register.html)
for the current terms and activation methods.

## Network access

The allowlist covers the pinned code-server release, the Open VSX registry,
and JetBrains endpoints used for geo/legal checks, updates, and license
activation. The kit defaults JetBrains diagnostic data sharing to `none`; you
can change that setting in code-server.

Dependencies fetched by Maven, Gradle, Bazel, or project-specific repositories
may require additional network rules. Check `sbx policy log <sandbox-name>` and
add those domains through an additional local mixin or your organization policy.

## Agent notes

The `agentInstructions.content` block in `spec.yaml` is the kit's Markdown note
for the sandboxed agent. At sandbox creation, Docker writes mixin instructions
to `kits-memory/ij-lsp.md` and links that file from the base agent's main memory
file.

The note tells the agent to run `ij status` immediately instead of searching for
MCP resources, `jdtls`, workspace configuration, or a standalone process. It
documents every semantic query and reminds the agent that code-action and rename
operations are preview-only.

The `ij` command talks over a user-only Unix socket to the bundled IntelliJ Agent
Bridge extension. The bridge invokes code-server's standard language-provider
API, so the browser and agent reuse the same JetBrains extension and project
index rather than launching competing language servers.

## Compatibility

The JetBrains extension requires a recent VS Code engine and ships separate
Linux builds. code-server 4.135.0 embeds VS Code 1.135.0 and satisfies the
extension's current `^1.105.1` engine requirement. The kit supports
`linux/amd64` and `linux/arm64` sandboxes.

JetBrains recommends disabling overlapping Java extensions from Red Hat or
Oracle while evaluating this extension. This kit does not install either one.

## License

Apache 2.0. See [LICENSE](LICENSE).
