#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
socket="$test_dir/ij.sock"
log="$test_dir/daemon.log"
daemon_pid=
cli_daemon_pid=

cleanup() {
  if [[ -n "$daemon_pid" ]]; then kill "$daemon_pid" 2>/dev/null || true; fi
  if [[ -n "$cli_daemon_pid" ]]; then kill "$cli_daemon_pid" 2>/dev/null || true; fi
  rm -rf -- "$test_dir"
}
trap cleanup EXIT

IJ_LSP_STATE_DIR="$test_dir/state" node "$repo_dir/files/home/.local/lib/ij-lsp/daemon.js" \
  "$repo_dir/tests/fixtures" "$repo_dir/tests/fake-intellij-server.js" fake-eula "$socket" >"$log" 2>&1 &
daemon_pid=$!

for _ in {1..50}; do
  [[ -S "$socket" ]] && break
  sleep 0.1
done
[[ -S "$socket" ]] || { cat "$log" >&2; exit 1; }

request() {
  curl --fail --silent --show-error --unix-socket "$socket" "http://localhost$1"
}

starting="$(request /v1/status)"
waited="$(request '/v1/wait?seconds=2')"
status="$(request /v1/status)"
symbols="$(request '/v1/symbols?query=App')"
outline="$(request '/v1/outline?file=App.java')"
hover="$(request '/v1/hover?file=App.java&line=3&column=13')"
definition="$(request '/v1/definition?file=App.java&line=3&column=13')"
raw_definition="$(request '/v1/definition?file=App.java&line=3&column=13&raw=true')"
rename="$(request '/v1/rename-preview?file=App.java&line=3&column=13&newName=Application')"

node -e '
const values = process.argv.slice(1).map(JSON.parse);
if (values[0].server !== "intellij" || !["starting", "ready"].includes(values[0].state)) throw new Error("early status failed");
if (!values[1].indexed) throw new Error("ready signal was not observed");
if (!values[2].initialized || values[2].state !== "ready" || values[2].bridgeVersion !== "0.7.0") throw new Error("ready status failed");
if (values[3][0].name !== "App") throw new Error("workspace symbols failed");
if (values[4][0].name !== "App") throw new Error("document symbols failed");
if (!values[5].contents.value.includes("demo.App")) throw new Error("hover failed");
if (values[6][0].range.start.line !== 3 || values[6][0].range.start.column !== 13) throw new Error("compact positions failed");
if (values[7][0].range.start.line !== 2 || values[7][0].range.start.character !== 12) throw new Error("raw positions failed");
if (!values[8].prepare || !values[8].edit) throw new Error("rename preview failed");
' "$starting" "$waited" "$status" "$symbols" "$outline" "$hover" "$definition" "$raw_definition" "$rename"

mkdir -p "$test_dir/servers/test/bin"
cp /bin/true "$test_dir/servers/test/bin/intellij-server"
printf '%s\n' 'Fake JetBrains agreement' > "$test_dir/servers/test/EULA.txt"
chmod 0755 "$test_dir/servers/test/bin/intellij-server"

launcher="$(
  IJ_LSP_METADATA_FILE="$repo_dir/tests/fixtures/server-bundle.json" \
  IJ_LSP_SERVER_DIR="$test_dir/servers" \
  IJ_LSP_STATE_DIR="$test_dir/installer-state" \
  "$repo_dir/files/home/.local/bin/ij-server-install"
)"
[[ "$launcher" == "$test_dir/servers/test/bin/intellij-server" ]]
[[ -L "$test_dir/installer-state/current" ]]
eula="$(find -L "$test_dir/installer-state/current" -maxdepth 4 -type f -name EULA.txt -print -quit)"
[[ "$eula" == "$test_dir/installer-state/current/EULA.txt" ]]
node -e '
const value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (value.serverVersion !== "test" || !value.targetPlatform.startsWith("linux-")) throw new Error("server info failed");
' "$test_dir/installer-state/server-info.json"

cli_home="$test_dir/home"
cli_state="$test_dir/cli-state"
cli_servers="$test_dir/cli-servers"
mkdir -p "$cli_home/.local/bin" "$cli_home/.local/lib/ij-lsp" "$cli_servers/test/bin" "$test_dir/project"
cp "$repo_dir/files/home/.local/bin/ij" "$repo_dir/files/home/.local/bin/ij-server-install" "$cli_home/.local/bin/"
cp "$repo_dir/files/home/.local/lib/ij-lsp/daemon.js" "$cli_home/.local/lib/ij-lsp/"
cp "$repo_dir/tests/fake-intellij-server.js" "$cli_servers/test/bin/intellij-server"
cp "$repo_dir/tests/fixtures/App.java" "$test_dir/project/App.java"
printf '%s\n' 'Fake JetBrains agreement' > "$cli_servers/test/EULA.txt"
chmod 0755 "$cli_home/.local/bin/ij" "$cli_home/.local/bin/ij-server-install" "$cli_home/.local/lib/ij-lsp/daemon.js" "$cli_servers/test/bin/intellij-server"

run_ij() {
  (cd "$test_dir/project" && \
    HOME="$cli_home" \
    IJ_LSP_ACCEPT_LICENSE=true \
    IJ_LSP_METADATA_FILE="$repo_dir/tests/fixtures/server-bundle.json" \
    IJ_LSP_SERVER_DIR="$cli_servers" \
    IJ_LSP_STATE_DIR="$cli_state" \
    "$cli_home/.local/bin/ij" "$@")
}

prepared="$(run_ij prepare)"
ready="$(run_ij ready 2)"
cli_status="$(run_ij status)"
cli_definition="$(run_ij definition App.java:3:13)"
node -e '
const values = process.argv.slice(1, 5).map(JSON.parse);
if (!values[0].prepared || values[0].serverStarted) throw new Error("prepare should not start IntelliJ");
if (!values[1].indexed) throw new Error("ij ready failed");
if (values[2].workspace !== process.argv[5] || values[2].state !== "ready") throw new Error("CLI workspace status failed");
if (values[3][0].range.start.line !== 3 || values[3][0].range.start.column !== 13) throw new Error("file:line:column failed");
' "$prepared" "$ready" "$cli_status" "$cli_definition" "$test_dir/project"
cli_daemon_pid="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).pid))' "$cli_status")"
node -e '
const value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (value.method !== "kit-argument" || !value.eulaHash) throw new Error("license acceptance ledger failed");
' "$cli_state/license-acceptance.json"

printf '%s\n' 'headless bridge smoke test passed'
