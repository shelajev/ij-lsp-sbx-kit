#!/usr/bin/env bash
set -euo pipefail

kit_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sandbox="${1:-ij-lsp-current}"
agent="${SBX_AGENT:-codex}"

if [[ $# -gt 0 ]]; then
  shift
fi

if [[ $# -eq 0 ]]; then
  set -- .
fi

exec sbx run --name "$sandbox" "$agent" --kit "$kit_dir" "$@"
