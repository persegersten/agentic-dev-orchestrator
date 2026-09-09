import { PlanSchema } from "./plan.js";
import { loadTask, saveTask } from "./task-store.js";
import type { Task } from "./task.js";
import type { WorkflowState } from "./workflow-state.js";

const restorableStates: WorkflowState[] = [
  "FAILED",
  "CREATING_BRANCH",
  "IMPLEMENTING",
  "VALIDATING",
  "COMMITTING",
  "PUSHING",
  "CREATING_PR",
];

/** Explicit recovery only; the caller must stop any active run first. */
export async function restoreTask(taskId: string): Promise<Task> {
  if (!taskId.trim() || /[/\\]/.test(taskId) || taskId === "..") {
    throw new Error("A valid task id is required");
  }

  const task = await loadTask(taskId);
  if (
    task.state !== "AWAITING_APPROVAL" &&
    !restorableStates.includes(task.state)
  ) {
    throw new Error(
      `Task ${task.id} cannot be restored from state ${task.state}`,
    );
  }
  const plan = PlanSchema.safeParse(task.plan);
  if (!plan.success || !plan.data.summary.trim()) {
    throw new Error(`Task ${task.id} has no valid saved plan`);
  }
  if (!task.threadId?.trim()) {
    throw new Error(`Task ${task.id} has no Codex threadId`);
  }
  if (task.state === "AWAITING_APPROVAL") return task;

  // Recovery is separate from the normal forward-only execution transitions.
  const restored: Task = {
    ...task,
    state: "AWAITING_APPROVAL",
    updatedAt: new Date().toISOString(),
  };
  delete restored.baseBranch;
  delete restored.branchName;
  delete restored.commitSha;
  delete restored.pullRequestUrl;
  delete restored.validation;
  await saveTask(restored);
  return restored;
}
