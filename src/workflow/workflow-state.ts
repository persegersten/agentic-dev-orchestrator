export const WorkflowState = {
  RECEIVED: "RECEIVED",
  PLANNING: "PLANNING",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  IMPLEMENTING: "IMPLEMENTING",
  VALIDATING: "VALIDATING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export const allowedTransitions: Record<WorkflowState, WorkflowState[]> = {
  RECEIVED: ["PLANNING"],

  PLANNING: [
    "AWAITING_APPROVAL",
    "FAILED",
  ],

  AWAITING_APPROVAL: [
    "IMPLEMENTING",
    "FAILED",
  ],

  IMPLEMENTING: [
    "VALIDATING",
    "FAILED",
  ],

  VALIDATING: [
    "COMPLETED",
    "FAILED",
  ],

  COMPLETED: [],
  FAILED: [],
};

export type WorkflowState =
  (typeof WorkflowState)[keyof typeof WorkflowState];
  