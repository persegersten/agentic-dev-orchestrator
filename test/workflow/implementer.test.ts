import { beforeEach, expect, it, vi } from "vitest";
import type { Task } from "../../src/workflow/task.js";

const sdk = vi.hoisted(() => ({
  startThread: vi.fn(),
  resumeThread: vi.fn(),
  run: vi.fn(),
}));
vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    startThread = sdk.startThread;
    resumeThread = sdk.resumeThread;
  },
}));

import { runImplementer } from "../../src/workflow/implementer.js";
import { runCodex, runResumedCodex } from "../../src/codex/runCodex.js";

beforeEach(() => {
  vi.resetAllMocks();
  sdk.run.mockResolvedValue({ finalResponse: "Done", usage: {} });
  sdk.startThread.mockReturnValue({ id: "thread-1", run: sdk.run });
  sdk.resumeThread.mockReturnValue({ id: "thread-1", run: sdk.run });
});

it("resumes the persisted thread in workspace-write with the authoritative plan and Git restrictions", async () => {
  const task: Task = {
    id: "test",
    state: "IMPLEMENTING",
    instruction: "Fix parser",
    threadId: "thread-1",
    branchName: "agent/test",
    plan: { summary: "Approved fix", files: [], steps: [], tests: [] },
    createdAt: "now",
    updatedAt: "now",
  };
  await runImplementer(task, "/workspace");
  expect(sdk.resumeThread).toHaveBeenCalledExactlyOnceWith("thread-1", {
    workingDirectory: "/workspace",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
  });
  expect(sdk.startThread).not.toHaveBeenCalled();
  const prompt = sdk.run.mock.calls[0]![0] as string;
  expect(prompt).toContain(JSON.stringify(task.plan, null, 2));
  expect(prompt).toContain("persisted approved plan above is authoritative");
  expect(prompt).toContain("agent/test");
  expect(prompt).toContain("Do not merge or approve pull requests.");
  expect(prompt).toContain(
    "Do not create or switch branches, commit, push, or create pull requests.",
  );
});

it("keeps planning read-only", async () => {
  await runCodex("Plan the change", "/workspace");
  expect(sdk.startThread).toHaveBeenCalledWith({
    workingDirectory: "/workspace",
    sandboxMode: "read-only",
    approvalPolicy: "never",
  });
});

it("rejects a resumed turn with no thread ID", async () => {
  sdk.resumeThread.mockReturnValue({ id: null, run: sdk.run });
  await expect(
    runResumedCodex("thread-1", "Implement", "/workspace"),
  ).rejects.toThrow("no thread ID");
});
