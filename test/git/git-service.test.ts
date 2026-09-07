import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertWorkspaceClean,
  commitChanges,
  createTaskBranch,
  getCurrentBranch,
  getTaskBranchName,
  isWorkspaceClean,
  pushBranch,
} from "../../src/git/git-service.js";
import type { Task } from "../../src/workflow/task.js";

const execFileAsync = promisify(execFile);
let directory: string;
let workspace: string;
let task: Task;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: workspace });
  return stdout.trim();
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "git-service-test-"));
  workspace = join(directory, "workspace");
  await mkdir(workspace);
  await git("init", "--initial-branch=development");
  await git("config", "user.name", "Git Service Test");
  await git("config", "user.email", "git-service@example.test");
  await git("config", "commit.gpgSign", "false");
  await git("config", "core.hooksPath", join(directory, "no-hooks"));
  await writeFile(join(workspace, "tracked.txt"), "initial\n");
  await git("add", ".");
  await git("commit", "-m", "Initial commit");
  task = {
    id: "test-123",
    instruction: "Update files",
    state: "COMMITTING",
    baseBranch: "development",
    plan: {
      summary: "Update files; $(echo literal) `literal`",
      files: ["tracked.txt", "new.txt"],
      steps: [],
      tests: [],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
});

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function onTaskBranch(): Promise<void> {
  task.branchName = await createTaskBranch(task, workspace);
}

describe("Git service", () => {
  it("detects the actual base branch and a clean workspace", async () => {
    expect(await getCurrentBranch(workspace)).toBe("development");
    expect(await isWorkspaceClean(workspace)).toBe(true);
    await expect(assertWorkspaceClean(workspace)).resolves.toBeUndefined();
  });

  it.each(["untracked", "modified", "staged", "deleted"])(
    "refuses branch creation with %s changes and preserves them",
    async (kind) => {
      if (kind === "untracked") {
        await writeFile(join(workspace, "new.txt"), "unrelated");
        await git("config", "status.showUntrackedFiles", "no");
      } else if (kind === "deleted") {
        await unlink(join(workspace, "tracked.txt"));
      } else {
        await writeFile(join(workspace, "tracked.txt"), "unrelated");
        if (kind === "staged") await git("add", ".");
      }
      const status = await git(
        "status",
        "--porcelain",
        "--untracked-files=all",
      );
      expect(await isWorkspaceClean(workspace)).toBe(false);
      await expect(createTaskBranch(task, workspace)).rejects.toThrow(
        "local changes",
      );
      expect(await git("status", "--porcelain", "--untracked-files=all")).toBe(
        status,
      );
      expect(await getCurrentBranch(workspace)).toBe("development");
    },
  );

  it("creates and switches to the predictable branch without moving the base", async () => {
    const base = await git("rev-parse", "HEAD");
    expect(getTaskBranchName(task.id)).toBe("agent/test-123");
    await onTaskBranch();
    expect(await getCurrentBranch(workspace)).toBe("agent/test-123");
    expect(await git("rev-parse", "development")).toBe(base);
  });

  it("refuses to reuse an existing task branch", async () => {
    await onTaskBranch();
    await git("checkout", "development");
    await expect(createTaskBranch(task, workspace)).rejects.toThrow();
    expect(await getCurrentBranch(workspace)).toBe("development");
  });

  it.each(["../bad", "--option", "a/b", "a;echo", ""])(
    "rejects unsafe task id %s",
    (id) => expect(() => getTaskBranchName(id)).toThrow("Task id"),
  );

  it("rejects detached HEAD", async () => {
    await git("checkout", "--detach");
    await expect(getCurrentBranch(workspace)).rejects.toThrow();
    await expect(createTaskBranch(task, workspace)).rejects.toThrow();
  });

  it("rejects a mismatched base or task branch", async () => {
    await expect(
      createTaskBranch({ ...task, baseBranch: "other" }, workspace),
    ).rejects.toThrow("base branch");
    await expect(
      createTaskBranch({ ...task, branchName: "other" }, workspace),
    ).rejects.toThrow("task id");
  });

  it("rejects a subdirectory or a non-repository workspace", async () => {
    const nested = join(workspace, "nested");
    await mkdir(nested);
    await expect(isWorkspaceClean(nested)).rejects.toThrow("repository root");
    await expect(getCurrentBranch(directory)).rejects.toThrow();
  });

  it("stages additions, edits and deletions, commits the summary and returns HEAD SHA", async () => {
    await onTaskBranch();
    await writeFile(join(workspace, "new.txt"), "new\n");
    await unlink(join(workspace, "tracked.txt"));
    const sha = await commitChanges(task, workspace);
    expect(sha).toMatch(/^[a-f0-9]{40,64}$/);
    expect(sha).toBe(await git("rev-parse", "HEAD"));
    expect(await git("log", "-1", "--format=%B")).toBe(task.plan!.summary);
    expect(await git("show", "HEAD:new.txt")).toBe("new");
    expect(await git("ls-tree", "--name-only", "HEAD")).toBe("new.txt");
    expect(await isWorkspaceClean(workspace)).toBe(true);

    await writeFile(join(workspace, "new.txt"), "edited\n");
    expect(await commitChanges(task, workspace)).not.toBe(sha);
    expect(await git("show", "HEAD:new.txt")).toBe("edited");
  });

  it("refuses empty commits and missing plan summaries", async () => {
    await onTaskBranch();
    await expect(commitChanges(task, workspace)).rejects.toThrow("No changes");
    await writeFile(join(workspace, "new.txt"), "pending");
    await expect(
      commitChanges({ ...task, plan: undefined }, workspace),
    ).rejects.toThrow("plan summary");
    expect(await git("diff", "--cached", "--name-only")).toBe("");
    expect(await readFile(join(workspace, "new.txt"), "utf8")).toBe("pending");
  });

  it("refuses commit and push on the base or wrong branch", async () => {
    task.branchName = getTaskBranchName(task.id);
    await expect(commitChanges(task, workspace)).rejects.toThrow(
      "Current branch",
    );
    await expect(pushBranch(task, workspace)).rejects.toThrow("Current branch");
    await onTaskBranch();
    task.baseBranch = task.branchName;
    await expect(commitChanges(task, workspace)).rejects.toThrow("base branch");
    await expect(pushBranch(task, workspace)).rejects.toThrow("base branch");
  });

  it("pushes only the task branch to a local origin and sets upstream", async () => {
    const remote = join(directory, "origin.git");
    await git("init", "--bare", remote);
    await git("remote", "add", "origin", remote);
    await onTaskBranch();
    await writeFile(join(workspace, "new.txt"), "new\n");
    const sha = await commitChanges(task, workspace);
    await git("config", "remote.origin.push", "HEAD:refs/heads/development");
    await pushBranch(task, workspace);
    expect(await git("rev-parse", "@{upstream}")).toBe(sha);
    expect(await git("config", `branch.${task.branchName}.remote`)).toBe(
      "origin",
    );
    expect(await git("ls-remote", "--heads", "origin")).toBe(
      `${sha}\trefs/heads/${task.branchName}`,
    );
    await writeFile(join(workspace, "new.txt"), "pending");
    await expect(pushBranch(task, workspace)).rejects.toThrow("local changes");
  });
});
