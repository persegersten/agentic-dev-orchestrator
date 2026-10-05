#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ $# -ne 1 && $# -ne 3 ]] || [[ -z ${1//[[:space:]]/} ]]; then
  echo "Usage: $0 <task-id> [--model <model>]" >&2
  exit 64
fi
if [[ $# -eq 3 ]] && { [[ $2 != --model ]] || [[ -z ${3//[[:space:]]/} ]]; }; then
  echo "Usage: $0 <task-id> [--model <model>]" >&2
  exit 64
fi
# Explicit continuation approval. Stop any active run and review retained edits first.
npm run agent -- resume "$@" 2>&1 | tee -a run.agent.log
