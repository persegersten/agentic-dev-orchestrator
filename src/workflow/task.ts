import type { Plan } from "./plan.js";
import { ValidationResult } from "./validator.js";
import type { WorkflowState } from "./workflow-state.js";
import { allowedTransitions } from "./workflow-state.js";

export interface Task {
  id: string;
  instruction: string;
  state: WorkflowState;

  threadId?: string;
  plan?: Plan;

  baseBranch?: string;
  branchName?: string;
  commitSha?: string;
  pullRequestUrl?: string;

  validation?: ValidationResult;

  createdAt: string;
  updatedAt: string;
}

export function transition(
  task: Task,
  target: WorkflowState,
): Task {

  const allowed = allowedTransitions[task.state];

  if (!allowed.includes(target)) {
    throw new Error(
      `Illegal transition ${task.state} -> ${target}`,
    );
  }

  return {
    ...task,
    state: target,
    updatedAt: new Date().toISOString(),
  };
}
