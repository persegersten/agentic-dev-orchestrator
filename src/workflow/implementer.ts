import { runResumedCodex } from "../codex/runCodex.js";
import { PlanSchema, type Plan } from "./plan.js";
import { type Task } from "./task.js";

export async function runImplementer(task: Task, workspace: string): Promise<void> {

  if (!task.threadId) {
  throw new Error(`Task ${task.id} has no threadId`);
  }


  if (!task.plan) {
    throw new Error(
      `Task ${task.id} has no approved plan`
    );
  }

  const result = await runResumedCodex(task.threadId,
    buildImplementationPrompt(task),
    workspace);

   // TODO return result to the task or somewhere else for later inspection
    
}

export function buildImplementationPrompt(task: Task): string {
  

  return `
Implement the approved plan for this task.

Original instruction:
${task.instruction}

Approved plan:
${JSON.stringify(task.plan, null, 2)}

Requirements:
- Follow the approved plan.
- Keep changes within the scope of the plan.
- Modify the repository as needed to implement the plan.
- Add or update tests described by the plan.
- Do not redesign or expand the task beyond the approved plan.
- If the plan cannot be implemented as written, stop and explain why instead of making substantial unplanned changes.
`.trim();
}