#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 \"<task instruction>\"" >&2
  exit 64
fi

instruction=$1

if [[ -z ${instruction//[[:space:]]/} ]]; then
  echo "Error: task instruction must not be empty." >&2
  exit 64
fi

create_output=$(npm run agent -- create "$instruction")
printf '%s\n' "$create_output"

task_id=$(sed -n 's/^Task created: //p' <<<"$create_output" | tail -n 1)

if [[ -z $task_id ]]; then
  echo "Error: could not determine the task ID from the create command." >&2
  exit 1
fi

npm run agent -- plan "$task_id"
npm run agent -- approve "$task_id"
npm run agent -- implement "$task_id"
