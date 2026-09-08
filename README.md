# ij-lsp

A Docker Sandbox mixin that opens the sandbox workspace in
[code-server](https://github.com/coder/code-server) with JetBrains'
[Java and Kotlin by IntelliJ IDEA](https://marketplace.visualstudio.com/items?itemName=JetBrains.intellij-server)
extension preinstalled. It adds IntelliJ-powered completion, navigation, code
analysis, refactoring, and formatting for Maven, Gradle, and Bazel projects
alongside any sandbox agent.

The language intelligence is editor-side. This kit does not add LSP operations
as callable tools to Codex, Claude, or another terminal agent.

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
This sandbox has the ij-lsp kit. Run `ij-lsp-status` now. Do not search for an
MCP server, jdtls, or another LSP process: JetBrains.intellij-server is an
editor-only code-server extension. Report its status, then tell me how to open
the intellij-code-server port.
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

Confirm the extension and web service inside it:

```console
sbx exec ij-lsp-test -- ij-lsp-status
sbx exec ij-lsp-test -- code-server --list-extensions --show-versions
sbx exec ij-lsp-test -- curl -fsSI http://127.0.0.1:8080/
sbx ports ij-lsp-test
```

The extension list should contain `jetbrains.intellij-server@<version>`. Open
the host port labeled `intellij-code-server`, complete JetBrains' first-run
license flow, then open a Java or Kotlin source file. After project import and
indexing, verify completion, navigation, and diagnostics in the editor.

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

Kit files and agent memory are applied when a sandbox is created. If you cannot
recreate an older demo sandbox, paste this into its agent session:

```text
Stop searching for MCP servers, jdtls, or a standalone LSP process. This
sandbox's IntelliJ intelligence runs in the JetBrains.intellij-server
code-server extension on container port 8080. It is editor-only, not a tool you
can invoke. Verify it with `code-server --list-extensions --show-versions` and
`curl -fsSI http://127.0.0.1:8080/`. Then tell me to run `sbx ports
<sandbox-name>` and open the port named `intellij-code-server`. Continue your
own work with repository search and the Maven/Gradle/Bazel build and tests.
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

The note tells the agent to run `ij-lsp-status` immediately instead of searching
for MCP resources, `jdtls`, workspace configuration, or a standalone process.
It also explains what the editor provides, how to find its port and logs, and
that the terminal agent cannot call this LSP directly. An agent-callable
integration would require a separate LSP-to-MCP bridge.

## Compatibility

The JetBrains extension requires a recent VS Code engine and ships separate
Linux builds. code-server 4.135.0 embeds VS Code 1.135.0 and satisfies the
extension's current `^1.105.1` engine requirement. The kit supports
`linux/amd64` and `linux/arm64` sandboxes.

JetBrains recommends disabling overlapping Java extensions from Red Hat or
Oracle while evaluating this extension. This kit does not install either one.

## License

Apache 2.0. See [LICENSE](LICENSE).
