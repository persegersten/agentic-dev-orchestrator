import { z } from "zod";

export const planSchema = z.object({
  summary: z.string(),
  affectedComponents: z.array(z.string()),
  implementationSteps: z.array(z.string()),
  requiredTests: z.array(z.string()),
  risks: z.array(z.string()),
});

export type Plan = z.infer<typeof planSchema>;