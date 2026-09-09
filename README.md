# ij-lsp

A Docker Sandbox mixin that gives agents headless IntelliJ Java and Kotlin
intelligence through a simple `ij` command. It uses JetBrains'
[Java and Kotlin by IntelliJ IDEA](https://marketplace.visualstudio.com/items?itemName=JetBrains.intellij-server)
server bundle for symbols, navigation, references, hover, diagnostics, code
actions, and rename previews.

No browser or VS Code window is required for the agent. An optional
[code-server](https://github.com/coder/code-server) editor is included for
humans.

This is an independent community project, not an official JetBrains product.

## Why this exists

JetBrains' extension already brings IntelliJ intelligence to VS Code-based
editors. This kit makes the same language server directly useful to coding
agents: it launches `intellij-server` headlessly and exposes a small,
predictable CLI instead of requiring an agent to discover or implement LSP.

## Known-working quick start

Allow kits from this GitHub account once:

```console
sbx settings set kit.allowedSources '["docker.io/","github.com/shelajev/"]'
```

Create a sandbox with explicit license acceptance. Replace the final path with
your Java or Kotlin project:

```console
sbx create --name ij-lsp-claude claude \
  --kit "git+https://github.com/shelajev/ij-lsp-sbx-kit.git" \
  --kit-arg ij-lsp.accept-license=true \
  ~/my-jvm-project

sbx run --name ij-lsp-claude
```

Sandbox creation downloads and checksum-verifies the approximately 1 GB
platform-specific IntelliJ server. With the opt-in argument, it also records
acceptance of the bundled agreement and starts IntelliJ before the agent runs.
Named sandbox restarts reuse the downloaded server.

## Prompt for the sandbox agent

Paste this immediately after creating the sandbox:

```text
Use the installed headless IntelliJ tools for this Java/Kotlin repository.
Run `ij status` now, then `ij wait 300`. Use `ij symbols`, `ij outline`,
`ij definition`, `ij references`, `ij hover`, and `ij diagnostics` whenever
relevant. The commands return JSON and do not edit files. Do not open VS Code,
search MCP, or look for jdtls.
```

The same instructions are embedded in `spec.yaml`, so agents in newly created
sandboxes should discover `ij` without this prompt.

## Manual license acceptance

The `accept-license` kit argument defaults to `false`. To review and accept the
agreement interactively instead, omit the argument when creating the sandbox,
then run:

```console
sbx exec -it <sandbox-name> -- ij accept-license
```

The agent can wait for JetBrains' own import-and-index-ready notification with:

```console
ij wait 300
```

## Agent commands

```text
ij status
ij wait [seconds]
ij symbols <query>
ij outline <file>
ij diagnostics <file>
ij definition <file> <line> <column>
ij type-definition <file> <line> <column>
ij implementation <file> <line> <column>
ij references <file> <line> <column>
ij hover <file> <line> <column>
ij code-actions <file> <line> <column>
ij rename-preview <file> <line> <column> <new-name>
```

Lines and columns are 1-based. Code actions and rename are previews: `ij`
never modifies the workspace.

## Test the published kit

Validate and inspect it:

```console
sbx kit validate "git+https://github.com/shelajev/ij-lsp-sbx-kit.git"
sbx kit inspect "git+https://github.com/shelajev/ij-lsp-sbx-kit.git"
```

Create the sandbox and exercise IntelliJ against a real source file:

```console
sbx create --name ij-lsp-test codex \
  --kit "git+https://github.com/shelajev/ij-lsp-sbx-kit.git" \
  --kit-arg ij-lsp.accept-license=true \
  ~/my-jvm-project

sbx exec ij-lsp-test -- ij wait 300
sbx exec ij-lsp-test -- ij status
sbx exec ij-lsp-test -- ij outline src/main/java/example/App.java
sbx exec ij-lsp-test -- ij diagnostics src/main/java/example/App.java
sbx exec ij-lsp-test -- ij definition src/main/java/example/App.java 20 15
```

Adjust the file and position to match your project. `ij status` should report
`"initialized":true`; after import and indexing it should also report
`"indexed":true`.

If a dependency host is blocked, inspect the policy log:

```console
sbx policy log ij-lsp-test
```

Remove the sandbox when finished:

```console
sbx rm ij-lsp-test
```

## Test a local checkout

The fast smoke test uses a fake LSP process and requires only Node and curl:

```console
./tests/smoke.sh
```

For the complete Docker Sandbox test:

```console
sbx kit validate .
sbx kit inspect .
./run.sh ij-lsp-test ~/my-jvm-project
```

Set `SBX_AGENT=claude` to use Claude:

```console
SBX_AGENT=claude ./run.sh ij-lsp-claude ~/my-jvm-project
```

## Optional browser editor

code-server and the JetBrains extension still start on container port 8080.
To use them as a human:

```console
sbx ports ij-lsp-test
```

Open the host port named `intellij-code-server`. This may have its own JetBrains
onboarding and activation flow. Opening it is never required for agent queries.

## How it works

During sandbox creation, `ij-server-install` reads `server-bundle.json` from the
installed JetBrains extension, downloads that exact platform bundle, and
verifies the published checksum. `ij` requires explicit acceptance whenever
the bundled agreement changes.

After acceptance, `ij` launches `intellij-server --stdio` directly. A small
local bridge translates the documented command set into Language Server
Protocol requests over a user-only Unix socket. It answers the server's
configuration requests and maintains a separate index for each workspace.
There is no MCP discovery step or browser extension-host dependency.

The kit's Markdown note for sandbox agents is `agentInstructions.content` in
`spec.yaml`. Docker writes it into the sandbox's kit memory when the sandbox is
created.

## Versioning and network access

The kit pins code-server 4.135.0 and verifies its archive on `linux/amd64` and
`linux/arm64`. The JetBrains extension tracks `latest` because preview server
builds can expire; its server metadata pins the downloaded server version and
checksum for each installed extension release.

The network allowlist covers the pinned code-server release, Open VSX, and
JetBrains download, legal, and activation endpoints. Maven, Gradle, Bazel, or
project-specific repositories may need additional policy entries.

JetBrains currently describes this integration as a trial requiring IntelliJ
IDEA Ultimate afterward. Review its
[licensing and activation documentation](https://www.jetbrains.com/help/intellij-vscode/Register.html)
for current terms.

## License

Apache 2.0. See [LICENSE](LICENSE).
