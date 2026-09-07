import { beforeEach, describe, expect, it, vi } from "vitest";

const { command } = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("execa", () => ({ execa: command }));

import {
  buildPullRequestContent,
  createPullRequest,
} from "../../src/github/pull-request-service.js";
import type { Task } from "../../src/workflow/task.js";

function task(): Task {
  return {
    id: "pr-test",
    instruction: "Fix the parser\nPreserve `quotes` and $(literal).",
    state: "CREATING_PR",
    baseBranch: "release/next",
    branchName: "agent/pr-test",
    plan: { summary: "Fix parser\n handling", files: [], steps: [], tests: [] },
    validation: { success: true, output: "2 tests passed\n```\n# literal log" },
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  command.mockReset();
  command.mockResolvedValue({
    stdout: "https://github.com/example/repo/pull/42\n",
  });
});

describe("pull request service", () => {
  it("builds deterministic content from persisted task data", () => {
    const input = task();
    expect(buildPullRequestContent(input)).toEqual({
      title: "Fix parser handling",
      body: "## Original task instruction\n\nFix the parser\nPreserve `quotes` and $(literal).\n\n## Approved plan\n\nFix parser\n handling\n\n## Validation\n\nPASSED\n\n    2 tests passed\n    ```\n    # literal log\n\n## Commit SHA\n\n0123456789abcdef0123456789abcdef01234567",
    });
    expect(buildPullRequestContent(input)).toEqual(
      buildPullRequestContent(input),
    );
    expect(command).not.toHaveBeenCalled();
  });

  it("bounds long titles and handles empty validation output", () => {
    const input = task();
    input.plan!.summary = "x".repeat(250);
    input.validation!.output = "";
    expect(buildPullRequestContent(input).title).toHaveLength(200);
    expect(buildPullRequestContent(input).body).toContain(
      "(No validation output)",
    );
  });

  it("creates only a PR with explicit persisted branches and body on stdin", async () => {
    const input = task();
    const before = structuredClone(input);
    const { title, body } = buildPullRequestContent(input);
    expect(await createPullRequest(input, "/workspace with spaces")).toBe(
      "https://github.com/example/repo/pull/42",
    );
    expect(command).toHaveBeenCalledExactlyOnceWith(
      "gh",
      [
        "pr",
        "create",
        "--base",
        "release/next",
        "--head",
        "agent/pr-test",
        "--title",
        title,
        "--body-file",
        "-",
      ],
      {
        cwd: "/workspace with spaces",
        shell: false,
        input: body,
        env: { GH_PROMPT_DISABLED: "1" },
      },
    );
    expect(input).toEqual(before);
  });

  it.each([
    ["baseBranch", { baseBranch: undefined }],
    ["baseBranch", { baseBranch: "  " }],
    ["branchName", { branchName: undefined }],
    ["branchName", { branchName: "" }],
    ["instruction", { instruction: " " }],
    ["approved plan summary", { plan: undefined }],
    [
      "approved plan summary",
      { plan: { summary: " ", files: [], steps: [], tests: [] } },
    ],
    ["commitSha", { commitSha: undefined }],
    ["commitSha", { commitSha: " " }],
    ["validation result", { validation: undefined }],
  ] satisfies [string, Partial<Task>][])(
    "rejects missing %s",
    async (field, patch) => {
      await expect(
        createPullRequest({ ...task(), ...patch }, "/workspace"),
      ).rejects.toThrow(field);
      expect(command).not.toHaveBeenCalled();
    },
  );

  it("reports failed validation accurately and refuses PR creation", async () => {
    const input = task();
    input.validation = { success: false, output: "test failed" };
    expect(buildPullRequestContent(input).body).toContain(
      "FAILED\n\n    test failed",
    );
    await expect(createPullRequest(input, "/workspace")).rejects.toThrow(
      "validation must pass",
    );
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    { branchName: "release/next" },
    { pullRequestUrl: "https://github.com/example/repo/pull/1" },
  ])("rejects identical branches or an already recorded PR", async (patch) => {
    await expect(
      createPullRequest({ ...task(), ...patch }, "/workspace"),
    ).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    Object.assign(new Error("command failed"), {
      stderr: "authentication required",
      exitCode: 1,
    }),
    new Error("spawn gh ENOENT"),
  ])("preserves command failure details and cause", async (cause) => {
    command.mockRejectedValue(cause);
    const promise = createPullRequest(task(), "/workspace");
    await expect(promise).rejects.toThrow(
      "gh pr create failed for task pr-test",
    );
    await expect(promise).rejects.toHaveProperty("cause", cause);
    await expect(promise).rejects.toThrow(
      "stderr" in cause ? String(cause.stderr) : cause.message,
    );
    expect(command).toHaveBeenCalledTimes(1);
  });

  it.each([
    "",
    "created",
    "https://github.com/example/repo",
    "https://github.com/example/repo/pull/0",
  ])("rejects unexpected output %s without retrying", async (stdout) => {
    command.mockResolvedValue({ stdout });
    await expect(createPullRequest(task(), "/workspace")).rejects.toThrow(
      "check GitHub before retrying",
    );
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("accepts a GitHub Enterprise PR URL", async () => {
    command.mockResolvedValue({
      stdout: "https://github.example.test/team/repo/pull/5\n",
    });
    expect(await createPullRequest(task(), "/workspace")).toBe(
      "https://github.example.test/team/repo/pull/5",
    );
  });
});
