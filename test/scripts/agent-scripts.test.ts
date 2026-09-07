import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";

const execute = promisify(execFile);
const scripts = ["plan-agent-task.sh", "run-approved-agent-task.sh"];
let directory: string;
let wrapperDirectory: string;
let log: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "agent-scripts-"));
  wrapperDirectory = join(directory, "orchestrator with spaces");
  const bin = join(directory, "bin");
  await mkdir(wrapperDirectory);
  await mkdir(bin);
  for (const script of scripts) {
    await copyFile(resolve(script), join(wrapperDirectory, script));
    await chmod(join(wrapperDirectory, script), 0o755);
  }
  log = join(directory, "calls");
  await writeFile(log, "");
  const npm = join(bin, "npm");
  await writeFile(
    npm,
    `#!/usr/bin/env bash
set -eu
printf '%s\\0' "$PWD" "$@" >> "$CALL_LOG"
if [[ "$4" == "$FAIL_COMMAND" ]]; then
  echo "$4 failed" >&2
  exit 7
fi
case "$4" in
  create) if [[ -z "$NO_TASK_ID" ]]; then echo 'Task created: task-123'; fi ;;
  plan) echo 'State: AWAITING_APPROVAL' ;;
  approve) printf 'Task completed: task-123\\nBranch: agent/task-123\\nCommit: abc123\\nPull request: https://github.com/example/repo/pull/1\\nState: COMPLETED\\n' ;;
  *) exit 8 ;;
esac
`,
  );
  await chmod(npm, 0o755);
  env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CALL_LOG: log,
    FAIL_COMMAND: "",
    NO_TASK_ID: "",
  };
});

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function calls(): Promise<string[]> {
  return (await readFile(log, "utf8")).split("\0").slice(0, -1);
}

function run(script: string, args: string[]) {
  return execute(join(wrapperDirectory, script), args, { cwd: directory, env });
}

it("creates and plans only, preserving instruction quoting and using the script directory", async () => {
  const instruction = 'Add reverse; $(literal) "quotes"\nsecond line';
  const result = await run(scripts[0]!, [instruction]);
  expect(await calls()).toEqual([
    wrapperDirectory,
    "run",
    "agent",
    "--",
    "create",
    instruction,
    wrapperDirectory,
    "run",
    "agent",
    "--",
    "plan",
    "task-123",
  ]);
  expect(result.stdout).toContain("Task planned successfully.");
  expect(result.stdout).toContain(
    "Task ID: task-123\nState: AWAITING_APPROVAL",
  );
  expect(result.stdout).toContain("Review the plan before continuing.");
  expect(result.stdout).toContain("./run-approved-agent-task.sh task-123");
});

it("invokes approval exactly once and passes through completion without a prompt", async () => {
  const result = await run(scripts[1]!, ["task-123"]);
  expect(await calls()).toEqual([
    wrapperDirectory,
    "run",
    "agent",
    "--",
    "approve",
    "task-123",
  ]);
  expect(result.stdout).toContain(
    "Task completed: task-123\nBranch: agent/task-123\nCommit: abc123\nPull request: https://github.com/example/repo/pull/1\nState: COMPLETED",
  );
});

it.each(
  scripts.flatMap((script) =>
    [[], [" "], ["one", "two"]].map((args) => ({ script, args })),
  ),
)("rejects invalid arguments: $script $args", async ({ script, args }) => {
  await expect(run(script, args)).rejects.toHaveProperty("code", 64);
  expect(await calls()).toEqual([]);
});

it.each(["create", "plan"])("stops when %s fails", async (command) => {
  env.FAIL_COMMAND = command;
  await expect(run(scripts[0]!, ["Task instruction"])).rejects.toMatchObject({
    code: 7,
    stdout: expect.not.stringContaining("Task planned successfully."),
  });
  expect(await calls()).toHaveLength(command === "create" ? 6 : 12);
});

it("stops when creation returns no task ID", async () => {
  env.NO_TASK_ID = "1";
  await expect(run(scripts[0]!, ["Task instruction"])).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("could not determine the task ID"),
  });
  expect(await calls()).toHaveLength(6);
});

it("propagates approval failure without retrying or re-planning", async () => {
  env.FAIL_COMMAND = "approve";
  await expect(run(scripts[1]!, ["task-123"])).rejects.toMatchObject({
    code: 7,
    stdout: "",
  });
  expect(await calls()).toEqual([
    wrapperDirectory,
    "run",
    "agent",
    "--",
    "approve",
    "task-123",
  ]);
});
