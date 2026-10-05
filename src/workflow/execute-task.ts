import { realpath } from "node:fs/promises";
import { PlanSchema } from "./plan.js";
import { reportProgress } from "./progress.js";
import {
  assertWorkspaceClean,
  commitChanges,
  createTaskBranch,
  getCurrentBranch,
  getTaskBranchName,
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
  return executeTask(taskId, workspace);
}

/** Explicit recovery of implementation/validation; stop any active run first. */
export async function resumeTask(
  taskId: string,
  workspace: string,
  model?: string,
): Promise<Task> {
  return executeTask(taskId, workspace, { model });
}

async function executeTask(
  taskId: string,
  workspace: string,
  recovery?: { model?: string },
): Promise<Task> {
  if (!taskId.trim() || /[/\\]/.test(taskId) || taskId === "..") {
    throw new Error("A valid task id is required");
  }
  let task = await loadTask(taskId);
  let resumeState: "IMPLEMENTING" | "VALIDATING" | undefined;
  if (recovery) {
    if (!["FAILED", "IMPLEMENTING", "VALIDATING"].includes(task.state)) {
      throw new Error(`Task ${task.id} cannot resume from ${task.state}`);
    }
    // Older records did not persist the failed step. Only infer implementation
    // when branch metadata exists and no later lifecycle artifacts are present.
    const step =
      task.state === "FAILED"
        ? (task.failure?.state ??
          (task.validation ? "UNKNOWN" : "IMPLEMENTING"))
        : task.state;
    if (
      !["IMPLEMENTING", "VALIDATING"].includes(step) ||
      task.commitSha ||
      task.pullRequestUrl
    ) {
      throw new Error(
        "Resume supports implementation and validation only; inspect later Git/GitHub failures manually",
      );
    }
    if (
      !PlanSchema.safeParse(task.plan).success ||
      !task.plan?.summary.trim() ||
      !task.threadId?.trim()
    ) {
      throw new Error("Resume requires a valid saved plan and Codex threadId");
    }
    if (
      !task.baseBranch ||
      task.branchName !== getTaskBranchName(task.id) ||
      task.baseBranch === task.branchName
    ) {
      throw new Error(
        "Resume requires the original base branch and task branch metadata",
      );
    }
    const actualWorkspace = await realpath(workspace);
    if (
      task.workspace &&
      (await realpath(task.workspace)) !== actualWorkspace
    ) {
      throw new Error("Resume workspace does not match the saved workspace");
    }
    if ((await getCurrentBranch(workspace)) !== task.branchName) {
      throw new Error(
        "Resume requires the original task branch to be checked out",
      );
    }
    if (recovery.model !== undefined && !recovery.model.trim()) {
      throw new Error("Model must not be empty");
    }
    resumeState = step as "IMPLEMENTING" | "VALIDATING";
    task = {
      ...task,
      workspace: actualWorkspace,
      model: recovery.model ?? task.model,
    };
  }
  if (!recovery && task.state !== "AWAITING_APPROVAL") {
    throw new Error(
      `Task ${task.id} requires AWAITING_APPROVAL; current state is ${task.state}`,
    );
  }

  const started = Date.now();
  reportProgress(`Task approved: ${task.id}; workspace: ${workspace}`);

  async function advance(state: WorkflowState): Promise<void> {
    const next = transition(task, state);
    await saveTask(next);
    task = next;
    reportProgress(
      `[${state}] elapsed ${Math.floor((Date.now() - started) / 1000)}s`,
    );
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

    if (resumeState) {
      // Recovery is separate from normal forward-only transitions. Preserve edits.
      const resumed = {
        ...task,
        state: resumeState,
        updatedAt: new Date().toISOString(),
      };
      await saveTask(resumed);
      task = resumed;
      reportProgress(`Resuming ${resumeState} on ${task.branchName}`);
    } else {
      task = {
        ...task,
        workspace: await realpath(workspace),
        baseBranch: await getCurrentBranch(workspace),
      };
      reportProgress(`Base branch: ${task.baseBranch}; checking workspace`);
      await assertWorkspaceClean(workspace);
      await advance("CREATING_BRANCH");
      task = { ...task, branchName: await createTaskBranch(task, workspace) };
      reportProgress(`Task branch: ${task.branchName}`);
      await advance("IMPLEMENTING");
    }
    if (task.state === "IMPLEMENTING") {
      await requireTaskBranch();
      await runImplementer(task, workspace);

      await advance("VALIDATING");
    }
    await requireTaskBranch();
    const validation = await validateWorkspace(workspace);
    task = { ...task, validation };
    await saveTask(task);
    if (!validation.success) {
      throw new Error(`Validation failed: ${validation.output}`);
    }

    await advance("COMMITTING");
    task = { ...task, commitSha: await commitChanges(task, workspace) };
    reportProgress(`Commit: ${task.commitSha}`);
    await advance("PUSHING");
    await pushBranch(task, workspace);
    await advance("CREATING_PR");
    task = {
      ...task,
      pullRequestUrl: await createPullRequest(task, workspace),
    };
    reportProgress(`Pull request: ${task.pullRequestUrl}`);
    await advance("COMPLETED");
    return task;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const error = new Error(
      `Task ${task.id} failed during ${task.state}: ${detail}`,
      { cause },
    );
    task = {
      ...task,
      failure: {
        state:
          task.state === "FAILED" ? (resumeState ?? task.state) : task.state,
        message: detail,
        at: new Date().toISOString(),
      },
    };
    try {
      if (task.state === "FAILED") {
        await saveTask({ ...task, updatedAt: new Date().toISOString() });
      } else {
        await advance("FAILED");
      }
    } catch (persistenceError) {
      throw new AggregateError(
        [error, persistenceError],
        `${error.message}; could not persist FAILED state`,
      );
    }
    throw error;
  }
}
