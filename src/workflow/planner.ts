import { runCodex } from "../codex/runCodex.js";
import { planSchema, type Plan } from "../validation/planSchema.js";

export async function planChange(
  issue: string,
  workspace: string,
): Promise<Plan> {

  const instruction = `
You are a software change planner.

Inspect the repository carefully before producing the plan.

Do not modify, create, rename or delete any files.

Requested change:

${issue}

Return ONLY valid JSON using this structure:

{
  "summary": "string",
  "affectedComponents": ["string"],
  "implementationSteps": ["string"],
  "requiredTests": ["string"],
  "risks": ["string"]
}
`;

  const result = await runCodex(instruction, workspace);

  const parsedJson = JSON.parse(result.finalResponse);

  return planSchema.parse(parsedJson);
}