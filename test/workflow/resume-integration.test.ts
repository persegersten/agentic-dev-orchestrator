import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import type { Task } from "../../src/workflow/task.js";

const mocks = vi.hoisted(() => ({
  loadTask: vi.fn(),
  saveTask: vi.fn(),
  runImplementer: vi.fn(),
  validateWorkspace: vi.fn(),
  createPullRequest: vi.fn(),
}));
vi.mock("../../src/workflow/task-store.js", () => mocks);
vi.mock("../../src/workflow/implementer.js", () => mocks);
vi.mock("../../src/workflow/validator.js", () => mocks);
vi.mock("../../src/github/pull-request-service.js", () => mocks);
import { resumeTask } from "../../src/workflow/execute-task.js";

const execute = promisify(execFile);
let directory: string;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  vi.resetAllMocks();
});

it("preserves partial tracked/untracked work and completes on the original branch and base", async () => {
  directory = await mkdtemp(join(tmpdir(), "resume-integration-"));
  const workspace = join(directory, "workspace");
  await mkdir(workspace);
  const git = async (...args: string[]) =>
    (await execute("git", args, { cwd: workspace })).stdout.trim();
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Resume Test");
  await git("config", "user.email", "resume@example.test");
  await git("config", "commit.gpgSign", "false");
  await git("config", "core.hooksPath", join(directory, "no-hooks"));
  await writeFile(join(workspace, "tracked.txt"), "original\n");
  await git("add", ".");
  await git("commit", "-m", "Initial commit");
  const base = await git("rev-parse", "main");
  await git("init", "--bare", join(directory, "origin.git"));
  await git("remote", "add", "origin", join(directory, "origin.git"));
  await git("checkout", "-b", "agent/resume-test");
  await writeFile(join(workspace, "tracked.txt"), "partial implementation\n");
  await writeFile(join(workspace, "new.txt"), "retained new file\n");
  let task: Task = {
    id: "resume-test",
    state: "FAILED",
    instruction: "Finish implementation",
    threadId: "saved-thread",
    baseBranch: "main",
    branchName: "agent/resume-test",
    plan: { summary: "Finish implementation", files: [], steps: [], tests: [] },
    createdAt: "now",
    updatedAt: "now",
  };
  mocks.loadTask.mockImplementation(async () => structuredClone(task));
  mocks.saveTask.mockImplementation(async (saved: Task) => {
    task = structuredClone(saved);
  });
  mocks.runImplementer.mockImplementation(async (resumed: Task) => {
    expect(resumed.threadId).toBe("saved-thread");
    expect(resumed.model).toBe("alternative-model");
    expect(await git("branch", "--show-current")).toBe("agent/resume-test");
    expect(await readFile(join(workspace, "tracked.txt"), "utf8")).toBe(
      "partial implementation\n",
    );
    expect(await readFile(join(workspace, "new.txt"), "utf8")).toBe(
      "retained new file\n",
    );
    await writeFile(
      join(workspace, "tracked.txt"),
      "completed implementation\n",
    );
  });
  mocks.validateWorkspace.mockResolvedValue({
    success: true,
    output: "passed",
  });
  mocks.createPullRequest.mockImplementation(async (completed: Task) => {
    expect(completed.baseBranch).toBe("main");
    expect(await git("rev-parse", "@{upstream}")).toBe(completed.commitSha);
    return "https://github.com/example/repo/pull/1";
  });
  await mkdir(join(workspace, "nested"));
  await expect(resumeTask(task.id, join(workspace, "nested"))).rejects.toThrow(
    "repository root",
  );
  expect(mocks.saveTask).not.toHaveBeenCalled();
  expect(await readFile(join(workspace, "new.txt"), "utf8")).toBe(
    "retained new file\n",
  );

  const result = await resumeTask(task.id, workspace, "alternative-model");
  expect(result.state).toBe("COMPLETED");
  expect(await git("rev-parse", "main")).toBe(base);
  expect(await git("show", "HEAD:new.txt")).toBe("retained new file");
  expect(await git("show", "HEAD:tracked.txt")).toBe(
    "completed implementation",
  );
  expect(await git("status", "--porcelain")).toBe("");
  expect(await git("ls-remote", "--heads", "origin")).toBe(
    `${result.commitSha}\trefs/heads/agent/resume-test`,
  );
});
