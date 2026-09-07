import { afterEach, describe, expect, it } from "vitest";

import {
  createTask,
  deleteTask,
  loadTask,
  saveTask,
} from "../../src/workflow/task-store.js";
import type { Task } from "../../src/workflow/task.js";
import { WorkflowState } from "../../src/workflow/workflow-state.js";

const tasks: Task[] = [];

afterEach(async () => {
  await Promise.all(tasks.splice(0).map(deleteTask));
});

async function newTask(): Promise<Task> {
  const task = await createTask("Test workflow persistence");
  tasks.push(task);
  return task;
}

const metadata = {
  baseBranch: "main",
  branchName: "task/persistence-test",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  pullRequestUrl: "https://github.com/example/repo/pull/42",
};

describe("task storage", () => {
  it("round-trips tasks without optional Git metadata", async () => {
    const task = await newTask();

    expect(await loadTask(task.id)).toEqual(task);
    for (const field of Object.keys(metadata)) {
      expect(task).not.toHaveProperty(field);
    }
  });

  it.each(Object.entries(metadata))("persists %s", async (field, value) => {
    const task = { ...(await newTask()), [field]: value };

    await saveTask(task);

    expect(await loadTask(task.id)).toEqual(task);
    expect(await loadTask(task.id)).toHaveProperty(field, value);
  });

  it.each(Object.values(WorkflowState))(
    "preserves all metadata when saving state %s",
    async (state) => {
      const task = { ...(await newTask()), ...metadata };
      await saveTask(task);

      const updated = { ...(await loadTask(task.id)), state };
      await saveTask(updated);

      expect(await loadTask(task.id)).toEqual(updated);
    },
  );
});
