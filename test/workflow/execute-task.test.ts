import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../src/workflow/task.js";
import { WorkflowState } from "../../src/workflow/workflow-state.js";

const mocks = vi.hoisted(() => ({
  loadTask: vi.fn(),
  saveTask: vi.fn(),
  getCurrentBranch: vi.fn(),
  getTaskBranchName: vi.fn(),
  assertWorkspaceClean: vi.fn(),
  createTaskBranch: vi.fn(),
  runImplementer: vi.fn(),
  validateWorkspace: vi.fn(),
  commitChanges: vi.fn(),
  pushBranch: vi.fn(),
  createPullRequest: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ realpath: async (path: string) => path }));
vi.mock("../../src/workflow/task-store.js", () => mocks);
vi.mock("../../src/git/git-service.js", () => mocks);
vi.mock("../../src/workflow/implementer.js", () => mocks);
vi.mock("../../src/workflow/validator.js", () => mocks);
vi.mock("../../src/github/pull-request-service.js", () => mocks);

import {
  executeApprovedTask,
  resumeTask,
} from "../../src/workflow/execute-task.js";

let input: Task;
let saved: Task[];
let events: string[];
const workspace = "/isolated/workspace";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getTaskBranchName.mockImplementation((id: string) => `agent/${id}`);
  saved = [];
  events = [];
  input = {
    id: "execution-test",
    instruction: "Fix parser",
    state: "AWAITING_APPROVAL",
    threadId: "thread-123",
    plan: { summary: "Fix parser", files: [], steps: [], tests: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  mocks.loadTask.mockImplementation(async () => structuredClone(input));
  mocks.saveTask.mockImplementation(async (task: Task) => {
    saved.push(structuredClone(task));
    events.push(`save:${task.state}`);
  });
  mocks.getCurrentBranch
    .mockResolvedValue("agent/execution-test")
    .mockResolvedValueOnce("development");
  for (const name of [
    "assertWorkspaceClean",
    "createTaskBranch",
    "runImplementer",
    "validateWorkspace",
    "commitChanges",
    "pushBranch",
    "createPullRequest",
  ] as const) {
    mocks[name].mockImplementation(async () => {
      events.push(name);
      return {
        assertWorkspaceClean: undefined,
        createTaskBranch: "agent/execution-test",
        runImplementer: undefined,
        validateWorkspace: { success: true, output: "Tests passed" },
        commitChanges: "abc123",
        pushBranch: undefined,
        createPullRequest: "https://github.com/example/repo/pull/42",
      }[name];
    });
  }
});

