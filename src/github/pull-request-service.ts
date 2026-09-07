import { execa } from "execa";

import type { Task } from "../workflow/task.js";

function required(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new Error(`Task requires ${field} to create a PR`);
  return value;
}

export function buildPullRequestContent(task: Task): {
  title: string;
  body: string;
} {
  const instruction = required(task.instruction, "instruction");
  const summary = required(task.plan?.summary, "approved plan summary");
  const commitSha = required(task.commitSha, "commitSha");
  if (!task.validation)
    throw new Error("Task requires a validation result to create a PR");

  // Indent output so Markdown fences or headings in logs remain literal text.
  const output = (task.validation.output || "(No validation output)")
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

  return {
    title: summary.trim().replace(/\s+/g, " ").slice(0, 200),
    body: [
      "## Original task instruction",
      instruction,
      "## Approved plan",
      summary,
      "## Validation",
      task.validation.success ? "PASSED" : "FAILED",
      output,
      "## Commit SHA",
      commitSha,
    ].join("\n\n"),
  };
}

/** The caller must push the task branch first and persist the returned URL. */
export async function createPullRequest(
  task: Task,
  workspace: string,
): Promise<string> {
  const base = required(task.baseBranch, "baseBranch");
  const head = required(task.branchName, "branchName");
  if (base === head) throw new Error("PR base and task branch must differ");
  if (task.pullRequestUrl)
    throw new Error("Task already has a pull request URL");
  const { title, body } = buildPullRequestContent(task);
  if (!task.validation?.success)
    throw new Error("Task validation must pass before creating a PR");

  let stdout: string;
  try {
    const result = await execa(
      "gh",
      [
        "pr",
        "create",
        "--base",
        base,
        "--head",
        head,
        "--title",
        title,
        "--body-file",
        "-",
      ],
      {
        cwd: workspace,
        shell: false,
        input: body,
        env: { GH_PROMPT_DISABLED: "1" },
      },
    );
    stdout = result.stdout;
  } catch (cause) {
    const stderr =
      cause &&
      typeof cause === "object" &&
      "stderr" in cause &&
      typeof cause.stderr === "string"
        ? cause.stderr.trim()
        : "";
    const detail =
      stderr || (cause instanceof Error ? cause.message : String(cause));
    throw new Error(`gh pr create failed for task ${task.id}: ${detail}`, {
      cause,
    });
  }

  const url = stdout.trim();
  // Permit GitHub Enterprise hosts, but reject empty or unexpected CLI output.
  if (!/^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/[1-9]\d*$/.test(url)) {
    throw new Error(
      "gh pr create returned no valid PR URL; check GitHub before retrying",
    );
  }
  return url;
}
