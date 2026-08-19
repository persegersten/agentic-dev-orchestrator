import { Codex } from "@openai/codex-sdk";

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

  const result = await thread.run(instruction);

  if (!thread.id) {
    throw new Error("Codex returned no thread ID.");
  }

  return {
    finalResponse: result.finalResponse,
    threadId: thread.id,
    usage: result.usage,
  };
}