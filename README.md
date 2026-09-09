# Agent task workflow

Install dependencies with `npm ci`. Configure Codex authentication, Git commit
identity and push credentials, a writable `origin`, and authenticated GitHub CLI
(`gh auth login`). The target needs an executable `backend/mvnw` and the Java
environment required to run `./mvnw test` from its `backend` directory.

```bash
export AGENT_WORKSPACE=/absolute/path/to/target-repository
./plan-agent-task.sh "Add reverse movement to vehicles"
```

This creates a task, prints the read-only plan and task ID, and stops at
`AWAITING_APPROVAL`. Review the plan before continuing:

```bash
./run-approved-agent-task.sh <task-id>
```

Running the second script is explicit approval. There is no second prompt and
no automatic re-planning. The TypeScript orchestrator verifies that the existing
task is awaiting approval and performs the lifecycle:

```text
RECEIVED → PLANNING → AWAITING_APPROVAL
                      [human review and approval script]
→ CREATING_BRANCH → IMPLEMENTING → VALIDATING
→ COMMITTING → PUSHING → CREATING_PR → COMPLETED
```

Completion prints the task ID, branch, commit SHA, PR URL, and final state.
PR review and merge remain manual. The old `run-agent-task.sh` is replaced by
the two scripts above; the separate CLI `implement` command is retired.

Both wrappers run from their own directory, keeping task records in
`.agent/tasks/<task-id>.json`. Use the same `AGENT_WORKSPACE` for both commands;
it defaults to `../agentic-spring-lab` relative to the orchestrator. Planning
writes orchestrator task records, not target repository files.

Approval captures the currently checked-out base branch and rejects existing
local changes. Codex resumes on `agent/<task-id>` with `workspace-write` and is
instructed not to perform Git/GitHub lifecycle operations. The orchestrator
validates, commits, pushes only the task branch, and creates a PR to the captured
base. Failed validation prevents commit, push, and PR creation.

Run one task per workspace at a time and avoid concurrent user edits: there is
no workspace lock. Failed/interrupted runs do not resume automatically, and
existing changes are never reset or stashed. Inspect retained changes and any
remote PR before retrying an ambiguous failure. Successful runs leave the task
branch checked out; select the intended base branch before starting a new task.

To retry a failed or interrupted execution, first stop any active run, then run:

```bash
./restore-agent-task.sh <task-id>
# Equivalent: npm run agent -- restore <task-id>
```

Restore returns `FAILED` or an execution state from `CREATING_BRANCH` through
`CREATING_PR` to `AWAITING_APPROVAL`. It requires a valid saved plan and Codex
thread ID. Tasks already awaiting approval are unchanged; completed tasks and
tasks still being planned are rejected. The saved plan, thread ID, instruction,
task ID, and creation time are preserved. Execution metadata (base branch, task
branch, commit, PR URL, and validation) is cleared from the task record.

You are responsible for cleaning up GitHub and the target source folder before
retrying: inspect any existing PR or remote branch, resolve retained local
changes, check out the intended base branch, and remove conflicting task
branches (`agent/<task-id>`) as needed. Restore only updates the task record;
it does not perform cleanup, re-plan, or start implementation. There is no lock,
so never restore a task while its execution is running. After cleanup and review,
run `./run-approved-agent-task.sh <task-id>` to explicitly approve a fresh execution
of the saved plan.

Tests mock Codex and GitHub commands and use temporary local Git repositories
(including a local bare origin). They do not create real GitHub PRs.

```bash
npm test
npm run typecheck
npm run lint
npm run format
bash -n plan-agent-task.sh run-approved-agent-task.sh restore-agent-task.sh
```
