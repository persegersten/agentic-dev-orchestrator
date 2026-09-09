import { afterEach, expect, it } from "vitest";
import { restoreTask } from "../../src/workflow/restore-task.js";
import {
  createTask,
  deleteTask,
  loadTask,
  saveTask,
} from "../../src/workflow/task-store.js";
import type { Task } from "../../src/workflow/task.js";
import type { WorkflowState } from "../../src/workflow/workflow-state.js";

const tasks: Task[] = [];
afterEach(async () => {
  await Promise.all(tasks.splice(0).map(deleteTask));
});

async function fixture(state: WorkflowState): Promise<Task> {
  const task: Task = {
    ...(await createTask("Fix implementation")),
    state,
    plan: { summary: "Fix implementation", files: [], steps: [], tests: [] },
    threadId: "thread-1",
    baseBranch: "main",
    branchName: "agent/test",
    commitSha: "abc123",
    pullRequestUrl: "https://github.com/example/repo/pull/1",
    validation: { success: false, output: "Failed tests" },
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  tasks.push(task);
  await saveTask(task);
  return task;
}

it.each<WorkflowState>([
  "FAILED",
  "CREATING_BRANCH",
  "IMPLEMENTING",
  "VALIDATING",
  "COMMITTING",
  "PUSHING",
  "CREATING_PR",
])("restores %s and persists only the retained metadata", async (state) => {
  const task = await fixture(state);
  const restored = await restoreTask(task.id);
  expect(restored).toEqual({
    id: task.id,
    instruction: task.instruction,
    plan: task.plan,
    threadId: task.threadId,
    createdAt: task.createdAt,
    updatedAt: expect.any(String),
    state: "AWAITING_APPROVAL",
  });
  expect(Date.parse(restored.updatedAt)).toBeGreaterThan(
    Date.parse(task.updatedAt),
  );
  expect(await loadTask(task.id)).toEqual(restored);
});

it.each<WorkflowState>(["RECEIVED", "PLANNING", "COMPLETED"])(
  "rejects %s without changing storage",
  async (state) => {
    const task = await fixture(state);
    await expect(restoreTask(task.id)).rejects.toThrow("cannot be restored");
    expect(await loadTask(task.id)).toEqual(task);
  },
);

it.each([
  { plan: undefined },
  { plan: { summary: " ", files: [], steps: [], tests: [] } },
  { threadId: undefined },
  { threadId: " " },
])("rejects missing retry prerequisites: %j", async (override) => {
  const task = { ...(await fixture("FAILED")), ...override };
  await saveTask(task);
  const before = await loadTask(task.id);
  await expect(restoreTask(task.id)).rejects.toThrow();
  expect(await loadTask(task.id)).toEqual(before);
});

it("leaves a task awaiting approval unchanged", async () => {
  const task = await fixture("AWAITING_APPROVAL");
  expect(await restoreTask(task.id)).toEqual(task);
  expect(await loadTask(task.id)).toEqual(task);
});

it.each(["", " ", "../outside", "a/b", "a\\b"])(
  "rejects invalid task id %j",
  async (id) => {
    await expect(restoreTask(id)).rejects.toThrow("valid task id");
  },
);

it("reports a missing task", async () => {
  await expect(restoreTask("missing-restore-task")).rejects.toThrow("ENOENT");
});
