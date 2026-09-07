import {
  assertWorkspaceClean,
  commitChanges,
  createTaskBranch,
  getCurrentBranch,
  pushBranch,
} from "../git/git-service.js";
import { createPullRequest } from "../github/pull-request-service.js";
import { runImplementer } from "./implementer.js";
import { loadTask, saveTask } from "./task-store.js";
import { transition, type Task } from "./task.js";
import { validateWorkspace } from "./validator.js";
import type { WorkflowState } from "./workflow-state.js";

/** Called only by an explicit approval action; does not resume partial runs. */
export async function executeApprovedTask(
  taskId: string,
  workspace: string,
): Promise<Task> {
  let task = await loadTask(taskId);
  if (task.state !== "AWAITING_APPROVAL") {
    throw new Error(
      `Task ${task.id} requires AWAITING_APPROVAL; current state is ${task.state}`,
    );
  }

  async function advance(state: WorkflowState): Promise<void> {
    const next = transition(task, state);
    await saveTask(next);
    task = next;
  }

  async function requireTaskBranch(): Promise<void> {
    if ((await getCurrentBranch(workspace)) !== task.branchName) {
      throw new Error("Workspace is no longer on the task branch");
    }
  }

  try {
    if (!task.plan?.summary.trim())
      throw new Error("Task has no approved plan summary");
    if (!task.threadId) throw new Error("Task has no Codex threadId");

    task = { ...task, baseBranch: await getCurrentBranch(workspace) };
    await assertWorkspaceClean(workspace);
    await advance("CREATING_BRANCH");
    task = { ...task, branchName: await createTaskBranch(task, workspace) };
    await advance("IMPLEMENTING");
    await requireTaskBranch();
    await runImplementer(task, workspace);

    await advance("VALIDATING");
    await requireTaskBranch();
    const validation = await validateWorkspace(workspace);
    task = { ...task, validation };
    await saveTask(task);
    if (!validation.success) {
      throw new Error(`Validation failed: ${validation.output}`);
    }

    await advance("COMMITTING");
    task = { ...task, commitSha: await commitChanges(task, workspace) };
    await advance("PUSHING");
    await pushBranch(task, workspace);
    await advance("CREATING_PR");
    task = {
      ...task,
      pullRequestUrl: await createPullRequest(task, workspace),
    };
    await advance("COMPLETED");
    return task;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const error = new Error(
      `Task ${task.id} failed during ${task.state}: ${detail}`,
      { cause },
    );
    try {
      await advance("FAILED");
    } catch (persistenceError) {
      throw new AggregateError(
        [error, persistenceError],
        `${error.message}; could not persist FAILED state`,
      );
    }
    throw error;
  }
}