describe("executeApprovedTask", () => {
  it.each(
    Object.values(WorkflowState).filter(
      (state) => state !== "AWAITING_APPROVAL",
    ),
  )("rejects execution from %s without side effects", async (state) => {
    input.state = state;
    await expect(executeApprovedTask(input.id, workspace)).rejects.toThrow(
      "requires AWAITING_APPROVAL",
    );
    expect(mocks.getCurrentBranch).not.toHaveBeenCalled();
    expect(mocks.saveTask).not.toHaveBeenCalled();
    expect(mocks.runImplementer).not.toHaveBeenCalled();
  });

  it("persists the ordered lifecycle and all produced metadata", async () => {
    const result = await executeApprovedTask(input.id, workspace);
    expect(events).toEqual([
      "assertWorkspaceClean",
      "save:CREATING_BRANCH",
      "createTaskBranch",
      "save:IMPLEMENTING",
      "runImplementer",
      "save:VALIDATING",
      "validateWorkspace",
      "save:VALIDATING",
      "save:COMMITTING",
      "commitChanges",
      "save:PUSHING",
      "pushBranch",
      "save:CREATING_PR",
      "createPullRequest",
      "save:COMPLETED",
    ]);
    expect(saved[0]).toMatchObject({
      state: "CREATING_BRANCH",
      baseBranch: "development",
    });
    expect(saved[1]).toMatchObject({
      state: "IMPLEMENTING",
      branchName: "agent/execution-test",
    });
    expect(
      saved.find((task) => task.state === "COMMITTING")?.validation?.success,
    ).toBe(true);
    expect(saved.find((task) => task.state === "PUSHING")?.commitSha).toBe(
      "abc123",
    );
    expect(result).toEqual(saved.at(-1));
    expect(result).toMatchObject({
      instruction: input.instruction,
      plan: input.plan,
      threadId: input.threadId,
      state: "COMPLETED",
      baseBranch: "development",
      branchName: "agent/execution-test",
      validation: { success: true, output: "Tests passed" },
      commitSha: "abc123",
      pullRequestUrl: "https://github.com/example/repo/pull/42",
    });
    for (const name of [
      "createTaskBranch",
      "runImplementer",
      "commitChanges",
      "pushBranch",
      "createPullRequest",
    ] as const) {
      expect(mocks[name]).toHaveBeenCalledWith(
        expect.objectContaining({ id: input.id }),
        workspace,
      );
    }
    expect(mocks.validateWorkspace).toHaveBeenCalledWith(workspace);
    expect(input.state).toBe("AWAITING_APPROVAL");
  });

  it("stops on dirty workspace before creating a branch or running Codex", async () => {
    mocks.assertWorkspaceClean.mockRejectedValue(
      new Error("Workspace has local changes"),
    );
    await expect(executeApprovedTask(input.id, workspace)).rejects.toThrow(
      "local changes",
    );
    expect(mocks.createTaskBranch).not.toHaveBeenCalled();
    expect(mocks.runImplementer).not.toHaveBeenCalled();
    expect(saved.at(-1)?.state).toBe("FAILED");
  });

  const operations = [
    "getCurrentBranch",
    "assertWorkspaceClean",
    "createTaskBranch",
    "runImplementer",
    "validateWorkspace",
    "commitChanges",
    "pushBranch",
    "createPullRequest",
  ] as const;
  it.each(operations)(
    "stops after %s failure and preserves its cause",
    async (name) => {
      const cause = new Error(`${name} failed`);
      mocks[name].mockReset().mockRejectedValue(cause);
      const result = executeApprovedTask(input.id, workspace);
      await expect(result).rejects.toThrow(cause.message);
      await expect(result).rejects.toHaveProperty("cause", cause);
      for (const next of operations.slice(operations.indexOf(name) + 1)) {
        expect(mocks[next]).not.toHaveBeenCalled();
      }
      expect(saved.at(-1)?.state).toBe("FAILED");
      expect(saved.some((task) => task.state === "COMPLETED")).toBe(false);
    },
  );

  it("persists failed validation and never commits, pushes or creates a PR", async () => {
    const validation = { success: false, output: "Maven test failure" };
    mocks.validateWorkspace.mockResolvedValue(validation);
    await expect(executeApprovedTask(input.id, workspace)).rejects.toThrow(
      "Maven test failure",
    );
    expect(saved.at(-1)).toMatchObject({ state: "FAILED", validation });
    expect(mocks.commitChanges).not.toHaveBeenCalled();
    expect(mocks.pushBranch).not.toHaveBeenCalled();
    expect(mocks.createPullRequest).not.toHaveBeenCalled();
  });

  it.each(["plan", "threadId"] as const)(
    "rejects missing %s before Git changes",
    async (field) => {
      delete input[field];
      await expect(executeApprovedTask(input.id, workspace)).rejects.toThrow();
      expect(mocks.createTaskBranch).not.toHaveBeenCalled();
      expect(mocks.runImplementer).not.toHaveBeenCalled();
      expect(saved.at(-1)?.state).toBe("FAILED");
    },
  );

  it("refuses to implement if branch creation did not leave the task branch checked out", async () => {
    mocks.getCurrentBranch.mockReset().mockResolvedValue("development");
    await expect(executeApprovedTask(input.id, workspace)).rejects.toThrow(
      "no longer on the task branch",
    );
    expect(mocks.runImplementer).not.toHaveBeenCalled();
  });

  it("stops before validation if the branch changed during implementation", async () => {
    mocks.getCurrentBranch
      .mockReset()
      .mockResolvedValueOnce("development")
      .mockResolvedValueOnce("agent/execution-test")
      .mockResolvedValueOnce("other");
    await expect(executeApprovedTask(input.id, workspace)).rejects.toThrow(
      "no longer on the task branch",
    );
    expect(mocks.validateWorkspace).not.toHaveBeenCalled();
    expect(mocks.commitChanges).not.toHaveBeenCalled();
  });

  it("does not continue when progress cannot be persisted", async () => {
    mocks.saveTask.mockRejectedValueOnce(new Error("disk full"));
    await expect(executeApprovedTask(input.id, workspace)).rejects.toThrow(
      "disk full",
    );
    expect(mocks.createTaskBranch).not.toHaveBeenCalled();
    expect(saved.at(-1)?.state).toBe("FAILED");
  });

  it("retains the PR URL if saving COMPLETED fails", async () => {
    const save = mocks.saveTask.getMockImplementation()!;
    mocks.saveTask.mockImplementation(async (task: Task) => {
      if (task.state === "COMPLETED") throw new Error("completion save failed");
      return save(task);
    });
    await expect(executeApprovedTask(input.id, workspace)).rejects.toThrow(
      "completion save failed",
    );
    expect(saved.at(-1)).toMatchObject({
      state: "FAILED",
      pullRequestUrl: "https://github.com/example/repo/pull/42",
    });
  });

  it("preserves both operation and persistence errors", async () => {
    const cause = new Error("Codex failed");
    const disk = new Error("storage unavailable");
    mocks.runImplementer.mockRejectedValue(cause);
    const save = mocks.saveTask.getMockImplementation()!;
    mocks.saveTask.mockImplementation(async (task: Task) => {
      if (task.state === "FAILED") throw disk;
      return save(task);
    });
    await expect(
      executeApprovedTask(input.id, workspace),
    ).rejects.toMatchObject({
      errors: [expect.objectContaining({ cause }), disk],
    });
    expect(mocks.validateWorkspace).not.toHaveBeenCalled();
  });
});

