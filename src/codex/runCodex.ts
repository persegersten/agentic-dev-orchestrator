import { Codex, type Thread, type ThreadItem } from "@openai/codex-sdk";

import { startProgress } from "../workflow/progress.js";

export type CodexRunResult = {
  finalResponse: string;
  threadId: string;
  usage: unknown;
};

export async function runCodex(
  instruction: string,
  workspace: string,
): Promise<CodexRunResult> {
  const codex = new Codex();

  const thread = codex.startThread({
    workingDirectory: workspace,
    sandboxMode: "read-only",
    approvalPolicy: "never",
  });

  return consumeTurn(thread, instruction, "Codex planning");
}

export async function runResumedCodex(
  threadId: string,
  instruction: string,
  workspace: string,
): Promise<CodexRunResult> {
  const codex = new Codex();

  const thread = codex.resumeThread(threadId, {
    workingDirectory: workspace,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
  });

  return consumeTurn(thread, instruction, "Codex implementation");
}

async function consumeTurn(
  thread: Thread,
  instruction: string,
  label: string,
): Promise<CodexRunResult> {
  const progress = startProgress(label);
  progress.report(`Starting turn${thread.id ? ` on thread ${thread.id}` : ""}`);
  const seen = new Map<string, string>();
  let finalResponse = "";
  let usage: unknown = null;
  let completed = false;
  try {
    const { events } = await thread.runStreamed(instruction);
    for await (const event of events) {
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "turn.failed") throw new Error(event.error.message);
      if (event.type === "turn.completed") {
        usage = event.usage;
        completed = true;
      }
      if (
        event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed"
      ) {
        const item = event.item;
        if (item.type === "agent_message" && event.type === "item.completed")
          finalResponse = item.text;
        const message = describeItem(item, event.type === "item.completed");
        if (message && seen.get(item.id) !== message) {
          seen.set(item.id, message);
          progress.report(message);
        }
      }
    }
    if (!completed)
      throw new Error("Codex stream ended without turn completion");
    if (!thread.id) throw new Error("Codex returned no thread ID.");
    progress.report("Turn completed");
    return { finalResponse, threadId: thread.id, usage };
  } finally {
    progress.stop();
  }
}

function describeItem(
  item: ThreadItem,
  completed: boolean,
): string | undefined {
  switch (item.type) {
    case "agent_message":
      return completed ? item.text : undefined;
    case "command_execution":
      return `Command ${item.status}: ${item.command}${item.exit_code === undefined ? "" : ` (exit ${item.exit_code})`}`;
    case "file_change":
      return `Files ${item.status}: ${item.changes.map((change) => `${change.kind} ${change.path}`).join(", ")}`;
    case "mcp_tool_call":
      return `Tool ${item.server}/${item.tool}: ${item.status}`;
    case "error":
      return `Warning: ${item.message}`;
    default:
      return undefined;
  }
}
