#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
socket="$test_dir/ij.sock"
log="$test_dir/daemon.log"
daemon_pid=

cleanup() {
  if [[ -n "$daemon_pid" ]]; then kill "$daemon_pid" 2>/dev/null || true; fi
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

status="$(request /v1/status)"
waited="$(request '/v1/wait?seconds=2')"
symbols="$(request '/v1/symbols?query=App')"
outline="$(request '/v1/outline?file=App.java')"
hover="$(request '/v1/hover?file=App.java&line=3&column=13')"
rename="$(request '/v1/rename-preview?file=App.java&line=3&column=13&newName=Application')"

node -e '
const values = process.argv.slice(1).map(JSON.parse);
if (!values[0].initialized || values[0].server !== "intellij") throw new Error("bad status");
if (!values[1].indexed) throw new Error("ready signal was not observed");
if (values[2][0].name !== "App") throw new Error("workspace symbols failed");
if (values[3][0].name !== "App") throw new Error("document symbols failed");
if (!values[4].contents.value.includes("demo.App")) throw new Error("hover failed");
if (!values[5].prepare || !values[5].edit) throw new Error("rename preview failed");
' "$status" "$waited" "$symbols" "$outline" "$hover" "$rename"

mkdir -p "$test_dir/bin" "$test_dir/extensions/jetbrains.intellij-server-test" "$test_dir/servers/test/bin"
ln -s "$(command -v node)" "$test_dir/bin/ij-node"
cp "$repo_dir/tests/fixtures/server-bundle.json" "$test_dir/extensions/jetbrains.intellij-server-test/server-bundle.json"
cp /bin/true "$test_dir/servers/test/bin/intellij-server"
printf '%s\n' 'Fake JetBrains agreement' > "$test_dir/servers/test/EULA.txt"
chmod 0755 "$test_dir/servers/test/bin/intellij-server"

launcher="$(
  PATH="$test_dir/bin:$PATH" \
  IJ_LSP_EXTENSION_ROOT="$test_dir/extensions" \
  IJ_LSP_SERVER_DIR="$test_dir/servers" \
  IJ_LSP_STATE_DIR="$test_dir/installer-state" \
  "$repo_dir/files/home/.local/bin/ij-server-install"
)"
[[ "$launcher" == "$test_dir/servers/test/bin/intellij-server" ]]
[[ -L "$test_dir/installer-state/current" ]]
eula="$(find -L "$test_dir/installer-state/current" -maxdepth 4 -type f -name EULA.txt -print -quit)"
[[ "$eula" == "$test_dir/installer-state/current/EULA.txt" ]]

printf '%s\n' 'headless bridge smoke test passed'
