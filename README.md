# Agent task workflow

Install dependencies with `npm ci`. Configure Codex authentication, Git commit
identity and push credentials, a writable `origin`, and authenticated GitHub CLI
(`gh auth login`). The target needs an executable `backend/mvnw` and the Java
environment required to run `./mvnw test` from its `backend` directory.

When `backend/pom.xml` declares `org.testcontainers`, validation first runs
`docker info` with a 15-second timeout. Docker must be accessible from the
orchestrator's environment; on Windows/WSL, enable Docker Desktop's WSL
integration for that distribution. A failed check stops validation before Maven
and reports setup guidance. Dependencies declared only in parent or module POMs
are not detected by this check; Maven still reports their Testcontainers errors.

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
task is awaiting approval and performs the lifecycle below.

Both stdout and stderr are streamed to stdout and appended to `run.agent.log`
in the orchestrator directory, including crash stack traces. Previous runs are
retained, and a failed run still returns a nonzero exit status.

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
no workspace lock. Failed/interrupted runs require explicit recovery, and
existing changes are never reset or stashed. Inspect retained changes and any
remote PR before retrying an ambiguous failure. Successful runs leave the task
branch checked out; select the intended base branch before starting a new task.

To continue a failed or interrupted implementation or validation, stop any active
run, review retained changes, and leave the original task branch checked out:

```bash
export AGENT_WORKSPACE=/absolute/path/to/target-repository
./resume-agent-task.sh <task-id>
# Optional model override, persisted for subsequent resumes:
./resume-agent-task.sh <task-id> --model <available-model>
# Equivalent: npm run agent -- resume <task-id> [--model <available-model>]
```

Resume is explicit approval to continue the saved plan through validation, commit,
push, and PR creation. It preserves local changes, the Codex thread, and the original
base/task branch; it does not create a new branch or re-plan. Implementation resumes
inspect existing changes before continuing. Validation resumes rerun validation
without repeating implementation; fix any failing tests before retrying validation.
New executions persist the canonical workspace path and failure step/message/time.
Resume rejects a different saved workspace, wrong branch, invalid plan/thread,
and completed tasks. Commit recovery requires saved successful validation and
pending changes. Push and PR recovery require a clean workspace with HEAD matching
the saved commit; they skip implementation and validation. PR recovery checks for
an existing PR with the same branches and commit before creating one. Push rejection
due to diverged history still requires manual inspection; recovery never force-pushes.
If a commit succeeded before its SHA was saved, inspect Git history manually rather
than retrying implementation or creating another commit.

Commit messages use a subject of at most 72 Unicode characters and preserve longer
summaries in the body, sent to Git through stdin. PR descriptions include bounded
excerpts of the instruction, plan, and validation log, with explicit truncation
markers. Full content remains in `.agent/tasks/<task-id>.json`.

Older failed tasks without failure metadata can resume implementation when their
base/task branch metadata remains and no validation, commit, or PR metadata exists.
For these legacy records the supplied workspace and checked-out task branch are
verified, but the original workspace and failed step cannot be independently
confirmed. Verify the log first. Resume has no workspace lock: do not run it alongside
another execution or include unrelated edits, since commit stages all changes.
The latest failure remains saved for inspection even after successful recovery.

To restart a failed or interrupted execution from branch creation instead, first
stop any active run, then run:

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
bash -n plan-agent-task.sh run-approved-agent-task.sh restore-agent-task.sh resume-agent-task.sh
```
