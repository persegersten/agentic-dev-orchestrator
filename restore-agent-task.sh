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

# Stop any active run first. GitHub and target workspace cleanup is manual.
npm run agent -- restore "$task_id"
