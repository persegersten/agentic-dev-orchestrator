export const WorkflowState = {
  RECEIVED: "RECEIVED",
  PLANNING: "PLANNING",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  CREATING_BRANCH: "CREATING_BRANCH",
  IMPLEMENTING: "IMPLEMENTING",
  VALIDATING: "VALIDATING",
  COMMITTING: "COMMITTING",
  PUSHING: "PUSHING",
  CREATING_PR: "CREATING_PR",
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
    "CREATING_BRANCH",
    "FAILED",
  ],

  CREATING_BRANCH: [
    "IMPLEMENTING",
    "FAILED",
  ],

  IMPLEMENTING: [
    "VALIDATING",
    "FAILED",
  ],

  VALIDATING: [
    "COMMITTING",
    "FAILED",
  ],

  COMMITTING: [
    "PUSHING",
    "FAILED",
  ],

  PUSHING: [
    "CREATING_PR",
    "FAILED",
  ],

  CREATING_PR: [
    "COMPLETED",
    "FAILED",
  ],

  COMPLETED: [],
  FAILED: [],
};

export type WorkflowState =
  (typeof WorkflowState)[keyof typeof WorkflowState];
