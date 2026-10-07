# ij-lsp

A headless Docker Sandbox v3 mixin kit that gives coding agents
IntelliJ-powered Java and Kotlin intelligence through one small `ij` command. It supports symbols,
navigation, references, hover, diagnostics, code-action previews, and rename
previews without VS Code, a browser, MCP discovery, or an open port.

The kit uses JetBrains'
[Java and Kotlin by IntelliJ IDEA](https://marketplace.visualstudio.com/items?itemName=JetBrains.intellij-server)
server. This is an independent community project, not an official JetBrains
product.

## Quick start

Use an sbx release with Kits v3 support and a v3 agent workload. Older built-in
templates may fail with `no workload kit in the set`; in that case, supply a
v3 workload reference in place of `codex`. `SBX_AGENT` accepts that reference
when using `run.sh`.

Allow Docker Hub and this GitHub account as kit sources once:

```bash
sbx settings set kit.allowedSources '["docker.io/","github.com/shelajev/"]'
```

Create a named sandbox for a Java or Kotlin project:

```bash
sbx create --name ij-lsp-codex codex \
  --kit docker.io/olegselajev241/ij-lsp:0.7.0 \
  --kit-arg acceptLicense=true \
  ~/my-jvm-project
```

Once creation finishes, attach the agent:

```bash
sbx run --name ij-lsp-codex
```

The v3 argument is named `acceptLicense` (the v2 spelling was `accept-license`).
The kit argument is an explicit opt-in to JetBrains' bundled agreement. Omit
it to review and accept the agreement interactively instead.

On first creation, the kit begins downloading and checksum-verifying the
approximately 1 GB platform-specific IntelliJ server in the background.
The first `ij ready` waits for installation through the shared installer lock. There is no code-server installation,
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

`ij ready 300` waits for installation, starts IntelliJ only after the repository
is present, then waits for JetBrains' project-import and indexing-ready
notification. The timeout of 300 seconds bounds indexing; installation has
its own installer lock timeout.

## Manual license acceptance

Without `--kit-arg acceptLicense=true`, accept interactively:

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

The Markdown note for sandbox agents is [ij-lsp-context.md](ij-lsp-context.md),
referenced by the `agent-context@1` capability in [ij-lsp.yaml](ij-lsp.yaml).
Docker stages it in the kit image and indexes it in the agent's kit memory.

## Test the published kit

Inspect its resolved v3 declarations:

```bash
sbx kit inspect docker.io/olegselajev241/ij-lsp:0.7.0
```

Then exercise a real project:

```bash
sbx create --name ij-lsp-test codex \
  --kit docker.io/olegselajev241/ij-lsp:0.7.0 \
  --kit-arg acceptLicense=true \
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

The fast smoke test uses a fake LSP server and the Linux tools listed below:

```bash
./tests/smoke.sh
```

On macOS, run it in a Linux container:

```bash
docker run --rm --entrypoint bash -v "$PWD:/kit:ro" -w /kit \
  docker/sandbox-templates:shell-docker ./tests/smoke.sh
```

The v3 descriptor is `ij-lsp.yaml`; its companion recipe
`ij-lsp.dockerfile` ships the bridge as an OCI overlay. The workload must
already provide Node.js, curl, tar, unzip, sha256sum, and flock. The install
hook checks these tools and reports any missing dependency.

Validate and build both supported platforms, then check the OCI artifact:

```bash
docker buildx build . -f ij-lsp.yaml --output type=cacheonly
docker buildx build . -f ij-lsp.yaml --platform linux/amd64,linux/arm64 \
  -t ij-lsp:0.7.0 --output type=oci,dest=/tmp/ij-lsp-layout,tar=false
kit-tck validate --layout /tmp/ij-lsp-layout 0.7.0
```

Install `kit-tck` from the matching platform archive on the
[sandbox-kit-spec releases page](https://github.com/docker/sandbox-kit-spec/releases).
`sbx kit validate` does not support v3 source kits; the BuildKit frontend
validates the descriptor during the build instead.

Inspect and run the local source kit (sbx builds it on demand):

```bash
sbx kit inspect .
./run.sh ij-lsp-test ~/my-jvm-project
```

`run.sh` leaves license acceptance interactive. To opt in explicitly when
creating a local sandbox, use:

```bash
sbx create --name ij-lsp-local codex --kit "$PWD" \
  --kit-arg acceptLicense=true ~/my-jvm-project
sbx run --name ij-lsp-local
```

Use another agent template with `SBX_AGENT`, for example:

```bash
SBX_AGENT=claude ./run.sh ij-lsp-claude ~/my-jvm-project
```

## Publish the v3 kit

The kit is one OCI image containing the descriptor, bridge, and agent context.
[The publishing workflow](.github/workflows/publish.yml) runs only on pushes
to `main`. It runs the smoke test, builds amd64 and arm64 together, and pushes
`olegselajev241/ij-lsp` to Docker Hub with the descriptor's version, `latest`,
and `sha-<commit>` tags. PRs, other branches, tags, schedules, and manual events
have no workflow trigger.

The workflow uses the repository Actions secret `DOCKERHUB_TOKEN` and the
configured username `olegselajev241`. The token needs permission to push to
that Docker Hub repository.

To publish manually, build and push both platforms together:

```bash
docker buildx build . -f ij-lsp.yaml --platform linux/amd64,linux/arm64 \
  -t docker.io/olegselajev241/ij-lsp:0.7.0 \
  -t docker.io/olegselajev241/ij-lsp:latest --push
```

Consumers can compose the published image onto an agent:

```bash
sbx create --name ij-lsp-codex codex \
  --kit docker.io/olegselajev241/ij-lsp:0.7.0 ~/my-jvm-project
```

## Versioning and network access

A fresh sandbox resolves the latest platform-specific JetBrains extension
metadata because preview server builds can expire. That resolved metadata and
server version remain fixed for the lifetime of the named sandbox.

The runtime allowlist covers Open VSX plus JetBrains download, legal, and
activation endpoints. Startup hooks explicitly receive the license argument
and sandbox proxy environment so their downloads use the same network policy.
Prefetch runs as a background startup hook because the approximately 1 GB
download can exceed the runtime's foreground startup deadline.
Maven, Gradle, Bazel, or project-specific repositories may require additional
policy entries.

JetBrains currently describes this integration as a trial requiring IntelliJ
IDEA Ultimate afterward. Review its
[licensing and activation documentation](https://www.jetbrains.com/help/intellij-vscode/Register.html)
for current terms.

## License

Apache 2.0. See [LICENSE](LICENSE).
