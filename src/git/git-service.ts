import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import type { Task } from "../workflow/task.js";

const execFileAsync = promisify(execFile);

async function git(workspace: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: workspace });
  return stdout.trim();
}

// Staging covers the repository, so reject subdirectories and parent-repo fallback.
async function requireRepositoryRoot(workspace: string): Promise<void> {
  const root = await git(workspace, ["rev-parse", "--show-toplevel"]);
  if ((await realpath(workspace)) !== (await realpath(root))) {
    throw new Error("Workspace must be the Git repository root");
  }
}

export async function getCurrentBranch(workspace: string): Promise<string> {
  await requireRepositoryRoot(workspace);
  // symbolic-ref fails on detached HEAD rather than returning a pseudo-branch.
  return git(workspace, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
}

export async function isWorkspaceClean(workspace: string): Promise<boolean> {
  await requireRepositoryRoot(workspace);
  return (
    (await git(workspace, [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ])) === ""
  );
}

export async function assertWorkspaceClean(workspace: string): Promise<void> {
  if (!(await isWorkspaceClean(workspace))) {
    throw new Error("Workspace has local changes; refusing to proceed");
  }
}

export function getTaskBranchName(taskId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(taskId)) {
    throw new Error(
      "Task id must contain only letters, digits, underscores or hyphens",
    );
  }
  return `agent/${taskId}`;
}

export async function createTaskBranch(
  task: Task,
  workspace: string,
): Promise<string> {
  const branchName = getTaskBranchName(task.id);
  const currentBranch = await getCurrentBranch(workspace);
  if (task.baseBranch && task.baseBranch !== currentBranch) {
    throw new Error("Current branch does not match the task base branch");
  }
  if (task.branchName && task.branchName !== branchName) {
    throw new Error("Task branch name does not match its task id");
  }
  await assertWorkspaceClean(workspace);
  // -b refuses an existing branch; it never resets or reuses it.
  await git(workspace, ["checkout", "-b", branchName]);
  return branchName;
}

async function requireTaskBranch(
  task: Task,
  workspace: string,
): Promise<string> {
  const expected = getTaskBranchName(task.id);
  if (!task.baseBranch || task.branchName !== expected) {
    throw new Error(
      "Task must have a base branch and its dedicated branch name",
    );
  }
  if (task.branchName === task.baseBranch) {
    throw new Error("Refusing to commit or push the base branch");
  }
  if ((await getCurrentBranch(workspace)) !== task.branchName) {
    throw new Error("Current branch does not match the task branch");
  }
  return task.branchName;
}

/**
 * The caller must ensure a clean starting workspace and exclusive task access.
 * Git cannot distinguish task edits from unrelated edits made during execution.
 */
export async function commitChanges(
  task: Task,
  workspace: string,
): Promise<string> {
  await requireTaskBranch(task, workspace);
  const message = task.plan?.summary.trim();
  if (!message) {
    throw new Error("Task must have an approved plan summary to commit");
  }
  if (await isWorkspaceClean(workspace)) {
    throw new Error("No changes to commit");
  }
  await git(workspace, ["add", "--all", "--", "."]);
  await git(workspace, ["commit", "-m", message]);
  return git(workspace, ["rev-parse", "--verify", "HEAD"]);
}

export async function pushBranch(task: Task, workspace: string): Promise<void> {
  const branchName = await requireTaskBranch(task, workspace);
  await assertWorkspaceClean(workspace);
  // An explicit destination avoids configured push refspecs targeting other branches.
  const ref = `refs/heads/${branchName}`;
  await git(workspace, ["push", "-u", "origin", `${ref}:${ref}`]);
}
