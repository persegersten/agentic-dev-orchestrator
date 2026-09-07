import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeApprovedTask: vi.fn(),
  planChange: vi.fn(),
  loadTask: vi.fn(),
  saveTask: vi.fn(),
}));
vi.mock("../../src/workflow/execute-task.js", () => mocks);
vi.mock("../../src/workflow/planner.js", () => mocks);
vi.mock("../../src/workflow/task-store.js", () => ({
  ...mocks,
  createTask: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock("../../src/codex/runCodex.js", () => ({ runCodex: vi.fn() }));
vi.mock("pino", () => ({ default: () => ({ info: vi.fn() }) }));

const argv = process.argv;
const exitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("AGENT_WORKSPACE", "/workspace");
  process.exitCode = 0;
});

afterEach(() => {
  process.argv = argv;
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("runs the lifecycle only through explicit approval and prints the PR URL", async () => {
  process.argv = ["node", "agent", "approve", "task-1"];
  mocks.executeApprovedTask.mockResolvedValue({
    id: "task-1",
    state: "COMPLETED",
    branchName: "agent/task-1",
    commitSha: "abc123",
    pullRequestUrl: "https://github.com/example/repo/pull/1",
  });
  await import("../../src/cli/agent.js");
  await vi.waitFor(() =>
    expect(console.log).toHaveBeenCalledWith(
      "Pull request: https://github.com/example/repo/pull/1",
    ),
  );
  expect(mocks.executeApprovedTask).toHaveBeenCalledExactlyOnceWith(
    "task-1",
    "/workspace",
  );
  expect(console.log).toHaveBeenCalledWith("Task completed: task-1");
  expect(console.log).toHaveBeenCalledWith("Branch: agent/task-1");
  expect(console.log).toHaveBeenCalledWith("Commit: abc123");
  expect(console.log).toHaveBeenLastCalledWith("State: COMPLETED");
});

it("planning still stops at AWAITING_APPROVAL", async () => {
  process.argv = ["node", "agent", "plan", "task-1"];
  mocks.loadTask.mockResolvedValue({
    id: "task-1",
    instruction: "Fix parser",
    state: "RECEIVED",
  });
  mocks.planChange.mockResolvedValue({
    threadId: "thread-1",
    response: { summary: "Fix parser", files: [], steps: [], tests: [] },
  });
  await import("../../src/cli/agent.js");
  await vi.waitFor(() => expect(mocks.saveTask).toHaveBeenCalledTimes(2));
  expect(mocks.saveTask.mock.calls.at(-1)![0]).toMatchObject({
    state: "AWAITING_APPROVAL",
    threadId: "thread-1",
  });
  expect(mocks.executeApprovedTask).not.toHaveBeenCalled();
});

it("does not allow the old implement command to bypass approval", async () => {
  process.argv = ["node", "agent", "implement", "task-1"];
  await import("../../src/cli/agent.js");
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(console.error).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining("Use approve"),
    }),
  );
  expect(mocks.executeApprovedTask).not.toHaveBeenCalled();
});

it("reports lifecycle failures and exits unsuccessfully without printing completion", async () => {
  process.argv = ["node", "agent", "approve", "task-1"];
  const error = new Error("Push failed");
  mocks.executeApprovedTask.mockRejectedValue(error);
  await import("../../src/cli/agent.js");
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(console.error).toHaveBeenCalledWith(error);
  expect(console.log).not.toHaveBeenCalled();
});
