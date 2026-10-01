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
# Capture stderr too, including progress messages and crash stack traces.
# pipefail preserves a failed orchestrator's exit status even when tee succeeds.
npm run agent -- approve "$task_id" 2>&1 | tee -a run.agent.log
