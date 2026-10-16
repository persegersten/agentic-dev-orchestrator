import { execa } from "execa";

import type { Task } from "../workflow/task.js";

// Budget bytes conservatively so Unicode and Markdown indentation cannot exceed
// the server's body limit. Full content remains in the persisted task record.
function excerpt(value: string, budget: number): string {
  if (Buffer.byteLength(value, "utf8") <= budget) return value;
  const marker =
    "\n\n[Truncated; full content is saved in the local task record.]";
  let result = "";
  let bytes = Buffer.byteLength(marker);
  for (const char of value) {
    bytes += Buffer.byteLength(char);
    if (bytes > budget) break;
    result += char;
  }
  return result + marker;
}

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
  const output = excerpt(
    task.validation.output || "(No validation output)",
    12_000,
  )
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

  return {
    title: summary.trim().replace(/\s+/g, " ").slice(0, 200),
    body: [
      "## Original task instruction",
      excerpt(instruction, 12_000),
      "## Approved plan",
      excerpt(summary, 12_000),
      "## Validation",
      task.validation.success ? "PASSED" : "FAILED",
      excerpt(output, 24_000),
      "## Commit SHA",
      commitSha,
    ].join("\n\n"),
  };
}

/** The caller must push the task branch first and persist the returned URL. */
export async function createPullRequest(
  task: Task,
  workspace: string,
  recover = false,
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
  if (recover) {
    // A previous request may have succeeded before its URL was saved.
    const existing = await execa(
      "gh",
      [
        "pr",
        "list",
        "--base",
        base,
        "--head",
        head,
        "--state",
        "all",
        "--json",
        "url,headRefOid",
      ],
      {
        cwd: workspace,
        shell: false,
        env: { GH_PROMPT_DISABLED: "1" },
      },
    );
    const matches: { url: string; headRefOid: string }[] = JSON.parse(
      existing.stdout,
    );
    if (matches.length > 0) {
      if (
        matches.length !== 1 ||
        matches[0]!.headRefOid !== task.commitSha ||
        !/^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/[1-9]\d*$/.test(
          matches[0]!.url,
        )
      ) {
        throw new Error(
          "Existing PR does not uniquely match the saved task commit; inspect GitHub before retrying",
        );
      }
      return matches[0]!.url;
    }
  }
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
