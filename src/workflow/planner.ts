import { runCodex } from "../codex/runCodex.js";
import { PlanSchema, type Plan } from "./plan.js";

export type PlannerResult = {
  response: Plan;
  threadId: string;
};

export async function planChange(
  issue: string,
  workspace: string,
): Promise<PlannerResult> {

  const instruction = `
You are a software change planner.

Inspect the repository carefully before producing the plan.

Do not modify, create, rename or delete any files.
Do not create or switch branches, commit, push, create pull requests, merge, or approve pull requests.
The orchestrator owns Git and GitHub lifecycle operations.

Requested change:

${issue}

Return ONLY valid JSON using this structure:

{
  "summary": "string",
  "files": ["string"],
  "steps": ["string"],
  "tests": ["string"]
}
`;

  const result = await runCodex(instruction, workspace);

  const parsedJson = JSON.parse(result.finalResponse);

  return {
    response: PlanSchema.parse(parsedJson),
    threadId: result.threadId,
  };
}