describe("resumeTask", () => {
  beforeEach(() => {
    input = {
      ...input,
      state: "FAILED",
      workspace,
      baseBranch: "development",
      branchName: "agent/execution-test",
      failure: {
        state: "IMPLEMENTING",
        message: "Selected model is at capacity",
        at: "now",
      },
    };
    mocks.getCurrentBranch.mockReset().mockResolvedValue(input.branchName);
  });

  it("continues on the existing branch, preserves metadata and selects a model", async () => {
    const result = await resumeTask(input.id, workspace, "alternative-model");
    expect(mocks.assertWorkspaceClean).not.toHaveBeenCalled();
    expect(mocks.createTaskBranch).not.toHaveBeenCalled();
    expect(mocks.runImplementer).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: input.threadId,
        plan: input.plan,
        baseBranch: "development",
        branchName: input.branchName,
        model: "alternative-model",
        state: "IMPLEMENTING",
      }),
      workspace,
    );
    expect(result).toMatchObject({
      state: "COMPLETED",
      model: "alternative-model",
      baseBranch: "development",
    });
    expect(mocks.validateWorkspace).toHaveBeenCalledOnce();
    expect(mocks.commitChanges).toHaveBeenCalledOnce();
    expect(mocks.pushBranch).toHaveBeenCalledOnce();
    expect(mocks.createPullRequest).toHaveBeenCalledOnce();
  });

  it("supports the existing legacy implementation failure without failure/workspace metadata", async () => {
    delete input.failure;
    delete input.workspace;
    await resumeTask(input.id, workspace);
    expect(saved[0]).toMatchObject({ state: "IMPLEMENTING", workspace });
  });

  it.each(["IMPLEMENTING", "VALIDATING"] as const)(
    "recovers an interrupted %s",
    async (state) => {
      input.state = state;
      await resumeTask(input.id, workspace);
      expect(mocks.runImplementer).toHaveBeenCalledTimes(
        state === "IMPLEMENTING" ? 1 : 0,
      );
      expect(mocks.validateWorkspace).toHaveBeenCalledOnce();
    },
  );

  it("retries validation without repeating implementation", async () => {
    input.failure!.state = "VALIDATING";
    input.validation = { success: false, output: "Docker unavailable" };
    await resumeTask(input.id, workspace);
    expect(mocks.runImplementer).not.toHaveBeenCalled();
    expect(saved.at(-1)?.validation?.success).toBe(true);
  });

  it.each([
    { state: "AWAITING_APPROVAL" },
    { state: "COMPLETED" },
    { baseBranch: undefined },
    { branchName: "agent/other" },
    { workspace: "/other/workspace" },
    { threadId: undefined },
    { plan: undefined },
    { commitSha: "existing" },
    { pullRequestUrl: "existing" },
    { failure: { state: "COMMITTING", message: "failure", at: "now" } },
    { failure: undefined, validation: { success: true, output: "passed" } },
  ])(
    "rejects unsafe recovery %j without writes or implementation",
    async (override) => {
      Object.assign(input, override);
      await expect(resumeTask(input.id, workspace)).rejects.toThrow();
      expect(mocks.saveTask).not.toHaveBeenCalled();
      expect(mocks.runImplementer).not.toHaveBeenCalled();
      expect(mocks.commitChanges).not.toHaveBeenCalled();
    },
  );

  it("rejects a different checked-out branch without changing task state", async () => {
    mocks.getCurrentBranch.mockResolvedValue("development");
    await expect(resumeTask(input.id, workspace)).rejects.toThrow(
      "original task branch",
    );
    expect(mocks.saveTask).not.toHaveBeenCalled();
  });

  it("records repeated capacity errors and permits a subsequent retry", async () => {
    mocks.runImplementer.mockRejectedValueOnce(new Error("at capacity"));
    await expect(resumeTask(input.id, workspace)).rejects.toThrow(
      "at capacity",
    );
    expect(saved.at(-1)).toMatchObject({
      state: "FAILED",
      failure: { state: "IMPLEMENTING", message: "at capacity" },
    });
    input = saved.at(-1)!;
    await expect(resumeTask(input.id, workspace)).resolves.toMatchObject({
      state: "COMPLETED",
    });
  });

  it("does not lose the original failed step if saving the resume checkpoint fails", async () => {
    mocks.saveTask.mockRejectedValueOnce(new Error("disk full"));
    await expect(resumeTask(input.id, workspace)).rejects.toThrow("disk full");
    expect(mocks.runImplementer).not.toHaveBeenCalled();
    expect(saved.at(-1)?.state).toBe("FAILED");
  });
});
