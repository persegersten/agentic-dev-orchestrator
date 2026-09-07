#!/usr/bin/env bash

set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <task-id>" >&2
  exit 64
fi

task_id=$1

if [[ -z ${task_id//[[:space:]]/} ]]; then
  echo "Error: task id must not be empty." >&2
  exit 64
fi

# Running this script explicitly approves the persisted plan.
# State checks and the entire lifecycle belong to the TypeScript orchestrator.
npm run agent -- approve "$task_id"
