import { z } from "zod";

export const PlanSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()),
  steps: z.array(z.string()),
  tests: z.array(z.string()),
});

export type Plan = z.infer<typeof PlanSchema>;