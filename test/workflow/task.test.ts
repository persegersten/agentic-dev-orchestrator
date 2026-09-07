import { describe, expect, it } from "vitest";

import { transition, type Task } from "../../src/workflow/task.js";
import { WorkflowState } from "../../src/workflow/workflow-state.js";

const flow = [
  "RECEIVED",
  "PLANNING",
  "AWAITING_APPROVAL",
  "CREATING_BRANCH",
  "IMPLEMENTING",
  "VALIDATING",
  "COMMITTING",
  "PUSHING",
  "CREATING_PR",
  "COMPLETED",
] as const;

function taskIn(state: WorkflowState): Task {
  return {
    id: "transition-test",
    instruction: "Extend the workflow model",
    state,
    baseBranch: "main",
    branchName: "task/transition-test",
    commitSha: "abc123",
    pullRequestUrl: "https://github.com/example/repo/pull/1",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

const validPairs: [WorkflowState, WorkflowState][] = flow
  .slice(0, -1)
  .map((state, index) => [state, flow[index + 1]!]);

for (const state of flow.slice(1, -1)) {
  validPairs.push([state, "FAILED"]);
}

const invalidPairs = Object.values(WorkflowState).flatMap((from) =>
  Object.values(WorkflowState)
    .filter((to) => !validPairs.some(([a, b]) => a === from && b === to))
    .map((to): [WorkflowState, WorkflowState] => [from, to]),
);

describe("transition", () => {
  it.each(validPairs)("allows %s -> %s", (from, to) => {
    const task = taskIn(from);
    const result = transition(task, to);

    expect(result).toEqual({
      ...task,
      state: to,
      updatedAt: expect.any(String),
    });
    expect(Date.parse(result.updatedAt)).toBeGreaterThan(
      Date.parse(task.updatedAt),
    );
    expect(task).toEqual(taskIn(from));
  });

  it.each(invalidPairs)("rejects %s -> %s", (from, to) => {
    expect(() => transition(taskIn(from), to)).toThrow(
      `Illegal transition ${from} -> ${to}`,
    );
  });
});
