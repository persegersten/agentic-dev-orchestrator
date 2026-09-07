import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { deleteTask, loadTask } from "../../src/workflow/task-store.js";
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

const argv = process.argv;
const exitCode = process.exitCode;
let workspace: string;
let created: Task | undefined;

afterEach(async () => {
  process.argv = argv;
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (created) await deleteTask(created);
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

it("exercises real CLI create/plan and JSON storage without implementing", async () => {
  workspace = await mkdtemp(join(tmpdir(), "planning-boundary-"));
  const file = join(workspace, "unchanged.txt");
  await writeFile(file, "user content");
  vi.stubEnv("AGENT_WORKSPACE", workspace);
  vi.stubEnv("LOG_LEVEL", "silent");
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const plan = {
    summary: "Add reverse movement",
    files: ["vehicle.ts"],
    steps: ["Implement reverse"],
    tests: ["Test reverse"],
  };
  sdk.run.mockResolvedValue({ finalResponse: JSON.stringify(plan), usage: {} });
  sdk.startThread.mockReturnValue({ id: "planning-thread", run: sdk.run });

  process.argv = [
    "node",
    "agent",
    "create",
    "Add reverse movement to vehicles",
  ];
  await import("../../src/cli/agent.js");
  await vi.waitFor(() =>
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Task created: /)),
  );
  const line = log.mock.calls.find(([message]) =>
    String(message).startsWith("Task created: "),
  )![0] as string;
  created = await loadTask(line.slice("Task created: ".length));
  expect(created.state).toBe("RECEIVED");

  vi.resetModules();
  process.argv = ["node", "agent", "plan", created.id];
  await import("../../src/cli/agent.js");
  await vi.waitFor(() =>
    expect(log).toHaveBeenCalledWith("State: AWAITING_APPROVAL"),
  );
  const planned = await loadTask(created.id);
  expect(planned).toMatchObject({
    state: "AWAITING_APPROVAL",
    plan,
    threadId: "planning-thread",
  });
  expect(planned.branchName).toBeUndefined();
  expect(planned.commitSha).toBeUndefined();
  expect(planned.pullRequestUrl).toBeUndefined();
  expect(sdk.startThread).toHaveBeenCalledExactlyOnceWith({
    workingDirectory: workspace,
    sandboxMode: "read-only",
    approvalPolicy: "never",
  });
  expect(sdk.run.mock.calls[0]![0]).toContain(
    "Do not modify, create, rename or delete any files.",
  );
  expect(sdk.run.mock.calls[0]![0]).toContain(
    "merge, or approve pull requests.",
  );
  expect(sdk.resumeThread).not.toHaveBeenCalled();
  expect(await readFile(file, "utf8")).toBe("user content");
});
